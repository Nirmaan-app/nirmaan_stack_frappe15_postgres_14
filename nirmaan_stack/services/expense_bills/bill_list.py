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
from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES

AUTO_APPROVED = "Auto-approved"

def stopped_sql(alias: str, param: str = "%(stopped_before)s") -> str:
    """SQL, true on record `alias` (an Expense bill, or a Collect payment line, which keeps the same fields) whose
    reading stopped: `reading.reading_stopped`'s rule, spelled in SQL so a query can show and filter on it. The
    query passes `reading.stopped_before()` as `param` (named by default; `%s` for a positional query).
    `test_expense_bill_list.test_a_bill_whose_reading_stopped_shows_not_read` holds the two together."""
    return f"({alias}.bill_check = '{CHECKING}' AND {alias}.read_claimed_at < {param})"


#: The stopped rule on the latest bill `b`, as the two list fields below and Pending Approval's query read it.
STOPPED_SQL = stopped_sql("b")

#: The two list fields, each the SQL that gives it from the latest bill `b`; the query passes `stopped_before`.

LIST_FIELD_SQL = {
    "bill_check": f"CASE WHEN {STOPPED_SQL} THEN '{NOT_READ}' ELSE b.bill_check END",
    "bill_approval": f"""CASE WHEN b.status = '{APPROVED}' AND b.auto_approved = 1
                            THEN '{AUTO_APPROVED}' ELSE b.status END""",
}


def latest_bill_checks(doctype: str, expenses: list[str]) -> dict[str, dict]:
    """{Expense: {"bill_check", "bill_approval"}} for each of `expenses` that has an Expense bill."""
    if doctype not in EXPENSE_DOCTYPES or not expenses:
        return {}
    rows = frappe.db.sql(
        f"""SELECT b.expense, {LIST_FIELD_SQL["bill_check"]} AS bill_check,
                   {LIST_FIELD_SQL["bill_approval"]} AS bill_approval
            FROM "tab{BILL_DOCTYPE}" b
            WHERE b.expense_doctype = %(doctype)s AND b.is_latest = 1 AND b.expense IN %(expenses)s""",
        {"doctype": doctype, "expenses": tuple(expenses), "stopped_before": stopped_before()},
        as_dict=True,
    )
    return {r.expense: {"bill_check": r.bill_check, "bill_approval": r.bill_approval} for r in rows}


def expenses_with_latest_bill(doctype: str, field: str, values: list[str], showing: bool = True) -> list[str]:
    """The `doctype` Expenses whose latest bill shows one of `values` in `field` (a key of LIST_FIELD_SQL); with
    `showing` False, those whose latest bill shows none of them. Either way only Expenses that hold an Expense bill,
    so the list stays as short as the bills are few."""
    if doctype not in EXPENSE_DOCTYPES or field not in LIST_FIELD_SQL:
        frappe.throw(f"{doctype} has no list field {field}.")
    condition = f"({LIST_FIELD_SQL[field]}) IN %(values)s" if values else "FALSE"
    if not showing:
        condition = f"NOT ({condition})"
    return frappe.db.sql(
        f"""SELECT b.expense FROM "tab{BILL_DOCTYPE}" b
            WHERE b.expense_doctype = %(doctype)s AND b.is_latest = 1 AND {condition}""",
        {"doctype": doctype, "values": tuple(values) or ("",), "stopped_before": stopped_before()},
        pluck=True,
    )
