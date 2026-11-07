"""The Expense bills walk's DB read (#1639): each named Expense's invoice fields and its Expense bills.

    devenv.sh script <task> .claude/skills/verify/bin/expense_bills_db.py "Non Project Expenses" <name> "Project Expenses" <name>

Prints one line `EXPENSE_BILLS_DB {json}`: {name: {"expense": {...}, "bills": [...]}}, bills oldest first.
"""

import json
import sys

import frappe

args = sys.argv[1:]
answer = {}
for doctype, name in zip(args[::2], args[1::2]):
    answer[name] = {
        "expense": frappe.db.get_value(doctype, name, ["invoice_attachment", "invoice_ref", "invoice_date"], as_dict=True),
        "bills": frappe.get_all(
            "Expense Bill", filters={"expense_doctype": doctype, "expense": name}, order_by="creation asc",
            fields=["name", "bill_check", "bill_check_reason", "status", "auto_approved", "approved_by", "is_latest",
                    "statement_line", "line_amount", "read_total", "read_invoice_no", "read_invoice_date",
                    "invoice_no", "invoice_date", "invoice_amount", "uploaded_by", "bill_file", "read_claimed_at"],
        ),
    }
print("EXPENSE_BILLS_DB " + json.dumps(answer, default=str))
