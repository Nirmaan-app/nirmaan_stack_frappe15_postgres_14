# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Row and batch status derivation (Bulk Import Outflow, slice V0).

PURE MODULE -- no `frappe`, no database, no request context. It imports exactly ONE thing from its
own package, `amounts.amounts_match`, which is itself a pure leaf; see the import for why. The
property being protected is that this deriver stays callable from a plain unittest with no bench,
no site and no fixtures -- not import-count purity for its own sake.

THE SINGLE DERIVER (ADR-0010 B3). Every `row_status` and every `Outflow Import Batch.status` in this
feature comes from here. Nothing else -- no endpoint, no controller, no frontend -- may compute one.
The frontend mirrors these rules in `outflowImportStatus.ts` and is pinned to this module by a
parity test; that mirror is a convenience, and this file is the authority.

⚠️ THIS FILE WAS REWRITTEN AT THE v3 REVERSAL (owner, 2026-08-06). The v2 spine was "the payment
branch never writes"; the new spine is:

    The import pays what someone has already approved. It never approves anything, and it never
    creates a Project Payment.

All three ledgers -- `Project Payments`, `Project Expenses`, `Non Project Expenses` -- settle
`Approved -> Paid` and nothing else. Anything in the surrounding v2 code that reads as though the
payment branch is read-only is history, not instruction. Spec: `docs/outflow-import/workflow.html`
section 0.

THE VOCABULARY -- six statuses, and what a reviewer does with each:

    Pending match run   Staged from the sheet. Nothing has been looked up yet.  -> press Run match
    Matched             At least one APPROVED record was found at this amount.  -> confirm it
    Mismatched          Nothing settleable was found, OR the amounts disagree.  -> create or link
    Settled             We wrote. The record is now Paid and linked back.       -> terminal
    Skipped             Nothing to do, and the reason says which nothing.       -> terminal
    Error               The write was attempted and rolled back.                -> retry

⚠️ `Unmatched` WAS MERGED INTO `Mismatched` (owner ruling 2026-08-10) -- SEVEN STATUSES BECAME SIX.
They were separate because they have different CAUSES: one is "the match ran and found nothing
settleable", the other is "a record already recorded as Paid disagrees on amount". They are the same
THING to the person holding the statement -- a transfer that did not line up, needing a human to
create or link something -- and splitting them made the reviewer classify the reason before they
could act on either.

THE CAUSE IS NOT LOST, IT MOVED TO THE NOTE. `_nothing_found_note` and `_delta_note` are unchanged
and still say plainly which case a row is, in the sentence the Outcome column already shows. What
went is the need to read a STATUS CHIP to find out. Do not reintroduce a status to carry a
distinction a sentence carries better.

FOUR RULES THAT LOOK LIKE DETAILS AND ARE NOT:

1. ONLY `Approved` RECORDS ARE EVER MATCHED. A transfer against a `Requested` or `CEO Pending`
   payment is simply `Mismatched`. There is no "matched but not approved" status, no approval nudge
   and no deep link into an approval queue -- nothing that cannot be settled is offered. This
   REVERSES an earlier stated goal (surfacing the 111 CEO-Pending payments, Rs 88.8 L); it was
   removed deliberately and must not be re-added. Enforcing it is `candidates.py`'s job -- this
   module simply never sees a non-Approved candidate, so `Matched` cannot lie.

2. THE ALREADY-PAID DUPLICATE CHECK SURVIVES, AND IT IS A SKIP, NOT A MATCH (owner ruling Q14). It
   is fed in through `paid_duplicate`, which comes from a query kept VISIBLY SEPARATE from the
   candidate query precisely so a later reader cannot mistake one for the other. Without it, a
   payment somebody ticked Paid by hand before uploading comes back `Mismatched`, and the obvious
   next click records the same money a second time. Mixed usage -- half a statement hand-ticked --
   is the NORMAL case under owner ruling Q12, not an edge case.

3. THE AMOUNT BRANCH OF `Mismatched` IS ABOUT AMOUNTS, FULL STOP -- and about amounts that differ by
   MORE THAN THE ROUNDING WINDOW. The v2 `Reference mismatch` branch is DELETED, not folded in: the
   owner asked why the system would compare a stored reference on a payment that is already Paid,
   and there was no answer. A reference is now only ever WRITTEN into a blank, never compared. That
   deletion is also why this module no longer imports `matcher` -- the basis string was needed by
   the reference branch and by nothing else.

   The window matters as much as the axis: a sub-rupee gap is the bank rounding a paise amount, not
   a discrepancy, and reporting it as one buried 8 of 26 rows in a real statement under a note that
   suggested TDS.

4. `Mismatched` MUST STAY RESOLVABLE. It is an OPEN status, and the screen gives it the same full
   decision dialog as any other open row. Reporting a disagreement with no way to act on it was the
   defect the owner named. This matters MORE after the merge, not less: the status is now the
   productive case -- most of the work in a statement -- rather than the rare one.

