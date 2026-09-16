# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class ExpenseTypeRole(Document):
	"""One role profile allowed to SEE an Expense Type in the request dialog.

	Child of `Expense Type.allowed_roles`. Nirmaan Admin Profile is never listed -- an admin
	sees every type -- so an EMPTY table means the type is Admin-only. Read through
	`api/expense_requests/access.can_request_type`.
	"""

	pass
