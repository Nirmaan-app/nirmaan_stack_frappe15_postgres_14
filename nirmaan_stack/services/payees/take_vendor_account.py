# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A PO / WO payment is paid into its vendor's current account (#1463, spec #1420, ADR-0033
decision 9, revised 2026-10-16).

When a PO / WO payment whose vendor's Payee changed since it was raised, or that was raised with
no copy, is put in a bank file or marked paid, its pay-to account is first replaced by the vendor's
account, so the copy records the account the money actually went to. Which payments switch, and
to what, is `paid_to.vendor_account_to_take`, read through `paid_to.paid_to_rows`; this only writes
it.

* `take_vendor_accounts` -- write the vendor's account onto each named payment that switches.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.paid_to import PAYMENT_DOCTYPE, paid_to_rows, row_facts
from nirmaan_stack.services.payees.pay_to import copy_vendor_account

#: The one status a payment is paid from: Export for Payment and Mark as Paid act on "Payment need to
#: paid", whose rows are Approved.
PAYABLE_STATUS = "Approved"


def take_vendor_accounts(names: list[str]) -> list[str]:
    """Replace each named PO / WO payment's pay-to account with its vendor's account where the
    payment switches to it (`paid_to_rows`' `switch_to`); leave the rest untouched. Returns the names
    switched, in order.

    Each payment is locked and read again first, and refused unless it is Approved, naming the
    status found: a paid payment's copy says where its money went. The save leaves the Version row
    that records who switched it and when (`ignore_version=False`, as Frappe skips it under tests
    otherwise). The caller checks write permission. Never commits."""
    switched = []
    for name in dict.fromkeys(names):
        doc = frappe.get_doc(PAYMENT_DOCTYPE, name, for_update=True)
        if doc.status != PAYABLE_STATUS:
            frappe.throw(_("{0} is {1}: only an Approved payment is paid into its vendor's account.")
                         .format(name, doc.status))
        if not paid_to_rows([row_facts(PAYMENT_DOCTYPE, doc)])[0]["switch_to"]:
            continue
        copy_vendor_account(doc)
        doc.save(ignore_permissions=True, ignore_version=False)
        switched.append(name)
    return switched
