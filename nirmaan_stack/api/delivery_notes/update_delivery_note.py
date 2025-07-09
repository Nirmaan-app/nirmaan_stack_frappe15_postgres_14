import frappe
import json
from datetime import datetime
from frappe.model.document import Document

@frappe.whitelist()
def update_delivery_note(po_id: str, modified_items: dict, delivery_data: dict = None, 
                        delivery_challan_attachment: str = None):
    """
    Updates a Procurement Order with delivery information following enterprise patterns
    
    Args:
        po_id (str): Procurement Order ID
        modified_items (dict): Dictionary of {item_id: new_received_quantity}
        delivery_data (dict): Delivery data structure to append
        delivery_challan_attachment (str): URL of uploaded delivery challan
    """
    try:
        frappe.db.begin()

        # Get original procurement order
        po = frappe.get_doc("Procurement Orders", po_id)
        original_order = po.get("order_list", {}).get("list", [])

        # Update received quantities in original order
        updated_order = update_order_items(original_order, modified_items)
        
        # Update order list and status
        po.order_list = {"list": updated_order}
        po.status = calculate_order_status(updated_order)

        # Handle delivery challan attachment
        if delivery_challan_attachment:
            attachment = create_attachment_doc(
                po, 
                delivery_challan_attachment, 
                "po delivery challan"
            )

            if attachment and delivery_data:
                for date_key in delivery_data:
                    delivery_data[date_key]["attachment_id"] = attachment.name
        
        # Add delivery data history
        if delivery_data:
            add_delivery_history(po, delivery_data)

        # Save procurement order updates
        po.save()

        frappe.db.commit()

        return {
            "status": 200,
            "message": f"Updated {len(modified_items)} items in {po_id}",
            "updated_order": updated_order
        }

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error("Delivery Note Update Error", str(e))
        return {
            "status": 400,
            "message": f"Update failed: {str(e)}",
            "error": frappe.get_traceback()
        }

def update_order_items(original: list, modified: dict) -> list:
    """Safely merge modified items into original order"""
    return [
        {**item, "received": modified.get(item["name"], item.get("received", 0))}
        for item in original
    ]

def calculate_order_status(order: list) -> str:
    """Determine order status based on received quantities"""
    total_items = len(order)
    delivered_items = sum(
        1 for item in order 
        if item.get("quantity", 0) <= item.get("received", 0)
    )
    
    if delivered_items == total_items:
        return "Delivered"
    return "Partially Delivered"

def add_delivery_history(po, new_data: dict) -> None:
    """Append delivery data with unique timestamps for duplicate dates."""
    existing_data = po.get("delivery_data") or {"data": {}}

    if "data" not in existing_data:
        existing_data["data"] = {}

    for date, update_info in new_data.items():
        if date not in existing_data["data"]:
            existing_data["data"][date] = update_info # directly assign the update info if the date is new
        else:
            time_stamp = datetime.now().strftime("%H:%M:%S.%f") # use microseconds to prevent collision.
            unique_date = f"{date} {time_stamp}" #combine date and timestamp
            existing_data["data"][unique_date] = update_info # assign update info with unique date.

    po.delivery_data = existing_data

def create_attachment_doc(po, file_url: str, attachment_type: str) -> Document:
    """Create standardized attachment document"""
    attachment = frappe.new_doc("Nirmaan Attachments")
    attachment.update({
        "project": po.project,
        "attachment": file_url,
        "attachment_type": attachment_type,
        "associated_doctype": "Procurement Orders",
        "associated_docname": po.name,
        "attachment_link_doctype": "Vendors",
        "attachment_link_docname": po.vendor
    })
    attachment.insert(ignore_permissions=True)
    return attachment