# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries


class ServiceRequests(Document):
	def autoname(self):
		project_id = self.project.split("-")[-1]
		#city = f"{self.project_city}".replace(" ", "_")
		prefix = "SR-"
		self.name = f"{prefix}{project_id}-{getseries(prefix, 6)}"
