# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Merge the misspelled Expense Types into their correct spelling (owner, 2026-11-02).

Production had both `Reimbursments` (59 Non Project Expenses, Sep 2025 - Oct 2026) and `Reimbursements`
(21, from Oct 2026), so one kind of expense was split across two types. `Software Chagres` (no expenses)
was a misspelled copy of `Software Charges`. Both typos came from `fixtures/expense_type.json`, which
re-created them on every migrate; the fixture is removed in the same change, so they do not come back.

`frappe.model.rename_doc.rename_doc(merge=True)` moves every LINK to the old name (Non Project Expenses,
Project Expenses, Expense Request, Outflow Import Expense Rule, Card Merchant Memory) onto the correct
type, then deletes the old one. The correct type's settings (who may raise it, payee rule, form) are kept.
When only the misspelled type exists, it is renamed instead.

Raw-SQL note: the link moves are SQL updates, so no expense's `doc_events` fire. Nothing derived is keyed
on these two types: each pair has the same Project / Non-Project flags, and no rule looks them up by name.

The two DATA columns that hold a type as text (`PO Adjustment Items.expense_type`,
`Outflow Import Row.suggested_expense_type`) stay as they are, the same owner ruling as
`api/expense_requests/masters.rename_expense_type` (2026-09-16).

Idempotent: a pair whose misspelled type is gone is skipped.
"""

import frappe
from frappe.model.rename_doc import rename_doc

#: (misspelled, correct)
MISSPELLED = (
	("Reimbursments", "Reimbursements"),
	("Software Chagres", "Software Charges"),
)


def merge_into(old: str, new: str) -> str | None:
	"""Move `old`'s links onto `new` and remove `old`. Returns what happened, or None when `old` is gone."""
	if not frappe.db.exists("Expense Type", old):
		return None
	merge = bool(frappe.db.exists("Expense Type", new))
	rename_doc(doctype="Expense Type", old=old, new=new, merge=merge, force=True,
	           ignore_permissions=True, show_alert=False, rebuild_search=False)
	if not merge:
		# autoname is `field:expense_name`; a rename moves the docname only.
		frappe.db.set_value("Expense Type", new, "expense_name", new, update_modified=False)
	return "merged" if merge else "renamed"


def execute():
	for old, new in MISSPELLED:
		done = merge_into(old, new)
		if done:
			print(f"Expense Type: {done} '{old}' into '{new}'")
	frappe.db.commit()
