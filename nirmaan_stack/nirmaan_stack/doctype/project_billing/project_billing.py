# Copyright (c) 2026, Nirmaan and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate

from nirmaan_stack.services.project_billing.rules import SUBMITTED_OR_LATER


class ProjectBilling(Document):
	def validate(self):
		# Project and package always come from the tracker, so a bill can never
		# disagree with the package it belongs to.
		self.project, self.package = frappe.db.get_value(
			"Project Billing Tracker", self.billing_tracker, ["project", "package"]
		) or (None, None)

		# Stamped once; later status changes never move it.
		if not self.first_submission_date and self.status in SUBMITTED_OR_LATER:
			self.first_submission_date = frappe.utils.today()

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
