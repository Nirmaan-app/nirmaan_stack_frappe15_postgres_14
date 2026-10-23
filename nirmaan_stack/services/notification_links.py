# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Clear the bell messages that point at a record, so the record itself can be deleted.

⚠️ THIS IS NOT TIDINESS -- IT IS WHAT MAKES THE DELETE POSSIBLE. `Nirmaan Notifications` addresses its subject
through `document` + `docname`, and `docname` is a **Dynamic Link**. Frappe's delete guard walks dynamic links as
well as ordinary ones, so a record carrying any notification would raise `LinkExistsError` and take its delete
down with it.

`ignore_links=True` would also get past the guard and is the WRONG fix: it leaves bell entries pointing at a record
that no longer exists, and their recipient can still click them.

Raw `frappe.db.delete` rather than per-row `delete_doc`: a notification is an ephemeral UI record, so N document
loads to bank N `Deleted Document` rows buys nothing.

One home for the rule (code review, 2026-10-23), used by an Expense Request deleted with its expense
(`expense_request_status`) and a Reimbursement deleted with its expense (`reimbursements.expense_link`).
"""

import frappe


def delete_notifications_for(doctype: str, name: str) -> None:
	"""Delete every bell message addressed to `doctype` / `name`. Rides the caller's transaction."""
	frappe.db.delete("Nirmaan Notifications", {"document": doctype, "docname": name})
