# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Lifecycle controller for the Payee doctype (spec #1420, ADR-0033).

`validate` holds a Payee's own rules on EVERY write path (the Payee module, a patch, Desk, REST):
the details are cleaned and must be complete (`services/payees/rules`), `normalized_account` is
derived from the account number, and no two Payees share a normalized account + IFSC
(`services/payees/writer.assert_not_duplicate`). The unique constraint on the pair
(`Payee.on_doctype_update`) backs this up against two saves racing. On an existing Payee,
`services/payees/guard.check_payee_save` refuses a holder-name change by anyone but Accounts or an
Admin, and an account number or IFSC change once the Payee is paid (Locked, #1423).

The IFSC lookup is NOT here: it runs once, when `writer.create_payee` makes the Payee, never on a
later save.
"""

import frappe
from frappe import _

from nirmaan_stack.services.payees.guard import check_payee_save
from nirmaan_stack.services.payees.rules import details_problem, parse_details
from nirmaan_stack.services.payees.writer import assert_not_duplicate


def validate(doc, method=None):
    """Clean the Payee's details, derive `normalized_account`, refuse incomplete details and a duplicate;
    on an existing Payee, refuse a holder-name change outside Accounts and a change to a Locked one."""
    details = parse_details(doc.account_name, doc.account_number, doc.ifsc)
    doc.account_name = details.account_name
    doc.account_number = details.account_number
    doc.ifsc = details.ifsc
    doc.normalized_account = details.normalized_account

    problem = details_problem(details)
    if problem:
        frappe.throw(_(problem))
    assert_not_duplicate(details, exclude=None if doc.is_new() else doc.name)
    if not doc.is_new():
        check_payee_save(doc, frappe.session.user)
