"""The #1628 walk's DB read (`walk_skip_types.py`): how many Skipped lines hold each retired kind, and the seeded
line's state. READ-ONLY. Prints one `JSON:` line.

    devenv.sh script <task> .claude/skills/verify/bin/skip_types_db.py <seeded line>
"""

import json
import sys

import frappe

from nirmaan_stack.services.outflow_import.skip_kinds import RETIRED_SKIP_KINDS

held = dict(
    frappe.db.sql(
        """SELECT skip_kind, COUNT(*) FROM "tabOutflow Import Row"
           WHERE row_status = 'Skipped' AND skip_kind IN %s GROUP BY skip_kind""",
        (tuple(RETIRED_SKIP_KINDS),),
    )
)
line = frappe.db.get_value("Outflow Import Row", sys.argv[1], ["row_status", "skip_kind"], as_dict=True)
print("JSON:" + json.dumps({"retired_held": held, "line": line}))
