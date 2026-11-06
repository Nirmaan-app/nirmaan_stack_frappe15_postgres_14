# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bring Office Rent's version-3 form to an existing site (spec #1613, story 4; owner, 2026-11-06).

Since spec #1613 an Office Rent amount is the landlord's bill incl. 18% GST, and the form's sentence says so
(`templateVersion` 3 in `services/expense_types_seed.json`). The seed only inserts types a site lacks, so a
site that already had Office Rent kept the version-2 form, whose "(10% TDS will be deducted)" reads the
amount as the base rent.

This sets the version-3 form only where the live form is still, as JSON, exactly the version-2 one the seed
shipped. Any other form is left alone: one already at version 3, one an Admin edited in Expense Packages
(its sentence, its questions, or cleared), and a site without Office Rent. So a second run changes nothing.

Requests already raised keep their own form: each carries a frozen snapshot of the form it was filled
against (`api/expense_requests/form_snapshot`), so their sentence does not change.

Raw-write note: `frappe.db.set_value` fires no `doc_events`, as Expense Packages' own form save
(`masters.save_expense_format`) does not; nothing is derived from an Expense Type's form.
"""

import json

import frappe

OFFICE_RENT = "Office Rent"

#: The form the seed shipped before spec #1613.
V2_FORM = {
	"templateId": "office-rent",
	"templateVersion": 2,
	"title": "Office Rent",
	"description_template": "Office rent for {rent_month} – {office_location}. Landlord: {landlord_name} "
	                        "(PAN {landlord_pan}). (10% TDS will be deducted)",
	"sections": [{
		"id": "detail", "type": "fields", "title": "Rent", "layout": "grid", "columns": 2,
		"fields": [
			{"key": "rent_month", "label": "Rent Month", "type": "month", "required": True},
			{"key": "office_location", "label": "Office Location", "type": "text", "required": True},
			{"key": "landlord_name", "label": "Landlord Name", "type": "text", "required": True},
			{"key": "landlord_pan", "label": "Landlord PAN", "type": "pan", "required": True},
		],
	}],
}

#: The form the seed ships since spec #1613: the same questions, version 3 and the GST sentence.
V3_FORM = {
	**V2_FORM,
	"templateVersion": 3,
	"description_template": "Office rent for {rent_month} – {office_location}. Landlord: {landlord_name} "
	                        "(PAN {landlord_pan}). (Amount incl. 18% GST; 10% TDS on the rent will be deducted)",
}


def _is_v2(source_format: str | None) -> bool:
	try:
		return json.loads(source_format or "") == V2_FORM
	except ValueError:
		return False


def execute():
	live = frappe.db.get_value("Expense Type", OFFICE_RENT, "source_format")
	if not _is_v2(live):
		return
	frappe.db.set_value("Expense Type", OFFICE_RENT, "source_format",
	                    json.dumps(V3_FORM, indent=2, ensure_ascii=False))
	print("Expense Type: Office Rent's form is now version 3 (amount incl. 18% GST)")
