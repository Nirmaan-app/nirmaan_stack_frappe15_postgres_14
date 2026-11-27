# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from nirmaan_stack.services.role_profiles import can_change_material_plan_po


class MaterialDeliveryPlan(Document):
	def validate(self):
		self._guard_po_change()

	def _guard_po_change(self):
		"""Only Admin and PMO may move a saved plan onto another PO (Edit -> Link PO / Change PO).

		Creating a plan picks its PO and is not a change. Everything else on a saved plan (date, status,
		remarks, the items of the same PO) stays open to whoever may edit it, as before.
		"""
		if self.is_new():
			return
		if not (self.has_value_changed("po_link") or self.has_value_changed("po_type")):
			return
		if not can_change_material_plan_po(frappe.session.user):
			frappe.throw(
				_("Only Admin and PMO users can change the PO of a material plan."),
				frappe.PermissionError,
			)
