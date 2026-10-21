# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An invoice drafted for a GST-off Work Order's vendor to sign (#1546; GLOSSARY *Generated invoice*).

Made only by Generate (`api/service_requests/generated_invoices.generate_invoice`, which assigns the
RA number under a lock), changed only by the moves in `services/wo_generated_invoices.MOVES`, never
deleted: a deleted record would free its RA number. Desk, the REST API and Administrator obey this too.
"""

import frappe
from frappe import _
from frappe.model.document import Document

from nirmaan_stack.services.wo_generated_invoices import change_problem


class WOGeneratedInvoice(Document):
	def before_insert(self):
		if not self.flags.made_by_generate:
			frappe.throw(_("A generated invoice is made only by Generate invoice on its Work Order."))

	def validate(self):
		before = self.get_doc_before_save()
		if before is None:
			return
		problem = change_problem(before.as_dict(), self.as_dict())
		if problem:
			frappe.throw(problem)

	def on_trash(self):
		frappe.throw(_("A generated invoice is never deleted. Void it instead, so its RA number is not reused."))
