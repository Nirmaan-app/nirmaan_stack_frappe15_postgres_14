"""Read back what a link field holds, for `walk_link_fields.py` (#1680). Read-only: commits nothing.

    devenv.sh script <task> .claude/skills/verify/bin/link_fields_db.py <doctype> <field> <link>

Prints one JSON line: how many rows of <doctype> hold <link> in <field> exactly, and the name and parent of each.
"""

import json
import sys

import frappe

doctype, field, link = sys.argv[1:4]
parent = "billing_tracker" if doctype == "Project Billing" else "parent"
# Raw SQL with a bound value: frappe.get_all mangles a filter value that holds `=0` (it reads it as an operator).
rows = frappe.db.sql(
    f'select name, "{parent}" as parent from "tab{doctype}" where "{field}" = %s',
    (link,),
    as_dict=True,
)
print(json.dumps({"doctype": doctype, "field": field, "length": len(link), "rows": rows}, default=str))
