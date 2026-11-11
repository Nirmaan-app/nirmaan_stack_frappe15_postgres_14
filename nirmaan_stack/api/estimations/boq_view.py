"""Reads behind the project page's Estimates tab (BOQ View, Line Item View, Estimate Items).

Scope rule (plan "BOQ Estimates"): these only READ the BOQ tables and never write them. Who may read: anyone who
can read BOQs, i.e. whoever the BoQ tab already shows them to (owner ruling: everyone with BoQ access views), and
only on the projects their User Permissions allow (`assert_project_access`).
Only Selected BOQs are shown (owner, 11 Nov, Q3), and only sheets committed as data.

The grid rows themselves come from the existing read `api.boq.wizard.pricing.get_priced_rows`, unchanged.
"""

import frappe
from frappe import _

from nirmaan_stack.integrations.controllers.boq_line_estimate import assert_project_access, project_of_boq
from nirmaan_stack.services.estimations import rules

SELECTED = "Selected"


# An estimate with its line item and that line's sheet. LEFT joins on purpose: a BOQ Nodes or BoQ Sheet row can be
# deleted while an estimate points at it (an estimate never blocks a BOQ delete: hooks.py `ignore_links_on_delete`).
# Such an estimate must still be read, as "line missing", or it would vanish from every view with no way to clear it.
# The sheet falls back to the one the estimate recorded when it was saved (`boq_sheet`).
_ESTIMATE_LINE_JOIN = """from "tabBOQ Line Estimate" e
           left join "tabBOQ Nodes" n on n.name = e.boq_node
           left join "tabBoQ Sheet" ps on ps.name = coalesce(n.sheet, e.boq_sheet)"""
_LINE_MISSING = "(n.name is null or ps.name is null)"


def _assert_can_read() -> None:
    if not frappe.has_permission("BOQs", "read"):
        frappe.throw(_("You do not have access to this project's BOQs."), frappe.PermissionError)


@frappe.whitelist()
def get_estimates_overview(project: str = None) -> dict:
    """The project's Selected BOQs, each with its committed data sheets and, per sheet, how many line items it
    has, how many carry an estimate, and how many estimates sit on an older version of the sheet.

    Returns {"boqs": [{name, boq_name, sheets: [{name, sheet_name, line_items, estimated, older}]}]}.
    """
    _assert_can_read()
    if not project:
        frappe.throw(_("project is required."))
    assert_project_access(project)
    boqs = frappe.get_all(
        "BOQs", filters={"project": project, "status": SELECTED}, fields=["name", "boq_name"], order_by="creation asc"
    )
    if not boqs:
        return {"boqs": []}
    boq_names = [b.name for b in boqs]

    sheets = frappe.db.sql(
        """select s.name, s.boq, s.sheet_name, s.sheet_order
           from "tabBoQ Sheet" s
           where s.boq in %(boqs)s and s.is_current = 1 and coalesce(s.treat_as, 'data') = 'data'
           order by s.boq, s.sheet_order, s.name""",
        {"boqs": tuple(boq_names)}, as_dict=True,
    )
    sheet_names = tuple(s.name for s in sheets) or ("",)
    line_items = dict(frappe.db.sql(
        """select n.sheet, count(*) from "tabBOQ Nodes" n
           where n.sheet in %(sheets)s and n.is_current = 1 and n.node_type = 'Line Item'
           group by n.sheet""", {"sheets": sheet_names}))
    estimated = dict(frappe.db.sql(
        """select n.sheet, count(*) from "tabBOQ Line Estimate" e
           join "tabBOQ Nodes" n on n.name = e.boq_node
           where n.sheet in %(sheets)s and n.is_current = 1 and coalesce(e.item_count, 0) > 0
           group by n.sheet""", {"sheets": sheet_names}))
    # Estimates whose line item a re-commit froze, counted against the sheet NAME (matched verbatim, never trimmed),
    # and those whose line item was deleted (`_ESTIMATE_LINE_JOIN`). One whose sheet is gone too has no sheet name:
    # it is listed on every sheet of its BOQ, so it is counted on each.
    older = {}
    for boq, sheet_name, count in frappe.db.sql(
        f"""select e.boq, ps.sheet_name, count(*) {_ESTIMATE_LINE_JOIN}
           where e.boq in %(boqs)s and ({_LINE_MISSING} or coalesce(n.is_current, 0) = 0)
           group by e.boq, ps.sheet_name""", {"boqs": tuple(boq_names)}):
        older[(boq, sheet_name)] = count

    by_boq = {b: [] for b in boq_names}
    for s in sheets:
        by_boq[s.boq].append({
            "name": s.name,
            "sheet_name": s.sheet_name,
            "line_items": line_items.get(s.name, 0),
            "estimated": estimated.get(s.name, 0),
            "older": older.get((s.boq, s.sheet_name), 0) + older.get((s.boq, None), 0),
        })
    return {"boqs": [{"name": b.name, "boq_name": b.boq_name or b.name, "sheets": by_boq[b.name]} for b in boqs]}


