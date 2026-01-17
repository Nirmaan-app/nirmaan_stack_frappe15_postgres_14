# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class TDSRepository(Document):
	def validate(self):
		# Check for duplicate entry based on Work Package, Category, Item, and Make
		# Exclude the current document (self.name) to allow updates
		duplicate = frappe.db.exists("TDS Repository", {
			"work_package": self.work_package,
			"category": self.category,
			"tds_item_id": self.tds_item_id,
			"make": self.make,
			"name": ["!=", self.name]
		})

		if duplicate:
			frappe.throw("Duplicate Entry: A TDS Repository item with this Work Package, Category, Item, and Make already exists.")
