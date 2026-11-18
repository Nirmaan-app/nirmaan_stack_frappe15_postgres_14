# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
from frappe.model.naming import getseries


def attachment_series(project: str | None) -> str:
	"""The counted series of a project's attachments, `ATT-<project's last segment>-`.

	A project-less attachment (e.g. a BoQ TEMPLATE source file -- ADR-0013 templates
	are project-less) has no project segment; fall back to "TPL". Non-template
	attachments always carry a project, so their names are byte-identical."""
	return f"ATT-{(project or 'TPL').split('-')[-1]}-"


class NirmaanAttachments(Document):
	def autoname(self) -> None:
		prefix = attachment_series(self.project)
		self.name = f"{prefix}{getseries(prefix, 3)}"

