"""Writes behind the Estimates tab: save one line's material estimate; after a re-commit, re-attach (copy) estimates
to the current version, undo that, or remove the older ones.

Thin orchestrators (ADR-0010 B4): load, change, save through the document layer, commit. Every rule (who may
edit, which line, which rows are valid) runs in the BOQ Line Estimate controller
(`integrations/controllers/boq_line_estimate.py`) on that save, never here. Nothing here writes a BOQ table.
"""

import frappe
from frappe import _

from nirmaan_stack.integrations.controllers.boq_line_estimate import assert_can_edit
from nirmaan_stack.services.estimations import rules

DOCTYPE = "BOQ Line Estimate"
ITEM_FIELDS = ("item_type", "item_id", "item_name", "unit", "quantity", "category", "make", "comment")


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
    assert_can_edit()
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


def _names(estimates) -> list:
    """The estimate names a request chose: `estimates` as a list or a JSON list. Empty when none were chosen --
    including the "[]" the screens send for "all", which as a string is truthy (review issue 1)."""
    names = frappe.parse_json(estimates) if isinstance(estimates, str) and estimates.strip() else estimates
    return list(names or [])


def _chosen(older: list, estimates) -> list:
    """`older` narrowed to the names in `estimates`; all of them when none were chosen."""
    names = set(_names(estimates))
    return [e for e in older if e["name"] in names] if names else older


@frappe.whitelist(methods=["POST"])
def reattach_estimates(boq: str = None, sheet_name: str = None) -> dict:
    """Decision M, as the owner revised it on 11 Nov: COPY each estimate a re-commit left on an older version of
    `sheet_name` (matched verbatim) onto its unchanged line of the current version, keeping the older one as a backup
    (Undo removes the copy; Remove old removes the backup). A line is unchanged when its Excel row and description
    text are; lines that changed, or were deleted, are listed, never guessed. Writes only BOQ Line Estimate rows.

    Each copy is saved on its own (review issue 4): one that fails a save rule (say 2.5 on a NOS item, saved before
    that rule existed) is rolled back to its savepoint and listed in `failed` with the reason; the others are still
    copied. The failed one stays "can be copied", so it can be fixed and re-attached, added to a line or removed.

    Returns {"copied": n, "unmatched": [{estimate, excel_row, description}],
    "failed": [{estimate, excel_row, description, reason}]}.
    """
    assert_can_edit()
    older = _older_of_sheet(boq, sheet_name)
    copied, failed = 0, []
    for e in older:
        if e["state"] != rules.STATE_CAN_COPY:
            continue
        savepoint = f"reattach_{frappe.generate_hash(length=8)}"
        frappe.db.savepoint(savepoint)
        try:
            doc = frappe.get_doc({"doctype": DOCTYPE, "boq_node": e["target_node"]})
            _set_items(doc, [{f: row.get(f) for f in ITEM_FIELDS} for row in e["items"]])
            doc.insert()
            copied += 1
        except (frappe.ValidationError, frappe.PermissionError) as exc:
            # Back to the savepoint (on PostgreSQL a failed statement poisons the transaction until then), and drop
            # the thrown message so the reply, not a red error toast, reports it.
            frappe.db.rollback(save_point=savepoint)
            frappe.clear_last_message()
            failed.append({"estimate": e["name"], "excel_row": e["line"]["excel_row"],
                           "description": e["line"]["description"], "reason": str(exc)})
    frappe.db.commit()
    return {
        "copied": copied,
        "unmatched": [{"estimate": e["name"], "excel_row": e["line"]["excel_row"], "description": e["line"]["description"]}
                      for e in older if e["state"] in (rules.STATE_CHANGED, rules.STATE_LINE_MISSING)],
        "failed": failed,
    }


@frappe.whitelist(methods=["POST"])
def undo_reattach(boq: str = None, sheet_name: str = None, estimates=None) -> dict:
    """Undo a Re-attach: delete the copy on the current version of each chosen older estimate (all of the sheet's
    when `estimates` is empty) whose copy still holds exactly its materials. The older estimate stays, ready to be
    re-attached again. A line that now holds other materials (a copy edited since, or typed by hand) is never
    deleted; it is listed in `skipped`.

    Returns {"undone": n, "skipped": [older estimate names]}.
    """
    assert_can_edit()
    chosen = _chosen(_older_of_sheet(boq, sheet_name), estimates)
    undone, skipped = 0, []
    for e in chosen:
        if e["state"] == rules.STATE_COPIED:
            frappe.get_doc(DOCTYPE, e["copy"], for_update=True).delete()
            undone += 1
        elif e["state"] == rules.STATE_LINE_HAS_OTHER:
            skipped.append(e["name"])
    frappe.db.commit()
    return {"undone": undone, "skipped": skipped}


@frappe.whitelist(methods=["POST"])
def remove_older(boq: str = None, sheet_name: str = None, estimates=None) -> dict:
    """Delete older estimates of `sheet_name`: the chosen ones (any state), or, when none are chosen ("Remove all
    old", which sends "[]"), only the backups -- older estimates whose materials are exactly on their line of the
    current version, so deleting them loses nothing. Every other older estimate still needs a person.
    Copies on the current version are never touched.

    Returns {"removed": n}.
    """
    assert_can_edit()
    older = _older_of_sheet(boq, sheet_name)
    chosen = _chosen(older, estimates) if _names(estimates) else [
        e for e in older if e["state"] == rules.STATE_COPIED]
    for e in chosen:
        frappe.get_doc(DOCTYPE, e["name"], for_update=True).delete()
    frappe.db.commit()
    return {"removed": len(chosen)}
