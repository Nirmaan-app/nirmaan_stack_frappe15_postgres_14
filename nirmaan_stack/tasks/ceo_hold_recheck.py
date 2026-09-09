# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
CEO Hold scheduled recheck — the ONLY mechanism that ends scheduled-recheck mode.

Background: the authorized user may release a CEO Hold WITHOUT resolving its reasons by
naming the date on which the system should decide again. From that release until that
date the project is in "scheduled-recheck mode" (`Projects.ceo_hold_recheck_scheduled`),
and every CEO Hold evaluation entry point bails out on `core.is_recheck_scheduled` — the
Payment / Expense / Inflow / PO hooks (via `sync_cashflow_reason`), the DN source (via
`core.sync_delivery_pending`), and `core.recompute_ceo_hold` itself as the backstop. Those
hooks still do all of their NORMAL work; only the hold DECISION is deferred to here.

This sweep runs daily on the existing "0 2 * * *" slot, alongside the action-item
reconcile (no new schedule — see hooks.py `scheduler_events`).

Two rules make it safe:

  * `recheck_date <= today`, never `== today`. A missed / delayed / failed cron run must
    still catch up on the next one, rather than stranding the project in scheduled mode
    forever with its hooks silenced.
  * It CLEARS the schedule FIRST, then re-runs the EXISTING evaluation — it does not carry
    a second copy of any CEO Hold rule. Clearing first is what lets the shared guards pass;
    the hold conditions themselves are still owned entirely by `sync_cashflow_reason`
    (cashflow) and `reconcile_project_action_items` → `core.sync_delivery_pending` (DN).
    Whatever those two decide IS the outcome: the project goes back on CEO Hold, or keeps
    the status the CEO released it to. Either way normal hook evaluation resumes.

Terminal protection: a project that reached Completed / Halted (or is already back on CEO
Hold) has its stale schedule CLEARED and is never evaluated — the same
`core.RECHECK_EXCLUDED_STATUSES` set `Projects.validate` normalises against, so the rule
holds whether the project got there through a save or through a direct write.

Failures are isolated per project (rollback + log_error + continue — the pmo_task_renewal
idiom), so one bad project can never strand the rest of the batch.
"""

import frappe
from frappe.utils import today

from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import (
    sync_cashflow_reason,
)
from nirmaan_stack.services.action_items.reconcile import reconcile_project_action_items
from nirmaan_stack.services.ceo_hold import core


def get_due_rechecks():
    """Projects whose recheck date has arrived (`<= today`). Returns [{name, status}].

    Deliberately does NOT filter status in SQL: the excluded statuses are handled in
    Python so a stale schedule on a Completed / Halted / re-held project is still SEEN and
    CLEARED rather than left behind forever by a `status != ...` predicate (which on
    PostgreSQL would also drop NULL-status rows outright).
    """
    return frappe.db.sql(
        """
        SELECT name, status FROM "tabProjects"
        WHERE ceo_hold_recheck_scheduled = 1
          AND ceo_hold_recheck_date IS NOT NULL
          AND ceo_hold_recheck_date <= %s
        """,
        (today(),),
        as_dict=True,
    )


def _recheck_one(project_name, status):
    """Clear the schedule, then re-run the existing evaluation. Returns the outcome key.

    `"skipped_terminal"` — Completed / Halted / already CEO Hold: schedule cleared, no
    evaluation, status untouched.
    `"evaluated"` — the two existing source syncs ran; they alone decided whether the
    project goes back on CEO Hold.
    """
    if status in core.RECHECK_EXCLUDED_STATUSES:
        core.clear_recheck_schedule(project_name)
        frappe.db.commit()
        return "skipped_terminal"

    # Clear FIRST: `is_recheck_scheduled` is what the shared guards read, so the schedule
    # has to be gone before the existing evaluation can run at all. It rides the commit
    # below, so a failure before that point rolls the clear back too and the project is
    # simply retried on the next run — never silently dropped out of scheduled mode.
    core.clear_recheck_schedule(project_name)

    # Source 1 — cashflow gap. The existing controller, unchanged.
    sync_cashflow_reason(project_name)
    frappe.db.commit()

    # Source 2 — delivery-pending count. The existing reconcile re-derives it from truth
    # and calls `core.sync_delivery_pending` itself (and commits once internally). It has
    # to be re-run rather than just recomputed: the frozen reason rows may no longer match
    # reality after the release window.
    reconcile_project_action_items(project_name)

    return "evaluated"


def run_due_ceo_hold_rechecks():
    """Daily sweep: end scheduled-recheck mode for every project whose date has arrived.

    Returns ``{due, evaluated, skipped_terminal, held, failed}`` — `held` counts the
    projects the existing evaluation put back on CEO Hold.
    """
    due = get_due_rechecks()
    totals = {
        "due": len(due),
        "evaluated": 0,
        "skipped_terminal": 0,
        "held": 0,
        "failed": 0,
    }

    for row in due:
        name = row["name"]
        try:
            outcome = _recheck_one(name, row.get("status"))
            totals[outcome] += 1
            if outcome == "evaluated" and (
                frappe.db.get_value("Projects", name, "status") == "CEO Hold"
            ):
                totals["held"] += 1
        except Exception:
            frappe.db.rollback()
            totals["failed"] += 1
            frappe.log_error(
                frappe.get_traceback(),
                f"CEO Hold scheduled recheck failed for {name}",
            )

    if totals["due"]:
        frappe.logger("ceo_hold").info("CEO Hold scheduled recheck: %s", totals)

    return totals
