# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The status names of an Expense Request and of an Expense (spec #1494). Pure: no `frappe`.

ONE home: no other module spells these strings. An Expense Request has four statuses of its own;
once it has an Expense they mirror that Expense (`integrations/controllers/expense_request_status`).
An Expense (a `Project Expenses` or `Non Project Expenses` row) has six; the three the amount rule
names stay owned by `approval_tiers`, and the two the bank import names by `outflow_import.ledgers`.
"""

from nirmaan_stack.services.approval_tiers import STATUS_APPROVED, STATUS_CEO_PENDING, STATUS_REQUESTED
from nirmaan_stack.services.outflow_import.ledgers import PAID, RECONCILIATION_PENDING

# An Expense Request.
REQUEST_PENDING = "Pending Approval"
REQUEST_APPROVED = "Approved"
REQUEST_REJECTED = "Rejected"
REQUEST_PAID = "Paid"

# An Expense.
EXPENSE_REQUESTED = STATUS_REQUESTED
EXPENSE_CEO_PENDING = STATUS_CEO_PENDING
EXPENSE_APPROVED = STATUS_APPROVED
EXPENSE_RECONCILIATION_PENDING = RECONCILIATION_PENDING
EXPENSE_PAID = PAID
EXPENSE_REJECTED = "Rejected"
