"""
Shared payment utility functions for PO Adjustments and PO Revisions.
Moved from revision_logic.py to decouple payment handling from revision workflow.
"""
import frappe
from frappe import _
from frappe.utils import flt, nowdate

from nirmaan_stack.services.po_credit import usable_credit


def usable_po_credit(po_id, for_update=False):
    """Overpaid credit `po_id` may actually spend — the ONE reader every spender goes through.

    Applies the D2 cap (see `services/po_credit`): the adjustment ledger's claim, bounded by
    what was genuinely overpaid. Returns 0.0 when the PO has no adjustment.

    `for_update=True` takes the `SELECT ... FOR UPDATE` row lock on the adjustment, for the
    concurrency guards. NOTE: the Procurement Orders row backing the cap is read WITHOUT a
    lock, deliberately — locking it here would put a second row type into the push/pull lock
    ordering and risk deadlocks against `_lock_and_assert_dest_capacity`, to protect a bound
    that is already conservative. An unlocked cap is strictly better than no cap.
    """
    adj_name = frappe.db.get_value("PO Adjustments", {"po_id": po_id}, "name")
    if not adj_name:
        return 0.0
    remaining = frappe.db.get_value(
        "PO Adjustments", adj_name, "remaining_impact", for_update=for_update
    )
    po = frappe.db.get_value(
        "Procurement Orders", po_id, ["amount_paid", "total_amount"], as_dict=True
    ) or {}
    return usable_credit(remaining, po.get("amount_paid"), po.get("total_amount"))


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

    # `amount_due` on the PO is amount_invoiced - amount_paid, so it moves with the
    # write above. It has to be called HERE and not left to Project Payments: the
    # payments this function follows were created with `from_adjustment=True`, which
    # skips every project_payments.py hook -- including the one that would have done it.
    from nirmaan_stack.api.invoices._item_billing_sync import (
        recompute_document_amount_due,
    )
    recompute_document_amount_due("Procurement Orders", po_id)


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


# NOTE — `_reduce_payment_terms_lifo` was DELETED here (D3).
#
# It was a second, rival implementation of "shrink a PO's payment terms", orphaned when
# commit 44a2cb75 replaced the old negative flow with the PO Adjustments system. It had no
# callers. `_auto_absorb_created_terms` in api/po_revisions/revision_logic.py is the one
# surviving implementation.
#
# It also held two behaviours the survivor lacks, and NEITHER should be ported back:
#
#   * forcing the payment terms to re-sum to the PO total. On the absorb path that is
#     WRONG. When a decrease cannot be fully absorbed, terms legitimately exceed the total
#     by the amount already PAID — e.g. PO/011/00097/26-27 carries Paid terms of 94,518
#     against a 93,810 total, and the 708 gap IS the overpayment the adjustment records.
#     Reconciling it away would erase the evidence.
#   * minting a "Return - Overpayment Adjustment" term for the unabsorbed remainder. The
#     adjustment ledger records that remainder now, and the D1 gate
#     (services/po_revision_capacity) stops the case where the remainder was fictitious.

def _lock_and_assert_source_credit(source_po, amount_needed):
    """
    Acquire a row lock (SELECT ... FOR UPDATE) on the SOURCE PO's adjustment row and
    assert it still holds >= `amount_needed` of overpaid credit.

    The lock serializes concurrent CONSUMERS of the same source's credit (a push and a
    pull, or two pulls, drawing from the same overpaid PO): the second transaction
    blocks here until the first commits, then reads the *reduced* balance and is
    rejected. This is the "don't spend the same coupon twice" guard. Must be called
    INSIDE the request transaction, before any write, by EVERY consumer (push + pull) —
    a lock only serializes callers that all take it.

    Returns the available credit. Throws if the source has no adjustment or too little
    credit left.
    """
    if not frappe.db.get_value("PO Adjustments", {"po_id": source_po}, "name"):
        frappe.throw(_("No overpaid credit found on {0}.").format(source_po))
    # Takes the FOR UPDATE lock on the adjustment row (held until the txn commits/rolls
    # back) AND applies the D2 cap, so a ledger claiming credit the PO never overpaid
    # cannot be transferred out of it.
    available = usable_po_credit(source_po, for_update=True)
    if flt(amount_needed) > available + 0.01:
        frappe.throw(_(
            "Only {0} credit remains on {1} (tried to use {2}). "
            "It may have been used elsewhere — please refresh and retry."
        ).format(flt(available, 2), source_po, flt(amount_needed, 2)))
    return available


