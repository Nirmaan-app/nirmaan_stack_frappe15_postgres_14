"""The #1758 walk's DB read (`walk_cashbook_phrase.py`): the alias rows that read as a phrase (as the import
normalises it), and a Cashbook line by its Txn Id with the expense it points at.

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_phrase_db.py <phrase> <txn id>

Prints one line `JSON:{"aliases", "line", "expense"}`. Reads only.
"""

import json
import sys

import frappe

from nirmaan_stack.services.outflow_import.project_match import alias_haystack

phrase, txn = sys.argv[1], sys.argv[2]
wanted = alias_haystack(phrase).strip()
aliases = [
    row
    for row in frappe.get_all("Outflow Import Project Alias", fields=["name", "keyword", "project", "active", "owner"])
    if alias_haystack(row.keyword).strip() == wanted
]
line = frappe.db.get_value(
    "Outflow Import Row",
    {"transfer_id": txn},
    ["name", "row_status", "suggested_doctype", "suggested_name", "resolved_project"],
    as_dict=True,
)
expense = None
if line and line.suggested_name and frappe.db.exists(line.suggested_doctype, line.suggested_name):
    fields = ["name", "amount", "status"] + (["projects"] if line.suggested_doctype == "Project Expenses" else [])
    expense = frappe.db.get_value(line.suggested_doctype, line.suggested_name, fields, as_dict=True)
    expense["doctype"] = line.suggested_doctype
print("JSON:" + json.dumps({"aliases": aliases, "line": line, "expense": expense}, default=str))
