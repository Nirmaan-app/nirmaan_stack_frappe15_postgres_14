"""Writes behind the Estimates tab: save one line's material estimate; after a re-commit, copy estimates to the
current version (automatically after the commit, or with Re-attach for leftovers; each older version keeps its own as
history), and settle an older one that still needs a person.

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


def _copy_matched(older: list) -> tuple[int, list]:
    """COPY each older estimate whose line is unchanged on the current version (state can_copy: same Excel row and
    text, the line holding no estimate; newest first) onto that line. Owner 2026-11-12: copied, not moved -- the BOQ
    keeps every version, so each version keeps its own estimates as history. The copy keeps the older one's saved
    name / unit / category (`doc.flags.reattach_copy`, review issue 5); the controller runs every rule on it.

    Each copy is saved on its own savepoint (review issue 4): one refused by a save rule (say 2.5 on a NOS item,
    saved before that rule existed) is rolled back and listed in `failed` with the reason; the others are still
    copied. Returns (copied, failed)."""
    copied, failed = 0, []
    for e in older:
        if e["state"] != rules.STATE_CAN_COPY:
            continue
        savepoint = f"copy_{frappe.generate_hash(length=8)}"
        frappe.db.savepoint(savepoint)
        try:
            doc = frappe.get_doc({"doctype": DOCTYPE, "boq_node": e["target_node"]})
            _set_items(doc, [{f: row.get(f) for f in ITEM_FIELDS} for row in e["items"]])
            doc.flags.reattach_copy = True
            doc.insert()
            _mark_settled([e["name"]])
            copied += 1
        except (frappe.ValidationError, frappe.PermissionError) as exc:
            # Back to the savepoint (on PostgreSQL a failed statement poisons the transaction until then), and drop
            # the thrown message so the reply, not a red error toast, reports it.
            frappe.db.rollback(save_point=savepoint)
            frappe.clear_last_message()
            failed.append({"estimate": e["name"], "excel_row": e["line"]["excel_row"],
                           "description": e["line"]["description"], "reason": str(exc)})
    return copied, failed


def _mark_settled(names: list) -> None:
    """Mark older estimates settled (option B, owner 12 Nov): copied forward, or resolved by a person. A raw
    `set_value` on purpose: these sit on a frozen line item, so a document save is refused by the controller (an
    estimate is saved only on a current line), and `settled` is a plain status flag -- no derived field, no hook,
    nothing else to recompute. `modified` is left alone: the estimate's materials did not change."""
    for name in names:
        frappe.db.set_value(DOCTYPE, name, "settled", 1, update_modified=False)


def copy_estimates_after_commit(boq: str, sheet_name: str) -> dict:
    """Background job, queued by the BoQ Sheet `after_insert` hook once a commit has gone through: copy the sheet's
    estimates onto the version just committed. The BOQ commit itself is unchanged and never waits on this. Runs as
    Administrator (a system copy); a BOQ that is not Selected is left alone (estimates are saved only on Selected
    BOQs) -- Re-attach copies them later. Lines that changed stay in the older-version notice.
    Returns {"copied", "failed"} (failures logged)."""
    frappe.set_user("Administrator")
    if frappe.db.get_value("BOQs", boq, "status") != rules.SELECTED_BOQ_STATUS:
        return {"copied": 0, "failed": []}
    copied, failed = _copy_matched(_older_of_sheet(boq, sheet_name))
    frappe.db.commit()
    if failed:
        frappe.log_error(title="BOQ estimates: some could not be copied to the new version",
                         message=frappe.as_json({"boq": boq, "sheet_name": sheet_name, "failed": failed}))
    return {"copied": copied, "failed": failed}


@frappe.whitelist(methods=["POST"])
def reattach_estimates(boq: str = None, sheet_name: str = None) -> dict:
    """The manual button for what the after-commit copy left behind (a BOQ that was not Selected then, a copy a rule
    refused, estimates from before the automatic copy): COPY each estimate still waiting on an older version of
    `sheet_name` (matched verbatim) onto its unchanged line of the current version. A line is unchanged when its Excel
    row and description text are; lines that changed, or were deleted, are listed, never guessed. Writes only BOQ
    Line Estimate rows.

    Returns {"copied": n, "unmatched": [{estimate, excel_row, description}],
    "failed": [{estimate, excel_row, description, reason}]}.
    """
    assert_can_edit()
    older = _older_of_sheet(boq, sheet_name)
    copied, failed = _copy_matched(older)
    frappe.db.commit()
    return {
        "copied": copied,
        "unmatched": [{"estimate": e["name"], "excel_row": e["line"]["excel_row"], "description": e["line"]["description"]}
                      for e in older if e["state"] in (rules.STATE_CHANGED, rules.STATE_LINE_MISSING)],
        "failed": failed,
    }


@frappe.whitelist(methods=["POST"])
def settle_older(boq: str = None, sheet_name: str = None, estimates=None) -> dict:
    """Resolve the chosen older estimates of `sheet_name` that still need a person (a line that changed or is gone, or
    one not copied yet): the notice's Remove, and "Add to a line…" after its save. Option B (owner 12 Nov): they are
    marked settled, not deleted -- each version keeps its own as history; settled ones are never listed again. Nothing
    is settled when none are chosen (an empty list, or "[]", review issue 1). Refused on a read-only project.

    Returns {"settled": n}.
    """
    assert_can_edit()
    names = set(_names(estimates))
    chosen = [e for e in _older_of_sheet(boq, sheet_name) if e["name"] in names]
    if chosen:
        from nirmaan_stack.integrations.controllers.boq_line_estimate import project_of_boq

        project = project_of_boq(boq)
        problem = rules.project_problem(frappe.db.get_value("Projects", project, "status") if project else None)
        if problem:
            frappe.throw(_(problem))
    _mark_settled([e["name"] for e in chosen])
    frappe.db.commit()
    return {"settled": len(chosen)}
