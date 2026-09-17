# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Can this match record (leg) be undone, and what happens if it is? (issue #1271, parent #1270)

PURE MODULE -- no frappe, no DB, no request context (ADR-0010 B1). A snapshot of facts about ONE
leg goes in; one verdict comes out. The write path (`api/outflow_import/unreconcile.py`) reads the
facts UNDER ITS LOCKS and asks here, so the decision is always made on a picture nobody else can be
changing -- a plan shown on screen earlier is never trusted.

IT KNOWS SIX VERDICTS: `revert_payment`, `revert_expense` (#1277), `delete_created` (#1278),
`unsplit_payment` (#1279), `unlink_expense_line` (#1300) and `refused`. A new one is a new branch HERE, never a check at a call
site. Each carries a `what_happens` sentence (#1275) -- the line the Unreconcile dialog shows beside the record -- so the screen never has to know what a verdict does to its target.

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
nobody sanctioned would be worse than the settle it undoes. The created question is asked LAST: a
record that has been changed since is something a person can act on, the created question is not.

ONE LINE OF A MANY-LINE EXPENSE (#1300, ADR-0027 Q15/Q21) is judged on none of those three facts. Linking
never rewrote the amount or wrote the line's reference, and the expense is only Paid once every line is
in, so each check would refuse every line but one. Only that line comes off; the expense re-derives
from the lines left and keeps its amount and reference. WHICH EXPENSES ARE MANY-LINE is
`_is_many_line_expense`: no stored flag says "this was a 1:1 settle", so it reads what the slips show.

A CREATED RECORD (#1278, ADR-0022 reverses ADR-0016 AR3 "an import-created inflow cannot be undone")
is DELETED. `created_by_import` is the leg's STORED flag (`Outflow Row Match.created_by_import`), set by
every Create path and back-filled for older expense legs (`leg_created_the_record`); unresolved is
"not created", the safe revert path. ⚠️ AN INFLOW LEG IS ALWAYS CREATED, whatever its flag: the import
has no way to reach an inflow except by creating it. A created record is refused instead when anyone
edited it after the match -- a Version dated after `matched_at` that changes any field other than the
statement attachment the import itself writes (`IMPORT_WRITTEN_FIELDS`). ⚠️ NEVER THE `modified`
TIMESTAMP: the post-commit statement `File` link and receipt adoption bump it with no human involved.

WHY EACH REFUSAL EXISTS (moved here from `_guard_leg_is_plainly_reversible`, review F5). Reverting a
payment clears status / `utr` / `payment_date` and NOTHING ELSE, so a leg that carries more than a
status flip must be refused rather than half-undone:

  * EITHER HALF OF A SPLIT THIS IMPORT'S PARTIAL SETTLE DID NOT MAKE (the ones it did: below).
    `settle_row_partial` trims the ORIGINAL to the settled part and mints the balance with
    `split_from` pointing back. The marker on the settled half is therefore a CHILD, not a field on
    itself. Reverting one half would turn one sanction into two Approved payments.
  * AN AMOUNT THAT DIFFERS FROM THE LEG'S -- EXACT, NO TOLERANCE WINDOW (see `amounts.py`'s
    registry). Both figures were written by the same settle, so any difference is a later edit.
  * A STATUS THAT IS NOT PAID, or A REFERENCE that is not one this line's settle may have written
    (`settlement_references_of_row`, #1259). Somebody else has touched the record; refusing leaves
    both halves consistent, guessing does not.

A PART PAYMENT (#1279, ADR-0022 narrows ADR-0020 A3's blanket split refusal) -- a payment whose balance
this leg's OWN partial settle minted -- is UN-SPLIT while that leftover is untouched: the leftover is
deleted, the original gets its amount back and the PO's two terms join into one, then the original
reverts as any payment does. Which split is this settle's, and what "untouched" means, live in the pure
`unsplit.py` beside this module. ⚠️ THE CARRIED-FORWARD BALANCE of such a settle is no longer refused
either: "Unreconcile that transfer first" points at it. Every other balance still is.

⚠️ RULING O, STILL ACCEPTED AND STILL UNDETECTABLE HERE: `settle_row` may have rewritten the
payment's amount to the bank's figure (slice X1). After the fact `leg_amount == target_amount`
either way, so the corrected figure survives a reversal; the write path reports the leg's own
amount so a human can compare it against the payment's Version log.
"""

from dataclasses import dataclass
from datetime import datetime

from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.amounts import AMOUNT_TOLERANCE, to_decimal
from nirmaan_stack.services.outflow_import.ledgers import (
    INFLOW_DOCTYPE,
    INFLOW_DOCTYPES,
    PAYMENT_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
    RECONCILIATION_PENDING,
    VENDOR_REFUND_DOCTYPE,
    is_expense_doctype,
)
from nirmaan_stack.services.outflow_import.normalize import normalize_amount
from nirmaan_stack.services.outflow_import.sources import source_runs_the_matcher
from nirmaan_stack.services.outflow_import.unsplit import (
    CREATED_WINDOW_SECONDS,
    LEFTOVER_PAID_TITLE,
    LEFTOVER_WRITTEN_FIELDS,
    SplitChild,
    is_balance_of_a_part_settle,
    leftover_of_this_settle,
    leftover_refusal,
)

VERDICT_REVERT_PAYMENT = "revert_payment"
VERDICT_REVERT_EXPENSE = "revert_expense"
VERDICT_DELETE_CREATED = "delete_created"
VERDICT_UNSPLIT_PAYMENT = "unsplit_payment"
VERDICT_UNLINK_EXPENSE_LINE = "unlink_expense_line"
VERDICT_REFUSED = "refused"

# Where a refused leg is repaired. `None` on a refusal means there is nothing to repair.
FIX_ON_PAYMENTS_SCREEN = "the Payments screen"
FIX_ON_EXPENSES_SCREEN = "the Expenses screen"

# ⚠️ THE SCREEN SHOWS THIS SENTENCE VERBATIM in the table's Outcome cell (`unreconcileView.ts`,
# parent #1270 story 27), so the server's refusal and the table can never say two different things.
CASHBOOK_REFUSAL = "Cashbook rows can't be unreconciled yet."

# What each verdict does to its target, as the dialog says it. ⚠️ `_revert_payment` in the api layer
# clears exactly these fields; change one and change the other.
#
# ⚠️ ALL THREE SAID "Goes back to Approved" UNTIL #1289. A revert now lands a record back where a
# settle takes it FROM (`unreconcile._REVERT_STATUS`), which is the only way the next bank line can
# settle it without somebody pressing Mark as Done a second time.
WHAT_HAPPENS_REVERT_PAYMENT = (
    "Goes back to Reconciliation Pending. Its UTR and payment date are cleared."
)
# ⚠️ `_revert_expense` clears exactly these. `Non Project Expenses` has no "paid by" field, so its
# sentence does not promise to clear one.
WHAT_HAPPENS_REVERT_PROJECT_EXPENSE = (
    "Goes back to Reconciliation Pending. Payment date, reference and 'paid by' are cleared."
)
WHAT_HAPPENS_REVERT_NON_PROJECT_EXPENSE = (
    "Goes back to Reconciliation Pending. Payment date and reference are cleared."
)
# ⚠️ `api/outflow_import/unreconcile_created.delete_created` deletes the record; the dialog renders it red.
WHAT_HAPPENS_DELETE = "Will be deleted."
# A Project Inflow counts towards the project's cashflow gap the moment it exists (ADR-0016), so its
# deletion moves the CEO Hold picture on the same click -- the dialog says so before the click.
WHAT_HAPPENS_DELETE_PROJECT_INFLOW = (
    "Will be deleted. The project's cash position updates straight away."
)

# ⚠️ THE LEAD-IN ONLY. The dialog renders it amber and lists the three consequences under it from the
# verdict's `leftover` / `leftover_amount` / `restored_amount` / `joins_terms` (`unreconcileView.ts`),
# because they carry figures the screen formats as rupees.
WHAT_HAPPENS_UNSPLIT = "The split is undone:"

#: The fields a created record's settle writes after it exists -- the statement attachment
#: (`settle._STATEMENT_ATTACHMENT_FIELDS`, spelled here because this module may not import settle).
#: A Version touching only these is the import's own, never a person's edit. Pinned against the
#: resolver by `api/outflow_import/test_unreconcile_created.py`.
IMPORT_WRITTEN_FIELDS = frozenset({"payment_attachment", "inflow_attachment", "refund_attachment"})

# `CREATED_WINDOW_SECONDS` (the back-fill's window) lives in `unsplit.py`, shared with the split questions.

_PAID = "Paid"

__all__ = [
    "CASHBOOK_REFUSAL",
    "CREATED_WINDOW_SECONDS",
    "FIX_ON_EXPENSES_SCREEN",
    "FIX_ON_PAYMENTS_SCREEN",
    "IMPORT_WRITTEN_FIELDS",
    "LEFTOVER_PAID_TITLE",
    "LEFTOVER_WRITTEN_FIELDS",
    "WHAT_HAPPENS_DELETE",
    "WHAT_HAPPENS_DELETE_PROJECT_INFLOW",
    "WHAT_HAPPENS_REVERT_NON_PROJECT_EXPENSE",
    "WHAT_HAPPENS_REVERT_PAYMENT",
    "WHAT_HAPPENS_REVERT_PROJECT_EXPENSE",
    "WHAT_HAPPENS_UNSPLIT",
    "VERDICT_DELETE_CREATED",
    "VERDICT_REFUSED",
    "VERDICT_REVERT_EXPENSE",
    "VERDICT_REVERT_PAYMENT",
    "VERDICT_UNLINK_EXPENSE_LINE",
    "VERDICT_UNSPLIT_PAYMENT",
    "WHOLE_LINE_ONLY_REFUSAL",
    "WHOLE_LINE_ONLY_TITLE",
    "ExpenseSlip",
    "LegFacts",
    "LegVerdict",
    "SplitChild",
    "first_refusal",
    "leg_created_the_record",
    "leg_verdict",
    "reverse_all_only",
]

#: The refusal when a request reverses only SOME of a vendor refund line's records.
WHOLE_LINE_ONLY_TITLE = "Reverse all"
WHOLE_LINE_ONLY_REFUSAL = (
    "A vendor refund transfer is undone whole: Reverse all deletes every vendor refund on it. "
    "Nothing was reversed."
)


@dataclass(frozen=True)
class ExpenseSlip:
    """ANOTHER slip on the same expense (#1300): its amount, whether it is live, and when it was undone."""

    amount: object
    live: bool
    reversed_at: datetime | None = None


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
    # The payment's OWN `split_from`: set when it is the carried-forward balance of a split.
    split_from: str | None = None
    # PAYMENTS ONLY (#1279): every payment whose `split_from` is this one (`unsplit.SplitChild`). The
    # settled half of a split carries its marker on a CHILD, not on itself.
    split_children: tuple = ()
    # PAYMENTS ONLY (#1279), for a balance half: when the payment was created, and when each Settled leg
    # on its `split_from` parent was matched.
    target_created: datetime | None = None
    parent_settled_at: tuple = ()
    # Every value a settle of this leg's import line may have written as the reference.
    settlement_references: tuple = ()
    # The IMPORT's source (`Outflow Import Batch.source`), not the row's denormalised copy.
    source: str | None = None
    # The leg's stored flag: its settle created the record (#1278). Ignored for an inflow, which is
    # always created.
    created_by_import: bool = False
    # When the leg was written; an edit is only an edit when it is dated after this.
    matched_at: datetime | None = None
    # CREATED RECORDS ONLY: `(when, fieldnames)` per Version row of the record, any order. Fieldnames
    # cover `changed` fields and the table fields of added / removed / changed child rows.
    versions: tuple = ()
    # EXPENSES ONLY (#1300): every OTHER slip on the expense (`ExpenseSlip`), live or Reversed.
    other_slips: tuple = ()


@dataclass(frozen=True)
class LegVerdict:
    leg: str
    verdict: str
    reason: str | None = None
    title: str | None = None
    fix_at: str | None = None
    # The dialog's one-line "what happens" sentence. `None` on a refusal, which says `reason` instead.
    what_happens: str | None = None
    # `unsplit_payment` ONLY: the leftover deleted, its amount, the original's amount after, and
    # whether the PO's two terms join back into one.
    leftover: str | None = None
    leftover_amount: object = None
    restored_amount: object = None
    joins_terms: bool = False
    # `unlink_expense_line` ONLY: what stays linked, across how many other lines, the expense's amount,
    # and whether what stays still makes it Paid.
    stays_linked: object = None
    other_lines: int = 0
    expense_amount: object = None
    stays_paid: bool = False


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
    if facts.target_doctype in INFLOW_DOCTYPES:
        if not facts.target_exists:
            return _refused(facts, "Not found", f"{facts.target_doctype} '{name}' not found.")
        return _created_verdict(facts)
    if facts.target_doctype != PAYMENT_DOCTYPE:
        return _refused(
            facts,
            "Can't be undone yet",
            f"A {facts.target_doctype} record can't be unreconciled here yet.",
        )
    if not facts.target_exists:
        return _refused(facts, "Not found", f"Payment '{name}' not found.")

    if (facts.split_from or "").strip() and not is_balance_of_a_part_settle(
        facts.target_created, facts.parent_settled_at
    ):
        return _refused(
            facts,
            "Part of a split payment",
            f"{name} is the carried-forward balance of a payment that was split, so "
            f"reversing it here would leave that split half-undone. Correct it on the payments "
            f"screen, where both halves are visible.",
            FIX_ON_PAYMENTS_SCREEN,
        )
    leftover = leftover_of_this_settle(facts.matched_at, facts.split_children)
    if leftover is not None:
        refusal = leftover_refusal(leftover)
        if refusal is not None:
            return _refused(facts, *refusal)
    else:
        other = next((c.name for c in facts.split_children), None)
        if other:
            return _refused(
                facts,
                "Split by a partial settlement",
                f"{name} was settled by a PARTIAL settlement, which split the record and "
                f"left {other} standing as its unpaid balance. Reversing only the "
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

    if leftover is not None:
        return LegVerdict(
            leg=facts.leg,
            verdict=VERDICT_UNSPLIT_PAYMENT,
            what_happens=WHAT_HAPPENS_UNSPLIT,
            leftover=leftover.name,
            leftover_amount=normalize_amount(leftover.amount),
            restored_amount=normalize_amount(facts.target_amount) + normalize_amount(leftover.amount),
            joins_terms=leftover.has_term,
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
    if _is_many_line_expense(facts):
        return _unlink_line_verdict(facts)
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
    if facts.created_by_import:
        return _created_verdict(facts)
    return LegVerdict(
        leg=facts.leg,
        verdict=VERDICT_REVERT_EXPENSE,
        what_happens=(
            WHAT_HAPPENS_REVERT_PROJECT_EXPENSE
            if facts.target_doctype == PROJECT_EXPENSE_DOCTYPE
            else WHAT_HAPPENS_REVERT_NON_PROJECT_EXPENSE
        ),
    )


def _is_many_line_expense(facts: LegFacts) -> bool:
    """Whether this leg is one line of a many-line expense, rather than a 1:1 settle (#1300).

    TWO SHAPES, because nothing stored says which kind of settle wrote the leg:

      * ANOTHER SLIP SHARED THE EXPENSE WITH THIS ONE -- still live, or undone AFTER this leg was
        matched. A slip undone BEFORE it is a 1:1 settle that was reversed and settled again, which
        keeps today's exact checks.
      * THE ONE LINE ONLY PART-FILLS IT: the expense is Reconciliation Pending and the leg is short of
        its amount by more than ₹5. A 1:1 settle only happens when the line fills the expense, and
        leaves it Paid.

    ⚠️ EVERY DOUBT IS 1:1. An unknown match or reversal time is not sharing: 1:1 keeps the checks, and a
    wrong refusal is repaired by hand where a wrong revert is not.
    """
    for slip in facts.other_slips:
        if slip.live:
            return True
        if slip.reversed_at and facts.matched_at and slip.reversed_at > facts.matched_at:
            return True
    short = to_decimal(facts.target_amount) - to_decimal(facts.leg_amount) > AMOUNT_TOLERANCE
    # ⚠️ THE STATUS COMES FROM `ledgers`, never a local copy: three modules once held private ones and
    # they agreed right up to the day the map moved.
    return (facts.target_status or "").strip() == RECONCILIATION_PENDING and short


def _unlink_line_verdict(facts: LegFacts) -> LegVerdict:
    """Only this line comes off a many-line expense (#1300). No "changed elsewhere" check (Q21).

    ⚠️ A CREATED EXPENSE IS NOT DELETED HERE: other lines still settle it. `stays_paid` is the same ₹5
    reading `expense_links.derive_expense_status` makes, which the write re-derives from the slips.
    """
    live = [slip for slip in facts.other_slips if slip.live]
    stays_linked = sum((to_decimal(slip.amount) for slip in live), to_decimal(0))
    expense_amount = to_decimal(facts.target_amount)
    stays_paid = expense_amount - stays_linked <= AMOUNT_TOLERANCE
    after = "stays Paid" if stays_paid else "goes back to Reconciliation Pending"
    return LegVerdict(
        leg=facts.leg,
        verdict=VERDICT_UNLINK_EXPENSE_LINE,
        what_happens=f"Only this line comes off. {facts.target_name} {after}.",
        stays_linked=stays_linked,
        other_lines=len(live),
        expense_amount=expense_amount,
        stays_paid=stays_paid,
    )


def _created_verdict(facts: LegFacts) -> LegVerdict:
    """A record this line's settle created: deleted, unless someone edited it after the match (#1278).

    No `fix_at`: the sentence already says where -- the record's own screen, whichever it is.
    """
    edited_on = _first_edit_after_match(facts)
    if edited_on is not None:
        return _refused(
            facts,
            "Edited since",
            f"Someone edited it on {edited_on.strftime('%d-%b-%Y')}, after the import made it. "
            f"Delete or fix it on its own screen.",
        )
    return LegVerdict(
        leg=facts.leg,
        verdict=VERDICT_DELETE_CREATED,
        what_happens=(
            WHAT_HAPPENS_DELETE_PROJECT_INFLOW
            if facts.target_doctype == INFLOW_DOCTYPE
            else WHAT_HAPPENS_DELETE
        ),
    )


def _first_edit_after_match(facts: LegFacts) -> datetime | None:
    """When the earliest human edit after the match was made, or `None`.

    ⚠️ AN UNKNOWN MATCH TIME COUNTS EVERY EDIT. Deleting is the one verdict that cannot be put back;
    placing an edit "before" a time nobody recorded would destroy someone's work on a guess.
    """
    edits = sorted(
        when
        for when, fields in facts.versions
        if (facts.matched_at is None or when > facts.matched_at)
        and any(field not in IMPORT_WRITTEN_FIELDS for field in fields)
    )
    return edits[0] if edits else None


def leg_created_the_record(
    *,
    seconds_from_creation_to_match,
    same_user: bool,
    created_before_import: bool,
    status_changes_before_match,
) -> bool:
    """Whether an EXISTING expense leg's settle created its record -- the back-fill rule (#1278).

    `True` only when every fact says so: the expense was written within `CREATED_WINDOW_SECONDS`
    BEFORE its leg, by the leg's own user, it is not older than the statement upload, and no Version
    dated no later than the match shows a status that was ever not Paid (a created expense is inserted
    already Paid, and an insert writes no Version). ⚠️ EVERY DOUBT IS `False`: unresolved is "not
    created", which reverts to Approved -- a slower mistake to make than a deletion.
    """
    if seconds_from_creation_to_match is None:
        return False
    if not 0 <= seconds_from_creation_to_match <= CREATED_WINDOW_SECONDS:
        return False
    if not same_user or created_before_import:
        return False
    return all((old or "").strip() == _PAID for old, _new in status_changes_before_match)


def reverse_all_only(live_legs) -> bool:
    """Whether a line may only be undone WHOLE -- it carries a vendor refund (owner, 2026-09-17).

    ⚠️ A PART-REVERSED VENDOR REFUND LINE IS A DEAD END. Its other refunds stay, so the line reads
    Partially Allocated -- and `create_vendor_refund` refuses a partially allocated line, while the
    refunds still on it count as already recorded. Nothing could complete it; the only way forward was
    to reverse the rest. So undoing one vendor refund undoes (deletes) all of them, in one go.

    `live_legs` are the line's Settled legs, as mappings with `target_doctype`.
    """
    return any(leg.get("target_doctype") == VENDOR_REFUND_DOCTYPE for leg in live_legs)


def first_refusal(verdicts) -> LegVerdict | None:
    """The first refused verdict in the order given, or `None`. All-or-nothing turns on this: one
    refused leg means no leg is written."""
    return next((v for v in verdicts if v.verdict == VERDICT_REFUSED), None)
