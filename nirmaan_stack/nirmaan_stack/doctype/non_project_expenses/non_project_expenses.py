# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document
from frappe.utils import flt

# Positive expenses strictly below this amount skip the Requested step and are
# created directly as Approved.
AUTO_APPROVE_LIMIT = 5000


class NonProjectExpenses(Document):
	def validate(self):
		# Auto-approve small positive expenses on creation: a positive amount
		# below AUTO_APPROVE_LIMIT is created as Approved, skipping Requested.
		# A refund (negative), zero, or an amount >= the limit follows the normal
		# Requested -> Approved -> Paid workflow. Create-time only, and only while
		# the status is still the pre-approval default, so it never overrides an
		# explicit status or re-flips a row on a later edit.
		if not self.is_new():
			return
		if self.status and self.status != "Requested":
			return
		if 0 < flt(self.amount) < AUTO_APPROVE_LIMIT:
			self.status = "Approved"
