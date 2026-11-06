# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

#: An Internal Transfer record always matches its line (spec #1619 story 40). A wrong one is undone by sending
#: its line back to Mismatched, which deletes it.
NEVER_EDITED = (
	"An Internal Transfer record is never edited. If it is wrong, send its line back to Mismatched from "
	"Bulk Import, then mark it again."
)


class InternalTransfer(Document):
	def validate(self):
		if not self.is_new():
			frappe.throw(NEVER_EDITED, title="Never edited")
