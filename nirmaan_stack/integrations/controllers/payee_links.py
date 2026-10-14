# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""`validate` for every record that links a Payee: `Vendors`, `Expense Request`, `Project Expenses`
and `Non Project Expenses` (#1423, spec #1420, ADR-0033).

An Inactive Payee can't be newly picked; a record already pointing at it keeps it
(`services/payees/guard.check_payee_pick`).
"""

from nirmaan_stack.services.payees.guard import check_payee_pick


def validate(doc, method=None):
    check_payee_pick(doc)
