# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Expense payee rules that need no database (spec #1420 ticket #1429, ADR-0033).

PURE MODULE -- no `frappe`, no database. `services/payees/expense_payee.py` reads the facts (the
type's rule, the vendor's Payee) and asks these; nothing else re-states them.

Each **expense type** says whether a request names who gets paid (`Expense Type.payee_rule`):

* *Required* -- the request can't be sent without a Payee.
* *Optional* -- it can be left blank (costs sometimes paid by card or cash).
* *Not asked* -- the request shows no payee field, and any Payee sent is ignored. The default.

A request that names a **Vendor** is paid into that vendor's Payee: the Payee is filled in from
the vendor, and any other Payee is refused (`follow_vendor`, which a Project Expense naming a vendor
obeys too). On a *Not asked* type the vendor's Payee is still carried, so the accountant sees who to
pay; only a Payee the raiser typed is ignored. A vendor can't be read back from a Payee, because one
Payee may serve several vendors.

An expense's Payee is fixed once it is paid (`paid_expense_problem`),
and before that only Accounts change it (`EXPENSE_PAYEE_ROLE_PROBLEM`).
"""

from __future__ import annotations

from typing import NamedTuple

from nirmaan_stack.services.payees.rules import PAID_STATUSES

REQUIRED = "Required"
OPTIONAL = "Optional"
NOT_ASKED = "Not asked"
#: Pinned to `Expense Type.payee_rule`'s options by test. `NOT_ASKED` is the field's default.
PAYEE_RULES = (REQUIRED, OPTIONAL, NOT_ASKED)

OTHERS = "Others (No Vendor)"


class PayeeVerdict(NamedTuple):
    """The Payee a request ends up with, or why it is refused (then `payee` is None)."""

    payee: str | None
    problem: str | None


def follow_vendor(*, vendor, payee, vendor_payee) -> PayeeVerdict:
    """The Payee of a record naming `vendor` (whose Payee is `vendor_payee`, None when it has none),
    given the `payee` sent: the vendor's own, filled in when none was sent; any other is refused."""
    payee = (payee or "").strip() or None
    if vendor_payee:
        if payee and payee != vendor_payee:
            return PayeeVerdict(None, (
                f"{vendor} is paid into payee {vendor_payee}, so this can't be paid into {payee}. "
                f"To pay someone else, set Vendor to {OTHERS}."
            ))
        return PayeeVerdict(vendor_payee, None)
    if payee:
        return PayeeVerdict(None, (
            f"{vendor} has no bank account on record, so this can't be paid into {payee}. "
            f"To pay someone else, set Vendor to {OTHERS}."
        ))
    return PayeeVerdict(None, None)


def request_payee(rule, *, expense_type, payee, vendor, vendor_payee) -> PayeeVerdict:
    """The Payee an Expense Request of `expense_type` carries, given the type's `rule`, the Payee
    sent, the request's vendor and that vendor's Payee (None when it has none). A blank rule is
    *Not asked*."""
    payee = (payee or "").strip() or None
    rule = rule or NOT_ASKED

    if vendor:
        if rule == NOT_ASKED:
            # Nobody was asked, so a Payee sent is ignored; the vendor's own is still who gets paid.
            return PayeeVerdict(vendor_payee or None, None)
        verdict = follow_vendor(vendor=vendor, payee=payee, vendor_payee=vendor_payee)
        if verdict.problem or verdict.payee or rule != REQUIRED:
            return verdict
        return PayeeVerdict(None, (
            f"{expense_type} needs a payee, and {vendor} has no bank account on record. Add the "
            f"vendor's bank details on its page, or set Vendor to {OTHERS} and pick a payee."
        ))

    if rule == NOT_ASKED:
        return PayeeVerdict(None, None)
    if not payee and rule == REQUIRED:
        return PayeeVerdict(None, f"{expense_type} needs a payee. Pick who gets paid, or add a new payee.")
    return PayeeVerdict(payee, None)


#: The refusal when anyone but Accounts or an Admin changes an existing expense's Payee.
EXPENSE_PAYEE_ROLE_PROBLEM = "Only Accounts and Admins can change who an expense is paid to."


def paid_expense_problem(expense: str, status: str | None) -> str | None:
    """Why expense `expense`, at `status`, can't change its Payee, or None. Once it is paid
    (`rules.PAID_STATUSES`: Reconciliation Pending or Paid) the money has gone to that account, so the
    record of who it went to is fixed."""
    if status in PAID_STATUSES:
        return f"{expense} is already paid, so its payee can no longer change."
    return None
