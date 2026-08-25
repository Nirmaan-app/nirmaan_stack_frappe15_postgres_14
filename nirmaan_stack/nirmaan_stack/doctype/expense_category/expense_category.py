# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class ExpenseCategory(Document):
	"""Groups Expense Types for the purpose of ROUTING an expense request to a reviewer.

	This replaced a temporary Python constant (`services/expense_request_catalog.py`), which
	meant changing who reviews what was a deploy. It is master data now, so it is an edit.

	Routing ONLY. The form shape a type asks for is a separate concern and lives on the type
	itself (`Expense Type.source_format`) -- do not add form fields here.
	"""

	pass
