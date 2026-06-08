"""
Lifecycle endpoints for Internal Transfer Memos — dispatch + delete.

ITMs are created directly in "Approved" status by `create_itms`; this module
exposes the post-create transitions (dispatch) and the pre-dispatch cleanup
(delete). Permission gates are imported from the controller so UI gating,
the validate hook, and these whitelisted endpoints all read from the same
``role_profile_name`` source of truth.
"""

import frappe
from frappe import _

from nirmaan_stack.integrations.controllers.internal_transfer_memo import (
    _require_deleter,
    _require_dispatcher,
)


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

    _require_dispatcher(
        _("Only administrators or procurement executives can dispatch ITMs.")
    )

    doc = frappe.get_doc("Internal Transfer Memo", name)

    if doc.status != "Approved":
        frappe.throw(
            _("Only Approved ITMs can be dispatched; current status is '{0}'.")
            .format(doc.status)
        )

    doc.status = "Dispatched"
    # Bypass User Permission check on linked Project fields. Authorisation has
    # already been enforced above by `_require_dispatcher`; per-project User
    # Permissions are an orthogonal Frappe-level scoping that doesn't apply
    # to a cross-project workflow like ITM dispatch.
    doc.save(ignore_permissions=True)
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

    Authorization mirrors the controller's ``before_delete`` hook:
    Administrator OR a user whose ``role_profile_name`` is in
    ``DELETE_ROLES`` (Admin / PMO Executive / Procurement Executive).
    The hook still runs as defense-in-depth and additionally blocks
    deletion for Dispatched / Partially Delivered / Delivered statuses.
    """
    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required."), frappe.PermissionError)

    _require_deleter(
        _("Only administrators, PMO executives, or procurement executives "
          "may delete an Internal Transfer Memo.")
    )

    frappe.get_doc("Internal Transfer Memo", name)
    frappe.delete_doc("Internal Transfer Memo", name)
    frappe.db.commit()

    return {"name": name, "deleted": True}
