# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What a Work Order looked like before its current amendment, read from its Version history.

    vendor_before_amendment(work_order, vendor_now) -> str | None

The amend sheet changes the vendor and moves the WO to Amendment in one save, so by the time the
amendment is accepted the WO no longer holds the vendor it had. Service Requests has `track_changes`,
so every save through the document layer (SPA, Desk, REST) leaves a Version row of `[field, old, new]`
changes. This walks them newest first, undoing each vendor change, back to the save that moved the WO
from Approved to Amendment. Reads only; no request context.
"""

import json

import frappe

SR = "Service Requests"

#: How far back to look. A WO gets a handful of saves per amendment; this bounds a pathological history.
_VERSION_LIMIT = 500


def vendor_before_amendment(work_order: str, vendor_now: str | None) -> str | None:
    """The vendor `work_order` had when it entered its current amendment, starting from `vendor_now`
    (its vendor as stored before the save being validated). None when no Approved -> Amendment save
    is on record (a WO put in Amendment without the document layer): the caller then can't tell
    whether the vendor changed and must leave the WO alone."""
    vendor = vendor_now
    for data in frappe.get_all(
        "Version",
        filters={"ref_doctype": SR, "docname": work_order},
        order_by="creation desc, name desc",
        pluck="data",
        limit=_VERSION_LIMIT,
    ):
        changed = {row[0]: row for row in _changed(data)}
        if "vendor" in changed:
            vendor = changed["vendor"][1]
        status = changed.get("status")
        if status and status[1] == "Approved" and status[2] == "Amendment":
            return vendor
    return None


def _changed(data) -> list:
    try:
        rows = json.loads(data or "{}").get("changed") or []
    except (TypeError, ValueError, AttributeError):
        return []
    return [row for row in rows if isinstance(row, (list, tuple)) and len(row) >= 3]
