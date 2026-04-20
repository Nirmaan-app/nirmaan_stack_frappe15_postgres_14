"""
List endpoint for Internal Transfer Requests with joined project names.
"""

from typing import Any

import frappe
from frappe import _
from frappe.utils import cint


@frappe.whitelist()
def get_itrs_list(
    doctype: str | None = None,
    fields: str | list | None = None,
    filters: str | list | None = "[]",
    order_by: str | None = "creation desc",
    limit_start: int | str = 0,
    limit_page_length: int | str | None = None,
    search_term: str | None = None,
    **kwargs: Any,
) -> dict:
    """Return paginated ITR rows with joined project name."""

    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required."), frappe.PermissionError)

    start = cint(limit_start) or 0
    page_length = min(cint(limit_page_length or 50), 500)

    conditions = ["1=1"]
    values: dict[str, Any] = {}

    # Parse filters
    parsed = frappe.parse_json(filters) if isinstance(filters, str) else (filters or [])
    for idx, f in enumerate(parsed):
        if isinstance(f, (list, tuple)) and len(f) >= 3:
            field, op, value = f[0], f[1], f[2]

            # Special filter: show ITRs that have ANY pending child items
            if field == "has_pending_items":
                conditions.append(
                    """EXISTS (SELECT 1 FROM "tabInternal Transfer Request Item" ri
                       WHERE ri.parent = itr.name AND ri.status = 'Pending')"""
                )
                continue

            # Special filter: show ITRs that have ANY rejected child items
            if field == "has_rejected_items":
                conditions.append(
                    """EXISTS (SELECT 1 FROM "tabInternal Transfer Request Item" ri
                       WHERE ri.parent = itr.name AND ri.status = 'Rejected')"""
                )
                continue

            allowed = {"name", "status", "target_project", "requested_by", "creation", "modified"}
            if field not in allowed:
                continue
            key = f"f_{idx}"
            col = f"itr.{field}"
            if op == "in":
                if isinstance(value, (list, tuple)) and len(value) > 0:
                    conditions.append(f"{col} IN %({key})s")
                    values[key] = tuple(value)
            elif op in ("=", "!=", ">", ">=", "<", "<="):
                conditions.append(f"{col} {op} %({key})s")
                values[key] = value
            elif op == "like":
                conditions.append(f"{col} ILIKE %({key})s")
                values[key] = f"%{value}%"

    # Search
    if search_term and search_term.strip():
        for t_idx, token in enumerate(search_term.strip().split()):
            key = f"s_{t_idx}"
            conditions.append(
                f"(itr.name ILIKE %({key})s OR tgt.project_name ILIKE %({key})s)"
            )
            values[key] = f"%{token}%"

    where = " AND ".join(conditions)

    # Order
    order_map = {
        "name": "itr.name", "creation": "itr.creation", "modified": "itr.modified",
        "status": "itr.status", "target_project": "tgt.project_name",
    }
    order_clause = "itr.creation DESC"
    if order_by:
        parts = order_by.strip().split()
        col = order_map.get(parts[0], "itr.creation")
        direction = parts[1].upper() if len(parts) > 1 and parts[1].upper() in ("ASC", "DESC") else "DESC"
        order_clause = f"{col} {direction}"

    data = frappe.db.sql(f"""
        SELECT
            itr.name,
            itr.creation,
            itr.modified,
            itr.status,
            itr.target_project,
            tgt.project_name AS target_project_name,
            itr.requested_by,
            usr.full_name AS requested_by_full_name,
            itr.memo_count,
            itr.owner,
            itr.source_project,
            src.project_name AS source_project_name,
            (SELECT COUNT(*) FROM "tabInternal Transfer Request Item" WHERE parent = itr.name) AS total_items,
            (SELECT COUNT(*) FROM "tabInternal Transfer Request Item" WHERE parent = itr.name AND status = 'Pending') AS pending_count,
            (SELECT COUNT(*) FROM "tabInternal Transfer Request Item" WHERE parent = itr.name AND status = 'Approved') AS approved_count,
            (SELECT COUNT(*) FROM "tabInternal Transfer Request Item" WHERE parent = itr.name AND status = 'Rejected') AS rejected_count,
            (SELECT COALESCE(SUM(transfer_quantity), 0) FROM "tabInternal Transfer Request Item" WHERE parent = itr.name) AS total_quantity,
            (SELECT COALESCE(SUM(transfer_quantity * estimated_rate), 0) FROM "tabInternal Transfer Request Item" WHERE parent = itr.name) AS estimated_value
        FROM "tabInternal Transfer Request" itr
        LEFT JOIN "tabProjects" src ON src.name = itr.source_project
        LEFT JOIN "tabProjects" tgt ON tgt.name = itr.target_project
        LEFT JOIN "tabUser" usr ON usr.name = itr.requested_by
        WHERE {where}
        ORDER BY {order_clause}
        LIMIT %(limit)s OFFSET %(start)s
    """, {**values, "limit": page_length, "start": start}, as_dict=True)

    count_result = frappe.db.sql(f"""
        SELECT COUNT(*) as total
        FROM "tabInternal Transfer Request" itr
        LEFT JOIN "tabProjects" src ON src.name = itr.source_project
        LEFT JOIN "tabProjects" tgt ON tgt.name = itr.target_project
        WHERE {where}
    """, values, as_dict=True)

    return {
        "data": data,
        "total_count": count_result[0].total if count_result else 0,
        "aggregates": {},
        "group_by_result": [],
    }
