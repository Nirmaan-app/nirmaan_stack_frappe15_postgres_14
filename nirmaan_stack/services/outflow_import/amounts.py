# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""When two amounts count as the same money (slice V4a).

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

THE TOLERANCE IS Rs 1, OWNER RULING 2026-08-06 (narrowed from an initial Rs 5 the same day). Re 1
is exactly the width of the phenomenon: the bank rounds a paise amount to the whole rupee, so the
gap is always strictly less than a rupee. Anything wider starts absorbing differences that are not
rounding -- a Rs 5 window would silently settle a payment that is genuinely Rs 4 short, and nobody
would ever see it.

It is NOT the deferred Q11 tolerance pass: TDS is a deduction of THOUSANDS (2% of the amount),
which this window cannot reach and must not be stretched to reach. A TDS payment still arrives
`Unmatched` and is settled by hand.

⚠️ ONE OWNER, FOUR CALL SITES, AND THAT IS THE WHOLE POINT. The rule is applied by:
  * `candidates.load_payments_for_vendors`  -- the SQL pool query
  * `candidates.load_expense_targets`       -- the SQL pool query
  * `matcher.match_payments` / `match_expenses` -- the in-memory comparison
  * `settle.settle_payment` / `_lock_and_assert_settleable` -- the WRITE guard
The first two and the last three are easy to fix independently and catastrophic to fix
inconsistently: a pool wider than the guard offers a record the confirm then refuses; a guard wider
than the pool silently permits a settlement the screen never proposed. The SQL half cannot import
this module's function, so it takes the BOUNDS from here instead -- `tolerance_bounds` exists so the
number still lives in exactly one place.

⚠️ THE DIFFERENCE IS NOT RECORDED ANYWHERE. Settling a Rs 18,678.69 payment from a Rs 18,679.00
transfer leaves the payment at 18,678.69 and marks it Paid. The 31 paise is absorbed, not booked.
That was accepted explicitly; writing it somewhere is a larger change than this one.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

__all__ = [
    "AMOUNT_TOLERANCE",
    "amounts_match",
    "amount_difference",
    "tolerance_bounds",
    "to_decimal",
]

# Owner ruling 2026-08-06. ONE number. Changing it changes matching AND settling together, which is
# why nothing else in this package may hold a copy -- not the SQL, not the frontend.
AMOUNT_TOLERANCE = Decimal("1")


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
