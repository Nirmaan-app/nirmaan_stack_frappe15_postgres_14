"""
Project-scoped ITM endpoints.

Powers (a) a "Transfer Memos" tab on project detail pages showing ITMs where
the project is source or target, and (b) Material Usage integration showing
transferred-out and transferred-in quantities per item.
"""

import frappe
from frappe import _


@frappe.whitelist()
def get_project_itms(project_id: str) -> dict:
    """Return ITMs where source_project OR target_project = project_id,
    with a direction indicator ('Outgoing' / 'Incoming') and the
    counterpart project name for display."""

    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required."), frappe.PermissionError)

    data = frappe.db.sql(
        """
        SELECT
            itm.name,
            itm.creation,
            itm.status,
            itm.source_project,
            itm.target_project,
            itm.estimated_value,
            itm.total_items,
            itm.total_quantity,
            itm.transfer_request,
            src.project_name AS source_project_name,
            tgt.project_name AS target_project_name,
            CASE
                WHEN itm.source_project = %(project_id)s THEN 'Outgoing'
                ELSE 'Incoming'
            END AS direction,
            CASE
                WHEN itm.source_project = %(project_id)s THEN tgt.project_name
                ELSE src.project_name
            END AS counterpart_project_name
        FROM "tabInternal Transfer Memo" itm
        LEFT JOIN "tabProjects" src ON src.name = itm.source_project
        LEFT JOIN "tabProjects" tgt ON tgt.name = itm.target_project
        WHERE itm.source_project = %(project_id)s
           OR itm.target_project = %(project_id)s
        ORDER BY itm.creation DESC
        """,
        {"project_id": project_id},
        as_dict=True,
    )

    return {"data": data}


@frappe.whitelist()
def get_transfer_summary(project_id: str) -> dict:
    """Per-item aggregates for Material Usage integration.

    Returns a dict keyed by item_id with:
      - transferred_out: sum of transfer_quantity from ITMs where
        source_project = project_id, ITM status in dispatched+ states.
      - transferred_in: sum of received_quantity from ITMs where
        target_project = project_id, same status constraints.
    All ITM items are approved by definition (created from ITR approval).
    """

    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required."), frappe.PermissionError)

    dispatched_statuses = ("Dispatched", "Partially Delivered", "Delivered")

    transferred_out_rows = frappe.db.sql(
        """
        SELECT
            itmi.item_id,
            SUM(itmi.transfer_quantity) AS transferred_out
        FROM "tabInternal Transfer Memo Item" itmi
        JOIN "tabInternal Transfer Memo" itm ON itm.name = itmi.parent
        WHERE itm.source_project = %(project_id)s
          AND itm.status IN %(statuses)s
        GROUP BY itmi.item_id
        """,
        {"project_id": project_id, "statuses": dispatched_statuses},
        as_dict=True,
    )

    transferred_in_rows = frappe.db.sql(
        """
        SELECT
            itmi.item_id,
            SUM(itmi.received_quantity) AS transferred_in
        FROM "tabInternal Transfer Memo Item" itmi
        JOIN "tabInternal Transfer Memo" itm ON itm.name = itmi.parent
        WHERE itm.target_project = %(project_id)s
          AND itm.status IN %(statuses)s
        GROUP BY itmi.item_id
        """,
        {"project_id": project_id, "statuses": dispatched_statuses},
        as_dict=True,
    )

    result: dict[str, dict] = {}

    for row in transferred_out_rows:
        result[row.item_id] = {
            "transferred_out": row.transferred_out or 0,
            "transferred_in": 0,
        }

    for row in transferred_in_rows:
        if row.item_id in result:
            result[row.item_id]["transferred_in"] = row.transferred_in or 0
        else:
            result[row.item_id] = {
                "transferred_out": 0,
                "transferred_in": row.transferred_in or 0,
            }

    return {"data": result}
