# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Paying a payment or an expense: who to pay, and changing an expense's account before paying it
(spec #1420 tickets #1431, #1438, #1463, ADR-0033).

Thin: check who is asking, call the Payee module (`services/payees/paid_to`, `expense_payee`,
`take_vendor_account`), commit. Every row is paid into its own pay-to account, except a PO / WO
payment that switches to its vendor's current account.

* `get_paid_to` -- who each ticked row is paid to, read now: Export for Payment's ICICI / Cashfree file.
* `take_vendor_accounts` -- Export for Payment and Mark as Paid: write the vendor's current account
  onto each PO / WO payment that switches to it, as the payer was shown, and answer where each is
  paid now and which were no longer Approved.
* `get_pay_to_box` -- Record Payment's "Pay ₹X to" box, for an expense or a PO / WO payment.
* `search_payees` -- Change account's picker: Payees by holder name or account number.
* `change_expense_account` -- Change account: copy a Payee's account onto an expense.

Who: reading follows the ledger (whoever may read the payment or expense sees who it pays, as the
queue shows it). Changing follows it too: whoever may write the expense (Frappe's permission).
Searching Payees is Accounts only (`PAYEE_MANAGE_PROFILES`); new bank details in Change account go
through the Payees page's `add_payee` / `check_payee`, Accounts only too. Who sees Change account
(Accounts) and which expenses may still change (approved, unpaid, no vendor) are screen rules.
"""

import json

import frappe

from nirmaan_stack.services.outflow_import.ledgers import EXPENSE_DOCTYPES
from nirmaan_stack.services.payees import expense_payee, take_vendor_account
from nirmaan_stack.services.payees.paid_to import PAYMENT_DOCTYPE, assert_paid_to_doctype, paid_to_for, pay_to_box
from nirmaan_stack.services.payees.search import find_payees
from nirmaan_stack.services.role_profiles import assert_payee_manager


@frappe.whitelist()
def get_paid_to(rows: str | list[dict]) -> list[dict]:
    """Who each row is paid to, in the order sent. `rows` is `[{doctype, name}]` (`Project Payments`,
    `Project Expenses`, `Non Project Expenses`). Each answer is `{account, missing, payee_rule,
    switch_to, by_cheque, vendor_has_no_account}` (`services/payees/paid_to.paid_to_rows`)."""
    if isinstance(rows, str):
        rows = json.loads(rows)
    rows = list(rows or [])
    for doctype in {row.get("doctype") for row in rows}:
        assert_paid_to_doctype(doctype)
        frappe.has_permission(doctype, "read", throw=True)
    return paid_to_for(rows)


@frappe.whitelist()
def get_pay_to_box(doctype: str, name: str) -> dict:
    """The "Pay ₹X to" box for payment or expense `name` (`services/payees/paid_to.pay_to_box`)."""
    assert_paid_to_doctype(doctype)
    frappe.has_permission(doctype, "read", doc=name, throw=True)
    return pay_to_box(doctype, name)


@frappe.whitelist(methods=["POST"])
def take_vendor_accounts(payments: str | list[dict]) -> dict:
    """Pay each PO / WO payment into its vendor's current account: where the vendor's account changed
    since the payment was raised, or the payment has none, write the vendor's account onto it
    (`services/payees/take_vendor_account`, #1463). Export for Payment and Mark as Paid call it with
    every PO / WO payment they pay, before the file is saved or the rows are marked paid, each as
    `{name, shown}`: `shown` is the vendor's account the screen showed it is paid into, or null. This
    decides again which switch, and refuses the whole call when that is not what the payer was shown.
    Returns `{taken: [{name, paid_to}], skipped: [{name, status}]}`: the bank file pays `switch_to` or
    else `account` from each `paid_to`, which is what the payment then records; a skipped payment was
    no longer Approved and is left out.

    Asks Frappe's write permission on each payment, as Mark as Paid's own save does; the save ignores
    permissions, so this check is the boundary. One commit: all or nothing."""
    if isinstance(payments, str):
        payments = json.loads(payments)
    payments = [{"name": p.get("name"), "shown": p.get("shown")} for p in payments or []]
    for payment in payments:
        frappe.has_permission(PAYMENT_DOCTYPE, "write", doc=payment["name"], throw=True)
    answer = take_vendor_account.take_vendor_accounts(payments)
    frappe.db.commit()
    return answer


@frappe.whitelist()
def search_payees(text: str | None = None, limit: int = 8) -> list[dict]:
    """Payees matching `text`, by holder name (`services/payees/search.find_payees`)."""
    assert_payee_manager(frappe.session.user)
    return find_payees(text, limit=limit)


@frappe.whitelist(methods=["POST"])
def change_expense_account(doctype: str, name: str, payee: str | None = None) -> dict:
    """Overwrite expense `name`'s pay-to account with Payee `payee`'s (or clear it). Returns the new
    box. A PO / WO payment's copy is never changed in the app (ADR-0033): it is refused here.

    Asks Frappe's own write permission on the expense: the save ignores permissions, so this check is
    the boundary. That only Accounts see Change account is a screen rule (`canChangeExpenseAccount`)."""
    assert_paid_to_doctype(doctype, EXPENSE_DOCTYPES)
    frappe.has_permission(doctype, "write", doc=name, throw=True)
    expense_payee.change_expense_account(doctype, name, payee or None)
    frappe.db.commit()
    return pay_to_box(doctype, name)
