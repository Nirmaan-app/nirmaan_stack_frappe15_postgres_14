# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Add Payee on the Payees page (#1422, spec #1420, ADR-0033).

Thin: check who is asking, call the Payee module (`services/payees/`), commit. Every rule (required
fields, the IFSC lookup, the duplicate refusal) is the module's and the `validate` controller's.

* `add_payee` -- create a Payee. A duplicate comes back as data (`duplicate`), not only as error
  text: the dialog shows that Payee with a link to it.
* `check_payee` -- the same duplicate verdict before submit, so the dialog can block early.
* `lookup_ifsc` -- the bank and branch for an IFSC, so the dialog can show them as it is typed.

Who: `PAYEE_MANAGE_PROFILES` (Admin, Accountant, Accountant Lead) for `add_payee` and `check_payee`.
`lookup_ifsc` reads public bank data and is open to any signed-in user, like the vendor forms'
`api/bank_details.generate_bank_details`.
"""

import frappe

from nirmaan_stack.services.payees.ifsc import lookup_ifsc as lookup_bank_branch
from nirmaan_stack.services.payees.links import payee_summary
from nirmaan_stack.services.payees.rules import duplicate_problem, parse_details
from nirmaan_stack.services.payees.writer import DuplicatePayeeError, create_payee, existing_payee
from nirmaan_stack.services.role_profiles import assert_payee_manager


@frappe.whitelist(methods=["POST"])
def add_payee(account_name: str, account_number: str, ifsc: str) -> dict:
    """Create an Active Payee for this bank account; bank and branch come from the IFSC lookup.

    Returns `{payee: <summary>}`, or `{duplicate: <summary>, message}` when another Payee already holds
    the account number + IFSC (spaces, dashes and leading zeros ignored); nothing is created then.
    A summary is `services/payees/links.payee_summary`: the Payee's fields, `vendors`, `expenses`
    and `last_paid`. Refuses incomplete details and an IFSC the lookup can't find.
    """
    assert_payee_manager(frappe.session.user)
    try:
        doc = create_payee(account_name, account_number, ifsc)
    except DuplicatePayeeError as e:
        frappe.db.rollback()
        return {"duplicate": payee_summary(e.existing), "message": str(e)}
    frappe.db.commit()
    return {"payee": payee_summary(doc.name)}


@frappe.whitelist()
def check_payee(account_number: str, ifsc: str) -> dict:
    """The Payee already holding this account number + IFSC: `{duplicate: <summary> | None, message}`."""
    assert_payee_manager(frappe.session.user)
    return duplicate_verdict(account_number, ifsc)


def duplicate_verdict(account_number: str, ifsc: str) -> dict:
    """`check_payee`'s reply, for an endpoint that has made its own role check (the vendor screens)."""
    details = parse_details("", account_number, ifsc)
    existing = existing_payee(details)
    if not existing:
        return {"duplicate": None, "message": None}
    summary = payee_summary(existing)
    return {"duplicate": summary, "message": duplicate_problem(existing, summary["account_name"])}


@frappe.whitelist()
def lookup_ifsc(ifsc: str) -> dict:
    """`{bank_name, bank_branch}` for an IFSC. Refuses one the lookup can't find."""
    branch = lookup_bank_branch(parse_details("", "", ifsc).ifsc)
    return {"bank_name": branch.bank_name, "bank_branch": branch.bank_branch}
