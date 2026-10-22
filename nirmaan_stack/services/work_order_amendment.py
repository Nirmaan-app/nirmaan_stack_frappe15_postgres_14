# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What a Work Order looked like before its current amendment, and the record each amendment leaves.

    vendor_before_amendment(work_order, vendor_now) -> str | None
    pre_amendment_values(snapshot, current_rows) -> dict         (pure)
    pre_amendment_state(version_data, doc) -> dict               the whole state, stored in the snapshot
    revert_values(snapshot, current_rows) -> dict                what a revert writes back
    pending_snapshot(work_order) -> dict | None
    mark_snapshots(work_order, outcome)

The amendment snapshot (#1540) is the Nirmaan Versions row `controllers/nirmaan_versions` copies from
the Version of the save that moved the WO from Approved to Amendment. It is kept after the decision and
marked with its `outcome`, Accepted or Reverted (`mark_snapshots`, from `ServiceRequests.on_update`), so
an undecided snapshot is one with no outcome. A revert (`api/service_requests/amendment.revert_amendment`)
writes back what that save changed: items, vendor, categories and Nirmaan GST (`pre_amendment_values`).

The amend sheet changes the vendor and moves the WO to Amendment in one save, so by the time the
amendment is accepted the WO no longer holds the vendor it had. Service Requests has `track_changes`,
so every save through the document layer (SPA, Desk, REST) leaves a Version row of `[field, old, new]`
changes. This walks them newest first, undoing each vendor change, back to the save that moved the WO
from Approved to Amendment. Reads only; no request context.
"""

import json

import frappe

SR = "Service Requests"
SNAPSHOTS = "Nirmaan Versions"

#: A decided amendment snapshot's `outcome` (`Nirmaan Versions.outcome`).
ACCEPTED = "Accepted"
REVERTED = "Reverted"
OUTCOMES = (ACCEPTED, REVERTED)

#: What a revert writes back from the snapshot besides the items: the other fields the amend sheet changes.
RESTORED_FIELDS = ("vendor", "service_category_list", "project_gst")
ITEMS = "work_order_items"

#: A child row's bookkeeping, which a restored row gets afresh.
_ROW_BOOKKEEPING = frozenset(
    ("name", "owner", "creation", "modified", "modified_by", "docstatus", "idx",
     "parent", "parentfield", "parenttype", "doctype")
)

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


_UNDECIDED = {"ref_doctype": SR, "new_state": "Amendment", "outcome": ("is", "not set")}


def pending_snapshot(work_order: str) -> dict | None:
    """The newest undecided amendment snapshot of `work_order` as {name, data}, or None."""
    rows = frappe.get_all(
        SNAPSHOTS,
        filters={**_UNDECIDED, "docname": work_order},
        fields=["name", "data"],
        order_by="creation desc, name desc",
        limit=1,
    )
    if not rows:
        return None
    return {"name": rows[0].name, "data": snapshot_data(rows[0].data)}


def mark_snapshots(work_order: str, outcome: str) -> None:
    """Mark every undecided amendment snapshot of `work_order` with `outcome`. Nirmaan Versions has no
    doc events, so `set_value` skips none."""
    for name in frappe.get_all(SNAPSHOTS, filters={**_UNDECIDED, "docname": work_order}, pluck="name"):
        frappe.db.set_value(SNAPSHOTS, name, "outcome", outcome)


def snapshot_data(data) -> dict:
    """A snapshot's Version data as a dict. `generate_sr_amend_version` stores the Version's JSON text
    encoded once more, so it arrives as text inside text."""
    while isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError:
            return {}
    return data if isinstance(data, dict) else {}


def pre_amendment_values(snapshot: dict, current_rows: list) -> dict:
    """What a revert writes back: the amend save's old values of `RESTORED_FIELDS`, and the items as they
    were when it touched them. `current_rows`: the WO's item rows now, as dicts.

    The items before = the rows now, less those the amend added, with its in-place edits undone, plus
    those it removed. The amend sheet replaces every row, so for it that is exactly the removed rows."""
    values = {row[0]: row[1] for row in _rows(snapshot, "changed", 3) if row[0] in RESTORED_FIELDS}
    added = [row[1] for row in _rows(snapshot, "added", 2) if row[0] == ITEMS]
    removed = [row[1] for row in _rows(snapshot, "removed", 2) if row[0] == ITEMS]
    edits = {row[2]: row[3] for row in _rows(snapshot, "row_changed", 4) if row[0] == ITEMS}
    if not (added or removed or edits):
        return values
    added_names = {row.get("name") for row in added}
    kept = [
        {**row, **{change[0]: change[1] for change in edits.get(row.get("name")) or []}}
        for row in current_rows
        if row.get("name") not in added_names
    ]
    rows = sorted(kept + removed, key=lambda row: row.get("idx") or 0)
    values[ITEMS] = [{k: v for k, v in row.items() if k not in _ROW_BOOKKEEPING} for row in rows]
    return values


#: The snapshot's key holding the whole pre-amendment state (`pre_amendment_state`), written when it is made.
PRE_AMENDMENT_KEY = "pre_amendment"


def pre_amendment_state(version_data: dict, doc) -> dict:
    """The Work Order's whole state before the amendment, for the snapshot: `RESTORED_FIELDS` and the items.
    `doc` is the Work Order as the amend save left it, `version_data` that save's Version data; a field the
    save did not change still holds its value from before. Stored whole so a revert also undoes what was
    changed WHILE the amendment waited (a Nirmaan GST set on WO Options, walk W2), not only the amend save."""
    rows = [row.as_dict() if hasattr(row, "as_dict") else dict(row) for row in doc.get(ITEMS) or []]
    changed = pre_amendment_values(version_data, rows)
    state = {field: changed[field] if field in changed else doc.get(field) for field in RESTORED_FIELDS}
    state[ITEMS] = changed.get(ITEMS) or [
        {k: v for k, v in row.items() if k not in _ROW_BOOKKEEPING} for row in rows
    ]
    return state


def revert_values(snapshot: dict, current_rows: list) -> dict:
    """What a revert writes back: the snapshot's whole pre-amendment state, or, for a snapshot made before
    it carried one, the amend save's own changes undone (`pre_amendment_values`)."""
    state = snapshot.get(PRE_AMENDMENT_KEY)
    if isinstance(state, dict) and state:
        return state
    return pre_amendment_values(snapshot, current_rows)


def _rows(snapshot: dict, key: str, width: int) -> list:
    return [row for row in snapshot.get(key) or [] if isinstance(row, (list, tuple)) and len(row) >= width]


def _changed(data) -> list:
    try:
        rows = json.loads(data or "{}").get("changed") or []
    except (TypeError, ValueError, AttributeError):
        return []
    return [row for row in rows if isinstance(row, (list, tuple)) and len(row) >= 3]
