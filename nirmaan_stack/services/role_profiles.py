"""Shared role-profile constants.

ADR-0010 B1: a decision the business names gets one owning module. Endpoint role
gating was previously an inline profile string repeated across ~14 modules,
which is why ``Nirmaan Procurement Lead Profile`` — a real Role Profile with a
real user — was refused by every one of them.

Lives in ``services/`` rather than ``api/`` because BOTH ``api/`` and
``integrations/`` consume it, and api -> service is the one legal direction
(same reasoning as ``services/boq_bcs/readiness.py``). It is pure data: no
``frappe.db``, no request context.

Note the two distinct layers, they are NOT the same thing:

* Doctype permissions gate on **Roles** (``Nirmaan Procurement Executive``).
  The Lead profile already carries that role, so doctype access always worked.
* Whitelisted endpoints below gate on the **role_profile** string. That is the
  layer this module owns.

Mirrored client-side by ``frontend/src/constants/roles.ts``; keep the two in sync.
This layer is the enforcement boundary.

The constants below are pure data. The RESOLVERS at the bottom
(``get_role_profile`` / ``has_role_profile`` / ``is_nirmaan_admin``) read
``frappe.db`` — a DB read, never request context: every one takes ``user`` as an
argument and none of them touch ``frappe.session``, so they stay callable from
``api/``, ``integrations/`` and a background job alike.
"""

import frappe

PROCUREMENT_EXECUTIVE_PROFILE = "Nirmaan Procurement Executive Profile"
PROCUREMENT_LEAD_PROFILE = "Nirmaan Procurement Lead Profile"
MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE = "Nirmaan Material Procurement Executive Profile"
SERVICE_PROCUREMENT_EXECUTIVE_PROFILE = "Nirmaan Service Procurement Executive Profile"

# Procurement splits by WHAT IS BOUGHT. Material = the PR -> PO chain and
# everything downstream of a material buy; Service = Work Orders (Service
# Requests) and the WO rate card.
#
# NOTE the split is a VIEW split, not an access boundary (owner ruling). Both
# new profiles carry the SAME Role (`Nirmaan Procurement Executive`), which is
# what lets all 101 doctype permissions keep working with no doctype edit and no
# migrate -- and it also means neither profile is actually refused anything at
# the Role layer. These tuples narrow what a person is SHOWN. Do not cite them
# as security.
#
# The two legacy profiles sit in BOTH sets on purpose: Procurement Executive
# predates the split and keeps seeing everything (its existing users are
# untouched until migrated by hand), and Procurement Lead leads both sides.
MATERIAL_PROCUREMENT_PROFILES = (
    PROCUREMENT_EXECUTIVE_PROFILE,
    PROCUREMENT_LEAD_PROFILE,
    MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE,
)

SERVICE_PROCUREMENT_PROFILES = (
    PROCUREMENT_EXECUTIVE_PROFILE,
    PROCUREMENT_LEAD_PROFILE,
    SERVICE_PROCUREMENT_EXECUTIVE_PROFILE,
)

# Every profile carrying procurement access -- the UNION, and the DEFAULT.
#
# This name and meaning are deliberately unchanged by the material/service
# split: a shared surface belongs to every procurement person. Only
# material-only and service-only call sites get narrowed. Defaulting to the
# union means a site someone forgets to narrow shows one stray surface -- it can
# never lock a user out of their own job.
PROCUREMENT_PROFILES = (
    PROCUREMENT_EXECUTIVE_PROFILE,
    PROCUREMENT_LEAD_PROFILE,
    MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE,
    SERVICE_PROCUREMENT_EXECUTIVE_PROFILE,
)

ADMIN_PROFILE = "Nirmaan Admin Profile"
PMO_EXECUTIVE_PROFILE = "Nirmaan PMO Executive Profile"
ACCOUNTANT_PROFILE = "Nirmaan Accountant Profile"
ACCOUNTANT_LEAD_PROFILE = "Nirmaan Accountant Lead Profile"

