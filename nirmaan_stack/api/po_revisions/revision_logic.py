import frappe
from frappe import _
from frappe.utils import flt, nowdate
import json
from nirmaan_stack.api.delivery_notes.update_delivery_note import (
    calculate_order_status,
    calculate_delivered_amount,
)
from nirmaan_stack.api.po_adjustments._payment_utils import (
    _create_project_payment,
    _recalculate_amount_paid,
    _append_return_payment_term,
    _reduce_payment_terms_lifo,
)

@frappe.whitelist()
def make_po_revisions(po_id, justification, revision_items, total_amount_difference):
    """
    Creates a new draft 'PO Revisions' entry from an existing 'Procurement Orders'
    and populates it with revision data.
    payment_return_details has been removed — payment handling is now decoupled.
    """
    try:
        po = frappe.get_doc("Procurement Orders", po_id)

        rev_po = frappe.new_doc("PO Revisions")
        rev_po.revised_po = po_id
        rev_po.project = po.project
        rev_po.vendor = po.vendor
        rev_po.status = "Pending"
        rev_po.revision_justification = justification
        rev_po.total_amount_difference = flt(total_amount_difference)
        rev_po.payment_return_details = None

        # Parse revision items
        if isinstance(revision_items, str):
            revision_items = json.loads(revision_items)

        for item in revision_items:
            item_type = item.get("item_type")
            row_data = {
                "item_type": item_type,
                "item_status": "Pending",
            }

            # Original Anchors - Skip for "New" items
            if item_type != "New":
                row_data.update({
                    "original_row_id": item.get("original_row_id"),
                    "original_item_id": item.get("original_item_id"),
                    "original_item_name": item.get("original_item_name"),
                    "original_make": item.get("original_make"),
                    "original_unit": item.get("original_unit"),
                    "original_qty": flt(item.get("original_qty")),
                    "original_rate": flt(item.get("original_rate")),
                    "original_amount": flt(item.get("original_amount")),
                    "original_tax": flt(item.get("original_tax")),
                    "original_category": item.get("original_category"),
                    "original_procurement_package": item.get("original_procurement_package"),
                })

            # Revision Details - Skip for "Original" and "Deleted" items
            if item_type not in ["Original", "Deleted"]:
                row_data.update({
                    "revision_item_id": item.get("item_id"),
                    "revision_item_name": item.get("item_name"),
                    "revision_make": item.get("make"),
                    "revision_qty": flt(item.get("quantity")),
                    "revision_unit": item.get("unit"),
                    "revision_rate": flt(item.get("quote")),
                    "revision_amount": flt(item.get("amount")),
                    "revision_tax": flt(item.get("tax")),
                })

                cat = item.get("category") or item.get("original_category")
                pkg = item.get("procurement_package") or item.get("original_procurement_package")

                if not cat or not pkg:
                    fetched_cat, fetched_pkg = _get_item_metadata(item.get("item_id"))
                    cat = cat or fetched_cat
                    pkg = pkg or fetched_pkg

                row_data.update({
                    "revision_category": cat,
                    "revision_procurement_package": pkg
                })

            rev_po.append("revision_items", row_data)

        rev_po.insert(ignore_permissions=True)

        # Emit socket event for revision creation
        frappe.db.commit()
        frappe.publish_realtime(
            event="po:revision_created",
            message={
                "po_id": po_id,
                "revision_id": rev_po.name,
                "project": po.project,
            },
        )

        return rev_po.name

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Make PO Revisions API Error")
        frappe.throw(str(e))


