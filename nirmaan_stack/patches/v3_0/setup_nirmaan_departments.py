"""Set up departments (owner, 2026-10-12).

1. Create the departments (Nirmaan Department) that don't exist yet.
2. Give every person without a department a starting one, from their role profile.
3. Project assets (category type "Project"): every one belongs to Projects, assigned or not, whoever
   holds it. A Project asset already in another department is moved to Projects (owner, 2026-10-12).
4. IT assets (every other asset): an assigned one without a department gets its holder's department.
   A free IT asset keeps no department: HR sets it in Edit Asset, or its first assignment gives it.

No Asset History rows are written (owner, 2026-10-12): this is one-time setup, not something a person
did, so the history starts with the next real event.

The role -> department table below is used ONCE, here, for the starting values. After this patch a
person's department is independent of their role and maintained by HR in Edit User; no code keeps the
two in sync. The Tendering roles have no department (nobody holds them, owner 2026-10-12): such a person
is skipped and reported, and HR picks a department for them.

Existing departments on people and IT assets are never overwritten; Project assets always end in
Projects. So the patch is safe to re-run.

`set_value` is used on people and assets, which skips their hooks on purpose: the one hook that would
react (a person's first department fills their held assets) is done explicitly in steps 3-4, without
its history row, so nothing derived is left stale.

Dry run -- prints everything, saves nothing:
    bench --site localhost execute nirmaan_stack.patches.v3_0.setup_nirmaan_departments.run --kwargs "{'dry_run': True}"
"""

from collections import Counter

import frappe

DEPARTMENTS = (
    "Projects",
    "Procurement",
    "Accounts",
    "Billing",
    "Estimates",
    "Design",
    "Sales",
    "HR",
    "PMO",
    "Management",
)

ROLE_PROFILE_DEPARTMENT = {
    "Nirmaan Project Manager Profile": "Projects",
    "Nirmaan Project Lead Profile": "Projects",
    "Nirmaan Procurement Executive Profile": "Procurement",
    "Nirmaan Procurement Lead Profile": "Procurement",
    "Nirmaan Material Procurement Executive Profile": "Procurement",
    "Nirmaan Service Procurement Executive Profile": "Procurement",
    "Nirmaan Accountant Profile": "Accounts",
    "Nirmaan Accountant Lead Profile": "Accounts",
    "Nirmaan Billing Executive Profile": "Billing",
    "Nirmaan Billing Lead Profile": "Billing",
    "Nirmaan Estimates Executive Profile": "Estimates",
    "Nirmaan Design Executive Profile": "Design",
    "Nirmaan Design Lead Profile": "Design",
    "Nirmaan Sales Executive Profile": "Sales",
    "Nirmaan Sales Lead Profile": "Sales",
    "Nirmaan HR Executive Profile": "HR",
    "Nirmaan HR Lead Profile": "HR",
    "Nirmaan PMO Executive Profile": "PMO",
    "Nirmaan Admin Profile": "Management",
}

PROJECT_CATEGORY_TYPE = "Project"
PROJECT_ASSETS_DEPARTMENT = "Projects"


def execute():
    run(dry_run=False)


def run(dry_run: bool = True) -> dict:
    """Do the four steps; with dry_run, print what would change and roll everything back."""
    created = []
    for department in DEPARTMENTS:
        if not frappe.db.exists("Nirmaan Department", department):
            frappe.get_doc(
                {"doctype": "Nirmaan Department", "department_name": department, "is_active": 1}
            ).insert(ignore_permissions=True)
            created.append(department)

    people_set, people_skipped = [], []
    for person in frappe.get_all("Nirmaan Users", fields=["name", "full_name", "role_profile", "department"]):
        if person.department:
            continue
        department = ROLE_PROFILE_DEPARTMENT.get(person.role_profile or "")
        if not department:
            people_skipped.append((person.name, person.role_profile or "(no role)"))
            continue
        frappe.db.set_value("Nirmaan Users", person.name, "department", department, update_modified=False)
        people_set.append((person.name, person.full_name, person.role_profile, department))

    holder_department = dict(frappe.get_all("Nirmaan Users", fields=["name", "department"], as_list=True))
    category_type = dict(frappe.get_all("Asset Category", fields=["name", "category_type"], as_list=True))
    project_set, it_set, it_skipped, free_it_left_empty = [], [], [], 0
    for asset in frappe.get_all("Asset Master", fields=["name", "asset_category", "current_assignee", "department"]):
        if category_type.get(asset.asset_category) == PROJECT_CATEGORY_TYPE:
            if asset.department != PROJECT_ASSETS_DEPARTMENT:
                frappe.db.set_value(
                    "Asset Master", asset.name, "department", PROJECT_ASSETS_DEPARTMENT, update_modified=False
                )
                project_set.append((asset.name, asset.current_assignee, asset.department))
            continue

        if asset.department:
            continue
        if not asset.current_assignee:
            free_it_left_empty += 1
            continue
        department = holder_department.get(asset.current_assignee)
        if not department:
            it_skipped.append((asset.name, asset.current_assignee))
            continue
        frappe.db.set_value("Asset Master", asset.name, "department", department, update_modified=False)
        it_set.append((asset.name, asset.current_assignee, department))

    report = {
        "departments_created": created,
        "people_per_department": dict(Counter(row[3] for row in people_set)),
        "people_set": people_set,
        "people_skipped": people_skipped,
        "project_assets_set": project_set,
        "it_assets_per_department": dict(Counter(row[2] for row in it_set)),
        "it_assets_skipped": it_skipped,
        "free_it_assets_left_empty": free_it_left_empty,
    }
    _print_report(report, dry_run)

    if dry_run:
        frappe.db.rollback()
    else:
        frappe.db.commit()
    return report


def _print_report(report: dict, dry_run: bool) -> None:
    print(("DRY RUN -- nothing saved" if dry_run else "Departments set up") + "\n")
    print("Departments created:", ", ".join(report["departments_created"]) or "(none, all existed)")
    print("\nPeople per department:")
    for department, count in sorted(report["people_per_department"].items()):
        print(f"  {department:12} {count}")
    print(f"\nPeople given a department ({len(report['people_set'])}):")
    for email, name, role, department in sorted(report["people_set"], key=lambda r: (r[3], r[1] or "")):
        print(f"  {department:12} {name or '':28} {email:40} ({role})")
    print(f"\nPeople skipped -- HR sets these by hand ({len(report['people_skipped'])}):")
    for email, role in report["people_skipped"]:
        print(f"  {email:40} ({role})")
    project_set = report["project_assets_set"]
    moved = [row for row in project_set if row[2]]
    print(f"\nProject assets set to {PROJECT_ASSETS_DEPARTMENT} ({len(project_set)}):")
    print(f"  assigned {sum(1 for row in project_set if row[1])}, free {sum(1 for row in project_set if not row[1])}")
    print(f"  moved from another department ({len(moved)}):")
    for asset, holder, previous in moved:
        print(f"    {asset:16} {previous:12} -> {PROJECT_ASSETS_DEPARTMENT}   {holder or '(free)'}")
    print("\nAssigned IT assets per department:")
    for department, count in sorted(report["it_assets_per_department"].items()):
        print(f"  {department:12} {count}")
    print(f"Assigned IT assets skipped (holder has no department): {len(report['it_assets_skipped'])}")
    for asset, holder in report["it_assets_skipped"]:
        print(f"  {asset:16} {holder}")
    print(f"Free IT assets left without a department: {report['free_it_assets_left_empty']}")