PRECEDENCE IS DELIBERATE. Duplicates and failed transfers are settled before anything is matched,
because both describe money that must not be recorded again -- or at all -- whatever a lookup would
otherwise find. The already-Paid check then runs BEFORE the candidate check, which is safe because
an already-Paid record is not in the candidate pool at all (rule 1), so the two can never contend.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Sequence

# ⚠️ THE ONE IMPORT THIS MODULE MAY MAKE FROM ITS OWN PACKAGE, and it was added to fix a live defect.
# The already-Paid branch below used EXACT equality while every other amount comparison in the
# feature used the +-Re 1 window, so a payment somebody ticked Paid by hand at Rs 18,903.60 against
# an Rs 18,904.00 transfer came back `Mismatched` -- reported as a possible TDS deduction, for
# 40 paise. On one real import that was 8 of 26 rows, totalling Rs 3.12 of "discrepancy".
#
# `amounts` is itself a PURE leaf -- `from decimal import ...` and nothing else -- so this costs
# nothing that matters: the deriver stays callable from a plain unittest with no bench, no site and
# no fixtures, which is the property the purity test actually exists to protect.
from nirmaan_stack.services.outflow_import.amounts import amounts_match

__all__ = [
    "ROW_PENDING_MATCH",
    "ROW_MATCHED",
    "ROW_MISMATCHED",
    "ROW_SETTLED",
    "ROW_SKIPPED",
    "ROW_ERROR",
    "settleable_candidates",
    "ROW_STATUSES",
    "TERMINAL_ROW_STATUSES",
    "OPEN_ROW_STATUSES",
    "BATCH_DRAFT",
    "BATCH_IN_REVIEW",
    "BATCH_PARTIALLY_SETTLED",
    "BATCH_COMPLETED",
    "BATCH_STATUSES",
    "RowOutcome",
    "Suggestion",
    "StatusTally",
    "ORIGIN_ACCEPTED",
    "ORIGIN_OVERRIDDEN",
    "ORIGIN_NO_SUGGESTION",
    "settlement_origin",
    "derive_staged_row_outcome",
    "derive_row_outcome",
    "sole_suggestion",
    "derive_batch_status",
    "derive_batch_counters",
    "derive_import_summary",
    "SKIP_REASON_NOT_SUCCESSFUL",
    "SKIP_REASON_ALREADY_IMPORTED",
    "SKIP_REASON_DUPLICATE_IN_FILE",
    "SKIP_REASON_ALREADY_PAID",
]

ROW_PENDING_MATCH = "Pending match run"
ROW_MATCHED = "Matched"
ROW_MISMATCHED = "Mismatched"
ROW_SETTLED = "Settled"
ROW_SKIPPED = "Skipped"
ROW_ERROR = "Error"

# The vocabulary in the order a reviewer meets it. The doctype's `row_status` Select carries this
# exact list in this exact order, and so does the frontend mirror.
#
# ⚠️ `Unmatched` IS RETIRED (owner ruling 2026-08-10), MERGED INTO `Mismatched`. Rows staged before
# that carry the retired string until `patches/v3_0/merge_outflow_unmatched_status.py` has run --
# and `derive_import_summary` carries an unknown status rather than dropping it precisely so an
# un-migrated database reports an honest total instead of a quietly short one.
ROW_STATUSES = (
    ROW_PENDING_MATCH,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_SETTLED,
    ROW_SKIPPED,
    ROW_ERROR,
)

# Terminal = nobody owes this row anything further.
#
# ⚠️ THIS IS NARROWER THAN v2, AND THE NARROWING IS THE POINT. Under v2 a read-only FINDING was
# terminal, because reporting it WAS the whole job. Under v3 the import settles, so a row that
# found something and has not been confirmed is unfinished work -- `Matched` and `Mismatched` are
# both OPEN. Only a row we wrote (`Settled`) or deliberately declined (`Skipped`) is done.
TERMINAL_ROW_STATUSES = frozenset({ROW_SETTLED, ROW_SKIPPED})

# Open = a person still owes this row a decision. Everything that is not terminal.
OPEN_ROW_STATUSES = frozenset({ROW_PENDING_MATCH, ROW_MATCHED, ROW_MISMATCHED, ROW_ERROR})

BATCH_DRAFT = "Draft"
BATCH_IN_REVIEW = "In Review"
BATCH_PARTIALLY_SETTLED = "Partially Settled"
BATCH_COMPLETED = "Completed"

# ⚠️ `Completed with exceptions` is GONE (owner ruling). It preserved a signal the three tabs --
# Pending / Settled / Skipped -- now show directly, and it made a batch closed with work
# outstanding indistinguishable from one where the work was genuinely finished only by reading a
# second field. Closing a batch is bookkeeping: it records `closed_at`, and the derived status
# stays honest about how much is actually decided.
BATCH_STATUSES = (BATCH_DRAFT, BATCH_IN_REVIEW, BATCH_PARTIALLY_SETTLED, BATCH_COMPLETED)

