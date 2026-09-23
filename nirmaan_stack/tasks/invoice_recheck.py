# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Daily invoice re-check. Wired in hooks.py `scheduler_events["cron"]` at 05:00.

The Re-check button's queue sweep (`recheck_auto_approve.run_pending_queue`), run
for real with no preview: a Pending PO invoice held only by a PO-value check that
has since cleared (the DN landed, the PO was revised) is approved as System, and
a ceiling reason that changed is rewritten. Every other reason is left as it is.

The button stays for mid-day runs. Both share the candidate list and the
per-invoice row lock, so an invoice is approved once, by whichever gets there
first. Each approval leaves a timeline comment naming the daily re-check.
"""

from nirmaan_stack.api.invoices.recheck_auto_approve import run_pending_queue
from nirmaan_stack.tasks.janitor_log import janitor_log


def run_daily_recheck() -> dict:
    """The daily job. Returns the sweep summary (same shape as the button's)."""
    summary = run_pending_queue(dry_run=False, scheduled=True)
    counts = summary["counts"]
    janitor_log(
        f"[invoice-recheck] checked {summary['checked']} · approved {counts['approved']} "
        f"(Rs {summary['approved_value']:,.0f}) · cleared {counts['cleared']} · "
        f"blocked {counts['blocked']} · failed {counts['failed']} · "
        f"truncated {summary['truncated']}"
    )
    return summary