def _lock_and_assert_dest_capacity(dest_po, amount_incoming):
    """
    Acquire a row lock on the DESTINATION PO and assert its remaining 'Created' (unpaid)
    payment terms can still absorb `amount_incoming`.

    Locking the PO row serializes concurrent FILLERS of the same PO (a push target and a
    pull destination, or two pulls into the same PO): the second transaction blocks here
    until the first commits, then reads the *reduced* capacity and is rejected. This is
    the "don't pay the same bill twice" guard. The destination may have no adjustment
    doc, so we lock the Procurement Orders row itself.

    Returns the absorbable capacity. Throws if it can no longer absorb the amount.
    """
    # FOR UPDATE lock on the destination PO row (held until txn commit/rollback).
    frappe.db.get_value("Procurement Orders", dest_po, "name", for_update=True)
    capacity = frappe.db.sql("""
        SELECT COALESCE(SUM(amount), 0)
        FROM "tabPO Payment Terms"
        WHERE parent = %s AND term_status = 'Created'
    """, (dest_po,))[0][0] or 0.0
    capacity = flt(capacity, 2)
    if flt(amount_incoming) > capacity + 0.01:
        frappe.throw(_(
            "{0} can only absorb {1} more (tried to apply {2}). "
            "Its pending payable changed — please refresh and retry."
        ).format(dest_po, capacity, flt(amount_incoming, 2)))
    return capacity


def _transfer_credit(source_po, dest_po, amount, vendor):
    """
    Apply ₹`amount` of overpaid credit FROM `source_po` INTO `dest_po`
    (same vendor; the two POs may belong to different projects).

    One complete paired transfer:
      - DEST leg  : incoming +amount payment + reduce dest's 'Created' terms
                    (appends a 'Credit PO {source}' Paid term) — settles part of
                    dest's pending payable.
      - SOURCE leg: outgoing -amount payment + a 'RA PO {dest}' Return term — the
                    overpaid credit leaves the source PO.
      - Appends an 'Against PO' (+amount) child entry to the SOURCE's PO Adjustment.

    Each payment leg is tagged with ITS OWN PO's project (cross-project safe — this
    is the same paired logic as execute_adjustment's Against-po branch, but with the
    project mis-tag fixed for this flow).

    Does NOT commit and does NOT recalc amount_paid / remaining_impact / vendor
    credit — the caller orchestrates those once. Returns the set of affected PO names.
    """
    amount = abs(flt(amount))
    if amount <= 0:
        return set()

    source_project = frappe.db.get_value("Procurement Orders", source_po, "project")
    dest_project = frappe.db.get_value("Procurement Orders", dest_po, "project")

    # ── DEST leg: pull credit in (dest plays the 'target' role) ──
    pay_in = _create_project_payment(
        po_id=dest_po, project=dest_project, vendor=vendor,
        amt=amount, status="Paid", utr=source_po
    )
    _split_target_po_term(dest_po, amount, pay_in.name, source_po)  # reloads + saves dest

    # ── SOURCE leg: the credit leaves the overpaid PO as a Return ──
    source_doc = frappe.get_doc("Procurement Orders", source_po)
    pay_out = _create_project_payment(
        po_id=source_po, project=source_project, vendor=vendor,
        amt=-amount, status="Paid", utr=dest_po
    )
    _append_return_payment_term(source_doc, pay_out, f"RA PO {dest_po}", -amount)

    # Rebalance source payment-term percentages (total_amount is item-derived, stable)
    source_doc.calculate_totals_from_items()
    src_total = flt(source_doc.total_amount)
    if src_total > 0:
        for term in source_doc.get("payment_terms", []):
            if term.term_status == "Return":
                term.percentage = 0.0
            else:
                term.percentage = flt((flt(term.amount) / src_total) * 100, 2)
    source_doc.flags.ignore_validate_update_after_submit = True
    source_doc.save(ignore_permissions=True)

    # ── Record the 'Against PO' entry on the SOURCE's adjustment (positive —
    #    resolves its negative remaining_impact). Caller recalculates once. ──
    src_adj_name = frappe.db.get_value("PO Adjustments", {"po_id": source_po}, "name")
    if src_adj_name:
        src_adj = frappe.get_doc("PO Adjustments", src_adj_name)
        src_adj.append("adjustment_items", {
            "entry_type": "Against PO",
            "amount": flt(amount),
            "description": f"Credit applied to {dest_po}",
            "timestamp": nowdate(),
            "project_payment": pay_out.name,
            "target_po": dest_po,
        })
        src_adj.save(ignore_permissions=True)

    return {source_po, dest_po}
