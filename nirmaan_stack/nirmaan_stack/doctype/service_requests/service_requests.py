# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import flt
from frappe.model.document import Document
from frappe.model.naming import getseries

from nirmaan_stack.services.work_order_gst import work_order_total


class ServiceRequests(Document):
	def autoname(self):
		project_id = self.project.split("-")[-1]
		prefix = "SR-"
		self.name = f"{prefix}{project_id}-{getseries(prefix, 6)}"

	def on_update(self):
		old_doc = self.get_doc_before_save()
		if not old_doc:
			# Initial create — seed total_amount from `work_order_items` so
			# pre-approval list views (Approve WO etc.) show a non-zero value.
			self.calculate_total_amount()
			return
		if old_doc.gst != self.gst or (self.status == "Approved" and old_doc.status != "Approved"):
			self.calculate_total_amount()

	def calculate_total_amount(self):
		"""
		Sum line amounts from `work_order_items`, apply 18% GST when
		`gst === "true"`, and persist `total_amount` via direct DB write
		(no `doc.save()` — avoids re-entering hooks).
		"""
		sub_total = 0.0
		for row in self.work_order_items or []:
			sub_total += flt(row.quantity) * flt(row.rate)

		total_amount = work_order_total(sub_total, self.gst)

		frappe.db.set_value("Service Requests", self.name, "total_amount", total_amount)

		# `amount_due` on an SR is total_amount - amount_paid, so it moves with the write
		# above and has to be recomputed HERE, at the operand's only write site. It cannot
		# be left to a guard in the on_update controller: the write above never touches
		# `self.total_amount`, so by the time the hooked handler runs, the in-memory value
		# still equals the pre-save one and any "did it change?" comparison reads False --
		# on exactly the two saves that move it, a GST flip and the approval transition.
		from nirmaan_stack.services.amount_paid import recompute_document_amount_due
		recompute_document_amount_due("Service Requests", self.name)