SKIP_REASON_NOT_SUCCESSFUL = "Transfer did not succeed at the bank ({status})."
SKIP_REASON_ALREADY_IMPORTED = "Already imported in batch {batch}."
SKIP_REASON_DUPLICATE_IN_FILE = "This transfer appears earlier in the same statement."
SKIP_REASON_ALREADY_PAID = "Already recorded as Paid on {records}."


@dataclass(frozen=True)
class RowOutcome:
    """A derived status plus the sentence that explains it to a reviewer.

    `note` is written for a person, not parsed. It carries the amount delta and its implied rate,
    the record already recorded as Paid, or how many approved candidates were found.
    """

    status: str
    note: str = ""

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_ROW_STATUSES


@dataclass(frozen=True)
class Suggestion:
    """The ONE record a matched row should open with already chosen.

    A pair rather than a whole target, because that is all the screen needs and all the import row
    stores: `(target_doctype, target_name)` addresses any of the three ledgers.
    """

    doctype: str
    name: str


def derive_staged_row_outcome(
    row,
    already_imported_in: str | None = None,
    duplicate_in_file: bool = False,
) -> RowOutcome:
    """The outcome a row gets AT UPLOAD, before any matching has run.

    A separate entry point rather than a mode flag on `derive_row_outcome`, because the two answer
    genuinely different questions. At upload there IS no match, so "did this find a record?" is
    unanswerable -- and `derive_row_outcome` would answer `Mismatched`, which is a FINDING and would
    be a lie about work that has not happened yet. Only the facts knowable without matching are
    decided here; everything else stays `Pending match run`.

    `duplicate_in_file` covers the same transfer id appearing TWICE IN ONE STATEMENT, which is
    different from `already_imported_in` (the same transfer in an EARLIER batch) and has to be
    caught separately because the cross-batch lookup cannot see the file it is currently reading.
    Leaving it uncaught is not cosmetic: both copies would offer the same record, and settling both
    would violate the `Outflow Row Match` unique constraint.

    Skip reasons are shared verbatim with `derive_row_outcome`, so a row skipped at upload and a
    row skipped after matching read identically to a reviewer.
    """
    if already_imported_in:
        return RowOutcome(
            ROW_SKIPPED, SKIP_REASON_ALREADY_IMPORTED.format(batch=already_imported_in)
        )
    if duplicate_in_file:
        return RowOutcome(ROW_SKIPPED, SKIP_REASON_DUPLICATE_IN_FILE)
    if not getattr(row, "is_success", False):
        status_raw = (getattr(row, "status_raw", "") or "unknown").strip() or "unknown"
        return RowOutcome(ROW_SKIPPED, SKIP_REASON_NOT_SUCCESSFUL.format(status=status_raw))
    return RowOutcome(ROW_PENDING_MATCH, "")


