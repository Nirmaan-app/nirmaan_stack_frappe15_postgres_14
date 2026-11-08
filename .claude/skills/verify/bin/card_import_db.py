"""What `walk_card_import.py` reads back from the env DB for one card import, by holder (spec #1653).

    devenv.sh script <task> .claude/skills/verify/bin/card_import_db.py "<holder>"

Prints one `JSON:` line: the batch, its spends and refunds (status, type, Expense), each refund Expense (amount,
status, type, description), the open main-table lines of the batch, and whether its Create job is queued.
"""

import json
import sys

import frappe

from nirmaan_stack.api.outflow_import.card_import import card_import

holder = sys.argv[1]
batch = frappe.db.get_value("Credit Card Statement", {"holder": holder}, "import_batch")
out = {"batch": batch}
if batch:
    review = card_import(batch)
    out.update({k: review[k] for k in ("created", "failed", "to_create", "spends_to_create", "refunds_to_create",
                                         "create_running", "suggest_running", "refunds")})
    refunds = [line for line in review["lines"] if line["is_refund"]]
    out["refunds_lines"] = [{k: line[k] for k in ("name", "row_status", "expense_type", "expense")} for line in refunds]
    out["makemytrip_spend_types"] = sorted(
        {line["expense_type"] for line in review["lines"] if line["merchant"] == "MAKEMYTRIP" and not line["is_credit"]}
    )
    out["refund_expenses"] = [
        frappe.db.get_value("Non Project Expenses", line["expense"], ["name", "amount", "status", "type", "description"],
                            as_dict=True)
        for line in refunds if line["expense"]
    ]
    out["open_on_main_table"] = frappe.db.sql(
        """SELECT name, direction, row_status FROM "tabOutflow Import Row"
           WHERE import_batch = %s AND row_status IN ('Pending match run', 'Mismatched', 'Error', 'Matched')
             AND NOT (direction = 'Debit' OR match_basis = 'card statement')""",
        (batch,), as_dict=True,
    )
print("JSON:" + json.dumps(out, default=str))
