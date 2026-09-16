# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ExpenseType(Document):
	def validate(self):
		self._validate_form_switch()

	def _validate_form_switch(self):
		"""`source_format_enabled` needs a format to switch ON -- otherwise the dialog would
		promise a form and then show the plain fields anyway."""
		if self.source_format_enabled and not (self.source_format or "").strip():
			frappe.throw(
				f"'{self.name or self.expense_name}' has no request form yet. "
				"Write the format before switching it on.",
				title="No request form",
			)
