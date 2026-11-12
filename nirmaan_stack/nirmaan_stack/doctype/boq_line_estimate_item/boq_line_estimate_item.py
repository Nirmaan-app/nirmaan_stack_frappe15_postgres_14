# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

# Postgres index names are schema-wide: explicit and table-specific (services/index_manifest.py lists it).
# The estimate reads load a sheet's items by `parent`, and PostgreSQL child tables get no parent index.
PARENT_INDEX = "BOQ_Line_Estimate_Item_parent_idx"


class BOQLineEstimateItem(Document):
	pass


def on_doctype_update():
	frappe.db.add_index("BOQ Line Estimate Item", ["parent"], index_name=PARENT_INDEX)
