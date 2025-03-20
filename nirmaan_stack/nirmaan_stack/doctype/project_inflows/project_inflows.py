# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries


class ProjectInflows(Document):
	def autoname(self):
		project = self.project.split("-")[-1]
		prefix = f"PAYIN-{project}-"
		self.name = f"{prefix}{getseries(prefix, 2)}"
