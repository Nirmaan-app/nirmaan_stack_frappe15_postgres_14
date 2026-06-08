import frappe

# Categories considered IT by default. Match both singular/plural spellings
# in case data has either form. Everything else is tagged "Project".
IT_CATEGORY_NAMES = {"Laptop", "Monitors", "Tab"}


def execute():
	rows = frappe.get_all(
		"Asset Category",
		filters={"category_type": ["in", ["", None]]},
		fields=["name"],
	)

	updated = 0
	for row in rows:
		new_type = "IT" if row.name in IT_CATEGORY_NAMES else "Project"
		frappe.db.set_value(
			"Asset Category",
			row.name,
			"category_type",
			new_type,
			update_modified=False,
		)
		updated += 1

	if updated:
		frappe.db.commit()
		print(f"backfill_asset_category_type: tagged {updated} Asset Category rows")
