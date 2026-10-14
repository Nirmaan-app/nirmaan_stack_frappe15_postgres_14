# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The vendor screens' Payee step (#1425, spec #1420, ADR-0033): what the new-vendor form (and the
vendor page's Change account, #1426) asks the server before Submit.

Thin: check who is asking, call the Payee module (`services/payees/`). Read-only; the vendor is
linked by the endpoint that saves it (`api/create_vendor_and_address`), through
`services/payees/choosing.choose_payee`.

* `suggest_vendor_payees` -- "Payees that look like this vendor".
* `get_payee_choice` -- what the confirmation lists before a vendor is pointed at a Payee.
* `check_vendor_payee` -- the duplicate block before submit, as `add_payee.check_payee` gives it.

Who: `services/role_profiles.VENDOR_PAYEE_PROFILES` (the people who may create a vendor).
"""

import frappe
from frappe import _

from nirmaan_stack.api.payees.add_payee import duplicate_verdict
from nirmaan_stack.services.payees.choosing import payee_choice, suggest_for_vendor
from nirmaan_stack.services.role_profiles import assert_vendor_payee_access


@frappe.whitelist()
def suggest_vendor_payees(vendor_name: str | None = None, vendor_pan: str | None = None) -> dict:
    """`{suggestions: [choice + match]}`: Active Payees that look like a vendor with this name and
    PAN, best first (`choosing.suggest_for_vendor`). `match` is `strong` (a linked vendor has the same
    PAN) or `name_only`."""
    assert_vendor_payee_access(frappe.session.user)
    return {"suggestions": suggest_for_vendor(vendor_name, vendor_pan)}


@frappe.whitelist()
def get_payee_choice(payee: str) -> dict:
    """One Payee with every linked vendor and expense and its last payment (`choosing.payee_choice`)."""
    assert_vendor_payee_access(frappe.session.user)
    choice = payee_choice(payee)
    if choice is None:
        frappe.throw(_("Payee {0} does not exist.").format(payee), frappe.DoesNotExistError)
    return choice


@frappe.whitelist()
def check_vendor_payee(account_number: str, ifsc: str) -> dict:
    """The Payee already holding this account number + IFSC: `{duplicate: <summary> | None, message}`."""
    assert_vendor_payee_access(frappe.session.user)
    return duplicate_verdict(account_number, ifsc)