def derive_row_outcome(
    row,
    match=None,
    already_imported_in: str | None = None,
    paid_duplicate=None,
) -> RowOutcome:
    """Derive one bank row's outcome from its match result.

    `already_imported_in` names an EARLIER batch that already carries this transfer id, if any.

    `paid_duplicate` is the already-Paid duplicate finding of rule 2 -- a group-shaped object with
    `.targets` and `.total_amount`, or `None`. It comes from a query that is deliberately NOT the
    candidate query. It is a group rather than a single record so that a fan-out (one transfer
    against several payments, 40 real cases covering 99 payments) is still recognised as one
    already-recorded transfer rather than reported as a partial.

    Both are the caller's to supply -- they need the database, and this module does not touch it.
    """
    # 1. Duplicates first. A transfer already handled elsewhere is not re-decided, whatever it
    #    would otherwise match -- offering it again is how the same money gets recorded twice.
    if already_imported_in:
        return RowOutcome(
            ROW_SKIPPED, SKIP_REASON_ALREADY_IMPORTED.format(batch=already_imported_in)
        )

    # 2. Money that never moved. A FAILED transfer still carries a bank reference and would match
    #    perfectly well, so this must come before any matching is considered.
    if not getattr(row, "is_success", False):
        status_raw = (getattr(row, "status_raw", "") or "unknown").strip() or "unknown"
        return RowOutcome(ROW_SKIPPED, SKIP_REASON_NOT_SUCCESSFUL.format(status=status_raw))

    bank_amount = _amount_of(row)

    # 3. Already recorded as Paid by hand (rule 2). Safe to test before the candidate pool because
    #    an already-Paid record is not IN the candidate pool (rule 1) -- the two cannot contend.
    if paid_duplicate is not None and getattr(paid_duplicate, "targets", ()):
        total = _total_of(paid_duplicate)
        if not amounts_match(total, bank_amount):
            # The AMOUNT route to `Mismatched` -- narrow and honest: the bank amount disagrees with
            # what the already-Paid record(s) claim by MORE THAN THE ROUNDING WINDOW. Since the
            # 2026-08-10 merge it is no longer the ONLY route (found-nothing lands here too), which
            # is exactly why `_delta_note` must keep naming the record and the shortfall -- the note
            # is now the only thing telling the two apart.
            #
            # ⚠️ THIS USED TO BE `total != bank_amount`, AND THE EXACTNESS WAS A DEFECT. The bank
            # rounds to the whole rupee and 31.4% of payments carry paise, so every hand-ticked
            # payment with paise on it arrived here as a "discrepancy" -- announced with a note
            # suggesting TDS, for gaps of 14 to 86 paise. The candidate passes had used the window
            # since the tolerance landed; this branch was the one call site that never got it.
            # Restoring the exact test re-breaks 8 rows in every real statement measured so far.
            return RowOutcome(ROW_MISMATCHED, _delta_note(bank_amount, total, paid_duplicate))
        return RowOutcome(
            ROW_SKIPPED,
            SKIP_REASON_ALREADY_PAID.format(records=_name_list(paid_duplicate)),
        )

    candidates = _settleable_candidates(match)
    if not candidates:
        # ⚠️ SAME STATUS AS THE AMOUNT DISAGREEMENT ABOVE, DIFFERENT NOTE (owner ruling 2026-08-10).
        # This used to be its own `Unmatched`. The two are one status now because they are one job
        # -- a transfer that did not line up, needing a person to create or link something -- and
        # the note is where the cause belongs.
        return RowOutcome(ROW_MISMATCHED, _nothing_found_note())

    # 4. At least one APPROVED record at this amount. One candidate is a confident suggestion the
    #    screen pre-selects; several is an ambiguity the screen presents without guessing between
    #    them (owner: the screen never guesses between two real records). Both are `Matched` --
    #    something settleable was found, and a person confirms which. The vocabulary is fixed at
    #    seven statuses and deliberately has no "Ambiguous"; the distinction is a screen concern,
    #    carried in the note rather than in the status.
    return RowOutcome(ROW_MATCHED, _matched_note(candidates, getattr(match, "tier", "")))


def _settleable_candidates(match) -> tuple:
    """Every approved record this row could settle, payments and expenses alike.

    Both ledgers reach the same final step, so both are `Matched`. Payments arrive grouped (one
    transfer may cover several, and the group is what settles together); expenses arrive as
    individual candidates.

    ⚠️ IT READS **EVERY** PAYMENT GROUP. IT USED TO READ ONLY `best_payment_group`, AND THAT WAS THE
    WORST DEFECT THIS FEATURE HAS SHIPPED -- found on the first 1,043-row real statement, 2026-08-10.

    `best_payment_group` is `payment_groups[0]`. Taking only it collapsed N equally-good payment
    candidates into ONE list entry, so `len(candidates)` was 1 and everything downstream believed
    the row was unambiguous:

      * `sole_suggestion` pre-selected the arbitrary first one -- breaking its own owner-locked rule
        that two real records must yield NOTHING, because the screen never guesses between them.
      * `_matched_note` announced "One approved record at this amount: PAY-X" when there were six.
        That sentence is the reviewer's entire basis for ticking a row without opening it.

    Measured on the real statement: a vendor with SIX approved payments of Rs 9,000 and SEVEN
    transfers of Rs 9,000 had all seven rows pre-selected onto the SAME payment. One settled; the
    other six failed with `AlreadyPaidError`, and the vendor's five other approved payments were
    never offered to anybody. Across the batch that was 124 doomed confirmations, and 58 of the 117
    rows still reading "One approved record" genuinely had several.

    The bug was invisible because the ONLY ambiguity the old list could express was payment-vs-
    expense (or expense-vs-expense) -- which is why exactly 5 rows in 1,043 ever read as ambiguous.
    Payment-vs-payment, the common case on the main ledger, could not be represented at all.

    ⚠️ A GROUP IS STILL ONE CANDIDATE. A fan-out -- one transfer covering several payments, found at
    tier 0 by shared reference -- is a single group with several targets, and it counts ONCE here.
    That is correct: the group settles together, so there is nothing for a person to choose between.
    Tiers 1 and 2 are single-target by construction, so N candidates there means N separate records.
    """
    if match is None:
        return ()
    out: list = []
    for group in getattr(match, "payment_groups", ()) or ():
        if getattr(group, "targets", ()):
            out.append(group)
    out.extend(getattr(match, "expense_candidates", ()) or ())
    return tuple(out)


