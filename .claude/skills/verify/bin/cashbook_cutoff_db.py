"""The #1715 walk's DB read (`walk_cashbook_cutoff.py`): the ₹0 record's amount and, given `--batch`, that import's
period, left-out count and stored Txn Ids, for the import that stored the line `--txn` names. READ-ONLY. Prints one
`JSON:` line.

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_cutoff_db.py <record> [--txn <a kept line's Txn Id>]
"""

import json
import sys

import frappe

args = sys.argv[1:]
record = args[0]
txn = args[args.index("--txn") + 1] if "--txn" in args else None
batch = frappe.db.get_value("Outflow Import Row", {"transfer_id": txn}, "import_batch") if txn else None
got = {"record_amount": float(frappe.db.get_value("Internal Transfer", record, "amount"))}
if batch:
    got["batch"] = frappe.db.get_value(
        "Outflow Import Batch", batch, ["period_from", "period_to", "lines_before_cutoff"], as_dict=True
    )
    got["stored"] = frappe.get_all("Outflow Import Row", filters={"import_batch": batch}, pluck="transfer_id")
print("JSON:" + json.dumps(got, default=str))
