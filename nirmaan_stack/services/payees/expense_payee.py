# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who an expense pays (spec #1420 ticket #1429, ADR-0033): the Expense payee, applied.

Reads the facts (the expense type's rule, the vendor's Payee, a Payee's status) and applies the pure
rules in `services/payees/expense_rules.py`. Every refusal is a `frappe.ValidationError` whose
message says what to do.

* `request_payee_for` -- the Payee an Expense Request carries on create and on edit. The Expense
  Request endpoints (`api/expense_requests/create`, `update`) call it.
* Inactive: a newly picked Payee must pass `choosing.assert_pickable` (the vendor screens' rule
  too); the Payee a record already holds is kept even if it has gone Inactive since.
* `change_expense_payee` -- change a Project / Non-Project Expense's Payee until it is paid
  (Reconciliation Pending or Paid). Checks no role: the calling endpoint does.

Approval copies the request's Payee onto the Expense as-is (`api/expense_requests/convert`).
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.choosing import assert_pickable
from nirmaan_stack.services.payees.expense_rules import (
    NOT_ASKED,
    OPTIONAL,
    paid_expense_problem,
    request_payee,
)
from nirmaan_stack.services.payees.vendor_account import payee_for_vendor
from nirmaan_stack.services.payees.versions import write_field_change


def payee_rule(expense_type: str) -> str:
    """The type's *Who gets paid* rule; a blank one is *Not asked*."""
    return frappe.db.get_value("Expense Type", expense_type, "payee_rule") or NOT_ASKED


def request_payee_for(expense_type: str, *, vendor: str | None, payee: str | None,
                      current: str | None = None) -> str | None:
    """The Payee an Expense Request of `expense_type` naming `vendor` carries, given the `payee` sent.

    `current` is the Payee the request already holds (on an edit): keeping it is allowed even if it
    has gone Inactive since. Refuses a missing Payee on a *Required* type, a Payee that isn't the
    vendor's, and a newly picked Inactive Payee. *Not asked* returns None whatever was sent.
    """
    return _resolve(payee_rule(expense_type), expense_type=expense_type, vendor=vendor,
                    payee=payee, current=current)


def _resolve(rule, *, expense_type, vendor, payee, current):
    verdict = request_payee(
        rule,
        expense_type=expense_type,
        payee=payee,
        vendor=vendor,
        vendor_payee=payee_for_vendor(vendor) if vendor else None,
    )
    if verdict.problem:
        frappe.throw(_(verdict.problem), title=_("Who gets paid"))
    # Inactive stops NEW picks: the Payee the record already holds is kept.
    if verdict.payee and verdict.payee != current:
        assert_pickable(verdict.payee)
    return verdict.payee


def change_expense_payee(doctype: str, name: str, payee: str | None):
    """Point a Project Expense or Non-Project Expense at another Payee (or none), until it is paid
    (`expense_rules.paid_expense_problem`). The status is read under the row lock.

    The request's rules hold: a *Required* type can't be left without one, a Project Expense with a
    vendor is paid into that vendor's Payee, and an Inactive Payee can't be newly picked. A *Not
    asked* type may still be given one here: whoever pays it is naming the account, not the raiser.

    Written with `db_set`, so no `validate` or `on_update` runs: the expense's own hooks read
    status and amount, never `payee`, so there is nothing for them to recompute. `db_set` leaves
    no Version row, so one is written here: the change shows in the expense's history, and Record
    Payment's "Named by" reads who made it (`paid_to.expense_pay_to`). Never commits.
    """
    doc = frappe.get_doc(doctype, name, for_update=True)
    paid = paid_expense_problem(name, doc.status)
    if paid:
        frappe.throw(_(paid), title=_("Who gets paid"))
    rule = payee_rule(doc.type) if doc.get("type") else NOT_ASKED
    resolved = _resolve(
        OPTIONAL if rule == NOT_ASKED else rule,
        expense_type=doc.get("type") or doctype,
        vendor=doc.get("vendor"),
        payee=payee,
        current=doc.get("payee"),
    )
    previous = doc.get("payee") or None
    doc.db_set("payee", resolved)
    if resolved != previous:
        write_field_change(doctype, name, "payee", previous, resolved)
    return doc
