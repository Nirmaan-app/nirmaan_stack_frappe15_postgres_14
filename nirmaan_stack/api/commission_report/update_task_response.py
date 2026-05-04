# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Wizard save endpoint for commissioning report responses.

Targets a single child row (no array rewrite), enforces optimistic concurrency
on the parent's `modified` timestamp, dedupes the template snapshot via
content-addressed storage, and re-validates assignee/role permission server-side.
"""

import hashlib
import json

import frappe
from frappe.utils import now_datetime, now

CONCURRENCY_ERROR = "CommissionReportConcurrencyError"
EVIDENCE_DOCTYPE = "Commission Report Template Snapshot"
CHILD_DOCTYPE = "Commission Report Task Child Table"

# Roles that can edit any task regardless of assignment.
_FULL_EDIT_ROLES = {
    "System Manager",
    "Nirmaan PMO Executive",
    "Nirmaan Design Lead",
}

# Roles restricted to tasks they're personally assigned to.
_RESTRICTED_EDIT_ROLES = {
    "Nirmaan Design Executive",
    "Nirmaan Project Manager",
}


def _canonical_json(payload: dict) -> str:
    """Stable byte-for-byte serialization for hashing.

    Python's `json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)`
    matches a normalized JS `JSON.stringify` with a sorting-key replacer, which
    is what the frontend uses before sending."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _get_or_create_snapshot(snapshot_payload) -> str:
    """Upsert a Commission Report Template Snapshot, return its docname (= hash)."""
    if isinstance(snapshot_payload, str):
        try:
            parsed = json.loads(snapshot_payload)
        except Exception:
            frappe.throw("snapshot_payload must be valid JSON.")
    elif isinstance(snapshot_payload, dict):
        parsed = snapshot_payload
    else:
        frappe.throw("snapshot_payload must be a JSON string or object.")

    canonical = _canonical_json(parsed)
    payload_hash = _sha256_hex(canonical)

    if frappe.db.exists(EVIDENCE_DOCTYPE, payload_hash):
        return payload_hash

    snapshot = frappe.new_doc(EVIDENCE_DOCTYPE)
    snapshot.payload_hash = payload_hash
    snapshot.template_id = parsed.get("templateId") or ""
    snapshot.template_version = parsed.get("templateVersion") or 1
    snapshot.template_title = parsed.get("title") or ""
    snapshot.first_seen_at = now_datetime()
    snapshot.payload = canonical
    snapshot.insert(ignore_permissions=True)
    return snapshot.name


def _user_can_edit_task(task_row) -> bool:
    """Mirrors the frontend gating: full-edit roles bypass; restricted roles
    must be in `assigned_designers`."""
    user = frappe.session.user
    if user == "Administrator":
        return True
    user_roles = set(frappe.get_roles(user))
    if user_roles & _FULL_EDIT_ROLES:
        return True
    if not (user_roles & _RESTRICTED_EDIT_ROLES):
        # No commission edit role at all.
        return False

    raw = (task_row.assigned_designers or "").strip()
    if not raw:
        return False
    try:
        data = json.loads(raw)
    except Exception:
        return False
    members = data.get("list") if isinstance(data, dict) else None
    if not isinstance(members, list):
        return False
    return any((m or {}).get("userId") == user for m in members)


def _find_task_row(parent_doc, task_row_name: str):
    for row in parent_doc.get("commission_report_task", []):
        if row.name == task_row_name:
            return row
    return None


@frappe.whitelist()
def update_task_response(
    parent: str,
    task_row_name: str,
    response_data: str,
    snapshot_payload,
    expected_modified: str,
):
    """Persist a wizard fill onto a single child row.

    Args:
      parent:            Project Commission Report docname.
      task_row_name:     Commission Report Task Child Table row name.
      response_data:     JSON string to write into `response_data`.
      snapshot_payload:  Either a JSON string or a dict — the template that was
                         used at fill time. Hashed and upserted into the
                         snapshot pool.
      expected_modified: ISO timestamp of the parent doc as the client last saw
                         it. Used for optimistic concurrency.

    Raises ValidationError(CONCURRENCY_ERROR) if expected_modified mismatches.
    """
    if not parent:
        frappe.throw("parent is required.")
    if not task_row_name:
        frappe.throw("task_row_name is required.")
    if not response_data:
        frappe.throw("response_data is required.")
    if not snapshot_payload:
        frappe.throw("snapshot_payload is required.")
    if not expected_modified:
        frappe.throw("expected_modified is required.")

    # Validate response JSON shape early.
    try:
        parsed_response = json.loads(response_data) if isinstance(response_data, str) else response_data
    except Exception:
        frappe.throw("response_data must be valid JSON.")
    if not isinstance(parsed_response, dict) or not parsed_response.get("responses"):
        frappe.throw("response_data must contain a non-empty `responses` object.")

    # Cap payload size at 1 MB.
    if len(response_data) > 1024 * 1024:
        frappe.throw("response_data exceeds 1 MB limit.")

    parent_doc = frappe.get_doc("Project Commission Report", parent)

    # Optimistic concurrency check.
    actual_modified = str(parent_doc.modified) if parent_doc.modified else ""
    if actual_modified != str(expected_modified):
        frappe.throw(
            "The commission report has been modified by someone else. Refresh and try again.",
            title=CONCURRENCY_ERROR,
        )

    task_row = _find_task_row(parent_doc, task_row_name)
    if not task_row:
        frappe.throw(f"Task row {task_row_name} not found on {parent}.")

    if not _user_can_edit_task(task_row):
        frappe.throw(
            "You don't have permission to fill this commissioning report.",
            frappe.PermissionError,
        )

    snapshot_id = _get_or_create_snapshot(snapshot_payload)

    # Single-row, four-field write — bypasses the "rewrite array" anti-pattern.
    frappe.db.set_value(
        CHILD_DOCTYPE,
        task_row_name,
        {
            "response_data": response_data,
            "response_snapshot_id": snapshot_id,
            "response_filled_at": task_row.response_filled_at or now_datetime(),
            "response_filled_by": task_row.response_filled_by or frappe.session.user,
        },
        update_modified=False,  # don't bump child row modified to keep parent.modified meaningful
    )
    # Bump the parent's modified so subsequent concurrency checks see this change.
    frappe.db.set_value(
        "Project Commission Report",
        parent,
        {"modified": now()},
        update_modified=False,
    )
    frappe.db.commit()

    return {
        "status": "success",
        "task_row_name": task_row_name,
        "response_snapshot_id": snapshot_id,
        "parent_modified": frappe.db.get_value("Project Commission Report", parent, "modified"),
    }
