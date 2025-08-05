import frappe
import json
from datetime import datetime
from frappe.model.document import Document

# --- (1) NEW: Helper function for safe float conversion ---
def safe_float(value, default=0.0):
    """Safely converts a value to a float, returning a default on failure."""
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default

# --- (2) NEW: The core calculation function ---
def calculate_delivered_amount(order_items: list) -> float:
    """
    Calculates the total value of an order based on the received_quantity of its items.
    
    Args:
        order_items (list): A list of child table item documents (as dicts or Document objects).
    
    Returns:
        float: The total calculated value including tax.
    """
    total_delivered_value = 0.0
    for item in order_items:
        # Use .get() for safe access on both dicts and Document objects
        quote = safe_float(item.get("quote"))
        received_qty = safe_float(item.get("received_quantity"))
        tax_percent = safe_float(item.get("tax"))
        
        # Calculate the value for this item based on its delivered quantity
        item_base_value = quote * received_qty
        item_tax_amount = item_base_value * (tax_percent / 100)
        
        # Add the total value (base + tax) for this item to the running total
        total_delivered_value += item_base_value + item_tax_amount
        
    return total_delivered_value

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
        original_order = po.get("items")

        # # Update received quantities in original order
        # print("DEBUGUPDATEDNITEMS: --- Function Start ---")
        # print(f"DEBUGUPDATEDNITEMS: Original Order: {original_order}")
        # print(f"DEBUGUPDATEDNITEMS: Modified Items: {modified_items}")
        updated_order = update_order_items(original_order, modified_items)

        # --- (3) INTEGRATION: Calculate and set the new field ---
        # Calculate the total delivered amount using the *updated* item list
        delivered_amount = calculate_delivered_amount(updated_order)

        # Set the calculated value on the parent PO document
        po.po_amount_delivered = delivered_amount
        
        
        # Update order list and status
        po.items =  updated_order
        po.status = calculate_order_status(updated_order)
        po.latest_delivery_date = datetime.now()
        

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

# in apps/nirmaan_stack/nirmaan_stack/api/delivery_notes/update_delivery_note.py

# --- BEFORE (Your current code that causes the error) ---
# def update_order_items(original: list, modified: dict) -> list:
#     """Safely merge modified items into original order"""
#     return [
#         {**item.as_dict(), "received_quantity": modified.get(item.name, item.received_quantity or 0)}
#         for item in original
#     ]


# --- AFTER (The Corrected Code) ---
def update_order_items(original: list, modified: dict) -> list:
    """
    Safely updates the 'received_quantity' on the original Document objects in-place.
    'original' is a list of Frappe Document objects for the child table.
    """
    # Iterate through the actual Document objects
    for item_object in original:
        # Get the new value from the 'modified' dictionary, using the object's name as the key.
        # If the item wasn't modified, it will default to its existing value.
        new_value = modified.get(item_object.name, item_object.received_quantity or 0)
        
        # Directly set the attribute on the Document object.
        # This is the key change. We are not creating a new dictionary.
        item_object.received_quantity = new_value
        
    # Return the original list, which now contains the modified objects.
    return original

# def calculate_order_status(order: list) -> str:
#     """Determine order status based on received quantities"""
#     total_items = len(order)
#     delivered_items = sum(
#         1 for item in order 
#         if item.get("quantity", 0) <= item.get("received_quantity", 0)
#     )
    
#     if delivered_items == total_items:
#         return "Delivered"
#     return "Partially Delivered"
def calculate_order_status(order: list) -> str:
    """
    Determine order status based on received quantities.
    - If a quantity is a float, a tolerance (delta) is applied.
    - Otherwise, a direct comparison is used.
    """
    if not order:
        return "Empty" # It's good practice to handle empty lists

    total_items = len(order)
    delivered_items = 0
    delta = 2.5
    
    print(f"\n--- Processing New Order ---")
    print(f"DEBUGCOS: Total items: {total_items}, Delta tolerance: {delta}")
    
    for i, item in enumerate(order):
        print(f"\nItem {i+1}: {item}")
        
        quantity = item.get("quantity", 0)
        received = item.get("received_quantity", 0)
        
        # Check if either value is a float to decide which logic to use
        is_float_quantity = quantity%1 != 0 or received%1 != 0
        
        item_is_delivered = False
        
        if is_float_quantity:
            # --- Logic for FLOAT quantities ---
            # Correctly grouped condition: (A or B) and C
            print("  -> Detected float quantity. Applying delta logic.")
            # The comparison must be inside the if block
            if (quantity - ((quantity * delta)/100)) <= received:
                item_is_delivered = True
            print(f"  DEBUG (float): Check: ({quantity} - {((quantity * delta)/100)}) <= {received} ? -> {item_is_delivered}")
            
        else:
            # --- Logic for INTEGER quantities ---
            print("  -> Using standard integer logic.")
            if quantity <= received:
                item_is_delivered = True
            print(f"  DEBUG (int): Check: {quantity} <= {received} ? -> {item_is_delivered}")

        if item_is_delivered:
            delivered_items += 1
            
    print("\n--- Final Calculation ---")
    print(f"DEBUG: Total delivered items: {delivered_items}")

    if delivered_items == total_items:
        return "Delivered"
    else:
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