# May act on the "Pending Invoice Approvals" queue -- approve, reject, or re-run
# the auto-approve gates on an invoice that is stuck behind a stale reason.
#
# Mirrors the client-side gate in `InvoiceReconciliationContainer.tsx`, which
# decides whether the Pending tab renders at all. That one is UX; this is the
# ENFORCEMENT boundary, because the endpoints behind that tab save with
# `ignore_permissions=True` and a bare `@frappe.whitelist()` would otherwise be
# reachable by any logged-in user. Keep the two lists in sync.
INVOICE_APPROVAL_PROFILES = (
    ADMIN_PROFILE,
    PMO_EXECUTIVE_PROFILE,
    ACCOUNTANT_PROFILE,
    ACCOUNTANT_LEAD_PROFILE,
)


# ─────────────────────────────────────────────────────────────────────────────
# Resolvers — the ONE way a whitelisted endpoint answers "is this user X?".
#
# ⚠️ NEVER gate on `frappe.get_roles()` with a role-PROFILE name. `get_roles()`
# returns the Roles a profile BUNDLES (System Manager, Nirmaan Project Lead, ...),
# never the profile's own name, so such a check matches NOBODY — verified on the
# live site: 7 users carry the "Nirmaan Admin Profile" role_profile and ZERO
# carry a Role of that name. It fails SILENTLY and in whichever direction the
# call site happens to lean: it locked every admin out of deleting an approved
# invoice and out of enabling/disabling project modules, and (where the gate
# forgot to raise) let every logged-in user into an admin-only endpoint.
#
# These mirror the frontend's `useUserData().role`, which is also the role
# profile — so client and server agree by construction.
# ─────────────────────────────────────────────────────────────────────────────


def get_role_profile(user: str) -> str | None:
    """The user's `Nirmaan Users.role_profile`, or None when they have no row."""
    if not user:
        return None
    return frappe.db.get_value("Nirmaan Users", user, "role_profile")


def has_role_profile(user: str, profiles, *, superuser_passes: bool = True) -> bool:
    """True when `user` holds any of `profiles` (an iterable of profile names).

    `superuser_passes` (default True) mirrors every gate in this codebase, which
    reads "Administrator OR ...". Pass False for a pure profile-membership test.

    Also checks `frappe.get_roles()` as a SECOND chance, because some profile
    names additionally exist as Roles on this site. That is defence in depth, not
    the primary path — it must never be the only check (see the warning above).
    """
    if superuser_passes and user == "Administrator":
        return True

    allowed = set(profiles)
    if get_role_profile(user) in allowed:
        return True
    return bool(allowed & set(frappe.get_roles(user)))


def is_nirmaan_admin(user: str) -> bool:
    """True for the Administrator superuser or a `Nirmaan Admin Profile` user."""
    return has_role_profile(user, (ADMIN_PROFILE,))


BILLING_EXECUTIVE_PROFILE = "Nirmaan Billing Executive Profile"
BILLING_LEAD_PROFILE = "Nirmaan Billing Lead Profile"

# The billing desk. Distinct from Accountant (`Nirmaan Accountant Profile` /
# `Nirmaan Accountant Lead Profile`), which owns the INVOICE side of a PO.
BILLING_PROFILES = (
    BILLING_EXECUTIVE_PROFILE,
    BILLING_LEAD_PROFILE,
)

# May delete a DC / MIR (`PO Delivery Documents`) off a PO -- admin, procurement
# (they file them) and billing (they catch the wrong/duplicate ones).
#
# This is the ENFORCEMENT boundary. It has to be, because every write endpoint in
# `api/po_delivery_documentss.py` saves with `flags.ignore_permissions = True`,
# so the doctype's own permission rows are bypassed and a bare `@frappe.whitelist()`
# would otherwise be reachable by ANY logged-in user.
#
# Mirrored client-side by `frontend/src/constants/roles.ts::PDD_DELETE_PROFILES`,
# which only decides whether the trash icon renders. Keep the two in sync.
PDD_DELETE_PROFILES = (ADMIN_PROFILE,) + PROCUREMENT_PROFILES + BILLING_PROFILES


def can_delete_delivery_document(user: str) -> bool:
    """True when `user` may delete a DC / MIR. Administrator always passes."""
    return has_role_profile(user, PDD_DELETE_PROFILES)


def can_action_invoice_approvals(user: str) -> bool:
    """True when `user` may act on the pending invoice-approval queue."""
    return has_role_profile(user, INVOICE_APPROVAL_PROFILES)
