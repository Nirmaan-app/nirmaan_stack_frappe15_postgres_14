# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import flt
from frappe.model.document import Document
from frappe.model.naming import getseries


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
		if old_doc.gst != self.gst or (
			old_doc.status in ["Amendment", "Vendor Selected"] and self.status == "Approved"
		):
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

		total_amount = sub_total
		if self.gst and str(self.gst).lower() in ["true", "1", "yes"]:
			total_amount += sub_total * 0.18

		frappe.db.set_value("Service Requests", self.name, "total_amount", total_amount)
