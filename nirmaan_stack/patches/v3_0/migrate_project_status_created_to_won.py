import frappe


def execute():
    """Retire the project lifecycle status 'Created' in favour of 'Won'.

    'Won' becomes the initial stage of a real/awarded project. Every project
    currently at status 'Created' is rewritten to 'Won'; projects at any other
    status (WIP/Completed/Halted/Handover/CEO Hold) are left untouched.

    See docs/adr/0001-project-tendering-status.md.
    """
    created = frappe.get_all("Projects", filters={"status": "Created"}, pluck="name")
    for name in created:
        frappe.db.set_value("Projects", name, "status", "Won", update_modified=False)
    frappe.db.commit()
    print(f"migrate_project_status_created_to_won: migrated {len(created)} project(s) Created -> Won")
