"""The #1762 walk's DB read (`walk_move_to_transfer.py`).

    devenv.sh script <task> .claude/skills/verify/bin/move_to_transfer_db.py <txn id> [--expense <doctype>/<name>]
    devenv.sh script <task> .claude/skills/verify/bin/move_to_transfer_db.py --linked

With a Txn Id: the Cashbook line, its live Settled matches, its Internal Transfer record with the File its `proof`
names, the expense's Expense bills (by `--expense`), and whether that expense still exists. With `--linked`: one
Settled Cashbook line Linked to a record its import did not create (its Txn Id and remark), from the env's own data,
so the walk names no real line in the repo. Prints one line `JSON:{...}`. Reads only.
"""

import json
import sys

import frappe

args = sys.argv[1:]

if args == ["--linked"]:
    found = frappe.db.sql(
        """SELECT r.transfer_id, r.remarks, m.target_doctype, m.target_name
           FROM "tabOutflow Import Row" r JOIN "tabOutflow Row Match" m ON m.import_row = r.name
           WHERE r.source = 'Cashbook' AND r.row_status = 'Settled' AND m.match_kind = 'Settled'
             AND COALESCE(m.created_by_import, 0) = 0
           ORDER BY r.creation DESC LIMIT 1""",
        as_dict=True,
    )
    print("JSON:" + json.dumps({"linked": found[0] if found else None}, default=str))
    raise SystemExit(0)

txn, rest = args[0], args[1:]
line = frappe.db.get_value(
    "Outflow Import Row", {"transfer_id": txn}, ["name", "row_status", "outcome_note", "decided_by"], as_dict=True
)
settled = frappe.get_all(
    "Outflow Row Match",
    filters={"transfer_id": txn, "match_kind": "Settled"},
    fields=["target_doctype", "target_name", "created_by_import"],
)
reversed_legs = frappe.get_all(
    "Outflow Row Match",
    filters={"transfer_id": txn, "match_kind": "Reversed"},
    fields=["target_doctype", "target_name", "reversal_reason"],
)
record = None
if line:
    record = frappe.db.get_value(
        "Internal Transfer",
        {"import_row": line.name},
        ["name", "from_place", "to_place", "detail", "direction", "amount", "made_by", "marked_by", "mark_reason",
         "proof"],
        as_dict=True,
    )
if record:
    record["proof_files"] = frappe.get_all(
        "File",
        filters={"file_url": record.proof or "-", "attached_to_doctype": "Internal Transfer",
                 "attached_to_name": record.name},
        fields=["name", "attached_to_field"],
    )
expense, bills, exists = None, [], None
if rest[:1] == ["--expense"]:
    doctype, name = rest[1].split("/", 1)
    exists = bool(frappe.db.exists(doctype, name))
    bills = frappe.get_all(
        "Expense Bill",
        filters={"expense_doctype": doctype, "expense": name},
        fields=["name", "is_latest", "bill_check", "bill_file"],
    )
print("JSON:" + json.dumps({"line": line, "settled": settled, "reversed": reversed_legs, "record": record,
                            "bills": bills, "expense_exists": exists}, default=str))
