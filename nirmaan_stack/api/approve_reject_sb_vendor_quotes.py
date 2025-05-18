import frappe

@frappe.whitelist()
def new_handle_approve(sb_id: str, selected_items: list, project_id: str, selected_vendors: dict):
    """
    Approves selected items, creates Procurement Orders, and updates Sent Back Category.

    Args:
        sb_id (str): The name of the Sent Back Category document.
        selected_items (list): List of selected item names.
        project_id (str): Project ID.
        selected_vendors (dict): A dictionary mapping item names to vendor IDs.
    """
    try:
        # Fetch the Sent Back Category document
        sb_doc = frappe.get_doc("Sent Back Category", sb_id)
        if not sb_doc:
            raise frappe.ValidationError(f"Sent Back Category {sb_id} not found.")

        # Group items by vendor
        vendor_items = {}
        # Access item_list as a dictionary and get the list
        item_list = frappe.parse_json(sb_doc.item_list).get('list', [])

        # Parse rfq_data
        rfq_data = frappe.parse_json(sb_doc.rfq_data) if sb_doc.rfq_data else {}
        rfq_details = rfq_data.get("details", {})

        for item_name in selected_items:
            vendor_id = selected_vendors.get(item_name)
            if vendor_id:
                item = next((i for i in item_list if i["name"] == item_name), None)
                if item:
                    # Construct the "makes" field
                    item_details = rfq_details.get(item_name, {})
                    makes_list = item_details.get("makes", [])
                    item_make = item.get("make", None)  # Get the original item's make, if any

                    makes_formatted = {"list": []}
                    for make in makes_list:
                        enabled = "true" if item_make == make else "false"
                        makes_formatted["list"].append({"make": make, "enabled": enabled})

                    # Create a copy of the item and add the "makes" field
                    item_with_makes = item.copy()
                    item_with_makes["makes"] = makes_formatted

                    if vendor_id not in vendor_items:
                        vendor_items[vendor_id] = []
                    vendor_items[vendor_id].append(item_with_makes)

        # Create Procurement Orders
        for vendor_id, items in vendor_items.items():
            vendor_doc = frappe.get_doc("Vendors", vendor_id)
            po_doc = frappe.new_doc("Procurement Orders")
            po_doc.procurement_request = sb_doc.procurement_request
            po_doc.project = project_id
            po_doc.project_name = frappe.get_value("Projects", project_id, "project_name")
            po_doc.project_address = frappe.get_value("Projects", project_id, "project_address")
            po_doc.vendor = vendor_id
            po_doc.vendor_name = vendor_doc.vendor_name
            po_doc.vendor_address = vendor_doc.vendor_address
            po_doc.vendor_gst = vendor_doc.vendor_gst
            po_doc.order_list = {"list": items}
            po_doc.insert()

        # Update Sent Back Category items and workflow state
        updated_item_list = []
        for item in item_list:
            if item['name'] in selected_items:
                item['status'] = "Approved"
            updated_item_list.append(item)

        total_items = len(item_list)
        approved_items = sum(1 for item in updated_item_list if item.get('status') == "Approved")

        if approved_items == total_items:
            sb_doc.workflow_state = "Approved"
        else:
            sb_doc.workflow_state = "Partially Approved"

        sb_doc.item_list = {'list': updated_item_list}
        sb_doc.save()

        return {"message": "Procurement Order(s) created successfully.", "status": 200}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "new_handle_approve")
        return {"error": str(e), "status": 400}

import frappe

@frappe.whitelist()
def new_handle_sent_back(sb_id: str, selected_items: list, comment: str = None):
    """
    Sends back selected items and updates Sent Back Category.

    Args:
        sb_id (str): The name of the Sent Back Category document.
        selected_items (list): List of selected items to send back.
        comment (str, optional): Comment for the sent back items. Defaults to None.
    """
    try:
        sb_doc = frappe.get_doc("Sent Back Category", sb_id)
        if not sb_doc:
            raise frappe.ValidationError(f"Sent Back Category {sb_id} not found.")

        item_list = frappe.parse_json(sb_doc.item_list).get("list", [])
        rfq_data = frappe.parse_json(sb_doc.rfq_data) if sb_doc.rfq_data else {}
        selected_vendors = rfq_data.get("selectedVendors", [])
        rfq_details = rfq_data.get("details", {})
        category_list = frappe.parse_json(sb_doc.category_list).get("list", [])

        sent_back_items_details = []
        new_categories = []
        new_rfq_details = {}

        for item_name in selected_items:
            item = next((i for i in item_list if i["name"] == item_name), None)
            if item:
                sent_back_items_details.append({
                    "name": item["name"],
                    "item": item["item"],
                    "quantity": item["quantity"],
                    "quote": item.get("quote"),
                    "unit": item["unit"],
                    "tax": item.get("tax"),
                    "status": "Pending",
                    "category": item["category"],
                    "work_package": item.get("work_package"),
                    "comment": item.get("comment"),
                    "make": item.get("make"),
                    "vendor": item.get("vendor"),
                })

                if not any(cat["name"] == item["category"] for cat in new_categories):
                    category_info = next((cat for cat in category_list if cat["name"] == item["category"]), None)
                    makes = category_info.get("makes", []) if category_info else []
                    new_categories.append({"name": item["category"], "makes": makes})

                # Add item details to new_rfq_details
                if item_name in rfq_details:
                    new_rfq_details[item_name] = rfq_details[item_name]

        if sent_back_items_details:
            new_sent_back_doc = frappe.new_doc("Sent Back Category")
            new_sent_back_doc.procurement_request = sb_doc.procurement_request
            new_sent_back_doc.project = sb_doc.project
            new_sent_back_doc.category_list = {"list": new_categories}
            new_sent_back_doc.item_list = {"list": sent_back_items_details}
            new_sent_back_doc.type = "Rejected"
            new_sent_back_doc.rfq_data = {"selectedVendors": selected_vendors, "details": new_rfq_details}  # Add rfq_data
            new_sent_back_doc.insert()

            if comment:
                comment_doc = frappe.new_doc("Nirmaan Comments")
                comment_doc.comment_type = "Comment"
                comment_doc.reference_doctype = "Sent Back Category"
                comment_doc.reference_name = new_sent_back_doc.name
                comment_doc.content = comment
                comment_doc.subject = "creating sent-back"
                comment_doc.comment_by = frappe.session.user
                comment_doc.insert()

        updated_item_list = []
        for item in item_list:
            if item['name'] in selected_items:
                updated_item_list.append({**item, "status": "Sent Back"})
            else:
                updated_item_list.append(item)

        total_items = len(item_list)
        sent_back_items_count = len(sent_back_items_details)
        all_items_sent_back = sent_back_items_count == total_items

        no_approved_items = all(item.get("status") != "Approved" for item in item_list)
        pending_items_count = sum(1 for item in item_list if item.get("status") == "Pending")

        if all_items_sent_back:
            sb_doc.workflow_state = "Sent Back"
        elif no_approved_items and pending_items_count == 0:
            sb_doc.workflow_state = "Sent Back"
        else:
            sb_doc.workflow_state = "Partially Approved"

        sb_doc.item_list = {"list": updated_item_list}
        sb_doc.save()

        return {"message": f"New Rejected Type Sent Back: {new_sent_back_doc.name} created successfully.", "status": 200}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "new_handle_sent_back")
        return {"error": str(e), "status": 400}