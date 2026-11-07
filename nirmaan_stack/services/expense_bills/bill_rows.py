# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Expense bills of one pill, as Vendor Invoice Recon shows them (spec #1637, GLOSSARY *Expense bills*): the one
SQL both screens read. All Invoices -> Cashbook / Credit Card lists every row (#1646); Pending Approval -> Cashbook /
Credit Card lists the ones that wait for a person (#1644).

A pill is the Cashbook import's marker on the spend, or a card statement. One row per Expense bill, latest and
history, with:

* `bill_check`: a bill whose reading stopped shows Not read, with `reading.READING_STOPPED` as its reason (#1645);
* `approval`: the bill's status, and Auto-approved for a Matched bill the system approved (`bill_list`);
* `read_total`: only on a compared bill (Matched or Mismatched); `read_total` is 0 on any other;
* `invoice_no` / `invoice_date`: the bill's own; on the latest bill, else the ones typed on the Expense, which
  mirrors its latest bill;
* `paid_by`: the card holder, or the wallet holder on the statement line (else a Project Expense's own Paid by).
"""

from __future__ import annotations

from typing import NamedTuple

from nirmaan_stack.services.expense_bills import BILL_DOCTYPE
from nirmaan_stack.services.expense_bills.bill_check import CHECKING, MATCHED, MISMATCHED, NOT_READ
from nirmaan_stack.services.expense_bills.bill_list import LIST_FIELD_SQL
from nirmaan_stack.services.expense_bills.reading import READING_STOPPED, stopped_before

PROJECT_EXPENSE = "Project Expenses"
NON_PROJECT_EXPENSE = "Non Project Expenses"


class Pill(NamedTuple):
    """One pill of expense bills: the ledgers its spends are on, and the SQL condition that puts a spend on it."""

    ledgers: tuple[str, ...]
    condition: str


#: The two pills: the Cashbook import's marker, or a card statement.
KINDS = {
    "cashbook": Pill((PROJECT_EXPENSE, NON_PROJECT_EXPENSE), "COALESCE(e.cashbook_batch, '') != ''"),
    "card": Pill((NON_PROJECT_EXPENSE,), "COALESCE(e.credit_card_statement, '') != ''"),
}

_STOPPED = f"(b.bill_check = '{CHECKING}' AND b.read_claimed_at < %(stopped_before)s)"

_ROWS_SQL = f"""
    SELECT b.name, b.expense, b.expense_doctype, e.payment_date, b.line_amount,
           CASE WHEN b.bill_check IN ('{MATCHED}', '{MISMATCHED}') THEN b.read_total END AS read_total,
           CASE WHEN {_STOPPED} THEN '{NOT_READ}' ELSE b.bill_check END AS bill_check,
           CASE WHEN {_STOPPED} THEN '{READING_STOPPED}' ELSE b.bill_check_reason END AS bill_check_reason,
           {LIST_FIELD_SQL["bill_approval"]} AS approval,
           b.rejection_reason, b.is_latest,
           COALESCE(NULLIF(b.invoice_no, ''), CASE WHEN b.is_latest = 1 THEN e.invoice_ref END) AS invoice_no,
           COALESCE(b.invoice_date, CASE WHEN b.is_latest = 1 THEN e.invoice_date END) AS invoice_date,
           {{paid_by}} AS paid_by, {{project}} AS project, {{project_name}} AS project_name,
           b.uploaded_by, u.full_name AS uploaded_by_name, b.bill_file, b.creation
    FROM "tab{BILL_DOCTYPE}" b
    JOIN "tab{{doctype}}" e ON e.name = b.expense
    LEFT JOIN "tabOutflow Import Row" r ON r.name = b.statement_line
    LEFT JOIN "tabUser" u ON u.name = b.uploaded_by
    {{joins}}
    WHERE b.expense_doctype = '{{doctype}}' AND {{kind}}
"""


def bill_rows_sql(kind: str) -> tuple[str, dict]:
    """(the SQL of every Expense bill on pill `kind`, its parameters). Its columns are the module docstring's, plus
    `name`, `expense`, `expense_doctype`, `payment_date` (the spend date), `line_amount`, `bill_check_reason`,
    `rejection_reason`, `is_latest`, `project`, `project_name`, `uploaded_by`, `uploaded_by_name`, `bill_file`,
    `creation`. The ledger names are this module's constants, never input."""
    if kind not in KINDS:
        raise ValueError(f"'{kind}' is not a pill of expense bills.")
    parts = [_ledger_rows_sql(kind, doctype) for doctype in KINDS[kind].ledgers]
    return " UNION ALL ".join(parts), {"stopped_before": stopped_before()}


def _ledger_rows_sql(kind: str, doctype: str) -> str:
    if kind == "card":
        paid_by, joins = "s.holder", 'LEFT JOIN "tabCredit Card Statement" s ON s.name = e.credit_card_statement'
    else:
        # Who paid is the wallet holder on the statement line; else the Project Expense's own Paid by.
        payment_by = "e.payment_by" if doctype == PROJECT_EXPENSE else "NULL"
        paid_by, joins = f"COALESCE(NULLIF(BTRIM(r.added_by_raw), ''), {payment_by})", ""
    if doctype == PROJECT_EXPENSE:
        project, project_name = "e.projects", "p.project_name"
        joins += ' LEFT JOIN "tabProjects" p ON p.name = e.projects'
    else:
        project, project_name = "NULL", "NULL"
    return _ROWS_SQL.format(
        doctype=doctype, kind=KINDS[kind].condition, paid_by=paid_by, joins=joins,
        project=project, project_name=project_name,
    )
