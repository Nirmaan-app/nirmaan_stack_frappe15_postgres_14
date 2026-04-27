"""
Warehouse Stock Item adjustment helpers.

Called from:
  - ITM lifecycle (Approved → Dispatched with source=Warehouse): decrease stock
  - DN lifecycle via recalculate_itm_delivery_fields (target=Warehouse): delta-adjust stock
"""

import frappe
from frappe.utils import flt, nowdate


def _get_or_create_stock_item(item_id: str, make, item_meta: dict):
    """Fetch existing Warehouse Stock Item for the (item_id, make) pair, or
    create a new one. `make` may be None — items without a make live in their
    own (item_id, NULL) bucket.
    """
    # Normalise empty-string make to None so we don't end up with both ''
    # and NULL rows for the same item.
    make = make or None

    filters = {"item_id": item_id, "make": make}
    name = frappe.db.get_value("Warehouse Stock Item", filters, "name")
    if name:
        return frappe.get_doc("Warehouse Stock Item", name)

    wsi = frappe.new_doc("Warehouse Stock Item")
    wsi.item_id = item_id
    wsi.item_name = item_meta.get("item_name") or item_id
    wsi.unit = item_meta.get("unit")
    wsi.category = item_meta.get("category")
    wsi.make = make
    wsi.estimated_rate = flt(item_meta.get("estimated_rate") or 0)
    wsi.quantity = 0
    return wsi


def adjust_on_dispatch_from_warehouse(itm):
    """ITM source=Warehouse transitioning to Dispatched: decrease stock per item."""
    if (getattr(itm, "source_type", None) or "Project") != "Warehouse":
        return

    today = nowdate()
    target = itm.target_project or ("Warehouse" if (getattr(itm, "target_type", None) or "Project") == "Warehouse" else "")

    for row in itm.items:
        qty = flt(row.transfer_quantity)
        if qty <= 0:
            continue
        wsi = _get_or_create_stock_item(row.item_id, row.make, {
            "item_name": row.item_name,
            "unit": row.unit,
            "category": row.category,
            "make": row.make,
            "estimated_rate": row.estimated_rate,
        })
        wsi.quantity = flt(wsi.quantity) - qty
        wsi.append("ledger", {
            "doctype_ref": "Internal Transfer Memo",
            "docname_ref": itm.name,
            "source_project": "Warehouse",
            "target_project": target,
            "impact": "Decrease",
            "quantity": qty,
            "date": today,
        })
        wsi.save(ignore_permissions=True)


def apply_warehouse_delta(itm, item_row, delta: float):
    """ITM target=Warehouse received a delivery delta: adjust stock and log.

    Called after DN-driven recalc. `delta` can be positive (new delivery)
    or negative (DN deleted/reduced).
    """
    if (getattr(itm, "target_type", None) or "Project") != "Warehouse":
        return
    if delta == 0:
        return

    today = nowdate()
    source = itm.source_project or (
        "Warehouse" if (getattr(itm, "source_type", None) or "Project") == "Warehouse" else ""
    )

    wsi = _get_or_create_stock_item(item_row.item_id, item_row.make, {
        "item_name": item_row.item_name,
        "unit": item_row.unit,
        "category": item_row.category,
        "make": item_row.make,
        "estimated_rate": item_row.estimated_rate,
    })
    wsi.quantity = flt(wsi.quantity) + delta

    if delta > 0:
        if item_row.estimated_rate and flt(item_row.estimated_rate) > flt(wsi.estimated_rate or 0):
            wsi.estimated_rate = item_row.estimated_rate
        # make is now part of the row key; wsi.make always matches item_row.make

    wsi.append("ledger", {
        "doctype_ref": "Internal Transfer Memo",
        "docname_ref": itm.name,
        "source_project": source,
        "target_project": "Warehouse",
        "impact": "Increase" if delta > 0 else "Decrease",
        "quantity": abs(delta),
        "date": today,
    })
    wsi.save(ignore_permissions=True)
