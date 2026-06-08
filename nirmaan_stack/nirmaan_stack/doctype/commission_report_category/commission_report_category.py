# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class CommissionReportCategory(Document):
	def validate(self):
		"""Normalize the category name so trailing/leading spaces never get saved."""
		if self.category_name:
			self.category_name = self.category_name.strip()
