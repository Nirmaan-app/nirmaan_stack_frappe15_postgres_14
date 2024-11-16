# Copyright (c) 2024, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

class QuotationNotExistError(frappe.ValidationError):
	pass

class ProjectEstimates(Document):
	def before_insert(self):
		if not self.rate_estimate:
			approved_quotations = frappe.db.get_list('Approved Quotations',
											filters={'item_id': self.item},
            								fields=['quote']
											)
			if len(approved_quotations) > 0:
				quotes = [item['quote'] for item in approved_quotations]
				self.rate_estimate = min(quotes)
			else:
				frappe.throw(_("No quotes found."), exc=QuotationNotExistError)
