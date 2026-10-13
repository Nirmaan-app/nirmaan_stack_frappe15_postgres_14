# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ChequeStatusHistory(Document):
	pass


def on_doctype_update():
	# Frappe v15 on Postgres creates no `parent` index for child tables; the name is explicit
	# because Postgres index names are schema-wide.
	frappe.db.add_index("Cheque Status History", ["parent"], "cheque_status_history_parent_index")
