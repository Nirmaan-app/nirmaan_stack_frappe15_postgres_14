"""
BoQ -- backfill Work-Package assignments onto ALREADY-committed BoQ Sheet rows.

Before the commit-pipeline fix, the WP-carry loop read an un-hydrated grandchild
(BoQ Sheet Draft.work_packages is a grandchild of BOQs and does NOT serialize on a
plain get_doc), so every committed BoQ Sheet.work_packages currently lands EMPTY in
production. New commits are fixed going forward; this patch is a one-time backfill so
the pricing badge shows the correct WP on already-committed work.

WP for a sheet lives on its draft (BoQ Sheet Draft.work_packages). This patch copies the
CURRENT draft WP onto the CURRENT committed sheet.

SCOPE: is_current=1 committed sheets ONLY -- we only have the current draft WP, so we do
NOT fabricate history on superseded (frozen) versions.

IDEMPOTENT: a committed sheet that already has WP rows is skipped, so re-running is a no-op.

FRESH-INSTALL / ORDERING GUARD: bails silently if the doctypes/tables aren't there yet, so
it never crashes `bench migrate` on a DB that predates these tables.

Sheet names matched VERBATIM (#152) -- trailing/leading spaces exist in real data; the
draft lookup uses byte-exact '=' on sheet_name. Direct child-row insert (mirrors
update_sheet_draft.set_sheet_work_packages) avoids a parent doc.save() on a committed
sheet -- capture-only, in line with the committed-tier's CAPTURE-ONLY controller rule.
"""

import frappe


def execute():
	# Fresh-install / ordering guard: bail silently if the doctypes/tables aren't there yet.
	if not frappe.db.table_exists("BoQ Sheet") or not frappe.db.table_exists(
		"BoQ Sheet Work Package"
	):
		return

	# Every CURRENT committed sheet.
	committed = frappe.get_all(
		"BoQ Sheet",
		filters={"is_current": 1},
		fields=["name", "boq", "sheet_name"],
	)
	backfilled = 0
	for cs in committed:
		# Idempotent: skip if this committed sheet already has WP rows.
		existing = frappe.db.count(
			"BoQ Sheet Work Package",
			{"parent": cs.name, "parenttype": "BoQ Sheet"},
		)
		if existing:
			continue

		# Find the source draft child (BoQ Sheet Draft under the same BOQs, matching sheet_name).
		draft_name = frappe.db.get_value(
			"BoQ Sheet Draft",
			{
				"parent": cs.boq,
				"parenttype": "BOQs",
				"parentfield": "sheet_drafts",
				"sheet_name": cs.sheet_name,
			},
			"name",
		)
		if not draft_name:
			continue

		wh_rows = frappe.db.get_all(
			"BoQ Sheet Work Package",
			filters={
				"parent": draft_name,
				"parenttype": "BoQ Sheet Draft",
				"parentfield": "work_packages",
			},
			fields=["work_header"],
			order_by="idx asc",
		)
		whs = [r.work_header for r in wh_rows if r.get("work_header")]
		if not whs:
			continue

		# Direct child-row insert (mirrors update_sheet_draft.set_sheet_work_packages) --
		# avoids a parent doc.save() on a committed sheet. Capture-only.
		for i, wh in enumerate(whs, start=1):
			frappe.get_doc(
				{
					"doctype": "BoQ Sheet Work Package",
					"parent": cs.name,
					"parenttype": "BoQ Sheet",
					"parentfield": "work_packages",
					"idx": i,
					"work_header": wh,
				}
			).insert(ignore_permissions=True)
		backfilled += 1

	if backfilled:
		frappe.db.commit()
	frappe.logger("boq").info(
		f"backfill_committed_sheet_work_packages: filled {backfilled} committed sheets"
	)
