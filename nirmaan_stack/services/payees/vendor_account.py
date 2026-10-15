# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A vendor's bank account is its Payee (#1428, spec #1420, ADR-0033). Read-only.

The one place "this vendor's bank details" is resolved: the hover card, the detail popover, the
payment-request gate and its "Will be paid into" box, and the vendor list, and on the server Bulk
Import's vendor index (refund suggestions), the "account changed since" flag (`paid_to`) and a
cheque's holder-name check in the payment autofill, all read it from here, never from the old
`Vendors` bank fields and never by joining `tabPayee` themselves.

A vendor's account is the Payee it links to NOW. A vendor with no Payee has no bank account. Every
PO / WO payment and expense holds its own copy of the account it was raised with (`pay_to`,
ADR-0033 decision 9), so a vendor's account read here is never what an existing row pays into: it
is what the next row copies, and what `paid_to` compares a PO / WO payment's copy against.

* `payee_for_vendor` -- the name of the Payee one vendor is paid into (the expense rules, Change
  account).
* `vendor_account` -- one vendor's Payee as a summary, with how many other vendors share it: the
  vendor page's Account Details card and every screen's single-vendor read, the Expense Request's
  vendor Payee among them.
* `vendor_accounts` -- many vendors' account fields at once: the vendor list, Bulk Import's vendor
  index, `paid_to`'s "account changed since" flag and the payment autofill's cheque check.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.payees.links import payee_summary
from nirmaan_stack.services.payees.rules import ACCOUNT_FIELDS

#: What a screen shows of a vendor's Payee: its name and its account.
VENDOR_ACCOUNT_FIELDS = ("payee", *ACCOUNT_FIELDS)


def vendor_accounts(vendors: list[str] | None = None) -> dict[str, dict]:
    """Each named vendor's Payee: `{vendor: {payee, account_name, account_number, ifsc, bank_name,
    bank_branch}}`; every vendor that has one when `vendors` is None. A vendor with no Payee
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
        SELECT v.name AS vendor, p.name AS payee, {", ".join(f"p.{field}" for field in ACCOUNT_FIELDS)}
        FROM "tabVendors" v
        JOIN "tabPayee" p ON p.name = v.payee
        {where}
        """,
        params,
        as_dict=True,
    )
    return {row.vendor: {field: row[field] for field in VENDOR_ACCOUNT_FIELDS} for row in rows}


def payee_for_vendor(vendor: str) -> str | None:
    """The Payee a vendor is paid into today, or None when it has none."""
    return frappe.db.get_value("Vendors", vendor, "payee") or None


def vendor_account(vendor: str) -> dict:
    """One vendor's Payee: `{vendor_name, payee: <links.payee_summary> | None, other_vendors}`,
    `other_vendors` being how many other vendors are paid into the same Payee."""
    vendor_name, payee = frappe.db.get_value("Vendors", vendor, ["vendor_name", "payee"]) or (None, None)
    summary = payee_summary(payee) if payee else None
    return {
        "vendor_name": vendor_name,
        "payee": summary,
        "other_vendors": summary["vendors"] - 1 if summary else 0,
    }
