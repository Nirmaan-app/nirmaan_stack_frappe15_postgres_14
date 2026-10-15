# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Expense Request's payee picker (spec #1420 ticket #1429, ADR-0033).

Thin: check the caller can raise an expense request, call the Payee module (`services/payees/`),
commit. Anyone who can raise a request creates Payees only through here, and reads only what picking
one needs. (The Payees page's own endpoints, `api/payees/`, are Accounts only.)

* `search_payees` -- Payees by holder name or account number, by holder name.
* `check_request_payee` -- the Payee already holding an account + IFSC, before submit.
* `add_request_payee` -- add a Payee from the request. A duplicate comes back as data, so the picker
  points the raiser at that Payee instead.

Who: `access.can_raise_requests` (any requestable type visible to the caller; Admin always).
The picked vendor's own Payee is read as every screen reads it, through
`api/payees/vendor_payee.get_vendor_account` (Vendors read, which the request's vendor picker needs too).
The IFSC's bank and branch come from `api/payees/add_payee.lookup_ifsc`, open to every signed-in user.
"""

import frappe

from nirmaan_stack.api.expense_requests.access import guard_can_raise
from nirmaan_stack.services.payees.links import payee_summary
from nirmaan_stack.services.payees.search import find_payees
from nirmaan_stack.services.payees.writer import create_payee, duplicate_verdict, unless_duplicate


@frappe.whitelist()
def search_payees(text: str | None = None, limit: int = 8) -> list[dict]:
    """Payees matching `text` (holder name, or account number ignoring spaces and leading zeros), by
    holder name: `[{name, account_name, account_number, ifsc, bank_name, bank_branch}]`."""
    guard_can_raise()
    return find_payees(text, limit=limit)


@frappe.whitelist()
def check_request_payee(account_number: str, ifsc: str) -> dict:
    """The Payee already holding this account number + IFSC: `{duplicate: <summary> | None, message}`."""
    guard_can_raise()
    return duplicate_verdict(account_number, ifsc)


@frappe.whitelist(methods=["POST"])
def add_request_payee(account_name: str, account_number: str, ifsc: str) -> dict:
    """Create a Payee from the request: `{payee: <summary>}`, or `{duplicate: <summary>,
    message}` when the account + IFSC already belong to a Payee (nothing is created then)."""
    guard_can_raise()
    doc, duplicate = unless_duplicate(lambda: create_payee(account_name, account_number, ifsc))
    if duplicate:
        return duplicate
    frappe.db.commit()
    return {"payee": payee_summary(doc.name)}

