# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries


class NirmaanAttachments(Document):
	def autoname(self) -> None:
		project = self.project.split("-")[-1]
		prefix = f"ATT-{project}-"
		self.name = f"{prefix}{getseries(prefix, 3)}"

