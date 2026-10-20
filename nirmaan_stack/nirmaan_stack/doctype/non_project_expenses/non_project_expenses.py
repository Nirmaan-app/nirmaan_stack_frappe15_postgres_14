# Copyright (c) 2025, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from nirmaan_stack.services.expense_decision import apply_starting_status, guard_hand_save
from nirmaan_stack.services.expense_tds import guard_withheld_amount
from nirmaan_stack.services.expense_type_ledger import check_expense_type


class NonProjectExpenses(Document):
	def validate(self):
		# Once its tax is withheld, the amount is locked for every save but a bank line's few rupees
		# (#1526). First, so the refusal says why, whoever saves.
		guard_withheld_amount(self)
		# What a person may write by hand: no status (story 42), and only Accounts edit (story 50).
		guard_hand_save(self)
		# The type must belong in this ledger (#1496). On every save; it asks only when the row is
		# new or its type changed.
		check_expense_type(self)
		# A new row's status (the amount rule and the Raiser's own step) is decided in ONE place,
		# shared with Project Expenses and previewed by `convert.target_status` (#1497).
		apply_starting_status(self)
