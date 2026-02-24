import frappe
from frappe import _
from frappe.utils import flt, nowdate
import json

@frappe.whitelist()
def make_po_revisions(po_id, justification, revision_items, total_amount_difference, payment_return_details):
    """
    Creates a new draft 'PO Revisions' entry from an existing 'Procurement Orders'
    and populates it with revision data.
    """
    try:
        po = frappe.get_doc("Procurement Orders", po_id)
        
        rev_po = frappe.new_doc("PO Revisions")
        rev_po.revised_po = po_id
        rev_po.project = po.project
        # rev_po.project_name = getattr(po, 'project_name', '')
        rev_po.vendor = po.vendor
        # rev_po.vendor_name = getattr(po, 'vendor_name', '')
        rev_po.status = "Pending"
        rev_po.revision_justification = justification
        rev_po.total_amount_difference = flt(total_amount_difference)
        
        # Ensure payment_return_details is a string before saving
        if not isinstance(payment_return_details, str):
            rev_po.payment_return_details = json.dumps(payment_return_details)
        else:
            rev_po.payment_return_details = payment_return_details
        
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

            rev_po.append("revision_items", row_data)
            
        rev_po.save(ignore_permissions=True)
        return rev_po.name

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Make PO Revisions API Error")
        frappe.throw(str(e))


@frappe.whitelist()
def on_approval_revision(revision_name):
    """
    Handles the actual application of changes to the Original PO and financials.
    Triggered when the manager Approves the PO Revision.
    """
    revision_doc = frappe.get_doc("PO Revisions", revision_name)
    
    if revision_doc.status == "Approved":
        frappe.throw(_("This revision is already approved."))

    frappe.db.begin()
    try:
        # Step 1: Sync Items
        sync_original_po_items(revision_doc)
        
        # Step 2: Handle Financial Changes
        diff = flt(revision_doc.total_amount_difference)
        if diff > 0:
            process_positive_increase(revision_doc)
        elif diff < 0:
            process_negative_returns(revision_doc)
            
        # Step 3: Finalize Status
        revision_doc.status = "Approved"
        revision_doc.save(ignore_permissions=True)
        
        # Step 4: Unlock the original PO (if we locked it)
        frappe.db.set_value("Procurement Orders", revision_doc.revised_po, "is_under_revision", 0)
        
        frappe.db.commit()
        return "Success"

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "PO Revision Approval Error")
        frappe.throw(_("Approval failed: {0}").format(str(e)))


def sync_original_po_items(revision_doc):
    """
    Mirrors item changes (Original, New, Revised, Replace, Deleted) back to the Original PO.
    """
    original_po = frappe.get_doc("Procurement Orders", revision_doc.revised_po)
    
    # Map original items by their row 'name' for O(1) access
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
            new_row.tax = flt(rev_item.revision_tax) # Changed to tax
            new_row.make = rev_item.revision_make
            new_row.tax_amount = (new_row.amount * new_row.tax) / 100
            new_row.total_amount = new_row.amount + new_row.tax_amount
            
            rev_item.item_status = "Approved"

        elif rev_item.item_type == "Revised":
            if rev_item.original_row_id in original_item_map:
                orig_row = original_item_map[rev_item.original_row_id]
                orig_row.quantity = flt(rev_item.revision_qty)
                orig_row.unit = rev_item.revision_unit
                orig_row.quote = flt(rev_item.revision_rate)
                orig_row.amount = flt(rev_item.revision_amount)
                orig_row.tax = flt(rev_item.revision_tax) # Changed to tax
                orig_row.make = rev_item.revision_make
                orig_row.tax_amount = (orig_row.amount * orig_row.tax) / 100
                orig_row.total_amount = orig_row.amount + orig_row.tax_amount
                
                rev_item.item_status = "Approved"
            else:
                frappe.throw(_("Original item row {0} not found for revision.").format(rev_item.original_row_id))

        elif rev_item.item_type == "Replace":
            if rev_item.original_row_id in original_item_map:
                orig_row = original_item_map[rev_item.original_row_id]
                
                # Identity change
                orig_row.item_id = rev_item.revision_item_id 
                orig_row.item_name = rev_item.revision_item_name
                
                # Value properties
                orig_row.quantity = flt(rev_item.revision_qty)
                orig_row.unit = rev_item.revision_unit
                orig_row.quote = flt(rev_item.revision_rate)
                orig_row.amount = flt(rev_item.revision_amount)
                orig_row.tax = flt(rev_item.revision_tax) # Changed to tax
                orig_row.make = rev_item.revision_make
                orig_row.tax_amount = (orig_row.amount * orig_row.tax) / 100
                orig_row.total_amount = orig_row.amount + orig_row.tax_amount
                
                rev_item.item_status = "Approved"
            else:
                frappe.throw(_("Original row '{0}' not found. Cannot perform Replacement.").format(rev_item.original_row_id))

        elif rev_item.item_type == "Deleted":
            if rev_item.original_row_id in original_item_map:
                orig_row = original_item_map[rev_item.original_row_id]
                
                # Anti-corruption check: Cannot delete if we've received goods against it
                if flt(getattr(orig_row, 'received_quantity', 0)) > 0:
                    frappe.throw(_("Cannot delete item {0} as it has already received quantity.").format(orig_row.item_id))
                
                original_po.get("items").remove(orig_row)
                rev_item.item_status = "Approved"

    # Re-calculate parent totals if method exists
    if hasattr(original_po, 'calculate_totals_from_items'):
         original_po.calculate_totals_from_items()
         
    original_po.flags.ignore_validate_update_after_submit = True
    original_po.save(ignore_permissions=True)


