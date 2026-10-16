# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A record's own pay-to account (#1436, #1437, spec #1420, ADR-0033 decision 9).

An Expense Request, a Project Expense, a Non-Project Expense and a PO / Work Order payment holds the account it is paid into in five fields of its own (`PAY_TO_FIELDS`), copied from a
Payee when the record is raised. Nothing points back at the Payee: editing or deleting it leaves every
copy as it was.

* `copy_payee_account(doc, payee)` -- THE copy: a Payee's account into `doc`'s pay-to fields (None
  clears them). Every copier calls it.
* `copy_vendor_account(doc)` -- the same, from `doc.vendor`'s Payee.
* `set_pay_to(doc, account)` -- an account already read into `doc`'s pay-to fields (paying a PO / WO
  payment into the vendor account its answer named, `take_vendor_account`).
* `copy_pay_to(source, target)` -- one record's copy onto another as it is (approval; a split
  payment's remainder).
* `fill_from_vendor(doc)` -- the save hook's rule for a request or Project Expense naming a vendor
  (`guard.check_payee_links`).
* `fill_payment_from_vendor(doc)` -- the save hook's rule for a PO / Work Order payment: its vendor's
  Payee, copied on insert only (`integrations/controllers/project_payments.validate`).
* `pay_to_account(row)` -- the copy in a Payee's field names, for a screen; None when blank.

The server enforces no edit rule on a copy (owner, 2026-10-15): who may change it, and when, are screen
rules.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.payees.rules import ACCOUNT_FIELDS, PAID_STATUSES
from nirmaan_stack.services.payees.vendor_account import payee_for_vendor


def pay_to_field(field: str) -> str:
    """The pay-to field holding a Payee's `field` (`account_number` -> `pay_to_account_number`)."""
    return f"pay_to_{field}"


#: The five pay-to fields, in the order of a Payee's own (`rules.ACCOUNT_FIELDS`).
PAY_TO_FIELDS = tuple(pay_to_field(field) for field in ACCOUNT_FIELDS)


def copy_payee_account(doc, payee: str | None) -> None:
    """Copy Payee `payee`'s account into `doc`'s pay-to fields; None (or no such Payee) clears them.
    Sets the fields only: the caller saves."""
    set_pay_to(doc, frappe.db.get_value("Payee", payee, list(ACCOUNT_FIELDS), as_dict=True) if payee else None)


def set_pay_to(doc, account: dict | None) -> None:
    """Write `account` (a Payee's field names, as `pay_to_account` answers it) into `doc`'s pay-to
    fields; None clears them. Sets the fields only: the caller saves."""
    for pay_to, field in zip(PAY_TO_FIELDS, ACCOUNT_FIELDS):
        doc.set(pay_to, (account or {}).get(field) or None)


def copy_vendor_account(doc) -> None:
    """Copy `doc.vendor`'s Payee into `doc`'s pay-to fields (cleared when the vendor has none)."""
    vendor = doc.get("vendor")
    copy_payee_account(doc, payee_for_vendor(vendor) if vendor else None)


def copy_pay_to(source, target) -> None:
    """Carry `source`'s pay-to account onto `target` as it is (approval: request -> Expense; a split
    payment -> its remainder)."""
    for field in PAY_TO_FIELDS:
        target.set(field, source.get(field) or None)


def has_pay_to(doc) -> bool:
    """True when `doc` holds an account (its account number is set)."""
    return bool(doc.get("pay_to_account_number"))


def fill_from_vendor(doc) -> None:
    """The save rule of a record naming a vendor (an Expense Request, a Project Expense): its pay-to
    account is the vendor's Payee, copied when the record has none (on insert, or a record from before)
    and whenever the vendor changes. Once the record is paid (`rules.PAID_STATUSES`) nothing is copied:
    the copy says where the money went. A fill, never a refusal."""
    if not doc.get("vendor"):
        return
    before = doc.get_doc_before_save()
    if before is not None and before.get("status") in PAID_STATUSES:
        return
    vendor_changed = before is not None and (before.get("vendor") or None) != doc.get("vendor")
    if vendor_changed or not has_pay_to(doc):
        copy_vendor_account(doc)


def fill_payment_from_vendor(doc) -> None:
    """The save rule of a PO / Work Order payment (`Project Payments`, #1437): inserted with no copy,
    it copies its vendor's Payee. Only on insert, so whichever path creates the payment (term
    request, Work Order request, credits, adjustments, a payment recorded directly) gets one, and it
    is never re-copied on save: editing the vendor's Payee leaves every payment already raised as it
    was until it is exported or marked paid (`take_vendor_account`, #1463). A split remainder arrives
    with its parent's copy (`copy_pay_to`) and keeps it."""
    if doc.is_new() and not has_pay_to(doc):
        copy_vendor_account(doc)


def pay_to_account(row) -> dict | None:
    """`row`'s pay-to account as `{account_name, account_number, ifsc, bank_name, bank_branch}`, or
    None when it has none."""
    if not has_pay_to(row):
        return None
    return {field: row.get(pay_to) for pay_to, field in zip(PAY_TO_FIELDS, ACCOUNT_FIELDS)}
