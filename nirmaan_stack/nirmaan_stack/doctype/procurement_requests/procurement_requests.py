# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries


class ProcurementRequests(Document):
	def autoname(self):
		project_id = self.project.split("-")[-1]
		#city = f"{self.project_city}".replace(" ", "_")
		prefix = "PR-"
		self.name = f"{prefix}{project_id}-{getseries(prefix, 6)}"
