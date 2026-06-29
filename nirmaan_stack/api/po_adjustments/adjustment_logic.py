"""
Manual PO Adjustment API — handles Against-po, Adhoc, and Vendor Refund flows.
Operates on the PO Adjustments doctype created by the revision approval process.
"""
import frappe
from frappe import _
from frappe.utils import flt, nowdate
import json

from ._payment_utils import (
    _create_project_payment,
    _recalculate_amount_paid,
    _append_return_payment_term,
    _split_target_po_term,
    _transfer_credit,
)
from nirmaan_stack.api.vendor_credit import recalculate_vendor_credit


@frappe.whitelist()
def get_po_adjustment(po_id):
    """Returns the PO Adjustment doc with children for a given PO, or None."""
    adj_name = frappe.db.get_value("PO Adjustments", {"po_id": po_id}, "name")
    if not adj_name:
        return None
    doc = frappe.get_doc("PO Adjustments", adj_name).as_dict()
    # Each child row carries Frappe's standard `owner` audit field (the session
    # user who created it). Resolve it to a full name so the UI can attribute the
    # entry — "Triggered by X" for system entries, "by X" for manual ones.
    for item in doc.get("adjustment_items", []):
        owner = item.get("owner")
        item["created_by"] = frappe.utils.get_fullname(owner) if owner else None
    return doc


@frappe.whitelist()
def execute_adjustment(po_id, adjustments_json):
    """
    Processes manual adjustment entries (Against-po, Adhoc, Vendor Refund).
    Creates payments, appends child entries to PO Adjustment doc,
    recalculates remaining_impact, and sets status.
    """
    try:
        adjustments = json.loads(adjustments_json) if isinstance(adjustments_json, str) else adjustments_json

        adj_name = frappe.db.get_value("PO Adjustments", {"po_id": po_id}, "name")
        if not adj_name:
            frappe.throw(_("No PO Adjustment found for PO {0}").format(po_id))

        adj_doc = frappe.get_doc("PO Adjustments", adj_name)
        original_po = frappe.get_doc("Procurement Orders", po_id)
        affected_target_pos = set()

        for entry in adjustments:
            r_type = entry.get("return_type")
            amount = abs(flt(entry.get("amount", 0)))
            if amount <= 0:
                continue

            if r_type == "Against-po":
                for target in entry.get("target_pos", []):
                    t_amount = abs(flt(target.get("amount", 0)))
                    t_po_id = target.get("po_number")
                    if not t_po_id or t_amount <= 0:
                        continue

                    # Create adjustment out payment
                    pay_out = _create_project_payment(
                        po_id=po_id, project=adj_doc.project, vendor=adj_doc.vendor,
                        amt=-t_amount, status="Paid", utr=t_po_id
                    )
                    _append_return_payment_term(original_po, pay_out, f"RA PO {t_po_id}", -t_amount)

                    # Create adjustment in payment on target
                    pay_in = _create_project_payment(
                        po_id=t_po_id, project=adj_doc.project, vendor=adj_doc.vendor,
                        amt=t_amount, status="Paid", utr=po_id
                    )
                    _split_target_po_term(t_po_id, t_amount, pay_in.name, po_id)
                    affected_target_pos.add(t_po_id)

                    # Record child entry (positive — resolves negative remaining_impact)
                    adj_doc.append("adjustment_items", {
                        "entry_type": "Against PO",
                        "amount": flt(t_amount),
                        "description": f"Credit transferred to {t_po_id}",
                        "timestamp": nowdate(),
                        "project_payment": pay_out.name,
                        "target_po": t_po_id,
                    })

            elif r_type == "Vendor-has-refund":
                pay_refund = _create_project_payment(
                    po_id=po_id, project=adj_doc.project, vendor=adj_doc.vendor,
                    amt=-amount, status="Paid",
                    utr=entry.get("utr"),
                    attachment=entry.get("refund_attachment")
                )
                _append_return_payment_term(original_po, pay_refund, "RA Vendor", -amount)

                adj_doc.append("adjustment_items", {
                    "entry_type": "Vendor Refund",
                    "amount": flt(amount),
                    "description": f"Vendor refund received",
                    "timestamp": nowdate(),
                    "project_payment": pay_refund.name,
                    "refund_date": entry.get("refund_date") or nowdate(),
                    "refund_attachment": entry.get("refund_attachment"),
                })

            elif r_type == "Ad-hoc":
                desc = entry.get("ad-hoc_description", "")
                expense_type = entry.get("ad-hoc_type", "")

                pay_adhoc = _create_project_payment(
                    po_id=po_id, project=adj_doc.project, vendor=adj_doc.vendor,
                    amt=-amount, status="Paid"
                )
                _append_return_payment_term(original_po, pay_adhoc, "RA Adhoc", -amount)

                # Create project expense if type specified
                if expense_type:
                    expense = frappe.new_doc("Project Expenses")
                    expense.projects = adj_doc.project
                    expense.type = expense_type
                    expense.vendor = adj_doc.vendor
                    expense.description = frappe.utils.cstr(desc)[:140]
                    expense.amount = amount
                    expense.payment_date = nowdate()
                    expense.payment_by = frappe.session.user
                    comment_text = entry.get("comment", "").strip()
                    expense.comment = f"{comment_text}" if comment_text else po_id
                    expense.save(ignore_permissions=True)

                adj_doc.append("adjustment_items", {
                    "entry_type": "Adhoc",
                    "amount": flt(amount),
                    "description": frappe.utils.cstr(f"{expense_type}: {desc}")[:140],
                    "timestamp": nowdate(),
                    "project_payment": pay_adhoc.name,
                    "expense_type": expense_type,
                })

        # Rebalance payment term percentages after appending Return terms
        original_po.calculate_totals_from_items()
        new_total = flt(original_po.total_amount)
        if new_total > 0:
            for term in original_po.get("payment_terms", []):
                if term.term_status == "Return":
                    term.percentage = 0.0
                else:
                    term.percentage = flt((flt(term.amount) / new_total) * 100, 2)

        # Recalculate amount_paid for affected target POs
        for target_po_id in affected_target_pos:
            _recalculate_amount_paid(target_po_id)

        original_po.flags.ignore_validate_update_after_submit = True
        original_po.save(ignore_permissions=True)

        _recalculate_amount_paid(original_po.name)

        # Vendor credit recalculation after adjustment resolution
        if adj_doc.vendor:
            recalculate_vendor_credit(adj_doc.vendor, "Adjustment Resolved", po_id=po_id, project=adj_doc.project)

        # Recalculate remaining impact
        adj_doc.recalculate_remaining_impact()

        # Emit socket event
        frappe.db.commit()
        frappe.publish_realtime(
            event="po:payment_adjustment",
            message={
                "po_id": po_id,
                "adjustment_id": adj_doc.name,
                "status": adj_doc.status,
            },
        )

        return {"status": "success", "adjustment": adj_doc.name, "remaining_impact": adj_doc.remaining_impact}

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "PO Adjustment Execution Error")
        frappe.throw(_("Adjustment failed: {0}").format(str(e)))


