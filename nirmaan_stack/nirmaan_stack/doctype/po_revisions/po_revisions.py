# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries


class PORevisions(Document):
	def autoname(self):
		if self.revised_po and self.project:
			# Format: PRT/project = self.project.split("-")[-1]/pomuber/01
			project_short = self.project.split("-")[-1]
			po_number = self.revised_po.split("/")[1] if "/" in self.revised_po else self.revised_po
			prefix = f"PRT/{project_short}/{po_number}/"
			self.name = f"{prefix}{getseries(prefix, 2)}"
		elif self.project:
			# Fallback
			project = self.project.split("-")[-1]
			prefix = f"{project}-PO-REV-"
			self.name = f"{prefix}{getseries(prefix, 2)}"
		else:
			self.name = frappe.generate_hash(length=10)
