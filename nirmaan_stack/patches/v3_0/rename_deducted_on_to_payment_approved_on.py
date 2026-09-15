"""
Carry Payment TDS Deduction.deducted_on -> payment_approved_on.

The field was renamed on the doctype; this copies the DATA across.

⚠️ THE OLD COLUMN AND ITS DATA ARE DELIBERATELY LEFT IN PLACE (owner ruling 2026-09-12). Dropping
`deducted_on` is a separate, manual step the owner takes once every row is confirmed carried over.
So this patch only ever WRITES the new column -- it never drops, never clears, never destroys
anything. That is also what makes it trivially safe to re-run.

WHY A PATCH AT ALL. `bench migrate` syncs the doctype DEFINITION but moves no data: it ADDS
`payment_approved_on` empty and leaves `deducted_on` sitting there full of dates. All 626 rows
carry one and the ledger sorts by it, so without this the column would read blank on every row
while the real dates sat unreachable beside it.

ORDERING. `patches.txt` runs this in `[post_model_sync]`, so the empty new column already exists by
the time it executes -- that is the normal path, not an edge case.

⚠️ FROM THE MOMENT THE DOCTYPE CHANGES, `deducted_on` STOPS BEING MAINTAINED. It is no longer a
field, so every row written from here on fills `payment_approved_on` only and leaves the old column
NULL. The old column is therefore a FROZEN SNAPSHOT of the pre-rename rows -- useful as a safety
net to compare against, but it will not track new deductions, and it must not be read as if it
still did.
"""

import frappe

DOCTYPE = "Payment TDS Deduction"
TABLE = "tabPayment TDS Deduction"
OLD = "deducted_on"
NEW = "payment_approved_on"


def execute():
	if not frappe.db.table_exists(DOCTYPE):
		return

	columns = frappe.db.get_table_columns(DOCTYPE) or []

	if OLD not in columns:
		# Already dropped by hand, or a site that never had the old name -> nothing to carry.
		return

	if NEW not in columns:
		# The doctype sync owns creating the new column; with no target there is nothing to copy
		# into. Reached only if this runs before the model sync, which patches.txt prevents.
		return

	# Fill ONLY where the new column is still empty. Two reasons, both load-bearing:
	#   * a value genuinely written to the new column after the rename is never clobbered, and
	#   * a re-run copies nothing, so the patch is idempotent without needing to track state.
	frappe.db.sql(
		f"""
		UPDATE "{TABLE}"
		SET {NEW} = {OLD}
		WHERE {OLD} IS NOT NULL AND {NEW} IS NULL
		"""
	)
	frappe.db.commit()
