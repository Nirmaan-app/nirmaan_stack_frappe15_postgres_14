# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document
from frappe.utils import flt, nowdate

from nirmaan_stack.services.approval_tiers import (
	TIER_L2_ABOVE_EXPENSES,
	initial_status,
	is_auto_approved,
)

# ⚠️ THE LOCAL `AUTO_APPROVE_LIMIT = 10000` IS GONE — the rule now lives in ONE
# place, `services/approval_tiers.py`, shared with payments and mirrored in
# TypeScript by a parity test that reads the Python source:
#     < Rs 15,000        auto-approved, no human
#     15,000 - 30,000    L1 only (Admin / Accountant Lead) finishes it
#     > Rs 30,000        L1 forwards, then the CEO approves
# ⚠️ The CEO line is 30,000 HERE and 50,000 on Project Payments (owner, 15 Sep),
# so this passes `TIER_L2_ABOVE_EXPENSES` explicitly rather than taking the
# module default, which is the payments line.
# A refund (<= 0) is never auto-approved; it is banded by its SIZE like any
# other amount, which is what the old `0 < amount` guard did.


class ProjectExpenses(Document):
	def validate(self):
		# Route the expense on creation by the shared amount rule. Create-time
		# ONLY, and only while the status is still the pre-approval default, so it
		# never overrides an explicit status or re-flips a row on a later edit.
		if not self.is_new():
			return
		if self.status and self.status != "Requested":
			return

		# ⚠️ flt() FIRST. `Project Expenses.amount` is a Data / varchar column, so a
		# raw string compare would read "9000" as greater than "30000" and route a
		# Rs 9,000 expense to the CEO. The deriver coerces too, but the value is
		# normalised here so every branch below sees the same number.
		amount = flt(self.amount)
		self.status = initial_status(amount, TIER_L2_ABOVE_EXPENSES)
		if is_auto_approved(amount):
			# Stamp the approval the same way Project Payments does
			# (api/payments/project_payments.py:78-81). Without this an
			# auto-approved expense is indistinguishable from one a human
			# approved -- the audit answer is "we cannot tell" -- and the
			# dashboard's Auto Approval counters, which key on
			# `auto_approved AND approval_date`, can never see it.
			self.auto_approved = 1
			self.approval_date = nowdate()
			# Both gates are cleared BY THE RULE, so the CEO date is stamped too.
			# The L1 and CEO counters deliberately exclude auto-approved rows
			# (`approval_date and not auto_approved`), so this cannot double-count.
			self.ceo_approval_date = nowdate()
