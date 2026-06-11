# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Admin-only erase for a filled commissioning report response.

Rare operation — used to fix a bad fill that the user can't correct via the
edit wizard. Does NOT delete attachments (they're handled by the daily janitor
once they fall out of any response_data array)."""

import frappe
from frappe.utils import now

from nirmaan_stack.api.commission_report.update_task_response import CONCURRENCY_ERROR

CHILD_DOCTYPE = "Commission Report Task Child Table"
_ADMIN_ROLES = {"System Manager"}


@frappe.whitelist()
def clear_task_response(parent: str, task_row_name: str, expected_modified: str):
    if not parent or not task_row_name or not expected_modified:
        frappe.throw("parent, task_row_name, and expected_modified are required.")

    if frappe.session.user != "Administrator":
        if not (set(frappe.get_roles(frappe.session.user)) & _ADMIN_ROLES):
            frappe.throw(
                "Only Admins can clear a commissioning report response.",
                frappe.PermissionError,
            )

    parent_doc = frappe.get_doc("Project Commission Report", parent)
    actual_modified = str(parent_doc.modified) if parent_doc.modified else ""
    if actual_modified != str(expected_modified):
        frappe.throw(
            "The commission report has been modified by someone else. Refresh and try again.",
            title=CONCURRENCY_ERROR,
        )

    target_row = next(
        (r for r in parent_doc.get("commission_report_task", []) if r.name == task_row_name),
        None,
    )
    if not target_row:
        frappe.throw(f"Task row {task_row_name} not found on {parent}.")

    frappe.db.set_value(
        CHILD_DOCTYPE,
        task_row_name,
        {
            "response_data": None,
            "response_snapshot_id": None,
            "response_filled_at": None,
            "response_filled_by": None,
        },
        update_modified=False,
    )
    frappe.db.set_value(
        "Project Commission Report",
        parent,
        {"modified": now()},
        update_modified=False,
    )
    frappe.db.commit()

    return {"status": "success", "task_row_name": task_row_name}
