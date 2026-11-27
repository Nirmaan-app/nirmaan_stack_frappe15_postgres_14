# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from nirmaan_stack.services.role_profiles import can_change_cashflow_plan_link


class CashflowPlan(Document):
	def validate(self):
		self._guard_link_change()

	def _guard_link_change(self):
		"""Only Admin and PMO may move a saved entry onto another PO / WO (Edit -> Link / Change PO or WO).

		Creating an entry picks its PO / WO and is not a change. Every other edit (amount, date, vendor, the items
		of the same PO) stays open to whoever may edit it, as before.
		"""
		if self.is_new():
			return
		if not (self.has_value_changed("id_link") or self.has_value_changed("type")):
			return
		if not can_change_cashflow_plan_link(frappe.session.user):
			frappe.throw(
				_("Only Admin and PMO users can change the PO or WO of a cashflow plan."),
				frappe.PermissionError,
			)
