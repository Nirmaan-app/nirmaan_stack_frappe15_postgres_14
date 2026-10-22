# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which vendors a Payee serves (spec #1420, ADR-0033). Read-only.

A Payee is an address book entry (#1434): nothing paid points back at it, so the only thing it is
linked to is the `Vendors` whose `payee` is the Payee. An expense or a payment holds its own copy of
the account, not a link, so a Payee has no "linked expenses", "last paid" or "times paid".

`PAYEES_WITH_LINKS_SQL` is the one query behind the vendor count: the Payees list (`api/payees/
list_payees`) filters and sorts over it, and `payee_summaries` reads single Payees from it.

One Payee's page (#1423, #1435) reads `payee_page`: the summary, when and by whom its holder name and
its account last changed (`last_changed`), and the vendors behind the count (`linked_vendors`).

A vendor's Payee is `vendor_account`'s, not this module's.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.payees.rules import PAYEE_DOCTYPE
from nirmaan_stack.services.payees.versions import changed_field_pattern, last_field_change

#: One row per Payee: its own fields plus `vendors`, how many vendors link to it. The vendor table is
#: grouped once, so the list costs one pass over it, not one per Payee.
PAYEES_WITH_LINKS_SQL = """
    SELECT p.name, p.creation, p.account_name, p.account_number, p.normalized_account, p.ifsc,
           p.bank_name, p.bank_branch,
           COALESCE(v.vendors, 0) AS vendors
    FROM "tabPayee" p
    LEFT JOIN (
        SELECT payee, COUNT(*) AS vendors FROM "tabVendors" WHERE payee IS NOT NULL GROUP BY payee
    ) v ON v.payee = p.name
"""


def payee_summaries(names: list[str]) -> dict[str, dict]:
    """Each named Payee's fields with its vendor count: `{name: {name, account_name, account_number,
    ifsc, bank_name, bank_branch, vendors}}`. A name with no Payee is left out."""
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
    return {
        "name": row["name"],
        "account_name": row.get("account_name"),
        "account_number": row.get("account_number"),
        "ifsc": row.get("ifsc"),
        "bank_name": row.get("bank_name"),
        "bank_branch": row.get("bank_branch"),
        "vendors": int(row.get("vendors") or 0),
    }


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


def last_changed(name: str, *fields: str) -> dict | None:
    """When and by whom any of `fields` of Payee `name` last changed, from its Version history:
    `{on: ISO date, by: full name}`, or None when none ever did (#1435)."""
    changes = [c for c in (last_field_change(PAYEE_DOCTYPE, name, f) for f in fields) if c]
    if not changes:
        return None
    latest = max(changes, key=lambda c: c.creation)
    return {"on": str(latest.creation.date()), "by": frappe.utils.get_fullname(latest.owner)}


def payee_page(name: str) -> dict:
    """Everything one Payee's page shows: `payee_summary`'s fields plus `creation`,
    `holder_name_changed` and `account_changed` (`last_changed`: the account is its number or IFSC),
    `linked_vendors` and `linked_user` (the person it is an own bank account of). Refuses a name with no Payee."""
    summary = payee_summary(name)
    if not summary:
        frappe.throw(frappe._("Payee {0} not found.").format(name), frappe.DoesNotExistError)
    return {
        **summary,
        "creation": str(frappe.db.get_value(PAYEE_DOCTYPE, name, "creation")),
        "holder_name_changed": last_changed(name, "account_name"),
        "account_changed": last_changed(name, "account_number", "ifsc"),
        "linked_vendors": linked_vendors(name),
        "linked_user": linked_user(name),
    }


def linked_user(name: str) -> dict | None:
    """The person whose own bank account Payee `name` is (`Nirmaan Users.payee`, ADR-0033 Amendment A), or
    None: `{name, full_name, role_profile}`. At most one person holds a Payee (`own_accounts.check_own_account`)."""
    return frappe.db.get_value(
        "Nirmaan Users", {"payee": name}, ["name", "full_name", "role_profile"], as_dict=True, order_by="creation asc",
    )
