"""The DB side of the Software Developer walk (ADR-0051). Read-only: prints one `JSON {...}` line.

    devenv.sh script <task> .claude/skills/verify/bin/software_developer_db.py <admin email> <developer email>

For each of the two users: their `Nirmaan Users.role_profile`, their Frappe Roles, their Projects User
Permissions (decision 6: none), and the enabled reminder schedules the Reminders panel scopes to them. Plus the
figures the screens show the same for both: Requested payments (Approve Payments), Pending Expense Requests
(the review queue), pending Purchase Order invoices (Pending Invoice Approvals), and Won and all projects.
"""

import json
import sys

import frappe

from nirmaan_stack.api.reminders.read import _my_schedule_names

admin, developer = sys.argv[1], sys.argv[2]


def person(email):
    schedules = _my_schedule_names(email)
    pending = frappe.get_all(
        "Reminder Schedule Log",
        filters={"reminder_schedule": ["in", schedules or [""]], "status": "Pending"},
        pluck="reminder_schedule",
    )
    return {
        "role_profile": frappe.db.get_value("Nirmaan Users", email, "role_profile"),
        "roles": sorted(frappe.get_roles(email)),
        "project_permissions": frappe.db.count("User Permission", {"user": email, "allow": "Projects"}),
        "reminders": sorted(
            n for n in schedules if frappe.db.get_value("Reminder Schedule", n, "enabled")
        ),
        # What the Reminders panel lists: the schedules (by title) with a Pending reminder (`get_my_reminder_logs`).
        "pending_reminders": sorted(
            {frappe.db.get_value("Reminder Schedule", n, "title") for n in pending}
        ),
    }


out = {
    "admin": person(admin),
    "developer": person(developer),
    "requested_payments": frappe.db.count("Project Payments", {"status": "Requested"}),
    "pending_expense_requests": frappe.db.count("Expense Request", {"status": "Pending Approval"}),
    "projects": frappe.db.count("Projects"),
    # The Projects list opens on Won Projects (`tendering_status`), which this count matches.
    "won_projects": frappe.db.count("Projects", {"tendering_status": "Won"}),
    # Pending Invoice Approvals opens on its PO pill: Purchase Order invoices waiting for a decision.
    "pending_po_invoices": frappe.db.count(
        "Vendor Invoices", {"status": "Pending", "document_type": "Procurement Orders"}
    ),
}
print("JSON " + json.dumps(out, default=str))
