import frappe
from frappe.utils import flt

from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import trigger_check


def set_default_cashflow_gap_limit():
    """Daily cron (2 AM IST): seed cashflow_gap_limit at 20% of project_value_gst
    for projects that don't have a meaningful limit yet (NULL or < 1). Skips
    Completed projects and projects whose project value isn't set yet.

    After seeding, runs trigger_check so CEO Hold gets evaluated against the
    new limit (mirrors the on_update hook in projects.py).
    """
    rows = frappe.db.sql(
        """
        SELECT name, project_value_gst
        FROM "tabProjects"
        WHERE (cashflow_gap_limit IS NULL OR cashflow_gap_limit < 1)
          AND status NOT IN ('Completed')
        """,
        as_dict=True,
    )

    updated = 0
    for row in rows:
        project_value = flt(row.project_value_gst)
        if project_value <= 0:
            continue

        new_limit = round(project_value * 0.20, 2)

        try:
            frappe.db.set_value(
                "Projects",
                row.name,
                "cashflow_gap_limit",
                new_limit,
            )
            trigger_check(row.name)
            updated += 1
        except Exception as e:
            print(f"set_default_cashflow_gap_limit failed for {row.name}: {e}")

    if updated:
        frappe.db.commit()
        print(f"set_default_cashflow_gap_limit: seeded {updated} project(s)")
