import frappe
from frappe import _
import json


@frappe.whitelist()
def get_po_revision_history(po_id):
    """
    Returns all PO Revisions for a given PO ID, with full details
    including child items and payment rectification data.
    
    Args:
        po_id (str): The Procurement Order ID
    
    Returns:
        list: List of revision dicts, each containing:
            - name, creation, status, total_amount_difference
            - revision_justification, payment_return_details (parsed JSON)
            - revision_items (child table rows)
            - computed totals: original_total_incl_tax, revised_total_incl_tax
    """
    if not po_id:
        frappe.throw(_("PO ID is required"))

    # Fetch all revisions for this PO, newest first
    revisions = frappe.get_all(
        "PO Revisions",
        filters={"revised_po": po_id},
        fields=[
            "name",
            "creation",
            "status",
            "total_amount_difference",
            "revision_justification",
            "payment_return_details",
        ],
        order_by="creation desc",
    )

    result = []

    for rev in revisions:
        # Parse payment_return_details JSON
        payment_data = None
        if rev.payment_return_details:
            try:
                payment_data = (
                    json.loads(rev.payment_return_details)
                    if isinstance(rev.payment_return_details, str)
                    else rev.payment_return_details
                )
            except Exception:
                payment_data = None

        # Fetch child items
        items = frappe.get_all(
            "PO Revisions Items",
            filters={"parent": rev.name},
            fields=[
                "item_type",
                "item_status",
                "revision_item_name",
                "revision_qty",
                "revision_rate",
                "revision_tax",
                "revision_amount",
                "original_item_name",
                "original_qty",
                "original_rate",
                "original_tax",
                "original_amount",
            ],
            order_by="idx asc",
        )

        # Compute totals including tax
        original_total_incl_tax = 0
        revised_total_incl_tax = 0

        for item in items:
            orig_amt = float(item.original_amount or 0)
            orig_tax = float(item.original_tax or 0)
            rev_amt = float(item.revision_amount or 0)
            rev_tax_val = item.revision_tax if item.revision_tax is not None else item.original_tax
            rev_tax = float(rev_tax_val or 0)

            # Original total: exclude New items
            if item.item_type != "New":
                original_total_incl_tax += orig_amt * (1 + orig_tax / 100)

            # Revised total: exclude Deleted items
            if item.item_type != "Deleted":
                if item.item_type == "Original":
                    revised_total_incl_tax += orig_amt * (1 + orig_tax / 100)
                else:
                    revised_total_incl_tax += rev_amt * (1 + rev_tax / 100)

        result.append({
            "name": rev.name,
            "creation": rev.creation,
            "status": rev.status,
            "total_amount_difference": rev.total_amount_difference,
            "revision_justification": rev.revision_justification,
            "payment_return_details": payment_data,
            "revision_items": items,
            "original_total_incl_tax": round(original_total_incl_tax, 2),
            "revised_total_incl_tax": round(revised_total_incl_tax, 2),
        })

    return result
