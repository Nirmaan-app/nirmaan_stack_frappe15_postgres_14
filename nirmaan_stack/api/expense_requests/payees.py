# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The expense payee picker (spec #1420 ticket #1429, ADR-0033): the New Expense dialog's, and the
expense edit dialogs'.

Thin: check the caller can raise an expense, call the Payee module (`services/payees/`), commit.
Anyone who can raise one creates Payees only through here, and reads only what picking one needs.
(The Payees page's own endpoints, `api/payees/`, are Accounts only.)

* `search_payees` -- Payees by holder name or account number, by holder name.
* `check_request_payee` -- the Payee already holding an account + IFSC, before submit.
* `add_request_payee` -- add a Payee from the request. A duplicate comes back as data, so the picker
  points the raiser at that Payee instead.

Who: `access.can_name_expense_payee`: `can_raise_requests` (any requestable type visible to the
caller; Admin always). The ledgers' create right no longer counts: no person holds it (spec #1494, #1506).
The picked vendor's own Payee is read as every screen reads it, through
`api/payees/vendor_payee.get_vendor_account` (Vendors read, which the request's vendor picker needs too).
The IFSC's bank and branch come from `api/payees/add_payee.lookup_ifsc`, open to every signed-in user.
"""

import frappe

from nirmaan_stack.api.expense_requests.access import guard_can_name_expense_payee
from nirmaan_stack.services.payees.links import payee_summary
from nirmaan_stack.services.payees.pay_to import OWN_ACCOUNT_REFUSAL
from nirmaan_stack.services.payees.rules import PAYEE_TYPE_USERS
from nirmaan_stack.services.payees.search import find_payees
from nirmaan_stack.services.payees.writer import create_payee, duplicate_verdict, unless_duplicate


@frappe.whitelist()
def search_payees(text: str | None = None, limit: int = 8) -> list[dict]:
    """Payees matching `text` (holder name, or account number ignoring spaces and leading zeros), by
    holder name: `[{name, account_name, account_number, ifsc, bank_name, bank_branch, payee_type}]`.
    A person's own account (payee type Users, their reimbursements') is never offered here (owner,
    2026-10-27); Accounts' Change account search (`api/payees/paid_to`) still lists it."""
    guard_can_name_expense_payee()
    return find_payees(text, limit=limit, exclude_type=PAYEE_TYPE_USERS)


@frappe.whitelist()
def check_request_payee(account_number: str, ifsc: str) -> dict:
    """The Payee already holding this account number + IFSC: `{duplicate: <summary> | None, message}`."""
    guard_can_name_expense_payee()
    return _refuse_own_account(duplicate_verdict(account_number, ifsc))


@frappe.whitelist(methods=["POST"])
def add_request_payee(account_name: str, account_number: str, ifsc: str) -> dict:
    """Create a Payee from the request: `{payee: <summary>}`, or `{duplicate: <summary>,
    message}` when the account + IFSC already belong to a Payee (nothing is created then)."""
    guard_can_name_expense_payee()
    doc, duplicate = unless_duplicate(lambda: create_payee(account_name, account_number, ifsc))
    if duplicate:
        return _refuse_own_account(duplicate)
    frappe.db.commit()
    return {"payee": payee_summary(doc.name)}


def _refuse_own_account(reply: dict) -> dict:
    """A duplicate that is a person's own account (Users) can't be picked instead: its message says
    so (owner, 2026-10-27). The screen shows the refusal in the duplicate block, with no Pick button."""
    dup = reply.get("duplicate")
    if dup and dup.get("payee_type") == PAYEE_TYPE_USERS:
        return {**reply, "message": OWN_ACCOUNT_REFUSAL}
    return reply

