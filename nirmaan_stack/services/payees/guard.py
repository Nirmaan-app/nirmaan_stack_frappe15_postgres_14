# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Payee rules a save must pass, on EVERY write path (#1423, spec #1420, ADR-0033).

Called from `validate` controllers, so the Payees page, the vendor and expense screens, Desk, REST and
any other code meet the same refusals. The rules themselves are pure, in `rules.py` and
`expense_rules.py`; this module reads the facts and applies them.

* `check_payee_save` (the Payee's own `validate`, on an existing Payee):
  - **Locked**: once the Payee is paid (`links.is_paid`), its account number and IFSC never change.
  - **Holder name**: only Accounts and Admins (`role_profiles.PAYEE_MANAGE_PROFILES`) may change it.
* `check_payee_links` (the `validate` of `Vendors`, `Expense Request`, `Project Expenses` and
  `Non Project Expenses`). Asked only when the save inserts the record or changes `payee`, `vendor`
  or the type, so a record from before these rules still re-saves:
  - **A vendor's Payee**: a request or Project Expense naming a vendor is paid into that vendor's
    Payee: filled in when blank, any other refused (`expense_rules.follow_vendor`).
  - **Who gets paid**: an Expense Request carries what its type's rule says
    (`expense_rules.request_payee`): a *Required* type can't be saved without one.
  - **Paid**: an expense's Payee is fixed once it is paid (`expense_rules.paid_expense_problem`), and
    before that only Accounts change it on an existing expense. Inserting one (approval) is not a
    change; the #1424 patch writes raw and meets none of this.
  - **Vendors**: only `role_profiles.VENDOR_PAYEE_PROFILES` set a vendor's Payee.
  - **Inactive**: an Inactive Payee can't be newly picked (`rules.pick_problem`). A record already
    pointing at it keeps it through any later save, and these are not new picks: approval carrying
    the request's Payee onto its expense, an expense taking its vendor's Payee, and a *Not asked*
    request carrying its vendor's.

The wording is `rules.py`'s and `expense_rules.py`'s.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.expense_payee import payee_rule
from nirmaan_stack.services.payees.expense_rules import (
    EXPENSE_PAYEE_ROLE_PROBLEM,
    NOT_ASKED,
    follow_vendor,
    paid_expense_problem,
    request_payee,
)
from nirmaan_stack.services.payees.links import is_paid
from nirmaan_stack.services.payees.rules import (
    HOLDER_NAME_ROLE_PROBLEM,
    PAYEE_DOCTYPE,
    locked_change_problem,
    parse_details,
    pick_problem,
)
from nirmaan_stack.services.payees.vendor_account import payee_for_vendor
from nirmaan_stack.services.role_profiles import (
    assert_vendor_payee_access,
    can_manage_payees,
)

REQUEST_DOCTYPE = "Expense Request"
VENDORS_DOCTYPE = "Vendors"
_WHO_GETS_PAID = "Who gets paid"


def check_payee_save(doc, user: str) -> None:
    """Refuse a save of an existing Payee that changes its holder name as anyone but Accounts or an
    Admin (`frappe.PermissionError`), or changes a paid Payee's account number or IFSC. `doc` holds the
    cleaned values (the controller cleans first)."""
    before_doc = doc.get_doc_before_save()
    if not before_doc:
        return
    before = parse_details(before_doc.account_name, before_doc.account_number, before_doc.ifsc)
    after = parse_details(doc.account_name, doc.account_number, doc.ifsc)
    if before.account_name != after.account_name and not can_manage_payees(user):
        raise frappe.PermissionError(_(HOLDER_NAME_ROLE_PROBLEM))
    problem = locked_change_problem(doc.name, before, after)
    if problem and is_paid(doc.name):
        frappe.throw(_(problem))


def check_payee_links(doc, user: str) -> None:
    """Every rule a record linking a Payee must pass on save, as `user` (the session user). May fill
    in `doc.payee` (a vendor's Payee; what a request's rule leaves)."""
    if doc.doctype == VENDORS_DOCTYPE:
        if _changed(doc, "payee"):
            assert_vendor_payee_access(user)
        new_pick = _changed(doc, "payee")
    elif doc.doctype == REQUEST_DOCTYPE:
        new_pick = _apply_request_rules(doc)
    else:
        new_pick = _apply_expense_rules(doc, user)
    if new_pick:
        check_payee_pick(doc)


def check_payee_pick(doc) -> None:
    """Refuse a save that newly points `doc.payee` at an Inactive Payee. Unchanged links pass."""
    payee = doc.get("payee")
    if not payee or not _changed(doc, "payee"):
        return
    problem = pick_problem(payee, frappe.db.get_value(PAYEE_DOCTYPE, payee, "status"))
    if problem:
        frappe.throw(_(problem))


def _apply_request_rules(doc) -> bool:
    """Fill in or refuse an Expense Request's Payee by its type's rule. True when its Payee is one the
    raiser picked (asked, and not carried from a *Not asked* type's vendor)."""
    if not _changed(doc, "payee", "vendor", "type"):
        return False
    rule = payee_rule(doc.type) if doc.get("type") else NOT_ASKED
    vendor = doc.get("vendor") or None
    verdict = request_payee(
        rule,
        expense_type=doc.get("type"),
        payee=doc.get("payee"),
        vendor=vendor,
        vendor_payee=payee_for_vendor(vendor) if vendor else None,
    )
    if verdict.problem:
        frappe.throw(_(verdict.problem), title=_(_WHO_GETS_PAID))
    doc.payee = verdict.payee
    return rule != NOT_ASKED


def _apply_expense_rules(doc, user: str) -> bool:
    """A Project / Non-Project Expense: its vendor's Payee, then the paid and Accounts rules on a
    change. True when its Payee is a new pick (not its vendor's, not carried from its request)."""
    has_vendor = doc.meta.has_field("vendor") and bool(doc.get("vendor"))
    vendor_changed = has_vendor and _changed(doc, "vendor")
    from_vendor = False
    if has_vendor and _changed(doc, "payee", "vendor"):
        # A Payee left as it was while the vendor changed follows the vendor: it is not "sent".
        sent = doc.get("payee") if _changed(doc, "payee") else None
        vendor_payee = payee_for_vendor(doc.vendor)
        verdict = follow_vendor(vendor=doc.vendor, payee=sent, vendor_payee=vendor_payee)
        if verdict.problem:
            frappe.throw(_(verdict.problem), title=_(_WHO_GETS_PAID))
        doc.payee = verdict.payee
        from_vendor = bool(vendor_payee)

    before = doc.get_doc_before_save()
    if before and _changed(doc, "payee"):
        paid = paid_expense_problem(doc.name, before.get("status"))
        if paid:
            frappe.throw(_(paid), title=_(_WHO_GETS_PAID))
        # Following a new vendor is part of the vendor edit, which its own permission governs.
        if not vendor_changed and not can_manage_payees(user):
            raise frappe.PermissionError(_(EXPENSE_PAYEE_ROLE_PROBLEM))
    return not from_vendor and not _carried_from_request(doc)


def _carried_from_request(doc) -> bool:
    """An expense inserted with the Payee its request already holds: approval carries the link, it is
    not a new pick."""
    request = doc.get("request_id")
    return bool(
        doc.is_new() and request and doc.get("payee")
        and frappe.db.get_value(REQUEST_DOCTYPE, request, "payee") == doc.payee
    )


def _changed(doc, *fields: str) -> bool:
    """True when the record is new or any of `fields` differs from before the save (blank and None
    are the same)."""
    before = doc.get_doc_before_save()
    if before is None:
        return True
    return any((before.get(f) or None) != (doc.get(f) or None) for f in fields)
