"""
Nightly cron entry point for the Project Action Item self-healing sweep.

Runs `reconcile_all()` once a night (cron "0 2 * * *", registered in hooks.py
scheduler_events). This is the correctness backstop: event hooks are only a latency
optimisation, so a missed/dropped event is made eventually-correct here. The same
`reconcile_all()` is also the one-time backfill (`bench execute ...run_nightly_reconcile`).

`reconcile_all()` already isolates failures per project (try/except + rollback +
log_error + continue — the pmo_task_renewal idiom) and commits once per project, so
this wrapper just invokes it and logs the aggregate counts.
"""

import frappe

from nirmaan_stack.services.action_items.reconcile import reconcile_all


def run_nightly_reconcile():
    """Sweep every active project's action items; log + return the aggregate counts."""
    totals = reconcile_all()
    frappe.logger("action_items").info(
        "Project Action Item nightly reconcile: %s", totals
    )
    return totals