@frappe.whitelist()
def on_approval_revision(revision_name):
    """
    Handles the actual application of changes to the Original PO and financials.
    Triggered when the manager Approves the PO Revision.

    Flow:
    1. Sync item edits to original PO
    2. Calculate financial diff
    3. Positive diff: auto-add payment term
    4. Negative diff: auto-absorb Created terms (LIFO)
    5. Create/update PO Adjustment doc to track remaining impact
    """
    revision_doc = frappe.get_doc("PO Revisions", revision_name, for_update=True)

    if revision_doc.status == "Approved":
        frappe.throw(_("This revision is already approved."))

    try:
        # Step 1: Sync Items
        sync_original_po_items(revision_doc)

        # Step 2: Handle Financial Changes via auto-adjustment
        diff = flt(revision_doc.total_amount_difference)
        auto_entries = []

        if diff != 0:
            original_po = frappe.get_doc("Procurement Orders", revision_doc.revised_po)

            if diff > 0:
                auto_entries = _auto_add_payment_term(original_po, diff, revision_name)
            elif diff < 0:
                auto_entries = _auto_absorb_created_terms(original_po, abs(diff), revision_name)

            original_po.flags.ignore_validate_update_after_submit = True
            original_po.save(ignore_permissions=True)

        # Step 3: Create/update PO Adjustment doc
        if diff != 0:
            _create_or_update_adjustment(revision_doc, diff, auto_entries)

        # Step 4: Finalize Status
        revision_doc.status = "Approved"
        revision_doc.save(ignore_permissions=True)

        # Emit socket event for revision approval
        frappe.db.commit()
        frappe.publish_realtime(
            event="po:revision_approved",
            message={
                "po_id": revision_doc.revised_po,
                "revision_id": revision_name,
                "project": revision_doc.project,
                "diff": diff,
            },
        )

        return "Success"

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "PO Revision Approval Error")
        frappe.throw(_("Approval failed: {0}").format(str(e)))


def _auto_add_payment_term(original_po, diff, revision_id):
    """
    For positive diff: adds a single 'Created' payment term labeled
    'Revision Adjustment - {revision_id}' and rebalances percentages.
    Returns list of auto-entry dicts for PO Adjustment child table.
    """
    existing_payment_type = "Cash"
    if original_po.payment_terms:
        existing_payment_type = original_po.payment_terms[0].payment_type

    new_term_data = {
        "label": frappe.utils.cstr(f"Revision Adjustment - {revision_id}")[:140],
        "amount": flt(diff),
        "vendor": original_po.vendor,
        "project": original_po.project,
        "term_status": "Created",
        "payment_type": existing_payment_type,
    }

    if existing_payment_type == "Credit":
        new_term_data["due_date"] = frappe.utils.add_days(frappe.utils.nowdate(), 2)

    original_po.append("payment_terms", new_term_data)

    # Rebalance percentages
    original_po.calculate_totals_from_items()
    new_total = flt(original_po.total_amount)
    if new_total > 0:
        for term in original_po.get("payment_terms", []):
            term.percentage = flt((flt(term.amount) / new_total) * 100, 2)

    return [
        {
            "entry_type": "Revision Impact",
            "amount": flt(diff),
            "description": f"PO amount increased by ₹{flt(diff):,.2f} due to revision {revision_id}",
            "revision_id": revision_id,
        },
        {
            "entry_type": "Term Addition",
            "amount": -flt(diff),
            "description": f"Auto-created payment term to cover revision {revision_id}",
            "revision_id": revision_id,
        },
    ]


def _auto_absorb_created_terms(original_po, abs_diff, revision_id):
    """
    For negative diff: LIFO-reduces 'Created' terms to absorb the reduction.
    Returns list of auto-entry dicts for PO Adjustment child table.

    Double-entry accounting:
      1. "Revision Impact" = -abs_diff  (the problem: PO amount decreased)
      2. "Auto Absorb"     = +reduction (the resolution: absorbed from Created terms)
      Net = -abs_diff + total_absorbed. If fully absorbed → 0 (Done). Else negative (Pending).
    """
    absorbed = 0.0

    # Lead with the full impact entry
    entries = [{
        "entry_type": "Revision Impact",
        "amount": -flt(abs_diff),
        "description": f"PO amount decreased by ₹{flt(abs_diff):,.2f} due to revision {revision_id}",
        "revision_id": revision_id,
    }]

    # Get modifiable terms in reverse order (LIFO)
    modifiable_terms = [t for t in original_po.payment_terms if t.term_status == "Created"]

    for term in reversed(modifiable_terms):
        if absorbed >= abs_diff - 0.01:
            break

        term_amount = flt(term.amount)
        reduction = min(term_amount, abs_diff - absorbed)

        if reduction > 0:
            term.amount = term_amount - reduction
            absorbed += reduction

            entries.append({
                "entry_type": "Auto Absorb",
                "amount": flt(reduction),
                "description": f"Absorbed ₹{flt(reduction):,.2f} from term '{term.label}'",
                "revision_id": revision_id,
            })

    # Remove zero-amount Created terms
    remaining_terms = [t for t in original_po.payment_terms
                       if not (t.term_status == "Created" and flt(t.amount) <= 0.01)]
    original_po.set("payment_terms", [t.as_dict() for t in remaining_terms])

    # Rebalance percentages
    original_po.calculate_totals_from_items()
    new_total = flt(original_po.total_amount)
    if new_total > 0:
        for term in original_po.get("payment_terms", []):
            if term.term_status == "Return":
                term.percentage = 0.0
            else:
                term.percentage = flt((flt(term.amount) / new_total) * 100, 2)

    return entries


