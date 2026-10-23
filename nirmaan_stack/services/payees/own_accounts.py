# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A person's own bank account: the one Payee named in their `Nirmaan Users.payee` field.

The link lives on Nirmaan Users, never on Payee (owner, 2026-10-22), so Payee keeps its shape (ADR-0033: one
Payee is one bank account). One person has one account (owner, 2026-10-22): a second is refused, and the
person corrects the one they have instead. Reimbursements are paid into it.

* `my_account(user)` -- the person's Payee, or None.
* `add_own_account(user, account_name, account_number, ifsc)` -- THE way the field is set. The account
  number + IFSC decide: a new account becomes a new Payee and theirs; a Payee already on record that is
  nobody's becomes theirs; their own is returned; another person's is refused (`OtherPersonsAccountError`).
  A person who already has an account is refused any other (`AlreadyHasAccountError`).
* `assert_own_account(user, payee)` -- refuse a Payee that is not the person's (a claim may only be paid
  into the claimant's own account).
* `edit_own_account(user, payee, ...)` -- the person corrects their account (holder name, number, IFSC)
  through `writer.edit_payee_reply`, so the duplicate rule, the IFSC lookup and the Version row are the Payee
  module's own. Refused for a Payee a Vendor is also paid into: that edit would move the vendor's payments, so
  it stays with Accounts on the Payees page. Claims already raised keep their copy of the old account.
* `check_own_account(doc)` -- the Nirmaan Users `validate` rule: the field changes only through
  `add_own_account`, and never names a Payee another person holds.

Nothing here commits; the caller does.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.rules import ACCOUNT_FIELDS, PAYEE_TYPE_USERS, details_problem, parse_details
from nirmaan_stack.services.payees.links import linked_vendors
from nirmaan_stack.services.payees.writer import create_payee, edit_payee_reply, existing_payee

USERS_DOCTYPE = "Nirmaan Users"
PAYEE_FIELD = "payee"

#: Set only while `add_own_account` saves a person's row; `check_own_account` refuses any other change.
_WRITE_FLAG = "own_bank_account_write"

ADDED = "added"
LINKED = "linked"
ALREADY_YOURS = "already_yours"


class OtherPersonsAccountError(frappe.ValidationError):
    """The account number + IFSC are already another person's Payee."""


class AlreadyHasAccountError(frappe.ValidationError):
    """The person already has a bank account, and one person has one."""


def person_of(user: str) -> str | None:
    """The Nirmaan Users row of login `user` (its name is the lowercased email), or None."""
    if not user:
        return None
    if frappe.db.exists(USERS_DOCTYPE, user):
        return user
    lowered = user.strip().lower()
    return lowered if frappe.db.exists(USERS_DOCTYPE, lowered) else None


def holder_of(payee: str) -> str | None:
    """The Nirmaan Users row whose `payee` is `payee`, or None when it is nobody's."""
    return frappe.db.get_value(USERS_DOCTYPE, {PAYEE_FIELD: payee}, "name", order_by="creation asc")


def my_account(user: str) -> dict | None:
    """`user`'s Payee -- `name`, the five account fields and how many vendors are paid into it -- or None."""
    person = person_of(user)
    payee = frappe.db.get_value(USERS_DOCTYPE, person, PAYEE_FIELD) if person else None
    if not payee:
        return None
    columns = ", ".join(f'p."{field}"' for field in ACCOUNT_FIELDS)
    rows = frappe.db.sql(
        f"""
        SELECT p.name, {columns},
               (SELECT COUNT(*) FROM "tabVendors" v WHERE v.payee = p.name) AS vendors
        FROM "tabPayee" p
        WHERE p.name = %(payee)s
        """,
        {"payee": payee},
        as_dict=True,
    )
    return rows[0] if rows else None


def assert_own_account(user: str, payee: str | None) -> None:
    """Refuse `payee` unless it is `user`'s own account."""
    if not payee:
        frappe.throw(_("Add the bank account to be repaid into."))
    mine = my_account(user)
    if not mine or mine.name != payee:
        frappe.throw(_("That bank account isn't yours. Your claim is repaid into your own account."),
                     frappe.PermissionError)


def edit_own_account(user: str, payee: str, account_name, account_number, ifsc) -> dict:
    """Edit `user`'s own account in place and answer the screen as `writer.edit_payee_reply` does:
    `{payee: <summary>}`, or `{duplicate, message}` when another Payee already holds the new account.

    Refuses a Payee that is not the person's, and one a Vendor is also paid into (naming the vendors).
    """
    assert_own_account(user, payee)
    vendors = linked_vendors(payee)
    if vendors:
        names = ", ".join(v["vendor_name"] or v["name"] for v in vendors)
        frappe.throw(_("This account is also where {0} is paid, so Accounts changes it on the Payees page.").format(names),
                     frappe.PermissionError)
    return edit_payee_reply(payee, account_name, account_number, ifsc)


def add_own_account(user: str, account_name, account_number, ifsc) -> tuple[str, str]:
    """Make the account `user`'s and return `(payee, outcome)`.

    `outcome` is `ADDED` (a new Payee), `LINKED` (a Payee on record that was nobody's) or `ALREADY_YOURS`.
    A person who already has a different account is refused (`AlreadyHasAccountError`); an account that is
    another person's is refused (`OtherPersonsAccountError`). A new Payee goes through `writer.create_payee`,
    so its details, duplicate rule and IFSC lookup are the Payee module's own.
    """
    person = person_of(user)
    if not person:
        frappe.throw(_("Your user profile wasn't found, so a bank account can't be saved for you."))

    details = parse_details(account_name, account_number, ifsc)
    problem = details_problem(details)
    if problem:
        frappe.throw(_(problem))

    payee = existing_payee(details)
    current = frappe.db.get_value(USERS_DOCTYPE, person, PAYEE_FIELD)
    if current:
        if payee == current:
            return payee, ALREADY_YOURS
        frappe.throw(_("You already have a bank account. To change it, edit it on your profile's Payee tab."),
                     AlreadyHasAccountError)

    if payee:
        holder = holder_of(payee)
        if holder and holder != person:
            frappe.throw(_("This bank account belongs to another person. Add a different account."),
                         OtherPersonsAccountError)
        _set(person, payee)
        return payee, LINKED

    payee = create_payee(details.account_name, details.account_number, details.ifsc, PAYEE_TYPE_USERS).name
    _set(person, payee)
    return payee, ADDED


def _set(person: str, payee: str) -> None:
    doc = frappe.get_doc(USERS_DOCTYPE, person)
    doc.set(PAYEE_FIELD, payee)
    frappe.flags[_WRITE_FLAG] = True
    try:
        doc.save(ignore_permissions=True)
    finally:
        frappe.flags[_WRITE_FLAG] = False


def check_own_account(doc, method=None) -> None:
    """Nirmaan Users `validate`: the `payee` field changes only through `add_own_account`.

    Many profiles hold write on Nirmaan Users (so people can save their own profile), so without this
    anyone could set or clear any person's account through Desk or the REST API. The field also never
    names a Payee that is already another person's.
    """
    before = doc.get_doc_before_save()
    old = (before.get(PAYEE_FIELD) if before else None) or None
    new = doc.get(PAYEE_FIELD) or None
    if old == new:
        return
    if not frappe.flags.get(_WRITE_FLAG):
        frappe.throw(_("A bank account is added from Raise Reimbursement, by the person themselves."),
                     frappe.PermissionError)
    holder = holder_of(new) if new else None
    if holder and holder != doc.name:
        frappe.throw(_("This bank account belongs to another person."), OtherPersonsAccountError)
