# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from nirmaan_stack.api.expense_requests.access import prune_records_without_review
from nirmaan_stack.services import expense_request_routing
from nirmaan_stack.services.expense_decision import is_l1


def _role_profiles(doc) -> list[str]:
	return sorted(row.role_profile for row in doc.get("allowed_roles") or [])


class ExpenseType(Document):
	def validate(self):
		self._validate_form_switch()
		self._validate_allowed_roles()
		self._validate_confirmed_marker()

	def on_update(self):
		"""A profile a save takes off its last type leaves Records without review (story 28), by
		every path: Expense Packages (`masters.update_expense_type`), Desk, REST, a fixture sync."""
		before = self.get_doc_before_save()
		if before is not None and _role_profiles(before) != _role_profiles(self):
			self._prune_records_without_review()

	def after_delete(self):
		self._prune_records_without_review()

	def _prune_records_without_review(self):
		expense_request_routing.clear_cache()
		prune_records_without_review()

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

	def _validate_confirmed_marker(self):
		"""The "Confirmed as Expense Request" mark is a label only, and only Admin may change it (owner,
		2026-10-20). Checked here, not only in `masters.update_expense_type`, because ~15 roles may
		save an Expense Type through Desk or REST. A migrate re-imports the fixture as Administrator."""
		changed = self.confirmed_as_request if self.is_new() else self.has_value_changed(
			"confirmed_as_request")
		if changed and not is_l1(frappe.session.user):
			frappe.throw(
				"Only an admin may change \"Confirmed as Expense Request\".",
				frappe.PermissionError,
				title="Admin only",
			)
