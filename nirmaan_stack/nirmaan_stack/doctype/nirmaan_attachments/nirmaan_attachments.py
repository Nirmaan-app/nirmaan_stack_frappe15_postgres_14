# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class NirmaanAttachments(Document):
	# Named by `hash` in the doctype (ADR 0048, #1719): a background operation (the BoQ upload) and many web
	# requests write these, and no reader orders, parses or shows the name. Older rows keep `ATT-<project>-NNN`.
	pass
