# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Daily server-side janitor for commissioning report image attachments.

Belt-and-braces backup to the client-side cleanup in
api/commission_report/delete_orphan_attachments.py — catches attachments
orphaned by browser crashes, network failures during cancel-cleanup, or
abandoned tabs that never fired beforeunload.

Wizard uploads use standard Frappe File records attached to the child task row
with `attached_to_field = "commission_report_image"`. Algorithm:
  1. List all wizard-uploaded File records older than 24 h.
  2. Build the set of File docnames referenced by any live response_data on any
     Commission Report Task Child Table row.
  3. Delete any candidate not in that set.
"""

import json

import frappe
from frappe.utils import add_to_date, now_datetime

CHILD_DOCTYPE = "Commission Report Task Child Table"
WIZARD_FIELDNAME = "commission_report_image"
GRACE_HOURS = 24


def _collect_referenced_file_docs() -> set:
    """Returns every File docname appearing in any live response_data.attachments[].file_doc."""
    referenced = set()
    rows = frappe.get_all(
        CHILD_DOCTYPE,
        filters={"response_data": ["is", "set"]},
        fields=["name", "response_data"],
        limit_page_length=0,
    )
    for row in rows:
        raw = (row.response_data or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        attachments = (data or {}).get("attachments") or {}
        if not isinstance(attachments, dict):
            continue
        for slot_value in attachments.values():
            if not isinstance(slot_value, list):
                continue
            for item in slot_value:
                # New shape: dict with file_doc. Legacy shape: NA name string — skip
                # (those are tracked under the Nirmaan Attachments doctype, not File).
                if isinstance(item, dict) and item.get("file_doc"):
                    referenced.add(str(item["file_doc"]))
    return referenced


def cleanup_orphan_commission_attachments():
    """Daily cron entry point. Wired in hooks.py scheduler_events.daily."""
    cutoff = add_to_date(now_datetime(), hours=-GRACE_HOURS)

    candidates = frappe.get_all(
        "File",
        filters={
            "attached_to_doctype": CHILD_DOCTYPE,
            "attached_to_field": WIZARD_FIELDNAME,
            "creation": ["<", cutoff],
        },
        fields=["name"],
        limit_page_length=0,
    )
    if not candidates:
        return

    referenced = _collect_referenced_file_docs()

    deleted = 0
    for c in candidates:
        if c.name in referenced:
            continue
        try:
            frappe.delete_doc("File", c.name, ignore_permissions=True)
            deleted += 1
        except Exception:
            continue

    if deleted:
        frappe.db.commit()
        frappe.logger().info(
            f"[commissioning] orphan-attachment janitor deleted {deleted} File rows"
        )
