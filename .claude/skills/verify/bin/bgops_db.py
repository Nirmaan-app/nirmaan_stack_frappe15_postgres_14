"""Read background operations' status records from the env's cache Redis, for a walk (spec #1654).

    devenv.sh script <task> .claude/skills/verify/bin/bgops_db.py <op_id> [<op_id> ...]

Prints one JSON object: each operation id -> its record as stored (owner included), or null when there is none.
Read-only. The records are not in the DB: they live in the cache Redis for 24 hours (ADR 0047).
"""

import json
import sys

import frappe

records = {}
for op_id in sys.argv[1:]:
    raw = frappe.cache().get(frappe.cache().make_key(f"background_op:{op_id}"))
    records[op_id] = json.loads(raw) if raw else None
print("BGOPS " + json.dumps(records))
