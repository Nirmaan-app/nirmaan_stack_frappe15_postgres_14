# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A vendor's bank account is its Payee (#1428, spec #1420, ADR-0033). Read-only.

The one place "this vendor's bank details" is resolved: the hover card, the detail popover, the
payment-request gate, the bank file and the vendor list, and on the server Bulk Import's vendor
index (Tier 1, refund suggestions) and the payment autofill's holder-name check (#1427), all read it
from here, never from the old `Vendors` bank fields and never by joining `tabPayee` themselves.

A vendor is paid into the Payee it links to NOW (a PO / WO payment stores no Payee: ADR-0033
"Not in v1"). A vendor with no Payee has no bank account.
"""

from __future__ import annotations

import frappe

#: What a screen shows of a vendor's Payee.
VENDOR_ACCOUNT_FIELDS = ("payee", "account_name", "account_number", "ifsc", "bank_name", "bank_branch", "status")


def vendor_accounts(vendors: list[str] | None = None) -> dict[str, dict]:
    """Each named vendor's Payee: `{vendor: {payee, account_name, account_number, ifsc, bank_name,
    bank_branch, status}}`; every vendor that has one when `vendors` is None. A vendor with no Payee
    (or no such vendor) is left out. A Payee shared by several vendors appears under each of them; a
    vendor's previous Payees never appear."""
    where, params = "", {}
    if vendors is not None:
        vendors = [v for v in vendors if v]
        if not vendors:
            return {}
        where, params = "WHERE v.name IN %(vendors)s", {"vendors": tuple(vendors)}
    rows = frappe.db.sql(
        f"""
        SELECT v.name AS vendor, p.name AS payee, p.account_name, p.account_number, p.ifsc,
               p.bank_name, p.bank_branch, p.status
        FROM "tabVendors" v
        JOIN "tabPayee" p ON p.name = v.payee
        {where}
        """,
        params,
        as_dict=True,
    )
    return {row.vendor: {field: row[field] for field in VENDOR_ACCOUNT_FIELDS} for row in rows}
