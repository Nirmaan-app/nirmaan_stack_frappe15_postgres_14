# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

PARENT_INDEX = "asset_history_parent_index"


class AssetHistory(Document):
	pass


def on_doctype_update():
	"""Index the history by its asset (`parent`).

	The history only grows, and every asset page load, every new history row (its next idx) and the
	History tab read it by asset. Frappe v15 on PostgreSQL creates no `parent` index on child tables,
	so without this each of those scans the whole table.

	The name is explicit on purpose: PostgreSQL index names are unique per schema, and Frappe's
	default (`parent_index`) already exists on another table, so `CREATE INDEX IF NOT EXISTS` with
	it would silently create nothing.

	A plain `bench migrate` doesn't run this for a doctype that is already synced, so
	`patches/v3_0/add_asset_history_parent_index.py` calls it on existing sites.
	"""
	frappe.db.add_index("Asset History", ["parent"], PARENT_INDEX)
