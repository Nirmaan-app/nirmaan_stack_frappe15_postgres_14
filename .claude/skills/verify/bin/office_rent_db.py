"""The DB side of the Office Rent walk (`walk_office_rent.py`): the request raised with this Office Location,
its Expense and that Expense's tax record, as one JSON line. Read-only.

    devenv.sh script <task> .claude/skills/verify/bin/office_rent_db.py "<office location>"
"""

import json
import sys

import frappe

location = sys.argv[1]
request = frappe.db.sql(
    """SELECT name, amount, status FROM "tabExpense Request"
       WHERE type = 'Office Rent' AND source_data LIKE %s ORDER BY creation DESC LIMIT 1""",
    (f"%{location}%",), as_dict=True)
answer = {"request": None, "expense": None, "record": None}
if request:
    req = request[0]
    answer["request"] = {"name": req.name, "amount": float(req.amount), "status": req.status}
    expense = frappe.db.get_value("Non Project Expenses", {"request_id": req.name},
                                  ["name", "status", "amount", "gst_amount", "description"], as_dict=True)
    if expense:
        answer["expense"] = {"name": expense.name, "status": expense.status, "amount": float(expense.amount),
                             "gst_amount": float(expense.gst_amount or 0), "description": expense.description}
        record = frappe.db.get_value("Payment TDS Deduction", {"non_project_expense": expense.name},
                                     ["name", "gross_amount", "tds_percentage", "tds_amount", "tds_section"],
                                     as_dict=True)
        if record:
            answer["record"] = {"name": record.name, "gross_amount": float(record.gross_amount),
                                "tds_percentage": float(record.tds_percentage),
                                "tds_amount": float(record.tds_amount), "tds_section": record.tds_section}
print("OFFICE_RENT_DB " + json.dumps(answer))
