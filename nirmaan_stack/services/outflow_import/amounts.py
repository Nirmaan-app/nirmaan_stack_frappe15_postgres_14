# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""When two amounts count as the same money (slice V4a; two windows from T1).

PURE MODULE -- no `frappe`, no database, no request context.

⚠️ THIS EXISTS BECAUSE EXACT-AMOUNT MATCHING DOES NOT SURVIVE CONTACT WITH A BANK. Measured on live
data 2026-08-06: **31.4% of Project Payments carry paise** (2,370 of 7,556), and the bank sends
whole rupees. Three approved payments in the first real import were each within a rupee of the
transfer that paid them --

    bank Rs 18,679.00   payment PAY-00105-038  Rs 18,678.69   off by 0.31
    bank Rs 21,925.00   payment PAY-00105-034  Rs 21,924.10   off by 0.90
    bank Rs 36,963.00   payment PAY-00105-035  Rs 36,962.32   off by 0.68

-- and every one came out `Unmatched`. On that data the matcher could match NOTHING. It was not
broken; the rule was.

THERE ARE TWO WINDOWS, AND THEY ARE NOT INTERCHANGEABLE
-------------------------------------------------------
`AMOUNT_TOLERANCE` (Rs 5) is the SETTLE window. It governs what may be WRITTEN, and therefore also
    what may be OFFERED: the SQL pools, the write guard, the browse list's `suggested` flag and the
    already-Paid duplicate check all read it. Everything the screen shows as settleable is inside
    it, and everything inside it the write path accepts.

`TIER1_TOLERANCE` (Re 1) is the STRICT window used by ONE caller: the matcher's tier 1, where the
    beneficiary's bank account and IFSC both match a vendor on file. Re 1 is exactly the width of
    the rounding phenomenon -- the bank rounds a paise amount to the whole rupee, so the gap is
    always strictly less than a rupee. Tier 1 is the "nearly certain" tier and it keeps the tight
    window because it can: it has a second, strong axis of evidence.

⚠️ THE RELATION IS LOAD-BEARING: `TIER1_TOLERANCE <= AMOUNT_TOLERANCE`, ALWAYS. A tier window wider
than the settle window would let the matcher propose a record the confirm then refuses -- the exact
failure the "one number" note below was written about. Pinned by a test.

⚠️ Rs 5 IS A DECISION, NOT DRIFT (owner ruling 2026-08-07). This file previously carried Rs 1 and
said, correctly for that day, that Rs 5 "would silently settle a payment that is genuinely Rs 4
short, and nobody would ever see it". That remains TRUE and was accepted: tier 2 matches on amount
PLUS the project named in the transfer's remark, and the owner ruled the corroborated pair worth the
Rs 5 window. Two consequences that follow and were accepted with it:
  * a payment genuinely Rs 4 short now settles silently;
  * a hand-ticked payment Rs 4 off now reads `Skipped` rather than `Mismatched`.
Do not "restore" Re 1 here as a tidy-up. Re 1 still exists -- it is `TIER1_TOLERANCE`.

NEITHER WINDOW IS THE DEFERRED Q11 TOLERANCE PASS: TDS is a deduction of THOUSANDS (2% of the
amount), which neither can reach and neither may be stretched to reach. A TDS payment still arrives
`Unmatched` and is settled by hand.

⚠️ ONE OWNER, FIVE CALL SITES, AND THAT IS THE WHOLE POINT. The rule is applied by:
  * `candidates.load_payments_by_amount`    -- the SQL pool query
  * `candidates.load_expense_targets`       -- the SQL pool query
  * `matcher.match_payments` / `match_expenses` -- the in-memory comparison (tier 1 at
                                               `TIER1_TOLERANCE`, tier 2 at `AMOUNT_TOLERANCE`)
  * `settle.settle_payment` / `_lock_and_assert_settleable` -- the WRITE guard
  * `status.derive_row_outcome`             -- the ALREADY-PAID duplicate check
These are easy to fix independently and catastrophic to fix inconsistently: a pool wider than the
guard offers a record the confirm then refuses; a guard wider than the pool silently permits a
settlement the screen never proposed. The SQL half cannot import this module's function, so it takes
the BOUNDS from here instead -- `tolerance_bounds` exists so the number still lives in exactly one
place.

⚠️ THE FIFTH SITE WAS MISSING UNTIL 2026-08-07, AND ITS ABSENCE IS THE CAUTIONARY TALE FOR THIS
WHOLE FILE. `status.derive_row_outcome` compared an already-Paid duplicate against the bank amount
with `!=` -- exact -- because the list above had four entries and nobody checked the branch that was
not on it. Since the bank rounds to the whole rupee, EVERY hand-ticked payment carrying paise came
back `Mismatched`, announced with a note suggesting TDS. On one real 26-row statement that was 8
rows and Rs 3.12 of "discrepancy". If you add an amount comparison anywhere in this feature, add it
to this list -- and say WHICH window it uses.

