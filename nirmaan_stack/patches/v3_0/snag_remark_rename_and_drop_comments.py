"""
Snag List Revision 2 schema move (ADR-0018):

  1. Project Snag.source_remarks -> Project Snag.remark   (RENAME -- data preserved)
  2. Project Snag.comments                                 (DROP -- data destroyed, by decision)

Both halves are idempotent and safe to re-run.

WHY A PATCH AT ALL. `bench migrate` syncs the doctype DEFINITION but does NOT drop a removed
column and does NOT rename anything -- it simply ADDS the new column, empty, and leaves the old
one sitting there full of data. So a JSON-only edit silently loses every imported remark.
Precedents followed: `rename_cashflow_gap_limited.py` (the rename + its both-columns recovery)
and `remove_commission_report_zones.py` (the DROP COLUMN half).

ORDERING TRAP. `patches.txt` runs only `[post_model_sync]`, so by the time this executes the
migrate has ALREADY created an empty `remark` column from the new JSON. That is why the
"both columns exist" branch is the normal path here, not the exceptional one -- do not
"simplify" it away to a bare rename_field(), which would fail on the pre-existing column.
"""

import frappe
from frappe.model.utils.rename_field import rename_field

TABLE = "tabProject Snag"
DOCTYPE = "Project Snag"


def execute():
	if not frappe.db.table_exists(DOCTYPE):
		return

	_rename_source_remarks_to_remark()
	_drop_comments()


def _rename_source_remarks_to_remark():
	columns = frappe.db.get_table_columns(DOCTYPE) or []
	has_old = "source_remarks" in columns
	has_new = "remark" in columns

	if has_old and has_new:
		# The normal path here (see ORDERING TRAP above): migrate already added an empty
		# `remark`. Fill only where the new column is still empty, so anything genuinely
		# written to `remark` after the drift is never clobbered.
		frappe.db.sql(
			f'''
			UPDATE "{TABLE}"
			SET remark = source_remarks
			WHERE source_remarks IS NOT NULL
			  AND (remark IS NULL OR remark = '')
			'''
		)
		frappe.db.sql(f'ALTER TABLE "{TABLE}" DROP COLUMN IF EXISTS source_remarks')
		frappe.db.commit()
		return

	if has_old and not has_new:
		rename_field(DOCTYPE, "source_remarks", "remark")
		frappe.db.commit()
		return

	# new-only, or neither -> already done.


def _drop_comments():
	"""Drop the retired `comments` column.

	DATA IS DESTROYED HERE, deliberately (ADR-0018): the two-field split is gone and there is
	nowhere for this text to go. `comments` only ever existed on this branch and was never
	released, so there is nothing in it -- but the DROP is written to be correct regardless,
	because a patch that is right only under an assumption about production is not right.
	"""
	columns = frappe.db.get_table_columns(DOCTYPE) or []
	if "comments" not in columns:
		return

	frappe.db.sql(f'ALTER TABLE "{TABLE}" DROP COLUMN IF EXISTS comments')
	frappe.db.commit()
