# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Payee rules a save must pass, on EVERY write path (#1423, spec #1420, ADR-0033).

Called from the `validate` controller of every record that links a Payee, so the vendor and expense
screens, Desk, REST and any other code meet the same refusals. The rules themselves are pure, in
`expense_rules.py`; this module reads the facts and applies them. A Payee's own save has no rule here:
it is an address book entry, edited in place by anyone allowed to save it (#1434).

`check_payee_links` (the `validate` of `Vendors`, `Expense Request`, `Project Expenses` and
`Non Project Expenses`). Asked only when the save inserts the record or changes `payee`, `vendor` or
the type, so a record from before these rules still re-saves:
  - **A vendor's Payee**: a request or Project Expense naming a vendor is paid into that vendor's
    Payee: filled in when blank, any other refused (`expense_rules.follow_vendor`). A Payee left as
    it was while the vendor changed follows the new vendor; when the vendor is cleared, the old
    vendor's Payee goes with it (any other Payee stays).
  - **Who gets paid**: an Expense Request carries what its type's rule says
    (`expense_rules.request_payee`): a *Required* type can't be saved without one. An expense of a
    *Required* type can't have its Payee taken away; inserting one with none (approval of an older
    request, Bulk Import) is allowed.
  - **Paid**: once a record is paid (`rules.PAID_STATUSES`) its Payee is fixed
    (`expense_rules.paid_expense_problem`): the money went there. Correcting its vendor then moves
    nothing. Before that only Accounts change an existing expense's Payee, except as part of a vendor
    edit (the vendor's own Payee, or none when the vendor is cleared). Inserting one (approval) is
    not a change; the #1424 patch writes raw and meets none of this.
  - **Vendors**: only `role_profiles.VENDOR_PAYEE_PROFILES` set or change a vendor's Payee; making a
    vendor with none needs no such role.

The wording is `expense_rules.py`'s.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.expense_payee import payee_rule
from nirmaan_stack.services.payees.expense_rules import (
    EXPENSE_PAYEE_ROLE_PROBLEM,
    NOT_ASKED,
    OPTIONAL,
    REQUIRED,
    paid_expense_problem,
    request_payee,
)
from nirmaan_stack.services.payees.rules import PAID_STATUSES
from nirmaan_stack.services.payees.vendor_account import payee_for_vendor
from nirmaan_stack.services.role_profiles import assert_vendor_payee_access, can_manage_payees

REQUEST_DOCTYPE = "Expense Request"
VENDORS_DOCTYPE = "Vendors"


def check_payee_links(doc, user: str) -> None:
    """Every rule a record linking a Payee must pass on save, as `user` (the session user). May fill
    in or clear `doc.payee` (a vendor's Payee; what a request's rule leaves)."""
    if doc.doctype == VENDORS_DOCTYPE:
        if _changed(doc, "payee") and bool(doc.get("payee") or not doc.is_new()):
            assert_vendor_payee_access(user)
    elif _paid(doc):
        return
    elif doc.doctype == REQUEST_DOCTYPE:
        _apply_request_rules(doc)
    else:
        _apply_expense_rules(doc, user)


def _apply_request_rules(doc) -> None:
    """Fill in, clear or refuse an Expense Request's Payee by its type's rule."""
    if not _changed(doc, "payee", "vendor", "type"):
        return
    vendor = doc.get("vendor") or None
    vendor_payee = payee_for_vendor(vendor) if vendor else None
    verdict = request_payee(
        payee_rule(doc.type) if doc.get("type") else NOT_ASKED,
        expense_type=doc.get("type"),
        payee=_sent_payee(doc),
        vendor=vendor,
        vendor_payee=vendor_payee,
    )
    _refuse(verdict.problem)
    doc.payee = verdict.payee


def _apply_expense_rules(doc, user: str) -> None:
    """An unpaid Project / Non-Project Expense: its vendor's Payee, its type's rule, and only Accounts
    changing it."""
    before = doc.get_doc_before_save()
    if not _changed(doc, "payee", "vendor"):
        return

    vendor = (doc.get("vendor") or None) if doc.meta.has_field("vendor") else None
    vendor_payee = payee_for_vendor(vendor) if vendor else None
    rule = payee_rule(doc.type) if doc.get("type") else NOT_ASKED
    # Accounts may name a Payee on any type; Required only stops one being taken away.
    keeps_one = rule == REQUIRED and before is not None and before.get("payee")
    verdict = request_payee(
        REQUIRED if keeps_one else OPTIONAL,
        expense_type=doc.get("type") or doc.doctype,
        payee=_sent_payee(doc),
        vendor=vendor,
        vendor_payee=vendor_payee,
    )
    _refuse(verdict.problem)
    doc.payee = verdict.payee

    if before is not None and _changed(doc, "payee"):
        # A vendor edit moves the vendor's own Payee (or none, the vendor cleared); its own
        # permission governs it. Any other Payee is Accounts' call.
        moved_by_vendor = _changed(doc, "vendor") and (doc.payee or None) == vendor_payee
        if not moved_by_vendor and not can_manage_payees(user):
            frappe.throw(_(EXPENSE_PAYEE_ROLE_PROBLEM), frappe.PermissionError)


def _paid(doc) -> bool:
    """True when the record was already paid before this save (`rules.PAID_STATUSES`); refuses the
    save if it changes the Payee. Correcting a paid record's vendor moves nothing: the money went to
    that account."""
    before = doc.get_doc_before_save()
    if before is None or before.get("status") not in PAID_STATUSES:
        return False
    if _changed(doc, "payee"):
        _refuse(paid_expense_problem(doc.name, before.get("status")))
    return True


def _sent_payee(doc) -> str | None:
    """The Payee this save asks for. One left as it was while the vendor changed is not asked for: it
    gives way to the new vendor's Payee, and to none when the vendor was cleared and it was the old
    vendor's."""
    payee = doc.get("payee") or None
    before = doc.get_doc_before_save()
    if before is None or _changed(doc, "payee") or not _changed(doc, "vendor"):
        return payee
    if doc.get("vendor"):
        return None
    old_vendor = before.get("vendor")
    return None if old_vendor and payee == payee_for_vendor(old_vendor) else payee


def _refuse(problem: str | None) -> None:
    if problem:
        frappe.throw(_(problem), title=_("Who gets paid"))


def _changed(doc, *fields: str) -> bool:
    """True when the record is new or any of `fields` differs from before the save (blank and None
    are the same)."""
    before = doc.get_doc_before_save()
    if before is None:
        return True
    return any((before.get(f) or None) != (doc.get(f) or None) for f in fields)
