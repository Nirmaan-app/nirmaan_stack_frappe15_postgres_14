# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class PMOTaskMaster(Document):
	def validate(self):
		if not self.is_recurring or not self.category_link:
			return
		is_handover_restricted = frappe.db.get_value(
			"PMO Task Category", self.category_link, "is_handover_restricted"
		)
		if int(is_handover_restricted or 0) == 1:
			frappe.throw(
				"Recurring tasks cannot belong to a handover-restricted category. "
				"The handover anchor recomputes the expected date on every fetch, "
				"which would overwrite the renewal-advanced date."
			)
