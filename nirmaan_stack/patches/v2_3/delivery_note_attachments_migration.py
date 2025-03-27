import frappe

def execute():
    """
    Patch to migrate data from Delivery Note Attachments to Nirmaan Attachments.
    """
    try:
        # Get all Delivery Note Attachments
        delivery_note_attachments = frappe.db.get_all(
            "Delivery Note Attachments",
            fields=["name", "delivery_note", "project", "image"],
        )

        for attachment in delivery_note_attachments:
            if attachment["image"]:  # Check if image field is not null
                po_name = attachment["delivery_note"]
                po_doc = frappe.get_doc("Procurement Orders", po_name)

                if po_doc:
                    # Create Nirmaan Attachments document
                    nirmaan_attachment_doc = frappe.new_doc("Nirmaan Attachments")
                    nirmaan_attachment_doc.project = attachment["project"]
                    nirmaan_attachment_doc.associated_doctype = "Procurement Orders"
                    nirmaan_attachment_doc.associated_docname = po_name
                    nirmaan_attachment_doc.attachment_link_doctype = "Vendors"
                    nirmaan_attachment_doc.attachment_link_docname = po_doc.vendor
                    nirmaan_attachment_doc.attachment_type = "po delivery challan"
                    nirmaan_attachment_doc.attachment = attachment["image"]
                    nirmaan_attachment_doc.insert(ignore_permissions=True)

        frappe.msgprint("Delivery Note Attachments migrated successfully.")

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "migrate_delivery_note_attachments")
        frappe.msgprint(f"Error migrating Delivery Note Attachments: {str(e)}")
        frappe.db.rollback()