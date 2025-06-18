import frappe
import json # Ensure json is imported
from frappe.utils import cint, flt

@frappe.whitelist()
def generate_pos_from_selection(project_id: str, pr_name: str, selected_items: list, selected_vendors: dict, custom : bool = False ):
    """
    Generates Procurement Orders based on selected items and vendors, and updates the Procurement Request.

    Args:
        project_id (str): The ID of the project.
        pr_name (str): The name of the Procurement Request.
        selected_items (list): A list of selected item names for PO generation.
        selected_vendors (dict): A dictionary mapping item names to vendor IDs for PO generation.
        custom (bool): A flag to indicate if custom handling is needed.
    """
    try:
        # Fetch the Procurement Request, lock for update
        pr_doc = frappe.get_doc("Procurement Requests", pr_name, for_update=True)
        if not pr_doc:
            raise frappe.ValidationError(f"Procurement Request {pr_name} not found.")


        # Ensure selected_items and selected_vendors are Python objects
        if isinstance(selected_items, str):
            selected_items = json.loads(selected_items)
        if isinstance(selected_vendors, str):
            selected_vendors = json.loads(selected_vendors)

        # Determine if custom based on PR doc, preferring it over payload for consistency
        is_pr_custom = not pr_doc.work_package 

        # --- Group selected PR child items by vendor ---
        # vendor_po_items_details: vendor_id -> list of dicts (for Purchase Order Item child table)
        vendor_po_items_details = {}
        processed_pr_child_item_names_for_status_update = set() # Child doc names to update status

        selected_item_ids_set = set(selected_items) # For efficient lookup

        project_doc = None # To fetch project details once
        if pr_doc.project:
            project_doc = frappe.get_doc("Projects", pr_doc.project)


        for pr_child_item in pr_doc.order_list: # Iterate through PR's child table
            if pr_child_item.item_id in selected_item_ids_set:
                # This item was selected for PO generation.
                # The vendor_id for this item should come from the selected_vendors payload,
                # as the pr_child_item.vendor might be from a previous selection if the flow allows re-selection here.
                # However, if the UI strictly shows pr_child_item.vendor as the one being approved, then
                # selected_vendors[pr_child_item.item_id] should match pr_child_item.vendor.
                
                vendor_id_for_item = selected_vendors.get(pr_child_item.item_id)
                if not vendor_id_for_item:
                    # This should ideally not happen if frontend sends consistent data
                    frappe.log_error(f"Vendor not found in payload for selected item {pr_child_item.item_id} in PR {pr_name}", "generate_pos_from_selection")
                    continue # Skip this item if no vendor specified in payload

                # The quote should come from pr_child_item.quote, as this is what was approved.
                if pr_child_item.quote is None:
                    frappe.throw(f"Quote not found for selected item {pr_child_item.item_id} (child: {pr_child_item.name}) in PR {pr_name}.")
                
                item_quote_rate = flt(pr_child_item.quote)
                item_quantity = flt(pr_child_item.quantity)
                item_tax_percentage = flt(pr_child_item.tax) # Assuming 'tax' field on PR child item is the rate (e.g., 18 for 18%)

                base_amount = item_quantity * item_quote_rate
                calculated_tax_amount = base_amount * (item_tax_percentage / 100.0)
                final_total_amount = base_amount + calculated_tax_amount

                po_item_dict = {
                    "item_id": pr_child_item.item_id,
                    "item_name": pr_child_item.item_name,
                    "unit": pr_child_item.unit,
                    "quantity": item_quantity, # Quantity Ordered
                    "category": pr_child_item.category,
                    "procurement_package": pr_child_item.procurement_package, # Or pr_doc.work_package if custom
                    "quote": item_quote_rate, # Quoted Rate that was approved
                    "amount": base_amount,
                    "make": pr_child_item.make, # Selected make from PR item
                    "tax": item_tax_percentage, # Tax Rate
                    "tax_amount": calculated_tax_amount,
                    "total_amount": final_total_amount,
                    "comment": pr_child_item.comment,
                    "procurement_request_item": pr_child_item.name # Link to the PR child table row
                }

                if vendor_id_for_item not in vendor_po_items_details:
                    vendor_po_items_details[vendor_id_for_item] = []
                
                vendor_po_items_details[vendor_id_for_item].append(po_item_dict)
                processed_pr_child_item_names_for_status_update.add(pr_child_item.name)

        if not vendor_po_items_details:
            # This means selected_items might have been empty or matched no processable items.
            # Update statuses if any were changed for other reasons (though unlikely in this specific flow path)
            # For now, just return if no items are to be put on PO.
            # The PR status update logic below will still run if any child item status changed earlier.
            if selected_items: # If items were selected but none processed, it's an issue
                 frappe.msgprint(f"Warning: Selected items {selected_items} from PR {pr_name} could not be processed for PO. Check item data and selections.", indicator="orange", alert=True)
            # No POs to create, but PR save might still be needed if statuses were updated elsewhere.
            # However, this function's main job is PO creation.

        latest_po_name = None
        created_po_names = []

        # --- Create Procurement Orders: one per vendor ---
        for vendor_id, po_items_list_for_vendor in vendor_po_items_details.items():
            vendor_doc = frappe.get_doc("Vendors", vendor_id)
            
            po_doc = frappe.new_doc("Procurement Orders")
            po_doc.procurement_request = pr_name # Link back to the source PR
            po_doc.project = pr_doc.project
            if project_doc:
                po_doc.project_name = project_doc.project_name
                po_doc.project_address = project_doc.project_address
                # po_doc.project_gst = project_doc.gst_no # If your Project Doctype has this

            po_doc.vendor = vendor_id
            po_doc.vendor_name = vendor_doc.vendor_name
            po_doc.vendor_address = vendor_doc.vendor_address
            po_doc.vendor_gst = vendor_doc.vendor_gst
            
            if is_pr_custom: # Check based on PR's nature
                po_doc.custom = "true" # Set the custom flag on PO
            
            # Populate the 'items' child table for the PO
            for po_item_entry in po_items_list_for_vendor:
                po_doc.append("items", po_item_entry)
            
            # Calculate PO header totals (amount, tax_amount, total_amount)
            # This is often better done in PO's before_save hook, but can be done here too.
            po_header_amount = sum(item.get("amount", 0) for item in po_doc.items)
            po_header_tax_amount = sum(item.get("tax_amount", 0) for item in po_doc.items)
            po_doc.amount = po_header_amount
            po_doc.tax_amount = po_header_tax_amount
            po_doc.total_amount = po_header_amount + po_header_tax_amount

            po_doc.insert(ignore_permissions=True)
            latest_po_name = po_doc.name
            created_po_names.append(po_doc.name)

        # --- Update status of processed items in the Procurement Request's child table ---
        pr_state_potentially_changed = False
        if processed_pr_child_item_names_for_status_update:
            for pr_child_item_doc_to_update in pr_doc.order_list:
                if pr_child_item_doc_to_update.name in processed_pr_child_item_names_for_status_update:
                    if pr_child_item_doc_to_update.status != "Approved": # Or "PO Generated"
                        pr_child_item_doc_to_update.status = "Approved" 
                        pr_state_potentially_changed = True
        
        # --- Update PR Workflow State based on all child item statuses ---
        if pr_state_potentially_changed or not created_po_names: # Re-evaluate state if items changed or no POs made but func called
            all_pr_items_finalized = True # Approved, PO Generated, Delayed, Rejected, Cancelled
            terminal_item_statuses = ["Approved", "PO Generated", "Delayed", "Rejected", "Cancelled"]
            has_any_approved_now = False

            for item_in_pr in pr_doc.order_list:
                if item_in_pr.status not in terminal_item_statuses:
                    all_pr_items_finalized = False
                if item_in_pr.status in ["Approved", "PO Generated"]:
                    has_any_approved_now = True
            
            current_pr_workflow_state = pr_doc.workflow_state
            new_pr_workflow_state = current_pr_workflow_state
            
            # Define PR's own terminal workflow states where it shouldn't be auto-updated by this script
            # unless moving from a less final to a more final state (e.g. Partially Approved -> Vendor Approved)
            pr_non_updatable_states = ["Closed", "Cancelled", "Rejected"] # States this script won't change from

            if current_pr_workflow_state not in pr_non_updatable_states:
                if all_pr_items_finalized:
                    if has_any_approved_now: # If all finalized and some were approved
                        new_pr_workflow_state = "Vendor Approved"
                    elif not any(s in ["Pending", "Sent Back"] for s in [item.status for item in pr_doc.order_list]):
                        # If all finalized but none were approved (e.g., all became Delayed/Rejected)
                        # This state might be set by another process (e.g., all Delayed might set PR to Delayed)
                        # For now, if it reaches here and all are finalized without new approvals, it might stay or go to a relevant state.
                        # If all are "Delayed", another process should set PR to "Delayed".
                        # If all are "Rejected" by some other means, it would be "Rejected".
                        pass # Avoid changing if no items were actioned to Approved here.
                elif has_any_approved_now: # Some approved, but not all items finalized
                    new_pr_workflow_state = "Partially Approved"
                # If no items were approved in this run, and not all are finalized, state might remain as is
                # e.g., "Vendor Selected" if some are still pending and others were delayed by another process.

                if new_pr_workflow_state != current_pr_workflow_state:
                    pr_doc.workflow_state = new_pr_workflow_state
                    pr_state_potentially_changed = True # Ensure save happens if state changed

        if pr_state_potentially_changed:
            pr_doc.save(ignore_permissions=True)

        message = f"Procurement Order(s): {', '.join(created_po_names)} created successfully." if created_po_names else "No Purchase Orders generated."
        if pr_state_potentially_changed:
            message += f" PR {pr_name} updated."
            
        return {
            "message": message,
            "status": 200,
            "po": latest_po_name, # Last PO name
            "created_pos": created_po_names # List of all POs created
        }

    except frappe.exceptions.WorkflowTransitionNotAllowedError as wf_err:
        # ... (existing error handling) ...
        frappe.log_error(message=f"Workflow transition error in generate_pos_from_selection for PR {pr_name}: {wf_err}", title="PO Generation Workflow Error")
        return {"error": str(wf_err), "status": 400, "message": f"Workflow Error: {str(wf_err)}"}
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="PO Generation Failed")
        return {"error": str(e), "status": 400, "message": f"Error: {str(e)}"}