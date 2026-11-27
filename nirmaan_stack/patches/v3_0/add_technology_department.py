"""Add the department Technology (ADR-0051 decision 2, owner 2026-11-27).

The software development team's department. Admin and HR give it to people in Edit User, as with any
department; this patch gives it to nobody. It creates the `Nirmaan Department` row, active, only when it is
missing, so a re-run changes nothing.

Dry run -- prints what it would do, saves nothing:
    bench --site localhost execute nirmaan_stack.patches.v3_0.add_technology_department.run --kwargs "{'dry_run': True}"
"""

import frappe

DEPARTMENT = "Technology"


def execute():
    run(dry_run=False)


def run(dry_run: bool = True) -> bool:
    """Create Technology when it is missing. Returns whether it was (or, in a dry run, would be) created."""
    if frappe.db.exists("Nirmaan Department", DEPARTMENT):
        print(f"Department {DEPARTMENT} exists; nothing to do")
        return False
    if dry_run:
        print(f"DRY RUN -- nothing saved. Would create the department {DEPARTMENT} (active)")
        return True
    frappe.get_doc({"doctype": "Nirmaan Department", "department_name": DEPARTMENT, "is_active": 1}).insert(
        ignore_permissions=True
    )
    print(f"Created the department {DEPARTMENT} (active)")
    return True
