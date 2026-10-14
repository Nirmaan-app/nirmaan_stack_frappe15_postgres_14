"""The monthly asset audit's two runs (owner, 2026-10-14). Rules: `services/asset_audit_open.py`.

- The 28th, 06:00 (`open_next_month_audits`): everyone up to date -- this month's audit sent, or none open --
  gets next month's audit now. Anyone still behind is left alone: grace until the 7th.
- The 7th, 06:00 (`close_last_month_audits`): every audit still unsent from last month is recorded "Audit
  Missed" and moves to this month (or closes, category no longer audited); then whoever sent last month's
  during the grace days gets this month's.

Run by hand (testing), acting as if it were that day:
    bench --site localhost execute nirmaan_stack.tasks.asset_audit.open_next_month_audits --kwargs "{'day': '2026-10-28'}"
    bench --site localhost execute nirmaan_stack.tasks.asset_audit.close_last_month_audits --kwargs "{'day': '2026-11-07'}"
"""

import frappe

from nirmaan_stack.services.asset_audit_open import open_due_audits, roll_missed_audits


def open_next_month_audits(day: str | None = None) -> dict:
    """The 28th: open next month's audit for everyone up to date, and commit.

    Args:
        day: act as if it were this day (YYYY-MM-DD) -- for testing; the scheduler passes nothing (today).

    Returns:
        {"opened": [<Asset Management name>, ...]}
    """
    result = {"opened": open_due_audits(day=day)}
    frappe.db.commit()
    frappe.logger("asset_audit").info("Asset audit, the 28th: %s opened" % len(result["opened"]))
    return result


def close_last_month_audits(day: str | None = None) -> dict:
    """The 7th: record last month's unsent audits as Missed (moved or closed), open this month's for whoever
    sent last month's during the grace days, and commit.

    Args:
        day: act as if it were this day (YYYY-MM-DD) -- for testing; the scheduler passes nothing (today).

    Returns:
        {"missed": [...], "moved": [...], "closed": [...], "opened": [...]} (Asset Management names)
    """
    result = roll_missed_audits(day=day)
    result["opened"] = open_due_audits(day=day)
    frappe.db.commit()
    frappe.logger("asset_audit").info(
        "Asset audit, the 7th: %s missed (%s moved, %s closed), %s opened"
        % (len(result["missed"]), len(result["moved"]), len(result["closed"]), len(result["opened"]))
    )
    return result
