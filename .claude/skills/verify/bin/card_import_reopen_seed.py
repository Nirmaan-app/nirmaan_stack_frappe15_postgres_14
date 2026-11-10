"""Reopen one created spend of a card import, so its dialog needs another Create (spec #1653, #1674).

    devenv.sh script <task> .claude/skills/verify/bin/card_import_reopen_seed.py "<holder>"

Setup for `walk_card_import.py`: unreconciles the first created spend of the holder's import through the real
Unreconcile path (`unreconcile.unreconcile_line`, as Administrator), which deletes its Expense and reopens the
line, then commits. Prints `reopened: <line>`.
"""

import sys

import frappe

from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_line

batch = frappe.db.get_value("Credit Card Statement", {"holder": sys.argv[1]}, "import_batch")
line = frappe.db.get_value(
    "Outflow Import Row", {"import_batch": batch, "direction": "Debit", "row_status": "Settled"}, "name",
    order_by="name asc",
)
unreconcile_line(row=line, legs="all", reason="walk: needs another Create", actor="Administrator")
frappe.db.commit()
print(f"reopened: {line}")
