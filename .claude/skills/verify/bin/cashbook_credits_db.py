"""The #1720 walk's DB read (`walk_cashbook_credits.py`): each named Txn Id's Cashbook line, the Expense its Settled
match names (with the match's `target_amount`), whether Pending Invoices Upload -> Cashbook lists that Expense, and its
Tier on the approval queue; `--expense <name>` adds whether an Expense still exists.

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_credits_db.py <txn id> [...] [--expense <name> ...]

Prints one line `JSON:{"lines": {txn: {"line", "expense", "in_cashbook_queue", "tier"}}, "exists": {...}}`. Reads
only; the queues are the endpoints themselves, as Administrator.
"""

import json
import sys

import frappe

from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue
from nirmaan_stack.api.expenses.cashbook_invoices import get_cashbook_invoice_queue

txns, expenses = [], []
argv = iter(sys.argv[1:])
for arg in argv:
    if arg == "--expense":
        expenses.append(next(argv))
    else:
        txns.append(arg)

frappe.set_user("Administrator")
queue = {(row["doctype"], row["name"]) for row in get_cashbook_invoice_queue()}

lines = {}
for txn in txns:
    line = frappe.db.get_value(
        "Outflow Import Row",
        {"transfer_id": txn},
        ["name", "import_batch", "row_status", "row_kind", "direction", "amount", "suggested_doctype"],
        as_dict=True,
        order_by="creation desc",
    )
    expense, in_queue, tier = None, False, None
    match = line and frappe.db.get_value(
        "Outflow Row Match",
        {"import_row": line.name, "match_kind": "Settled"},
        ["target_doctype", "target_name", "target_amount"],
        as_dict=True,
    )
    if match:
        fields = ["name", "amount", "type", "status", "cashbook_batch", "payment_ref", "payment_date", "description"]
        if match.target_doctype == "Project Expenses":
            fields.append("projects")
        expense = frappe.db.get_value(match.target_doctype, match.target_name, fields, as_dict=True) or {}
        expense.update(doctype=match.target_doctype, target_amount=match.target_amount)
        in_queue = (match.target_doctype, match.target_name) in queue
        rows = get_approval_queue(
            filters=[["name", "=", match.target_name], ["status", "=", "Paid"]], limit_page_length=5
        )["data"]
        tier = rows[0]["tier"] if rows else None
    lines[txn] = {"line": line, "expense": expense, "in_cashbook_queue": in_queue, "tier": tier}

exists = {
    name: bool(frappe.db.exists("Project Expenses", name) or frappe.db.exists("Non Project Expenses", name))
    for name in expenses
}
print("JSON:" + json.dumps({"lines": lines, "exists": exists}, default=str))
