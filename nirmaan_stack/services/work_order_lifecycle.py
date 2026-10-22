# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Work Order lifecycle rules: which changes a Service Requests save may make, and who may make them.

This is the one place the server's Work Order status-move and lock rules live (spec #1528). The
Service Requests `validate` hook applies them (`integrations/controllers/service_requests.guard_lifecycle`),
and its `on_trash` hook applies `delete_problem` (`guard_delete`), so the SPA, Desk and the REST API all
obey them.

Who decides (#1529): approving or rejecting a Work Order, and accepting or reverting its amendment, takes
Admin or Project Lead. Each of those saves moves the status INTO Approved or Rejected, so the rule is
written on that move: Vendor Selected -> Approved / Rejected, and Amendment -> Approved (accept, and
revert, which also writes the snapshot's items back). A new Work Order saved straight as Approved or
Rejected counts too.

The Finalize lock (#1539, GLOSSARY *Finalized (Work Order)*): a Finalized Work Order's scope is closed.
Its status (so Amend), vendor, project, GST flag, terms, items, categories and total do not change, for
anyone, Admin included, and it is not deleted. Everything else stays open: payments and the figures they
recount, invoices, remarks, the Nirmaan GST and the PDF. The one GST change let through is Match GST to
vendor (`gst_from_vendor`). The finalize flag itself moves only through Finalize and Revert Finalization
(`api/sr_finalize`, `finalize_action`), which write the audit remark.

The approval record (#1532): the save that approves a Work Order (`is_approval`) stamps its
`approved_on` / `approved_by`, and every other save keeps them (`approval_record`, applied by the
doctype's own `validate`). The backfill patch `v3_0.backfill_work_order_approval` reads old history by
the same `is_approval` rule.

The amendment rules (#1540, GLOSSARY *Amendment (of a Work Order)*): an amendment save is one that
starts an amendment (Approved -> Amendment), changes a Work Order under amendment, or decides it
(Amendment -> Approved: accept, or revert). Amend waits while any payment is neither Paid nor Rejected.
No amendment save may lower the total below Amount Paid or the approved invoices, nor leave a vendor
other than the one before the amendment once a payment (not Rejected) or an invoice exists, nor swap in
a vendor on GST Hold. A Work Order under amendment takes no new payment (`payment_request_problem`).
So those rules can't be skipped, an Approved Work Order moves only into Amendment, one under Amendment
only back to Approved (accept, or revert), and an Approved one's own save keeps its scope (`SCOPE_FIELDS`: vendor, items, categories, total); a Desk edit of a paid Approved Work
Order, or a move back to Vendor Selected and a fresh approval, is refused (`_approved_problem`).

Pure: the caller resolves who the user is (`services/role_profiles.can_decide_work_order`), which
server action is saving, and, for an amendment save, the payments, invoices and vendor facts
(`AmendmentFacts`), and passes the answers in.
"""

import json
from dataclasses import dataclass
from decimal import Decimal

import frappe
from frappe.utils import flt

from nirmaan_stack.services.outflow_import.amounts import rupees
from nirmaan_stack.services.settlement import STATUS_PAID, STATUS_REJECTED
from nirmaan_stack.services.work_order_gst import items_value, work_order_total

APPROVED = "Approved"
REJECTED = "Rejected"
AMENDMENT = "Amendment"

#: Stamped by the save that approves a Work Order and never moved after (`approval_record`).
APPROVAL_FIELDS = ("approved_on", "approved_by")

#: A save that moves a Work Order into one of these from any other status is an approver's decision.
DECISION_STATUSES = (APPROVED, REJECTED)

DECIDE_REFUSAL = (
    "Only Admin and Project Lead can approve or reject a Work Order, or accept or revert its amendment."
)

#: The WO page's banner shows this text word for word (`frontend/src/pages/ServiceRequests/config/finalizedLock.ts`).
FINALIZED_REFUSAL = (
    "This Work Order is Finalized: it can't be amended or deleted, and its items, total, vendor, "
    "GST and terms are locked. Payments, invoices and remarks stay open. "
    "Revert Finalization unlocks it."
)

FINALIZE_FLAG_REFUSAL = (
    "A Work Order is finalized only with Finalize, and unlocked only with Revert Finalization."
)

AMEND_PAYMENTS_REFUSAL = (
    "This Work Order can't be amended while a payment on it is neither Paid nor Rejected."
)

TOTAL_BELOW_REFUSAL = "An amendment can't bring a Work Order's total below what was paid or billed."

VENDOR_CHANGE_REFUSAL = (
    "An amendment can't change the vendor once the Work Order has a payment (not Rejected) or an invoice: "
    "paid money stays with the vendor who got it."
)

GST_HOLD_AMEND_REFUSAL = "An amendment can't make a vendor on GST Hold this Work Order's vendor."

APPROVED_SCOPE_REFUSAL = (
    "An Approved Work Order's vendor, items, categories and total change only through Amend, so the "
    "amendment rules and an approver see the change."
)

LEAVE_APPROVED_REFUSAL = "An Approved Work Order can only be amended; it can't go back to"

LEAVE_AMENDMENT_REFUSAL = (
    "A Work Order under amendment is accepted or reverted, back to Approved; it can't move to"
)

UNDER_AMENDMENT_PAYMENT_REFUSAL ="A payment can't be requested on a Work Order under amendment."

#: A payment at one of these statuses is settled; any other is money in flight.
SETTLED_PAYMENT_STATUSES = (STATUS_PAID, STATUS_REJECTED)


@dataclass(frozen=True)
class AmendmentFacts:
    """What an amendment save is checked against, read by the caller.

    `open_payments`: (name, status) of the payments neither Paid nor Rejected. `has_live_payment`: a
    payment that is not Rejected exists. `invoices`: how many Vendor Invoices (not Rejected) and
    generated invoices (not Voided) it has. `vendor_before`: the vendor it had when the amendment
    started (`work_order_amendment.vendor_before_amendment`), None when unknown. `vendor_on_gst_hold`:
    the vendor the save leaves is on GST Hold.
    """

    open_payments: tuple = ()
    has_live_payment: bool = False
    invoices: int = 0
    vendor_before: str | None = None
    vendor_on_gst_hold: bool = False


#: What a Finalized Work Order's save may not change. `gst` gives way to Match GST to vendor.
LOCKED_FIELDS = (
    "status",
    "vendor",
    "project",
    "gst",
    "notes",
    "work_order_items",
    "service_order_list",
    "service_category_list",
    "total_amount",
)

#: What an Approved Work Order's own save may not change: its scope moves only through Amend (`APPROVED -> AMENDMENT`).
SCOPE_FIELDS = ("vendor", "work_order_items", "service_order_list", "service_category_list", "total_amount")

#: The statuses an Approved Work Order's save may leave it at.
APPROVED_NEXT_STATUSES = (APPROVED, AMENDMENT)

CHILD_TABLES = frozenset(("work_order_items",))

#: A child row's bookkeeping, which a save rewrites without changing the row.
_ROW_BOOKKEEPING = frozenset(
    ("name", "owner", "creation", "modified", "modified_by", "docstatus", "idx",
     "parent", "parentfield", "parenttype", "doctype")
)


class WorkOrderChangeRefused(frappe.ValidationError):
    """The lifecycle rules forbid this Work Order save, for this user."""

    http_status_code = 403


def is_decision(before_status: str | None, after_status: str | None) -> bool:
    """True when a save moves the status into Approved or Rejected. `before_status` is None for a new
    Work Order."""
    return after_status in DECISION_STATUSES and before_status != after_status


def is_finalized(doc) -> bool:
    return bool(doc) and str(doc.get("is_finalized") or 0) not in ("0", "False", "")


def is_approval(before_status: str | None, after_status: str | None) -> bool:
    """True when a save approves a Work Order: a decision into Approved from anything but Amendment.
    Accepting or reverting an amendment also moves it into Approved, but it was approved already."""
    return after_status == APPROVED and is_decision(before_status, after_status) and before_status != AMENDMENT


def approval_record(before, after, *, user: str, now) -> dict:
    """The `approved_on` / `approved_by` a save of `after` over `before` stores (#1532).

    The save that approves stamps `now` and `user`. Every other save carries `before`'s values over,
    whatever it sends, so a later payment, invoice, GST, notes or amendment save never moves them.
    """
    if is_approval(before.get("status") if before else None, after.get("status")):
        return {"approved_on": now, "approved_by": user}
    return {field: before.get(field) if before else None for field in APPROVAL_FIELDS}


def is_amendment_save(before, after) -> bool:
    """True when a save starts, changes or decides an amendment: Approved -> Amendment,
    Amendment -> Amendment, or Amendment -> Approved."""
    if not before:
        return False
    moves = (before.get("status"), after.get("status"))
    return moves in ((APPROVED, AMENDMENT), (AMENDMENT, AMENDMENT), (AMENDMENT, APPROVED))


def change_problem(
    before,
    after,
    *,
    may_decide: bool,
    gst_from_vendor: bool = False,
    finalize_action: bool = False,
    amendment: AmendmentFacts | None = None,
) -> str | None:
    """Why this save of `after` over `before` (None for a new Work Order) is refused, or None when it may go.

    `may_decide`: the user's answer to `role_profiles.WO_DECIDE_PROFILES`. `gst_from_vendor`: the server set
    the GST flag from the vendor (`flags.gst_set_from_vendor`). `finalize_action`: Finalize or Revert
    Finalization is saving (`flags.finalize_action`). `amendment`: the facts an amendment save is checked
    against; the caller reads them when `is_amendment_save`.
    """
    before_status = before.get("status") if before else None
    if is_decision(before_status, after.get("status")) and not may_decide:
        return DECIDE_REFUSAL
    if is_finalized(before) != is_finalized(after) and not finalize_action:
        return FINALIZE_FLAG_REFUSAL
    if is_finalized(before) and _locked_changes(before, after, gst_from_vendor=gst_from_vendor):
        return FINALIZED_REFUSAL
    if before_status == APPROVED:
        problem = _approved_problem(before, after)
        if problem:
            return problem
    if before_status == AMENDMENT and after.get("status") not in (AMENDMENT, APPROVED):
        # Leaving it any other way, then re-approving, would skip the amendment rules (stories 18-19).
        return f"{LEAVE_AMENDMENT_REFUSAL} {after.get('status')}."
    if is_amendment_save(before, after):
        return _amendment_problem(before, after, amendment or AmendmentFacts())
    return None


def _approved_problem(before, after) -> str | None:
    """An Approved Work Order moves only into Amendment, and its own save keeps its scope: otherwise a
    Desk edit, or a move back to Vendor Selected and a fresh approval, would skip the amendment rules."""
    after_status = after.get("status")
    if after_status not in APPROVED_NEXT_STATUSES:
        return f"{LEAVE_APPROVED_REFUSAL} {after_status}."
    if after_status == APPROVED and _changed(before, after, SCOPE_FIELDS):
        return APPROVED_SCOPE_REFUSAL
    return None


def payment_request_problem(work_order: str, work_order_status: str | None) -> str | None:
    """Why a new payment on `work_order` is refused, or None: no money moves against a total that may change."""
    if work_order_status == AMENDMENT:
        return (
            f"{UNDER_AMENDMENT_PAYMENT_REFUSAL} {work_order} is waiting for its amendment to be accepted "
            "or reverted; request the payment after that."
        )
    return None


def _amendment_problem(before, after, facts: AmendmentFacts) -> str | None:
    starting = before.get("status") == APPROVED
    if starting and facts.open_payments:
        listed = ", ".join(f"{name} ({status})" for name, status in facts.open_payments)
        return f"{AMEND_PAYMENTS_REFUSAL} Pay or reject these first: {listed}."

    vendor_before = before.get("vendor") if starting else (facts.vendor_before or before.get("vendor"))
    if (after.get("vendor") or None) != (vendor_before or None):
        if facts.has_live_payment or facts.invoices:
            return VENDOR_CHANGE_REFUSAL
        if facts.vendor_on_gst_hold:
            return (
                f"{GST_HOLD_AMEND_REFUSAL} {after.get('vendor')} is on GST Hold; pick another vendor, "
                "or ask Admin to remove the GST Hold."
            )

    # The stored total moves only when an amendment is decided (`ServiceRequests.on_update`), so while
    # one is open it is still the total from before it. A save that doesn't lower it is never refused here.
    new_total = round(work_order_total(_items_value(after), after.get("gst")), 2)
    if new_total >= round(flt(before.get("total_amount")), 2):
        return None
    for floor, what in ((flt(before.get("amount_paid")), "Amount Paid"),
                        (flt(before.get("amount_invoiced")), "approved invoices")):
        if new_total < round(floor, 2):
            return (
                f"{TOTAL_BELOW_REFUSAL} It would make the total {rupees(new_total)}, below its "
                f"{what} of {rupees(floor)}."
            )
    return None


def _items_value(doc) -> float:
    """The Work Order's items' value before GST (`work_order_gst.items_value`)."""
    return items_value(doc.get("work_order_items"))


def delete_problem(doc) -> str | None:
    """Why `doc` may not be deleted, or None when it may."""
    return FINALIZED_REFUSAL if is_finalized(doc) else None


def _locked_changes(before, after, *, gst_from_vendor: bool) -> list[str]:
    return _changed(before, after, [f for f in LOCKED_FIELDS if not (f == "gst" and gst_from_vendor)])


def _changed(before, after, fields) -> list[str]:
    return [f for f in fields if _comparable_field(before, f) != _comparable_field(after, f)]


def _comparable_field(doc, field):
    value = doc.get(field)
    if field in CHILD_TABLES:
        return [_comparable_row(row) for row in value or []]
    return _comparable(value)


def _comparable_row(row) -> dict:
    """A child row's own values, without the bookkeeping a save rewrites."""
    values = row.as_dict() if hasattr(row, "as_dict") else row
    return {
        k: _comparable(v) for k, v in values.items() if k not in _ROW_BOOKKEEPING and not k.startswith("_")
    }


def _comparable(value):
    """`value` in one shape whatever path brought it: a JSON field as text (Desk) or parsed (the database),
    a number as int, float or Decimal, a blank as "" or None."""
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text[0] in "[{":
            try:
                return _comparable(json.loads(text))
            except ValueError:
                return text
        return text
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float, Decimal)):
        return round(float(value), 6)
    if isinstance(value, (list, tuple)):
        return [_comparable(v) for v in value]
    if isinstance(value, dict):
        return {k: _comparable(v) for k, v in value.items()}
    return value
