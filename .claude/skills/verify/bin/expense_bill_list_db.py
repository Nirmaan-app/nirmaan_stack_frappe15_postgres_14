"""Read each listed spend's Expense bills for the Bill check column walk (`walk_expense_bills.py --part bill-check`).

    devenv.sh script <task> .claude/skills/verify/bin/expense_bill_list_db.py <doctype>:<expense> [...]

Prints one line `EXPENSE_BILL_LIST_DB {json}`: {expense: [its bills, latest first]}. Read-only.
"""

import json
import sys

import frappe

answer = {}
for arg in sys.argv[1:]:
    doctype, expense = arg.split(":", 1)
    answer[expense] = frappe.get_all(
        "Expense Bill", filters={"expense_doctype": doctype, "expense": expense},
        fields=["name", "is_latest", "bill_check", "bill_check_reason", "read_claimed_at", "status", "auto_approved"],
        order_by="is_latest desc, creation desc",
    )
print("EXPENSE_BILL_LIST_DB " + json.dumps(answer, default=str))
