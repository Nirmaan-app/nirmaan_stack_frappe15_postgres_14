# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ExpenseType(Document):
	def validate(self):
		self._validate_form_switch()
		self._validate_allowed_roles()

	def _validate_form_switch(self):
		"""`source_format_enabled` needs a format to switch ON -- otherwise the dialog would
		promise a form and then show the plain fields anyway."""
		if self.source_format_enabled and not (self.source_format or "").strip():
			frappe.throw(
				f"'{self.name or self.expense_name}' has no request form yet. "
				"Write the format before switching it on.",
				title="No request form",
			)

	def _validate_allowed_roles(self):
		# Listing the Admin profile is harmless (an admin sees every type regardless); the app
		# refuses it in `api/expense_requests/masters._normalise_roles`, which takes the name
		# from `access.ADMIN_PROFILE` rather than a second copy here.
		seen = set()
		for row in self.get("allowed_roles") or []:
			if row.role_profile in seen:
				frappe.throw(
					f"{row.role_profile} is listed twice.", title="Duplicate role profile"
				)
			seen.add(row.role_profile)
