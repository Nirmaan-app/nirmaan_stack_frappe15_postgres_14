# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read and change the Records without review list (spec #1494, #1498), Admin only.

URLs:
  /api/method/nirmaan_stack.api.expense_requests.expense_settings.get_records_without_review
  /api/method/nirmaan_stack.api.expense_requests.expense_settings.set_records_without_review

The list lives on the single `Expense Settings`; its `validate` refuses the Admin profile and a
profile that can raise no type. Who is on it at request time: `access.records_without_review`.
"""

import json

import frappe

from nirmaan_stack.api.expense_requests.access import (
	ADMIN_PROFILE,
	EXPENSE_SETTINGS,
	RECORDS_WITHOUT_REVIEW_FIELD,
	is_admin,
	listed_records_without_review,
	profile_can_raise,
)


def _require_admin() -> None:
	if not is_admin():
		frappe.throw(
			"Only an admin may see or change who records without review.",
			frappe.PermissionError,
			title="Admin only",
		)


@frappe.whitelist()
def get_records_without_review():
	"""What the Expense Packages section shows.

	`role_profiles`: the profiles it offers as checkboxes, those that can raise at least one type
	(Admin left out: always on the list). `records_without_review`: the ticked ones. A listed
	profile that has since lost all its types is left out of both, so it drops off the list.
	"""
	_require_admin()
	eligible = [
		p for p in frappe.get_all("Role Profile", pluck="name", order_by="name asc")
		if p != ADMIN_PROFILE and profile_can_raise(p)
	]
	listed = set(listed_records_without_review())
	return {
		"role_profiles": eligible,
		"records_without_review": [p for p in eligible if p in listed],
	}


@frappe.whitelist(methods=["POST"])
def set_records_without_review(role_profiles):
	"""Replace the list with `role_profiles` (a list, or its JSON string). Returns the new state."""
	_require_admin()
	if isinstance(role_profiles, str):
		try:
			role_profiles = json.loads(role_profiles or "[]")
		except ValueError:
			frappe.throw("Role profiles must be a list.", title="Invalid list")
	if not isinstance(role_profiles, (list, tuple)):
		frappe.throw("Role profiles must be a list.", title="Invalid list")

	doc = frappe.get_single(EXPENSE_SETTINGS)
	doc.set(RECORDS_WITHOUT_REVIEW_FIELD, [
		{"role_profile": (p or "").strip()} for p in role_profiles if (p or "").strip()
	])
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return get_records_without_review()
