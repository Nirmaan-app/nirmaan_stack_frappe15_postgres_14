# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class TDSRepository(Document):
	def validate(self):
		# An entry is uniquely identified by its TDS Item + Make.
		# Exclude the current document (self.name) to allow updates.
		duplicate = frappe.db.exists("TDS Repository", {
			"tds_item": self.tds_item,
			"make": self.make,
			"name": ["!=", self.name]
		})

		if duplicate:
			frappe.throw("Duplicate Entry: A TDS Repository entry for this TDS Item and Make already exists.")
