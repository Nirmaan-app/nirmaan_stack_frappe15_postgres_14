# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Waiting Vendor Refunds: recorded from "Adjust Payments" before the bank line (#1400, ADR-0032).

The vendor says it sent money back against a PO; the bank line has not been matched yet. The refund
is recorded at *Reconciliation Pending* and counts for nothing: no paid amount, amount due, vendor
credit or adjustment balance moves, and the PO stays payment-locked. It HOLDS its amount of the PO's
overpaid credit (`services/vendor_refunds.held_on`, applied in `_payment_utils.usable_po_credit`), so
no revision increase, credit push or credit pull spends it. Only the bank match (Bulk Import) makes it
Received.

* `record_waiting_refund` -- Admin, PMO Executive and the material Procurement profiles (exactly who
  may open "Adjust Payments", `ADJUST_PAYMENTS_PROFILES`), up to the PO's UNHELD overpaid balance.
* `update_waiting_refund` -- its creator or an Accountant. Amount and PO only while it waits (the rule
  is `services/vendor_refunds.money_edit_problem`, also enforced on every save by
  `integrations/controllers/vendor_refunds.guard_money_edit`); proof, UTR and description at any status.
* `cancel_waiting_refund` (#1403) -- its creator or an Accountant. Cancelled: it counts for nothing and
  holds nothing, so the PO's overpaid credit is free again. Nothing else moves; the PO stays locked
  until its balance is cleared another way.
* `mark_received_without_bank_line` (#1403) -- an Admin, with a reason. Received at once (the refund
  hook runs the PO sync: paid amount, adjustment balance and lock, vendor credit) and marked
  `no_bank_line` ("No bank proof") until a Bulk Import credit line is matched to it.

The Vendor Refunds DocPerms give these users read only, so both write with `ignore_permissions` behind
the profile checks here: these checks are the enforcement boundary.
"""

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.api.po_adjustments._payment_utils import usable_po_credit
from nirmaan_stack.services.role_profiles import (
    ADJUST_PAYMENTS_PROFILES,
    REFUND_ACCOUNTANT_PROFILES,
    has_role_profile,
    is_nirmaan_admin,
)
from nirmaan_stack.services.vendor_refunds import (
    CANCELLED,
    PROCUREMENT_ORDERS,
    RECONCILIATION_PENDING,
    VENDOR_REFUNDS,
    cancel_problem,
    document_project,
    held_on,
    money_edit_problem,
    no_bank_line_problem,
    no_bank_line_values,
)

#: The realtime event "Adjust Payments" already listens to; the PO page refetches on it.
_EVENT = "po:payment_adjustment"


def _assert_within_unheld(po_id: str, amount: float, own_hold: float = 0.0) -> None:
    """Lock the PO's adjustment row and refuse `amount` above its unheld overpaid balance.

    The lock is the one every credit spender takes (`_lock_and_assert_source_credit`), so a refund and
    a push or pull on the same PO serialize, and the second reads the first's hold. `own_hold` is what
    the refund being corrected already holds on this PO: it is free for that refund.
    """
    if not frappe.db.get_value("PO Adjustments", {"po_id": po_id}, "name"):
        frappe.throw(_("{0} has no overpaid balance to refund.").format(po_id))
    unheld = flt(usable_po_credit(po_id, for_update=True) + own_hold, 2)
    if flt(amount, 2) > unheld + 0.01:
        frappe.throw(_(
            "{0} has only {1} of overpaid balance not already held by a waiting refund, "
            "so a refund of {2} cannot be recorded against it."
        ).format(po_id, frappe.utils.fmt_money(unheld, currency="INR"),
                 frappe.utils.fmt_money(amount, currency="INR")))


def _po(po_id: str) -> dict:
    po = frappe.db.get_value(PROCUREMENT_ORDERS, po_id, ["name", "vendor"], as_dict=True)
    if not po:
        frappe.throw(_("PO {0} not found.").format(po_id))
    return po


def _publish(po_ids, refund: str, status: str = "waiting_refund") -> None:
    for po_id in sorted({p for p in po_ids if p}):
        frappe.publish_realtime(event=_EVENT, message={"po_id": po_id, "status": status, "refund": refund})


def _is_creator_or_accountant(doc, user: str) -> bool:
    """Its creator or an Accountant: who may cancel a waiting refund."""
    is_creator = bool(doc.waiting_created_by) and doc.waiting_created_by == user
    return is_creator or has_role_profile(user, REFUND_ACCOUNTANT_PROFILES)


def _credit_after(doc) -> dict:
    """What a cancel or mark answers with: the refund, its status, and its PO's held and spendable
    credit (0 for a refund not against a PO: credit is PO-only)."""
    po_id = doc.document_name if doc.document_type == PROCUREMENT_ORDERS else None
    return {
        "refund": doc.name,
        "status": doc.status,
        "held_credit": held_on(po_id) if po_id else 0.0,
        "usable_credit": usable_po_credit(po_id) if po_id else 0.0,
    }


@frappe.whitelist(methods=["POST"])
def record_waiting_refund(
    po_id: str,
    amount,
    payment_date: str | None = None,
    utr: str | None = None,
    refund_attachment: str | None = None,
    description: str | None = None,
):
    """Record a Vendor Refund of `amount` against `po_id`, waiting for its bank line.

    Returns `{refund, status, held_credit, usable_credit}`: the new record, and the PO's held and
    still-spendable overpaid credit after it.
    """
    user = frappe.session.user
    if not has_role_profile(user, ADJUST_PAYMENTS_PROFILES):
        raise frappe.PermissionError(_("You are not allowed to record a vendor refund from Adjust Payments."))
    amount = flt(amount, 2)
    if amount <= 0:
        frappe.throw(_("Enter a refund amount greater than 0."))
    po = _po(po_id)

    _assert_within_unheld(po_id, amount)
    refund = frappe.get_doc({
        "doctype": VENDOR_REFUNDS,
        "vendor": po.vendor,
        "project": document_project(PROCUREMENT_ORDERS, po_id),
        "document_type": PROCUREMENT_ORDERS,
        "document_name": po_id,
        "amount": amount,
        "status": RECONCILIATION_PENDING,
        "waiting_created_by": user,
        "payment_date": payment_date or frappe.utils.today(),
        "utr": (utr or "").strip() or None,
        "refund_attachment": refund_attachment or None,
        "description": (description or "").strip() or None,
    }).insert(ignore_permissions=True)

    frappe.db.commit()
    _publish([po_id], refund.name)
    return {
        "refund": refund.name,
        "status": refund.status,
        "held_credit": held_on(po_id),
        "usable_credit": usable_po_credit(po_id),
    }


_UNSET = object()


@frappe.whitelist(methods=["POST"])
def update_waiting_refund(
    refund: str,
    amount=None,
    po_id: str | None = None,
    utr=_UNSET,
    refund_attachment=_UNSET,
    description=_UNSET,
):
    """Correct a Vendor Refund: amount or PO while it waits, proof / UTR / description at any status.

    Only the user who recorded it as waiting, or an Accountant. A field left out is left as it is.
    """
    doc = frappe.get_doc(VENDOR_REFUNDS, refund, for_update=True)
    user = frappe.session.user
    is_creator = bool(doc.waiting_created_by) and doc.waiting_created_by == user
    is_accountant = has_role_profile(user, REFUND_ACCOUNTANT_PROFILES)
    if not (is_creator or is_accountant):
        raise frappe.PermissionError(
            _("Only the person who recorded this refund as waiting, or an Accountant, can change it.")
        )

    old_po = doc.document_name
    new_amount = flt(amount, 2) if amount not in (None, "") else flt(doc.amount, 2)
    new_po = po_id or old_po
    if new_amount != flt(doc.amount, 2) or new_po != old_po:
        problem = money_edit_problem(doc.status, is_creator, is_accountant)
        if problem:
            frappe.throw(problem)
        if doc.document_type != PROCUREMENT_ORDERS:
            frappe.throw(_("Only a refund against a PO can wait for its bank line."))
        if new_amount <= 0:
            frappe.throw(_("Enter a refund amount greater than 0."))
        if new_po != old_po:
            _po(new_po)
            doc.document_name = new_po
            doc.project = document_project(PROCUREMENT_ORDERS, new_po)
        _assert_within_unheld(new_po, new_amount, own_hold=flt(doc.amount) if new_po == old_po else 0.0)
        doc.amount = new_amount

    for field, value in (("utr", utr), ("refund_attachment", refund_attachment), ("description", description)):
        if value is not _UNSET:
            doc.set(field, (value or "").strip() or None)

    doc.save(ignore_permissions=True)
    frappe.db.commit()
    _publish([old_po, doc.document_name], doc.name)
    return {"refund": doc.name, "status": doc.status, "amount": flt(doc.amount), "po_id": doc.document_name}


@frappe.whitelist(methods=["POST"])
def cancel_waiting_refund(refund: str):
    """Cancel a waiting Vendor Refund whose bank line will never come (#1403).

    Its creator or an Accountant. The record stays, Cancelled: it lowers nothing and holds nothing, so
    its PO's overpaid credit is free again. The refund hook moves no money for it (it never lowered the
    paid amount), so the PO stays locked until its balance is cleared another way.
    Returns `{refund, status, held_credit, usable_credit}`.
    """
    doc = frappe.get_doc(VENDOR_REFUNDS, refund, for_update=True)
    if not _is_creator_or_accountant(doc, frappe.session.user):
        raise frappe.PermissionError(
            _("Only the person who recorded this refund as waiting, or an Accountant, can cancel it.")
        )
    problem = cancel_problem(doc.status)
    if problem:
        frappe.throw(problem)
    doc.status = CANCELLED
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    _publish([doc.document_name], doc.name, "refund_cancelled")
    return _credit_after(doc)


@frappe.whitelist(methods=["POST"])
def mark_received_without_bank_line(refund: str, reason: str | None = None):
    """Make a waiting Vendor Refund count without its bank line (#1403). Admin only, reason required.

    It becomes Received, so its save fires the refund hook and the PO sync: the paid amount drops, the
    adjustment balance clears (the lock lifts at Done) and the vendor's credit is recounted. It keeps
    the "No bank proof" mark (`no_bank_line`, with who, when and why) until a Bulk Import credit line
    is matched to it. Returns `{refund, status, held_credit, usable_credit}`.
    """
    user = frappe.session.user
    if not is_nirmaan_admin(user):
        raise frappe.PermissionError(_("Only an Admin can mark a refund Received with no bank line."))
    doc = frappe.get_doc(VENDOR_REFUNDS, refund, for_update=True)
    problem = no_bank_line_problem(doc.status, reason)
    if problem:
        frappe.throw(problem)
    doc.update(no_bank_line_values(user, reason, frappe.utils.now_datetime()))
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    _publish([doc.document_name], doc.name, "refund_received_without_bank_line")
    return _credit_after(doc)
