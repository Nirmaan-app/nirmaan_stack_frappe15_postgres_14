"""An employee returns an asset; a manager approves or rejects the return (owner, 2026-10-13).

- Return -- the person who holds the asset, from their own profile: ticks `returned` + `returned_on` on
  the assignment. The asset stays assigned; it only tells the managers "I've given this back". History:
  "Return Requested". Refused while the asset's monthly audit is Pending (owner, 2026-10-14).
- Approve -- the same people as Unassign (Admin, HR, PMO; procurement for Project assets): the full
  Unassign (`api/assets/assign.unassign_asset`) with the reason "Returned – no longer needed" and the
  return date, so the asset is free and its history says when it came back.
- Reject -- the same people as Approve (owner, 2026-10-13: procurement too, for Project assets): clears
  the two fields, the person keeps the asset. History: "Return Rejected". If the asset now owes the
  cycle month's audit (a run skipped it while the return waited), it opens.

The holder only reads Asset Management, so the checks here are the authorisation and the saves pass
`ignore_permissions`.
"""

import frappe
from frappe.utils import formatdate, today

from nirmaan_stack.api.assets.assign import unassign_asset
from nirmaan_stack.services.asset_assign_access import check_may_assign
from nirmaan_stack.services.asset_audit import AUDIT_PENDING, NOTE_RETURN_REJECTED
from nirmaan_stack.services.asset_audit_open import is_serialization_failure, open_due_audits
from nirmaan_stack.services.asset_history import RETURN_REJECTED, RETURN_REQUESTED, add_history

ASSET_MASTER_DOCTYPE = "Asset Master"
ASSET_MANAGEMENT_DOCTYPE = "Asset Management"
DECLARATION_FIELD = "asset_declaration_attachment"
RETURNED_REASON = "Returned – no longer needed"  # one of services/asset_unassign.UNASSIGN_REASONS


@frappe.whitelist(methods=["POST"])
def request_return(assignment: str) -> dict:
    """Tell the managers the signed-in person gave this asset back today.

    Returns:
        {"assignment": <name>, "returned_on": <YYYY-MM-DD>}

    Example:
        POST /api/method/nirmaan_stack.api.assets.returns.request_return {"assignment": "k72sevcfkp"}
    """
    row = _assignment(assignment, for_update=True)
    user = frappe.session.user
    holder = frappe.db.get_value(ASSET_MASTER_DOCTYPE, row.asset, "current_assignee")
    if row.asset_assigned_to != user or holder != user:
        frappe.throw("Only the person who holds this asset can return it.", frappe.PermissionError)
    if not row.get(DECLARATION_FIELD):
        frappe.throw("Sign the declaration for this asset first, then return it.")
    if row.get("audit_status") == AUDIT_PENDING:
        # Owner, 2026-10-14: the holder sends the open audit before handing the asset back. Admin / HR
        # unassigning is never blocked by it.
        frappe.throw("Submit the pending audit for this asset first, then return it.")
    if row.returned:
        frappe.throw(f"You already returned this asset on {formatdate(row.returned_on)}. It is waiting for approval.")

    row.returned = 1
    row.returned_on = today()
    row.save(ignore_permissions=True)
    add_history(row.asset, RETURN_REQUESTED, assigned_to=user)
    frappe.db.commit()
    return {"assignment": row.name, "returned_on": str(row.returned_on)}


@frappe.whitelist(methods=["POST"])
def approve_return(assignment: str) -> dict:
    """Accept a return: unassign the asset, recording when it was returned.

    Returns:
        {"asset": <Asset Master name>}

    Example:
        POST /api/method/nirmaan_stack.api.assets.returns.approve_return {"assignment": "k72sevcfkp"}
    """
    row = _assignment(assignment)
    check_may_assign(row.asset, "approve returns of")
    if not row.returned:
        frappe.throw("This asset has no return waiting for approval.")

    who = frappe.db.get_value("Nirmaan Users", row.asset_assigned_to, "full_name") or row.asset_assigned_to
    details = f"returned by {who} on {formatdate(row.returned_on)}"
    return unassign_asset(row.asset, RETURNED_REASON, details=details, assignment=row.name)


@frappe.whitelist(methods=["POST"])
def reject_return(assignment: str) -> dict:
    """Turn a return down -- the asset never arrived, say: clear it, the person keeps the asset.

    Returns:
        {"assignment": <name>}

    Example:
        POST /api/method/nirmaan_stack.api.assets.returns.reject_return {"assignment": "k72sevcfkp"}
    """
    row = _assignment(assignment, for_update=True)
    check_may_assign(row.asset, "reject returns of")
    if not row.returned:
        frappe.throw("This asset has no return waiting for approval.")

    returned_on = row.returned_on
    row.returned = 0
    row.returned_on = None
    row.save(ignore_permissions=True)
    add_history(
        row.asset, RETURN_REJECTED, assigned_to=row.asset_assigned_to, reason=f"Return of {formatdate(returned_on)}"
    )
    # The 28th / 7th runs skip an asset while its return waits: open the cycle month's audit now if it
    # owes one (owner, 2026-10-14).
    open_due_audits(assignment=row.name, note=NOTE_RETURN_REJECTED)
    frappe.db.commit()
    return {"assignment": row.name}


def _assignment(name: str, for_update: bool = False):
    """The assignment, or a plain message when someone already approved its return in another window.

    With `for_update`, a second request on the same row (a double-click on Return, two managers rejecting
    at once) fails its lock on PostgreSQL once the first commits; it gets a "reload" message instead of a
    database error.
    """
    if not frappe.db.exists(ASSET_MANAGEMENT_DOCTYPE, name):
        frappe.throw("This asset is no longer assigned -- its return was already approved. Reload the page.")
    try:
        return frappe.get_doc(ASSET_MANAGEMENT_DOCTYPE, name, for_update=for_update)
    except Exception as exc:
        if is_serialization_failure(exc):
            frappe.throw("This asset was just changed in another window. Reload the page.")
        raise
