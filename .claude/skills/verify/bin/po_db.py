"""Read one Procurement Order as the PO page shows it. Read-only.

    devenv.sh script <task> .claude/skills/verify/bin/po_db.py <po id>
"""

import sys

import frappe

po = frappe.db.get_value(
    "Procurement Orders", sys.argv[1], ["name", "status", "project", "vendor", "amount_paid", "owner"], as_dict=True
)
print(dict(po) if po else f"no Procurement Orders row {sys.argv[1]!r}")