⚠️ THE DIFFERENCE IS NOW WRITTEN ONTO THE RECORD -- REVERSED BY THE OWNER 2026-08-09 (slice X1).
This file said, correctly for that day: "the difference is not recorded anywhere ... the 31 paise is
absorbed, not booked. That was accepted explicitly." It no longer is. `rewrite_amount` below settles
a Rs 18,678.69 payment from a Rs 18,679.00 transfer by writing 18,679.00 ONTO THE PAYMENT, so the
ledger says what actually left the bank. BOTH DIRECTIONS, on all three ledgers.

Two things about that reversal belong here rather than at the call sites:
  * `rewrite_amount` DOES NOT READ EITHER WINDOW, and it is not a sixth window site. By the time it
    runs, `amounts_match` has already proven the pair is inside the settle window and the write
    guard has already accepted the record. It answers "do these two differ at all", nothing more.
    Do not "finish" it by handing it a tolerance -- a tolerance there would silently re-decide what
    may be settled, which is the guard's job and only the guard's.
  * The window itself is UNCHANGED. Rewriting the amount corrects what gets written; it never
    widens what may be written. A record outside +-Rs 5 is refused exactly as before.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

__all__ = [
    "AMOUNT_TOLERANCE",
    "TIER1_TOLERANCE",
    "amounts_match",
    "amount_difference",
    "tolerance_bounds",
    "to_decimal",
    "rewrite_amount",
]

# THE SETTLE WINDOW. Owner ruling 2026-08-07 (widened from Re 1 with tier 2; see the docstring).
# Changing it changes what may be offered AND what may be written, together -- which is why nothing
# else in this package may hold a copy, not the SQL and not the frontend.
AMOUNT_TOLERANCE = Decimal("5")

# THE TIER 1 WINDOW. One caller: `matcher`'s account+IFSC tier, which can afford to be strict
# because it has a second strong axis. MUST stay <= AMOUNT_TOLERANCE -- see the docstring.
TIER1_TOLERANCE = Decimal("1")


def to_decimal(value) -> Decimal:
    """Coerce to Decimal without going through float, which reintroduces the paise problem.

    `Decimal(0.1)` is 0.1000000000000000055511151231257827; `Decimal(str(0.1))` is 0.1. Amounts
    arrive here from a PG numeric (already Decimal), a float column, and a Data column holding a
    bare numeric string, so the conversion has to survive all three.
    """
    if isinstance(value, Decimal):
        return value
    if value is None or value == "":
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def amount_difference(left, right) -> Decimal:
    """`left - right`, signed. Positive means the left amount is the larger."""
    return to_decimal(left) - to_decimal(right)


def amounts_match(left, right, tolerance: Decimal = AMOUNT_TOLERANCE) -> bool:
    """Whether these two amounts are the same money for this feature's purposes.

    INCLUSIVE at the boundary: a difference of exactly the tolerance matches. A half-open window
    would make the rule impossible to state to an accountant without saying "within five rupees,
    but not exactly five".
    """
    return abs(amount_difference(left, right)) <= to_decimal(tolerance)


def rewrite_amount(record_amount, bank_amount) -> Decimal | None:
    """The amount to WRITE onto a record being settled, or `None` to leave it alone (slice X1).

    Returns the BANK amount whenever the two differ, in EITHER direction, and `None` when they are
    already equal. The caller writes only on a value, so an equal pair produces no write at all --
    which matters because the expense and payment paths both save the whole document, and a
    no-op field assignment would still mint a Version row saying nothing happened.

    ⚠️ IT TAKES NO TOLERANCE, ON PURPOSE -- see the module docstring. The settle window has already
    done its work by the time this is called: `amounts_match` gated the candidate pool, and the
    write guard re-asserted it under a row lock. Asking again here would put a second, quieter
    opinion about what may be settled in a function whose job is only to say what the number is.

    ⚠️ BOTH DIRECTIONS, AND THE UPWARD ONE IS THE DELIBERATE PART (owner ruling 2026-08-09). When
    the bank moved MORE than the approved amount -- up to Rs 5 more -- the record takes the larger
    figure, which means this import can record spending slightly above an approval. That was chosen
    with the consequence stated: the ledger's job is to say what left the bank. The audit trail is
    the Version log on all three ledgers, which is why both write paths go through `doc.save()`.

    The comparison is Decimal-exact through `to_decimal`, so a Data column holding "18678.69", a
    float column and a PG numeric all compare as the same money and none of them drifts through
    binary float.
    """
    record = to_decimal(record_amount)
    bank = to_decimal(bank_amount)
    return None if record == bank else bank


def tolerance_bounds(
    value, tolerance: Decimal = AMOUNT_TOLERANCE
) -> tuple[Decimal, Decimal]:
    """The inclusive `(low, high)` window around `value`, for a SQL BETWEEN.

    The SQL layer cannot call `amounts_match` -- the comparison happens in the database -- so it
    takes the bounds from here. Same number, same window, one definition.
    """
    amount = to_decimal(value)
    width = to_decimal(tolerance)
    return amount - width, amount + width
