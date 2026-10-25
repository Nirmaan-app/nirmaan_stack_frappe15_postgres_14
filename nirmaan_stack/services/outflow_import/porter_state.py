# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Porter import's states (ADR-0032, spec #1442): each Porter Invoice's, and the import's own.

PURE MODULE -- no `frappe`, no database. Split out of `porter.py` (the statement's rules): the invoice
statuses the validation job (`api/outflow_import/porter_validation.py`) writes, `import_state` -- the
import's Validating / Validated / Validation failed / Creating / Created, DERIVED from its invoices and
lines, never stored -- and `CREATE_LINE_STATUSES`, the lines Create still writes (and Review may still
re-place).

Each Porter Invoice moves Queued -> Downloading -> Reading -> Comparing -> Passed / Failed / Error,
committed at every step so the dialog can show it. Comparing is `porter_verdict.judge_invoice`.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping

from nirmaan_stack.services.outflow_import.porter import REASON_REVIEW, STRENGTH_STRONG
from nirmaan_stack.services.outflow_import.status import (
    ROW_ERROR,
    ROW_MISMATCHED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
)

__all__ = [
    "CHECK_SECONDS_PER_INVOICE",
    "CREATE_LINE_STATUSES",
    "IMPORT_CREATED",
    "IMPORT_CREATING",
    "IMPORT_VALIDATED",
    "IMPORT_VALIDATING",
    "IMPORT_VALIDATION_FAILED",
    "INVOICE_COMPARING",
    "INVOICE_DOWNLOADING",
    "INVOICE_ERROR",
    "INVOICE_FAILED",
    "INVOICE_IN_FLIGHT",
    "INVOICE_PASSED",
    "INVOICE_QUEUED",
    "INVOICE_READING",
    "NEEDS_PERSON",
    "PLACED_AUTOMATICALLY",
    "PLACED_BY_PERSON",
    "import_progress",
    "import_state",
    "placement_kind",
    "placement_kinds",
]

#: `Porter Invoice.validation_status`, in the order an invoice moves through them.
INVOICE_QUEUED = "Queued"
INVOICE_DOWNLOADING = "Downloading"
INVOICE_READING = "Reading"
INVOICE_COMPARING = "Comparing"
INVOICE_PASSED = "Passed"
#: The PDF disagrees with the statement. FINAL: no retry and no override, for anyone (ADR-0032).
INVOICE_FAILED = "Failed"
#: The download or the read went wrong, so nothing was decided. Retryable, for that invoice alone.
INVOICE_ERROR = "Error"

#: The invoice is still being worked on: the import is not decided yet.
INVOICE_IN_FLIGHT = frozenset({INVOICE_QUEUED, INVOICE_DOWNLOADING, INVOICE_READING, INVOICE_COMPARING})

#: The import's own state, DERIVED from its invoices (`import_state`), never stored.
IMPORT_VALIDATING = "Validating"
IMPORT_VALIDATED = "Validated"
IMPORT_VALIDATION_FAILED = "Validation failed"
#: Create has started and not every completed line is created yet (#1445): running, stopped with a line
#: in Error, or a line reopened by Unreconcile. A re-run of Create finishes it.
IMPORT_CREATING = "Creating"
#: Every completed line has its Expense.
IMPORT_CREATED = "Created"

#: The line statuses Create writes an Expense for: never touched (Pending match run), failed on an earlier
#: run (Error), or reopened by Unreconcile after it was created (Mismatched, #1449). A Porter line never
#: runs the matcher, so Mismatched means only that. Settled and Skipped lines are never written.
CREATE_LINE_STATUSES = (ROW_PENDING_MATCH, ROW_ERROR, ROW_MISMATCHED)


def import_state(invoice_statuses: Iterable[str], line_statuses: Iterable[str] = ()) -> str:
    """The import's state, from its Porter Invoices' statuses and (once validated) its lines'.

    Validation, from the invoices: Validating while any invoice is still in hand; Validated only when
    there are invoices and every one Passed; otherwise Validation failed (a Failed invoice is final, an
    Error one waits for its Retry). Nothing about the lines can outrank this.

    Create (#1445), from the lines of a validated import, a cancelled (Skipped) line aside:
      * Validated -- no line has been touched by Create yet;
      * Created   -- there are completed lines and every one is Settled;
      * Creating  -- anything between: Create is running, or stopped with a line in Error, or a line was
        unreconciled after Create (#1449). Each of these is what a re-run of Create finishes.

    Called with the invoices alone it answers the validation question only: `porter_records.is_validated`.
    """
    statuses = list(invoice_statuses)
    if any(status in INVOICE_IN_FLIGHT for status in statuses):
        return IMPORT_VALIDATING
    if not statuses or not all(status == INVOICE_PASSED for status in statuses):
        return IMPORT_VALIDATION_FAILED
    completed = [status for status in line_statuses if status != ROW_SKIPPED]
    if completed and all(status == ROW_SETTLED for status in completed):
        return IMPORT_CREATED
    if any(status != ROW_PENDING_MATCH for status in completed):
        return IMPORT_CREATING
    return IMPORT_VALIDATED


# --- the per-phase progress summary (#1556) --------------------------------------------------------

#: How long one Porter Invoice's check takes, for the time-left estimate only. Gemini takes 30 s to
#: minutes per invoice (#1444); a minute each keeps the estimate on the safe side.
CHECK_SECONDS_PER_INVOICE = 60

#: Where a completed order stands in the Choose-projects phase (`placement_kinds`).
PLACED_AUTOMATICALLY = "placed_automatically"
PLACED_BY_PERSON = "placed_by_person"
NEEDS_PERSON = "needs_person"


def placement_kind(reason: str | None, strength: str | None) -> str:
    """Where ONE order stands on its own: placed by a person (Review wrote `review`; "Not a project"
    included), placed automatically (a Strong placement, a Strong Non-Project from history included), or
    needing a person (a Check placement, or none at all). Its remark group can still put a Strong order
    before a person: `placement_kinds` is the rule every caller asks."""
    if reason == REASON_REVIEW:
        return PLACED_BY_PERSON
    if strength == STRENGTH_STRONG:
        return PLACED_AUTOMATICALLY
    return NEEDS_PERSON


def placement_kinds(lines: Iterable[Mapping]) -> dict[str, str]:
    """THE needs-a-person rule (#1560, spec #1554): each completed order's `placement_kind`, by name.

    Choose projects lists the orders that need a person, Create is refused while any is left, and the
    progress bar counts them -- all from this. Each line is a mapping of `name`, `group_key` (blank: no
    remark, a group of its own), `reason`, `strength`, `destination` (the project, or None for
    Non-Project) and `open` (Create would still write it: `CREATE_LINE_STATUSES`).

    An open order needs a person when no person chose it and either it is not Strong on its own, or
    its remark group is in doubt: any open order of the group is Check or unplaced, or the group's open
    orders are placed differently. An order already created is decided: it never needs a person, and
    it puts no doubt on its group.
    """
    lines = list(lines)
    alone = {line["name"]: placement_kind(line.get("reason"), line.get("strength")) for line in lines}
    groups: dict[str, list[Mapping]] = {}
    for line in lines:
        if line.get("open") and line.get("group_key"):
            groups.setdefault(line["group_key"], []).append(line)
    in_doubt = {
        key
        for key, members in groups.items()
        if any(alone[m["name"]] == NEEDS_PERSON for m in members)
        or len({m.get("destination") or None for m in members}) > 1
    }

    def kind(line: Mapping) -> str:
        own = alone[line["name"]]
        if not line.get("open"):
            return PLACED_BY_PERSON if own == PLACED_BY_PERSON else PLACED_AUTOMATICALLY
        if own == PLACED_AUTOMATICALLY and line.get("group_key") in in_doubt:
            return NEEDS_PERSON
        return own

    return {line["name"]: kind(line) for line in lines}


def import_progress(
    *,
    orders: int,
    cancelled: int,
    invoice_statuses: Iterable[str],
    line_statuses: Mapping[str, int],
    placements: Mapping[str, int],
    create_running: bool,
    check_concurrency: int,
) -> dict:
    """THE per-phase summary of one Porter import (spec #1554, "Progress contract"), from counts.

    `line_statuses` counts every line by `row_status`; `placements` counts the completed lines by
    `placement_kinds`. Each phase is a flat dict of counts, so a later ticket adds a key (warnings, say)
    without reshaping it:

      upload    orders, invoices, cancelled (Cancelled Porter orders, skipped)
      check     invoices, passed, in_progress, to_retry (Error), not_matching (Failed), seconds_left
                (None once nothing is in progress; a rough estimate, `CHECK_SECONDS_PER_INVOICE`)
      projects  orders (completed), placed_automatically, placed_by_person, needs_person
      create    orders (completed), created, waiting, failed, reopened (unreconciled after Create),
                running (a Create job is queued or running)
    """
    statuses = list(invoice_statuses)
    in_progress = sum(1 for status in statuses if status in INVOICE_IN_FLIGHT)
    completed = orders - cancelled

    def lines(status: str) -> int:
        return int(line_statuses.get(status) or 0)

    return {
        "upload": {"orders": orders, "invoices": len(statuses), "cancelled": cancelled},
        "check": {
            "invoices": len(statuses),
            "passed": statuses.count(INVOICE_PASSED),
            "in_progress": in_progress,
            "to_retry": statuses.count(INVOICE_ERROR),
            "not_matching": statuses.count(INVOICE_FAILED),
            "seconds_left": (
                math.ceil(in_progress / max(1, check_concurrency)) * CHECK_SECONDS_PER_INVOICE
                if in_progress
                else None
            ),
        },
        "projects": {
            "orders": completed,
            PLACED_AUTOMATICALLY: int(placements.get(PLACED_AUTOMATICALLY) or 0),
            PLACED_BY_PERSON: int(placements.get(PLACED_BY_PERSON) or 0),
            NEEDS_PERSON: int(placements.get(NEEDS_PERSON) or 0),
        },
        "create": {
            "orders": completed,
            "created": lines(ROW_SETTLED),
            "waiting": lines(ROW_PENDING_MATCH),
            "failed": lines(ROW_ERROR),
            "reopened": lines(ROW_MISMATCHED),
            "running": bool(create_running),
        },
    }
