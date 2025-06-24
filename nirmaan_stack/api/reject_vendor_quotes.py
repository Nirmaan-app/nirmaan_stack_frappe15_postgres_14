import frappe
from frappe.utils import flt

@frappe.whitelist()
def send_back_items(project_id: str, pr_name: str, selected_items: list, comments: str = None):
    """
    Sends back selected items for vendor quotes and updates the Procurement Request.
    If a selected item's category is "Additional Charges", it is removed from the PR
    instead of being sent back.

    Args:
        project_id (str): The ID of the project.
        pr_name (str): The name of the Procurement Request.
        selected_items (list): A list of selected child document names.
        comments (str, optional): Comments for the sent back items. Defaults to None.
    """
    try:
        pr_doc = frappe.get_doc("Procurement Requests", pr_name, for_update=True)
        if not pr_doc:
            raise frappe.ValidationError(f"Procurement Request {pr_name} not found.")

        original_order_list = pr_doc.get("order_list", [])
        
        # --- CHANGE 1: Partition selected items into two groups ---
        items_to_send_back_names = []
        items_to_delete_names = []

        all_selected_item_objects = [item for item in original_order_list if item.name in selected_items]

        for item in all_selected_item_objects:
            if item.category == "Additional Charges":
                items_to_delete_names.append(item.name)
            else:
                items_to_send_back_names.append(item.name)
        # --- END CHANGE 1 ---

        sent_back_doc_name = None
        # --- CHANGE 2: Only create a "Sent Back Category" doc if there are items to send back ---
        if items_to_send_back_names:
            rfq_data = frappe.parse_json(pr_doc.rfq_data) if pr_doc.rfq_data else {}
            selected_vendors = rfq_data.get("selectedVendors", [])
            rfq_details = rfq_data.get("details", {})

            itemlist_for_sent_back_doc = []
            new_categories = []
            new_rfq_details = {}

            # Iterate only over items that need to be sent back
            for item_name in items_to_send_back_names:
                item = next((i for i in original_order_list if i.name == item_name), None)
                if item:
                    itemlist_for_sent_back_doc.append({
                        "item_id": item.get("item_id"),
                        "item_name": item.get("item_name"),
                        "quantity": flt(item.get("quantity")),
                        "tax": flt(item.get("tax")),
                        "quote": flt(item.get("quote")),
                        "unit": item.get("unit"),
                        "category": item.get("category"),
                        "procurement_package": item.get("procurement_package") or pr_doc.work_package,
                        "status": "Pending",
                        "comment": item.get("comment"),
                        "make": item.get("make"),
                        "vendor": item.get("vendor"),
                    })

                    if not any(cat["name"] == item.get("category") for cat in new_categories):
                        category_list_from_pr = frappe.parse_json(pr_doc.category_list).get('list', []) if pr_doc.category_list else []
                        category_info = next((cat for cat in category_list_from_pr if cat["name"] == item.get("category")), None)
                        makes = category_info.get("makes", []) if category_info else []
                        new_categories.append({"name": item.get("category"), "makes": makes})
                    
                    if item_name in rfq_details:
                        new_rfq_details[item_name] = rfq_details[item_name]

            if itemlist_for_sent_back_doc:
                sent_back_doc = frappe.new_doc("Sent Back Category")
                sent_back_doc.procurement_request = pr_name
                sent_back_doc.project = project_id
                sent_back_doc.category_list = {"list": new_categories}
                sent_back_doc.type = "Rejected"
                sent_back_doc.rfq_data = {"selectedVendors": selected_vendors, "details": new_rfq_details}

                for sb_item in itemlist_for_sent_back_doc:
                    sent_back_doc.append("order_list", sb_item)
                sent_back_doc.insert()
                sent_back_doc_name = sent_back_doc.name

                if comments:
                    frappe.get_doc({
                        "doctype": "Nirmaan Comments",
                        "comment_type": "Comment",
                        "reference_doctype": "Sent Back Category",
                        "reference_name": sent_back_doc.name,
                        "content": comments,
                        "subject": "creating sent-back",
                        "comment_by": frappe.session.user
                    }).insert()
        # --- END CHANGE 2 ---

        # --- CHANGE 3: Build the new order_list for the PR ---
        final_pr_order_list = []
        for item in original_order_list:
            if item.name in items_to_delete_names:
                # Exclude (delete) this item by not adding it to the new list
                continue 
            elif item.name in items_to_send_back_names:
                # Update status for items that were sent back
                item.status = "Sent Back"
            final_pr_order_list.append(item)
        
        pr_doc.order_list = final_pr_order_list
        # --- END CHANGE 3 ---
        
        # --- CHANGE 4: Update workflow state calculation based on the *final* list ---
        total_items = len(final_pr_order_list)
        pending_items_count = sum(1 for item in final_pr_order_list if item.status == "Pending")
        approved_items_count = sum(1 for item in final_pr_order_list if item.status == "Approved")
        
        # Determine the new workflow state
        if pending_items_count == 0 and approved_items_count == 0:
            # If nothing is left to approve and nothing has been approved, send it back.
            pr_doc.workflow_state = "Sent Back"
        elif pending_items_count == 0 and approved_items_count > 0:
            # All decisions made, and some items were approved.
            pr_doc.workflow_state = "Vendor Approved"
        else:
            # Some items are still pending, or some were sent back while others are approved.
            pr_doc.workflow_state = "Partially Approved"
        # --- END CHANGE 4 ---

        pr_doc.save()

        # --- CHANGE 5: Create a more descriptive success message ---
        message_parts = []
        if sent_back_doc_name:
            message_parts.append(f"{len(items_to_send_back_names)} item(s) sent back (Ref: {sent_back_doc_name}).")
        if items_to_delete_names:
            message_parts.append(f"{len(items_to_delete_names)} 'Additional Charges' item(s) removed.")
        
        final_message = " ".join(message_parts) if message_parts else "No items were changed."
        # --- END CHANGE 5 ---

        return {"message": final_message, "status": 200}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "send_back_items")
        return {"error": str(e), "status": 400}


