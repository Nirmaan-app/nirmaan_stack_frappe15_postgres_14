import frappe
import json
import re

def execute():
    """
    Patch to update the delivery_data field in Procurement Orders table for "Partially Delivered" or "Delivered" POs.
    """
    try:
        # Get all POs with status "Partially Delivered" or "Delivered"
        pos = frappe.db.get_all(
            "Procurement Orders",
            filters={"status": ("in", ["Partially Delivered", "Delivered"])},
            fields=["name", "delivery_data"],
            order_by="creation asc"
        )

        for po in pos:
            if po["delivery_data"]:
                continue
            po_name = po["name"]
            frappe.logger().debug(f"Processing PO: {po_name}")
            delivery_data = {}  # Initialize delivery_data as an empty dictionary

            # Get all version docs for this PO
            versions = frappe.db.get_all(
                "Version",
                filters={"ref_doctype": "Procurement Orders", "docname": po_name},
                fields=["data", "creation", "owner"],
                order_by="creation asc"
            )

            for version in versions:
                data = json.loads(version["data"])
                relevant_changes = False

                # Filter version docs for relevant changes (status or order_list)
                for change in data.get("changed", []):
                    if change[0] == "status" and change[2] in ["Partially Delivered", "Delivered"]:
                        relevant_changes = True
                        break
                    elif change[0] == "order_list":
                        relevant_changes = True
                        break

                if relevant_changes:
                    # Extract item received changes
                    order_list_changes = next((change for change in data.get("changed", []) if change[0] == "order_list"), None)

                    if order_list_changes:
                        old_list = []
                        new_list = []

                        if isinstance(order_list_changes[1], dict) and 'list' in order_list_changes[1]:
                            old_list = order_list_changes[1]['list']
                        elif isinstance(order_list_changes[1], str):
                            try:
                                old_list = json.loads(order_list_changes[1])['list']
                            except (json.JSONDecodeError, KeyError):
                                frappe.logger().error(f"Error parsing old_list: {order_list_changes[1]}")

                        if isinstance(order_list_changes[2], dict) and 'list' in order_list_changes[2]:
                            new_list = order_list_changes[2]['list']
                        elif isinstance(order_list_changes[2], str):
                            try:
                                new_list = json.loads(order_list_changes[2])['list']
                            except (json.JSONDecodeError, KeyError):
                                frappe.logger().error(f"Error parsing new_list: {order_list_changes[2]}")

                        old_items = {item['name']: item for item in old_list}
                        new_items = {item['name']: item for item in new_list}

                        item_changes = []
                        for item_name, new_item in new_items.items():
                            old_item = old_items.get(item_name)
                            if old_item and new_item.get('received', 0) != old_item.get('received', 0):
                                item_changes.append({
                                    "item_id": item_name,
                                    "item_name": new_item.get('item'),
                                    "unit": new_item.get('unit'),
                                    "from": old_item.get('received', 0),
                                    "to": new_item.get('received', 0),
                                })
                        if item_changes:
                            creation_str = str(version["creation"]) # Convert datetime to string
                            if creation_str not in delivery_data:
                                delivery_data[creation_str] = {
                                    "items": [],
                                    "updated_by": version["owner"]
                                }
                            delivery_data[creation_str]["items"].extend(item_changes)
            frappe.logger().debug(f"Delivery data for {po_name}: {delivery_data}")
            # Update Procurement Orders doc with delivery_data
            if delivery_data:
                frappe.set_value("Procurement Orders", po_name, "delivery_data", json.dumps({"data": delivery_data}))
                frappe.db.commit()

        frappe.msgprint("Delivery data updated successfully for all relevant POs.")

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "update_delivery_data_patch")
        frappe.msgprint(f"Error updating delivery data: {str(e)}")
        frappe.db.rollback()