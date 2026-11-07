"""The Cashbook queue and the #1649 marker patch's selection, read-only, as one JSON line `CASHBOOK_MARKER_DB {...}`.

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_marker_db.py

`queue`: the rows Pending Invoices Upload -> Cashbook lists, per ledger (the endpoint itself, as Administrator).
`to_mark` / `to_wait`: per ledger, the Expenses the patch would mark now, and those of them with no invoice and no
No invoice mark. `marked_before_from_date`: per ledger, the Expenses dated before the patch's first day that carry a
marker (the patch never marks one, so its run must leave this unchanged).
"""

import json

import frappe

from nirmaan_stack.api.expenses.cashbook_invoices import get_cashbook_invoice_queue
from nirmaan_stack.patches.v3_0.mark_this_year_cashbook_expenses import FROM_DATE, LEDGERS, expenses_to_mark

frappe.set_user("Administrator")
queue = get_cashbook_invoice_queue()
answer = {
    "queue": {d: sum(1 for r in queue if r["doctype"] == d) for d in LEDGERS},
    "queue_oldest": str(min((r["payment_date"] for r in queue), default=None)),
    "to_mark": {},
    "to_wait": {},
    "marked_before_from_date": {},
}
for doctype in LEDGERS:
    rows = expenses_to_mark(doctype)
    answer["to_mark"][doctype] = len(rows)
    answer["to_wait"][doctype] = sum(1 for r in rows if r.waits)
    answer["marked_before_from_date"][doctype] = frappe.db.sql(
        f"""SELECT COUNT(*) FROM "tab{doctype}"
            WHERE COALESCE(cashbook_batch, '') != '' AND payment_date < %s""",
        (FROM_DATE,),
    )[0][0]
print("CASHBOOK_MARKER_DB " + json.dumps(answer, default=str))
