# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What the save of a record touching Payees does, on EVERY write path (#1423, #1436, spec #1420,
ADR-0033).

Called from the `validate` controller of `Vendors`, `Expense Request` and `Project Expenses`, so the
vendor and expense screens, Desk, REST and any other code meet the same rules. A Payee's own save has no
rule here: it is an address book entry, edited in place by anyone allowed to save it (#1434).

`check_payee_links`:
  - **A record naming a vendor** (an Expense Request, a Project Expense) is paid into the vendor's
    Payee: its pay-to account is copied from it when it has none and whenever the vendor changes, until
    it is paid (`pay_to.fill_from_vendor`). A fill, never a refusal.
  - **No other refusal** (#1436): a *Required* type with no account, a vendor and an account that
    disagree, a change after payment, a change by someone outside Accounts are screen rules, like the
    app's other edit-by-status rules (owner, 2026-10-15).
  - **Vendors**: only `role_profiles.VENDOR_PAYEE_PROFILES` set or change a vendor's Payee; making a
    vendor with none needs no such role.
"""

from __future__ import annotations

from nirmaan_stack.services.payees.pay_to import fill_from_vendor
from nirmaan_stack.services.role_profiles import assert_vendor_payee_access

VENDORS_DOCTYPE = "Vendors"


def check_payee_links(doc, user: str) -> None:
    """Every rule a record touching Payees meets on save, as `user` (the session user). May fill in a
    record's pay-to account from its vendor's Payee."""
    if doc.doctype == VENDORS_DOCTYPE:
        if _changed(doc, "payee") and bool(doc.get("payee") or not doc.is_new()):
            assert_vendor_payee_access(user)
    else:
        fill_from_vendor(doc)


def _changed(doc, *fields: str) -> bool:
    """True when the record is new or any of `fields` differs from before the save (blank and None
    are the same)."""
    before = doc.get_doc_before_save()
    if before is None:
        return True
    return any((before.get(f) or None) != (doc.get(f) or None) for f in fields)
