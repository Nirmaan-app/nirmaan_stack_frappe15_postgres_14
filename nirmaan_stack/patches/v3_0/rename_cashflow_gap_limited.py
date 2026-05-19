"""
Rename Projects.cashflow_gap_limited → cashflow_gap_limit.

Handles three states idempotently so it's safe to re-run:

1. Only OLD column exists → ALTER TABLE RENAME COLUMN (preserves data).
2. Both OLD and NEW columns exist → copy data old→new (only where new is empty,
   so any post-rename writes are preserved), then DROP the old column. This is
   the state we land in if a prior migrate ran with the new JSON while the
   rename patch itself was skipped/failed.
3. Only NEW column exists → no-op (rename already happened).
"""

import frappe
from frappe.model.utils.rename_field import rename_field


def execute():
	columns = frappe.db.get_table_columns("Projects") or []
	has_old = "cashflow_gap_limited" in columns
	has_new = "cashflow_gap_limit" in columns

	if has_old and has_new:
		# Recover from a doctype-sync-added empty new column.
		# Only fill rows where the new column is empty (NULL or 0) so any genuine
		# values written into the new column after the drift are not overwritten.
		frappe.db.sql("""
			UPDATE "tabProjects"
			SET cashflow_gap_limit = cashflow_gap_limited
			WHERE cashflow_gap_limited IS NOT NULL
			  AND (cashflow_gap_limit IS NULL OR cashflow_gap_limit = 0)
		""")
		frappe.db.sql('ALTER TABLE "tabProjects" DROP COLUMN cashflow_gap_limited')
		frappe.db.commit()
		return

	if has_old and not has_new:
		rename_field("Projects", "cashflow_gap_limited", "cashflow_gap_limit")
		frappe.db.commit()
		return

	# has_new only, or neither → nothing to do.
