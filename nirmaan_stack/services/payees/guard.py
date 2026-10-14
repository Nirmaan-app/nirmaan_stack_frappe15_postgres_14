# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Payee rules a save must pass, on EVERY write path (#1423, spec #1420, ADR-0033).

Called from `validate` controllers, so the Payees page, the vendor and expense screens, Desk, REST and
any other code meet the same refusals:

* `check_payee_save` (the Payee's own `validate`, on an existing Payee):
  - **Locked**: once the Payee is paid (`links.is_paid`), its account number and IFSC never change.
  - **Holder name**: only Accounts and Admins (`role_profiles.PAYEE_MANAGE_PROFILES`) may change it.
* `check_payee_pick` (the `validate` of `Vendors`, `Expense Request`, `Project Expenses` and
  `Non Project Expenses`): an **Inactive** Payee can't be newly picked. A record already pointing at
  it keeps it through any later save.

The wording is `services/payees/rules.py`'s.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.links import is_paid
from nirmaan_stack.services.payees.rules import (
    HOLDER_NAME_ROLE_PROBLEM,
    PAYEE_DOCTYPE,
    locked_change_problem,
    parse_details,
    pick_problem,
)
from nirmaan_stack.services.role_profiles import can_manage_payees


def check_payee_save(doc, user: str) -> None:
    """Refuse a save of an existing Payee that changes its holder name as anyone but Accounts or an
    Admin (`frappe.PermissionError`), or changes a paid Payee's account number or IFSC. `doc` holds the
    cleaned values (the controller cleans first)."""
    before_doc = doc.get_doc_before_save()
    if not before_doc:
        return
    before = parse_details(before_doc.account_name, before_doc.account_number, before_doc.ifsc)
    after = parse_details(doc.account_name, doc.account_number, doc.ifsc)
    if before.account_name != after.account_name and not can_manage_payees(user):
        raise frappe.PermissionError(_(HOLDER_NAME_ROLE_PROBLEM))
    problem = locked_change_problem(doc.name, before, after)
    if problem and is_paid(doc.name):
        frappe.throw(_(problem))


def check_payee_pick(doc) -> None:
    """Refuse a save that newly points `doc.payee` at an Inactive Payee. Unchanged links pass."""
    payee = doc.get("payee")
    if not payee or not doc.has_value_changed("payee"):
        return
    problem = pick_problem(payee, frappe.db.get_value(PAYEE_DOCTYPE, payee, "status"))
    if problem:
        frappe.throw(_(problem))
