# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class MaterialTestCertificateItem(Document):
	pass


def on_doctype_update():
	# Frappe v15 on Postgres creates no `parent` index for child tables, and every MTC read
	# joins its items on `parent`. The name must be explicit: Postgres index names are
	# schema-wide, and the default `parent_index` already exists on another table, so
	# `CREATE INDEX IF NOT EXISTS "parent_index"` would silently create nothing.
	frappe.db.add_index("Material Test Certificate Item", ["parent"], "mtc_item_parent_index")
