"""
Lifecycle endpoints for Internal Transfer Memos — dispatch only.

Approval/rejection logic has moved to the ITR level (approve_itr_items.py).
ITMs are created in "Approved" status and only need dispatch + delivery management.
"""

import frappe
from frappe import _

ADMIN_ROLE = "Nirmaan Admin Profile"


@frappe.whitelist()
def dispatch_itm(name: str) -> dict:
    """Dispatch an approved ITM.

    Args:
        name: ``Internal Transfer Memo`` docname.

    Returns:
        ``{"name", "status", "dispatched_by", "dispatched_on"}``
    """
    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required."), frappe.PermissionError)

    roles = frappe.get_roles(frappe.session.user)
    if frappe.session.user != "Administrator" and ADMIN_ROLE not in roles:
        frappe.throw(_("Only admins can dispatch ITMs."), frappe.PermissionError)

    doc = frappe.get_doc("Internal Transfer Memo", name)

    if doc.status != "Approved":
        frappe.throw(
            _("Only Approved ITMs can be dispatched; current status is '{0}'.")
            .format(doc.status)
        )

    doc.status = "Dispatched"
    doc.save()
    frappe.db.commit()

    return {
        "name": doc.name,
        "status": "Dispatched",
        "dispatched_by": doc.dispatched_by,
        "dispatched_on": str(doc.dispatched_on) if doc.dispatched_on else None,
    }


@frappe.whitelist()
def delete_itm(name: str) -> dict:
    """Delete an ITM that has not yet been dispatched.

    The controller's ``before_delete`` hook blocks deletion for
    Dispatched / Partially Delivered / Delivered statuses.
    """
    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required."), frappe.PermissionError)

    frappe.get_doc("Internal Transfer Memo", name)
    frappe.delete_doc("Internal Transfer Memo", name)
    frappe.db.commit()

    return {"name": name, "deleted": True}
