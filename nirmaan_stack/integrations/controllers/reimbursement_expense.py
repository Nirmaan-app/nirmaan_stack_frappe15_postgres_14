# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""`Non Project Expenses` hooks for an expense created from a Reimbursement (ADR-0040).

Each exits on its first check for every other expense (no `reimbursement` link). The rules are in
`services/reimbursements/expense_link.py`.
"""

from nirmaan_stack.services.reimbursements import expense_link


def validate(doc, method=None) -> None:
	"""The `reimbursement` link is set only by the approval step and never changes; a reimbursement's Rejected
	expense can't be moved to any other status."""
	expense_link.guard_link(doc)
	expense_link.refuse_revival(doc)


def on_update(doc, method=None) -> None:
	"""Paid / Rejected / an undone bank match on the expense moves its claim."""
	expense_link.follow_expense(doc)


def on_trash(doc, method=None) -> None:
	"""The claimant can't delete their own claim's expense unless it is Rejected."""
	expense_link.refuse_claimant_delete(doc)


def after_delete(doc, method=None) -> None:
	"""A deleted expense, in any status, takes its claim and receipts with it (as a request's does)."""
	expense_link.delete_with_expense(doc)
