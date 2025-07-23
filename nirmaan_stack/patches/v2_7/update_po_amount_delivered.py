import frappe
import json
from frappe.utils import flt

# ==============================================================================
# HELPER FUNCTIONS (Copied from your request for a self-contained patch)
# ==============================================================================

def safe_float(value, default=0.0):
    """Safely converts a value to a float, returning a default on failure."""
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default

def calculate_delivered_amount(order_items: list) -> float:
    """
    Calculates the total value of an order based on the received_quantity of its items.
    
    Args:
        order_items (list): A list of child table item documents (as dicts or Document objects).
    
    Returns:
        float: The total calculated value including tax.
    """
    total_delivered_value = 0.0
    # Ensure order_items is a list, even if it's None
    for item in (order_items or []):
        # Use .get() for safe access on Frappe Document objects
        # Assuming child item fields are: 'quote', 'received_quantity', 'tax'
        quote = safe_float(item.get("quote"))
        received_qty = safe_float(item.get("received_quantity"))
        tax_percent = safe_float(item.get("tax"))
        
        # Calculate the value for this item based on its delivered quantity
        item_base_value = quote * received_qty
        item_tax_amount = item_base_value * (tax_percent / 100)
        
        # Add the total value (base + tax) for this item to the running total
        total_delivered_value += item_base_value + item_tax_amount
        
    return total_delivered_value

# ==============================================================================
# FRAPPE PATCH EXECUTION
# ==============================================================================

def execute():
    """
    Patch to backfill the `po_amount_delivered` field for all Procurement Orders
    with a status of 'Partially Delivered' or 'Delivered'.
    """
    frappe.reload_doctype("Procurement Orders")
    
    # Define the target DocType and the statuses we are interested in
    doctype = "Procurement Orders"
    target_statuses = ["Partially Delivered", "Delivered"]
    
    # Get the names of all POs that match the criteria
    # This is efficient as it only fetches the 'name' field
    po_list = frappe.get_all(
        doctype,
        filters={"status": ["in", target_statuses]},
        fields=["name"]
    )
    
    if not po_list:
        print("No Procurement Orders with status 'Partially Delivered' or 'Delivered' found to update.")
        return

    print(f"Found {len(po_list)} Procurement Orders to process...")

    # Loop through each PO found
    for po_meta in po_list:
        try:
            # Load the full document to access its child table 'items'
            po_doc = frappe.get_doc(doctype, po_meta.name)
            
            # The child table for items is named 'items' as per the schema
            order_items = po_doc.get("items")
            
            # Calculate the delivered amount using the provided function
            delivered_amount = calculate_delivered_amount(order_items)
            
            # Update the 'po_amount_delivered' field using db.set_value for efficiency
            # This avoids triggering save-related hooks, which is ideal for a data patch
            frappe.db.set_value(
                doctype, 
                po_doc.name, 
                "po_amount_delivered", 
                delivered_amount,
                update_modified=False # Do not change the 'modified' timestamp
            )
            
            print(f"  - Updated PO '{po_doc.name}': Set po_amount_delivered = {delivered_amount:.2f}")

        except Exception as e:
            print(f"  - ERROR processing PO '{po_meta.name}': {e}")
            # Optionally log the error to the Frappe error log for more details
            frappe.log_error(message=frappe.get_traceback(), title=f"Patch Error on PO {po_meta.name}")

    # Commit all the database changes made by frappe.db.set_value
    frappe.db.commit()
    print("Patch execution complete. All changes have been committed.")