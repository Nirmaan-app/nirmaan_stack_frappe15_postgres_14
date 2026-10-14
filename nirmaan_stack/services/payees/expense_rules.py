# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Expense payee rules that need no database (spec #1420 ticket #1429, ADR-0033).

PURE MODULE -- no `frappe`, no database. `services/payees/expense_payee.py` reads the facts (the
type's rule, the vendor's Payee, a Payee's status) and asks these; nothing else re-states them.

Each **expense type** says whether a request names who gets paid (`Expense Type.payee_rule`):

* *Required* -- the request can't be sent without a Payee.
* *Optional* -- it can be left blank (costs sometimes paid by card or cash).
* *Not asked* -- the request shows no payee field, and any Payee sent is ignored. The default.

A request that names a **Vendor** is paid into that vendor's Payee: the Payee is filled in from
the vendor, and any other Payee is refused. A vendor can't be read back from a Payee, because one
Payee may serve several vendors.
"""

from __future__ import annotations

from typing import NamedTuple

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


def request_payee(rule, *, expense_type, payee, vendor, vendor_payee) -> PayeeVerdict:
    """The Payee an Expense Request of `expense_type` carries, given the type's `rule`, the Payee
    sent, the request's vendor and that vendor's Payee (None when it has none). A blank rule is
    *Not asked*."""
    payee = (payee or "").strip() or None
    if (rule or NOT_ASKED) == NOT_ASKED:
        return PayeeVerdict(None, None)

    if vendor:
        if vendor_payee:
            if payee and payee != vendor_payee:
                return PayeeVerdict(None, (
                    f"{vendor} is paid into payee {vendor_payee}, so this request can't name {payee}. "
                    f"To pay someone else, set Vendor to {OTHERS}."
                ))
            return PayeeVerdict(vendor_payee, None)
        if payee:
            return PayeeVerdict(None, (
                f"{vendor} has no bank account on record, so this request can't be paid into {payee}. "
                f"To pay someone else, set Vendor to {OTHERS}."
            ))
        if rule == REQUIRED:
            return PayeeVerdict(None, (
                f"{expense_type} needs a payee, and {vendor} has no bank account on record. Add the "
                f"vendor's bank details on its page, or set Vendor to {OTHERS} and pick a payee."
            ))
        return PayeeVerdict(None, None)

    if not payee and rule == REQUIRED:
        return PayeeVerdict(None, f"{expense_type} needs a payee. Pick who gets paid, or add a new payee.")
    return PayeeVerdict(payee, None)


def paid_expense_problem(expense: str) -> str:
    """The refusal for changing the Payee of an expense that is already Paid."""
    return f"{expense} is already paid, so its payee can no longer change."
