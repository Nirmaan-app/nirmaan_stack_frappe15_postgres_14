# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One Payee's page (#1423, spec #1420, ADR-0033): read it, fix its holder name, mark it Inactive or
Active.

Thin: check who is asking, call the Payee module (`services/payees/`), commit. The rules (the lock,
who may change a holder name, what Inactive means) are the module's and the `validate` controllers'.

* `get_payee` -- the page: `services/payees/links.payee_page`.
* `edit_holder_name` -- a new holder name; the account number and IFSC never change here.
* `set_payee_status` -- Active or Inactive.

Who: `PAYEE_MANAGE_PROFILES` (Admin, Accountant, Accountant Lead), the same people the holder-name
rule allows.
"""

import frappe

from nirmaan_stack.services.payees import writer
from nirmaan_stack.services.payees.links import payee_page, payee_summary
from nirmaan_stack.services.role_profiles import assert_payee_manager


@frappe.whitelist()
def get_payee(name: str) -> dict:
    """Payee `name` as its page shows it: its fields, `vendors`, `expenses`, `last_paid`, `creation`,
    `locked`, `holder_name_changed_on`, `linked_vendors` and `linked_expenses`."""
    assert_payee_manager(frappe.session.user)
    return payee_page(name)


@frappe.whitelist(methods=["POST"])
def edit_holder_name(name: str, account_name: str) -> dict:
    """Save a new holder name on Payee `name`. Returns `{payee: <summary>}`."""
    assert_payee_manager(frappe.session.user)
    writer.edit_holder_name(name, account_name)
    frappe.db.commit()
    return {"payee": payee_summary(name)}


@frappe.whitelist(methods=["POST"])
def set_payee_status(name: str, status: str) -> dict:
    """Mark Payee `name` Active or Inactive. Returns `{payee: <summary>}`."""
    assert_payee_manager(frappe.session.user)
    writer.set_status(name, status)
    frappe.db.commit()
    return {"payee": payee_summary(name)}
