import frappe


def execute():
	"""Backfill `status` on TDS Repository rows.

	A row is `Verified` if any Project TDS Item List row matches it on the
	uniqueness signature (item_name, category, work_package, make). Otherwise
	it's `Not Verified`. Match keys are normalized (trim + lowercase) so
	hidden whitespace / casing differences between the two tables don't
	cause false negatives.

	`update_modified=False` preserves the master row's modified timestamp.
	"""
	def norm(s):
		return (s or "").strip().lower()

	# Build set of (item_name, category, work_package, make) keys from every
	# Project TDS Item List row. Any TDS Repository row whose normalized key
	# is in this set gets stamped Verified.
	ptil_rows = frappe.get_all(
		"Project TDS Item List",
		fields=["tds_item_name", "tds_category", "tds_work_package", "tds_make"],
		limit_page_length=0,
	)
	project_keys = {
		(
			norm(r.get("tds_item_name")),
			norm(r.get("tds_category")),
			norm(r.get("tds_work_package")),
			norm(r.get("tds_make")),
		)
		for r in ptil_rows
	}

	# Pull every TDS Repository row's identifying fields, decide its target
	# status, write only when it doesn't already have one (re-run safe).
	repo_rows = frappe.get_all(
		"TDS Repository",
		fields=["name", "tds_item_name", "category", "work_package", "make", "status"],
		limit_page_length=0,
	)

	updated = 0
	for r in repo_rows:
		current = r.get("status") or ""
		key = (
			norm(r.get("tds_item_name")),
			norm(r.get("category")),
			norm(r.get("work_package")),
			norm(r.get("make")),
		)
		is_match = key in project_keys

		# - Empty status → stamp the right value
		# - Was wrongly stamped Not Verified (e.g. a previous SQL-join run that
		#   missed because of whitespace/casing) → upgrade to Verified
		# - Anything else (already Verified, manually curated) → leave alone
		if not current:
			new_status = "Verified" if is_match else "Not Verified"
		elif current == "Not Verified" and is_match:
			new_status = "Verified"
		else:
			continue

		frappe.db.set_value(
			"TDS Repository", r["name"], "status", new_status, update_modified=False
		)
		updated += 1

	if updated:
		frappe.db.commit()
