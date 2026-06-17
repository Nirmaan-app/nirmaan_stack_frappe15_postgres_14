# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import flt
from frappe.model.document import Document


class POAdjustments(Document):
	def recalculate_remaining_impact(self):
		"""Recalculate remaining_impact from child items and update status.

		'Done' here is a DISPLAY tolerance only: |remaining_impact| < ₹100 reads as
		settled. It does NOT mean the credit is gone — any negative remaining_impact
		is still usable and is consumed by the next revision increase / transfer,
		which read the *number* (remaining_impact), not this status. See
		`_auto_add_payment_term` (revision increase) and `execute_adjustment` (transfer).
		"""
		total = sum(flt(item.amount) for item in self.adjustment_items)
		self.remaining_impact = flt(total, 2)
		if abs(self.remaining_impact) < 100:
			self.status = "Done"
		else:
			self.status = "Pending"
		self.save(ignore_permissions=True)
