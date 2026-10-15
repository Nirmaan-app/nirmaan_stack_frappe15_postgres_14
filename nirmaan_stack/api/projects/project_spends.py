# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What the project page's Spends tab groups by work package: EVERY PO of the project with its stored Amount
Paid, and the items that key it (spec #1451 story 14, ADR-0034).

Every PO counts, whatever its status: a Merged, Cancelled or Inactive PO's Amount Paid is real money out,
so the Spends PO total is the PO part of the project outflow. The PO summary (`api/procurement_orders.
generate_po_summary`) leaves Merged, Inactive and PO Amendment POs out, so their items come from here.
The grouping itself is the pure rule `frontend/src/utils/projects/projectPaid.amountPaidByWorkPackage`.

    nirmaan_stack.api.projects.project_spends.get_project_pos_paid
        project_id="PROJ-0001"
        -> {"pos": [{"name": "PO/1/...", "amount_paid": 300.0}, ...],
            "items": [{"po_number": "PO/1/...", "work_package": "Electrical", "quote": 100.0,
                       "quantity": 2.0, "tax": 18.0, "isCustom": False}, ...]}
"""

import frappe
from frappe import _
from frappe.utils import flt


@frappe.whitelist()
def get_project_pos_paid(project_id: str) -> dict:
    """Every PO of the project with its Amount Paid, and every PO's items (two queries)."""
    if not frappe.has_permission("Procurement Orders", "read"):
        frappe.throw(_("Not permitted to read Procurement Orders."), frappe.PermissionError)
    pos = frappe.get_all(
        "Procurement Orders",
        filters={"project": project_id},
        fields=["name", "amount_paid"],
        limit_page_length=0,
    )
    items = frappe.db.sql(
        """
        SELECT poi.parent AS po_number, poi.procurement_package AS work_package,
               poi.quote, poi.quantity, poi.tax, COALESCE(po.custom, '') = 'true' AS is_custom
        FROM "tabPurchase Order Item" poi
        JOIN "tabProcurement Orders" po ON po.name = poi.parent
        WHERE poi.parenttype = 'Procurement Orders' AND poi.parentfield = 'items' AND po.project = %(project)s
        ORDER BY poi.parent, poi.idx
        """,
        {"project": project_id},
        as_dict=True,
    )
    return {
        "pos": [{"name": po.name, "amount_paid": flt(po.amount_paid)} for po in pos],
        "items": [
            {
                "po_number": item.po_number,
                "work_package": item.work_package,
                "quote": flt(item.quote),
                "quantity": flt(item.quantity),
                "tax": flt(item.tax),
                "isCustom": bool(item.is_custom),
            }
            for item in items
        ],
    }
