"""
Lifecycle endpoints for Internal Transfer Memos — approve / reject / delete.

These thin wrappers only set status fields and save; all authorization
(Admin-only for approve/reject; Creator-or-Admin for delete), state-machine
guards, concurrency re-checks, and the rejection-reason length requirement
are enforced by the controller's ``validate`` / ``before_delete`` hooks at
``nirmaan_stack.integrations.controllers.internal_transfer_memo``.

Each mutation commits before returning so subsequent reads (and the
Phase 4 ``publish_realtime`` call sites) see a consistent DB state.
"""

from typing import Any

import frappe
from frappe import _

ADMIN_ROLE = "Nirmaan Admin Profile"


@frappe.whitelist()
def approve_itm(name: str) -> dict:
	"""Transition a Pending Approval ITM to Approved.

	The controller's ``validate`` hook re-runs the availability guard and
	enforces that only users with the Admin role (or user ``Administrator``)
	may perform this transition.

	Args:
	    name: ``Internal Transfer Memo`` docname.

	Returns:
	    ``{"name", "status", "approved_by", "approved_on"}`` (wrapped by
	    Frappe under the top-level ``message`` key on the wire).
	"""

	if frappe.session.user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)

	doc = frappe.get_doc("Internal Transfer Memo", name)

	if doc.status != "Pending Approval":
		frappe.throw(
			_("Only Pending Approval ITMs can be approved; current status is '{0}'.")
			.format(doc.status)
		)

	doc.status = "Approved"
	# Controller stamps approved_by / approved_on and enforces admin role.
	doc.save()
	frappe.db.commit()

	return {
		"name": doc.name,
		"status": doc.status,
		"approved_by": doc.approved_by,
		"approved_on": str(doc.approved_on) if doc.approved_on else None,
	}


@frappe.whitelist()
def reject_itm(name: str, reason: str) -> dict:
	"""Transition a Pending Approval ITM to Rejected with a required reason.

	A fail-fast length check mirrors the controller's 10-char minimum so
	malformed requests return a clear error before incurring a save cycle.

	Args:
	    name: ``Internal Transfer Memo`` docname.
	    reason: Rejection reason (≥ 10 chars after trimming).
	"""

	if frappe.session.user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)

	doc = frappe.get_doc("Internal Transfer Memo", name)

	if doc.status != "Pending Approval":
		frappe.throw(
			_("Only Pending Approval ITMs can be rejected; current status is '{0}'.")
			.format(doc.status)
		)

	cleaned = (reason or "").strip()
	if len(cleaned) < 10:
		frappe.throw(_("Rejection reason is required (min 10 chars)."))

	doc.rejection_reason = cleaned
	doc.status = "Rejected"
	# Controller enforces admin role + re-validates reason length.
	doc.save()
	frappe.db.commit()

	return {
		"name": doc.name,
		"status": doc.status,
		"rejection_reason": doc.rejection_reason,
	}


@frappe.whitelist()
def approve_itm_items(name: str, items: Any = None) -> dict:
    """Per-item approve/reject within an ITM.

    Args:
        name: ``Internal Transfer Memo`` docname.
        items: JSON list of ``{item_name: str, action: 'approve'|'reject',
            reason?: str}`` where ``item_name`` is the Frappe child row name.

    Returns:
        ``{"name", "status", "items": [{item_name, status}...]}``
    """

    if frappe.session.user == "Guest":
        frappe.throw(_("Authentication required."), frappe.PermissionError)

    roles = frappe.get_roles(frappe.session.user)
    if frappe.session.user != "Administrator" and ADMIN_ROLE not in roles:
        frappe.throw(_("Only admins can approve or reject ITM items."), frappe.PermissionError)

    doc = frappe.get_doc("Internal Transfer Memo", name)

    blocked_statuses = ("Dispatched", "Partially Delivered", "Delivered")
    if doc.status in blocked_statuses:
        frappe.throw(
            _("Cannot modify item decisions on a {0} ITM.").format(doc.status)
        )

    parsed_items = frappe.parse_json(items) if isinstance(items, str) else (items or [])
    if not isinstance(parsed_items, list) or len(parsed_items) == 0:
        frappe.throw(_("At least one item decision is required."))

    # Build a lookup of child rows by their Frappe name
    child_by_name: dict[str, Any] = {row.name: row for row in doc.items}

    result_items: list[dict] = []
    for entry in parsed_items:
        if not isinstance(entry, dict):
            continue

        item_name = (entry.get("item_name") or "").strip()
        action = (entry.get("action") or "").strip().lower()
        reason = (entry.get("reason") or "").strip()

        if item_name not in child_by_name:
            frappe.throw(_("Item row '{0}' not found in ITM {1}.").format(item_name, name))

        child = child_by_name[item_name]

        # Skip already-decided items
        if child.status and child.status != "Pending":
            result_items.append({"item_name": item_name, "status": child.status})
            continue

        if action == "approve":
            child.status = "Approved"
        elif action == "reject":
            if len(reason) < 10:
                frappe.throw(
                    _("Rejection reason for item '{0}' is required (min 10 chars).")
                    .format(item_name)
                )
            child.status = "Rejected"
            child.rejection_reason = reason
        else:
            frappe.throw(_("Invalid action '{0}' for item '{1}'. Use 'approve' or 'reject'.").format(action, item_name))

        result_items.append({"item_name": item_name, "status": child.status})

    # Save triggers controller validate which derives memo-level status
    doc.save()
    frappe.db.commit()

    return {
        "name": doc.name,
        "status": doc.status,
        "items": result_items,
    }


@frappe.whitelist()
def dispatch_itm(name: str) -> dict:
    """Dispatch an ITM. Requires at least one approved item.

    Auto-rejects any remaining Pending items before dispatching.

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

    # Must have at least one approved item
    has_approved = any(row.status == "Approved" for row in doc.items)
    if not has_approved:
        frappe.throw(_("Cannot dispatch: at least one item must be Approved."))

    # Auto-reject remaining Pending items
    for row in doc.items:
        if not row.status or row.status == "Pending":
            row.status = "Rejected"
            row.rejection_reason = "Not reviewed before dispatch"

    doc.status = "Dispatched"
    doc.dispatched_by = frappe.session.user
    doc.dispatched_on = frappe.utils.now_datetime()
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
	Dispatched / Partially Delivered / Delivered statuses and enforces the
	creator-or-admin authorization rule.

	Args:
	    name: ``Internal Transfer Memo`` docname.
	"""

	if frappe.session.user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)

	# Let frappe.DoesNotExistError propagate naturally (→ 404) if the doc is missing.
	frappe.get_doc("Internal Transfer Memo", name)

	frappe.delete_doc("Internal Transfer Memo", name)
	frappe.db.commit()

	return {"name": name, "deleted": True}
