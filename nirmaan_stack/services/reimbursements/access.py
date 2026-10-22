# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Reimbursement rules answered for real people, by role PROFILE (`services/role_profiles`).

`rules.py` holds the decisions as pure functions; this module only reads who someone is. Every
whitelisted endpoint and the permission hooks ask here, so the profile lists are read in one place.
"""

from __future__ import annotations

import frappe

from nirmaan_stack.services.reimbursements.rules import decide_problem
from nirmaan_stack.services.role_profiles import (
    REIMBURSEMENT_HR_PROFILES,
    REIMBURSEMENT_VIEW_ALL_PROFILES,
    has_role_profile,
    is_nirmaan_admin,
)


def is_hr(user: str) -> bool:
    """True for an HR Executive or HR Lead. Administrator is not HR (it is Admin)."""
    return has_role_profile(user, REIMBURSEMENT_HR_PROFILES, superuser_passes=False)


def sees_all_claims(user: str) -> bool:
    """True for the profiles that see every claim (Admin, HR, Accounts) and for Administrator."""
    return has_role_profile(user, REIMBURSEMENT_VIEW_ALL_PROFILES)


def claimant_is_hr(claim) -> bool:
    """Whether the claim was raised by someone in HR: the role saved on the claim when it was raised
    (`claimant_role`), so a later change of role, or deleting the user, never moves the claim to another
    approver. A claim saved before the field existed falls back to the person's role now."""
    saved = claim.get("claimant_role")
    if saved:
        return saved in REIMBURSEMENT_HR_PROFILES
    return is_hr(claim.get("owner"))


def claim_decide_problem(claim, user: str) -> str | None:
    """Why `user` may not approve or reject `claim` (a doc or dict with `status`, `amount`, `owner`,
    `claimant_role`)."""
    return decide_problem(
        claim.get("status"),
        float(claim.get("amount") or 0),
        claimant_is_hr=claimant_is_hr(claim),
        decider_is_admin=is_nirmaan_admin(user),
        decider_is_hr=is_hr(user),
    )
