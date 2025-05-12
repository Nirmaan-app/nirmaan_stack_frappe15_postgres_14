import frappe
import json # Ensure json is imported

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

        # Access procurement_list as a dictionary and get the list
        # Ensure a mutable copy if modifying item statuses directly in this list
        procurement_list_data = frappe.parse_json(pr_doc.procurement_list)
        procurement_list_items = procurement_list_data.get('list', [])
        
        # It's safer to work with a deep copy if you are modifying items
        # and then rebuilding the list. Alternatively, build a new_procurement_list.
        updated_procurement_list_items = [] # We will build a new list

        latest_po_name = None # To return the name of the last created PO

        if custom:
            # Custom PO generation logic
            # This section seems to assume ALL items in procurement_list are for this custom PO.
            if not procurement_list_items:
                return {"message": "No items found for custom approval.", "status": 400, "error": "No items in PR"}

            # Get vendor from the first item (as per original logic)
            first_item = procurement_list_items[0]
            if not first_item or not first_item.get("vendor"):
                return {"message": "Vendor not found for the selected items.", "status": 400, "error": "Vendor missing"}

            vendor_id = first_item["vendor"]
            vendor_doc = frappe.get_doc("Vendors", vendor_id)

            # Create Procurement Order
            po_doc = frappe.new_doc("Procurement Orders")
            po_doc.procurement_request = pr_name
            po_doc.project = project_id
            po_doc.project_name = frappe.get_value("Projects", project_id, "project_name")
            po_doc.project_address = frappe.get_value("Projects", project_id, "project_address")
            po_doc.vendor = vendor_id
            po_doc.vendor_name = vendor_doc.vendor_name
            po_doc.vendor_address = vendor_doc.vendor_address
            po_doc.vendor_gst = vendor_doc.vendor_gst
            # For custom, it seems all items in the PR's current list go into this PO
            po_doc.order_list = json.dumps({"list": procurement_list_items}) # Store as JSON string
            po_doc.custom = "true" # Assuming this is a string field in DB
            po_doc.insert(ignore_permissions=True)
            latest_po_name = po_doc.name

            # Update Procurement Request items status for ALL items in the list
            for item_data in procurement_list_items:
                # Make a copy to avoid modifying the original dict if it's referenced elsewhere
                # (though parse_json usually creates new dicts)
                updated_item = item_data.copy()
                updated_item['status'] = "Approved" # Or "PO Generated"
                updated_procurement_list_items.append(updated_item)

            pr_doc.procurement_list = json.dumps({'list': updated_procurement_list_items})

            # In custom mode, it seems the intention is to always go to Vendor Approved
            # This is fine IF the PR was in a state allowing transition to Vendor Approved.
            # If handle_delayed_items already set it, this save might be redundant for state,
            # but needed for procurement_list update.
            if pr_doc.workflow_state != "Vendor Approved": # Only change if not already there
                 pr_doc.workflow_state = "Vendor Approved"
            pr_doc.save(ignore_permissions=True)

            return {"message": f"New PO: {latest_po_name} created successfully (custom).", "status": 200, "po": latest_po_name}

        else:
            # Standard PO generation (non-custom)
            vendor_items_for_po = {}
            rfq_data = frappe.parse_json(pr_doc.rfq_data) if pr_doc.rfq_data else {}
            rfq_details = rfq_data.get("details", {})

            # Iterate over ALL items in the PR's procurement list to build the updated list
            # and identify which ones are part of THIS PO generation batch
            for item_data in procurement_list_items:
                updated_item = item_data.copy() # Work with a copy

                if item_data.get("name") in selected_items:
                    vendor_id = selected_vendors.get(item_data["name"])
                    if vendor_id:
                        # This item is part of the current PO generation batch
                        updated_item['status'] = "Approved" # Mark as Approved (or "PO Generated")

                        # Construct "makes" field for the PO item
                        item_rfq_details = rfq_details.get(item_data["name"], {})
                        makes_list_from_rfq = item_rfq_details.get("makes", [])
                        item_original_make = item_data.get("make")

                        makes_formatted_for_po = {"list": []}
                        for make_option in makes_list_from_rfq:
                            is_selected_make = "true" if item_original_make == make_option else "false"
                            makes_formatted_for_po["list"].append({"make": make_option, "enabled": is_selected_make})
                        
                        # Add 'makes' to the item copy that goes into the PO
                        item_for_po = updated_item.copy() # Copy again specifically for PO list
                        item_for_po["makes"] = json.dumps(makes_formatted_for_po) # Store as JSON string

                        if vendor_id not in vendor_items_for_po:
                            vendor_items_for_po[vendor_id] = []
                        vendor_items_for_po[vendor_id].append(item_for_po)
                
                updated_procurement_list_items.append(updated_item)


            # Create Procurement Orders for the grouped items
            if not vendor_items_for_po:
                 # This case should ideally be caught by the caller (handle_delayed_items)
                 # or means selected_items/selected_vendors was empty or mismatched.
                 pr_doc.procurement_list = json.dumps({'list': updated_procurement_list_items})
                 pr_doc.save(ignore_permissions=True) # Save updated item statuses even if no POs
                 return {"message": "No items/vendors provided for PO generation or items not found in PR.", "status": 200, "po": None}


            for vendor_id, items_for_this_po in vendor_items_for_po.items():
                vendor_doc = frappe.get_doc("Vendors", vendor_id)
                po_doc = frappe.new_doc("Procurement Orders")
                po_doc.procurement_request = pr_name
                po_doc.project = project_id
                po_doc.project_name = frappe.get_value("Projects", project_id, "project_name")
                po_doc.project_address = frappe.get_value("Projects", project_id, "project_address")
                po_doc.vendor = vendor_id
                po_doc.vendor_name = vendor_doc.vendor_name
                po_doc.vendor_address = vendor_doc.vendor_address
                po_doc.vendor_gst = vendor_doc.vendor_gst
                po_doc.order_list = json.dumps({"list": items_for_this_po}) # Store as JSON string
                po_doc.insert(ignore_permissions=True)
                latest_po_name = po_doc.name # Keep track of the last PO name


            # Update the PR's procurement_list with new statuses
            pr_doc.procurement_list = json.dumps({'list': updated_procurement_list_items})

            # --- Workflow State Logic for PR (Crucial Change) ---
            # The PR's workflow_state should have been set by the calling function (handle_delayed_items)
            # to "Vendor Approved" if all non-delayed items passed PO validation, or "Vendor Selected" otherwise.
            # This function (generate_pos_from_selection) should *not* try to downgrade it
            # from "Vendor Approved" to "Partially Approved".
            # It should only potentially upgrade it if it's in a state like "Vendor Selected"
            # and *now* all remaining items are "Approved" or "Delayed".

            # Recalculate overall PR status based on the *full* updated_procurement_list_items
            all_items_finalized = True
            for item in updated_procurement_list_items:
                # "Finalized" means either PO generated ("Approved") or intentionally "Delayed".
                # Items still "Pending" (without vendor) or in other intermediate states mean the PR is not fully done.
                if item.get("status") not in ["Approved", "Delayed", "PO Generated"]: # Add "PO Generated" if you use that
                    all_items_finalized = False
                    break
            
            # Only attempt to change workflow state if it's not already "Vendor Approved" by the caller
            # OR if it's "Partially Approved" and now fully finalized.
            current_pr_state = pr_doc.workflow_state
            new_pr_state = current_pr_state # Default to no change

            if current_pr_state not in ["Vendor Approved", "Delayed", "Closed", "Cancelled"]: # Add other "final" states
                if all_items_finalized:
                    new_pr_state = "Vendor Approved"
                else:
                    # Check if any item is "Approved" (PO generated) and others are "Pending" or "Delayed"
                    has_approved = any(item.get("status") == "Approved" for item in updated_procurement_list_items)
                    has_pending_or_delayed = any(item.get("status") in ["Pending", "Delayed"] for item in updated_procurement_list_items)

                    if has_approved and has_pending_or_delayed:
                        new_pr_state = "Partially Approved"
                    # If no items approved yet but some are pending/delayed, it might remain "Vendor Selected" or similar
                    # depending on your workflow. This logic might need refinement based on exact states.

                if new_pr_state != current_pr_state:
                    pr_doc.workflow_state = new_pr_state

            # Save the PR document (with updated list and potentially state)
            pr_doc.save(ignore_permissions=True)

            return {"message": "Procurement Orders created successfully.", "status" : 200, "po": latest_po_name}

    except frappe.exceptions.WorkflowTransitionNotAllowedError as wf_err:
        # Specifically catch workflow errors if they still occur
        frappe.log_error(f"Workflow transition error in generate_pos_from_selection: {wf_err}\nPR: {pr_name}, Current State: {pr_doc.workflow_state if 'pr_doc' in locals() else 'Unknown'}", "generate_pos_from_selection")
        return {"error": str(wf_err), "status": 400}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "generate_pos_from_selection")
        return {"error": str(e), "status" : 400}