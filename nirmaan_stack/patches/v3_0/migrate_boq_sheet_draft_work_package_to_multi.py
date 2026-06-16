import frappe


def execute():
    """Migrate BoQ Sheet Draft.work_package (single Link) to the new work_packages
    child table (BoQ Sheet Work Package).

    Reads work_package via raw SQL because the ORM no longer tracks that column
    after the schema change removes it from the doctype definition. Frappe does
    not automatically drop orphaned columns, so the data is still physically
    present in the DB when this patch runs.

    Idempotent: skips rows that already have a matching BoQ Sheet Work Package
    child record, so re-running is safe.

    Orphan guard: if the referenced Work Headers record no longer exists in the DB,
    that row is skipped and logged rather than failing the whole migration.
    """
    rows = frappe.db.sql(
        """
        SELECT name, work_package
        FROM "tabBoQ Sheet Draft"
        WHERE work_package IS NOT NULL AND work_package != ''
        """,
        as_dict=True,
    )

    migrated = 0
    skipped_orphan = 0
    skipped_exists = 0

    for row in rows:
        wh_name = row.work_package

        # Orphan guard: skip if the referenced Work Headers row is gone
        if not frappe.db.exists("Work Headers", wh_name):
            print(
                f"  migrate_boq_sheet_draft_work_package_to_multi: "
                f"skipping draft {row.name!r} -- Work Headers {wh_name!r} not found"
            )
            skipped_orphan += 1
            continue

        # Idempotency: skip if the child row already exists
        already = frappe.db.sql(
            """
            SELECT name FROM "tabBoQ Sheet Work Package"
            WHERE parent = %s
              AND parenttype = 'BoQ Sheet Draft'
              AND work_header = %s
            LIMIT 1
            """,
            (row.name, wh_name),
        )
        if already:
            skipped_exists += 1
            continue

        pkg = frappe.new_doc("BoQ Sheet Work Package")
        pkg.parent = row.name
        pkg.parenttype = "BoQ Sheet Draft"
        pkg.parentfield = "work_packages"
        pkg.work_header = wh_name
        pkg.insert(ignore_permissions=True)
        migrated += 1

    frappe.db.commit()
    print(
        f"migrate_boq_sheet_draft_work_package_to_multi: "
        f"migrated={migrated} skipped_already_exists={skipped_exists} "
        f"skipped_orphan={skipped_orphan}"
    )
