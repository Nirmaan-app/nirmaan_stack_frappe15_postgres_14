# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class TDSRepository(Document):
	def before_insert(self):
		# Generate custom item ID if this is a custom item (no tds_item_id but has tds_item_name)
		if not self.tds_item_id and self.tds_item_name:
			self.tds_item_id = self.generate_custom_item_id()

	def generate_custom_item_id(self):
		"""Generate next custom item ID in format CUS-000001"""
		result = frappe.db.sql("""
			SELECT tds_item_id FROM `tabTDS Repository`
			WHERE tds_item_id LIKE 'CUS-%%'
			ORDER BY CAST(SUBSTRING(tds_item_id, 5) AS INTEGER) DESC
			LIMIT 1
		""", as_dict=True)
		
		if result and result[0].tds_item_id:
			last_num = int(result[0].tds_item_id.replace('CUS-', ''))
			return f"CUS-{str(last_num + 1).zfill(6)}"
		return "CUS-000001"

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

