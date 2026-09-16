# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The reads and the write an Unreconcile needs for a PART PAYMENT (#1279).

`unreconcile.unreconcile_row` asks the pure decision module whether a payment split by its leg's partial
settle may be un-split; this module reads the split's facts for that question (`split_children_of`,
`settled_at_of`) and, on an `unsplit_payment` verdict, joins the leftover back (`join_leftover_back`).
Reverting the original to Approved stays with the caller, beside every other payment revert. Nothing here
commits.
"""

import frappe

from nirmaan_stack.api.outflow_import.review import MATCH_DOCTYPE
from nirmaan_stack.api.outflow_import.unreconcile_created import (
    edits_of,
    restore_series_counters,
    series_counters_for,
)
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED
from nirmaan_stack.services.outflow_import.ledgers import (
    PAYMENT_DOCTYPE,
    settleable_statuses,
)
from nirmaan_stack.services.outflow_import.settle import _outflow_import_write
from nirmaan_stack.services.outflow_import.unreconcile import (
    VERDICT_UNSPLIT_PAYMENT,
    LegFacts,
    LegVerdict,
)
from nirmaan_stack.services.outflow_import.unsplit import SplitChild
from nirmaan_stack.services.payment_split import unsplit_payment

PO_DOCTYPE = "Procurement Orders"
TDS_DEDUCTION_DOCTYPE = "Payment TDS Deduction"

#: The status `expenses.settle_row_partial` leaves a part-settle's balance at, read from the ONE map
#: rather than spelled here (#1289) -- see the call to `unsplit_payment` below.
_SETTLEABLE_STATUS = settleable_statuses(PAYMENT_DOCTYPE)[0]


def read_payment_facts(leg, base: dict, *, for_update: bool) -> LegFacts:
    """The facts about one payment leg -- its own, and its split's (#1279). `base` is what every leg
    carries (`unreconcile._read_facts`)."""
    payment = frappe.db.get_value(
        PAYMENT_DOCTYPE,
        leg.target_name,
        ["status", "utr", "amount", "tds", "split_from", "creation"],
        as_dict=True,
        for_update=for_update,
    )
    if not payment:
        return LegFacts(**base, target_exists=False)
    return LegFacts(
        **base,
        target_exists=True,
        target_status=payment.status,
        target_amount=payment.amount,
        target_reference=payment.utr,
        tds=payment.tds,
        split_from=payment.split_from,
        split_children=split_children_of(leg.target_name, for_update=for_update),
        target_created=payment.creation,
        parent_settled_at=settled_at_of(payment.split_from) if payment.split_from else (),
    )


def split_children_of(name: str, *, for_update: bool) -> tuple:
    """One `SplitChild` per payment whose `split_from` is `name`, oldest first.

    With `for_update` (the write) the children are locked in name order, after the parent the caller has
    already locked. `unsplit_payment` locks the pair again later in the same transaction, which
    PostgreSQL grants at once.
    """
    if for_update:
        frappe.db.sql(
            'SELECT name FROM "tabProject Payments" WHERE split_from = %s ORDER BY name FOR UPDATE',
            (name,),
        )
    children = frappe.get_all(
        PAYMENT_DOCTYPE,
        filters={"split_from": name},
        fields=["name", "creation", "amount", "status", "tds"],
        order_by="creation asc, name asc",
    )
    return tuple(
        SplitChild(
            name=child.name,
            created=child.creation,
            amount=child.amount,
            created_amount=_created_amount(child.name, child.amount),
            status=child.status,
            tds=child.tds,
            tds_deducted=bool(
                frappe.db.exists(TDS_DEDUCTION_DOCTYPE, {"project_payment": child.name})
            ),
            paid_on=min(settled_at_of(child.name), default=None),
            versions=edits_of(PAYMENT_DOCTYPE, child.name),
            has_term=bool(
                frappe.db.exists(
                    "PO Payment Terms", {"parenttype": PO_DOCTYPE, "project_payment": child.name}
                )
            ),
        )
        for child in children
    )


def settled_at_of(payment: str) -> tuple:
    """When each Settled leg on `payment` was matched, oldest first."""
    return tuple(
        frappe.get_all(
            MATCH_DOCTYPE,
            filters={
                "target_doctype": PAYMENT_DOCTYPE,
                "target_name": payment,
                "match_kind": MATCH_SETTLED,
            },
            pluck="matched_at",
            order_by="matched_at asc",
        )
    )


def join_leftover_back(original: str, leftover: str, actor: str, reason: str) -> dict:
    """Un-split: delete `leftover`, restore `original`'s amount, join the PO's terms. Inside the caller's
    savepoint. Returns `payment_split.unsplit_payment`'s result.

    ⚠️ THE NAMING-SERIES COUNTER IS PUT BACK AFTER THE DELETE, as `unreconcile_created.delete_created`
    does: a Reversed leg of a transfer that once paid this leftover names it, and a rewound counter would
    hand that name to the next payment.

    ⚠️ `_outflow_import_write` holds shut the CEO-Hold hook's committing branch, which the leftover's
    trash and the PO save both reach -- a commit there would end the all-or-nothing savepoint.

    The partial-provenance comments on the original stay; this adds one recording the undo and why. The
    leftover's comments go with it.
    """
    series = series_counters_for(leftover)
    with _outflow_import_write():
        # ⚠️ THE EXPECTED LEFTOVER STATUS IS PASSED, NOT DEFAULTED (#1289). `unsplit_payment` defaults
        # to `Approved`, which is the status a part settle left a balance at until the settleable
        # anchor moved. `settle_row_partial` now creates the balance at `Reconciliation Pending`, so
        # the default would refuse to undo every split this import had just made -- and the
        # `unsplit.leftover_refusal` screen ahead of it, which reads the same map, would have said
        # the leftover was fine. One map, read at both ends.
        result = unsplit_payment(
            original, leftover, expect_leftover_status=_SETTLEABLE_STATUS
        )
    restore_series_counters(series)

    restored = frappe.format_value(result["restored_amount"], "Currency")
    carried = frappe.format_value(result["leftover_amount"], "Currency")
    frappe.get_doc(PAYMENT_DOCTYPE, original).add_comment(
        "Comment",
        text=(
            f"Partial settlement undone by {actor}: {reason}. The leftover {leftover} ({carried}) was "
            f"deleted and this payment's amount restored to {restored}."
        ),
    )
    return result


def unsplit_fields(verdict: LegVerdict) -> dict:
    """What the amber "The split is undone:" line lists, for the plan and the response; blank on every
    other verdict."""
    unsplit = verdict.verdict == VERDICT_UNSPLIT_PAYMENT
    return {
        "leftover": verdict.leftover,
        "leftover_amount": float(verdict.leftover_amount) if unsplit else None,
        "restored_amount": float(verdict.restored_amount) if unsplit else None,
        "joins_terms": verdict.joins_terms,
    }


def _created_amount(name: str, current):
    """The payment's amount when it was created: the old value of its oldest `amount` Version, else
    `current`. What "unchanged since the split" compares the amount against."""
    for version in frappe.get_all(
        "Version",
        filters={"ref_doctype": PAYMENT_DOCTYPE, "docname": name},
        fields=["data"],
        order_by="creation asc",
    ):
        for change in (frappe.parse_json(version.data or "{}") or {}).get("changed") or []:
            if change and change[0] == "amount":
                return change[1]
    return current
