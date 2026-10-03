# Copyright (c) 2026, Nirmaan and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

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
