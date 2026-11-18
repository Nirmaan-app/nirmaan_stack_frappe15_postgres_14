"""The Collect payment walk's DB read (#1708): each named Txn Id's Cashbook line and the Expense its match names.

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_collect_db.py <txn id> [<txn id> ...]

Prints one line `JSON:{txn: {"line": {...} | null, "expense": {...} | null}}`. Reads only.
"""

import json
import sys

import frappe

answer = {}
for txn in sys.argv[1:]:
    line = frappe.db.get_value(
        "Outflow Import Row",
        {"transfer_id": txn},
        ["name", "import_batch", "row_status", "row_kind", "outcome_note", "suggested_doctype", "suggested_name"],
        as_dict=True,
    )
    expense = None
    if line:
        match = frappe.db.get_value(
            "Outflow Row Match",
            {"import_row": line.name, "match_kind": "Settled"},
            ["target_doctype", "target_name"],
            as_dict=True,
        )
        if match:
            expense = frappe.db.get_value(
                match.target_doctype,
                match.target_name,
                ["name", "amount", "cashbook_batch", "payment_ref", "invoice_attachment"],
                as_dict=True,
            )
            expense["doctype"] = match.target_doctype
    answer[txn] = {"line": line, "expense": expense}
print("JSON:" + json.dumps(answer, default=str))
