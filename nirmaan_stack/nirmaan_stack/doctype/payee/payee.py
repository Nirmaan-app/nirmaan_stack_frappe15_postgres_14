# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Payee(Document):
	# Lifecycle rules live in integrations/controllers/payee.py; the only creator is
	# services/payees/writer.py.
	pass


def on_doctype_update():
	# One account + IFSC, ever: the backstop under the `validate` check, for two saves racing.
	# Postgres index names are schema-wide, so the name is explicit.
	frappe.db.add_unique("Payee", ["normalized_account", "ifsc"], "payee_normalized_account_ifsc_unique")
