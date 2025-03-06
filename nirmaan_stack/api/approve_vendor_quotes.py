import frappe

@frappe.whitelist()
def generate_pos_from_selection(project_id: str, pr_name: str, selected_items: list, selected_vendors: dict):
    """
    Generates Procurement Orders based on selected items and vendors, and updates the Procurement Request.

    Args:
        project_id (str): The ID of the project.
        pr_name (str): The name of the Procurement Request.
        selected_items (list): A list of selected item names.
        selected_vendors (dict): A dictionary mapping item names to vendor IDs.
    """
    try:
        # Fetch the Procurement Request
        pr_doc = frappe.get_doc("Procurement Requests", pr_name)
        if not pr_doc:
            raise frappe.ValidationError(f"Procurement Request {pr_name} not found.")

        # Group items by vendor
        vendor_items = {}
        # Access procurement_list as a dictionary and get the list
        procurement_list = frappe.parse_json(pr_doc.procurement_list).get('list', [])

        print("procurement_list", procurement_list)
        for item in procurement_list:
          print("Item Dictionary:", item)  # Inspect the item dictionary

        for item_name in selected_items:
            vendor_id = selected_vendors.get(item_name)
            if vendor_id:
                item = next((i for i in procurement_list if i["name"] == item_name), None)
                if item:
                    if vendor_id not in vendor_items:
                        vendor_items[vendor_id] = []
                    vendor_items[vendor_id].append(item)

        # Create Procurement Orders
        for vendor_id, items in vendor_items.items():
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
            po_doc.order_list = {"list": items}
            po_doc.insert()

        # Update Procurement Request items and workflow state
        updated_procurement_list = []
        for item in procurement_list:
            if item['name'] in selected_items:
                item['status'] = "Approved"
            updated_procurement_list.append(item)

        total_items = len(procurement_list)
        approved_items = sum(1 for item in procurement_list if item.get('status') == "Approved")
        pending_items_count = sum(1 for item in procurement_list if item.get('status') == "Pending")
        only_pending_or_approved = all(item.get('status') in ["Pending", "Approved"] for item in procurement_list)

        if pr_doc.workflow_state == "Vendor Selected" and approved_items == total_items:
            pr_doc.workflow_state = "Vendor Approved"
        elif pr_doc.workflow_state == "Partially Approved" and only_pending_or_approved and approved_items == pending_items_count:
            pr_doc.workflow_state = "Vendor Approved"
        else:
            pr_doc.workflow_state = "Partially Approved"

        pr_doc.procurement_list = {'list': updated_procurement_list}
        pr_doc.save()

        return {"message": "Procurement Orders created and Procurement Request updated successfully.", "status" : 200}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "generate_pos_from_selection")
        return {"error": str(e), "status" : 400}