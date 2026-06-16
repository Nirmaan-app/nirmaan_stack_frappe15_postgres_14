import frappe


def execute():
    """Migrate BOQs.general_specs_sheet (scalar Data) + BOQs.master_preamble (scalar Long Text)
    to the new general_specs_sheets child table (BoQ General Specs Sheet).

    Reads old field values via raw SQL because the ORM no longer tracks columns after the
    schema change removes them from the doctype definition. Frappe does not auto-drop orphaned
    columns, so the data is still physically present when this patch runs.

    Sequence: frappe.reload_doc brings in the new child table + the updated BOQs schema FIRST,
    then raw SQL reads the old columns that are still physically in the DB.

    Idempotent: skips a BOQ that already has child rows in general_specs_sheets, so re-running
    is safe.
    """
    frappe.reload_doc("nirmaan_stack", "doctype", "boq_general_specs_sheet")
    frappe.reload_doc("nirmaan_stack", "doctype", "boqs")

    # Fresh-install / already-migrated guard: a database whose tabBOQs was created
    # directly with the general_specs_sheets child table never had the old scalar
    # columns (general_specs_sheet / master_preamble), so the raw SELECT below would
    # raise UndefinedColumn. The orphaned scalars are present only on the in-place
    # upgrade path.
    if not frappe.db.has_column("BOQs", "general_specs_sheet"):
        print(
            "migrate_general_specs_to_child_table: legacy 'general_specs_sheet' "
            "column absent -- nothing to migrate (fresh install)"
        )
        return

    rows = frappe.db.sql(
        """
        SELECT name, general_specs_sheet, master_preamble
        FROM "tabBOQs"
        WHERE general_specs_sheet IS NOT NULL AND general_specs_sheet != ''
        """,
        as_dict=True,
    )

    migrated = 0
    skipped_exists = 0

    for row in rows:
        # Idempotency: skip if this BOQ already has child rows
        already = frappe.db.sql(
            """
            SELECT name FROM "tabBoQ General Specs Sheet"
            WHERE parent = %s AND parenttype = 'BOQs'
            LIMIT 1
            """,
            (row.name,),
        )
        if already:
            skipped_exists += 1
            continue

        child = frappe.new_doc("BoQ General Specs Sheet")
        child.parent = row.name
        child.parenttype = "BOQs"
        child.parentfield = "general_specs_sheets"
        child.source_sheet_name = row.general_specs_sheet
        child.preamble_text = row.master_preamble or ""
        child.insert(ignore_permissions=True)
        migrated += 1

    frappe.db.commit()
    print(
        f"migrate_general_specs_to_child_table: "
        f"migrated={migrated} skipped_already_exists={skipped_exists}"
    )
