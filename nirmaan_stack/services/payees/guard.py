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
    Payee: filled in when blank, any other refused (`expense_rules.follow_vendor`). A Payee left as
    it was while the vendor changed follows the new vendor; when the vendor is cleared, the old
    vendor's Payee goes with it (any other Payee stays).
  - **Who gets paid**: an Expense Request carries what its type's rule says
    (`expense_rules.request_payee`): a *Required* type can't be saved without one. A request can't
    newly name a vendor (on insert, or a vendor change) whose Payee is Inactive
    (`expense_rules.vendor_payee_problem`); one already naming it keeps it, through approval. An expense of a
    *Required* type can't have its Payee taken away; inserting one with none (approval of an older
    request, Bulk Import) is allowed.
  - **Paid**: once a record is paid (`rules.PAID_STATUSES`) its Payee is fixed
    (`expense_rules.paid_expense_problem`): the money went there. Correcting its vendor then moves
    nothing. Before that only Accounts change an existing expense's Payee, except as part of a vendor
    edit (the vendor's own Payee, or none when the vendor is cleared). Inserting one (approval) is
    not a change; the #1424 patch writes raw and meets none of this.
  - **Vendors**: only `role_profiles.VENDOR_PAYEE_PROFILES` set or change a vendor's Payee; making a
    vendor with none needs no such role.
  - **Inactive**: an Inactive Payee can't be newly picked (`rules.pick_problem`). A record already
    pointing at it keeps it through any later save, and a Payee that comes from the record's vendor
    or is carried from its request on approval is never a new pick (a new request naming that vendor
    is refused by the request rule above instead).

The wording is `rules.py`'s and `expense_rules.py`'s.
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
    vendor_payee_problem,
)
from nirmaan_stack.services.payees.links import is_paid
from nirmaan_stack.services.payees.rules import (
    HOLDER_NAME_ROLE_PROBLEM,
    PAID_STATUSES,
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
        frappe.throw(_(HOLDER_NAME_ROLE_PROBLEM), frappe.PermissionError)
    problem = locked_change_problem(doc.name, before, after)
    if problem and is_paid(doc.name):
        frappe.throw(_(problem))


def check_payee_links(doc, user: str) -> None:
    """Every rule a record linking a Payee must pass on save, as `user` (the session user). May fill
    in or clear `doc.payee` (a vendor's Payee; what a request's rule leaves)."""
    if doc.doctype == VENDORS_DOCTYPE:
        new_pick = _changed(doc, "payee") and bool(doc.get("payee") or not doc.is_new())
        if new_pick:
            assert_vendor_payee_access(user)
    elif _paid(doc):
        new_pick = False
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
    """Fill in, clear or refuse an Expense Request's Payee by its type's rule. True when its Payee is
    one the raiser picked (no vendor named)."""
    if not _changed(doc, "payee", "vendor", "type"):
        return False
    vendor = doc.get("vendor") or None
    vendor_payee = payee_for_vendor(vendor) if vendor else None
    if vendor_payee and _changed(doc, "vendor"):
        _refuse(vendor_payee_problem(frappe.db.get_value(PAYEE_DOCTYPE, vendor_payee, "status")))
    verdict = request_payee(
        payee_rule(doc.type) if doc.get("type") else NOT_ASKED,
        expense_type=doc.get("type"),
        payee=_sent_payee(doc),
        vendor=vendor,
        vendor_payee=vendor_payee,
    )
    _refuse(verdict.problem)
    doc.payee = verdict.payee
    return not vendor


def _apply_expense_rules(doc, user: str) -> bool:
    """An unpaid Project / Non-Project Expense: its vendor's Payee, its type's rule, and only Accounts
    changing it. True when its Payee is a new pick (not its vendor's, not carried from its request)."""
    before = doc.get_doc_before_save()
    if not _changed(doc, "payee", "vendor"):
        return False

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
    return not vendor and not _carried_from_request(doc)


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
