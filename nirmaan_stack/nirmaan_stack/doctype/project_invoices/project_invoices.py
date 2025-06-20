# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries


class ProjectInvoices(Document):
	def autoname(self):
		project = self.project.split("-")[-1]
		prefix = f"INV-{project}-"
		self.name = f"{prefix}{getseries(prefix, 2)}"
	def after_insert(self):
		if not self.customer:
			customer = frappe.db.get_value(
				"Projects",
				self.project,
				"customer",
			)
			if customer:
				self.customer = customer
				self.save()
