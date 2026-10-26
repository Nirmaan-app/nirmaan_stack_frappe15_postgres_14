# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class CreditCardStatement(Document):
	# Written only by the card upload (api/outflow_import/card_upload.py); ADR-0039.
	pass


def on_doctype_update():
	# One statement per holder per billing period (ADR-0039 decision 2): the backstop under the upload's
	# own refusal, for two uploads racing. Postgres index names are schema-wide, so the name is explicit.
	frappe.db.add_unique(
		"Credit Card Statement",
		["holder", "period_from", "period_to"],
		"credit_card_statement_holder_period_unique",
	)
