# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Can this match record (leg) be undone, and what happens if it is? (issue #1271, parent #1270)

PURE MODULE -- no frappe, no DB, no request context (ADR-0010 B1). A snapshot of facts about ONE
leg goes in; one verdict comes out. The write path (`api/outflow_import/unreconcile.py`) reads the
facts UNDER ITS LOCKS and asks here, so the decision is always made on a picture nobody else can be
changing -- a plan shown on screen earlier is never trusted.

TODAY IT KNOWS TWO VERDICTS: `revert_payment` and `refused`. The parent spec adds `revert_expense`,
`delete_created` and `unsplit_payment` in later slices; each is a new branch HERE, never a check at
a call site. Each carries a `what_happens` sentence (#1275) -- the line the Unreconcile dialog shows
beside the record -- so the screen never has to know what a verdict does to its target.

⚠️ EVERY REFUSAL SENTENCE IS THE ONE `expenses.reverse_allocation` PRINTED BEFORE THIS MODULE
EXISTED, BYTE FOR BYTE, AND IN THE SAME ORDER. A leg can be wrong in several ways at once and the
sentence names only the first, so reordering the checks changes what a reviewer is told. Both are
pinned by `test_unreconcile.py`. The one refusal added since, CASHBOOK (#1275), is asked FIRST: it
is a fact about the whole line, so every leg of a Cashbook line reads the same sentence.

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
from nirmaan_stack.services.outflow_import.ledgers import PAYMENT_DOCTYPE
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.sources import source_runs_the_matcher

VERDICT_REVERT_PAYMENT = "revert_payment"
VERDICT_REFUSED = "refused"

# Where a refused leg is repaired. `None` on a refusal means there is nothing to repair.
FIX_ON_PAYMENTS_SCREEN = "the Payments screen"

# ⚠️ THE SCREEN SHOWS THIS SENTENCE VERBATIM in the table's Outcome cell (`unreconcileView.ts`,
# parent #1270 story 27), so the server's refusal and the table can never say two different things.
CASHBOOK_REFUSAL = "Cashbook rows can't be unreconciled yet."

# What each verdict does to its target, as the dialog says it. ⚠️ `_revert_payment` in the api layer
# clears exactly these fields; change one and change the other.
WHAT_HAPPENS_REVERT_PAYMENT = "Goes back to Approved. Its UTR and payment date are cleared."

_PAID = "Paid"

__all__ = [
    "CASHBOOK_REFUSAL",
    "FIX_ON_PAYMENTS_SCREEN",
    "WHAT_HAPPENS_REVERT_PAYMENT",
    "VERDICT_REFUSED",
    "VERDICT_REVERT_PAYMENT",
    "LegFacts",
    "LegVerdict",
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
    if facts.target_doctype != PAYMENT_DOCTYPE:
        return _refused(
            facts, "Not a payment", f"Only a {PAYMENT_DOCTYPE} allocation can be reversed here."
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


def first_refusal(verdicts) -> LegVerdict | None:
    """The first refused verdict in the order given, or `None`. All-or-nothing turns on this: one
    refused leg means no leg is written."""
    return next((v for v in verdicts if v.verdict == VERDICT_REFUSED), None)
