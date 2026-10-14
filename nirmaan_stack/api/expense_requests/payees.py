# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Expense Request's payee picker (spec #1420 ticket #1429, ADR-0033).

Thin: check the caller can raise an expense request, call the Payee module (`services/payees/`),
commit. Anyone who can raise a request creates Payees only through here, and reads only what picking
one needs. (The Payees page's own endpoints, `api/payees/`, are Accounts only.)

* `search_payees` -- Active Payees by holder name or account number, with how often each was paid.
* `check_request_payee` -- the Payee already holding an account + IFSC, before submit.
* `add_request_payee` -- add a Payee from the request. A duplicate comes back as data, so the picker
  points the raiser at that Payee instead.
* `get_vendor_payee` -- the vendor's own Payee, which the request fills in when a vendor is picked.

Who: `access.can_raise_requests` (any requestable type visible to the caller; Admin always).
The IFSC's bank and branch come from `api/payees/add_payee.lookup_ifsc`, open to every signed-in user.
"""

import frappe

from nirmaan_stack.api.expense_requests.access import guard_can_raise
from nirmaan_stack.services.payees.links import payee_for_vendor, payee_summary
from nirmaan_stack.services.payees.rules import duplicate_problem, parse_details
from nirmaan_stack.services.payees.search import search_active_payees
from nirmaan_stack.services.payees.writer import DuplicatePayeeError, create_payee, existing_payee


@frappe.whitelist()
def search_payees(text: str | None = None, limit: int = 8) -> list[dict]:
    """Active Payees matching `text` (holder name, or account number ignoring spaces and leading
    zeros), most-paid first: `[{name, account_name, account_number, ifsc, bank_name, bank_branch,
    status, times_paid}]`."""
    guard_can_raise()
    return search_active_payees(text, limit=limit)


@frappe.whitelist()
def check_request_payee(account_number: str, ifsc: str) -> dict:
    """The Payee already holding this account number + IFSC: `{duplicate: <summary> | None, message}`."""
    guard_can_raise()
    existing = existing_payee(parse_details("", account_number, ifsc))
    if not existing:
        return {"duplicate": None, "message": None}
    summary = payee_summary(existing)
    return {"duplicate": summary, "message": duplicate_problem(existing, summary["account_name"])}


@frappe.whitelist(methods=["POST"])
def add_request_payee(account_name: str, account_number: str, ifsc: str) -> dict:
    """Create an Active Payee from the request: `{payee: <summary>}`, or `{duplicate: <summary>,
    message}` when the account + IFSC already belong to a Payee (nothing is created then)."""
    guard_can_raise()
    try:
        doc = create_payee(account_name, account_number, ifsc)
    except DuplicatePayeeError as e:
        frappe.db.rollback()
        return {"duplicate": payee_summary(e.existing), "message": str(e)}
    frappe.db.commit()
    return {"payee": payee_summary(doc.name)}


@frappe.whitelist()
def get_vendor_payee(vendor: str) -> dict:
    """`{vendor, vendor_name, payee: <summary> | None}`: the Payee the vendor is paid into today."""
    guard_can_raise()
    payee = payee_for_vendor(vendor) if vendor else None
    return {
        "vendor": vendor,
        "vendor_name": frappe.db.get_value("Vendors", vendor, "vendor_name") if vendor else None,
        "payee": payee_summary(payee) if payee else None,
    }
