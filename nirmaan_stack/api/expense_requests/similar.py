# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What is already on record that resembles this request.

URL: /api/method/nirmaan_stack.api.expense_requests.similar.get_similar

READ-ONLY, AND NOTHING HERE REFUSES ANYTHING (owner ruling, 2026-08-20). The REVIEW dialog
asks it for the approver, two things:
  nearby  same type + amount + project inside a window, over BOTH expense doctypes -- phrased
          as a prompt, because it cannot tell August rent from September;
  stays   every other request or Expense for the same person's overlapping stay
          (`duplicates.find_stay_duplicates`, #1504), shown in bold.

⚠️ NO NAME-KEYED DUPLICATE RULES (owner ruling, 2026-09-19). The stay rule is keyed on the
form's `templateId`, so renaming a type cannot switch it off. Do not reintroduce a table keyed
on the type's name.
"""

import frappe
from frappe.utils import add_days, flt, nowdate

from nirmaan_stack.api.expense_requests.duplicates import find_stay_duplicates
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES

# How far back the check looks. A month plus slack, so a monthly expense shows its
# neighbours without dragging in a year of history.
NEARBY_DAYS = 60


@frappe.whitelist()
def get_similar(name: str) -> dict:
	"""Everything already on record that resembles this request. Writes nothing."""
	req = frappe.get_doc("Expense Request", name)
	# The stay matches name other people's requests, so only a caller who may read this one asks.
	req.check_permission("read")
	return {
		"nearby": _scan_ledgers(req),
		"stays": find_stay_duplicates(req.source_data, exclude=req.name),
	}


def _scan_ledgers(req) -> list:
	"""Same type and amount inside the window, over BOTH expense doctypes.

	⚠️ BOTH, even though a type's scope flags say only one is reachable. That is true of the
	REQUEST path and false of the data: `Travel Expenses (Bus)` and `(Train)` are flagged
	non-project-only and rows for them sit in `Project Expenses`, because direct entry never
	enforced the flags. Searching one ledger would miss exactly those.

	`Project Payments` is deliberately NOT searched -- it is born from a PO or SR, and an
	expense request can never create one.

	`amount` is compared through `flt` because the two doctypes store it differently: a Data
	column of numeric strings on one side, a real Currency on the other.
	"""
	since = add_days(nowdate(), -NEARBY_DAYS)
	target = flt(req.amount)
	out = []
	for doctype in EXPENSE_DOCTYPES:
		filters = {"type": req.type, "creation": [">", since]}
		if doctype == "Project Expenses" and req.projects:
			filters["projects"] = req.projects
		for row in frappe.get_all(
			doctype,
			filters=filters,
			fields=["name", "amount", "status", "description", "creation", "request_id"],
			order_by="creation desc",
			limit_page_length=0,
		):
			if row.get("request_id") == req.name:
				continue  # this request's own ledger row is not a duplicate of itself
			if flt(row["amount"]) != target:
				continue
			out.append({
				"doctype": doctype,
				"name": row["name"],
				"amount": flt(row["amount"]),
				"status": row["status"],
				"description": (row["description"] or "")[:120],
				"on": str(row["creation"])[:10],
				"from_request": row.get("request_id") or None,
			})
	return out
