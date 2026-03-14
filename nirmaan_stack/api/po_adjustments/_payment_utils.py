"""
Shared payment utility functions for PO Adjustments and PO Revisions.
Moved from revision_logic.py to decouple payment handling from revision workflow.
"""
import frappe
from frappe import _
from frappe.utils import flt, nowdate


def _create_project_payment(po_id, project, vendor, amt, status, utr=None, attachment=None):
    """
    Internal helper to create a Project Payment record without appending terms.
    Used during adjustment flows (refunds/credits).
    """
    pay = frappe.new_doc("Project Payments")
    pay.document_type = "Procurement Orders"
    pay.document_name = po_id
    pay.project = project
    pay.vendor = vendor
    pay.amount = amt
    pay.status = status
    pay.payment_date = nowdate()
    pay.approval_date = nowdate()

    if utr:
        pay.utr = utr
    if attachment:
        pay.payment_attachment = attachment
        pay.utr = f"VR-{po_id}"

    pay.flags.from_adjustment = True  # Skip ALL project_payments.py hooks
    pay.save(ignore_permissions=True)

    return pay


def _recalculate_amount_paid(po_id):
    """
    Manually recalculates and sets amount_paid on a Procurement Order
    by summing all its 'Paid' Project Payments.
    Called after creating payments with from_adjustment=True flag,
    since the normal project_payments.py on_update hook is skipped.
    """
    paid_payments = frappe.get_all(
        "Project Payments",
        filters={
            "document_type": "Procurement Orders",
            "document_name": po_id,
            "status": "Paid"
        },
        fields=["amount"]
    )
    total_paid = sum(flt(p.amount) for p in paid_payments)
    frappe.db.set_value("Procurement Orders", po_id, "amount_paid", total_paid)


def _append_return_payment_term(po_doc, payment_doc, term_label, amt):
    """
    Internal helper to add a Return/Adjustment term row to the existing PO in memory.
    """
    existing_payment_type = "Cash"
    if po_doc.payment_terms:
        existing_payment_type = po_doc.payment_terms[0].payment_type

    # If amount is negative (money going out), status = Return. If positive, status = Paid.
    conditional_status = "Return" if flt(amt) < 0 else "Paid"

    new_term = {
        "label": term_label,
        "amount": amt,
        "percentage": 0.0,
        "term_status": conditional_status,
        "payment_type": existing_payment_type,
        "project_payment": payment_doc.name,
    }

    if existing_payment_type == "Credit":
        new_term["due_date"] = frappe.utils.add_days(frappe.utils.nowdate(), 2)

    po_doc.append("payment_terms", new_term)


def _split_target_po_term(target_po_id, transfer_amount, payment_name, source_po_id):
    """
    Deducts the given credit amount from the 'Created' terms of the Target PO
    and appends a single 'Credit' term to represent the transferred payment.
    Used during negative adjustment flow when excess credit is transferred "Against-po".
    """
    target_po = frappe.get_doc("Procurement Orders", target_po_id)
    if not target_po.payment_terms:
        return

    credit_remaining = transfer_amount
    new_terms = []

    for term in target_po.payment_terms:
        if credit_remaining > 0 and term.term_status == "Created":
            term_amount = flt(term.amount)
            reduction = min(term_amount, credit_remaining)

            if reduction > 0:
                term.amount = term_amount - reduction
                credit_remaining -= reduction

        if abs(flt(term.amount)) > 0:
            new_terms.append(term.as_dict())

    payment_type = target_po.payment_terms[0].payment_type if target_po.payment_terms else ""
    split_term = {
        "label": frappe.utils.cstr(f"Credit PO {source_po_id}")[:140],
        "amount": transfer_amount,
        "percentage": 0,
        "term_status": "Paid",
        "payment_type": payment_type,
        "project_payment": payment_name
    }

    if payment_type == "Credit":
        split_term["due_date"] = frappe.utils.nowdate()

    new_terms.append(split_term)

    target_po.set("payment_terms", new_terms)

    target_po.calculate_totals_from_items()
    target_total = flt(target_po.total_amount)
    if target_total > 0:
        for t in target_po.payment_terms:
            t.percentage = (flt(t.amount) / target_total) * 100

    target_po.save(ignore_permissions=True)


def _reduce_payment_terms_lifo(original_po, reduction_needed, new_total):
    """
    Reduces modifiable terms bottom-up strictly according to reduction needed.
    Adjusts the original PO's un-paid payment terms from the bottom up (LIFO).
    """
    locked_terms = [t for t in original_po.payment_terms if t.term_status in ["Paid", "Requested", "Approved"]]
    modifiable_terms = [t for t in original_po.payment_terms if t.term_status == "Created"]
    return_terms = [t for t in original_po.payment_terms if t.term_status == "Return"]

    return_amount = sum(flt(t.amount) for t in return_terms if flt(t.amount) < 0)

    locked_term_dicts = [t.as_dict() for t in locked_terms]
    modifiable_term_dicts = [t.as_dict() for t in modifiable_terms]

    reduction_needed_for_terms = max(0, reduction_needed - abs(return_amount))

    for term_dict in reversed(modifiable_term_dicts):
        if reduction_needed_for_terms <= 0.01:
            break

        term_amount = flt(term_dict.get("amount", 0))
        amount_to_deduct = min(term_amount, reduction_needed_for_terms)

        term_dict["amount"] = term_amount - amount_to_deduct
        reduction_needed_for_terms -= amount_to_deduct

    return_term_dicts = [t.as_dict() for t in return_terms]
    final_modifiable_terms = [d for d in modifiable_term_dicts if flt(d.get("amount")) > 0.01]

    if reduction_needed_for_terms > 0.01:
        pay_adjustment = _create_project_payment(
            po_id=original_po.name,
            project=original_po.project,
            vendor=original_po.vendor,
            amt=-reduction_needed_for_terms,
            status="Paid"
        )
        auto_return_term = {
            "label": frappe.utils.cstr("Return - Overpayment Adjustment")[:140],
            "amount": -reduction_needed_for_terms,
            "percentage": 0.0,
            "term_status": "Return",
            "payment_type": original_po.payment_terms[0].payment_type if original_po.payment_terms else "",
            "project_payment": pay_adjustment.name
        }
        return_term_dicts.append(auto_return_term)

    original_po.set("payment_terms", locked_term_dicts + final_modifiable_terms + return_term_dicts)

    current_payment_sum = sum(flt(t.amount) for t in original_po.payment_terms)
    discrepancy = new_total - current_payment_sum

    if abs(discrepancy) > 0.01:
        last_adjustable_term = next(
            (t for t in reversed(original_po.payment_terms)
             if t.term_status not in ["Paid", "Requested", "Approved"] and "Return" not in (t.label or "")),
            None
        )
        if last_adjustable_term:
            last_adjustable_term.amount = flt(last_adjustable_term.amount) + discrepancy

    for term in original_po.payment_terms:
        if term.term_status == "Return" or new_total <= 0:
            term.percentage = 0.0
        else:
            term.percentage = (flt(term.amount) / new_total) * 100
