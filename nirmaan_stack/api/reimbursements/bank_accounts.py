# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The logged-in user's own bank account, for the Raise Reimbursement dialog and the profile's Payee tab.

Every rule is the Payee module's (`services/payees/own_accounts`): the account is the Payee in the person's
`Nirmaan Users.payee` field, one per person, and only the person sets it, from here.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.own_accounts import (
    ADDED,
    ALREADY_YOURS,
    LINKED,
    add_own_account,
    edit_own_account,
    my_account,
    person_of,
)
from nirmaan_stack.services.reimbursements.access import sees_all_claims

OUTCOME_MESSAGES = {
    ADDED: "Bank account saved. Your claims are repaid into it.",
    LINKED: "This account was already on record with nobody's name on it. It's now yours.",
    ALREADY_YOURS: "This is already your bank account.",
}


@frappe.whitelist()
def my_bank_account() -> dict | None:
    """The caller's bank account: `name` plus the account holder, number, IFSC, bank and branch; or None."""
    return my_account(frappe.session.user)


@frappe.whitelist()
def bank_account_of(user: str) -> dict | None:
    """A person's bank account, for the Payee tab on their profile.

    The person themselves, and the profiles that see every claim (Admin, HR, Accounts), may read it --
    the same people who see that person's reimbursements. Anyone else is refused.
    """
    caller = frappe.session.user
    if person_of(user) != person_of(caller) and not sees_all_claims(caller):
        frappe.throw(_("Only the person, Admin, HR or Accounts can see someone's bank account."), frappe.PermissionError)
    return my_account(user)


@frappe.whitelist(methods=["POST"])
def add_my_bank_account(account_name, account_number, ifsc) -> dict:
    """Save the caller's bank account. Returns `{payee, outcome, message, account}`.

    Refused when the caller already has a different account (they edit theirs instead), and for an account
    that is another person's. The IFSC is looked up, so the bank and branch are never typed.
    """
    user = frappe.session.user
    payee, outcome = add_own_account(user, account_name, account_number, ifsc)
    frappe.db.commit()
    return {
        "payee": payee,
        "outcome": outcome,
        "message": _(OUTCOME_MESSAGES[outcome]),
        "account": my_account(user),
    }


@frappe.whitelist(methods=["POST"])
def edit_my_bank_account(payee, account_name, account_number, ifsc) -> dict:
    """Correct the caller's own bank account (holder name, number, IFSC). Returns `{payee, account}`,
    or `{duplicate, message, account}` when another Payee already holds the new account (nothing is saved).
    Refused for someone else's account, and for one a Vendor is also paid into."""
    user = frappe.session.user
    reply = edit_own_account(user, payee, account_name, account_number, ifsc)
    frappe.db.commit()
    return {**reply, "account": my_account(user)}
