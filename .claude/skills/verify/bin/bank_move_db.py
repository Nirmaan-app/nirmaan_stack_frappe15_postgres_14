"""The #1760 walk's DB read (`walk_bank_move.py`): a bank line by its UTR, its live Settled matches, and the expense the
line points at with its pay-to account, approval dates and comments.

    devenv.sh script <task> .claude/skills/verify/bin/bank_move_db.py <utr>

Prints one line `JSON:{"line", "settled", "expense", "comments"}`. Reads only.
"""

import json
import sys

import frappe

utr = sys.argv[1]
line = frappe.db.get_value(
    "Outflow Import Row",
    {"transfer_id": utr},
    ["name", "source", "row_status", "suggested_doctype", "suggested_name", "resolved_project"],
    as_dict=True,
)
settled = frappe.get_all(
    "Outflow Row Match",
    filters={"import_row": line.name, "match_kind": "Settled"},
    fields=["target_doctype", "target_name", "transfer_id", "source", "created_by_import"],
)
expense, comments = None, []
if len(settled) == 1:
    leg = settled[0]
    fields = ["name", "amount", "payment_date", "payment_ref", "type", "status", "comment", "pay_to_account_name",
              "pay_to_account_number", "pay_to_ifsc", "approval_date", "ceo_approval_date"]
    if leg.target_doctype == "Project Expenses":
        fields += ["projects", "payment_by"]
    expense = frappe.db.get_value(leg.target_doctype, leg.target_name, fields, as_dict=True)
    if expense:
        expense["doctype"] = leg.target_doctype
        comments = frappe.get_all(
            "Comment",
            filters={"reference_doctype": leg.target_doctype, "reference_name": leg.target_name,
                     "comment_type": "Comment"},
            pluck="content",
        )
print("JSON:" + json.dumps({"line": line, "settled": settled, "expense": expense, "comments": comments}, default=str))
