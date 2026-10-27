import frappe
import json
from frappe import _


@frappe.whitelist()
def get_sr_items_for_parents(sr_names=None):
    """
    Return `work_order_items` child rows grouped by parent SR name.

    Only Work Orders the user may read are returned (#1529): a name the user
    may not read is left out. When `sr_names` is omitted/empty, returns rows
    for every Work Order the user may read, in one round-trip — used by
    frontend hooks (e.g. useOrderTotals) that need every SR's items without
    exceeding the GET URL size limit.

    Args:
        sr_names: Optional list of SR names (or JSON string of such a list,
                  or a single name). If None/empty, every readable SR is included.

    Returns:
        dict mapping each readable `sr_name` -> list of child-row dicts in display order.
    """
    if isinstance(sr_names, str):
        try:
            parsed = json.loads(sr_names)
            sr_names = parsed if isinstance(parsed, list) else [sr_names]
        except (json.JSONDecodeError, TypeError):
            sr_names = [sr_names]

    if not frappe.has_permission("Service Requests", "read"):
        frappe.throw(_("Not permitted to read Service Requests."), frappe.PermissionError)

    # frappe.get_list applies the user's read permission and project User Permissions.
    readable = frappe.get_list(
        "Service Requests",
        filters={"name": ["in", sr_names]} if sr_names else None,
        pluck="name",
        limit_page_length=0,
    )
    if not readable:
        return {}

    rows = frappe.get_all(
        "Work Order Items",
        fields=[
            "parent", "name", "idx",
            "item_name", "category", "uom",
            "quantity", "rate",
        ],
        filters={"parenttype": "Service Requests", "parent": ["in", readable]},
        order_by="parent asc, idx asc",
        limit_page_length=0,
    )

    out = {name: [] for name in readable}
    for row in rows:
        out[row["parent"]].append(row)
    return out
