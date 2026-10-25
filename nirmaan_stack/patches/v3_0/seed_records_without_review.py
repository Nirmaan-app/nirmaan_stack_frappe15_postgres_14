"""Seed the Records without review list (spec #1494, #1498).

Adds Accountant, Accountant Lead, HR Executive and HR Lead to `Expense Settings`, keeping any
profile already listed. Idempotent: a profile already on the list is not added again. Admin is
implicit and never stored.

A profile that does not exist, or that may raise no expense type on this site, is skipped and
named in the output: the settings `validate` refuses such a profile, and a refusal here would
stop the migrate. An Admin can tick it later on Expense Packages once it has a type.

Writes through `doc.save()`, so the settings `validate` runs and Version rows are kept.
"""

import frappe

from nirmaan_stack.api.expense_requests.access import (
	EXPENSE_SETTINGS,
	RECORDS_WITHOUT_REVIEW_FIELD,
	profile_can_raise,
)
from nirmaan_stack.services import expense_request_routing

SEED = (
	"Nirmaan Accountant Profile",
	"Nirmaan Accountant Lead Profile",
	"Nirmaan HR Executive Profile",
	"Nirmaan HR Lead Profile",
)


def execute():
	expense_request_routing.clear_cache()
	doc = frappe.get_single(EXPENSE_SETTINGS)
	listed = {row.role_profile for row in doc.get(RECORDS_WITHOUT_REVIEW_FIELD)}
	added = []
	for profile in SEED:
		if profile in listed:
			continue
		if not frappe.db.exists("Role Profile", profile) or not profile_can_raise(profile):
			print(f"seed_records_without_review: skipped {profile} (missing, or raises no expense type)")
			continue
		doc.append(RECORDS_WITHOUT_REVIEW_FIELD, {"role_profile": profile})
		added.append(profile)
	if added:
		doc.save(ignore_permissions=True)
	print(f"seed_records_without_review: added {added or 'nothing'}")
