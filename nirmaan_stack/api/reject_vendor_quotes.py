# Path: nirmaan_stack/api/approve_reject_sb_vendor_quotes.py (or similar)
import frappe
import json
from frappe.utils import flt

@frappe.whitelist()
def new_handle_approve(sb_id: str, selected_items: list, project_id: str, selected_vendors: dict):
    """
    Approves selected items from a Sent Back Category, creates Procurement Orders,
    and updates the Sent Back Category document.

    Args:
        sb_id (str): The name of the Sent Back Category document.
        selected_items (list or str): List of selected item_ids from the SB doc's order_list.
        project_id (str): Project ID. (Can also be derived from sb_doc.project)
        selected_vendors (dict or str): A dictionary mapping item_id to vendor_id for the selected items.
                                        (This implies vendor might be re-confirmed or changed at this stage)
    """
    try:
        sb_doc = frappe.get_doc("Sent Back Category", sb_id, for_update=True)
        if not sb_doc:
            raise frappe.ValidationError(f"Sent Back Category {sb_id} not found.")

        if isinstance(selected_items, str): selected_items = json.loads(selected_items)
        if isinstance(selected_vendors, str): selected_vendors = json.loads(selected_vendors)

        # --- Group selected SB child items by vendor ---
        vendor_po_items_details = {} # vendor_id -> list of dicts for Purchase Order Item child table
        processed_sb_child_item_names_for_status_update = set()

        selected_item_ids_set = set(selected_items)

        project_doc = None
        if sb_doc.project: # Use project from SB doc
            project_doc = frappe.get_doc("Projects", sb_doc.project)

        # Iterate through the Sent Back Category's child table 'order_list'
        for sb_child_item in sb_doc.order_list:
            if sb_child_item.item_id in selected_item_ids_set:
                # This item was selected from SB doc for PO.
                # The vendor for this item should come from the selected_vendors payload.
                vendor_id_for_item = selected_vendors.get(sb_child_item.item_id)
                if not vendor_id_for_item:
                    frappe.log_error(f"Vendor not found in payload for selected SB item {sb_child_item.item_id} from SB Doc {sb_id}", "new_handle_approve_sb")
                    continue

                # The quote for this item comes from the sb_child_item itself.
                if sb_child_item.quote is None:
                    frappe.throw(f"Quote not found for selected item {sb_child_item.item_id} (child: {sb_child_item.name}) in SB Doc {sb_id}.")

                item_quote_rate = flt(sb_child_item.quote)
                item_quantity = flt(sb_child_item.quantity)
                item_tax_percentage = flt(sb_child_item.tax)

                base_amount = item_quantity * item_quote_rate
                calculated_tax_amount = base_amount * (item_tax_percentage / 100.0)
                final_total_amount = base_amount + calculated_tax_amount

                po_item_dict = {
                    "item_id": sb_child_item.item_id,
                    "item_name": sb_child_item.item_name,
                    "unit": sb_child_item.unit,
                    "quantity": item_quantity,
                    "category": sb_child_item.category,
                    "procurement_package": sb_child_item.procurement_package, # From SB item
                    "quote": item_quote_rate,
                    "amount": base_amount,
                    "make": sb_child_item.make,
                    "tax": item_tax_percentage,
                    "tax_amount": calculated_tax_amount,
                    "total_amount": final_total_amount,
                    "comment": sb_child_item.comment,
                    # For PO created from SB, link procurement_request_item to the SB child item?
                    # Or should it trace back to the *original* PR child item if possible?
                    # For now, let's assume we link to the SB item that triggered this PO.
                    # "procurement_request_item": sb_child_item.name  // This would link to "Sent Back Item Detail"
                    # If Sent Back Category stores original PR item name, use that.
                    # If sb_child_item has a field like 'original_pr_item_name', use it:
                    # "procurement_request_item": sb_child_item.get("original_pr_item_name") or sb_child_item.name
                    # For simplicity, if not available, we might leave it blank or link to SB item.
                    # Let's assume for now it's about the SB item.
                    "procurement_request_item": sb_child_item.name, # This links to the SB child item
                }

                if vendor_id_for_item not in vendor_po_items_details:
                    vendor_po_items_details[vendor_id_for_item] = []
                vendor_po_items_details[vendor_id_for_item].append(po_item_dict)
                processed_sb_child_item_names_for_status_update.add(sb_child_item.name)


        if not vendor_po_items_details:
            if selected_items:
                 frappe.msgprint(f"Warning: Selected items {selected_items} from SB {sb_id} could not be processed for PO.", indicator="orange", alert=True)
            # No POs to create, proceed to update SB doc status
        
        latest_po_name = None
        created_po_names = []

        # --- Create Procurement Orders ---
        for vendor_id, po_items_list_for_vendor in vendor_po_items_details.items():
            vendor_doc = frappe.get_doc("Vendors", vendor_id)
            po_doc = frappe.new_doc("Procurement Orders")
            
            # PO should link to the original PR, not the SB doc, for traceability.
            po_doc.procurement_request = sb_doc.procurement_request
            po_doc.project = sb_doc.project # Project from SB doc
            if project_doc:
                po_doc.project_name = project_doc.project_name
                po_doc.project_address = project_doc.project_address
                # po_doc.project_gst = project_doc.gst_no

            po_doc.vendor = vendor_id
            po_doc.vendor_name = vendor_doc.vendor_name
            po_doc.vendor_address = vendor_doc.vendor_address
            po_doc.vendor_gst = vendor_doc.vendor_gst

            # Determine if the PO derived from SB is "custom"
            # This depends on the nature of the original PR.
            original_pr_is_custom = not frappe.db.get_value("Procurement Requests", sb_doc.procurement_request, "work_package")
            if original_pr_is_custom:
                 po_doc.custom = "true"

            for po_item_entry in po_items_list_for_vendor:
                po_doc.append("items", po_item_entry)

            po_header_amount = sum(item.get("amount", 0) for item in po_doc.items)
            po_header_tax_amount = sum(item.get("tax_amount", 0) for item in po_doc.items)
            po_doc.amount = po_header_amount
            po_doc.tax_amount = po_header_tax_amount
            po_doc.total_amount = po_header_amount + po_header_tax_amount
            
            po_doc.insert(ignore_permissions=True)
            latest_po_name = po_doc.name
            created_po_names.append(po_doc.name)

        # --- Update Sent Back Category items and workflow state ---
        sb_state_changed = False
        if processed_sb_child_item_names_for_status_update:
            for sb_child_item_doc_to_update in sb_doc.order_list:
                if sb_child_item_doc_to_update.name in processed_sb_child_item_names_for_status_update:
                    if sb_child_item_doc_to_update.status != "Approved":
                        sb_child_item_doc_to_update.status = "Approved"
                        sb_state_changed = True
        
        if sb_state_changed: # Only update workflow if item statuses actually changed
            total_items_in_sb = len(sb_doc.order_list)
            approved_items_in_sb = sum(1 for item in sb_doc.order_list if item.status == "Approved")

            if approved_items_in_sb == total_items_in_sb:
                sb_doc.workflow_state = "Approved"
            elif approved_items_in_sb > 0 : # Some approved, but not all
                sb_doc.workflow_state = "Partially Approved"
            # If no items were approved from this SB doc in this run, its state might not change,
            # or it might depend on whether other items are still 'Pending' or 'Sent Back' within it.
            # For simplicity, if items were processed, it's either Approved or Partially Approved.
            # If no items were processed (e.g. selection was empty), state doesn't change via this path.
        
        # Save SB doc if anything changed (item statuses or workflow state)
        if sb_state_changed or (sb_doc.workflow_state != sb_doc.get_doc_before_save().workflow_state if sb_doc.get_doc_before_save() else False) :
             sb_doc.save(ignore_permissions=True)
        
        message = f"Procurement Order(s): {', '.join(created_po_names)} created successfully from SB {sb_id}." if created_po_names else f"No Purchase Orders generated from SB {sb_id}."
        if sb_state_changed:
            message += f" Sent Back Category {sb_id} updated."

        return {"message": message, "status": 200, "po": latest_po_name, "created_pos": created_po_names}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "new_handle_approve_sb")
        return {"error": str(e), "status": 400}