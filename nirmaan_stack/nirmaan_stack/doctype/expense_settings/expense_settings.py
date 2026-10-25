# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Expense Settings: the Records without review list (spec #1494, #1498).

Not a fixture, so an Admin's edits survive migrate. Edited through
`api/expense_requests/expense_settings.set_records_without_review`.
"""

import frappe
from frappe.model.document import Document

from nirmaan_stack.api.expense_requests.access import ADMIN_PROFILE, profile_can_raise


class ExpenseSettings(Document):
	def validate(self):
		"""Refuse the Admin profile (always on the list, never stored), a repeat, and a profile
		that may raise no expense type (ticking it would do nothing)."""
		seen = set()
		for row in self.records_without_review:
			profile = row.role_profile
			if profile == ADMIN_PROFILE:
				frappe.throw(
					f"{ADMIN_PROFILE} always records without review. Leave it out.",
					title="Admin is implicit",
				)
			if profile in seen:
				frappe.throw(f"{profile} is listed twice.", title="Listed twice")
			seen.add(profile)
			if not profile_can_raise(profile):
				frappe.throw(
					f"{profile} cannot raise any expense type, so it cannot record without review.",
					title="Profile raises no expense type",
				)
