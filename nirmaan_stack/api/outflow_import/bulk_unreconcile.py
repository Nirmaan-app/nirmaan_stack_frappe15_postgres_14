# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Unreconcile several Settled lines at once (parent #1317, ADR-0022 Amendment F).

Thin orchestrator (ADR-0010 B4) over the one-line undo in `unreconcile.py`. It holds NO decision rule
of its own: every line is planned by `unreconcile.plan_of_line` -- the same function the one-line
dialog reads -- so a line can never read differently in the bulk check step.

Two whitelisted endpoints:

  * `get_bulk_unreconcile_plan(rows)` -- READ ONLY (#1319). Up to `BULK_UNRECONCILE_LIMIT` line names;
    per line, exactly what `get_unreconcile_plan` returns. Takes no lock, writes nothing. The check step
    reads it once instead of making N calls.
  * `bulk_unreconcile_rows(rows, reason)` -- the write (#1320). Each line in turn goes through
    `unreconcile.unreconcile_line` with legs = all, the one write path for a reversal. Synchronous, no
    background job (owner, after timing: 50 lines is about 5-15 s).

⚠️ EACH LINE STANDS ON ITS OWN. `unreconcile_line` commits each line before it returns, with only that
line's locks held, so the row -> legs -> targets lock order holds per line and a request killed part-way
(a worker timeout) leaves every finished line done and every other line Settled. A refusal or error on
one line is ROLLED BACK HERE -- `unreconcile_line` throws most refusals with that line's locks still
held -- recorded against the line, and the loop carries on.

⚠️ THE CHECK STEP IS NEVER TRUSTED. Every line is re-read under its own lock at write time: a line that
is no longer Settled is blocked, and a Settled line whose records changed is refused by the same verdicts
the one-line undo asks.

⚠️ UNDO ACCESS, NOT THE MODULE GATE -- the plan is only read to offer an undo, and a plain Accountant is
offered none (#1270 Q1).
"""

import json

import frappe

from nirmaan_stack.api.outflow_import.permissions import require_outflow_undo_access
from nirmaan_stack.api.outflow_import.unreconcile import (
    ALL_LEGS,
    REASON_REQUIRED,
    plan_of_line,
    unreconcile_line,
)
from nirmaan_stack.services.outflow_import.status import ROW_MISMATCHED, ROW_SETTLED

ROW_DOCTYPE = "Outflow Import Row"

__all__ = ["BULK_UNRECONCILE_LIMIT", "bulk_unreconcile_rows", "get_bulk_unreconcile_plan"]

#: A line that is no longer Settled when its turn comes. Partially Allocated lines keep their own undo in
#: the decision dialog, and an open line has nothing to undo.
NOT_SETTLED_REFUSAL = "This transfer is {status} now, not Settled, so it was left as it is."
NOT_FOUND_REFUSAL = "This transfer no longer exists; its import may have been deleted."
#: An error that is not a refusal. Its detail goes to the Error Log, never to the screen.
#: Mirrors the frontend's `ROW_STATUS_LABEL` (display only; the stored value is unchanged).
STATUS_LABELS = {ROW_MISMATCHED: "Not-Matched"}
UNEXPECTED_REFUSAL = "Something went wrong undoing this transfer, so nothing on it was changed."

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


@frappe.whitelist(methods=["POST"])
def bulk_unreconcile_rows(rows, reason: str) -> dict:
    """Undo each ticked Settled line whole, each in its own transaction (#1320).

    URL: /api/method/nirmaan_stack.api.outflow_import.bulk_unreconcile.bulk_unreconcile_rows

    `rows` is a JSON list (or a list) of `Outflow Import Row` names, at most `BULK_UNRECONCILE_LIMIT`;
    `reason` is required and stamped on every line and record, as the one-line undo does. Returns
    `{"count": N, "lines": [...]}`, one entry per distinct name in the order sent: either
    `{"row", "undone": True, ...the one-line response}` or `{"row", "undone": False, "reason"}`.

    ⚠️ A REFUSED LINE NEVER STOPS THE OTHERS, AND NEVER POPS A MESSAGE. Its sentence is returned in its
    entry; the message `frappe.throw` queued for the screen is dropped, or the screen would show the
    first blocked line's refusal as if the whole run had failed.
    """
    actor = require_outflow_undo_access()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw(REASON_REQUIRED, title="Missing reason")
    names = _line_names(rows)
    return {
        "count": len(names),
        "lines": [_undo_one(row, reason, actor, len(names)) for row in names],
    }


def _undo_one(row: str, reason: str, actor: str, count: int) -> dict:
    """One line, whole, or a blocked entry with its sentence. Leaves no lock held either way.

    ⚠️ `unreconcile_line` COMMITS BEFORE IT BUILDS ITS RESPONSE, so an error reading the response back
    arrives AFTER the line was undone. The rollback then undoes nothing, and reporting "nothing on it was
    changed" would be a lie. So every failure re-reads the line: one that was Settled and is not any more
    was undone, and is reported undone (with no record detail, which is what was lost).
    """
    messages = len(frappe.local.message_log)
    was_settled = False
    try:
        # Under the lock `unreconcile_line` takes again (same transaction, so a no-op), so the status read
        # here is the one the write sees.
        status = frappe.db.get_value(ROW_DOCTYPE, row, "row_status", for_update=True)
        if status is None:
            frappe.throw(NOT_FOUND_REFUSAL, title="Not found")
        if status != ROW_SETTLED:
            frappe.throw(NOT_SETTLED_REFUSAL.format(status=_status_label(status)), title="Not Settled")
        was_settled = True
        result = unreconcile_line(row=row, legs=ALL_LEGS, reason=reason, actor=actor, bulk_of=count)
    except frappe.ValidationError as exc:
        _drop_this_line(messages)
        return _undone_after_all(row, was_settled) or {"row": row, "undone": False, "reason": _sentence(exc)}
    except Exception:
        _drop_this_line(messages)
        frappe.log_error(title=f"Bulk unreconcile: {row}")
        frappe.db.commit()  # the Error Log row, alone: every earlier line has already committed
        return _undone_after_all(row, was_settled) or {
            "row": row,
            "undone": False,
            "reason": UNEXPECTED_REFUSAL,
        }
    return {**result, "row": row, "undone": True}


def _undone_after_all(row: str, was_settled: bool) -> dict | None:
    """A line whose undo committed before the failure: Settled when its turn came, not Settled now."""
    if not was_settled:
        return None
    status = frappe.db.get_value(ROW_DOCTYPE, row, "row_status")
    if status in (None, ROW_SETTLED):
        return None
    return {"row": row, "undone": True, "row_status": status, "reversed": []}


def _status_label(status: str) -> str:
    """The status as the screen names it (`outflowImportStatus.ROW_STATUS_LABEL`): `Mismatched` reads
    "Not-Matched" there, and this sentence is shown on the same screen."""
    return STATUS_LABELS.get(status, status)


def _drop_this_line(messages: int) -> None:
    """Roll back this line's writes and locks, and the messages it queued for the screen."""
    frappe.db.rollback()
    del frappe.local.message_log[messages:]


def _sentence(exc: Exception) -> str:
    """The refusal's own words -- the same sentence the one-line dialog would show."""
    return frappe.utils.strip_html(str(exc)).strip() or UNEXPECTED_REFUSAL
