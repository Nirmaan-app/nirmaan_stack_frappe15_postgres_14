import frappe
import json
from frappe import _


@frappe.whitelist()
def get_sr_items_for_parents(sr_names):
    """
    Return `work_order_items` child rows for one or more Service Requests,
    grouped by parent SR name.

    Args:
        sr_names: List of SR names (or a JSON string of such a list, or a single name).

    Returns:
        dict mapping `sr_name` -> list of child-row dicts in display order:
            {
              "SR-42-000001": [
                {"name": "...", "item_name": "...", "category": "...",
                 "uom": "...", "quantity": 1.0, "rate": 100.0, "idx": 1},
                ...
              ],
              ...
            }
        Callers derive line amount on the fly (qty × rate); no denormalized
        `amount` column is stored on the child row.
        SRs with no rows are still keyed in the response with an empty list.
    """
    if isinstance(sr_names, str):
        try:
            parsed = json.loads(sr_names)
            sr_names = parsed if isinstance(parsed, list) else [sr_names]
        except (json.JSONDecodeError, TypeError):
            sr_names = [sr_names]

    if not sr_names:
        return {}

    if not frappe.has_permission("Service Requests", "read"):
        frappe.throw(_("Not permitted to read Service Requests."), frappe.PermissionError)

    rows = frappe.get_all(
        "Work Order Items",
        fields=[
            "parent", "name", "idx",
            "item_name", "category", "uom",
            "quantity", "rate",
        ],
        filters={
            "parent": ("in", sr_names),
            "parenttype": "Service Requests",
        },
        order_by="parent asc, idx asc",
        limit_page_length=0,
    )

    out = {name: [] for name in sr_names}
    for row in rows:
        out.setdefault(row["parent"], []).append(row)
    return out