def settleable_candidates(match) -> tuple:
    """The public name for `_settleable_candidates`, for callers outside this module.

    ⚠️ IT IS AN ALIAS, NOT A SECOND IMPLEMENTATION, and that is the entire point of it. The docstring
    above records the worst defect this feature has shipped, and its cause was a second, narrower
    idea of "the candidates" (`best_payment_group`) living beside the real one. Option B's
    disambiguation needs exactly this list -- so it gets exactly this list, rather than a copy that
    could drift from the one `sole_suggestion` and `_matched_note` read.
    """
    return _settleable_candidates(match)


def sole_suggestion(outcome: RowOutcome, match=None) -> Suggestion | None:
    """The one record to pre-select for this row, or `None` to pre-select nothing.

    ⚠️ IT TAKES THE OUTCOME, NOT JUST THE MATCH, AND THE GATE IS THE POINT. `derive_row_outcome`
    short-circuits on a duplicate, a failed transfer and an already-Paid record BEFORE it ever looks
    at candidates -- so a match result can hold perfectly good candidates for a row that was
    correctly Skipped. Deciding from the match alone would pre-select a record on a row nobody may
    settle. Only `Matched` yields a suggestion, and the caller cannot forget the gate because it is
    not the caller's to apply.

    ⚠️ IT READS THE SAME CANDIDATE LIST `_matched_note` COUNTS, on purpose. Before this existed the
    screen re-derived its own pre-selection from `payment_groups` -- ALL of them -- while the note
    counted `best_payment_group` plus expenses, so a row could read "One approved record at this
    amount" and still refuse to pre-select it. One list, one answer.

    ⚠️ EXACTLY ONE, OR NOTHING (owner ruling, re-affirmed 2026-08-06). Two approved records is an
    ambiguity and the screen never guesses between two real records. A FAN-OUT -- one transfer
    settling several payments -- returns `None` for the same reason from the other direction: there
    is no single record to name, and the shape of a `(doctype, name)` pair enforces that rather than
    trusting a caller to notice.
    """
    if outcome.status != ROW_MATCHED:
        return None

    candidates = _settleable_candidates(match)
    if len(candidates) != 1:
        return None

    only = candidates[0]
    targets = getattr(only, "targets", None)
    if targets is not None:
        if len(targets) != 1:
            return None
        return Suggestion(targets[0].doctype, targets[0].name)

    target = getattr(only, "target", None)
    if target is None:
        return None
    return Suggestion(target.doctype, target.name)


# How each tier reads to a reviewer. The tier is the reviewer's whole basis for trusting a
# suggestion -- "the bank account matches" and "the amount agrees and the remark names the project"
# are very different claims, and the person confirming the settlement is entitled to know which one
# they are being shown.
#
# ⚠️ AN UNKNOWN TIER ADDS NOTHING RATHER THAN GUESSING. `derive_row_outcome` reads the tier with
# `getattr`, so a match object that predates tiers (or a future tier nobody taught this map) yields
# an empty clause and the note is exactly what it always was, rather than a wrong explanation.
_TIER_CLAUSE = {
    "reference": "The bank reference is recorded on it.",
    "account+IFSC": "The transfer went to this vendor's bank account, and the amounts agree.",
    "project in remark": "The amounts agree and the remark names its project.",
}


def _matched_note(candidates: Sequence, tier: str = "") -> str:
    because = _TIER_CLAUSE.get(tier, "")
    if len(candidates) == 1:
        only = candidates[0]
        names = _name_list(only)
        targets = getattr(only, "targets", None)
        if targets and len(targets) > 1:
            return _joined(
                f"One transfer settling {len(targets)} approved payments: {names}.", because
            )
        return _joined(f"One approved record at this amount: {names}.", because)
    listed = ", ".join(_name_list(c) for c in candidates[:3])
    more = "" if len(candidates) <= 3 else f" and {len(candidates) - 3} more"
    return _joined(
        f"{len(candidates)} approved records match this amount: {listed}{more}.",
        because,
        "Choose which one this transfer settled.",
    )


def _joined(*sentences: str) -> str:
    return " ".join(s for s in sentences if s)


def _nothing_found_note() -> str:
    """The `Mismatched` note for the FOUND-NOTHING case.

    ⚠️ THIS SENTENCE IS NOW THE ONLY THING SEPARATING THE TWO CAUSES OF `Mismatched`, since the
    status merge took the chip away. It has to say what happened AND what to do about it, because
    the reader has nothing else to go on.
    """
    return (
        "No approved payment or expense matches this transfer. Record a new expense, or link one "
        "by hand."
    )


