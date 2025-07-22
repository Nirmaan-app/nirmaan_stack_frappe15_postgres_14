import frappe
import json

@frappe.whitelist()
def handle_cancel_po(po_id: str, comment: str = None):
    """
    Cancels a Procurement Order.
    - 'Additional Charge' items from the PO are ignored.
    - Regular items are moved to a 'Cancelled' type Sent Back Category document.
    """
    try:
        frappe.db.begin()

        # 1. Fetch required documents with validation
        po_doc = frappe.get_doc("Procurement Orders", po_id)
        
        pr_name = po_doc.procurement_request
        if not pr_name:
            # Raise a specific, helpful error
            frappe.throw(f"The cancelled Procurement Order '{po_id}' is not linked to a Procurement Request. Cannot proceed.", title="Missing Link")
        
        pr_doc = frappe.get_doc("Procurement Requests", pr_name)
        
        # Use .get() for safety, returns [] if 'items' field doesn't exist or is empty
        items_from_po = po_doc.get("items", [])
        if not items_from_po:
            # This is not necessarily an error, could be a PO with only charges.
            # We can let the logic proceed.
            pass

        # 2. Partition items and IGNORE Additional Charges
        regular_items_to_send_back = []
        for item in items_from_po:
            if item.category != "Additional Charges":
                regular_items_to_send_back.append(item)

        # 3. Act ONLY on the "Regular Items" group
        sent_back_doc_name = None
        if regular_items_to_send_back:
            # Create the new document that will hold the sent-back items
            new_sent_back_doc = frappe.new_doc("Sent Back Category")
            new_sent_back_doc.type = "Cancelled"
            new_sent_back_doc.procurement_request = pr_doc.name
            new_sent_back_doc.project = po_doc.project
            
            # Prepare data for child table and JSON field
            categories_for_json = []
            added_categories = set()

            for item_doc in regular_items_to_send_back:
                # Build category list for the JSON field
                if item_doc.category not in added_categories:
                    categories_for_json.append({"name": item_doc.category, "makes": []})
                    added_categories.add(item_doc.category)

                # Prepare the item dictionary for the child table
                item_dict = item_doc.as_dict()
                item_dict["status"] = "Pending"
                
                # Clean internal Frappe fields to prevent errors on insert
                for field in ['name', 'parent', 'parentfield', 'parenttype', 'doctype', 'owner', 'creation', 'modified', 'modified_by', 'idx']:
                    if field in item_dict:
                        del item_dict[field]
                
                # **DEFINITIVE FIX:** Use .append() to add the item to the child table
                new_sent_back_doc.append("order_list", item_dict)

            # Set the JSON field for categories
            new_sent_back_doc.category_list = json.dumps({"list": categories_for_json})
            
            # Insert the fully populated document
            new_sent_back_doc.insert(ignore_permissions=True)
            sent_back_doc_name = new_sent_back_doc.name

        # 4. Finalize Actions
        po_doc.status = "Cancelled"
        po_doc.save(ignore_permissions=True)

        if comment:
            ref_doctype = "Sent Back Category" if sent_back_doc_name else "Procurement Order"
            ref_name = sent_back_doc_name if sent_back_doc_name else po_doc.name
            frappe.new_doc("Nirmaan Comments").update({
                "comment_type": "Comment", "reference_doctype": ref_doctype,
                "reference_name": ref_name, "content": comment,
                "subject": "PO Cancelled", "comment_by": frappe.session.user
            }).insert(ignore_permissions=True)
        
        frappe.db.commit()
        
        message = f"PO {po_id} cancelled successfully."
        if sent_back_doc_name:
            message += f" New Sent Back document {sent_back_doc_name} created for {len(regular_items_to_send_back)} item(s)."
        elif items_from_po:
            message += " Additional charge items were noted and ignored as per process."
        
        return {"message": message, "status": 200}

    except Exception as e:
        frappe.db.rollback()
        # Log the full error for backend debugging
        frappe.log_error(message=frappe.get_traceback(), title="handle_cancel_po Failed")
        # Return a clean error message to the user
        return {"error": f"PO Cancellation Failed: {str(e)}", "status": 400}

# import frappe

# @frappe.whitelist()
# def handle_cancel_po(po_id: str, comment: str = None):
#     """
#     Cancels a Procurement Order, creates a Sent Back Category document, and updates Procurement Request.

#     Args:
#         po_id (str): The name of the Procurement Order to cancel.
#         comment (str, optional): Comment for the cancellation. Defaults to None.
#     """
#     try:
#         # Fetch the Procurement Order
#         po_doc = frappe.get_doc("Procurement Orders", po_id)
#         if not po_doc:
#             raise frappe.ValidationError(f"Procurement Order {po_id} not found.")

#         # Fetch the Procurement Request
#         pr_name = po_doc.procurement_request
#         pr_doc = frappe.get_doc("Procurement Requests", pr_name)
#         if not pr_doc:
#             raise frappe.ValidationError(f"Procurement Request {pr_name} not found.")

#         # Extract data from Procurement Order
#         order_data = frappe.parse_json(po_doc.order_list).get("list", [])

        
#         pr_categories = frappe.parse_json(pr_doc.category_list).get("list", [])
#         rfq_data = frappe.parse_json(pr_doc.rfq_data) if pr_doc.rfq_data else {}
#         selected_vendors = rfq_data.get("selectedVendors", [])
#         rfq_details = rfq_data.get("details", {})

#         # Prepare categories and item list
#         categories = []
#         item_list = []
#         new_rfq_details = {}

#         for item in order_data:
#             if not any(cat["name"] == item["category"] for cat in categories):
#                 makes = next((cat.get("makes", []) for cat in pr_categories if cat["name"] == item["category"]), [])
#                 categories.append({"name": item["category"], "makes": makes})

#             item_without_makes = {**item, "status": "Pending"}
#             if "makes" in item_without_makes:
#               del item_without_makes["makes"]
#             item_list.append(item_without_makes)
#             if item["name"] in rfq_details:
#                 new_rfq_details[item["name"]] = rfq_details[item["name"]]

#         # Update Procurement Order status
#         po_doc.status = "Cancelled"
#         po_doc.save()

#         # Create Sent Back Category document
#         new_sent_back_doc = frappe.new_doc("Sent Back Category")
#         new_sent_back_doc.type = "Cancelled"
#         new_sent_back_doc.procurement_request = po_doc.procurement_request
#         new_sent_back_doc.project = po_doc.project
#         new_sent_back_doc.category_list = {"list": categories}
#         new_sent_back_doc.item_list = {"list": item_list}
#         new_sent_back_doc.rfq_data = {"selectedVendors": selected_vendors, "details": new_rfq_details}
#         new_sent_back_doc.insert()

#         # Create Nirmaan Comments document if comment is provided
#         if comment:
#             comment_doc = frappe.new_doc("Nirmaan Comments")
#             comment_doc.comment_type = "Comment"
#             comment_doc.reference_doctype = "Sent Back Category"
#             comment_doc.reference_name = new_sent_back_doc.name
#             comment_doc.content = comment
#             comment_doc.subject = "creating sent-back(cancelled)"
#             comment_doc.comment_by = frappe.session.user
#             comment_doc.insert()

#         return {"message": f"Cancelled Po & New Cancelled Type Sent Back: {new_sent_back_doc.name} created successfully!", "status": 200}

#     except Exception as e:
#         frappe.log_error(frappe.get_traceback(), "handle_cancel_po")
#         return {"error": f"PO: {po_id} Cancellation Failed! {str(e)}", "status": 400}