def _create_or_update_adjustment(revision_doc, diff, auto_entries):
    """
    Creates or updates the PO Adjustment doc for the original PO.
    Appends auto-generated entries from the revision approval.
    """
    po_id = revision_doc.revised_po
    adj_name = frappe.db.get_value("PO Adjustments", {"po_id": po_id}, "name")

    if adj_name:
        adj_doc = frappe.get_doc("PO Adjustments", adj_name)
    else:
        adj_doc = frappe.new_doc("PO Adjustments")
        adj_doc.po_id = po_id
        adj_doc.project = revision_doc.project
        adj_doc.vendor = revision_doc.vendor
        adj_doc.status = "Pending"
        adj_doc.remaining_impact = 0
        adj_doc.insert(ignore_permissions=True)

    for entry in auto_entries:
        adj_doc.append("adjustment_items", {
            "entry_type": entry["entry_type"],
            "amount": flt(entry["amount"]),
            "description": entry.get("description", ""),
            "revision_id": entry.get("revision_id"),
            "timestamp": nowdate(),
        })

    adj_doc.recalculate_remaining_impact()


def _get_item_metadata(item_id):
    """Fetches category and procurement_package based on item_id."""
    if not item_id:
        return None, None
    category = frappe.db.get_value("Items", item_id, "category")
    package = None
    if category:
        package = frappe.db.get_value("Category", category, "work_package")
    return category, package


