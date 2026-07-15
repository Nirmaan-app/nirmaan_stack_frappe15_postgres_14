# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class BoQCommittedSheetGridRow(Document):
	pass


def on_doctype_update():
	# Standard child-table parent index. Frappe does NOT auto-create it on this PostgreSQL site
	# (119/125 child tables lack it -- systemic, see the D3d follow-up), so reading one sheet's
	# grid rows by `parent` was a Seq Scan over the ~270k-row table (get_committed_sheet_grid).
	# Idempotent: add_index no-ops if the index already exists.
	frappe.db.add_index("BoQ Committed Sheet Grid Row", ["parent"])
