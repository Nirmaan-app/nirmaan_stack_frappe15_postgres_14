"""The Collect payment walk's DB read (#1642): each named line's kept Bill check, the Expense Create made from it (if
any) and that Expense's Expense bills.

    devenv.sh script <task> .claude/skills/verify/bin/collect_bills_db.py <line> [<line> ...]

Prints one line `COLLECT_BILLS_DB {json}`: {line: {"line": {...}, "expense": {...} | null, "bills": [...],
"bills_against_line": n}}.
"""

import json
import sys

import frappe

answer = {}
for name in sys.argv[1:]:
    line = frappe.db.get_value(
        "Outflow Import Row", name,
        ["name", "row_status", "stored_bill", "bill_check", "bill_check_reason", "read_total", "read_invoice_no",
         "read_claimed_at", "decided_by"],
        as_dict=True,
    )
    match = frappe.db.get_value(
        "Outflow Row Match", {"import_row": name, "match_kind": "Settled"}, ["target_doctype", "target_name"],
        as_dict=True,
    )
    expense, bills = None, []
    if match:
        expense = frappe.db.get_value(
            match.target_doctype, match.target_name, ["name", "invoice_attachment", "invoice_ref", "invoice_date"],
            as_dict=True,
        )
        bills = frappe.get_all(
            "Expense Bill", filters={"expense_doctype": match.target_doctype, "expense": match.target_name},
            order_by="creation asc",
            fields=["name", "bill_check", "bill_check_reason", "status", "auto_approved", "approved_by",
                    "statement_line", "line_amount", "read_total", "read_invoice_no", "invoice_amount", "bill_file",
                    "uploaded_by", "read_claimed_at"],
        )
    answer[name] = {
        "line": line,
        "expense": expense,
        "bills": bills,
        "bills_against_line": frappe.db.count("Expense Bill", {"statement_line": name}),
    }
print("COLLECT_BILLS_DB " + json.dumps(answer, default=str))
