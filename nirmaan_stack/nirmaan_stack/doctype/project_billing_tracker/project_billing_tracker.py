# Copyright (c) 2026, Nirmaan and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate

from nirmaan_stack.services.project_billing.rules import format_inr, raises_over_po


class ProjectBillingTracker(Document):
	def validate(self):
		# A package's PO value is greater than 0 (owner, 2026-10-05). Checked when it is set or
		# changed, so a package saved earlier without one can still be edited (but not log
		# Supply DC, below).
		if (self.is_new() or self.has_value_changed("po_value")) and flt(self.po_value) <= 0:
			frappe.throw(_("Enter a PO value greater than 0 for {0}.").format(self.package))

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

		# No PO value, no Supply DC (owner, 2026-10-05): a delivered amount needs a PO value to be
		# measured against. A ₹0 "no delivery today" row needs none, so it is still allowed.
		before = self.get_doc_before_save()
		saved_rows = {row.name for row in before.dc_log} if before else set()
		if flt(self.po_value) <= 0 and any(
			row.name not in saved_rows and flt(row.amount) != 0 for row in self.dc_log
		):
			frappe.throw(_("Set a PO value for {0} before logging Supply DC.").format(self.package))

		# Supply DC may not go above the package's PO value (owner, 2026-10-05). Only an increase
		# is refused, so a package already over can still be corrected down or saved unchanged.
		if raises_over_po(self.po_value, before.supply_dc if before else 0, self.supply_dc):
			frappe.throw(
				_("Supply DC for {0} would be {1}, more than its PO value of {2}.").format(
					self.package, format_inr(self.supply_dc), format_inr(self.po_value)
				)
			)

		# Saved rows load their date as a date, a newly appended one is still a
		# string; normalise before comparing.
		dates = [getdate(row.dc_date) for row in self.dc_log if row.dc_date]
		self.dc_updated_on = max(dates) if dates else None
