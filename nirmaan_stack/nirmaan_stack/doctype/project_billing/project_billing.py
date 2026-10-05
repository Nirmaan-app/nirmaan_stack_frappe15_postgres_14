# Copyright (c) 2026, Nirmaan and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate

from nirmaan_stack.services.project_billing.rules import first_submission_date, missing_bill_fields


class ProjectBilling(Document):
	def validate(self):
		# Project and package always come from the tracker, so a bill can never
		# disagree with the package it belongs to.
		self.project, self.package = frappe.db.get_value(
			"Project Billing Tracker", self.billing_tracker, ["project", "package"]
		) or (None, None)

		# Stamped only by Submitted, once; later status changes never move it (owner, 2026-10-05).
		self.first_submission_date = first_submission_date(
			self.first_submission_date, self.status, frappe.utils.today()
		)

		# Money is never negative (owner, 2026-10-05). An empty field is stored as 0, so 0 means
		# "not entered" here; the drawer itself asks for more than 0 once a box is filled in.
		for field, label in (("bill_value", _("Bill value")), ("payment_received", _("Payment received"))):
			if flt(self.get(field)) < 0:
				frappe.throw(_("{0} cannot be negative.").format(label))

		# What a bill must carry for its status (owner, 2026-10-05); the drawer shows the same list.
		missing = missing_bill_fields(
			self.status,
			self.bill_type,
			self.bill_value,
			self.eta_date,
			bool(self.get("bill_document_link") or self.get("bill_attachment")),
			self.payment_received,
		)
		if missing:
			frappe.throw(_("Fill in before saving: {0}.").format(", ".join(missing)))

		# The bill document is a link OR an attachment, never both (owner, 2026-10-03).
		if self.get("bill_document_link") and self.get("bill_attachment"):
			frappe.throw(_("Add the bill document as a link or an attachment, not both."))

		# ETA and approval dates are today or later whenever they are set or changed
		# (owner, 2026-10-03); a date saved earlier stays until someone changes it.
		# Compared as dates: the saved value loads as a date, a sent one is a string.
		before = self.get_doc_before_save()
		today = getdate()
		for field, label in (("eta_date", _("ETA date")), ("approval_date", _("Approval date"))):
			value = getdate(self.get(field)) if self.get(field) else None
			old = getdate(before.get(field)) if before and before.get(field) else None
			if value and value != old and value < today:
				frappe.throw(_("{0} cannot be before today.").format(label))