def _items_by_estimate(names: list) -> dict:
    out = {n: [] for n in names}
    if not names:
        return out
    for row in frappe.db.sql(
        """select parent, name, item_type, item_id, item_name, unit, quantity, category, procurement_package, make, comment
           from "tabBOQ Line Estimate Item"
           where parenttype = 'BOQ Line Estimate' and parent in %(names)s
           order by parent, idx""", {"names": tuple(names)}, as_dict=True):
        out[row.pop("parent")].append(row)
    return out


@frappe.whitelist()
def get_estimates(boq: str = None, sheet_name: str = None) -> dict:
    """Every estimate of a Selected BOQ (or of one sheet of it, named verbatim), with its items and its line item.

    Returns {"current": [...], "older": [...]}: `current` are on the sheets' current line items; `older` are left on
    an older version by a re-commit (shown in the older-version notice, re-attached by `reattach_estimates`), or on
    a line item that was deleted (state `line_missing`; with no sheet name when its sheet is gone too, and then
    listed on every sheet). Each entry: {name, modified, boq_node, item_count, line: {sheet_name, excel_row, sl_no,
    description, unit, qty, is_current}, items: [...]}; an older entry also has {version, state, target_node, copy}
    (`rules.older_states`).
    """
    _assert_can_read()
    if not boq:
        frappe.throw(_("boq is required."))
    assert_project_access(project_of_boq(boq))
    if frappe.db.get_value("BOQs", boq, "status") != SELECTED:
        return {"current": [], "older": []}
    conditions = "e.boq = %(boq)s"
    params = {"boq": boq}
    if sheet_name is not None:
        conditions += " and (ps.sheet_name = %(sheet_name)s or ps.name is null)"
        params["sheet_name"] = sheet_name
    rows = frappe.db.sql(
        f"""select e.name, e.modified, e.boq_node, coalesce(e.item_count, 0) as item_count,
                   ps.sheet_name, n.source_row_number as excel_row, n.code as sl_no, n.description, n.unit, n.qty,
                   coalesce(n.is_current, 0) as is_current, n.sort_order, ps.commit_version as version,
                   {_LINE_MISSING} as line_missing
            {_ESTIMATE_LINE_JOIN}
            where {conditions}
            order by ps.sheet_name, n.sort_order, n.source_row_number, e.name""",
        params, as_dict=True,
    )
    items = _items_by_estimate([r.name for r in rows])
    current, older = [], []
    for r in rows:
        is_current = bool(r.is_current) and not r.line_missing
        entry = {
            "name": r.name,
            "modified": str(r.modified),
            "boq_node": r.boq_node,
            "item_count": r.item_count,
            "line": {
                "sheet_name": r.sheet_name, "excel_row": r.excel_row, "sl_no": r.sl_no,
                "description": r.description, "unit": r.unit, "qty": r.qty, "is_current": is_current,
            },
            "items": items.get(r.name, []),
        }
        if r.line_missing:
            entry.update(version=r.version, state=rules.STATE_LINE_MISSING, target_node=None, copy=None)
        elif not is_current:
            entry["version"] = r.version
        (current if is_current else older).append(entry)
    on_versions = [e for e in older if "state" not in e]
    if on_versions:
        _set_older_states(boq, on_versions, current)
    return {"current": current, "older": older}


def _set_older_states(boq: str, older: list, current: list) -> None:
    """Adds `state`, `target_node` and `copy` to each older entry (see `rules.older_states`), per sheet name: Re-attach
    copies an older estimate onto its unchanged line of the current version and keeps the older one as a backup.
    `older` holds only estimates whose old line item still exists (a missing one is `line_missing` already)."""
    sheet_names = sorted({e["line"]["sheet_name"] for e in older})
    lines = frappe.db.sql(
        """select n.name as node, n.source_row_number as excel_row, n.description, s.sheet_name
           from "tabBOQ Nodes" n
           join "tabBoQ Sheet" s on s.name = n.sheet
           where s.boq = %(boq)s and s.sheet_name in %(sheets)s and s.is_current = 1
             and n.is_current = 1 and n.node_type = 'Line Item'""",
        {"boq": boq, "sheets": tuple(sheet_names)}, as_dict=True)
    on_line = {e["boq_node"]: {"estimate": e["name"], "items": e["items"]} for e in current}
    for sheet_name in sheet_names:
        sheet_older = [e for e in older if e["line"]["sheet_name"] == sheet_name]
        states = rules.older_states(
            [{"estimate": e["name"], "excel_row": e["line"]["excel_row"], "description": e["line"]["description"],
              "version": e.get("version"), "modified": e["modified"], "items": e["items"]} for e in sheet_older],
            [ln for ln in lines if ln.sheet_name == sheet_name],
            on_line,
        )
        for e in sheet_older:
            s = states[e["name"]]
            e["state"], e["target_node"], e["copy"] = s["state"], s["node"], s["copy"]
