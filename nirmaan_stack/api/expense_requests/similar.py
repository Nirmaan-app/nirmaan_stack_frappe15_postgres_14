# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What is already on record that resembles this request.

URL: /api/method/nirmaan_stack.api.expense_requests.similar.get_similar

READ-ONLY, AND NOTHING HERE REFUSES ANYTHING (owner ruling, 2026-08-20). The REVIEW dialog
asks it for the approver: same type + amount + project inside a window, over BOTH expense
doctypes -- phrased as a prompt, because it cannot tell August rent from September.

⚠️ NO PER-TYPE DUPLICATE RULES (owner ruling, 2026-09-19). The strong tier -- a table of
expense types naming each one's subject and period fields, matched on overlapping dates --
was REMOVED with its create-dialog warning. It keyed on the type's NAME, so it blocked
renaming those types, and the owner did not want static rules. Do not reintroduce a
name-keyed table here.
"""

import frappe
from frappe.utils import add_days, flt, nowdate

from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES

# How far back the check looks. A month plus slack, so a monthly expense shows its
# neighbours without dragging in a year of history.
NEARBY_DAYS = 60


@frappe.whitelist()
def get_similar(name: str) -> dict:
	"""Everything already on record that resembles this request. Writes nothing."""
	req = frappe.get_doc("Expense Request", name)
	return {"nearby": _scan_ledgers(req)}


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
