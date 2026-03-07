import frappe
from datetime import datetime
from frappe.model.document import Document


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
    for item in order_items:
        quote = safe_float(item.get("quote"))
        received_qty = safe_float(item.get("received_quantity"))
        tax_percent = safe_float(item.get("tax"))

        item_base_value = quote * received_qty
        item_tax_amount = item_base_value * (tax_percent / 100)

        total_delivered_value += item_base_value + item_tax_amount

    return total_delivered_value


@frappe.whitelist()
def update_delivery_note(po_id: str, modified_items: dict, delivery_data: dict = None,
                        delivery_challan_attachment: str = None, is_return: bool = False):
    """
    Updates a Procurement Order with delivery information and creates a Delivery Notes record.

    Args:
        po_id (str): Procurement Order ID
        modified_items (dict): Dictionary of {item_name: new_received_quantity}
        delivery_data (dict): Delivery metadata with date key containing updated_by, etc.
        delivery_challan_attachment (str): URL of uploaded delivery challan
        is_return (bool): Whether this is a return note (items returned to vendor)
    """
    # Handle string-to-bool conversion from frontend
    is_return = is_return in (True, "true", "True", 1, "1")

    try:
        frappe.db.begin()

        po = frappe.get_doc("Procurement Orders", po_id)

        # Return-specific role validation
        RETURN_ROLES = [
            "Nirmaan Admin Profile",
            "Nirmaan PMO Executive Profile",
            "Nirmaan Project Lead Profile",
            "Nirmaan Procurement Executive Profile",
        ]
        if is_return:
            role = frappe.db.get_value("Nirmaan Users", frappe.session.user, "role_profile")
            if frappe.session.user != "Administrator" and role not in RETURN_ROLES:
                frappe.throw("Insufficient permissions to create return notes", frappe.PermissionError)

        # Capture old received quantities BEFORE mutation
        old_received = {}
        for item in po.get("items"):
            old_received[item.name] = safe_float(item.get("received_quantity"))

        # Validate return quantities won't result in negative received_quantity
        if is_return:
            for item in po.get("items"):
                if item.name in modified_items:
                    new_qty = safe_float(modified_items[item.name])
                    if new_qty < 0:
                        frappe.throw(f"Return quantity exceeds received quantity for {item.item_name}")

        # Update received quantities in original order (mutates in-place)
        updated_order = update_order_items(po.get("items"), modified_items)

        # Calculate the total delivered amount using the updated item list
        delivered_amount = calculate_delivered_amount(updated_order)
        po.po_amount_delivered = delivered_amount

        # Update order list and status
        po.items = updated_order
        po.status = calculate_order_status(updated_order)
        po.latest_delivery_date = datetime.now()

        # Handle delivery challan attachment
        attachment_doc = None
        if delivery_challan_attachment:
            attachment_doc = create_attachment_doc(
                po, delivery_challan_attachment, "po delivery challan"
            )

        # Save procurement order updates
        po.save()

        # Create Delivery Notes record
        _create_delivery_note_record(
            po, modified_items, old_received,
            delivery_data, attachment_doc, is_return
        )

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


def _create_delivery_note_record(po, modified_items, old_received,
                                  delivery_data, attachment_doc, is_return=False):
    """Create a Delivery Notes record from the delivery update."""
    # Calculate note_no = count of existing DNs for this PO + 1
    existing_count = frappe.db.count("Delivery Notes", {"procurement_order": po.name})
    note_no = existing_count + 1

    # Extract delivery_date from delivery_data keys
    delivery_date = None
    updated_by = None
    if delivery_data:
        date_key = list(delivery_data.keys())[0]
        delivery_date = date_key.split(" ")[0] if date_key else None
        first_entry = list(delivery_data.values())[0]
        updated_by = first_entry.get("updated_by")

    if not delivery_date:
        delivery_date = datetime.now().strftime("%Y-%m-%d")
    if not updated_by:
        updated_by = frappe.session.user

    # Create the Delivery Notes document
    dn = frappe.new_doc("Delivery Notes")
    dn.update({
        "procurement_order": po.name,
        "project": po.project,
        "vendor": po.vendor,
        "note_no": note_no,
        "delivery_date": delivery_date,
        "updated_by_user": updated_by,
        "nirmaan_attachment": attachment_doc.name if attachment_doc else None,
        "is_stub": 0,
        "is_return": 1 if is_return else 0,
    })

    # Add child items — only items that were actually modified with a positive delta
    for item_obj in po.get("items"):
        item_key = item_obj.name
        if item_key not in modified_items:
            continue

        prev_qty = old_received.get(item_key, 0)
        new_total = safe_float(modified_items[item_key])
        delta = new_total - prev_qty

        # For returns, keep only negative deltas (stored as negative); for deliveries, keep only positive
        if is_return:
            if delta >= 0:
                continue
            # delta is already negative — store as-is so recalculate_po_delivery_fields sums correctly
        else:
            if delta <= 0:
                continue

        dn.append("items", {
            "item_id": item_obj.item_id,
            "item_name": item_obj.item_name,
            "make": item_obj.make,
            "unit": item_obj.unit,
            "category": item_obj.category,
            "procurement_package": item_obj.procurement_package,
            "delivered_quantity": delta,
        })

    dn.flags.ignore_permissions = True
    dn.insert()


def update_order_items(original: list, modified: dict) -> list:
    """
    Safely updates the 'received_quantity' on the original Document objects in-place.
    'original' is a list of Frappe Document objects for the child table.
    """
    for item_object in original:
        new_value = modified.get(item_object.name, item_object.received_quantity or 0)
        item_object.received_quantity = new_value

    return original


def calculate_order_status(order: list) -> str:
    """
    Determine order status based on received quantities.
    Float quantities get a 2.5% tolerance; integers use exact comparison.
    """
    if not order:
        return "Empty"

    total_items = len(order)
    delivered_items = 0
    delta = 2.5

    for item in order:
        quantity = item.get("quantity", 0)
        received = item.get("received_quantity", 0)

        is_float_quantity = quantity % 1 != 0 or received % 1 != 0
        item_is_delivered = False

        if is_float_quantity:
            if (quantity - ((quantity * delta) / 100)) <= received:
                item_is_delivered = True
        else:
            if quantity <= received:
                item_is_delivered = True

        if item_is_delivered:
            delivered_items += 1

    if delivered_items == total_items:
        return "Delivered"
    return "Partially Delivered"


def create_attachment_doc(po, file_url: str, attachment_type: str) -> Document:
    """Create standardized attachment document."""
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
