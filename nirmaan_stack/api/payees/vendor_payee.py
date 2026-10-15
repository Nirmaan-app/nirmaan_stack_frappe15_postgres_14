# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The vendor screens' Payee step (#1425, #1426, spec #1420, ADR-0033): what the new-vendor form and
the vendor page's Account Details card ask the server.

Thin: check who is asking, call the Payee module (`services/payees/`). A new vendor is linked by
the endpoint that saves it (`api/create_vendor_and_address`); an existing one by
`change_vendor_payee`. Both go through `services/payees/choosing.choose_payee`.

* `suggest_vendor_payees` -- "Payees that look like this vendor".
* `get_payee_choice` -- what the confirmation lists before a vendor is pointed at a Payee.
* `check_vendor_payee` -- the duplicate block before submit, as `add_payee.check_payee` gives it.
* `get_vendor_account` -- the vendor page's Account Details card (#1426).
* `edit_vendor_payee` -- its Edit bank details and the rename prompt's "Update the holder name": the
  vendor's Payee edited in place (#1435).
* `change_vendor_payee` -- its Use a different payee and Add bank details (#1426, #1435).

Who: `services/role_profiles.VENDOR_PAYEE_PROFILES` (the people who may create a vendor), except
`get_vendor_account`, which anyone who may read the vendor may call.
"""

import frappe
from frappe import _

from nirmaan_stack.services.payees.choosing import link_vendor, payee_choice, suggest_for_vendor
from nirmaan_stack.services.payees.links import payee_summary
from nirmaan_stack.services.payees.vendor_account import payee_for_vendor, vendor_account
from nirmaan_stack.services.payees.writer import duplicate_verdict, edit_payee, unless_duplicate
from nirmaan_stack.services.role_profiles import assert_vendor_payee_access


@frappe.whitelist()
def suggest_vendor_payees(vendor_name: str | None = None, vendor_pan: str | None = None) -> dict:
    """`{suggestions: [choice + match]}`: Payees that look like a vendor with this name and
    PAN, best first (`choosing.suggest_for_vendor`). `match` is `strong` (a linked vendor has the same
    PAN) or `name_only`."""
    assert_vendor_payee_access(frappe.session.user)
    return {"suggestions": suggest_for_vendor(vendor_name, vendor_pan)}


@frappe.whitelist()
def get_payee_choice(payee: str) -> dict:
    """One Payee with every vendor already linked to it (`choosing.payee_choice`)."""
    assert_vendor_payee_access(frappe.session.user)
    choice = payee_choice(payee)
    if choice is None:
        frappe.throw(_("Payee {0} does not exist.").format(payee), frappe.DoesNotExistError)
    return choice


@frappe.whitelist()
def check_vendor_payee(account_number: str, ifsc: str, exclude: str | None = None) -> dict:
    """The Payee already holding this account number + IFSC: `{duplicate: <summary> | None, message}`.
    `exclude` is the Payee being edited (#1435), which keeps its own account."""
    assert_vendor_payee_access(frappe.session.user)
    return duplicate_verdict(account_number, ifsc, exclude=exclude or None)


@frappe.whitelist()
def get_vendor_account(vendor: str) -> dict:
    """One vendor's account: `{payee: <summary> | None, other_vendors}` (`vendor_account.vendor_account`):
    the vendor page's Account Details card and every screen that reads one vendor's bank account.
    Anyone who may read the vendor may read the account it is paid into."""
    frappe.has_permission("Vendors", "read", doc=vendor, throw=True)
    return vendor_account(vendor)


@frappe.whitelist(methods=["POST"])
def edit_vendor_payee(vendor: str, account_name: str, account_number: str, ifsc: str) -> dict:
    """Edit bank details on the vendor page, and the rename prompt's "Update the holder name" (#1435):
    the vendor's own Payee edited in place (`writer.edit_payee`), so every vendor paid into it follows.
    Refused for a vendor with no Payee (Add bank details is `change_vendor_payee`).

    Returns `{payee: <summary>}`, or `{duplicate: <summary>, message}` when another Payee already holds
    the account; nothing changes then."""
    assert_vendor_payee_access(frappe.session.user)
    payee = payee_for_vendor(vendor)
    if not payee:
        frappe.throw(_("{0} has no bank account to edit. Add bank details instead.").format(vendor))
    _done, duplicate = unless_duplicate(lambda: edit_payee(payee, account_name, account_number, ifsc))
    if duplicate:
        return duplicate
    frappe.db.commit()
    return {"payee": payee_summary(payee)}


@frappe.whitelist(methods=["POST"])
def change_vendor_payee(vendor: str, payee: str | None = None, bank: dict | None = None) -> dict:
    """Use a different payee / Add bank details on the vendor page (#1426, #1435): point `vendor` at `payee` (an
    existing Payee, through the confirmation) or at new `bank` details (`{account_name, account_number,
    ifsc}`) made into a Payee (`choosing.link_vendor`). The other vendors on its old Payee keep it.

    Returns `{payee: <summary>}`, or `{duplicate: <summary>, message}` when the bank details belong to
    a Payee already; nothing changes then."""
    assert_vendor_payee_access(frappe.session.user)
    linked, duplicate = unless_duplicate(lambda: link_vendor(vendor, payee, bank))
    if duplicate:
        return duplicate
    frappe.db.commit()
    return {"payee": payee_summary(linked)}
