# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Unreconcile several Settled lines at once (parent #1317, ADR-0022 Amendment E).

Thin orchestrator (ADR-0010 B4) over the one-line undo in `unreconcile.py`. It holds NO decision rule
of its own: every line is planned by `unreconcile.plan_of_line` -- the same function the one-line
dialog reads -- so a line can never read differently in the bulk check step.

#1319 ships the read only:

  * `get_bulk_unreconcile_plan(rows)` -- READ ONLY. Up to `BULK_UNRECONCILE_LIMIT` line names; per line,
    exactly what `get_unreconcile_plan` returns. Takes no lock, writes nothing. The check step reads it
    once instead of making N calls.

⚠️ UNDO ACCESS, NOT THE MODULE GATE -- the plan is only read to offer an undo, and a plain Accountant is
offered none (#1270 Q1).
"""

import json

import frappe

from nirmaan_stack.api.outflow_import.permissions import require_outflow_undo_access
from nirmaan_stack.api.outflow_import.unreconcile import plan_of_line

ROW_DOCTYPE = "Outflow Import Row"

__all__ = ["BULK_UNRECONCILE_LIMIT", "get_bulk_unreconcile_plan"]

# The screen's page size too (`DEFAULT_PAGE_SIZE`), since a run works on one page at a time -- but the
# server keeps its own cap regardless of what the screen sends.
BULK_UNRECONCILE_LIMIT = 50


@frappe.whitelist()
def get_bulk_unreconcile_plan(rows) -> dict:
    """What an Unreconcile of each line would do. WRITES NOTHING, TAKES NO LOCK (#1319).

    URL: /api/method/nirmaan_stack.api.outflow_import.bulk_unreconcile.get_bulk_unreconcile_plan

    `rows` is a JSON list (or a list) of `Outflow Import Row` names. Returns `{"lines": [...]}`, one
    entry per distinct name in the order sent, each equal to `get_unreconcile_plan(row)` -- except a
    line that no longer exists, which reads `not_found: True` with no legs instead of failing the lot.

    ⚠️ A PLAN, NEVER A PROMISE. The write re-reads every line under its own locks.
    """
    require_outflow_undo_access()
    names = _line_names(rows)
    existing = set(frappe.get_all(ROW_DOCTYPE, filters={"name": ["in", names]}, pluck="name"))
    return {"lines": [plan_of_line(row) if row in existing else _gone(row) for row in names]}


def _gone(row: str) -> dict:
    """A line that no longer exists (its import was deleted after it was ticked). It is reported on its own
    rather than failing the whole check step -- every other line's plan is still worth reading."""
    return {
        "row": row,
        "row_status": None,
        "not_found": True,
        "amount": 0.0,
        "allocated": 0.0,
        "refused_count": 0,
        "reverse_all_only": False,
        "legs": [],
    }


def _line_names(rows) -> list[str]:
    """The distinct line names, in the order sent. Refuses nothing sent, and more than the cap."""
    if isinstance(rows, str):
        try:
            rows = json.loads(rows)
        except ValueError:
            rows = None
    if not isinstance(rows, list) or not all(isinstance(r, str) and r.strip() for r in rows):
        rows = []
    names = list(dict.fromkeys(r.strip() for r in rows))
    if not names:
        frappe.throw("Tick at least one transfer to unreconcile.", title="Nothing ticked")
    if len(names) > BULK_UNRECONCILE_LIMIT:
        frappe.throw(
            f"At most {BULK_UNRECONCILE_LIMIT} transfers can be unreconciled at once; "
            f"{len(names)} were sent.",
            title="Too many transfers",
        )
    return names