@frappe.whitelist()
def get_adjustment_candidate_pos(vendor, current_po):
    """
    Returns a list of approved POs for the same vendor that could receive
    a payment adjustment 'In'. Includes Partially Dispatched status.
    """
    pos = frappe.get_all("Procurement Orders",
        filters={
            "vendor": vendor,
            "name": ["!=", current_po],
            "status": ["in", ["PO Approved", "Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered"]]
        },
        fields=["name", "vendor", "total_amount", "amount_paid", "vendor_name", "creation", "project", "project_name", "status"],
        order_by="creation desc",
        limit=0
    )

    valid_pos = []

    from nirmaan_stack.api.po_revisions.revision_po_check import get_all_locked_po_names
    locked_po_names = get_all_locked_po_names()

    for po in pos:
        if po.name in locked_po_names:
            continue

        created_amount = frappe.db.sql("""
            SELECT SUM(amount)
            FROM "tabPO Payment Terms"
            WHERE parent = %s AND term_status = 'Created'
        """, (po.name,))[0][0]

        po.created_terms_amount = created_amount or 0.0

        if po.created_terms_amount > 100:
            valid_pos.append(po)

    return valid_pos


@frappe.whitelist()
def get_vendor_adjustment_credit(vendor, exclude_po=None):
    """
    Returns the pool of overpaid credit a vendor is holding across ALL its POs —
    powers the 'apply credit into this PO' panel at the top of a PO detail page.

    A 'source' = a PO Adjustment for this vendor still carrying usable overpaid
    credit (remaining_impact < -1, the established usable-credit floor — NOT the
    ₹100 'Done' display tolerance). Excludes the current PO (`exclude_po`) and any
    source currently inside a Pending PO Revision (its terms are mid-change).

    Returns {total_available, source_count, sources: [{po_id, project,
    project_name, available, status}, ...]} sorted by available desc.
    """
    if not vendor:
        return {"total_available": 0.0, "source_count": 0, "sources": []}

    adjustments = frappe.get_all(
        "PO Adjustments",
        filters={"vendor": vendor, "remaining_impact": ["<", -1]},
        fields=["po_id", "project", "remaining_impact", "status"],
    )

    pending_rev_pos = set(frappe.get_all(
        "PO Revisions", filters={"status": "Pending"}, pluck="revised_po"
    ))

    sources = []
    for adj in adjustments:
        if exclude_po and adj.po_id == exclude_po:
            continue
        if adj.po_id in pending_rev_pos:
            continue
        po = frappe.db.get_value(
            "Procurement Orders", adj.po_id, ["project_name", "status"], as_dict=True
        ) or {}
        sources.append({
            "po_id": adj.po_id,
            "project": adj.project,
            "project_name": po.get("project_name"),
            "available": flt(-flt(adj.remaining_impact), 2),
            "status": po.get("status"),
        })

    sources.sort(key=lambda s: s["available"], reverse=True)
    total = flt(sum(s["available"] for s in sources), 2)
    return {"total_available": total, "source_count": len(sources), "sources": sources}


