# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What a Payee is linked to, and whether it has been paid (spec #1420, ADR-0033). Read-only.

* **Linked vendors**: `Vendors` whose `payee` is the Payee.
* **Linked expenses**: `Project Expenses` and `Non Project Expenses` whose `payee` is the Payee, at any
  status. An Expense Request is not an expense: it is counted once approval carries its Payee over.
* **Paid / last paid**: a Payee is paid once money has left *Approved* for it
  (`rules.PAID_STATUSES`): any Project Payment of a vendor linked to it NOW, or any linked expense.
  Last paid is the latest such payment's date (its last change when it has no payment date).
  A PO / WO payment stores no Payee (ADR-0033 "Not in v1"), so a vendor's payments count for the
  Payee it links to today.

`PAID_ROWS_SQL` is "money that left Approved for a Payee", row by row: every reader of paid, last
paid or times paid (here, `choosing`, `search`) selects from it, so the rule is written once.
`PAYEES_WITH_LINKS_SQL` is the one query behind the counts: the Payees list (`api/payees/
list_payees`) filters and sorts over it, and `payee_summaries` reads single Payees from it.

One Payee's page (#1423) reads `payee_page`: the summary, the lock, when the holder name last changed,
and the rows behind the counts (`linked_vendors`, `linked_expenses`).

A vendor's Payee is `vendor_account`'s, not this module's.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.payees.rules import PAID_STATUSES, PAYEE_DOCTYPE
from nirmaan_stack.services.payees.versions import changed_field_pattern, last_field_change

#: `status IN (...)` for the paid statuses (`rules.PAID_STATUSES`), as SQL.
PAID_STATUS_SQL = "(" + ", ".join(f"'{status}'" for status in PAID_STATUSES) + ")"

#: One row per payment that has paid a Payee: `payee`, `paid_on` (its payment date, else the day it
#: last changed) and `document` (a PO / WO payment's PO or WO, an expense's own ID). A Project Payment
#: counts for the Payee its vendor links to NOW; an expense for its own Payee. Select from it as a
#: subquery: `FROM ({PAID_ROWS_SQL}) paid WHERE paid.payee = ...`.
PAID_ROWS_SQL = f"""
    SELECT v.payee, COALESCE(pp.payment_date, pp.modified::date) AS paid_on,
           COALESCE(pp.document_name, pp.name) AS document
    FROM "tabProject Payments" pp JOIN "tabVendors" v ON v.name = pp.vendor
    WHERE v.payee IS NOT NULL AND pp.status IN {PAID_STATUS_SQL}
    UNION ALL
    SELECT payee, COALESCE(payment_date, modified::date), name FROM "tabProject Expenses"
    WHERE payee IS NOT NULL AND status IN {PAID_STATUS_SQL}
    UNION ALL
    SELECT payee, COALESCE(payment_date, modified::date), name FROM "tabNon Project Expenses"
    WHERE payee IS NOT NULL AND status IN {PAID_STATUS_SQL}
"""

#: One row per Payee: its own fields plus `vendors`, `expenses` (counts) and `last_paid` (a date or NULL).
#: Each link table is grouped once, so the list costs one pass over each, not one per Payee.
PAYEES_WITH_LINKS_SQL = f"""
    SELECT p.name, p.creation, p.account_name, p.account_number, p.normalized_account, p.ifsc,
           p.bank_name, p.bank_branch, p.status,
           COALESCE(v.vendors, 0) AS vendors,
           COALESCE(e.expenses, 0) AS expenses,
           paid.last_paid
    FROM "tabPayee" p
    LEFT JOIN (
        SELECT payee, COUNT(*) AS vendors FROM "tabVendors" WHERE payee IS NOT NULL GROUP BY payee
    ) v ON v.payee = p.name
    LEFT JOIN (
        SELECT x.payee, COUNT(*) AS expenses
        FROM (
            SELECT payee FROM "tabProject Expenses" WHERE payee IS NOT NULL
            UNION ALL
            SELECT payee FROM "tabNon Project Expenses" WHERE payee IS NOT NULL
        ) x
        GROUP BY x.payee
    ) e ON e.payee = p.name
    LEFT JOIN (
        SELECT payee, MAX(paid_on) AS last_paid FROM ({PAID_ROWS_SQL}) r GROUP BY payee
    ) paid ON paid.payee = p.name
"""


def payee_summaries(names: list[str]) -> dict[str, dict]:
    """Each named Payee's fields with its links: `{name: {name, account_name, account_number, ifsc,
    bank_name, bank_branch, status, vendors, expenses, last_paid}}`. `last_paid` is an ISO date or
    None. A name with no Payee is left out."""
    names = [n for n in names if n]
    if not names:
        return {}
    rows = frappe.db.sql(
        f"SELECT q.* FROM ({PAYEES_WITH_LINKS_SQL}) q WHERE q.name IN %(names)s",
        {"names": tuple(names)},
        as_dict=True,
    )
    return {row.name: summary_row(row) for row in rows}


def payee_summary(name: str) -> dict | None:
    """One Payee as `payee_summaries` gives it, or None."""
    return payee_summaries([name]).get(name)


