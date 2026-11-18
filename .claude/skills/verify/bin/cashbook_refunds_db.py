"""The #1711 Cashbook walk's DB read (`walk_cashbook_refunds.py`): each named Txn Id's Cashbook line, the Expense its
Settled match names (with the match's `target_amount`), and whether Pending Invoices Upload -> Cashbook lists that
Expense; `--expense <name>` adds whether an Expense still exists; `--batch <name>` adds an import's left-out count.

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_refunds_db.py <txn id> [...] [--expense <name> ...] \
        [--batch <name>]

Prints one line `JSON:{"lines": {txn: {"line", "expense", "in_cashbook_queue"}}, "exists": {...}, "batch": {...}}`.
Reads only; the queue is the endpoint itself, as Administrator.
"""

import json
import sys

import frappe

from nirmaan_stack.api.expenses.cashbook_invoices import get_cashbook_invoice_queue

args, expenses, batch = [], [], None
argv = iter(sys.argv[1:])
for arg in argv:
    if arg == "--expense":
        expenses.append(next(argv))
    elif arg == "--batch":
        batch = next(argv)
    else:
        args.append(arg)

who = frappe.session.user
frappe.set_user("Administrator")
queue = {(row["doctype"], row["name"]) for row in get_cashbook_invoice_queue()}
frappe.set_user(who)

lines = {}
for txn in args:
    line = frappe.db.get_value(
        "Outflow Import Row",
        {"transfer_id": txn},
        ["name", "import_batch", "row_status", "row_kind", "skip_kind", "outcome_note", "direction", "amount"],
        as_dict=True,
        order_by="creation desc",
    )
    expense, in_queue = None, False
    if line:
        match = frappe.db.get_value(
            "Outflow Row Match",
            {"import_row": line.name, "match_kind": "Settled"},
            ["target_doctype", "target_name", "target_amount"],
            as_dict=True,
        )
        if match:
            fields = ["name", "amount", "type", "status", "cashbook_batch", "payment_ref", "payment_date",
                      "description", "invoice_attachment"]
            if match.target_doctype == "Project Expenses":
                fields.append("projects")
            expense = frappe.db.get_value(match.target_doctype, match.target_name, fields, as_dict=True) or {}
            expense.update(doctype=match.target_doctype, target_amount=match.target_amount)
            in_queue = (match.target_doctype, match.target_name) in queue
    lines[txn] = {"line": line, "expense": expense, "in_cashbook_queue": in_queue}

exists = {
    name: bool(frappe.db.exists("Project Expenses", name) or frappe.db.exists("Non Project Expenses", name))
    for name in expenses
}
answer = {"lines": lines, "exists": exists}
if batch:
    answer["batch"] = frappe.db.get_value(
        "Outflow Import Batch", batch, ["name", "original_filename", "lines_before_cutoff"], as_dict=True
    )
print("JSON:" + json.dumps(answer, default=str))
