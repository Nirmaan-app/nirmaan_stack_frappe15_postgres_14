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

from nirmaan_stack.api.outflow_import.cashbook_matches import cashbook_line_of
from nirmaan_stack.api.outflow_import.porter_rectify import move_accepts, plan_rectify, rectify_rows
from nirmaan_stack.api.outflow_import.rectify_sources import SOURCES, source_of
from nirmaan_stack.api.outflow_import.rectify_transfer import INTERNAL_TRANSFER_DESTINATION, TransferTo
from nirmaan_stack.services.outflow_import.ledgers import is_expense_doctype
from nirmaan_stack.services.outflow_import.status import ROW_SETTLED


@frappe.whitelist()
def get_rectify_plan(rows) -> dict:
    """`plan_rectify` for the ticked lines' source, plus that `source`. WRITES NOTHING, TAKES NO LOCK.

    URL: /api/method/nirmaan_stack.api.outflow_import.rectify.get_rectify_plan?rows=[...]
    """
    source = source_of(rows)
    return {**plan_rectify(source, rows), "source": source.source}


@frappe.whitelist(methods=["POST"])
def rectify_lines(
    rows,
    project: str | None = None,
    reason: str = "",
    expense_type: str | None = None,
    destination: str | None = None,
    other_end: str | None = None,
    detail: str | None = None,
) -> dict:
    """`rectify_rows` for the ticked lines' source.

    URL: /api/method/nirmaan_stack.api.outflow_import.rectify.rectify_lines
    Body: `rows` (a JSON list of `Outflow Import Row` names), `project` (blank: Non Project), `reason`, and
    `expense_type` (blank: each expense keeps its own). `destination` "Internal Transfer" (#1762) moves each line to
    an Internal Transfer instead, from or to `other_end` with `detail`, as Mark as Internal Transfer asks; `project`
    and `expense_type` are then not read.
    """
    transfer = (
        TransferTo(other_end=(other_end or "").strip(), detail=(detail or "").strip())
        if (destination or "").strip() == INTERNAL_TRANSFER_DESTINATION
        else None
    )
    return rectify_rows(source_of(rows), rows, project, reason, expense_type, transfer)


def movable_rows(rows) -> set[str]:
    """The names of the page rows (`review.get_outflow_rows`) Move accepts: Settled lines of a wired source whose plan,
    ticked with the lines they move with, refuses nothing (`porter_rectify.move_accepts`). On such a line the screen
    hides Unreconcile (#1762, spec #1753 story 53); a refused or Linked line keeps it (story 54).

    ⚠️ A PAGE READ, NEVER A PROMISE: the write re-asks every rule under its locks.
    """
    movable = set()
    for row in rows:
        source = SOURCES.get((row.get("source") or "").strip())
        if source and row.get("row_status") == ROW_SETTLED and move_accepts(source, row["name"]):
            movable.add(row["name"])
    return movable


@frappe.whitelist()
def get_move_line(doctype: str, name: str) -> dict | None:
    """The import line a created Cashbook expense is Settled by, for its edit dialog's Move link:
    `{import_batch, import_row, transfer_id}` (`cashbook_matches.cashbook_line_of`), or `None`. Asks the expense's own
    read permission."""
    if not is_expense_doctype(doctype) or not frappe.db.exists(doctype, name):
        return None
    frappe.has_permission(doctype, "read", name, throw=True)
    return cashbook_line_of(doctype, name)
