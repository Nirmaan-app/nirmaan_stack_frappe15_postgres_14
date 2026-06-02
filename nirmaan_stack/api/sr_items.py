import frappe
import json
from frappe import _


@frappe.whitelist()
def get_sr_items_for_parents(sr_names=None):
    """
    Return `work_order_items` child rows grouped by parent SR name.

    When `sr_names` is omitted/empty, returns rows for ALL Service Requests
    in one round-trip — used by frontend hooks (e.g. useOrderTotals) that
    need every SR's items without exceeding the GET URL size limit.

    Args:
        sr_names: Optional list of SR names (or JSON string of such a list,
                  or a single name). If None/empty, all SRs are included.

    Returns:
        dict mapping `sr_name` -> list of child-row dicts in display order.
    """
    if isinstance(sr_names, str):
        try:
            parsed = json.loads(sr_names)
            sr_names = parsed if isinstance(parsed, list) else [sr_names]
        except (json.JSONDecodeError, TypeError):
            sr_names = [sr_names]

    if not frappe.has_permission("Service Requests", "read"):
        frappe.throw(_("Not permitted to read Service Requests."), frappe.PermissionError)

    filters: dict = {"parenttype": "Service Requests"}
    if sr_names:
        filters["parent"] = ["in", sr_names]

    rows = frappe.get_all(
        "Work Order Items",
        fields=[
            "parent", "name", "idx",
            "item_name", "category", "uom",
            "quantity", "rate",
        ],
        filters=filters,
        order_by="parent asc, idx asc",
        limit_page_length=0,
    )

    out = {name: [] for name in (sr_names or [])}
    for row in rows:
        out.setdefault(row["parent"], []).append(row)
    return out
