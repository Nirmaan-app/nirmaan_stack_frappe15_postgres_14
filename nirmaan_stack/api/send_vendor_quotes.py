import frappe
from frappe.utils import flt

import json # Ensure json is imported if not already
# Import necessary functions from the hooks file
from ..integrations.Notifications.pr_notifications import PrNotification, get_admin_users, get_allowed_lead_users
from ..integrations.controllers.procurement_requests import validate_procurement_request_for_po
from ..api.approve_vendor_quotes import generate_pos_from_selection # Make sure this path is correct


@frappe.whitelist()
def handle_delayed_items(pr_id: str, comments: dict = None):
    """
    Handles delayed items in a Procurement Request, creates Sent Back Category,
    and updates the Procurement Request workflow state.

    Args:
        pr_id (str): The name of the Procurement Request.
        comments (dict, optional): Comments for delayed and approved items. Defaults to None.
    """
    try:
        pr_doc = frappe.get_doc("Procurement Requests", pr_id, for_update=True)
        if not pr_doc:
            raise frappe.ValidationError(f"Procurement Request {pr_id} not found.")
        
        # Make a copy of the original state for comparison if needed later
        original_workflow_state = pr_doc.workflow_state
        custom = True if pr_doc.work_package is None else False # Determine if custom PR

        # procurement_list = frappe.parse_json(pr_doc.procurement_list).get('list', [])
        order_list = pr_doc.get("order_list", [])
        category_list = frappe.parse_json(pr_doc.category_list).get('list', [])
        # RFQ data handling
        rfq_data_pr = {}
        if isinstance(pr_doc.rfq_data, str):
            try:
                rfq_data_pr = frappe.parse_json(pr_doc.rfq_data or '{}')
            except json.JSONDecodeError:
                frappe.log_error(f"Invalid RFQ JSON in PR {pr_id}", "handle_delayed_items")
                rfq_data_pr = {"selectedVendors": [], "details": {}} # Default
        elif isinstance(pr_doc.rfq_data, dict): # If Frappe already parsed it
            rfq_data_pr = pr_doc.rfq_data
        else: # Default if missing or unexpected type
            rfq_data_pr = {"selectedVendors": [], "details": {}}

        selected_vendors = rfq_data_pr.get("selectedVendors", [])
        rfq_details = rfq_data_pr.get("details", {})

        delayed_items_details = [] # Store full details for Sent Back
        delayed_item_names = []    # Store just names for status update
        items_with_vendors = []  # Store items that are not delayed

        new_rfq_details = {} # For Sent Back RFQ data

        for item in order_list:
            # Ensure item is a dict and has 'name'
            if not item.get("item_id"):
                frappe.log_error(f"Invalid item format in PR {pr_id}: {item.as_dict()}", "handle_delayed_items")
                continue # Skip malformed item

            if not item.get("vendor"):
                # Item is delayed
                delayed_item_names.append(item.item_id)
                delayed_items_details.append({
                    "item_id": item.item_id,
                    "item_name": item.item_name,
                    "quantity": flt(item.get("quantity")),
                    "tax": flt(item.get("tax")),
                    "unit": item.get("unit"),
                    "category": item.get("category"),
                    "status": "Pending", # Status in Sent Back should be Pending
                    "comment": item.get("comment"),
                    "procurement_package": item.get("procurement_package") or pr_doc.work_package,
                    "make": item.get("make"),
                    # Add other relevant fields needed by Sent Back Category
                })
                # Add item details to new_rfq_details for the Sent Back doc
                if item.item_id in rfq_details:
                    new_rfq_details[item.item_id] = rfq_details[item.item_id]
            else:
                # Item has a vendor, potentially ready for approval/PO
                items_with_vendors.append(item)




        # Update the original PR's procurement list status
        # updated_procurement_list_items = []
        for item in order_list:
            if item.item_id in delayed_item_names:
                # Mark as Delayed in the original PR
                # updated_procurement_list_items.append({**item, "status": "Delayed"})
                item.status = "Delayed"
            # else:
            #     # Keep original item data (including vendor if present)
            #     updated_procurement_list_items.append(item)

        # Update the PR doc's procurement_list in memory *before* validation/saving
        # pr_doc.procurement_list = json.dumps({"list": updated_procurement_list_items})

        # Create Sent Back Category if there are delayed items
        sent_back_doc_name = None
        if delayed_items_details:
            new_categories = []
            delayed_item_categories = set(item["category"] for item in delayed_items_details)
            # Rebuild category list based only on *delayed* items
            # for item in delayed_items_details:
            #     if not any(cat["name"] == item["category"] for cat in new_categories):
            #         makes = next((cat.get("makes", []) for cat in category_list if cat["name"] == item["category"]), [])
            #         new_categories.append({"name": item["category"], "makes": makes})
            for cat_name in delayed_item_categories:
                # Find original makes for this category from the PR's category_list_json_pr
                original_cat_info = next((c for c in category_list if c.get("name") == cat_name), None)
                makes_for_sbc_cat = original_cat_info.get("makes", []) if original_cat_info else []
                new_categories.append({"name": cat_name, "makes": makes_for_sbc_cat})


            # new_send_back = {
            #     "procurement_request": pr_id,
            #     "project": pr_doc.project,
            #     "category_list": json.dumps({"list": new_categories}), # Store as JSON string
            #     "item_list": json.dumps({"list": delayed_items_details}), # Store as JSON string
            #     "rfq_data": json.dumps({"selectedVendors": selected_vendors, "details": new_rfq_details}), # Store as JSON string
            #     "type": "Delayed",
            #     # Add other mandatory fields for Sent Back Category
            # }

            sent_back_doc = frappe.new_doc("Sent Back Category")
            sent_back_doc.procurement_request = pr_id
            sent_back_doc.project = pr_doc.project
            sent_back_doc.type = "Delayed"
            # Assuming SBC's category_list and rfq_data are still JSON
            sent_back_doc.category_list = json.dumps({"list": new_categories})
            sent_back_doc.rfq_data = json.dumps({
                "selectedVendors": selected_vendors, # Carry over selected vendors for RFQ context
                "details": new_rfq_details
            })

            # Populate the order_list child table for Sent Back Category
            for sbc_item_data in delayed_items_details:
                sent_back_doc.append("order_list", sbc_item_data) # "order_list" is the child table field in SBC

            sent_back_doc.insert(ignore_permissions=True)
            sent_back_doc_name = sent_back_doc.name

            # sent_back_doc.update(new_send_back)
            # sent_back_doc.insert(ignore_permissions=True) # Consider permissions
            # sent_back_doc_name = sent_back_doc.name

            if comments and comments.get("delaying"):
                # Add comment related to the Sent Back document
                comment_doc = frappe.new_doc("Nirmaan Comments")
                comment_doc.comment_type = "Comment"
                comment_doc.reference_doctype = "Sent Back Category"
                comment_doc.reference_name = sent_back_doc_name
                comment_doc.content = comments["delaying"]
                comment_doc.subject = "Creating Sent-Back (Delayed)"
                comment_doc.comment_by = frappe.session.user
                comment_doc.insert(ignore_permissions=True) # Consider permissions


        # Determine the final state of the PR
        final_message = ""
        po_generated = False
        po_details = None

        if not items_with_vendors:
            # All items were delayed
            pr_doc.workflow_state = "Delayed"
            final_message = "All items have been marked as delayed. You can find them in the 'Sent Back Requests' under the delayed tab."
        else:
            # Some items have vendors selected (are not delayed)
            pr_doc.workflow_state = "Vendor Selected" # Tentative state

            # Check if these items are ready for PO (validation)
            # Pass the updated pr_doc object directly to the validation function
            
            is_ready_for_po = validate_procurement_request_for_po(pr_doc)
            # print("is_ready_for_po": {is_ready_for_po})

            if is_ready_for_po:
                pr_doc.workflow_state = "Vendor Approved" # Final state if validation passes
                # Prepare for PO generation - Extract necessary data from the *updated* pr_doc
                # current_procurement_list = json.loads(pr_doc.procurement_list).get('list', [])
                current_order_list = pr_doc.get("order_list", [])
                items_for_po = [item.item_id for item in current_order_list if item.get("status") != "Delayed" and item.get("vendor")]
                selected_vendors_for_po = {item.item_id: item.vendor for item in current_order_list if item.get("status") != "Delayed" and item.get("vendor")}

                # We will generate PO *after* saving the PR successfully
                po_generated = True
                po_items_arr = items_for_po
                po_selected_vendors = selected_vendors_for_po

                if sent_back_doc_name:
                    final_message = f"New Delayed Type Sent Back: {sent_back_doc_name} created. Remaining items passed validation and are approved for PO generation."
                else:
                    final_message = "Items passed validation and are approved for PO generation."

            else:
                # Validation failed, remain in "Vendor Selected" state
                # Notifications for this state will be handled after saving
                if sent_back_doc_name:
                     final_message = f"New Delayed Type Sent Back: {sent_back_doc_name} created. Remaining items require Lead/Admin approval (failed PO validation checks)."
                else:
                     final_message = "Items sent for Lead/Admin approval (failed PO validation checks)."


        # Add approving comment if provided (relates to the PR itself)
        if comments and comments.get("approving"):
            comment_doc = frappe.new_doc("Nirmaan Comments")
            comment_doc.comment_type = "Comment"
            comment_doc.reference_doctype = "Procurement Requests"
            comment_doc.reference_name = pr_id
            comment_doc.content = comments["approving"]
            comment_doc.subject = "PR Vendors Selected / Processed"
            comment_doc.comment_by = frappe.session.user
            comment_doc.insert(ignore_permissions=True) # Consider permissions

        # Save the PR document *ONCE* with the final state and updated list
        pr_doc.save(ignore_permissions=True) # Use ignore_permissions cautiously
        # Set modified_by if needed, after save is successful
        pr_doc.db_set("modified_by", "Administrator", update_modified=False)

        # Generate POs if validation passed
        if po_generated:
            try:
                po_details = generate_pos_from_selection(pr_doc.project, pr_doc.name, po_items_arr, po_selected_vendors, False)
                if po_details and po_details.get('po'):
                    final_message += f" PO {po_details['po']} generated."
                    po_doc = frappe.get_doc("Procurement Orders", po_details['po'])
                    # Optionally set owner or other fields on the PO
                    po_doc.db_set("owner", "Administrator", update_modified=False) # Example
                    # Trigger notifications related to PO creation if needed
                else:
                     final_message += " PO generation initiated." # Or handle error if po_details is unexpected
                     frappe.log_error(f"PO generation might have failed for PR {pr_id}. Details: {po_details}", "handle_delayed_items")
            except Exception as po_e:
                final_message += " Error during PO generation."
                frappe.log_error(f"Error generating PO for PR {pr_id}: {po_e}", "handle_delayed_items PO Generation")

        # Send Notifications for "Vendor Selected" state (if validation failed)
        # This logic is moved from the on_update hook
        if pr_doc.workflow_state == "Vendor Selected":
            lead_admin_users = get_allowed_lead_users(pr_doc) + get_admin_users()
            if lead_admin_users:
                for user in lead_admin_users:
                    # --- Send Push Notification ---
                    if user.get("push_notification") == "true":
                        notification_title = f"Action Required: PR {pr_doc.name} Vendors Selected"
                        notification_body = (
                            f"Hi {user.get('full_name', 'User')}, Vendors selected for PR {pr_doc.name} "
                            f"({'Custom PR' if custom else f'Project {pr_doc.project}, WP {pr_doc.work_package}'}). "
                            "Requires your approval as PO checks failed."
                        )
                        click_action_url = f"{frappe.utils.get_url()}/frontend/purchase-orders?tab=Approve%20PO" # Adjust URL if needed
                        try:
                           PrNotification(user, notification_title, notification_body, click_action_url)
                        except Exception as e:
                           frappe.log_error(f"Failed to send push notification to {user.get('name')}: {e}", "handle_delayed_items Notification")

                    # --- Send In-App Notification ---
                    # (Assuming Nirmaan Notifications DocType exists and logic is similar)
                    try:
                        title = f"PR Requires Approval: {pr_doc.name}"
                        description = f"Vendors selected for PR {pr_doc.name}, but PO validation failed. Please review."
                        message = {
                            "title": title,
                            "description": description,
                            "project": pr_doc.project,
                            "work_package": pr_doc.work_package if not custom else "Custom",
                            "sender": frappe.session.user,
                            "docname": pr_doc.name
                        }
                        new_notification_doc = frappe.new_doc('Nirmaan Notifications')
                        new_notification_doc.recipient = user['name']
                        new_notification_doc.recipient_role = user['role_profile']
                        if frappe.session.user != 'Administrator':
                            new_notification_doc.sender = frappe.session.user
                        new_notification_doc.title = message["title"]
                        new_notification_doc.description = message["description"]
                        new_notification_doc.document = 'Procurement Requests'
                        new_notification_doc.docname = pr_doc.name
                        new_notification_doc.project = pr_doc.project
                        new_notification_doc.work_package = pr_doc.work_package if not custom else "Custom"
                        new_notification_doc.seen = "false"
                        new_notification_doc.type = "info"
                        new_notification_doc.event_id = "pr:vendorSelected"
                        new_notification_doc.action_url = f"purchase-orders/{pr_doc.name}?tab=Approve%20PO"
                        new_notification_doc.insert()

                        message["notificationId"] = new_notification_doc.name
                        print(f"running publish realtime for: {user}")

                        frappe.publish_realtime(
                            event="pr:vendorSelected",  # Custom event name
                            message=message,
                            user=user['name']  # Notify only specific users
                        )
                    except Exception as e:
                       frappe.log_error(f"Failed to send in-app notification to {user.get('name')}: {e}", "handle_delayed_items Notification")
            else:
                print(f"No lead/admin users found for notification on PR {pr_id} reaching Vendor Selected state.")


        # Commit the transaction explicitly if needed (often handled by Frappe context)
        frappe.db.commit()

        return {"message": final_message, "status": 200, "pr_final_state": pr_doc.workflow_state, "po_details": po_details}
                    

    except Exception as e:
        frappe.db.rollback() # Rollback transaction on error
        frappe.log_error(frappe.get_traceback(), "handle_delayed_items Error")
        return {"error": str(e), "status": 400}