# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Bring this financial year's older Cashbook Expenses into Pending Invoices Upload -> Cashbook (#1649).

The Cashbook queue lists a wallet spend only while its Expense carries the Cashbook marker (`cashbook_batch`), and
the Cashbook job sets the marker only on an Expense it creates (#1592). Expenses made by a Cashbook import before
#1592 carry none, so they never waited for their bill. Owner decision (2026-11-07): wallet spends dated from
1 Apr 2026 get the marker; older ones stay out. The queue rule itself is unchanged (spec #1637 relies on it).

WHICH EXPENSES
    A Project or Non-Project Expense with `payment_date` on or after `FROM_DATE`, an empty `cashbook_batch`, and a
    Settled `Outflow Row Match` that the import created (`created_by_import`) in an import of the Cashbook
    Statement. The marker is that match's import batch: the queue joins the line through it (who paid, the remark).
    A hand-keyed Expense, a Cashbook line's Link (not import-created), a Reversed match and every other source
    (Cashfree, card, Porter, ICICI) are left as they are.

IT REFUSES, NAMING THEM
    An Expense that is the target of more than one such match: one line makes at most one Expense, so which batch
    is its marker is not ours to guess. The patch marks nothing and stops.

IDEMPOTENT
    Only Expenses with an empty marker are read, so an Expense that has one keeps it and a second run marks none.

IT PRINTS
    How many Expenses it marked per ledger, and how many of those now wait in the queue (no invoice, not marked
    No invoice).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import frappe

from nirmaan_stack.services.outflow_import.sources import CASHBOOK_SOURCE

PE = "Project Expenses"
NPE = "Non Project Expenses"
LEDGERS = (PE, NPE)
#: The first day of the financial year the owner brought into the queue (#1649).
FROM_DATE = "2026-04-01"

_SELECTION = """
    FROM "tab{doctype}" e
    JOIN "tabOutflow Row Match" m
      ON m.target_doctype = %(doctype)s AND m.target_name = e.name
     AND m.match_kind = 'Settled' AND m.created_by_import = 1
    JOIN "tabOutflow Import Batch" b ON b.name = m.import_batch AND b.source = %(source)s
    WHERE e.payment_date >= %(from_date)s
      AND COALESCE(e.cashbook_batch, '') = ''
      {scope}
"""


@dataclass
class MarkReport:
    marked: dict[str, int] = field(default_factory=lambda: dict.fromkeys(LEDGERS, 0))
    waiting: dict[str, int] = field(default_factory=lambda: dict.fromkeys(LEDGERS, 0))

    def text(self) -> str:
        return "\n".join(
            f"{doctype}: marked {self.marked[doctype]}, of them waiting in the Cashbook queue {self.waiting[doctype]}"
            for doctype in LEDGERS
        )


def _params(doctype: str, names) -> tuple[str, dict]:
    params = {"doctype": doctype, "source": CASHBOOK_SOURCE, "from_date": FROM_DATE}
    if names is None:
        return "", params
    params["names"] = tuple(names) or ("",)
    return "AND e.name IN %(names)s", params


def _to_mark(doctype: str, names) -> list[dict]:
    scope, params = _params(doctype, names)
    return frappe.db.sql(
        f"""SELECT e.name, MIN(m.import_batch) AS batch, COUNT(*) AS matches,
                   (COALESCE(MAX(e.invoice_attachment), '') = '' AND COALESCE(MAX(e.no_invoice_by), '') = '') AS waits
            {_SELECTION.format(doctype=doctype, scope=scope)}
            GROUP BY e.name ORDER BY e.name""",
        params,
        as_dict=True,
    )


def mark_cashbook_expenses(expenses: dict[str, list[str]] | None = None) -> MarkReport:
    """Set the Cashbook marker on every Expense the selection above reads, and return the counts.

    `expenses` ({ledger: [names]}) scopes the run to those Expenses (a test's own); None reads the whole site."""
    found = {doctype: _to_mark(doctype, None if expenses is None else expenses.get(doctype, [])) for doctype in LEDGERS}
    doubled = [f"{doctype} {row.name}" for doctype, rows in found.items() for row in rows if row.matches > 1]
    if doubled:
        frappe.throw(
            "These Expenses are each the target of more than one import-created Cashbook match, so their marker "
            f"cannot be chosen; nothing was marked: {', '.join(doubled)}"
        )
    report = MarkReport()
    for doctype, rows in found.items():
        for row in rows:
            # RAW WRITE, NO `doc_events` -- CORRECT HERE (CODING_STANDARDS § Writing raw SQL, rule 1): no derived
            # field and no Expense hook reads `cashbook_batch`. It is read only when a list is built or a bill is
            # filed (the Cashbook queue, the Expense bills pill, `expense_bills.receive`), each of which reads it
            # fresh. A save would also stamp `modified` and a Version on each historical Expense.
            frappe.db.sql(
                f"""UPDATE "tab{doctype}" SET cashbook_batch = %s
                    WHERE name = %s AND COALESCE(cashbook_batch, '') = ''""",
                (row.batch, row.name),
            )
            report.marked[doctype] += 1
            report.waiting[doctype] += 1 if row.waits else 0
    return report


def execute():
    report = mark_cashbook_expenses()
    print(report.text())
