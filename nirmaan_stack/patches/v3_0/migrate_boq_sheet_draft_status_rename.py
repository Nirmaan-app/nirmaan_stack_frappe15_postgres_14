import frappe


def execute():
    """Rename BoQ Sheet Draft wizard_status values (A1 status rename).

    'Reviewed'          -> 'Config Done'
    'Parsed Check Done' -> 'Finalized'

    The doctype Select options are renamed in boq_sheet_draft.json (synced by
    `bench migrate`), but option metadata does NOT touch stored row values --
    existing rows keep the old strings until this patch rewrites them. Idempotent:
    a re-run finds zero rows of either old value and is a no-op.

    Only BoQ Sheet Draft.wizard_status stores these strings (verified: edit_log,
    parse-history, and exports embed no status string), so this one column is the
    entire migration surface.
    """
    rename_map = {
        "Reviewed": "Config Done",
        "Parsed Check Done": "Finalized",
    }
    total = 0
    for old, new in rename_map.items():
        names = frappe.get_all(
            "BoQ Sheet Draft", filters={"wizard_status": old}, pluck="name"
        )
        for name in names:
            frappe.db.set_value(
                "BoQ Sheet Draft", name, "wizard_status", new, update_modified=False
            )
        total += len(names)
        print(
            f"migrate_boq_sheet_draft_status_rename: {len(names)} row(s) "
            f"{old!r} -> {new!r}"
        )
    frappe.db.commit()
    print(f"migrate_boq_sheet_draft_status_rename: {total} row(s) renamed total")
