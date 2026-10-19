# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from nirmaan_stack.services.expense_decision import apply_starting_status, refuse_hand_set_status
from nirmaan_stack.services.expense_type_ledger import check_expense_type


class ProjectExpenses(Document):
	def validate(self):
		# Only the server sets a status: a person's own save may not (spec #1494, story 42).
		refuse_hand_set_status(self)
		# The type must belong in this ledger (#1496). On every save; it asks only when the row is
		# new or its type changed.
		check_expense_type(self)
		# A new row's status (the amount rule and the Raiser's own step) is decided in ONE place,
		# shared with Non Project Expenses and previewed by `convert.target_status` (#1497).
		apply_starting_status(self)
