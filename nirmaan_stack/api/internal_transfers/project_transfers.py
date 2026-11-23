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
    with a direction indicator ('Outgoing' / 'Incoming'), the counterpart
    project name for display, and the child `items` array for per-item
    reconciliation reports (DN > DC).

    Each item carries `transfer_quantity` and `received_quantity` (the latter
    is populated by the DN recalc hook when DNs are filed against the ITM).
    """

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
            itm.dispatched_on,
            itm.latest_delivery_date,
            (SELECT MAX(dn.delivery_date) FROM "tabDelivery Notes" dn
             WHERE dn.parent_doctype = 'Internal Transfer Memo' AND dn.parent_docname = itm.name
            ) AS latest_dn_date,
            src.project_name AS source_project_name,
            tgt.project_name AS target_project_name,
            approved_user.full_name AS approved_by_full_name,
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
        LEFT JOIN "tabUser" approved_user ON approved_user.name = itm.approved_by
        WHERE itm.source_project = %(project_id)s
           OR itm.target_project = %(project_id)s
        ORDER BY itm.creation DESC
        """,
        {"project_id": project_id},
        as_dict=True,
    )

    # Attach child items to every ITM in one batched query to avoid N+1.
    itm_names = [row["name"] for row in data]
    items_by_parent: dict[str, list] = {}
    if itm_names:
        item_rows = frappe.db.sql(
            """
            SELECT
                parent,
                name,
                idx,
                item_id,
                item_name,
                unit,
                category,
                make,
                transfer_quantity,
                received_quantity
            FROM "tabInternal Transfer Memo Item"
            WHERE parent IN %(parents)s
            ORDER BY parent ASC, idx ASC
            """,
            {"parents": tuple(itm_names)},
            as_dict=True,
        )
        for row in item_rows:
            parent = row.pop("parent")
            items_by_parent.setdefault(parent, []).append(row)

    for row in data:
        row["items"] = items_by_parent.get(row["name"], [])

    return {"data": data}


@frappe.whitelist()
def get_transfer_summary(project_id: str) -> dict:
    """Per-item aggregates for Material Usage integration.

    Returns a dict keyed by item_id with:
      - transferred_out: sum of transfer_quantity from ITMs where
        source_project = project_id, ITM status in dispatched+ states.
      - transferred_in: sum of received_quantity from ITMs where
        target_project = project_id, same status constraints.
      - ordered_in: sum of transfer_quantity from ITMs where
        target_project = project_id, ITM status Approved or later (the ITM
        counterpart of a PO's ordered quantity: a PO counts once it is approved).
      - itms: one entry per incoming ITM (Approved or later) carrying this item:
        {itm, status, source_type, source_project, source_project_name, ordered_qty, received_qty}.
        `source_type` is "Project" or "Warehouse"; a Warehouse ITM has no source project.
    All ITM items are approved by definition (created from ITR approval).
    """

    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required."), frappe.PermissionError)

    dispatched_statuses = ("Dispatched", "Partially Delivered", "Delivered")
    approved_statuses = ("Approved",) + dispatched_statuses

    transferred_out_rows = frappe.db.sql(
        """
        SELECT
            itmi.item_id,
            MAX(itmi.item_name) AS item_name,
            MAX(itmi.unit) AS unit,
            MAX(itmi.category) AS category,
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
            MAX(itmi.item_name) AS item_name,
            MAX(itmi.unit) AS unit,
            MAX(itmi.category) AS category,
            SUM(COALESCE(itmi.received_quantity, 0)) AS transferred_in
        FROM "tabInternal Transfer Memo Item" itmi
        JOIN "tabInternal Transfer Memo" itm ON itm.name = itmi.parent
        WHERE itm.target_project = %(project_id)s
          AND itm.status IN %(statuses)s
        GROUP BY itmi.item_id
        """,
        {"project_id": project_id, "statuses": dispatched_statuses},
        as_dict=True,
    )

    incoming_itm_rows = frappe.db.sql(
        """
        SELECT
            itm.name AS itm,
            itm.status,
            itm.source_type,
            itm.source_project,
            src.project_name AS source_project_name,
            itmi.item_id,
            MAX(itmi.item_name) AS item_name,
            MAX(itmi.unit) AS unit,
            MAX(itmi.category) AS category,
            SUM(COALESCE(itmi.transfer_quantity, 0)) AS ordered_qty,
            SUM(COALESCE(itmi.received_quantity, 0)) AS received_qty
        FROM "tabInternal Transfer Memo Item" itmi
        JOIN "tabInternal Transfer Memo" itm ON itm.name = itmi.parent
        LEFT JOIN "tabProjects" src ON src.name = itm.source_project
        WHERE itm.target_project = %(project_id)s
          AND itm.status IN %(statuses)s
        GROUP BY itm.name, itm.status, itm.source_type, itm.source_project, src.project_name, itmi.item_id
        ORDER BY itm.name
        """,
        {"project_id": project_id, "statuses": approved_statuses},
        as_dict=True,
    )

    result: dict[str, dict] = {}

    def _entry(row) -> dict:
        """Get or create the item's entry, filling item details from whichever query has them."""
        entry = result.setdefault(row.item_id, {
            "transferred_out": 0,
            "transferred_in": 0,
            "ordered_in": 0,
            "itms": [],
            "item_name": row.item_name,
            "unit": row.unit,
            "category": row.category,
        })
        if not entry.get("item_name"):
            entry["item_name"] = row.item_name
            entry["unit"] = row.unit
            entry["category"] = row.category
        return entry

    for row in transferred_out_rows:
        _entry(row)["transferred_out"] = row.transferred_out or 0

    for row in transferred_in_rows:
        _entry(row)["transferred_in"] = row.transferred_in or 0

    for row in incoming_itm_rows:
        entry = _entry(row)
        entry["ordered_in"] += row.ordered_qty or 0
        entry["itms"].append({
            "itm": row.itm,
            "status": row.status,
            "source_type": row.source_type,
            "source_project": row.source_project,
            "source_project_name": row.source_project_name,
            "ordered_qty": row.ordered_qty or 0,
            "received_qty": row.received_qty or 0,
        })

    return {"data": result}
