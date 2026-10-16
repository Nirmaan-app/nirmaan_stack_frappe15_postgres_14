# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ChequeLine(Document):
	pass


def on_doctype_update():
	# Frappe v15 on Postgres creates no `parent` index for child tables. Names are explicit:
	# Postgres index names are schema-wide. `payment_name` serves "which Cheque is this payment
	# or expense on" (the pickers, the chip, detach on Rejected / delete).
	frappe.db.add_index("Cheque Line", ["parent"], "cheque_line_parent_index")
	frappe.db.add_index("Cheque Line", ["payment_name"], "cheque_line_payment_name_index")
	frappe.db.add_index("Cheque Line", ["record_name"], "cheque_line_record_name_index")