def several_found_note(count: int) -> str:
    """The `Mismatched` note for the THIRD cause: several records found, none chosen.

    ⚠️ `Mismatched` NOW CARRIES THREE FACTS, AND THE SENTENCES MUST NEVER CONVERGE. The merge that
    folded `Unmatched` in was allowed on the explicit condition that `outcome_note` keeps the causes
    apart, because the status no longer can:

        `_nothing_found_note`  nothing matched at all           -> record or link one
        `_delta_note`          already Paid, amounts disagree    -> a deduction such as TDS
        `several_found_note`   several matched, none chosen      -> pick which one

    ⚠️ THE FAILURE THIS PREVENTS IS SPECIFIC AND EXPENSIVE. Before the sweep that uses it, a row
    that found six approved records sat under `Matched` -- the tab meaning "this transfer has a
    record" -- carrying a note that read as a successful match. Moving it to `Not-Matched` without
    a note of its own would swing it to the opposite lie: "no approved payment or expense matches
    this transfer", said about a transfer that matched six. Both readings send the reviewer to
    create a duplicate expense for money that is already approved and waiting.
    """
    return (
        f"{count} approved records match this transfer and nothing could separate them. "
        f"Open the row and pick which one it settled."
    )


def _delta_note(bank_amount: Decimal, total: Decimal, group) -> str:
    delta = total - bank_amount
    if delta > 0:
        implied = (delta / total * 100) if total else Decimal("0")
        shortfall = (
            f"The bank paid {delta} less than the recorded total of {total} "
            f"({implied:.2f}% of it). A deduction such as TDS would look like this."
        )
    else:
        shortfall = (
            f"The bank paid {-delta} MORE than the recorded total of {total}. "
            f"More money left the account than any matched record claims."
        )
    return f"{shortfall} Already recorded as Paid on {_name_list(group)}."


def _name_list(candidate) -> str:
    """The record name(s) behind a group or a single candidate, as a reviewer would read them."""
    targets = getattr(candidate, "targets", None)
    if targets:
        return ", ".join(t.name for t in targets)
    target = getattr(candidate, "target", None)
    if target is not None:
        return target.name
    return getattr(candidate, "name", "") or "an unnamed record"


def _amount_of(row) -> Decimal:
    return getattr(row, "amount", Decimal("0")) or Decimal("0")


def _total_of(group) -> Decimal:
    total = getattr(group, "total_amount", None)
    if total is not None:
        return total
    return sum((t.amount for t in getattr(group, "targets", ())), Decimal("0"))


def derive_batch_status(row_statuses: Iterable[str]) -> str:
    """Derive a batch's status from its rows' statuses.

    ⚠️ THE `force_closed` PARAMETER IS GONE with `Completed with exceptions` (owner ruling). Closing
    a batch no longer changes what its status SAYS -- it records `closed_at` and nothing more, so a
    batch closed with rows outstanding still reads `Partially Settled`, which is the truth. The
    three tabs show the outstanding work directly, which is what the retired status was standing in
    for.
    """
    statuses = list(row_statuses)
    if not statuses:
        return BATCH_DRAFT

    open_rows = [s for s in statuses if s in OPEN_ROW_STATUSES]
    terminal_rows = [s for s in statuses if s in TERMINAL_ROW_STATUSES]

    if not open_rows:
        return BATCH_COMPLETED
    if terminal_rows:
        return BATCH_PARTIALLY_SETTLED
    return BATCH_IN_REVIEW


# --- did a settlement take the machine's pick? (slice Q1) ----------------------------------------

ORIGIN_ACCEPTED = "Suggestion accepted"
ORIGIN_OVERRIDDEN = "Suggestion overridden"
ORIGIN_NO_SUGGESTION = "No suggestion"


def settlement_origin(suggested_name, settled_name) -> str:
    """Did this settlement take the machine's suggestion? THE one definition.

    ⚠️ PURE, AND SHARED BY THREE CALLERS: the settle path (`api/outflow_import/expenses.py`), the
    summary aggregate, and the backfill patch that recovered 849 historical settlements. A second
    copy of this three-way test is how the history and the future come to disagree about one row.

    ⚠️ 'ACCEPTED', NEVER 'AUTO'. A human clicks confirm on every settlement this feature makes, so
    "the machine's pick was accepted" is true where "automatic" would not be. The distinction is
    the point of the field: it separates *the matcher found this* from *nobody checked it*.

    ⚠️ A BLANK SUGGESTION IS NOT A MISMATCHED ONE. A fan-out has no single suggestion by design
    (`sole_suggestion` abstains) and a row the matcher never touched has none either -- both are
    "the person found it", which is a different fact from "the person disagreed with us".
    Collapsing them would report every hand-found settlement as a disagreement with a machine that
    never spoke.

    ⚠️ IT LIVES HERE RATHER THAN IN `api/`, and it had to. `api/outflow_import/expenses.py` imports
    from `review.py`, so `review.py` importing back from `expenses.py` for the summary's count
    would be a cycle. This module is the deriver both may import -- api -> service is the one legal
    direction -- and the verdict is a derivation, which is what this file is for.
    """
    suggested = (suggested_name or "").strip()
    settled = (settled_name or "").strip()
    if not suggested:
        return ORIGIN_NO_SUGGESTION
    return ORIGIN_ACCEPTED if suggested == settled else ORIGIN_OVERRIDDEN


