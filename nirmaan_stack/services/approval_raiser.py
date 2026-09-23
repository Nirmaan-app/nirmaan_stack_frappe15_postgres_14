# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which approval level the person RAISING a payment or expense holds (owner, 2026-09-21).

The pure rule -- what that level clears -- is `approval_tiers.initial_status_for_raiser` /
`steps_cleared_by_raiser`. This module only answers "who is this user", which needs the database.

    the CEO (`CEO_AUTHORIZED_USER`)             -> RAISER_CEO   (clears L1 and L2)
    `Administrator`, or the Admin role profile  -> RAISER_L1    (clears L1)
    anyone else                                 -> None         (the normal path)

L1 is exactly the set the "Payment Pending Approval" tab lets approve (`canApprovePayments`).
Accountants are deliberately NOT L1 here, even though the bulk endpoint admits them.
"""

import frappe

from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services.approval_tiers import RAISER_CEO, RAISER_L1
from nirmaan_stack.services.role_profiles import ADMIN_PROFILE


def raiser_level(user: str | None) -> str | None:
    if not user:
        return None
    if user == CEO_AUTHORIZED_USER:
        return RAISER_CEO
    if user == "Administrator":
        return RAISER_L1
    if frappe.db.get_value("Nirmaan Users", user, "role_profile") == ADMIN_PROFILE:
        return RAISER_L1
    return None


def expense_raiser(doc) -> str | None:
    """Who raised an expense ledger row.

    ⚠️ NOT `doc.owner`. A row born from an Expense Request is inserted by the REVIEWER who
    approved that request (`expense_requests.convert.create_ledger_row`), so its owner is the
    reviewer. The person who asked for the money is the request's owner.
    """
    request_id = doc.get("request_id")
    if request_id:
        owner = frappe.db.get_value("Expense Request", request_id, "owner")
        if owner:
            return owner
    return doc.get("owner") or frappe.session.user
