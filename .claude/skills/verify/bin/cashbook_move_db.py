"""The #1757 walk's DB read (`walk_cashbook_move.py`): a Cashbook line by its Txn Id, its live Settled matches, the
expense the line points at with its bills, and whether each `--expense <doctype>/<name>` still exists.

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_move_db.py <txn id> [--expense <doctype>/<name> ...]

Prints one line `JSON:{"line", "settled", "expense", "bills", "exists"}`. Reads only.
"""

import json
import sys

import frappe

txn, rest = sys.argv[1], sys.argv[2:]
line = frappe.db.get_value(
    "Outflow Import Row",
    {"transfer_id": txn},
    ["name", "import_batch", "row_status", "suggested_doctype", "suggested_name", "resolved_project",
     "suggested_expense_type"],
    as_dict=True,
)
settled = frappe.get_all(
    "Outflow Row Match",
    filters={"transfer_id": txn, "match_kind": "Settled"},
    fields=["import_row", "target_doctype", "target_name", "target_amount", "source", "created_by_import"],
)
expense, expense_bills = None, []
if line and line.suggested_name and frappe.db.exists(line.suggested_doctype, line.suggested_name):
    fields = ["name", "amount", "payment_date", "payment_ref", "type", "status", "cashbook_batch", "invoice_attachment"]
    if line.suggested_doctype == "Project Expenses":
        fields += ["projects", "payment_by"]
    expense = frappe.db.get_value(line.suggested_doctype, line.suggested_name, fields, as_dict=True)
    expense["doctype"] = line.suggested_doctype
    expense_bills = frappe.get_all(
        "Expense Bill",
        filters={"expense_doctype": line.suggested_doctype, "expense": line.suggested_name},
        fields=["name", "is_latest", "bill_check", "bill_check_reason", "status", "bill_file", "statement_line"],
    )
exists = {}
for i, arg in enumerate(rest):
    if arg == "--expense":
        doctype, name = rest[i + 1].split("/", 1)
        exists[rest[i + 1]] = bool(frappe.db.exists(doctype, name))
print("JSON:" + json.dumps({"line": line, "settled": settled, "expense": expense, "bills": expense_bills,
                            "exists": exists}, default=str))
