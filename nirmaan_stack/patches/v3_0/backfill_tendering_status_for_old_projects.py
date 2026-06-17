import frappe


def execute():
    """Backfill `tendering_status = "Won"` on every pre-v3 Projects row.

    Every project that exists pre-v3 is a real/awarded job — the v2 tendering
    model (which would have introduced `status="Tendering"` rows) was never
    actually rolled out. This patch stamps `tendering_status = "Won"` on every
    existing row and leaves the execution `status` untouched HERE; the parallel
    `migrate_project_status_created_to_won` patch owns the execution side
    (renaming any legacy `status="Created"` to the `"Won"` initial stage — see
    ADR-0001 v3.1, Won-as-initial).

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
