"""Monthly asset audit -- the holder sends it, a category is switched (owner, 2026-10-14).

- Submit: the person who holds the asset sends its condition and a photo from their profile. The open audit
  on their Asset Management row becomes Fulfilled, the photo goes into `audit_proof`, the asset's
  `asset_condition` takes the new condition, and an "Audit Fulfilled" history row keeps both.
- Category switch: ticking a category's "Monthly audit required" opens the cycle month's audits of its assets
  at once (the Asset Category hook); unticking leaves open audits to be sent and stops new ones.

Rules: `services/asset_audit.py`; which assignments owe an audit: `services/asset_audit_open.py`.

The holder only reads Asset Management, so the checks here are the authorisation and the writes skip
permissions.
"""

import frappe
from frappe.utils import cint, today

from nirmaan_stack.integrations.controllers.asset_management import notify_asset_changed
from nirmaan_stack.services.asset_audit import AUDIT_FULFILLED, fulfilled_text, submit_refusal
from nirmaan_stack.services.asset_audit_access import check_may_switch_category_audit
from nirmaan_stack.services.asset_audit_open import is_serialization_failure
from nirmaan_stack.services.asset_history import AUDIT_FULFILLED as AUDIT_FULFILLED_EVENT
from nirmaan_stack.services.asset_history import add_history

ASSET_MASTER_DOCTYPE = "Asset Master"
ASSET_MANAGEMENT_DOCTYPE = "Asset Management"
ASSET_CATEGORY_DOCTYPE = "Asset Category"
PROOF_FIELD = "audit_proof"
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif")


@frappe.whitelist(methods=["POST"])
def submit_audit(assignment: str, condition: str, photo: str, remarks: str | None = None) -> dict:
    """Send the audit for an asset the signed-in person holds.

    The photo is uploaded first as a private file attached to nothing (the holder can't write Asset
    Management, so Frappe's upload can't attach it); this claims it for the assignment. Only a file the
    caller uploaded, not yet attached elsewhere, can be claimed.

    Args:
        assignment: the Asset Management row with the open audit.
        condition: one of services/asset_audit.AUDIT_CONDITIONS.
        photo: the uploaded photo's file_url.
        remarks: what is wrong; required (at least 10 characters) for Poor and Damaged.

    Returns:
        {"assignment": <name>, "audit_status": "Fulfilled", "condition": <condition>}

    Example:
        POST /api/method/nirmaan_stack.api.assets.audits.submit_audit
        {"assignment": "k72sevcfkp", "condition": "Damaged", "photo": "/private/files/tab.jpg",
         "remarks": "Screen cracked at the left corner"}
    """
    user = frappe.session.user
    if not frappe.db.exists(ASSET_MANAGEMENT_DOCTYPE, assignment):
        frappe.throw("This asset is no longer assigned to you. Reload the page.")
    try:
        # The lock makes a second submit (another tab) wait; at REPEATABLE READ it then fails here
        # instead of reading the row as it was before the first one committed.
        row = frappe.get_doc(ASSET_MANAGEMENT_DOCTYPE, assignment, for_update=True)
    except Exception as exc:
        if is_serialization_failure(exc):
            frappe.throw("This audit was just submitted in another window. Reload the page.")
        raise

    holder = frappe.db.get_value(ASSET_MASTER_DOCTYPE, row.asset, "current_assignee")
    if row.asset_assigned_to != user or holder != user:
        frappe.throw("Only the person who holds this asset can submit its audit.", frappe.PermissionError)

    photo = (photo or "").strip()
    refusal = submit_refusal(row.audit_status, condition, bool(photo), remarks)
    if refusal:
        frappe.throw(refusal)
    _claim_photo(photo, user, row.name)

    previous_condition = frappe.db.get_value(ASSET_MASTER_DOCTYPE, row.asset, "asset_condition")
    # set_value skips the Asset Management hooks (holder + declaration history: unchanged here) and Asset
    # Master's validate (department + history guards: untouched here). Nothing is derived from these
    # fields, so no recompute is skipped.
    frappe.db.set_value(
        ASSET_MANAGEMENT_DOCTYPE,
        row.name,
        # Sent: no longer overdue -- the missed months stay in the history as "Audit Missed" rows.
        {"audit_status": AUDIT_FULFILLED, "last_audit_on": today(), PROOF_FIELD: photo, "audit_overdue_since": None},
    )
    frappe.db.set_value(ASSET_MASTER_DOCTYPE, row.asset, "asset_condition", condition)
    add_history(
        row.asset,
        AUDIT_FULFILLED_EVENT,
        assigned_to=user,
        declaration=photo,  # the history row's file field; the event says it is the audit proof
        reason=fulfilled_text(condition, previous_condition, row.audit_month, remarks),
    )
    notify_asset_changed(row.asset)
    frappe.db.commit()
    return {"assignment": row.name, "audit_status": AUDIT_FULFILLED, "condition": condition}


@frappe.whitelist(methods=["POST"])
def set_category_audit(category: str, required: int | str) -> dict:
    """Switch a category's "Monthly audit required" on or off.

    On: the cycle month's audits of its assigned assets open at once (the Asset Category hook; from the 28th,
    next month's). Off: no new audits open; audits already open stay to be sent, and the 7th after their month
    records any still unsent as Missed and closes them.

    Returns:
        {"category": <name>, "audit_required": 0 | 1, "opened": <audits opened now>}

    Example:
        POST /api/method/nirmaan_stack.api.assets.audits.set_category_audit {"category": "Laptop", "required": 1}
    """
    check_may_switch_category_audit()
    required = 1 if cint(required) else 0
    doc = frappe.get_doc(ASSET_CATEGORY_DOCTYPE, category, for_update=True)
    if cint(doc.audit_required) == required:
        return {"category": doc.name, "audit_required": required, "opened": 0}
    doc.audit_required = required
    doc.save(ignore_permissions=True)  # the profile was checked above
    frappe.db.commit()
    return {"category": doc.name, "audit_required": required, "opened": len(doc.flags.audits_opened or [])}


def _claim_photo(file_url: str, user: str, assignment: str) -> None:
    """Attach the caller's uploaded photo to the assignment's `audit_proof`.

    `set_value` on File skips File's hooks on purpose: only the attachment link changes, not the stored
    object (as `move_files_to_asset` does). On Unassign that hook moves it, with the declaration, to the
    asset, so the history's link keeps working.
    """
    files = frappe.get_all(
        "File",
        filters={"file_url": file_url, "owner": user},
        fields=["name", "file_name", "attached_to_doctype", "attached_to_name"],
        order_by="creation desc",
    )
    claimable = [
        f for f in files
        if not f.attached_to_doctype
        or (f.attached_to_doctype == ASSET_MANAGEMENT_DOCTYPE and f.attached_to_name == assignment)
    ]
    if not claimable:
        frappe.throw("The photo wasn't found. Add it again, then submit.")
    file = claimable[0]
    if not (file.file_name or "").lower().endswith(IMAGE_EXTENSIONS):
        frappe.throw("The proof must be a photo (JPG, PNG, WEBP or HEIC).")
    frappe.db.set_value(
        "File",
        file.name,
        {"attached_to_doctype": ASSET_MANAGEMENT_DOCTYPE, "attached_to_name": assignment, "attached_to_field": PROOF_FIELD},
        update_modified=False,
    )
