# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""THE Payee writer: the only code that creates a Payee (spec #1420, ADR-0033).

Every screen that adds a Payee (the Payees page, and later the vendor screens and the Expense
Request) calls `create_payee` from its own endpoint, after its own role check: who may add a Payee
depends on the screen, so this module checks no role. Nothing here commits; the caller does.

* `create_payee` -- validate, refuse a duplicate (naming the existing Payee), look up the IFSC
  (refusing one the lookup can't find), insert at Active.
* `existing_payee` -- the Payee already holding an account number + IFSC, if any. A screen asks it
  before submit to show the duplicate block; the Payee `validate` controller asks it on every save.
* `assert_not_duplicate` -- the refusal itself, shared by `create_payee` and the controller.

The rules themselves are pure, in `services/payees/rules.py`; links and "paid" are in
`services/payees/links.py`; the IFSC lookup is `services/payees/ifsc.py`.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.ifsc import lookup_ifsc
from nirmaan_stack.services.payees.rules import (
    ACTIVE,
    PAYEE_DOCTYPE,
    PayeeDetails,
    details_problem,
    duplicate_problem,
    parse_details,
)


class DuplicatePayeeError(frappe.ValidationError):
    """The account number + IFSC already belong to a Payee. The message names it; so does `existing`
    on an instance raised by `assert_not_duplicate` (Frappe's `throw` raises the bare class)."""


def existing_payee(details: PayeeDetails, *, exclude: str | None = None) -> str | None:
    """The name of the Payee holding the same account (spaces, dashes and leading zeros ignored) at
    the same IFSC, at any status, or None."""
    if not details.account_number or not details.ifsc:
        return None
    filters = {"normalized_account": details.normalized_account, "ifsc": details.ifsc}
    if exclude:
        filters["name"] = ["!=", exclude]
    return frappe.db.get_value(PAYEE_DOCTYPE, filters, "name")


def assert_not_duplicate(details: PayeeDetails, *, exclude: str | None = None) -> None:
    """Raise `DuplicatePayeeError` naming the Payee that already holds this account + IFSC."""
    existing = existing_payee(details, exclude=exclude)
    if existing:
        holder = frappe.db.get_value(PAYEE_DOCTYPE, existing, "account_name")
        error = DuplicatePayeeError(_(duplicate_problem(existing, holder)))
        error.existing = existing
        raise error


def create_payee(account_name, account_number, ifsc):
    """Insert a new Active Payee for this bank account and return it.

    Refuses incomplete or malformed details, an account + IFSC another Payee holds
    (`DuplicatePayeeError`, carrying `existing`), and an IFSC the lookup can't find
    (`ifsc.IfscLookupError`); bank and branch come from the lookup, never from the caller. Writes
    with `ignore_permissions`: the calling endpoint's role check is the boundary. Never commits.
    """
    details = parse_details(account_name, account_number, ifsc)
    problem = details_problem(details)
    if problem:
        frappe.throw(_(problem))
    assert_not_duplicate(details)
    branch = lookup_ifsc(details.ifsc)
    doc = frappe.get_doc({
        "doctype": PAYEE_DOCTYPE,
        "account_name": details.account_name,
        "account_number": details.account_number,
        "ifsc": details.ifsc,
        "bank_name": branch.bank_name,
        "bank_branch": branch.bank_branch,
        "status": ACTIVE,
    })
    doc.insert(ignore_permissions=True)
    return doc
