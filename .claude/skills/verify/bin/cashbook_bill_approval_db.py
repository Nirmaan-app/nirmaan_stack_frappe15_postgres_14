"""The Cashbook bill approval walk's DB read (#1755): every Expense bill that waits on Pending Invoice Approvals ->
Cashbook, by the query the pill itself reads (`expense_bill_approval._PENDING_SQL` over `bill_rows_sql("cashbook")`).

    devenv.sh script <task> .claude/skills/verify/bin/cashbook_bill_approval_db.py

Prints one line `CASHBOOK_BILL_APPROVAL_DB {json}`: {"waiting": [{"name", "bill_file", "bill_check", "uploaded_by"}]}.
"""

import json

import frappe

from nirmaan_stack.api.expenses.expense_bill_approval import _PENDING_SQL
from nirmaan_stack.services.expense_bills.bill_rows import bill_rows_sql

rows_sql, params = bill_rows_sql("cashbook")
waiting = frappe.db.sql(
    f"SELECT name, bill_file, bill_check, uploaded_by FROM ({_PENDING_SQL.format(rows=rows_sql)}) w ORDER BY name",
    params,
    as_dict=True,
)
print("CASHBOOK_BILL_APPROVAL_DB " + json.dumps({"waiting": waiting}, default=str))
