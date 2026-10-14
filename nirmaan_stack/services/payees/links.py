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

`PAYEES_WITH_LINKS_SQL` is the one query behind all of this: the Payees list (`api/payees/
list_payees`) filters and sorts over it, and `payee_summaries` reads single Payees from it.

**A vendor's account** is the account of the Payee it links to now (`vendor_accounts`). Bulk Import's
vendor index and the payment autofill's holder-name check read it there, never from a vendor field.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.payees.rules import PAID_STATUSES

_PAID = ", ".join(f"'{status}'" for status in PAID_STATUSES)

#: One row per Payee: its own fields plus `vendors`, `expenses` (counts) and `last_paid` (a date or NULL).
#: Each link table is grouped once, so the list costs one pass over each, not one per Payee.
PAYEES_WITH_LINKS_SQL = f"""
    SELECT p.name, p.creation, p.account_name, p.account_number, p.normalized_account, p.ifsc,
           p.bank_name, p.bank_branch, p.status,
           COALESCE(v.vendors, 0) AS vendors,
           COALESCE(e.expenses, 0) AS expenses,
           GREATEST(vp.last_paid, e.last_paid) AS last_paid
    FROM "tabPayee" p
    LEFT JOIN (
        SELECT payee, COUNT(*) AS vendors FROM "tabVendors" WHERE payee IS NOT NULL GROUP BY payee
    ) v ON v.payee = p.name
    LEFT JOIN (
        SELECT vv.payee, MAX(COALESCE(pp.payment_date, pp.modified::date)) AS last_paid
        FROM "tabProject Payments" pp
        JOIN "tabVendors" vv ON vv.name = pp.vendor
        WHERE vv.payee IS NOT NULL AND pp.status IN ({_PAID})
        GROUP BY vv.payee
    ) vp ON vp.payee = p.name
    LEFT JOIN (
        SELECT x.payee, COUNT(*) AS expenses,
               MAX(COALESCE(x.payment_date, x.modified::date)) FILTER (WHERE x.status IN ({_PAID})) AS last_paid
        FROM (
            SELECT payee, status, payment_date, modified FROM "tabProject Expenses" WHERE payee IS NOT NULL
            UNION ALL
            SELECT payee, status, payment_date, modified FROM "tabNon Project Expenses" WHERE payee IS NOT NULL
        ) x
        GROUP BY x.payee
    ) e ON e.payee = p.name
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
        f"""
        SELECT 1 FROM "tabProject Payments" pp JOIN "tabVendors" v ON v.name = pp.vendor
        WHERE v.payee = %(name)s AND pp.status IN ({_PAID})
        UNION ALL
        SELECT 1 FROM "tabProject Expenses" WHERE payee = %(name)s AND status IN ({_PAID})
        UNION ALL
        SELECT 1 FROM "tabNon Project Expenses" WHERE payee = %(name)s AND status IN ({_PAID})
        LIMIT 1
        """,
        {"name": name},
    ))


def payee_for_vendor(vendor: str) -> str | None:
    """The Payee a vendor is paid into today, or None when it has none."""
    return frappe.db.get_value("Vendors", vendor, "payee") or None


def vendor_accounts(vendors: list[str] | None = None) -> list[dict]:
    """Each vendor with the account it is paid into today: `{name, vendor_name, payee, account_name,
    account_number, ifsc}`, the last four read from its Payee and None when it has none. Every vendor
    when `vendors` is None. A Payee shared by several vendors appears once per vendor; a vendor's
    previous Payees do not appear at all (ADR-0033)."""
    where, params = "", {}
    if vendors is not None:
        if not vendors:
            return []
        where, params = "WHERE v.name IN %(vendors)s", {"vendors": tuple(vendors)}
    return frappe.db.sql(
        f"""
        SELECT v.name, v.vendor_name, v.payee, p.account_name, p.account_number, p.ifsc
        FROM "tabVendors" v
        LEFT JOIN "tabPayee" p ON p.name = v.payee
        {where}
        """,
        params,
        as_dict=True,
    )
