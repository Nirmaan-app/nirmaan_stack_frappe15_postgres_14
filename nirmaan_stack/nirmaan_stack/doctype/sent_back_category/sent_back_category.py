# Copyright (c) 2024, Abhishek and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries


class SentBackCategory(Document):
	def autoname(self):
		project = self.project.split("-")[-1]
		pr = self.procurement_request.split("-")[-1]
		prefix = "SB-"
		self.name = f"{prefix}{project}-{pr}-{getseries(prefix, 5)}"
