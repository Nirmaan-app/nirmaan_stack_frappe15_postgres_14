"""The DB side of `walk_card_move.py` (#1761): a card line, its live Settled matches, the expense they name, its bills,
and its row in the Credit Card invoice queue as the queue endpoint returns it.

    devenv.sh script <task> .claude/skills/verify/bin/card_move_db.py <batch> <txn> [--expense <doctype>/<name> ...]

Prints `JSON: {...}`: `line`, `settled`, `expense` (the one the live match names, or null), `bills`, `queued` (its
queue row, or null), and `exists` for each `--expense` asked about. Reads only.
"""

import json
import sys

import frappe

from nirmaan_stack.api.expenses.card_invoices import get_card_invoice_queue

batch, txn = sys.argv[1], sys.argv[2]
asked = [sys.argv[i + 1] for i, arg in enumerate(sys.argv) if arg == "--expense"]

line = frappe.db.get_value(
    "Outflow Import Row",
    {"import_batch": batch, "transfer_id": txn},
    ["name", "row_status", "suggested_doctype", "suggested_name", "resolved_project"],
    as_dict=True,
)
settled = frappe.get_all(
    "Outflow Row Match",
    filters={"import_row": line.name, "match_kind": "Settled"},
    fields=["name", "target_doctype", "target_name", "transfer_id", "source", "created_by_import"],
)
expense = None
bills = []
queued = None
if len(settled) == 1:
    doctype, name = settled[0].target_doctype, settled[0].target_name
    fields = ["name", "amount", "payment_date", "payment_ref", "status", "type", "credit_card_statement"]
    if doctype == "Project Expenses":
        fields += ["projects", "payment_by"]
    expense = frappe.db.get_value(doctype, name, fields, as_dict=True)
    if expense:
        expense["doctype"] = doctype
    bills = frappe.get_all(
        "Expense Bill",
        filters={"expense_doctype": doctype, "expense": name},
        fields=["name", "is_latest", "bill_check"],
    )
    queued = next((row for row in get_card_invoice_queue() if row["name"] == name), None)
exists = {key: bool(frappe.db.exists(*key.split("/", 1))) for key in asked}
print("JSON:" + json.dumps(
    {"line": line, "settled": settled, "expense": expense, "bills": bills, "queued": queued, "exists": exists},
    default=str,
))
