"""An Expense's Bill check as the Project Expenses and Non-Project Expenses lists show it (#1640, spec #1637,
GLOSSARY *Expense bills*): the result and the approval of its latest Expense bill (`is_latest`).

An Expense with no Expense bill (its bill came before launch, or it has none) has neither; the lists show "—".
A bill whose reading stopped shows Not read, as Pending Approval shows it (`reading.reading_stopped`, #1645).
A Matched bill the system approved shows Auto-approved, apart from one a person approved.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.expense_bills import APPROVED, BILL_DOCTYPE
from nirmaan_stack.services.expense_bills.bill_check import CHECKING, NOT_READ
from nirmaan_stack.services.expense_bills.reading import stopped_before

#: The Expense ledgers whose bills are Expense bills.
EXPENSE_DOCTYPES = ("Project Expenses", "Non Project Expenses")

AUTO_APPROVED = "Auto-approved"

#: The two list fields, each the SQL that gives it from the latest bill `b`.
SHOWN = {
    "bill_check": f"""CASE WHEN b.bill_check = '{CHECKING}' AND b.read_claimed_at < %(stopped_before)s
                         THEN '{NOT_READ}' ELSE b.bill_check END""",
    "bill_approval": f"""CASE WHEN b.status = '{APPROVED}' AND b.auto_approved = 1
                            THEN '{AUTO_APPROVED}' ELSE b.status END""",
}


def latest_bill_checks(doctype: str, expenses: list[str]) -> dict[str, dict]:
    """{Expense: {"bill_check", "bill_approval"}} for each of `expenses` that has an Expense bill."""
    if doctype not in EXPENSE_DOCTYPES or not expenses:
        return {}
    rows = frappe.db.sql(
        f"""SELECT b.expense, {SHOWN["bill_check"]} AS bill_check, {SHOWN["bill_approval"]} AS bill_approval
            FROM "tab{BILL_DOCTYPE}" b
            WHERE b.expense_doctype = %(doctype)s AND b.is_latest = 1 AND b.expense IN %(expenses)s""",
        {"doctype": doctype, "expenses": tuple(expenses), "stopped_before": stopped_before()},
        as_dict=True,
    )
    return {r.expense: {"bill_check": r.bill_check, "bill_approval": r.bill_approval} for r in rows}