# import frappe
# from frappe.utils import flt

# @frappe.whitelist()
# def send_back_items(project_id: str, pr_name: str, selected_items: list, comments: str = None):
#     """
#     Sends back selected items for vendor quotes and updates the Procurement Request.

#     Args:
#         project_id (str): The ID of the project.
#         pr_name (str): The name of the Procurement Request.
#         selected_items (list): A list of selected item names.
#         comments (str, optional): Comments for the sent back items. Defaults to None.
#     """
#     try:
#         pr_doc = frappe.get_doc("Procurement Requests", pr_name, for_update=True)
#         if not pr_doc:
#             raise frappe.ValidationError(f"Procurement Request {pr_name} not found.")

#         # procurement_list = frappe.parse_json(pr_doc.procurement_list).get('list', [])\
#         order_list = pr_doc.get("order_list", [])
#         rfq_data = frappe.parse_json(pr_doc.rfq_data) if pr_doc.rfq_data else {}
#         selected_vendors = rfq_data.get("selectedVendors", [])
#         rfq_details = rfq_data.get("details", {})

#         itemlist = []
#         new_categories = []
#         new_rfq_details = {}

#         for item_name in selected_items:
#             item = next((i for i in order_list if i.get("name") == item_name), None)
#             if item:
#                 itemlist.append({
#                     "item_id": item.get("item_id"),
#                     "item_name": item.get("item_name"),
#                     "quantity": flt(item.get("quantity")),
#                     "tax": flt(item.get("tax")),
#                     "quote": flt(item.get("quote")),
#                     "unit": item.get("unit"),
#                     "category": item.get("category"),
#                     "procurement_package": item.get("procurement_package") or pr_doc.work_package,
#                     "status": "Pending",
#                     "comment": item.get("comment"),
#                     "make": item.get("make"),
#                     "vendor": item.get("vendor"),
#                 })

#                 if not any(cat["name"] == item.get("category") for cat in new_categories):
#                     category_info = next((cat for cat in frappe.parse_json(pr_doc.category_list).get('list', []) if cat["name"] == item.get("category")), None)
#                     makes = category_info.get("makes", []) if category_info else []
#                     new_categories.append({"name": item.get("category"), "makes": makes})

#                 # Add item details to new_rfq_details
#                 if item_name in rfq_details:
#                     new_rfq_details[item_name] = rfq_details[item_name]

#         if itemlist:
#             sent_back_doc = frappe.new_doc("Sent Back Category")
#             sent_back_doc.procurement_request = pr_name
#             sent_back_doc.project = project_id
#             sent_back_doc.category_list = {"list": new_categories}
#             # sent_back_doc.item_list = {"list": itemlist}
#             sent_back_doc.type = "Rejected"
#             sent_back_doc.rfq_data = {"selectedVendors": selected_vendors, "details": new_rfq_details}  # Add rfq_data

#             for sb_item in itemlist:
#                 sent_back_doc.append("order_list", sb_item)
#             sent_back_doc.insert()

#             if comments:
#                 comment_doc = frappe.new_doc("Nirmaan Comments")
#                 comment_doc.comment_type = "Comment"
#                 comment_doc.reference_doctype = "Sent Back Category"
#                 comment_doc.reference_name = sent_back_doc.name
#                 comment_doc.content = comments
#                 comment_doc.subject = "creating sent-back"
#                 comment_doc.comment_by = frappe.session.user
#                 comment_doc.insert()

#         # updated_procurement_list = []
#         for item in order_list:
#             if item.name in selected_items:
#                 item.status = "Sent Back"
#             # updated_procurement_list.append(item)

#         total_items = len(order_list)
#         sent_back_items = len(selected_items)
#         all_items_sent_back = sent_back_items == total_items

#         no_approved_items = all(item.get("status") != "Approved" for item in order_list)
#         pending_items_count = sum(1 for item in order_list if item.get("status") == "Pending")

#         if all_items_sent_back:
#             pr_doc.workflow_state = "Sent Back"
#         elif no_approved_items and pending_items_count == 0:
#             pr_doc.workflow_state = "Sent Back"
#         else:
#             pr_doc.workflow_state = "Partially Approved"

#         # pr_doc.procurement_list = {"list": updated_procurement_list}
#         pr_doc.save()

#         return {"message": f"New Rejected Type Sent Back {sent_back_doc.name} created successfully.", "status": 200}

#     except Exception as e:
#         frappe.log_error(frappe.get_traceback(), "send_back_items")
#         return {"error": str(e), "status": 400}