# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from nirmaan_stack.services.expense_decision import apply_starting_status


class NonProjectExpenses(Document):
	def validate(self):
		# A new row's status (the amount rule and the Raiser's own step) is decided in ONE place,
		# shared with Project Expenses and previewed by `convert.target_status`.
		apply_starting_status(self)
