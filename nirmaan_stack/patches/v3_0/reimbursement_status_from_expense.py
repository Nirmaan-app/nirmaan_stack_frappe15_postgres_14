# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Give each approved Reimbursement the status of its Non-Project Expense (owner, 2026-11-19).

Until now a claim stayed Approved from its first approval until its expense was Paid or Rejected. It now carries the
expense's status by the same name (`services/reimbursements/rules.CLAIM_STATUS_OF_EXPENSE`), kept in step from here on
by `expense_link.follow_expense`. This moves the claims already approved: an Approved claim whose expense is
Requested, CEO Pending or Reconciliation Pending takes that status. Everything else already matches (Approved ->
Approved, Paid -> Paid, Rejected -> Rejected) and is not touched.

⚠️ RAW SQL, ON PURPOSE, AND `modified` IS LEFT AS IT WAS (owner: "without modified update"). No hook is owed: the
claim's status is derived from its expense, nothing else is computed from it, and no screen or job reads a changed
`modified` here. No Version row is written: the status didn't change in substance, only its name for the same step.

Idempotent: a second run finds nothing to move. It prints the counts before and after, and refuses (rolling back) if
any approved claim is still out of step with its expense afterwards.
"""

import frappe

CLAIM = "tabReimbursement"
EXPENSE = "tabNon Project Expenses"
#: The expense statuses a still-Approved claim moves to; the names are the claim's new statuses.
MOVED_TO = ("Requested", "CEO Pending", "Reconciliation Pending")


def execute():
	before = _counts()
	moved = frappe.db.sql(
		f"""
		UPDATE "{CLAIM}" r
		SET status = e.status
		FROM "{EXPENSE}" e
		WHERE e.reimbursement = r.name
		  AND r.status = 'Approved'
		  AND e.status IN %(moved_to)s
		RETURNING r.name, e.status
		""",
		{"moved_to": MOVED_TO},
	)
	left = frappe.db.sql(
		f"""
		SELECT r.name, r.status, e.status
		FROM "{CLAIM}" r
		JOIN "{EXPENSE}" e ON e.reimbursement = r.name
		WHERE r.status = 'Approved' AND e.status IN %(moved_to)s
		""",
		{"moved_to": MOVED_TO},
	)
	if left:
		frappe.db.rollback()
		frappe.throw(f"Reimbursements still out of step with their expense after the move, nothing saved: {left}")
	print(f"reimbursement_status_from_expense: moved {len(moved)} claim(s): {sorted(moved)}")
	print(f"  claims by status before: {before}")
	print(f"  claims by status after:  {_counts()}")


def _counts() -> dict:
	return dict(frappe.db.sql(f'SELECT status, COUNT(*) FROM "{CLAIM}" GROUP BY status ORDER BY status'))