@dataclass(frozen=True)
class StatusTally:
    """One `row_status` group of an import, ALREADY AGGREGATED BY THE DATABASE.

    ⚠️ THE SHAPE IS THE POINT, AND IT IS WHY THIS IS NOT A LIST OF ROWS. A summary over a whole
    import is a count and a sum over many rows, and ADR-0010 puts those in the database -- one
    `GROUP BY`, not a `get_all` and a Python loop that gets slower every month the feature is used.
    So the endpoint aggregates and this module assembles. The deriver stays pure and unit-testable;
    the query stays a query.

    `with_suggestion` / `suggested_value` count and total the rows in this group carrying the match
    run's single pick. They are only ever non-zero for `Matched`, and they are what separates "the
    matcher was sure" from "the matcher found several and deliberately chose none" -- the split the
    bulk confirm is built on.

    ⚠️ `suggested_value` IS ITS OWN SUM, NOT A SHARE OF `value`. Apportioning the group's total by
    row count would invent a number: three matched rows of Rs 10, Rs 10 and Rs 90,000 where only the
    last is confirmable are not "two thirds of the value". The query sums the subset directly, which
    costs one more `CASE` in a query that was already grouping.

    ⚠️ `failed` SPLITS A GROUP THAT `row_status` CANNOT. A transfer the bank rejected is `Skipped`,
    and so is a duplicate, and so is a payment somebody ticked Paid by hand -- three different facts
    under one status. Only the first is money that NEVER LEFT THE ACCOUNT, and the owner ruled it out
    of every figure this summary reports. The query therefore groups by `(row_status, failed)` and
    hands over two tallies for one status where both kinds exist. This module stays ignorant of the
    bank's vocabulary: `parser.is_success_status` decides, in the query.
    """

    status: str
    count: int
    value: Decimal = Decimal("0")
    with_suggestion: int = 0
    suggested_value: Decimal = Decimal("0")
    failed: bool = False
    #: Settlements in this group that took the matcher's own pick (slice Q1).
    #
    # ⚠️ THIS IS NOT `with_suggestion`, AND THE TWO ANSWER DIFFERENT QUESTIONS. `with_suggestion`
    # counts rows that CARRY a pick and is only ever non-zero on `Matched` -- it describes work
    # waiting to be confirmed. This counts settlements where a person confirmed that pick
    # UNCHANGED, and is only ever non-zero on `Settled`. A row moves from one to the other by being
    # confirmed, so summing them would double-count the same transfer at two moments of its life.
    from_suggestion: int = 0


