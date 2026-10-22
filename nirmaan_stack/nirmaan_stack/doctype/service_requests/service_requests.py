# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import flt, now_datetime
from frappe.model.document import Document
from frappe.model.naming import getseries

from nirmaan_stack.services.work_order_amendment import ACCEPTED, mark_snapshots, vendor_before_amendment
from nirmaan_stack.services.work_order_lifecycle import approval_record, is_approval
from nirmaan_stack.services.work_order_gst import gst_flag_for_vendor, work_order_total


class ServiceRequests(Document):
	def autoname(self):
		project_id = self.project.split("-")[-1]
		prefix = "SR-"
		self.name = f"{prefix}{project_id}-{getseries(prefix, 6)}"

	def validate(self):
		self.set_gst_from_vendor()
		self.fill_project_gst_on_approval()
		self.stamp_approval()
		self.name_amendment_outcome()

	def name_amendment_outcome(self):
		"""The save that decides an amendment (Amendment -> Approved) carries its outcome in
		`flags.amendment_outcome`: Reverted when `api/service_requests/amendment.revert_amendment` set it,
		Accepted otherwise (the approve screen, Desk, REST). `on_update` marks the snapshot with it, and the
		notification hooks may read it (#1540)."""
		old_doc = self.get_doc_before_save()
		if old_doc and old_doc.status == "Amendment" and self.status == "Approved":
			self.flags.amendment_outcome = self.flags.amendment_outcome or ACCEPTED

	def stamp_approval(self):
		"""The approving save stores who approved and when; every other save keeps what is stored,
		whatever it sends (#1532, `work_order_lifecycle.approval_record`)."""
		self.update(approval_record(
			self.get_doc_before_save(), self, user=frappe.session.user, now=now_datetime()
		))

	def set_gst_from_vendor(self):
		"""GST follows the vendor (ADR-0028 Amendment A): ON when the vendor has a GST number, OFF when
		it doesn't. Set by the save that approves the Work Order (`work_order_lifecycle.is_approval`:
		from any status but Amendment, or inserted Approved) and when an amendment that changed the
		vendor is accepted (Amendment -> Approved with a vendor other than the one before the
		amendment). An amendment that kept the vendor, or a revert back to it, leaves the flag alone:
		an old WO never changes by itself, only through Match GST to vendor.

		`flags.gst_set_from_vendor` tells the lock in `integrations/controllers/service_requests` that
		this change is the server's. `on_update` recomputes `total_amount`, so the 18% follows."""
		old_doc = self.get_doc_before_save()
		before_status = old_doc.status if old_doc else None
		if before_status == "Amendment" and self.status == "Approved":
			before = vendor_before_amendment(self.name, old_doc.vendor)
			if before is None or before == self.vendor:
				return
		elif not is_approval(before_status, self.status):
			return
		vendor_gst = frappe.db.get_value("Vendors", self.vendor, "vendor_gst") if self.vendor else None
		self.gst = gst_flag_for_vendor(vendor_gst)
		self.flags.gst_set_from_vendor = True

	def fill_project_gst_on_approval(self):
		"""The approving save (`is_approval`) fills a blank Nirmaan GST from the project, whoever approves
		(SPA, Desk, API), so Finalize and the PDF are never blocked by it. A Nirmaan GST already chosen
		is kept."""
		old_doc = self.get_doc_before_save()
		if not is_approval(old_doc.status if old_doc else None, self.status):
			return
		if (self.project_gst or "").strip() or not self.project:
			return
		self.project_gst = frappe.db.get_value("Projects", self.project, "project_gst") or self.project_gst

	def on_update(self):
		if self.flags.amendment_outcome:
			mark_snapshots(self.name, self.flags.amendment_outcome)
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
