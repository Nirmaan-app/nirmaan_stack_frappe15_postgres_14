"""Writes behind the Estimates tab: save one line's material estimate; after a re-commit, re-attach (copy) estimates
to the current version, undo that, or remove the older ones.

Thin orchestrators (ADR-0010 B4): load, change, save through the document layer, commit. Every rule (who may
edit, which line, which rows are valid) runs in the BOQ Line Estimate controller
(`integrations/controllers/boq_line_estimate.py`) on that save, never here. Nothing here writes a BOQ table.
"""

import frappe
from frappe import _

from nirmaan_stack.services.estimations import rules
from nirmaan_stack.services.role_profiles import ESTIMATE_EDIT_PROFILES, has_role_profile

DOCTYPE = "BOQ Line Estimate"
ITEM_FIELDS = ("item_type", "item_id", "item_name", "unit", "quantity", "category", "make", "comment")


def _assert_can_edit() -> None:
    if not has_role_profile(frappe.session.user, ESTIMATE_EDIT_PROFILES):
        frappe.throw(_("Only Admin, PMO and Estimates Executive can add, change or delete estimates."),
                     frappe.PermissionError)


def _set_items(doc, items: list) -> None:
    """Make `doc.items` exactly `items`. A row that comes back with its `name` updates that row in place, so the
    controller keeps the name and unit copied when it was added (it restores them from the saved row, and refreshes
    them from Items only for a new or re-pointed row)."""
    existing = {row.name: row for row in doc.items}
    kept = []
    for incoming in items:
        values = {f: incoming.get(f) for f in ITEM_FIELDS}
        row = existing.get(incoming.get("name"))
        if row:
            row.update(values)
        else:
            row = doc.append("items", values)
        kept.append(row)
    doc.set("items", kept)
    for position, row in enumerate(doc.items, start=1):
        row.idx = position


@frappe.whitelist(methods=["POST"])
def save_estimate(boq_node: str = None, items=None, expected_modified: str = None) -> dict:
    """Create, replace or delete the estimate of one BOQ line item.

    `items` is the full list of rows the line should have; an empty list deletes the estimate. `expected_modified`
    is the `modified` the browser loaded (empty for a line it saw without an estimate): if someone saved in
    between, nothing is written and the user is told to reload (latest-wins is refused, R4).
    Returns {"name", "modified", "item_count"} or {"deleted": True}.
    """
    _assert_can_edit()
    if not boq_node:
        frappe.throw(_("boq_node is required."))
    items = frappe.parse_json(items) if isinstance(items, str) else (items or [])
    name = frappe.db.get_value(DOCTYPE, {"boq_node": boq_node}, "name")

    if name:
        doc = frappe.get_doc(DOCTYPE, name, for_update=True)
        if (expected_modified or "") != str(doc.modified):
            frappe.throw(_("Someone else changed this estimate while you had it open. Reload the page and try again."))
        if not items:
            doc.delete()
            frappe.db.commit()
            return {"deleted": True}
        _set_items(doc, items)
        doc.save()
    else:
        if expected_modified:
            frappe.throw(_("This estimate was deleted while you had it open. Reload the page and try again."))
        if not items:
            return {"deleted": True}
        doc = frappe.get_doc({"doctype": DOCTYPE, "boq_node": boq_node})
        _set_items(doc, items)
        doc.insert()
    frappe.db.commit()
    return {"name": doc.name, "modified": str(doc.modified), "item_count": doc.item_count}


def _older_of_sheet(boq, sheet_name) -> list:
    """The sheet's older estimates with their state (`boq_view.get_estimates`, which also checks read access)."""
    if not boq or sheet_name is None:
        frappe.throw(_("boq and sheet_name are required."))
    from nirmaan_stack.api.estimations.boq_view import get_estimates

    return get_estimates(boq=boq, sheet_name=sheet_name)["older"]


def _chosen(older: list, estimates) -> list:
    """`older` narrowed to the names in `estimates` (a list or JSON list); all of them when `estimates` is empty."""
    names = frappe.parse_json(estimates) if isinstance(estimates, str) else (estimates or [])
    return [e for e in older if e["name"] in set(names)] if names else older


@frappe.whitelist(methods=["POST"])
def reattach_estimates(boq: str = None, sheet_name: str = None) -> dict:
    """Decision M, as the owner revised it on 11 Nov: COPY each estimate a re-commit left on an older version of
    `sheet_name` (matched verbatim) onto its unchanged line of the current version, keeping the older one as a backup
    (Undo removes the copy; Remove old removes the backup). A line is unchanged when its Excel row and description
    text are; lines that changed, or were deleted, are listed, never guessed. Writes only BOQ Line Estimate rows.

    Returns {"copied": n, "unmatched": [{estimate, excel_row, description}]}.
    """
    _assert_can_edit()
    older = _older_of_sheet(boq, sheet_name)
    copied = 0
    for e in older:
        if e["state"] != rules.STATE_CAN_COPY:
            continue
        doc = frappe.get_doc({"doctype": DOCTYPE, "boq_node": e["target_node"]})
        _set_items(doc, [{f: row.get(f) for f in ITEM_FIELDS} for row in e["items"]])
        doc.insert()
        copied += 1
    frappe.db.commit()
    return {
        "copied": copied,
        "unmatched": [{"estimate": e["name"], "excel_row": e["line"]["excel_row"], "description": e["line"]["description"]}
                      for e in older if e["state"] in (rules.STATE_CHANGED, rules.STATE_LINE_MISSING)],
    }


@frappe.whitelist(methods=["POST"])
def undo_reattach(boq: str = None, sheet_name: str = None, estimates=None) -> dict:
    """Undo a Re-attach: delete the copy on the current version of each chosen older estimate (all of the sheet's
    when `estimates` is empty) whose copy still holds exactly its materials. The older estimate stays, ready to be
    re-attached again. A copy that was edited is not deleted (the edits would be lost); it is listed in `skipped`.

    Returns {"undone": n, "skipped": [older estimate names]}.
    """
    _assert_can_edit()
    chosen = _chosen(_older_of_sheet(boq, sheet_name), estimates)
    undone, skipped = 0, []
    for e in chosen:
        if e["state"] == rules.STATE_COPIED:
            frappe.get_doc(DOCTYPE, e["copy"], for_update=True).delete()
            undone += 1
        elif e["state"] == rules.STATE_COPIED_EDITED:
            skipped.append(e["name"])
    frappe.db.commit()
    return {"undone": undone, "skipped": skipped}


@frappe.whitelist(methods=["POST"])
def remove_older(boq: str = None, sheet_name: str = None, estimates=None) -> dict:
    """Delete older estimates of `sheet_name`: the chosen ones (any state), or, when `estimates` is empty, every
    older one that was copied to the current version ("Remove all old"; lines that changed still need a person).
    Copies on the current version are never touched.

    Returns {"removed": n}.
    """
    _assert_can_edit()
    older = _older_of_sheet(boq, sheet_name)
    chosen = _chosen(older, estimates) if estimates else [
        e for e in older if e["state"] in (rules.STATE_COPIED, rules.STATE_COPIED_EDITED)]
    for e in chosen:
        frappe.get_doc(DOCTYPE, e["name"], for_update=True).delete()
    frappe.db.commit()
    return {"removed": len(chosen)}
