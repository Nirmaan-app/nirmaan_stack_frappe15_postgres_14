# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Can this match record (leg) be undone, and what happens if it is? (issue #1271, parent #1270)

PURE MODULE -- no frappe, no DB, no request context (ADR-0010 B1). A snapshot of facts about ONE
leg goes in; one verdict comes out. The write path (`api/outflow_import/unreconcile.py`) reads the
facts UNDER ITS LOCKS and asks here, so the decision is always made on a picture nobody else can be
changing -- a plan shown on screen earlier is never trusted.

TODAY IT KNOWS THREE VERDICTS: `revert_payment`, `revert_expense` (#1277) and `refused`. The parent
spec adds `delete_created` and `unsplit_payment` in later slices; each is a new branch HERE, never a
check at a call site. Each carries a `what_happens` sentence (#1275) -- the line the Unreconcile
dialog shows beside the record -- so the screen never has to know what a verdict does to its target.

⚠️ EVERY PAYMENT REFUSAL SENTENCE IS THE ONE `expenses.reverse_allocation` PRINTED BEFORE THIS MODULE
EXISTED, BYTE FOR BYTE, AND IN THE SAME ORDER. A leg can be wrong in several ways at once and the
sentence names only the first, so reordering the checks changes what a reviewer is told. Both are
pinned by `test_unreconcile.py`. The refusals added since: CASHBOOK (#1275), asked FIRST because it is
a fact about the whole line, so every leg of a Cashbook line reads the same sentence; and, at #1277,
the old "Only a Project Payments allocation can be reversed here" became "can't be unreconciled here
yet" for the ledgers still to come (inflows), because expenses now revert.

AN EXPENSE (#1277, ADR-0022 reverses ADR-0020 B2 "reverse is payments only") is judged on the same
three "changed elsewhere" facts as a payment -- amount, status, reference -- with its own sentences
(it has no TDS and no split, so those refusals never apply). THEN ONE MORE QUESTION: did this import
CREATE it? A created expense must be deleted, not put back to Approved -- an Approved record for money
nobody sanctioned would be worse than the settle it undoes -- and deleting is a later slice. Until a
stored flag exists, `created_by_import` is `False` only on PROOF (`expense_created_by_import`);
anything else is refused as "can't be undone yet". The created question is asked LAST: a record that
has been changed since is something a person can act on, the created question is not.

WHY EACH REFUSAL EXISTS (moved here from `_guard_leg_is_plainly_reversible`, review F5). Reverting a
payment clears status / `utr` / `payment_date` and NOTHING ELSE, so a leg that carries more than a
status flip must be refused rather than half-undone:

  * A `tds` FIGURE on the payment. Put back to Approved, it would leave withheld tax on money that
    is waiting to be paid again.
  * EITHER HALF OF A SPLIT. `settle_row_partial` trims the ORIGINAL to the settled part and mints
    the balance with `split_from` pointing back. The marker on the settled half is therefore a
    CHILD (`split_balance`), not a field on itself. Reverting one half would turn one sanction into
    two Approved payments.
  * AN AMOUNT THAT DIFFERS FROM THE LEG'S -- EXACT, NO TOLERANCE WINDOW (see `amounts.py`'s
    registry). Both figures were written by the same settle, so any difference is a later edit.
  * A STATUS THAT IS NOT PAID, or A REFERENCE that is not one this line's settle may have written
    (`settlement_references_of_row`, #1259). Somebody else has touched the record; refusing leaves
    both halves consistent, guessing does not.

⚠️ RULING O, STILL ACCEPTED AND STILL UNDETECTABLE HERE: `settle_row` may have rewritten the
payment's amount to the bank's figure (slice X1). After the fact `leg_amount == target_amount`
either way, so the corrected figure survives a reversal; the write path reports the leg's own
amount so a human can compare it against the payment's Version log.
"""

from dataclasses import dataclass

from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.ledgers import (
    PAYMENT_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
    is_expense_doctype,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.sources import source_runs_the_matcher

VERDICT_REVERT_PAYMENT = "revert_payment"
VERDICT_REVERT_EXPENSE = "revert_expense"
VERDICT_REFUSED = "refused"

# Where a refused leg is repaired. `None` on a refusal means there is nothing to repair.
FIX_ON_PAYMENTS_SCREEN = "the Payments screen"
FIX_ON_EXPENSES_SCREEN = "the Expenses screen"

# ⚠️ THE SCREEN SHOWS THIS SENTENCE VERBATIM in the table's Outcome cell (`unreconcileView.ts`,
# parent #1270 story 27), so the server's refusal and the table can never say two different things.
CASHBOOK_REFUSAL = "Cashbook rows can't be unreconciled yet."

# What each verdict does to its target, as the dialog says it. ⚠️ `_revert_payment` in the api layer
# clears exactly these fields; change one and change the other.
WHAT_HAPPENS_REVERT_PAYMENT = "Goes back to Approved. Its UTR and payment date are cleared."
# ⚠️ `_revert_expense` clears exactly these. `Non Project Expenses` has no "paid by" field, so its
# sentence does not promise to clear one.
WHAT_HAPPENS_REVERT_PROJECT_EXPENSE = (
    "Goes back to Approved. Payment date, reference and 'paid by' are cleared."
)
WHAT_HAPPENS_REVERT_NON_PROJECT_EXPENSE = (
    "Goes back to Approved. Payment date and reference are cleared."
)

_PAID = "Paid"

__all__ = [
    "CASHBOOK_REFUSAL",
    "FIX_ON_EXPENSES_SCREEN",
    "FIX_ON_PAYMENTS_SCREEN",
    "WHAT_HAPPENS_REVERT_NON_PROJECT_EXPENSE",
    "WHAT_HAPPENS_REVERT_PAYMENT",
    "WHAT_HAPPENS_REVERT_PROJECT_EXPENSE",
    "VERDICT_REFUSED",
    "VERDICT_REVERT_EXPENSE",
    "VERDICT_REVERT_PAYMENT",
    "LegFacts",
    "LegVerdict",
    "expense_created_by_import",
    "first_refusal",
    "leg_verdict",
]


@dataclass(frozen=True)
class LegFacts:
    """Everything the decision reads about one leg. Raw values: formatting is part of the verdict.

    `target_*` describe the record the leg settled. For a leg whose target is not a payment the
    payment fields are ignored and may be left at their defaults.
    """

    leg: str
    match_kind: str
    target_doctype: str
    target_name: str
    leg_amount: object
    target_exists: bool = False
    target_status: str | None = None
    target_amount: object = None
    target_reference: str | None = None
    tds: object = None
    # The payment's OWN `split_from`: set when it is the carried-forward balance of a split.
    split_from: str | None = None
    # The name of a payment whose `split_from` is THIS one: set when this is the settled half.
    split_balance: str | None = None
    # Every value a settle of this leg's import line may have written as the reference.
    settlement_references: tuple = ()
    # The IMPORT's source (`Outflow Import Batch.source`), not the row's denormalised copy.
    source: str | None = None
    # EXPENSES ONLY: whether this line's settle created the record. `None` is "not proven either
    # way", which is refused -- see `expense_created_by_import` for what counts as proof.
    created_by_import: bool | None = None


@dataclass(frozen=True)
class LegVerdict:
    leg: str
    verdict: str
    reason: str | None = None
    title: str | None = None
    fix_at: str | None = None
    # The dialog's one-line "what happens" sentence. `None` on a refusal, which says `reason` instead.
    what_happens: str | None = None


def _refused(facts: LegFacts, title: str, reason: str, fix_at: str | None = None) -> LegVerdict:
    return LegVerdict(
        leg=facts.leg, verdict=VERDICT_REFUSED, reason=reason, title=title, fix_at=fix_at
    )


def leg_verdict(facts: LegFacts) -> LegVerdict:
    """The one verdict for one leg. See the module docstring for why each refusal exists."""
    name = facts.target_name

    # Cashbook is the one source the matcher never runs over, and the one Unreconcile does not reach
    # yet (#1270 Q13). The same predicate Skip and Unskip refuse it with.
    if not source_runs_the_matcher((facts.source or "").strip()):
        return _refused(facts, "Cashbook line", CASHBOOK_REFUSAL)
    if facts.match_kind != MATCH_SETTLED:
        return _refused(
            facts,
            "Already reversed",
            "This allocation was already reversed. A correction supersedes rather than un-happens.",
        )
    if is_expense_doctype(facts.target_doctype):
        return _expense_verdict(facts)
    if facts.target_doctype != PAYMENT_DOCTYPE:
        return _refused(
            facts,
            "Can't be undone yet",
            f"A {facts.target_doctype} record can't be unreconciled here yet.",
        )
    if not facts.target_exists:
        return _refused(facts, "Not found", f"Payment '{name}' not found.")

    if normalize_amount(facts.tds):
        return _refused(
            facts,
            "Settled with TDS",
            f"{name} carries a TDS figure -- withheld tax that "
            f"this reversal does not clear -- putting it back to Approved would leave a tax figure "
            f"on a payment that is waiting to be paid again. Reverse it on the payments screen, "
            f"where both the status and the TDS can be corrected together.",
            FIX_ON_PAYMENTS_SCREEN,
        )
    if (facts.split_from or "").strip():
        return _refused(
            facts,
            "Part of a split payment",
            f"{name} is the carried-forward balance of a payment that was split, so "
            f"reversing it here would leave that split half-undone. Correct it on the payments "
            f"screen, where both halves are visible.",
            FIX_ON_PAYMENTS_SCREEN,
        )
    if facts.split_balance:
        return _refused(
            facts,
            "Split by a partial settlement",
            f"{name} was settled by a PARTIAL settlement, which split the record and "
            f"left {facts.split_balance} standing as its Approved balance. Reversing only the "
            f"settled half would turn one sanction into two. Undo the split on the payments "
            f"screen instead.",
            FIX_ON_PAYMENTS_SCREEN,
        )
    if normalize_amount(facts.leg_amount) != normalize_amount(facts.target_amount):
        return _refused(
            facts,
            "Changed elsewhere",
            f"{name} now reads {facts.target_amount}, but this allocation wrote "
            f"{facts.leg_amount} against it. Somebody has changed the record since, so this "
            f"reversal cannot know what to put back. Correct the payment by hand.",
            FIX_ON_PAYMENTS_SCREEN,
        )
    if (facts.target_status or "").strip() != _PAID:
        return _refused(
            facts,
            "Changed elsewhere",
            f"{name} is '{facts.target_status}', not Paid. Somebody has already changed it.",
            FIX_ON_PAYMENTS_SCREEN,
        )
    stored = (facts.target_reference or "").strip()
    if stored and stored not in {(r or "").strip() for r in facts.settlement_references}:
        return _refused(
            facts,
            "Changed elsewhere",
            f"{name} carries reference '{stored}', not this transfer's. Somebody has re-pointed "
            f"it, so this allocation cannot be safely reversed.",
            FIX_ON_PAYMENTS_SCREEN,
        )

    return LegVerdict(
        leg=facts.leg,
        verdict=VERDICT_REVERT_PAYMENT,
        what_happens=WHAT_HAPPENS_REVERT_PAYMENT,
    )


def _expense_verdict(facts: LegFacts) -> LegVerdict:
    """A Settled leg on a `Project Expenses` / `Non Project Expenses` record (#1277).

    ⚠️ `_revert_expense` in the api layer clears status / `payment_date` / `payment_ref` / (Project
    Expenses) `payment_by` and nothing else; the amount is not restored (Ruling O, as for payments --
    a settle may have rewritten it to the bank's figure).
    """
    name = facts.target_name
    if not facts.target_exists:
        return _refused(facts, "Not found", f"Expense '{name}' not found.")
    if normalize_amount(facts.leg_amount) != normalize_amount(facts.target_amount):
        return _refused(
            facts,
            "Changed elsewhere",
            f"{name} now reads {facts.target_amount}, but this allocation wrote "
            f"{facts.leg_amount} against it. Somebody has changed the record since, so this "
            f"reversal cannot know what to put back. Correct the expense by hand.",
            FIX_ON_EXPENSES_SCREEN,
        )
    if (facts.target_status or "").strip() != _PAID:
        return _refused(
            facts,
            "Changed elsewhere",
            f"{name} is '{facts.target_status}', not Paid. Somebody has already changed it.",
            FIX_ON_EXPENSES_SCREEN,
        )
    stored = (facts.target_reference or "").strip()
    if stored and stored not in {(r or "").strip() for r in facts.settlement_references}:
        return _refused(
            facts,
            "Changed elsewhere",
            f"{name} carries reference '{stored}', not this transfer's. Somebody has re-pointed "
            f"it, so this allocation cannot be safely reversed.",
            FIX_ON_EXPENSES_SCREEN,
        )
    # `is not False`, never `not ...`: `None` (unproven) must be refused exactly like `True` (which the
    # stored created flag of a later #1270 slice will set). No `fix_at`: nothing on any screen fixes it.
    if facts.created_by_import is not False:
        return _refused(
            facts,
            "Can't be undone yet",
            f"{name} may have been recorded by this import, and a record the import created can't "
            f"be undone yet.",
        )
    return LegVerdict(
        leg=facts.leg,
        verdict=VERDICT_REVERT_EXPENSE,
        what_happens=(
            WHAT_HAPPENS_REVERT_PROJECT_EXPENSE
            if facts.target_doctype == PROJECT_EXPENSE_DOCTYPE
            else WHAT_HAPPENS_REVERT_NON_PROJECT_EXPENSE
        ),
    )


def expense_created_by_import(
    *, created_before_import: bool, status_changes_before_match
) -> bool | None:
    """`False` when it is PROVEN this import did not create the expense; otherwise `None` (#1277).

    Until `Outflow Row Match` carries a stored created flag (a later slice of #1270), this is the only
    answer. `create_expense_from_row` INSERTS the record already Paid, and an insert writes no Version
    row, so two facts are impossible for a record the import created:

      * `created_before_import` -- the record is older than the statement upload (the import batch).
      * a status that was ever not Paid in `status_changes_before_match` -- the `(old, new)` status
        changes from the record's Version rows dated no later than the leg's match. A settle of an
        existing record writes `Approved -> Paid` there; a created one has no row at all.

    ⚠️ NEVER `True`. Nothing here can prove the import DID create it, and a guess in either direction
    is a wrong write: `None` is refused, which is the safe answer. An existing expense settled before
    the settle went through `doc.save()` (slice X1) has no Version and, if it is younger than the
    upload, stays refused -- accepted until the stored flag arrives.
    """
    if created_before_import:
        return False
    if any((old or "").strip() != _PAID for old, _new in status_changes_before_match):
        return False
    return None


def first_refusal(verdicts) -> LegVerdict | None:
    """The first refused verdict in the order given, or `None`. All-or-nothing turns on this: one
    refused leg means no leg is written."""
    return next((v for v in verdicts if v.verdict == VERDICT_REFUSED), None)
