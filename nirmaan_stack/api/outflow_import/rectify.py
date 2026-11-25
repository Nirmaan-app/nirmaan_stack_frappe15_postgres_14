# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Move (Rectify) for any wired import source, chosen by the lines' own source (#1757, spec #1753).

The screen calls it Move; the code and the domain keep Rectify (GLOSSARY *Rectify*). The core is
`porter_rectify.plan_rectify` / `rectify_rows`; a source (`rectify_sources`) says what differs. These endpoints take
the source from the first ticked line, so the Move dialog opened from an expense's link needs no source of its own;
a ticked line of another source is refused in that source's words. Porter's own endpoints
(`porter_rectify.get_porter_rectify_plan`, `rectify_porter_rows`) stay as they were.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.api.outflow_import.expenses import MATCH_DOCTYPE
from nirmaan_stack.api.outflow_import.porter_rectify import plan_rectify, rectify_rows
from nirmaan_stack.api.outflow_import.porter_records import ROW_DOCTYPE, line_names
from nirmaan_stack.api.outflow_import.rectify_sources import CASHBOOK, PORTER, RectifySource
from nirmaan_stack.services.outflow_import.allocation import MATCH_SETTLED

#: Every source Move is wired for, by its lines' `source`.
SOURCES = {source.source: source for source in (PORTER, CASHBOOK)}


@frappe.whitelist()
def get_rectify_plan(rows) -> dict:
    """`plan_rectify` for the ticked lines' source, plus that `source`. WRITES NOTHING, TAKES NO LOCK.

    URL: /api/method/nirmaan_stack.api.outflow_import.rectify.get_rectify_plan?rows=[...]
    """
    source = _source_of(rows)
    return {**plan_rectify(source, rows), "source": source.source}


@frappe.whitelist(methods=["POST"])
def rectify_lines(rows, project: str | None = None, reason: str = "", expense_type: str | None = None) -> dict:
    """`rectify_rows` for the ticked lines' source.

    URL: /api/method/nirmaan_stack.api.outflow_import.rectify.rectify_lines
    Body: `rows` (a JSON list of `Outflow Import Row` names), `project` (blank: Non Project), `reason`, and
    `expense_type` (blank: each expense keeps its own).
    """
    return rectify_rows(_source_of(rows), rows, project, reason, expense_type)


@frappe.whitelist()
def get_move_line(doctype: str, name: str) -> dict | None:
    """The import line a created Cashbook expense is Settled by, for its edit dialog's Move link:
    `{import_batch, import_row, transfer_id}`, or `None`. Asks the expense's own read permission."""
    if doctype not in ("Project Expenses", "Non Project Expenses") or not frappe.db.exists(doctype, name):
        return None
    frappe.has_permission(doctype, "read", name, throw=True)
    match = frappe.db.get_value(
        MATCH_DOCTYPE,
        {"target_doctype": doctype, "target_name": name, "match_kind": MATCH_SETTLED, "source": CASHBOOK.source,
         "created_by_import": 1},
        ["import_batch", "import_row", "transfer_id"],
        as_dict=True,
    )
    return dict(match) if match else None


def _source_of(rows) -> RectifySource:
    """The first ticked line's source; Porter when it has none wired (its lines are then refused in Porter's
    words, as `porter_rectify` always refused them)."""
    names = line_names(rows)
    first = frappe.db.get_value(ROW_DOCTYPE, names[0], "source") if names else None
    return SOURCES.get((first or "").strip(), PORTER)
