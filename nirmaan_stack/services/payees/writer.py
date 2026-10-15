# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""THE Payee writer: the only code that creates or edits a Payee (spec #1420, ADR-0033).

Every screen that adds a Payee (the Payees page, and later the vendor screens and the Expense
Request) calls `create_payee` from its own endpoint, after its own role check: who may add a Payee
depends on the screen, so this module checks no role. Nothing here commits; the caller does.

* `create_payee` -- validate, refuse a duplicate (naming the existing Payee), look up the IFSC
  (refusing one the lookup can't find), insert.
* `existing_payee` -- the Payee already holding an account number + IFSC, if any. A screen asks it
  before submit to show the duplicate block; the Payee `validate` controller asks it on every save.
* `assert_not_duplicate` -- the refusal itself, shared by `create_payee` and the controller.
* `duplicate_verdict` / `unless_duplicate` -- a duplicate as DATA for a screen: the Payee already
  holding the account (`{duplicate: <summary>, message}`), before submit and on submit. Every endpoint
  that adds a Payee (the Payees page, the Expense Request, the vendor screens) answers through them.
* `backfill_payee` -- the patch's Payee for a vendor's bank details already on record (#1424): bank
  and branch as recorded, no IFSC lookup.
* `edit_payee` -- a new holder name, account number or IFSC, in place (#1435). Checks no role: the
  calling endpoint does.
* `delete_payee` -- delete a Payee no vendor links to (#1435).

A Payee has no status and no lock (#1434): it is an address book entry, edited in place.

The rules themselves are pure, in `services/payees/rules.py`; links are in
`services/payees/links.py`; the IFSC lookup is `services/payees/ifsc.py`.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.ifsc import lookup_ifsc
from nirmaan_stack.services.payees.links import payee_summary
from nirmaan_stack.services.payees.rules import (
    PAYEE_DOCTYPE,
    PayeeDetails,
    details_problem,
    duplicate_problem,
    parse_details,
    payee_in_use_problem,
)


class DuplicatePayeeError(frappe.ValidationError):
    """The account number + IFSC already belong to a Payee. The message names it; so does `existing`
    on the instance `assert_not_duplicate` throws."""


def existing_payee(details: PayeeDetails, *, exclude: str | None = None) -> str | None:
    """The name of the Payee holding the same account (spaces, dashes and leading zeros ignored) at
    the same IFSC, or None."""
    if not details.account_number or not details.ifsc:
        return None
    filters = {"normalized_account": details.normalized_account, "ifsc": details.ifsc}
    if exclude:
        filters["name"] = ["!=", exclude]
    return frappe.db.get_value(PAYEE_DOCTYPE, filters, "name")


def assert_not_duplicate(details: PayeeDetails, *, exclude: str | None = None) -> None:
    """Throw `DuplicatePayeeError` naming the Payee that already holds this account + IFSC. Through
    `frappe.throw`, so the message reaches every client (Desk shows nothing for a bare raise); the
    instance carries `existing` for the screens that offer that Payee instead."""
    existing = existing_payee(details, exclude=exclude)
    if existing:
        holder = frappe.db.get_value(PAYEE_DOCTYPE, existing, "account_name")
        error = DuplicatePayeeError()
        error.existing = existing
        frappe.throw(_(duplicate_problem(existing, holder)), error)


def duplicate_reply(existing: str) -> dict:
    """`{duplicate: <links.payee_summary>, message}` for Payee `existing`, which already holds the
    account a screen was given: the screen shows it to pick instead."""
    summary = payee_summary(existing)
    return {"duplicate": summary, "message": _(duplicate_problem(existing, summary["account_name"]))}


def duplicate_verdict(account_number, ifsc, *, exclude: str | None = None) -> dict:
    """Before submit: the Payee already holding this account number + IFSC as `duplicate_reply`
    gives it, or `{duplicate: None, message: None}`. `exclude` is the Payee being edited, which keeps
    its own account."""
    existing = existing_payee(parse_details("", account_number, ifsc), exclude=exclude)
    return duplicate_reply(existing) if existing else {"duplicate": None, "message": None}


def unless_duplicate(action):
    """On submit: run `action` (anything that may create a Payee) and return `(its result, None)`;
    when it is refused as a duplicate, roll the request's transaction back and return
    `(None, duplicate_reply)` instead, so nothing it did is kept, not even the refusal's message: the
    reply carries it. The caller commits a success."""
    shown = len(frappe.local.message_log)
    try:
        return action(), None
    except DuplicatePayeeError as e:
        frappe.db.rollback()
        del frappe.local.message_log[shown:]
        return None, duplicate_reply(e.existing)


def create_payee(account_name, account_number, ifsc):
    """Insert a new Payee for this bank account and return it.

    Refuses incomplete or malformed details, an account + IFSC another Payee holds
    (`DuplicatePayeeError`, carrying `existing`), and an IFSC the lookup can't find
    (`ifsc.IfscLookupError`); bank and branch come from the lookup, never from the caller. Writes
    with `ignore_permissions`: the calling endpoint's role check is the boundary. Never commits.
    """
    details = parse_details(account_name, account_number, ifsc)
    problem = details_problem(details)
    if problem:
        frappe.throw(_(problem))
    assert_not_duplicate(details)
    branch = lookup_ifsc(details.ifsc)
    doc = frappe.get_doc({
        "doctype": PAYEE_DOCTYPE,
        "account_name": details.account_name,
        "account_number": details.account_number,
        "ifsc": details.ifsc,
        "bank_name": branch.bank_name,
        "bank_branch": branch.bank_branch,
    })
    doc.insert(ignore_permissions=True)
    return doc


def backfill_payee(details: PayeeDetails, bank_name: str | None, bank_branch: str | None):
    """Insert a Payee for bank details already on record (#1424's patch moves the vendors'
    details here) and return it.

    Unlike `create_payee`, bank and branch are the ones on record and the IFSC lookup is not asked:
    the patch must not depend on an outside service, and it copies what is there rather than
    re-deriving it. The `validate` controller still cleans the details and refuses incomplete ones
    and a duplicate. Only the patch calls this. Never commits.
    """
    doc = frappe.get_doc({
        "doctype": PAYEE_DOCTYPE,
        "account_name": details.account_name,
        "account_number": details.account_number,
        "ifsc": details.ifsc,
        "bank_name": (bank_name or "").strip() or None,
        "bank_branch": (bank_branch or "").strip() or None,
    })
    doc.insert(ignore_permissions=True)
    return doc


def edit_payee(name: str, account_name, account_number, ifsc):
    """Edit Payee `name` in place (#1435, ADR-0033 decision 4): its holder name, account number and
    IFSC, and return it. A holder who moves banks keeps the same Payee; every record already raised
    keeps its own copy of the old account.

    Refuses incomplete details, an account + IFSC another Payee holds (`DuplicatePayeeError`, carrying
    `existing`), and a new IFSC the lookup can't find. Bank and branch are looked up again only when
    the IFSC changes. Leaves a Version row, which the Payee page's "last changed" reads. Checks no
    role: the calling endpoint does. Never commits."""
    details = parse_details(account_name, account_number, ifsc)
    problem = details_problem(details)
    if problem:
        frappe.throw(_(problem))
    doc = frappe.get_doc(PAYEE_DOCTYPE, name, for_update=True)
    assert_not_duplicate(details, exclude=name)
    if details.ifsc != doc.ifsc:
        branch = lookup_ifsc(details.ifsc)
        doc.bank_name, doc.bank_branch = branch.bank_name, branch.bank_branch
    doc.account_name = details.account_name
    doc.account_number = details.account_number
    doc.ifsc = details.ifsc
    doc.save(ignore_permissions=True, ignore_version=False)
    return doc


def delete_payee(name: str) -> None:
    """Delete Payee `name` (#1435). Refused while any vendor links to it, naming every one
    (`frappe.LinkExistsError`), so no vendor is left without an account by accident. Past payments
    and expenses keep their own copy of the account. Checks no role: the calling endpoint does. Never
    commits."""
    vendors = frappe.get_all(
        "Vendors", filters={"payee": name}, fields=["name", "vendor_name"], order_by="vendor_name asc, name asc"
    )
    if vendors:
        frappe.throw(
            _(payee_in_use_problem(name, [(v.name, v.vendor_name) for v in vendors])), frappe.LinkExistsError
        )
    frappe.delete_doc(PAYEE_DOCTYPE, name, ignore_permissions=True)