@frappe.whitelist()
def apply_vendor_credit_to_po(dest_po, allocations_json):
    """
    Pull overpaid vendor credit INTO `dest_po` (the destination PO the user is
    viewing). `allocations_json` is a list of {source_po, amount}. For each source,
    transfers credit from its overpaid adjustment into dest_po — reducing dest's
    pending 'Created' terms (a 'Credit PO {source}' Paid term) and creating a Return
    payment on the source. Atomic: a single commit at the end, rollback on error.
    """
    try:
        from nirmaan_stack.api.po_revisions.revision_logic import _get_available_po_credit
        from nirmaan_stack.api.po_revisions.revision_po_check import check_po_in_pending_revisions

        allocations = json.loads(allocations_json) if isinstance(allocations_json, str) else allocations_json

        dest = frappe.get_doc("Procurement Orders", dest_po)
        vendor = dest.vendor

        # V1: dest must not be payment-locked (pending revision / pending adjustment).
        #     A soft 'has_credit_notice' (Done adj. with small leftover) does NOT block.
        lock = check_po_in_pending_revisions(dest_po)
        if lock.get("is_payment_locked"):
            frappe.throw(_("This PO's payments are locked by {0} — cannot apply credit.").format(
                lock.get("payment_lock_source") or "another process"))

        # V2: coalesce duplicate sources; reject non-positive amounts.
        merged = {}
        for entry in allocations or []:
            src = entry.get("source_po")
            amt = abs(flt(entry.get("amount", 0)))
            if not src:
                continue
            if amt <= 0:
                frappe.throw(_("Allocation amount must be greater than zero."))
            merged[src] = flt(merged.get(src, 0) + amt, 2)

        if not merged:
            frappe.throw(_("No valid allocations provided."))

        # V3: dest 'Created'-term capacity must absorb the total (else _split_target_po_term
        #     would over-pay the dest with nothing to reduce).
        dest_capacity = frappe.db.sql("""
            SELECT COALESCE(SUM(amount), 0)
            FROM "tabPO Payment Terms"
            WHERE parent = %s AND term_status = 'Created'
        """, (dest_po,))[0][0] or 0.0
        dest_capacity = flt(dest_capacity, 2)
        total_req = flt(sum(merged.values()), 2)
        if total_req > dest_capacity + 0.01:
            frappe.throw(_("Total credit {0} exceeds this PO's pending payable {1}.").format(
                total_req, dest_capacity))

        # V4: per-source vendor match + available-credit check.
        for src, amt in merged.items():
            src_vendor = frappe.db.get_value("Procurement Orders", src, "vendor")
            if src_vendor != vendor:
                frappe.throw(_("Source PO {0} belongs to a different vendor.").format(src))
            available = _get_available_po_credit(src)
            if amt > available + 0.01:
                frappe.throw(_("Allocation {0} exceeds available credit {1} on {2}.").format(
                    amt, flt(available, 2), src))

        # ── EXECUTE ──
        affected = set()
        for src, amt in merged.items():
            affected |= _transfer_credit(src, dest_po, amt, vendor)

        # ── RECALC (after all payments are saved; from_adjustment skipped the hooks) ──
        _recalculate_amount_paid(dest_po)
        for src in merged:
            _recalculate_amount_paid(src)
            src_adj_name = frappe.db.get_value("PO Adjustments", {"po_id": src}, "name")
            if src_adj_name:
                frappe.get_doc("PO Adjustments", src_adj_name).recalculate_remaining_impact()

        if vendor:
            recalculate_vendor_credit(vendor, "Adjustment Resolved", po_id=dest_po, project=dest.project)

        frappe.db.commit()
        frappe.publish_realtime(
            event="po:payment_adjustment",
            message={
                "po_id": dest_po,
                "status": "applied",
                "sources": list(merged.keys()),
            },
        )

        return {
            "status": "success",
            "dest_po": dest_po,
            "applied": merged,
            "total_applied": total_req,
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "Apply Vendor Credit Error")
        frappe.throw(_("Apply vendor credit failed: {0}").format(str(e)))
