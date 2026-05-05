import frappe
from frappe import _
import json


@frappe.whitelist()
def create_po_delivery_documents(
    procurement_order=None,
    dc_type=None,
    reference_number=None,
    attachment_id=None,
    items=None,
    dc_date=None,
    is_signed_by_client=0,
    client_representative_name=None,
    dc_reference=None,
    parent_doctype=None,
    parent_docname=None,
):
    """
    Create a PO Delivery Documents record (polymorphic) with child table items.

    Parent can be "Procurement Orders" (PO) or "Internal Transfer Memo" (ITM).
    For back-compat, callers may pass procurement_order alone (legacy PO flow);
    new ITM callers pass parent_doctype="Internal Transfer Memo" + parent_docname.
    """
    # Resolve parent identity
    if not parent_doctype:
        parent_doctype = "Procurement Orders"
    if not parent_docname:
        parent_docname = procurement_order
    if not parent_docname:
        frappe.throw(_("parent_docname (or procurement_order) is required"))

    # Fetch parent for project/vendor denormalization
    if parent_doctype == "Procurement Orders":
        parent_doc = frappe.get_doc("Procurement Orders", parent_docname)
        project = parent_doc.project
        vendor = parent_doc.vendor
    elif parent_doctype == "Internal Transfer Memo":
        parent_doc = frappe.get_doc("Internal Transfer Memo", parent_docname)
        if parent_doc.status not in ("Partially Delivered", "Delivered"):
            frappe.throw(
                _(
                    "Cannot file Delivery Challan / MIR for ITM in status '{0}'. "
                    "Required status: Partially Delivered or Delivered."
                ).format(parent_doc.status)
            )
        project = parent_doc.target_project
        vendor = None
    else:
        frappe.throw(_("Unsupported parent_doctype: {0}").format(parent_doctype))

    # Parse items if JSON string
    if isinstance(items, str):
        items = json.loads(items)

    # Note: legacy `procurement_order` Link field is deprecated. We no longer
    # populate it on new rows — `parent_docname` is the single source of truth.
    # Pre-existing rows still carry the value (and the doctype keeps the column
    # for back-compat reads during the transition window).
    doc = frappe.new_doc("PO Delivery Documents")
    doc.update(
        {
            "parent_doctype": parent_doctype,
            "parent_docname": parent_docname,
            "project": project,
            "vendor": vendor,
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
    """Batch-fetch child items, attachment URLs, and ITM source_project for PO Delivery Documents."""
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

    # Batch-fetch source_project for ITM-parented rows so the report layer doesn't have to
    # do an N+1 ITM lookup or a frontend join.
    itm_names = [
        d.parent_docname
        for d in docs
        if d.get("parent_doctype") == "Internal Transfer Memo" and d.get("parent_docname")
    ]
    itm_source_map = {}
    if itm_names:
        itm_rows = frappe.get_all(
            "Internal Transfer Memo",
            filters={"name": ["in", list(set(itm_names))]},
            fields=["name", "source_project"],
        )
        itm_source_map = {r.name: r.source_project for r in itm_rows}

    # Assemble result
    result = []
    for doc in docs:
        doc_dict = dict(doc)
        doc_dict["items"] = items_by_parent.get(doc.name, [])
        doc_dict["attachment_url"] = attachment_url_map.get(doc.nirmaan_attachment, None)
        if doc.get("parent_doctype") == "Internal Transfer Memo":
            doc_dict["source_project"] = itm_source_map.get(doc.parent_docname)
        else:
            doc_dict["source_project"] = None
        result.append(doc_dict)
    return result


_PDD_FIELDS = [
    "name",
    "creation",
    "modified_by",
    "parent_doctype",
    "parent_docname",
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
]


@frappe.whitelist()
def get_po_delivery_documents(procurement_order=None, parent_doctype=None, parent_docname=None):
    """
    Get all delivery documents for a given parent (PO or ITM),
    enriched with attachment URLs.

    Filters by `parent_doctype` + `parent_docname`. The legacy `procurement_order`
    arg is still accepted from older callers and resolved to the parent_docname
    for the Procurement Orders branch.
    """
    # ITM path
    if parent_doctype == "Internal Transfer Memo":
        if not parent_docname:
            frappe.throw(_("parent_docname is required for Internal Transfer Memo"))
        docs = frappe.get_all(
            "PO Delivery Documents",
            filters={"parent_doctype": parent_doctype, "parent_docname": parent_docname},
            fields=_PDD_FIELDS,
            order_by="creation desc",
            limit=0,
        )
        return _enrich_delivery_docs(docs)

    # PO path: prefer the explicit polymorphic args; fall back to the legacy
    # `procurement_order` arg from older callers. Backfill patch ensures every
    # PO PDD has both `parent_doctype="Procurement Orders"` and
    # `parent_docname=<po_name>`, so this filter catches every row.
    po_name = parent_docname or procurement_order
    if not po_name:
        frappe.throw(_("procurement_order / parent_docname is required"))

    docs = frappe.get_all(
        "PO Delivery Documents",
        filters={
            "parent_doctype": "Procurement Orders",
            "parent_docname": po_name,
        },
        fields=_PDD_FIELDS,
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
    Get all PO-parent delivery documents for a given Project,
    enriched with attachment URLs and child table items.

    PO-only by design: the Material Usage tab and DN > DC reconciliation report
    operate on POs and would mis-group ITM-parented rows. The
    `parent_doctype = "Procurement Orders"` filter excludes every ITM row.
    Backfill patch ensures every legacy PO PDD has parent_doctype set.
    """
    docs = frappe.get_all(
        "PO Delivery Documents",
        filters={
            "project": project_id,
            "parent_doctype": "Procurement Orders",
        },
        fields=_PDD_FIELDS,
        order_by="creation desc",
        limit=0,
    )

    return _enrich_delivery_docs(docs)


@frappe.whitelist()
def get_all_delivery_documents(doc_type=None, parent_doctype=None):
    """
    Get all delivery documents (PO + ITM), optionally filtered by type and parent doctype.
    Used by the Reports DCs & MIRs tab.

    Args:
        doc_type: "Delivery Challan" or "Material Inspection Report" (optional)
        parent_doctype: "Procurement Orders" or "Internal Transfer Memo" (optional)
    """
    filters = {}
    if doc_type:
        filters["type"] = doc_type
    if parent_doctype:
        filters["parent_doctype"] = parent_doctype

    docs = frappe.get_all(
        "PO Delivery Documents",
        filters=filters,
        fields=_PDD_FIELDS,
        order_by="creation desc",
        limit=0,
    )

    return _enrich_delivery_docs(docs)
