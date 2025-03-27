import frappe
import json

@frappe.whitelist()
def update_delivery_note(po_id: str, order: list, delivery_challan_attachment: dict = None, po_invoice_attachment: dict = None):
    """
    Updates a Procurement Order and optionally adds delivery challan and PO invoice attachments.

    Args:
        po_id (str): The ID of the Procurement Order.
        order (list): The updated list of order items.
        delivery_challan_attachment (dict, optional): Details of the delivery challan attachment. Defaults to None.
        po_invoice_attachment (dict, optional): Details of the PO invoice attachment. Defaults to None.
    """
    try:
        frappe.db.begin()

        # Update the Procurement Order
        po_doc = frappe.get_doc("Procurement Orders", po_id)
        po_doc.order_list = {"list": order}

        all_delivered = all(item.get("received", 0) == item.get("quantity", 0) for item in order)
        po_doc.status = "Delivered" if all_delivered else "Partially Delivered"

        po_doc.save()

        # Handle delivery challan attachment
        if delivery_challan_attachment:
            delivery_challan_doc = frappe.new_doc("Nirmaan Attachments")
            delivery_challan_doc.project = po_doc.project
            delivery_challan_doc.associated_doctype = "Procurement Orders"
            delivery_challan_doc.associated_docname = po_id
            delivery_challan_doc.attachment_link_doctype = "Vendors"
            delivery_challan_doc.attachment_link_docname = po_doc.vendor
            delivery_challan_doc.attachment_type = "po delivery challan"
            delivery_challan_doc.attachment = delivery_challan_attachment["file_url"]
            delivery_challan_doc.insert(ignore_permissions=True)

        # Handle PO invoice attachment
        if po_invoice_attachment:
            po_invoice_doc = frappe.new_doc("Nirmaan Attachments")
            po_invoice_doc.project = po_doc.project
            po_invoice_doc.associated_doctype = "Procurement Orders"
            po_invoice_doc.associated_docname = po_id
            po_invoice_doc.attachment_link_doctype = "Vendors"
            po_invoice_doc.attachment_link_docname = po_doc.vendor
            po_invoice_doc.attachment_type = "po invoice"
            po_invoice_doc.attachment = po_invoice_attachment["file_url"]
            po_invoice_doc.insert(ignore_permissions=True)

        frappe.db.commit()

        return {"message": f"Delivery Note: {po_id.split('/')[1]} updated successfully", "status": 200}

    except Exception as e:
        frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "update_delivery_note_backend")
        return {"error": f"Unable to update Delivery Note: {str(e)}", "status": 400}