def process_positive_increase(revision_doc):
    """
    Handles when total_amount_difference > 0.
    Expects: { "list": { "type": "Payment Terms", "Details": [ { "return_type": "Payment-terms", ... } ] } }
    """
    data = revision_doc.payment_return_details
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            data = {}
            
    if not isinstance(data, dict):
        return
        
    block = data.get("list")
    if isinstance(block, dict) and block.get("type") == "Payment Terms":
        block["status"] = "Approved"
        # Approve individual entries
        details = block.get("Details", [])
        if isinstance(details, list):
            for entry in details:
                if isinstance(entry, dict):
                    entry["status"] = "Approved"
            
    revision_doc.payment_return_details = json.dumps(data)


def process_negative_returns(revision_doc):
    """
    Handles when total_amount_difference < 0.
    Expects: { "list": { "type": "Refund Adjustment", "Details": [...] } }
    """
    data = revision_doc.payment_return_details
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception as e:
            frappe.throw(_("Invalid JSON in Payment Return Details: {0}").format(str(e)))
        
    if not isinstance(data, dict):
        return
        
    block = data.get("list")
    if not isinstance(block, dict) or block.get("type") != "Refund Adjustment":
        return
        
    entries = block.get("Details", [])
    if not isinstance(entries, list):
        entries = [entries] if entries else []
        
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("status") != "Pending":
            continue
            
        r_type = entry.get("return_type")
        amount = abs(flt(entry.get("amount", 0)))
        
        # Helper to create payment records
        def _create_payment(po_id, project, amt, payment_nature, remarks):
            pay = frappe.new_doc("Project Payments")
            pay.document_type = "Procurement Orders"
            pay.document_name = po_id
            pay.project = project
            pay.vendor = revision_doc.vendor
            pay.amount = amt
            pay.payment_nature = payment_nature 
            pay.remarks = remarks
            pay.status = "Requested"
            pay.payment_date = nowdate()
            pay.save(ignore_permissions=True)
            return pay

        # A. Against-po (formerly Adjustment PO)
        if r_type == "Against-po":
            for target in entry.get("target_pos", []):
                t_po_id = target.get("po_number")
                t_amount = abs(flt(target.get("amount", 0)))
                if not t_po_id or t_amount <= 0: continue
                
                _create_payment(
                    revision_doc.revised_po, revision_doc.project, -t_amount, 
                    "Adjustment Out", f"Transfer to {t_po_id} via Revision {revision_doc.name}"
                )
                _create_payment(
                    t_po_id, revision_doc.project, t_amount, 
                    "Adjustment In", f"Transfer from {revision_doc.revised_po} via Revision {revision_doc.name}"
                )

        # B. Vendor-has-refund (formerly Bank Refund)
        elif r_type == "Vendor-has-refund":
            remarks = f"Bank Return via Revision {revision_doc.name}"
            if entry.get("refund_date"):
                remarks += f". Date: {entry.get('refund_date')}"
            _create_payment(
                revision_doc.revised_po, revision_doc.project, -amount, 
                "Return/Refund", remarks
            )

        # C. Ad-hoc (formerly Adjustment Ad-hoc)
        elif r_type == "Ad-hoc":
            desc = entry.get("ad-hoc_dexription", "")
            comment = entry.get("comment", "")
            remarks = f"Ad-hoc: {desc}. {comment}".strip()
            _create_payment(
                revision_doc.revised_po, revision_doc.project, -amount, 
                "Ad-hoc Adjustment", remarks or f"Adjusted via Revision {revision_doc.name}"
            )

        # D. Payment-terms (if present in negative flow)
        elif r_type == "Payment-terms":
            # Typically positive, but if in negative flow, we just approve it
            pass

        # Update status
        entry["status"] = "Approved"

    # Update overall block status
    block["status"] = "Approved"

    # Save back
    revision_doc.payment_return_details = json.dumps(data)



@frappe.whitelist()
def get_adjustment_candidate_pos(vendor, current_po):
    """
    Returns a list of approved POs for the same vendor that could potentially 
    receive a payment adjustment 'In'.
    """
    return frappe.get_all("Procurement Orders", 
        filters={
            "vendor": vendor,
            "docstatus": 1,
            "name": ["!=", current_po],
            "status": ["not in", ["Cancelled", "Closed"]]
        },
        fields=["name", "total_amount", "vendor_name", "creation", "project", "project_name"],
        order_by="creation desc",
        limit=50
    )
