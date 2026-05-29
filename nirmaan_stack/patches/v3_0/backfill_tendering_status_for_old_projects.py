import frappe


def execute():
    """Backfill `tendering_status = "Won"` on every pre-v3 Projects row.

    Every project that exists pre-v3 is a real/awarded job — the v2 tendering
    model (which would have introduced `status="Tendering"` rows) was never
    actually rolled out, and the prior `Created -> Won` rename patch was also
    never run. So the cutover is a single, simple write: stamp
    `tendering_status = "Won"` on every existing row, leaving `status` (the
    execution lifecycle) untouched.

    New Tendering stubs created after this patch will be inserted with
    `tendering_status = "Tendering"` and an empty `status` by
    `create_tendering_project`.

    Idempotent: rows that already carry a `tendering_status` are skipped.

    See docs/adr/0001-project-tendering-status.md (v3).
    """
    rows = frappe.get_all(
        "Projects",
        filters={"tendering_status": ["in", ["", None]]},
        pluck="name",
    )

    for name in rows:
        frappe.db.set_value(
            "Projects",
            name,
            "tendering_status",
            "Won",
            update_modified=False,
        )

    frappe.db.commit()

    print(
        f"backfill_tendering_status_for_old_projects: stamped {len(rows)} "
        "project(s) as tendering_status='Won'"
    )
