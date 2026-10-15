# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One Payee's page (#1423, #1434, #1435, spec #1420, ADR-0033): read it, edit it in place, delete it.

Thin: check who is asking, call the Payee module (`services/payees/`), commit. The rules are the
module's and the `validate` controller's.

* `get_payee` -- the page: `services/payees/links.payee_page`.
* `edit_payee` -- Edit: holder name, account number and IFSC (`writer.edit_payee_reply`).
* `delete_payee` -- Delete: only a Payee no vendor links to (`writer.delete_payee`).

Who: `PAYEE_MANAGE_PROFILES` (Admin, Accountant, Accountant Lead), who manage Payees on this page. A
Payee itself carries no role rule: the vendor screens edit a vendor's Payee through their own
endpoint (`vendor_payee.edit_vendor_payee`).
"""

import frappe

from nirmaan_stack.services.payees import writer
from nirmaan_stack.services.payees.links import payee_page
from nirmaan_stack.services.role_profiles import assert_payee_manager


@frappe.whitelist()
def get_payee(name: str) -> dict:
    """Payee `name` as its page shows it: its fields, `vendors`, `creation`, `holder_name_changed`,
    `account_changed` and `linked_vendors`."""
    assert_payee_manager(frappe.session.user)
    return payee_page(name)


@frappe.whitelist(methods=["POST"])
def edit_payee(name: str, account_name: str, account_number: str, ifsc: str) -> dict:
    """Save Payee `name`'s holder name, account number and IFSC. Returns `{payee: <summary>}`, or
    `{duplicate: <summary>, message}` when another Payee already holds the account; nothing changes
    then."""
    assert_payee_manager(frappe.session.user)
    reply = writer.edit_payee_reply(name, account_name, account_number, ifsc)
    frappe.db.commit()
    return reply


@frappe.whitelist(methods=["POST"])
def delete_payee(name: str) -> dict:
    """Delete Payee `name`. Refused, naming them, while any vendor links to it. Returns `{deleted: name}`."""
    assert_payee_manager(frappe.session.user)
    writer.delete_payee(name)
    frappe.db.commit()
    return {"deleted": name}
