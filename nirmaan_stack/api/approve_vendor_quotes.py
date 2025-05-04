import frappe

@frappe.whitelist()
def generate_pos_from_selection(project_id: str, pr_name: str, selected_items: list, selected_vendors: dict, custom : bool = False ):
    """
    Generates Procurement Orders based on selected items and vendors, and updates the Procurement Request.

    Args:
        project_id (str): The ID of the project.
        pr_name (str): The name of the Procurement Request.
        selected_items (list): A list of selected item names.
        selected_vendors (dict): A dictionary mapping item names to vendor IDs.
        custom (bool): A flag to indicate if custom handling is needed.
    """
    try:
        # Fetch the Procurement Request
        pr_doc = frappe.get_doc("Procurement Requests", pr_name)
        if not pr_doc:
            raise frappe.ValidationError(f"Procurement Request {pr_name} not found.")
        
        # Access procurement_list as a dictionary and get the list
        procurement_list = frappe.parse_json(pr_doc.procurement_list).get('list', [])
        
        if custom:
            if not procurement_list:
                return {"message": "No items found for custom approval.", "status": 400}

            # Get vendor from the first item
            first_item = procurement_list[0]
            if not first_item or not first_item.get("vendor"):
                return {"message": "Vendor not found for the selected items.", "status": 400}

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
            po_doc.order_list = {"list": procurement_list}
            po_doc.custom = "true"
            po_doc.insert()

            # Update Procurement Request items and workflow state
            updated_procurement_list = []
            for item in procurement_list:
                item['status'] = "Approved"
                updated_procurement_list.append(item)

            pr_doc.procurement_list = {'list': updated_procurement_list}
            pr_doc.workflow_state = "Vendor Approved"
            pr_doc.save()

            return {"message": f"New PO: {po_doc.name} created successfully (custom).", "status": 200}

        else:
            # Group items by vendor
            vendor_items = {}
            # Parse rfq_data
            rfq_data = frappe.parse_json(pr_doc.rfq_data) if pr_doc.rfq_data else {}
            rfq_details = rfq_data.get("details", {})

            for item_name in selected_items:
                vendor_id = selected_vendors.get(item_name)
                if vendor_id:
                    item = next((i for i in procurement_list if i["name"] == item_name), None)
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
            # pending_items_count = sum(1 for item in updated_procurement_list if item.get('status') == "Pending")
            # only_pending_or_approved = all(item.get('status') in ["Pending", "Approved"] for item in updated_procurement_list)

            if approved_items == total_items:
                pr_doc.workflow_state = "Vendor Approved"
            # elif pr_doc.workflow_state == "Partially Approved" and only_pending_or_approved and approved_items == pending_items_count:
            #     pr_doc.workflow_state = "Vendor Approved"
            else:
                pr_doc.workflow_state = "Partially Approved"

            pr_doc.procurement_list = {'list': updated_procurement_list}
            pr_doc.save()

            return {"message": "Procurement Orders created successfully.", "status" : 200, "po": po_doc.name}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "generate_pos_from_selection")
        return {"error": str(e), "status" : 400}