# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who an expense pays (spec #1420 ticket #1429, ADR-0033): the Expense payee, applied.

The rules themselves are pure, in `services/payees/expense_rules.py`; `guard.check_payee_links`
applies them on every save of a request or expense, reading `payee_rule` here.

* `payee_rule` -- an expense type's *Who gets paid*.
* `change_expense_payee` -- Record Payment's Change payee: sets the Payee and saves, so the save hook
  decides. The calling endpoint checks the role first, for its own message; the hook checks it again.

Approval copies the request's Payee onto the Expense (`api/expense_requests/convert`); a request
naming a vendor is paid into that vendor's Payee as it is at approval.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.payees.expense_rules import NOT_ASKED


def payee_rule(expense_type: str) -> str:
    """The type's *Who gets paid* rule; a blank one is *Not asked*."""
    return frappe.db.get_value("Expense Type", expense_type, "payee_rule") or NOT_ASKED


def change_expense_payee(doctype: str, name: str, payee: str | None):
    """Point a Project Expense or Non-Project Expense at another Payee (or none): Record Payment's
    Change payee. Saved through the document, so the save hook (`guard.check_payee_links`) applies
    every rule as on any other path: fixed once paid, Accounts only, a vendor's own Payee, a
    *Required* type not left without one. A *Not asked* type may
    still be given one: whoever pays it is naming the account, not the raiser. The row is locked
    first, so the paid check reads the status a concurrent payment just wrote. The save leaves the
    Version row Record Payment's "Named by" reads (`paid_to.expense_pay_to`): `ignore_version=False`,
    as Frappe skips it under tests otherwise. Never commits."""
    doc = frappe.get_doc(doctype, name, for_update=True)
    doc.payee = payee or None
    doc.save(ignore_permissions=True, ignore_version=False)
    return doc
