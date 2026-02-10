import frappe
from frappe import _
import json


@frappe.whitelist()
def create_po_delivery_documents(
    procurement_order,
    dc_type,
    reference_number=None,
    attachment_id=None,
    items=None,
    dc_date=None,
    is_signed_by_client=0,
    client_representative_name=None,
    dc_reference=None,
):
    """
    Create a PO Delivery Documents record with child table items.

    Args:
        procurement_order: Procurement Orders document name
        dc_type: "Delivery Challan" or "Material Inspection Report"
        reference_number: DC/MIR reference number
        attachment_id: Nirmaan Attachments document name
        items: JSON string or list of item dicts [{item_id, item_name, unit, category, quantity, make}]
        dc_date: Date of the DC/MIR
        is_signed_by_client: 0 or 1
        client_representative_name: Name of client representative (when signed)

    Returns:
        dict with name and status
    """
    # Fetch PO for project/vendor denormalization
    po = frappe.get_doc("Procurement Orders", procurement_order)

    # Parse items if JSON string
    if isinstance(items, str):
        items = json.loads(items)

    doc = frappe.new_doc("PO Delivery Documents")
    doc.update(
        {
            "procurement_order": procurement_order,
            "project": po.project,
            "vendor": po.vendor,
            "type": dc_type,
            "reference_number": reference_number,
            "nirmaan_attachment": attachment_id,
            "dc_date": dc_date,
            "is_signed_by_client": int(is_signed_by_client),
            "client_representative_name": client_representative_name
            if int(is_signed_by_client)
            else None,
            "dc_reference": dc_reference,
            "is_stub": 0,
        }
    )

    # Add child table items
    if items:
        for item in items:
            doc.append(
                "items",
                {
                    "item_id": item.get("item_id"),
                    "item_name": item.get("item_name"),
                    "unit": item.get("unit"),
                    "category": item.get("category"),
                    "quantity": float(item.get("quantity", 0)),
                    "make": item.get("make"),
                },
            )

    doc.flags.ignore_permissions = True
    doc.insert()
    frappe.db.commit()

    return {"name": doc.name, "status": "success"}


def _enrich_delivery_docs(docs):
    """Batch-fetch child items and attachment URLs for PO Delivery Documents."""
    if not docs:
        return []

    # Batch-fetch attachment URLs
    attachment_ids = [d.nirmaan_attachment for d in docs if d.nirmaan_attachment]
    attachment_url_map = {}
    if attachment_ids:
        attachments = frappe.get_all(
            "Nirmaan Attachments",
            filters={"name": ["in", attachment_ids]},
            fields=["name", "attachment"],
        )
        attachment_url_map = {a.name: a.attachment for a in attachments}

    # Batch-fetch ALL child items in ONE query (fixes N+1)
    parent_names = [doc.name for doc in docs]
    items_by_parent = {}
    if parent_names:
        all_items = frappe.get_all(
            "DC Item",
            filters={"parent": ["in", parent_names], "parenttype": "PO Delivery Documents"},
            fields=["name", "parent", "item_id", "item_name", "unit", "category", "quantity", "make", "idx"],
            order_by="parent asc, idx asc",
            limit=0,
        )
        for item in all_items:
            parent = item.pop("parent")
            items_by_parent.setdefault(parent, []).append(item)

    # Assemble result
    result = []
    for doc in docs:
        doc_dict = dict(doc)
        doc_dict["items"] = items_by_parent.get(doc.name, [])
        doc_dict["attachment_url"] = attachment_url_map.get(doc.nirmaan_attachment, None)
        result.append(doc_dict)
    return result


@frappe.whitelist()
def get_po_delivery_documents(procurement_order):
    """
    Get all PO Delivery Documents for a given Procurement Order,
    enriched with attachment URLs.

    Args:
        procurement_order: Procurement Orders document name

    Returns:
        list of PO Delivery Documents with items and attachment URLs
    """
    docs = frappe.get_all(
        "PO Delivery Documents",
        filters={"procurement_order": procurement_order},
        fields=[
            "name",
            "creation",
            "modified_by",
            "procurement_order",
            "project",
            "vendor",
            "type",
            "nirmaan_attachment",
            "reference_number",
            "dc_date",
            "is_signed_by_client",
            "client_representative_name",
            "dc_reference",
            "is_stub",
        ],
        order_by="creation desc",
        limit=0,
    )

    return _enrich_delivery_docs(docs)


@frappe.whitelist()
def update_nirmaan_attachment(attachment_name, new_url):
    """
    Update the attachment URL on a Nirmaan Attachments record.
    Used when replacing an attachment file in edit mode.
    """
    frappe.db.set_value("Nirmaan Attachments", attachment_name, "attachment", new_url)
    frappe.db.commit()
    return {"status": "success"}


@frappe.whitelist()
def update_po_delivery_documents(
    document_name,
    items=None,
    reference_number=None,
    dc_date=None,
    is_signed_by_client=None,
    client_representative_name=None,
    new_attachment_id=None,
    dc_reference=None,
):
    """
    Update an existing PO Delivery Documents record.
    Clears is_stub flag when items are added.

    Args:
        document_name: PO Delivery Documents name
        items: JSON string or list of item dicts (optional)
        reference_number: Updated reference number (optional)
        dc_date: Updated date (optional)
        is_signed_by_client: 0 or 1 (optional)
        client_representative_name: Name (optional)
        new_attachment_id: New Nirmaan Attachment ID (optional, for attachment replacement)

    Returns:
        dict with name and status
    """
    doc = frappe.get_doc("PO Delivery Documents", document_name)

    if reference_number is not None:
        doc.reference_number = reference_number

    if dc_date is not None:
        doc.dc_date = dc_date

    if is_signed_by_client is not None:
        doc.is_signed_by_client = int(is_signed_by_client)
        if int(is_signed_by_client):
            doc.client_representative_name = client_representative_name
        else:
            doc.client_representative_name = None

    # Parse items if JSON string
    if isinstance(items, str):
        items = json.loads(items)

    if items is not None:
        # Clear existing items and add new ones
        doc.items = []
        for item in items:
            doc.append(
                "items",
                {
                    "item_id": item.get("item_id"),
                    "item_name": item.get("item_name"),
                    "unit": item.get("unit"),
                    "category": item.get("category"),
                    "quantity": float(item.get("quantity", 0)),
                    "make": item.get("make"),
                },
            )
        # Clear stub flag when items are added
        if len(items) > 0:
            doc.is_stub = 0

    if dc_reference is not None:
        doc.dc_reference = dc_reference

    if new_attachment_id is not None:
        doc.nirmaan_attachment = new_attachment_id

    doc.flags.ignore_permissions = True
    doc.save()
    frappe.db.commit()

    return {"name": doc.name, "status": "success"}


@frappe.whitelist()
def get_project_po_delivery_documents(project_id):
    """
    Get all PO Delivery Documents for a given Project,
    enriched with attachment URLs and child table items.

    Used by the Material Usage tab to display all DCs/MIRs
    across all POs within a project in a single call.

    Args:
        project_id: Projects document name

    Returns:
        list of PO Delivery Documents with items and attachment URLs
    """
    docs = frappe.get_all(
        "PO Delivery Documents",
        filters={"project": project_id},
        fields=[
            "name",
            "creation",
            "modified_by",
            "procurement_order",
            "project",
            "vendor",
            "type",
            "nirmaan_attachment",
            "reference_number",
            "dc_date",
            "is_signed_by_client",
            "client_representative_name",
            "dc_reference",
            "is_stub",
        ],
        order_by="creation desc",
        limit=0,
    )

    return _enrich_delivery_docs(docs)