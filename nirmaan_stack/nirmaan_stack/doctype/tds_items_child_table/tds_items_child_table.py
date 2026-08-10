# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class TDSItemsChildTable(Document):
	pass


def on_doctype_update():
	# Read/write index for the `members` display mirror: every rebuild deletes and
	# re-reads this table by `parent`, and the Desk grid loads by `parent` too.
	# Measured without it: Seq Scan. Frappe does NOT auto-create a parent index on
	# child tables here (verified against pg_indexes for this table AND for
	# `tabPurchase Order Item`), so it has to be declared.
	#
	# ⚠️ THE EXPLICIT `index_name` IS LOAD-BEARING — do not drop it to let Frappe
	# derive the default. Frappe names a single-field index `<field>_index`, i.e.
	# `parent_index`, and emits `CREATE INDEX IF NOT EXISTS "parent_index"`. In
	# PostgreSQL an index name is unique per SCHEMA, not per table, and
	# `parent_index` is ALREADY owned by `tabBoQ Committed Sheet Grid Row` (the
	# first doctype here to claim it). So the default-named call matches the
	# existing name, `IF NOT EXISTS` skips, and the statement succeeds while
	# creating nothing — a silent no-op with no error to notice. Verified: the
	# default call left this table with only its pkey.
	# Idempotent: add_index no-ops if THIS index already exists.
	frappe.db.add_index(
		"TDS Items Child Table", ["parent"], index_name="tds_items_child_parent_index"
	)
