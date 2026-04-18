"""
Approve selected items in an Internal Transfer Request → creates ITM(s).

Groups approved items by source_project and creates one ITM per source.
Each ITM starts in "Approved" status — ready for dispatch.
"""

from typing import Any

import frappe
from frappe import _
from frappe.utils import flt, now_datetime


ADMIN_ROLE = "Nirmaan Admin Profile"


@frappe.whitelist()
def approve_itr_items(itr_name: str, item_names: Any) -> dict:
    """Approve selected items in an ITR and create ITM(s) from them.

    Args:
        itr_name: Internal Transfer Request name.
        item_names: JSON list of child row names (frappe `name` field) to approve.

    Returns:
        ``{"itr_name", "itr_status", "created_itms": ["ITM-..."], "count": N}``
    """
    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required."), frappe.PermissionError)

    _require_admin()

    item_names = frappe.parse_json(item_names) if isinstance(item_names, str) else (item_names or [])
    if not isinstance(item_names, list) or len(item_names) == 0:
        frappe.throw(_("At least one item must be selected for approval."))

    itr = frappe.get_doc("Internal Transfer Request", itr_name)

    if itr.status in ("Completed", "Rejected"):
        frappe.throw(_("Cannot approve items on a {0} request.").format(itr.status))

    # --- Validate selected items are Pending ---
    child_by_name = {row.name: row for row in itr.items}
    selected_items = []
    for item_name in item_names:
        if item_name not in child_by_name:
            frappe.throw(_("Item row '{0}' not found in {1}.").format(item_name, itr_name))
        row = child_by_name[item_name]
        if row.status != "Pending":
            frappe.throw(
                _("Item '{0}' is already {1}, cannot approve.").format(
                    row.item_name or row.item_id, row.status
                )
            )
        selected_items.append(row)

    # --- Re-run availability guard for selected items ---
    from nirmaan_stack.integrations.controllers.internal_transfer_request import (
        available_quantity,
    )

    aggregated: dict[str, float] = {}
    for row in selected_items:
        aggregated[row.item_id] = aggregated.get(row.item_id, 0) + flt(row.transfer_quantity)

    errors = []
    for item_id, requested in aggregated.items():
        available = available_quantity(item_id, itr.source_project, exclude_itr=itr_name)
        if requested > flt(available):
            errors.append(
                f"Item {item_id}: requested {requested}, available {available}"
            )
    if errors:
        frappe.throw(
            _("Insufficient available quantity:\n- {0}").format("\n- ".join(errors))
        )

    # --- Create single ITM (all items from same source) ---
    created_itms = []

    itm = frappe.new_doc("Internal Transfer Memo")
    itm.source_project = itr.source_project
    itm.target_project = itr.target_project
    itm.transfer_request = itr.name
    itm.source_rir = itr.source_rir
    itm.status = "Approved"
    itm.requested_by = itr.requested_by
    itm.approved_by = frappe.session.user
    itm.approved_on = now_datetime()

    for row in selected_items:
        itm.append("items", {
            "item_id": row.item_id,
            "item_name": row.item_name,
            "unit": row.unit,
            "category": row.category,
            "make": row.make,
            "transfer_quantity": row.transfer_quantity,
            "estimated_rate": row.estimated_rate,
            "received_quantity": 0,
        })

    itm.insert(ignore_permissions=True)
    created_itms.append(itm.name)

    # Link ITR items back to the created ITM
    for row in selected_items:
        row.status = "Approved"
        row.linked_itm = itm.name

    # --- Update memo count and derive ITR status ---
    itr.memo_count = (itr.memo_count or 0) + len(created_itms)
    _derive_itr_status(itr)
    itr.save(ignore_permissions=True)

    frappe.db.commit()

    return {
        "itr_name": itr.name,
        "itr_status": itr.status,
        "created_itms": created_itms,
        "count": len(created_itms),
    }


@frappe.whitelist()
def reject_itr_items(itr_name: str, item_names: Any, reason: str = "") -> dict:
    """Reject selected items in an ITR.

    Args:
        itr_name: Internal Transfer Request name.
        item_names: JSON list of child row names to reject.
        reason: Rejection reason (required, min 10 chars).

    Returns:
        ``{"itr_name", "itr_status", "rejected_count": N}``
    """
    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required."), frappe.PermissionError)

    _require_admin()

    item_names = frappe.parse_json(item_names) if isinstance(item_names, str) else (item_names or [])
    if not isinstance(item_names, list) or len(item_names) == 0:
        frappe.throw(_("At least one item must be selected for rejection."))

    cleaned_reason = (reason or "").strip()
    if len(cleaned_reason) < 10:
        frappe.throw(_("Rejection reason is required (min 10 chars)."))

    itr = frappe.get_doc("Internal Transfer Request", itr_name)

    if itr.status in ("Completed", "Rejected"):
        frappe.throw(_("Cannot reject items on a {0} request.").format(itr.status))

    child_by_name = {row.name: row for row in itr.items}
    rejected_count = 0
    for item_name in item_names:
        if item_name not in child_by_name:
            frappe.throw(_("Item row '{0}' not found in {1}.").format(item_name, itr_name))
        row = child_by_name[item_name]
        if row.status != "Pending":
            continue  # Skip already-decided items
        row.status = "Rejected"
        row.rejection_reason = cleaned_reason
        rejected_count += 1

    _derive_itr_status(itr)
    itr.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "itr_name": itr.name,
        "itr_status": itr.status,
        "rejected_count": rejected_count,
    }


def _derive_itr_status(itr):
    """Derive ITR status from child item statuses."""
    statuses = [row.status for row in itr.items]
    if not statuses:
        return

    has_pending = any(s == "Pending" for s in statuses)
    all_rejected = all(s == "Rejected" for s in statuses)

    if all_rejected:
        itr.status = "Rejected"
    elif has_pending:
        itr.status = "Pending"
    else:
        # All items are either Approved or Rejected (no Pending left)
        itr.status = "Completed"


def _require_admin():
    user = frappe.session.user
    if user == "Administrator":
        return
    if ADMIN_ROLE in frappe.get_roles(user):
        return
    frappe.throw(_("Only administrators may approve or reject items."), frappe.PermissionError)
