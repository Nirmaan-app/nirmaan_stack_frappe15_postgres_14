"""Monthly asset audit -- the holder sends it, a category is switched (owner, 2026-10-14).

- Questions: the holder first answers the questions for the asset's category type (Project / IT). They live in
  the dialog only (`frontend/src/utils/assetAuditQuestions.ts`, owner 2026-10-15); each answer arrives with its
  question text, and `services/asset_audit.clean_answers` checks the shape.
- Submit: the person who holds the asset sends the answers and a photo from their profile. The open audit on
  their Asset Management row becomes Fulfilled, the photo goes into `audit_proof`, the answers into
  `audit_answers` (the latest audit only), and an "Audit Fulfilled" history row keeps them for good. The audit
  doesn't touch the asset's condition: the answers show any issue (owner, 2026-10-15).
- Category switch: ticking a category's "Monthly audit required" opens the cycle month's audits of its assets
  at once (the Asset Category hook); unticking leaves open audits to be sent and stops new ones.

Rules: `services/asset_audit.py`; which assignments owe an audit: `services/asset_audit_open.py`.

The holder only reads Asset Management, so the checks here are the authorisation and the writes skip
permissions.
"""

import json

import frappe
from frappe.utils import cint, today

from nirmaan_stack.integrations.controllers.asset_management import notify_asset_changed
from nirmaan_stack.services.asset_audit import (
    AUDIT_FULFILLED,
    AUDIT_PHOTO_EXTENSIONS,
    clean_answers,
    fulfilled_text,
    submit_refusal,
)
from nirmaan_stack.services.asset_audit_access import check_may_switch_category_audit
from nirmaan_stack.services.asset_audit_open import is_serialization_failure
from nirmaan_stack.services.asset_history import AUDIT_FULFILLED as AUDIT_FULFILLED_EVENT
from nirmaan_stack.services.asset_history import add_history

ASSET_MASTER_DOCTYPE = "Asset Master"
ASSET_MANAGEMENT_DOCTYPE = "Asset Management"
ASSET_CATEGORY_DOCTYPE = "Asset Category"
PROOF_FIELD = "audit_proof"
ANSWERS_FIELD = "audit_answers"


@frappe.whitelist(methods=["POST"])
def submit_audit(assignment: str, photo: str, remarks: str | None = None, answers: str | list | None = None) -> dict:
    """Send the audit for an asset the signed-in person holds.

    The photo is uploaded first as a private file attached to nothing (the holder can't write Asset
    Management, so Frappe's upload can't attach it); this claims it for the assignment. Only a file the
    caller uploaded, not yet attached elsewhere, can be claimed.

    Args:
        assignment: the Asset Management row with the open audit.
        photo: the uploaded photo's file_url.
        remarks: anything else the holder wants to say; optional.
        answers: [{"id", "q": <the question>, "a": <the choice>, "flag": <1 on a red answer>, "text": <optional
            note, red answers>}], one per question the dialog asked; a JSON string or a list. Saved as
            {"answers": [...]} on the assignment and the history row (`services/asset_audit.clean_answers`).

    Returns:
        {"assignment": <name>, "audit_status": "Fulfilled"}

    Example:
        POST /api/method/nirmaan_stack.api.assets.audits.submit_audit
        {"assignment": "k72sevcfkp", "photo": "/private/files/tab.jpg", "remarks": "Kept in the site office",
         "answers": [{"id": "who", "q": "Who is using this device?", "a": "Only me, for work"},
                     {"id": "damage", "q": "Is it damaged anywhere?", "a": "Badly damaged: cracked or broken",
                      "flag": 1, "text": "Screen cracked"}]}
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

    _check_holder(row.asset, row.asset_assigned_to)

    photo = (photo or "").strip()
    refusal = submit_refusal(row.audit_status, bool(photo))
    if refusal:
        frappe.throw(refusal)
    try:
        submitted = frappe.parse_json(answers) if answers else []
    except ValueError:
        submitted = None  # not JSON: clean_answers refuses it
    saved_answers, refusal = clean_answers(submitted)
    if refusal:
        frappe.throw(refusal)
    # Stored as {"answers": [...]}: Frappe reads a JSON column back as Python, and refuses a *list* in a JSON
    # field on the row's next save (a Return, an Edit) -- an object saves fine.
    answers_json = json.dumps({"answers": saved_answers}, ensure_ascii=False)
    _claim_photo(photo, user, row.name)

    # set_value skips the Asset Management hooks (holder + declaration history: unchanged here). Nothing is
    # derived from these fields, so no recompute is skipped.
    frappe.db.set_value(
        ASSET_MANAGEMENT_DOCTYPE,
        row.name,
        # Sent: no longer overdue -- the missed months stay in the history as "Audit Missed" rows.
        {
            "audit_status": AUDIT_FULFILLED,
            "last_audit_on": today(),
            PROOF_FIELD: photo,
            ANSWERS_FIELD: answers_json,  # the latest audit's; every month's stays on its history row
            "audit_overdue_since": None,
        },
    )
    add_history(
        row.asset,
        AUDIT_FULFILLED_EVENT,
        assigned_to=user,
        declaration=photo,  # the history row's file field; the event says it is the audit proof
        reason=fulfilled_text(row.audit_month, remarks),
        audit_answers=answers_json,
    )
    notify_asset_changed(row.asset)
    frappe.db.commit()
    return {"assignment": row.name, "audit_status": AUDIT_FULFILLED}


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
    try:
        doc = frappe.get_doc(ASSET_CATEGORY_DOCTYPE, category, for_update=True)
    except Exception as exc:
        # Someone switched it at the same moment: on PostgreSQL this lock then fails instead of waiting.
        if is_serialization_failure(exc):
            frappe.throw("This category was just changed by someone else. Reload the page and try again.")
        raise
    if cint(doc.audit_required) == required:
        return {"category": doc.name, "audit_required": required, "opened": 0}
    doc.audit_required = required
    doc.save(ignore_permissions=True)  # the profile was checked above
    frappe.db.commit()
    return {"category": doc.name, "audit_required": required, "opened": len(doc.flags.audits_opened or [])}


def _check_holder(asset: str, assigned_to: str) -> None:
    """Refuse (PermissionError) unless the session user holds `asset` through this assignment."""
    user = frappe.session.user
    holder = frappe.db.get_value(ASSET_MASTER_DOCTYPE, asset, "current_assignee")
    if assigned_to != user or holder != user:
        frappe.throw("Only the person who holds this asset can submit its audit.", frappe.PermissionError)


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
    if not (file.file_name or "").lower().endswith(AUDIT_PHOTO_EXTENSIONS):
        frappe.throw("The proof must be a photo (JPG, PNG, WEBP or HEIC).")
    frappe.db.set_value(
        "File",
        file.name,
        {"attached_to_doctype": ASSET_MANAGEMENT_DOCTYPE, "attached_to_name": assignment, "attached_to_field": PROOF_FIELD},
        update_modified=False,
    )