def sync_original_po_items(revision_doc):
    """
    Mirrors item changes (Original, New, Revised, Replace, Deleted) back to the Original PO.
    """
    original_po = frappe.get_doc("Procurement Orders", revision_doc.revised_po)

    original_item_map = {row.name: row for row in original_po.get("items", [])}

    for rev_item in revision_doc.get("revision_items", []):

        if rev_item.item_type == "Original":
            rev_item.item_status = "Approved"
            continue

        elif rev_item.item_type == "New":
            new_row = original_po.append("items", {})
            new_row.item_id = rev_item.revision_item_id
            new_row.item_name = rev_item.revision_item_name
            new_row.quantity = flt(rev_item.revision_qty)
            new_row.unit = rev_item.revision_unit
            new_row.quote = flt(rev_item.revision_rate)
            new_row.amount = flt(rev_item.revision_amount)
            new_row.tax = flt(rev_item.revision_tax)
            new_row.make = rev_item.revision_make
            new_row.tax_amount = (new_row.amount * new_row.tax) / 100
            new_row.total_amount = new_row.amount + new_row.tax_amount
            new_row.received_quantity = 0.0

            if original_po.status in ("Partially Dispatched", "Dispatched", "Partially Delivered", "Delivered"):
                new_row.is_dispatched = 1

            cat = rev_item.revision_category
            pkg = rev_item.revision_procurement_package

            if not cat or not pkg:
                fetched_cat, fetched_pkg = _get_item_metadata(new_row.item_id)
                cat = cat or fetched_cat
                pkg = pkg or fetched_pkg

            if not cat:
                frappe.throw(_("Category is missing for item '{0}'. Please reject this draft and recreate the revision.").format(new_row.item_name))

            new_row.category = cat
            new_row.procurement_package = pkg

            rev_item.item_status = "Approved"

        elif rev_item.item_type == "Revised":
            if rev_item.original_row_id in original_item_map:
                orig_row = original_item_map[rev_item.original_row_id]
                orig_row.quantity = flt(rev_item.revision_qty)
                orig_row.unit = rev_item.revision_unit
                orig_row.quote = flt(rev_item.revision_rate)
                orig_row.amount = flt(rev_item.revision_amount)
                orig_row.tax = flt(rev_item.revision_tax)
                orig_row.make = rev_item.revision_make
                orig_row.tax_amount = (orig_row.amount * orig_row.tax) / 100
                orig_row.total_amount = orig_row.amount + orig_row.tax_amount

                if rev_item.revision_category:
                    orig_row.category = rev_item.revision_category
                if rev_item.revision_procurement_package:
                    orig_row.procurement_package = rev_item.revision_procurement_package

                if not orig_row.category:
                    orig_row.category, orig_row.procurement_package = _get_item_metadata(orig_row.item_id)
                if not orig_row.category:
                    frappe.throw(_("Category is required for Revised Item '{0}'. Please recreate this revision.").format(orig_row.item_name))

                rev_item.item_status = "Approved"
            else:
                frappe.throw(_("Original item row {0} not found for revision.").format(rev_item.original_row_id))

        elif rev_item.item_type == "Replace":
            if rev_item.original_row_id in original_item_map:
                orig_row = original_item_map[rev_item.original_row_id]

                orig_row.item_id = rev_item.revision_item_id
                orig_row.item_name = rev_item.revision_item_name

                orig_row.quantity = flt(rev_item.revision_qty)
                orig_row.unit = rev_item.revision_unit
                orig_row.quote = flt(rev_item.revision_rate)
                orig_row.amount = flt(rev_item.revision_amount)
                orig_row.tax = flt(rev_item.revision_tax)
                orig_row.make = rev_item.revision_make
                orig_row.tax_amount = (orig_row.amount * orig_row.tax) / 100
                orig_row.total_amount = orig_row.amount + orig_row.tax_amount

                if rev_item.revision_category:
                    orig_row.category = rev_item.revision_category
                if rev_item.revision_procurement_package:
                    orig_row.procurement_package = rev_item.revision_procurement_package

                if not orig_row.category:
                    orig_row.category, orig_row.procurement_package = _get_item_metadata(orig_row.item_id)
                if not orig_row.category:
                    frappe.throw(_("Category is required for Replaced Item '{0}'. Please recreate this revision.").format(orig_row.item_name))

                if not getattr(orig_row, 'received_quantity', None):
                    orig_row.received_quantity = 0.0

                rev_item.item_status = "Approved"
            else:
                frappe.throw(_("Original row '{0}' not found. Cannot perform Replacement.").format(rev_item.original_row_id))

        elif rev_item.item_type == "Deleted":
            if rev_item.original_row_id in original_item_map:
                orig_row = original_item_map[rev_item.original_row_id]

                if flt(getattr(orig_row, 'received_quantity', 0)) > 0:
                    frappe.throw(_("Cannot delete item {0} as it has already received quantity.").format(orig_row.item_id))

                original_po.get("items").remove(orig_row)
                rev_item.item_status = "Approved"

    # Re-calculate parent totals
    original_po.calculate_totals_from_items()

    # Re-evaluate status after item sync
    if original_po.status in ("Partially Dispatched", "Partially Delivered", "Delivered"):
        updated_items = original_po.get("items", [])
        dispatchable = [i for i in updated_items if i.category != "Additional Charges"]
        has_undispatched = any(not getattr(i, 'is_dispatched', 0) for i in dispatchable)

        if has_undispatched:
            original_po.status = "Partially Dispatched"
        elif original_po.status in ("Partially Delivered", "Delivered"):
            original_po.status = calculate_order_status(updated_items)
            original_po.po_amount_delivered = calculate_delivered_amount(updated_items)
        else:
            has_deliveries = any(flt(getattr(i, 'received_quantity', 0)) > 0 for i in dispatchable)
            if has_deliveries:
                original_po.status = calculate_order_status(updated_items)
                original_po.po_amount_delivered = calculate_delivered_amount(updated_items)
            else:
                original_po.status = "Dispatched"
                original_po.status = calculate_order_status(updated_items)

    original_po.flags.ignore_validate_update_after_submit = True
    original_po.save(ignore_permissions=True)


@frappe.whitelist()
def on_reject_revision(revision_name):
    revision_doc = frappe.get_doc("PO Revisions", revision_name, for_update=True)

    if revision_doc.status in ["Approved", "Rejected"]:
        frappe.throw(_("This revision cannot be rejected in its current state."))

    try:
        revision_doc.status = "Rejected"
        revision_doc.save(ignore_permissions=True)
        return "Success"
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "PO Revision Rejection Error")
        frappe.throw(_("Rejection failed: {0}").format(str(e)))
