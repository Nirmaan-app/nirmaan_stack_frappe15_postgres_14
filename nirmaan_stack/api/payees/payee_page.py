# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One Payee's page (#1423, #1434, spec #1420, ADR-0033): read it, fix its holder name.

Thin: check who is asking, call the Payee module (`services/payees/`), commit. The rules are the
module's and the `validate` controller's.

* `get_payee` -- the page: `services/payees/links.payee_page`.
* `edit_holder_name` -- a new holder name.

Who: `PAYEE_MANAGE_PROFILES` (Admin, Accountant, Accountant Lead), who manage Payees on this page. A
Payee itself carries no role rule: the vendor screens edit a vendor's Payee through their own
endpoints.
"""

import frappe

from nirmaan_stack.services.payees import writer
from nirmaan_stack.services.payees.links import payee_page, payee_summary
from nirmaan_stack.services.role_profiles import assert_payee_manager


@frappe.whitelist()
def get_payee(name: str) -> dict:
    """Payee `name` as its page shows it: its fields, `vendors`, `creation`, `holder_name_changed_on`
    and `linked_vendors`."""
    assert_payee_manager(frappe.session.user)
    return payee_page(name)


@frappe.whitelist(methods=["POST"])
def edit_holder_name(name: str, account_name: str) -> dict:
    """Save a new holder name on Payee `name`. Returns `{payee: <summary>}`."""
    assert_payee_manager(frappe.session.user)
    writer.edit_holder_name(name, account_name)
    frappe.db.commit()
    return {"payee": payee_summary(name)}

