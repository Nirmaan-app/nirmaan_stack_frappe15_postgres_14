# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""An invoice drafted for a GST-off Work Order's vendor to sign (#1546; GLOSSARY *Generated invoice*).

Made only by Generate (`api/service_requests/generated_invoices.generate_invoice`, which assigns the
RA number under a lock), changed only by the moves in `services/wo_generated_invoices.MOVES`, deleted
only in the app (a Voided one by Admin, or any one with its Vendor Invoice), which frees its RA number
(ADR-0040 Amdt B). Desk, the REST API and Administrator obey this too.
The insert and delete guards are in `integrations/controllers/wo_generated_invoice`.
"""

import frappe
from frappe.model.document import Document

from nirmaan_stack.services.wo_generated_invoices import change_problem


class WOGeneratedInvoice(Document):
	def validate(self):
		before = self.get_doc_before_save()
		if before is None:
			return
		problem = change_problem(before.as_dict(), self.as_dict())
		if problem:
			frappe.throw(problem)
