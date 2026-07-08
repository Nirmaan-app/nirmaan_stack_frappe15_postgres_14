# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries


class NirmaanAttachments(Document):
	def autoname(self) -> None:
		# A project-less attachment (e.g. a BoQ TEMPLATE source file -- ADR-0013 templates
		# are project-less) has no project segment; fall back to "TPL". Non-template
		# attachments always carry a project, so their names are byte-identical.
		project = (self.project or "TPL").split("-")[-1]
		prefix = f"ATT-{project}-"
		self.name = f"{prefix}{getseries(prefix, 3)}"

