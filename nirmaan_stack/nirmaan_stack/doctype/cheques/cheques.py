# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Cheques(Document):
	# Lifecycle rules live in integrations/controllers/cheques.py; the only writer is
	# services/cheques/writer.py.
	pass


def on_doctype_update():
	# Postgres index names are schema-wide, so every name here is explicit (a bare
	# "vendor_index" already exists on another table and would silently create nothing).
	frappe.db.add_index("Cheques", ["vendor"], "cheques_vendor_index")
	frappe.db.add_index("Cheques", ["status"], "cheques_status_index")
	# One bank + cheque number, ever: the backstop under the `validate` check, for two saves racing.
	frappe.db.add_unique("Cheques", ["bank_key", "cheque_no"], "cheques_bank_key_cheque_no_unique")