def derive_import_summary(tallies: Iterable[StatusTally]) -> dict:
    """Everything the summary section reports about ONE import.

    Counts AND money, per status, plus the four derived figures a reviewer actually reads.

    ⚠️ EVERY STATUS IS ZERO-FILLED, on purpose. A screen that renders only the statuses present
    reads as though the missing ones do not apply, when what they mean is "none of these, right
    now" -- and "Mismatched 0" is a genuinely useful thing to see, because it is the one that says
    the import is finished finding work.

    ⚠️ `open_value` IS SUMMED FROM THE OPEN STATUSES, NOT SUBTRACTED FROM THE TOTAL. Subtraction
    would be arithmetically identical while the statuses partition, and would silently go NEGATIVE
    the day one does not -- a legacy v2 value on an old row, say. Summing what is actually open
    cannot lie, and an unrecognised status simply falls out of both sets rather than corrupting one.

    ⚠️ AN UNKNOWN STATUS IS CARRIED, NOT DROPPED. It counts toward the totals and appears in
    `by_status` under its own name. Rows staged under v2 hold retired values, and a summary that
    quietly omitted them would report a total smaller than the import.

    ⚠️ A FAILED TRANSFER IS EXCLUDED FROM EVERY FIGURE HERE (owner ruling 2026-08-10, option B). It
    is money the bank refused to move, so counting it in `total_value` overstates the statement by
    exactly the amount that never left the account -- and counting it in `total_rows` makes
    `decided_percent` a percentage of work that does not exist. It comes back ONLY as
    `failed_rows` / `failed_value`, which the panel renders as a footnote.

    THE ROW IS STILL STAGED, and that is the whole of what option B chose over option A: the
    evidence that the bank rejected a transfer survives on the row, where a reviewer who goes
    looking can find it. What was removed is its effect on the numbers, not its existence.

    ⚠️ THESE TALLIES ARE EXCLUDED BEFORE `by_status` TOO, so `sum(by_status counts) == total_rows`
    still holds. Leaving them in `by_status` while dropping them from the total would make the
    Skipped chip and the Statement total disagree by the failed count -- one visible number
    contradicting another on the same panel, which is worse than either choice made consistently.
    """
    by_status: dict[str, dict] = {
        status: {"count": 0, "value": Decimal("0")} for status in ROW_STATUSES
    }
    confirmable_rows = 0
    confirmable_value = Decimal("0")

    total_rows = 0
    total_value = Decimal("0")

    failed_rows = 0
    failed_value = Decimal("0")
    settled_from_suggestion = 0

    for tally in tallies:
        if tally.failed:
            failed_rows += tally.count
            failed_value += tally.value
            continue
        bucket = by_status.setdefault(
            tally.status, {"count": 0, "value": Decimal("0")}
        )
        bucket["count"] += tally.count
        bucket["value"] += tally.value
        total_rows += tally.count
        total_value += tally.value
        if tally.status == ROW_MATCHED:
            confirmable_rows += tally.with_suggestion
            confirmable_value += tally.suggested_value
        if tally.status == ROW_SETTLED:
            settled_from_suggestion += tally.from_suggestion

    def rows(status: str) -> int:
        return by_status.get(status, {}).get("count", 0)

    def value(status: str) -> Decimal:
        return by_status.get(status, {}).get("value", Decimal("0"))

    open_rows = sum(rows(s) for s in OPEN_ROW_STATUSES)
    open_value = sum((value(s) for s in OPEN_ROW_STATUSES), Decimal("0"))
    decided_rows = sum(rows(s) for s in TERMINAL_ROW_STATUSES)

    return {
        "total_rows": total_rows,
        "total_value": total_value,
        "by_status": by_status,
        "open_rows": open_rows,
        # The number a reviewer is actually asking for: how much of this statement is still
        # unaccounted for. It is the one figure that says whether the import is finished.
        "open_value": open_value,
        "decided_rows": decided_rows,
        "decided_percent": (
            0.0 if total_rows == 0 else round(decided_rows / total_rows * 100, 1)
        ),
        "settled_rows": rows(ROW_SETTLED),
        "settled_value": value(ROW_SETTLED),
        # ⚠️ HOW MANY SETTLEMENTS THE MATCHER ACTUALLY FOUND (slice Q1). Until then nothing on this
        # screen could answer it: `Outflow Row Match.match_basis` was hardcoded to "Manual" on every
        # settlement, so the money record claimed a person had found all 849 when the machine had
        # found 843. The remainder -- `settled_rows - settled_from_suggestion` -- is the hand-found
        # count, and is deliberately NOT reported as its own key: two numbers that must sum to a
        # third are two chances to disagree with it.
        "settled_from_suggestion": settled_from_suggestion,
        "skipped_rows": rows(ROW_SKIPPED),
        "skipped_value": value(ROW_SKIPPED),
        # ⚠️ REPORTED BESIDE THE TOTALS, NOT INSIDE THEM. A failed transfer is excluded from every
        # figure above; these two are the only place it is visible after import, and they are what
        # stops option B from becoming option A by accident. If the panel ever drops this line, a
        # rejected transfer stops being merely out of the way and becomes invisible.
        "failed_rows": failed_rows,
        "failed_value": failed_value,
        "matched_rows": rows(ROW_MATCHED),
        "matched_value": value(ROW_MATCHED),
        # ⚠️ `unmatched_rows` / `unmatched_value` ARE GONE WITH THE STATUS (owner ruling
        # 2026-08-10), and `mismatched_*` ABSORBED THEM. It used to be the rare figure -- a payment
        # hand-ticked Paid that disagrees on amount, 0 on almost every import -- and is now the
        # PRODUCTIVE one, carrying most of a statement's work. Any screen still reading
        # `unmatched_rows` gets `None`, which is the intended loud failure: silently reporting 0
        # transfers needing a person would be far worse.
        "mismatched_rows": rows(ROW_MISMATCHED),
        "mismatched_value": value(ROW_MISMATCHED),
        "pending_rows": rows(ROW_PENDING_MATCH),
        "error_rows": rows(ROW_ERROR),
        # What "Confirm all matched" can actually act on, and what it cannot.
        "confirmable_rows": confirmable_rows,
        "confirmable_value": confirmable_value,
        "ambiguous_rows": max(rows(ROW_MATCHED) - confirmable_rows, 0),
    }


def derive_batch_counters(row_statuses: Sequence[str]) -> dict:
    """The denormalised counters on the batch. Derived here so the list page and the review screen
    can never disagree about how much of a batch is done.

    ⚠️ `reconciled_rows` and `exception_rows` were REMOVED with the statuses they counted (owner
    ruling: remove the dead fields). Every key here still maps to a live field on
    `Outflow Import Batch`; adding one without adding the field would write nothing and report
    nothing, silently.
    """
    statuses = list(row_statuses)
    return {
        "total_rows": len(statuses),
        "reviewed_rows": sum(1 for s in statuses if s != ROW_PENDING_MATCH),
        "settled_rows": sum(1 for s in statuses if s == ROW_SETTLED),
        "skipped_rows": sum(1 for s in statuses if s == ROW_SKIPPED),
        "error_rows": sum(1 for s in statuses if s == ROW_ERROR),
    }
