# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class MaterialTestCertificate(Document):
	# Lifecycle rules live in integrations/controllers/material_test_certificate.py.
	pass


def on_doctype_update():
	# `search_index` on these two fields creates NOTHING on Postgres: Frappe names such an
	# index after the bare fieldname, index names are schema-wide, and indexes called
	# "project" / "procurement_order" already exist on other tables, so its
	# `CREATE INDEX IF NOT EXISTS` is a silent no-op. Explicit names make them real.
	frappe.db.add_index("Material Test Certificate", ["procurement_order"], "mtc_procurement_order_index")
	frappe.db.add_index("Material Test Certificate", ["project"], "mtc_project_index")
