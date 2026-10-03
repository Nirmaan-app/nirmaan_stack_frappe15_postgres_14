# Copyright (c) 2026, Nirmaan and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate


class ProjectBillingTracker(Document):
	def validate(self):
		# A person picked twice for one package keeps one row.
		seen = set()
		for row in list(self.billing_managers):
			if row.manager in seen:
				self.remove(row)
			seen.add(row.manager)

		for row in self.dc_log:
			if not row.entered_by:
				row.entered_by = frappe.session.user

		# Recomputed from every log row on each save, never incremented.
		self.supply_dc = sum(flt(row.amount) for row in self.dc_log)
		if self.supply_dc < 0:
			frappe.throw(_("Supply DC for {0} cannot go below zero.").format(self.package))

		# Saved rows load their date as a date, a newly appended one is still a
		# string; normalise before comparing.
		dates = [getdate(row.dc_date) for row in self.dc_log if row.dc_date]
		self.dc_updated_on = max(dates) if dates else None