def summary_row(row) -> dict:
    """A `PAYEES_WITH_LINKS_SQL` row as the API returns it."""
    last_paid = row.get("last_paid")
    return {
        "name": row["name"],
        "account_name": row.get("account_name"),
        "account_number": row.get("account_number"),
        "ifsc": row.get("ifsc"),
        "bank_name": row.get("bank_name"),
        "bank_branch": row.get("bank_branch"),
        "status": row.get("status"),
        "vendors": int(row.get("vendors") or 0),
        "expenses": int(row.get("expenses") or 0),
        "last_paid": str(last_paid) if last_paid else None,
    }


def is_paid(name: str) -> bool:
    """True once money has left Approved for Payee `name`: a Project Payment of a vendor linked to it,
    or an expense linked to it, at Reconciliation Pending or Paid."""
    return bool(frappe.db.sql(
        f"SELECT 1 FROM ({PAID_ROWS_SQL}) paid WHERE paid.payee = %(name)s LIMIT 1",
        {"name": name},
    ))


#: A linked expense's kind, as the Payee page shows it.
PROJECT_KIND = "Project"
NON_PROJECT_KIND = "Non Project"


def linked_vendors(name: str) -> list[dict]:
    """The Vendors paid into Payee `name`: `{name, vendor_name, vendor_type, vendor_city, vendor_status,
    linked_since}`, by vendor name. `linked_since` (ISO date) is the vendor's last change of its
    Payee in its Version history; a link with no such row (made before it, or by a raw write) dates
    from when both the vendor and the Payee existed."""
    rows = frappe.db.sql(
        """
        SELECT v.name, v.vendor_name, v.vendor_type, v.vendor_city, v.vendor_status,
               COALESCE(
                   (SELECT MAX(ver.creation) FROM "tabVersion" ver
                    WHERE ver.ref_doctype = 'Vendors' AND ver.docname = v.name
                      AND ver.data LIKE %(payee_changed)s),
                   GREATEST(v.creation, p.creation)
               )::date AS linked_since
        FROM "tabVendors" v JOIN "tabPayee" p ON p.name = v.payee
        WHERE v.payee = %(name)s
        ORDER BY v.vendor_name, v.name
        """,
        {"name": name, "payee_changed": changed_field_pattern("payee")},
        as_dict=True,
    )
    return [{**row, "linked_since": str(row.linked_since) if row.linked_since else None} for row in rows]


def linked_expenses(name: str) -> list[dict]:
    """The expenses naming Payee `name`, at any status, newest first: `{name, kind, expense_type,
    project, project_name, amount, status, paid_on}`. `kind` is `PROJECT_KIND` or `NON_PROJECT_KIND`;
    `paid_on` (ISO date) is set once the expense has paid the Payee, read as `last_paid` reads it."""
    rows = frappe.db.sql(
        f"""
        SELECT x.name, x.kind, x.expense_type, x.project, x.project_name, x.amount, x.status,
               CASE WHEN x.status IN {PAID_STATUS_SQL} THEN COALESCE(x.payment_date, x.modified::date) END AS paid_on
        FROM (
            SELECT e.name, %(project_kind)s AS kind, e.type AS expense_type, e.projects AS project,
                   pr.project_name, e.amount, e.status, e.payment_date, e.modified, e.creation
            FROM "tabProject Expenses" e LEFT JOIN "tabProjects" pr ON pr.name = e.projects
            WHERE e.payee = %(name)s
            UNION ALL
            SELECT e.name, %(non_project_kind)s, e.type, NULL, NULL, e.amount, e.status, e.payment_date,
                   e.modified, e.creation
            FROM "tabNon Project Expenses" e
            WHERE e.payee = %(name)s
        ) x
        ORDER BY x.creation DESC, x.name
        """,
        {"name": name, "project_kind": PROJECT_KIND, "non_project_kind": NON_PROJECT_KIND},
        as_dict=True,
    )
    return [
        {**row, "amount": float(row.amount or 0), "paid_on": str(row.paid_on) if row.paid_on else None}
        for row in rows
    ]


def holder_name_changed_on(name: str) -> str | None:
    """The ISO date Payee `name`'s holder name last changed, from its Version history, or None."""
    changed = last_field_change(PAYEE_DOCTYPE, name, "account_name")
    return str(changed.creation.date()) if changed else None


def payee_page(name: str) -> dict:
    """Everything one Payee's page shows: `payee_summary`'s fields plus `creation`, `locked`
    (`is_paid`: its account number and IFSC can't change), `holder_name_changed_on`,
    `linked_vendors` and `linked_expenses`. Refuses a name with no Payee."""
    summary = payee_summary(name)
    if not summary:
        frappe.throw(frappe._("Payee {0} not found.").format(name), frappe.DoesNotExistError)
    return {
        **summary,
        "creation": str(frappe.db.get_value(PAYEE_DOCTYPE, name, "creation")),
        "locked": is_paid(name),
        "holder_name_changed_on": holder_name_changed_on(name),
        "linked_vendors": linked_vendors(name),
        "linked_expenses": linked_expenses(name),
    }
