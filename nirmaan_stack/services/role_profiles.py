"""Shared role-profile constants, the checks built on them, and the access asserts endpoints start with.

ADR-0010 B1: a decision the business names gets one owning module. Endpoint role
gating was previously an inline profile string repeated across ~14 modules,
which is why ``Nirmaan Procurement Lead Profile`` — a real Role Profile with a
real user — was refused by every one of them.

Lives in ``services/`` rather than ``api/`` because BOTH ``api/`` and
``integrations/`` consume it, and api -> service is the one legal direction
(same reasoning as ``services/boq_bcs/readiness.py``). It reads no request
context.

Note the two distinct layers, they are NOT the same thing:

* Doctype permissions gate on **Roles** (``Nirmaan Procurement Executive``).
  The Lead profile already carries that role, so doctype access always worked.
* Whitelisted endpoints below gate on the **role_profile** string. That is the
  layer this module owns.

Mirrored client-side by ``frontend/src/constants/roles.ts``; keep the two in sync.
This layer is the enforcement boundary.

The constants are pure data. The RESOLVERS (``get_role_profile`` /
``has_role_profile`` / ``is_nirmaan_admin``), the ``can_*`` checks built on them and
the ``assert_*`` access guards (``assert_cheque_access`` /
``assert_cheque_form_access``, which raise ``frappe.PermissionError``) read
``frappe.db`` — a DB read, never request context: every one takes ``user`` as an
argument and none of them touch ``frappe.session``, so they stay callable from
``api/``, ``integrations/`` and a background job alike.
"""

import frappe
from frappe import _

PROCUREMENT_EXECUTIVE_PROFILE = "Nirmaan Procurement Executive Profile"
PROCUREMENT_LEAD_PROFILE = "Nirmaan Procurement Lead Profile"
MATERIAL_PROCUREMENT_EXECUTIVE_PROFILE = "Nirmaan Material Procurement Executive Profile"
SERVICE_PROCUREMENT_EXECUTIVE_PROFILE = "Nirmaan Service Procurement Executive Profile"
# ^ A company-wide WO desk, like Estimates: NEVER assigned projects, sees all of them.
# That takes zero User Permission rows (so Frappe lists stay unfiltered) AND a seat in
# every project-scoped endpoint's full-access list -- today `api/sidebar_counts.py`
# and `api/tds/get_tds_requests.py`. The frontend half is in `constants/roles.ts`.

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
#: The accountants: told of an approved Work Order and of a signed generated invoice, and linked to payments.
ACCOUNTANT_PROFILES = (ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE)

# May act on the "Pending Invoice Approvals" queue -- approve, reject, or re-run
# the auto-approve gates on an invoice that is stuck behind a stale reason.
#
# Mirrors the client-side gate in `InvoiceReconciliationContainer.tsx`, which
# decides whether the Pending tab renders at all. That one is UX; this is the
# ENFORCEMENT boundary, because the endpoints behind that tab save with
# `ignore_permissions=True` and a bare `@frappe.whitelist()` would otherwise be
# reachable by any logged-in user. Keep the two lists in sync.
#
# PMO Executive was REMOVED on 2026-09-17 (PMO access review), on both sides.
INVOICE_APPROVAL_PROFILES = (
    ADMIN_PROFILE,
    ACCOUNTANT_PROFILE,
    ACCOUNTANT_LEAD_PROFILE,
)

# May see Vendor Invoice Recon -> "Pending Invoices Upload": the approvers plus PMO and every procurement
# profile, who chase the missing invoices (owner ruling 2026-09-24). Mirrors `PENDING_INVOICE_UPLOAD_PROFILES`
# in `frontend/src/constants/roles.ts`. The PO and WO sub-tabs are read-only reports; this list is the
# ENFORCEMENT boundary of the Credit Card sub-tab's endpoints (`api/expenses/card_invoices`: list, attach).
PENDING_INVOICE_UPLOAD_PROFILES = INVOICE_APPROVAL_PROFILES + (PMO_EXECUTIVE_PROFILE,) + PROCUREMENT_PROFILES

# May mark a card spend *No invoice* (ADR-0039 ruling 8): Admin and Accountant Lead. ENFORCEMENT boundary of
# `api/expenses/card_invoices.mark_card_no_invoice`; mirrored by `canMarkCardNoInvoice` in `constants/roles.ts`.
CARD_NO_INVOICE_PROFILES = (ADMIN_PROFILE, ACCOUNTANT_LEAD_PROFILE)

# Work the settled end of the Payments queue (owner, 2026-09-21): send a Reconciliation Pending
# payment back to Approved, and edit a project / non-project expense on the queue's tabs.
# Also hold / release an Approved payment (owner, 2026-09-22; `services/payment_hold.py`).
#
# The revert endpoint (`api/payments/revert_to_approved.py`) is the ENFORCEMENT boundary for the
# revert; the expense edits go through the doctype's own permissions. Mirrored client-side by
# `QUEUE_EDIT_PROFILES` in `frontend/src/pages/ProjectPayments/config/queueRowActions.ts` --
# keep the two lists in sync.
PAYMENT_SETTLE_PROFILES = (ADMIN_PROFILE, ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE)

# The L1 step of a payment's approval: approve or reject a Requested payment, alone or in bulk
# (#1530). The Admin profile, plus `Administrator` and the CEO. Mirrored client-side by `canApprove`
# in `frontend/src/pages/ProjectPayments/config/paymentsTabSet.ts` (the Approve Payments tab) and
# matching `services/approval_raiser.raiser_level`. ENFORCEMENT boundary: the Project Payments
# `validate` hook (`services/payment_steps.py`) and `api/payments/bulk_actions._authorize_lead`.
PAYMENT_L1_PROFILES = (ADMIN_PROFILE,)

# `Non Project Inflows` (#1265, ADR-0016 Amendment A) -- company treasury money. Read + create:
# Admin / Accountant / Accountant Lead; edit: Admin + Accountant Lead; delete: Admin only.
#
# ⚠️ WHY PROFILES AND NOT THE DOCTYPE'S ROLE ROWS ALONE: the only role that can delete is
# `System Manager`, and that role also rides on the PMO, Project Lead, Estimates, HR and Design
# Lead profiles. Role rows cannot say "Admin only", so `integrations/controllers/
# non_project_inflows.py` narrows them per profile. Mirrored client-side by
# `NON_PROJECT_INFLOWS_ACCESS` / `_EDIT` / `_DELETE` in `frontend/src/constants/roles.ts`.
NON_PROJECT_INFLOWS_READ_PROFILES = (ADMIN_PROFILE, ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE)
NON_PROJECT_INFLOWS_WRITE_PROFILES = (ADMIN_PROFILE, ACCOUNTANT_LEAD_PROFILE)
NON_PROJECT_INFLOWS_DELETE_PROFILES = (ADMIN_PROFILE,)

# The Amount Paid Mismatch report and its Recount (#1455, ADR-0034): Admin and Accountant Lead only --
# the people who can judge a wrong payment. Narrower than the 2B Reconcile report (no Accountant).
# ENFORCEMENT boundary for `api/reports/amount_paid_mismatch`, whose recount writes with `set_value`.
# Mirrored client-side by `frontend/src/constants/roles.ts::AMOUNT_PAID_MISMATCH_PROFILES`.
AMOUNT_PAID_MISMATCH_PROFILES = (ADMIN_PROFILE, ACCOUNTANT_LEAD_PROFILE)

# Match GST to vendor and the GST mismatch list (#1538, ADR-0028 Amendment A): Admin and Accountants.
# ENFORCEMENT boundary for `api/service_requests/match_gst_to_vendor`, which saves with
# `ignore_permissions`. Mirrored client-side by `frontend/src/constants/roles.ts::MATCH_GST_TO_VENDOR_PROFILES`.
MATCH_GST_TO_VENDOR_PROFILES = (ADMIN_PROFILE, ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE)

HR_EXECUTIVE_PROFILE = "Nirmaan HR Executive Profile"
HR_LEAD_PROFILE = "Nirmaan HR Lead Profile"

# Set or change a person's `Nirmaan Users.department` (owner, 2026-10-12). Many roles have
# write on Nirmaan Users (their own profile), so the doctype's role rows cannot say this;
# `NirmaanUsers.validate` enforces it. Mirrored client-side by `DEPARTMENT_EDIT_PROFILES` in
# `frontend/src/constants/departments.ts` -- keep the two lists in sync.
DEPARTMENT_EDIT_PROFILES = (ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE)

# See the asset history -- the cross-asset log (`api/assets/history.get_asset_history`) and the
# History card on an asset (owner, 2026-10-12: "only admin and HR"). Mirrored client-side by
# `canViewHistory` in `frontend/src/pages/Assets/utils/permissions.ts` -- keep the two in sync.
ASSET_HISTORY_PROFILES = (ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE)

# Assign and unassign assets (owner, 2026-10-13): Admin, HR and PMO handle every asset; procurement
# handles Project assets only. Nobody else, whatever Roles their profile bundles (System Manager on
# Project Lead / Design Lead / Estimates carries Asset Management create + delete). HR Lead has every
# asset permission HR Executive has (owner, 2026-10-15). `services/asset_assign_access.py` enforces it;
# mirrored client-side by `canAssignAssetType` in `frontend/src/pages/Assets/utils/permissions.ts` -- keep
# the two in sync.
ASSET_ASSIGN_ALL_PROFILES = (ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE, PMO_EXECUTIVE_PROFILE)
ASSET_ASSIGN_PROJECT_PROFILES = PROCUREMENT_PROFILES

# Mark an asset Lost/Damaged and bring it back Found/Repaired (owner, 2026-10-31): Admin and HR only -- not PMO,
# not procurement, not the holder. `api/assets/lost_damaged.py` enforces it; mirrored client-side by
# `canMarkLostDamaged` in `frontend/src/pages/Assets/utils/permissions.ts` -- keep the two in sync.
ASSET_LOST_DAMAGED_PROFILES = (ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE)

# Monthly asset audit (owner, 2026-10-14). Switching a category's "Monthly audit required": Admin only (the
# Categories tab shows the column to Admin alone, owner 2026-10-14). Reading audit rows from the history -- the
# Asset Audit tab's Fulfilled list -- everyone who sees the Assets lists (`canViewAssets`), on top of
# ASSET_HISTORY_PROFILES. Mirrored in `frontend/src/pages/Assets/utils/permissions.ts` -- keep in sync.
ASSET_CATEGORY_AUDIT_PROFILES = (ADMIN_PROFILE,)
ASSET_AUDIT_VIEW_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE) + PROCUREMENT_PROFILES

# Reimbursements (owner, 2026-10-21/22). Everyone raises and sees their own claims. HR decides a claim of
# any amount raised outside HR; Admin decides every claim (`services/reimbursements/rules.py`; the monthly
# limit, 2026-10-28, decides only whether HR's approval also needs L1). These
# profiles see every claim, and work the Approved and Rejected tabs (tick + Export). Enforced by
# `integrations/controllers/reimbursement.py` and `services/reimbursements/access.py`; mirrored client-side
# by `REIMBURSEMENT_*` in `frontend/src/constants/roles.ts` -- keep the lists in sync.
REIMBURSEMENT_HR_PROFILES = (HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE)
REIMBURSEMENT_VIEW_ALL_PROFILES = (
    ADMIN_PROFILE,
    HR_EXECUTIVE_PROFILE,
    HR_LEAD_PROFILE,
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


def assert_match_gst_to_vendor_access(user: str) -> None:
    """Refuse a user outside `MATCH_GST_TO_VENDOR_PROFILES`. Every Match GST to vendor endpoint starts with it."""
    if not has_role_profile(user, MATCH_GST_TO_VENDOR_PROFILES):
        raise frappe.PermissionError(_("Only an Admin or an Accountant may use Match GST to vendor."))


def assert_amount_paid_mismatch_access(user: str) -> None:
    """Refuse a user outside `AMOUNT_PAID_MISMATCH_PROFILES`. Both of the report's endpoints start with it."""
    if not has_role_profile(user, AMOUNT_PAID_MISMATCH_PROFILES):
        raise frappe.PermissionError(_("Only an Admin or Accountant Lead may use the Amount Paid Mismatch report."))


BILLING_EXECUTIVE_PROFILE = "Nirmaan Billing Executive Profile"
BILLING_LEAD_PROFILE = "Nirmaan Billing Lead Profile"

# The billing desk. Distinct from Accountant (`Nirmaan Accountant Profile` /
# `Nirmaan Accountant Lead Profile`), which owns the INVOICE side of a PO.
BILLING_PROFILES = (
    BILLING_EXECUTIVE_PROFILE,
    BILLING_LEAD_PROFILE,
)

# May delete a DC / MIR (`PO Delivery Documents`), whether filed against a PO or
# an ITM -- admin, PMO, procurement (they file them) and billing (they catch the
# wrong/duplicate ones).
#
# This is the ENFORCEMENT boundary. It has to be, because every write endpoint in
# `api/po_delivery_documentss.py` saves with `flags.ignore_permissions = True`,
# so the doctype's own permission rows are bypassed and a bare `@frappe.whitelist()`
# would otherwise be reachable by ANY logged-in user.
#
# Mirrored client-side by `frontend/src/constants/roles.ts::PDD_DELETE_PROFILES`,
# which only decides whether the trash icon renders. Keep the two in sync.
PDD_DELETE_PROFILES = (
    (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE) + PROCUREMENT_PROFILES + BILLING_PROFILES
)


# Client billing tracker (`Project Billing Tracker` / `Project Billing` /
# `Project Billing Packages`). Owner ruling 2026-10-03: Admin, PMO and billing
# users set up billing and edit bills. This is the ENFORCEMENT boundary: the
# doctypes grant `System Manager`, which also rides on the Project Lead and
# other profiles, so a DocPerm alone cannot express "Admin + PMO + billing".
# Mirrored client-side by `frontend/src/constants/roles.ts::PROJECT_BILLING_WRITE_PROFILES`.
PROJECT_BILLING_WRITE_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE) + BILLING_PROFILES

# The billing package master list: Admin and the Billing Lead only.
PROJECT_BILLING_PACKAGE_WRITE_PROFILES = (ADMIN_PROFILE, BILLING_LEAD_PROFILE)


def can_write_project_billing(user: str) -> bool:
    """True when `user` may set up billing, add or edit bills, or log Supply DC."""
    return has_role_profile(user, PROJECT_BILLING_WRITE_PROFILES)


def can_delete_delivery_document(user: str) -> bool:
    """True when `user` may delete a DC / MIR. Administrator always passes."""
    return has_role_profile(user, PDD_DELETE_PROFILES)


def can_action_invoice_approvals(user: str) -> bool:
    """True when `user` may act on the pending invoice-approval queue."""
    return has_role_profile(user, INVOICE_APPROVAL_PROFILES)


# A Vendor Invoice on a WORK ORDER (#1531, ADR-0014 Amendment A). Purchase Order invoices keep
# their old rules. The ENFORCEMENT boundary is the Vendor Invoices `validate` hook
# (`integrations/controllers/vendor_invoices.guard_work_order_invoice`, rule in
# `services/work_order_invoice_access.py`), so Desk and the API obey it as the screens do.
#
# * Approve or reject: the invoice-approval roles, the same people who work the Pending queue.
# * Edit (number, date, amount, base, GST): Accountants and Admin, the WO page's Edit gate
#   (`isAccountant` in `DocumentAttachments.tsx`).
# * Change an APPROVED invoice's number, date or amount: Admin only. Everyone else rejects it and
#   uploads it again.
# Uploading a new invoice is NOT narrowed: PMO and Procurement upload WO invoices today.
WO_INVOICE_DECIDE_PROFILES = INVOICE_APPROVAL_PROFILES
WO_INVOICE_EDIT_PROFILES = (ADMIN_PROFILE, ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE)
WO_APPROVED_INVOICE_EDIT_PROFILES = (ADMIN_PROFILE,)


def can_decide_wo_invoice(user: str) -> bool:
    """True when `user` may approve or reject a Work Order invoice. Administrator passes."""
    return has_role_profile(user, WO_INVOICE_DECIDE_PROFILES)


def can_edit_wo_invoice(user: str) -> bool:
    """True when `user` may edit a Pending or Rejected Work Order invoice. Administrator passes."""
    return has_role_profile(user, WO_INVOICE_EDIT_PROFILES)


def can_edit_approved_wo_invoice(user: str) -> bool:
    """True when `user` may change an Approved Work Order invoice's number, date or amount."""
    return has_role_profile(user, WO_APPROVED_INVOICE_EDIT_PROFILES)


PROJECT_MANAGER_PROFILE = "Nirmaan Project Manager Profile"
PROJECT_LEAD_PROFILE = "Nirmaan Project Lead Profile"

# Approve or reject a Work Order, and accept or revert its amendment (#1529, spec #1528). The
# ENFORCEMENT boundary is the Service Requests `validate` hook
# (`integrations/controllers/service_requests.guard_lifecycle`, rule in `services/work_order_lifecycle.py`),
# so Desk and the API obey it: about 17 Roles write a Work Order, and System Manager rides on several
# profiles, so the doctype's Role rows cannot say this. Mirrored client-side by `SR_ADMIN_ROLES` in
# `frontend/src/pages/ServiceRequests/config/srTabs.constants.ts` -- keep the two in sync. PMO was removed
# on 2026-09-17 (PMO access review).
WO_DECIDE_PROFILES = (ADMIN_PROFILE, PROJECT_LEAD_PROFILE)


def can_decide_work_order(user: str) -> bool:
    """True when `user` may approve or reject a Work Order or decide its amendment. Administrator passes."""
    return has_role_profile(user, WO_DECIDE_PROFILES)

# May upload, edit and delete a Material Test Certificate (owner, 2026-10-07).
#
# ENFORCEMENT boundary, checked in `integrations/controllers/material_test_certificate.py`.
# The doctype's Role rows cannot say this on their own: `System Manager` and
# `Nirmaan Procurement Executive` also ride on the Project Lead profile, which must NOT
# change MTCs. Mirrored client-side by `frontend/src/constants/roles.ts::MTC_MANAGE_PROFILES`
# (display only). Keep the two in sync.
MTC_MANAGE_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE) + PROCUREMENT_PROFILES

# Use the MTC list page, and see only the projects assigned to them through
# `User Permission` -- strictly: no assignment means no projects, NOT Frappe's
# default of "everything" (owner, 2026-10-07). Mirrored by `MTC_PAGE_PROFILES`.
MTC_PROJECT_SCOPED_PROFILES = (PROJECT_MANAGER_PROFILE, PROJECT_LEAD_PROFILE)


def can_manage_mtc(user: str) -> bool:
    """True when `user` may upload / edit / delete an MTC. Administrator always passes."""
    return has_role_profile(user, MTC_MANAGE_PROFILES)


# Generate and void a generated invoice on a GST-off Work Order, and upload its signed copy (#1546 /
# #1547, spec #1528 story 89): Admin, PMO, service procurement and Project Lead. Approving the Vendor
# Invoice the upload creates stays with WO_INVOICE_DECIDE_PROFILES. ENFORCEMENT boundary for
# `api/service_requests/generated_invoices`, which writes with `ignore_permissions` (the doctype grants
# read only). Mirrored client-side by `frontend/src/constants/roles.ts::WO_GENERATED_INVOICE_PROFILES`.
WO_GENERATED_INVOICE_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE, PROJECT_LEAD_PROFILE) + SERVICE_PROCUREMENT_PROFILES


def can_generate_wo_invoice(user: str) -> bool:
    """True when `user` may generate, void or upload a Work Order's generated invoice."""
    return has_role_profile(user, WO_GENERATED_INVOICE_PROFILES)


def assert_generate_wo_invoice_access(user: str) -> None:
    """Refuse a user outside `WO_GENERATED_INVOICE_PROFILES`."""
    if not can_generate_wo_invoice(user):
        raise frappe.PermissionError(
            _("Only Admin, PMO, Procurement and Project Leads can generate, void or upload a Work Order's generated invoice.")
        )


# May open "Adjust Payments" on a PO and record a waiting Vendor Refund from it (#1400, ADR-0032:
# "anyone who may use Adjust Payments may record one"). Waiting refunds are PO-only, so the material
# procurement profiles, exactly as the PO page's button gate (`PODetails.tsx`).
# ENFORCEMENT boundary for `api/vendor_refunds/waiting_refunds.record_waiting_refund`, which writes
# with `ignore_permissions` (the Vendor Refunds DocPerms give these users read only).
ADJUST_PAYMENTS_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE) + MATERIAL_PROCUREMENT_PROFILES

# "An Accountant" for a waiting Vendor Refund (#1400): may correct its amount or PO while it waits, or
# cancel it, besides the user who recorded it. Mirrored client-side by
# `frontend/src/constants/roles.ts::REFUND_ACCOUNTANT_PROFILES`.
REFUND_ACCOUNTANT_PROFILES = (ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE)

# May complete a Vendor Refund's paperwork -- its proof, UTR and description -- at any status (#1396
# story 10): whoever works the PO's payments, i.e. the "Adjust Payments" profiles and the Accountants.
# Its amount and PO stay with its creator or an Accountant (`services/vendor_refunds.money_edit_problem`).
# ENFORCEMENT boundary for `api/vendor_refunds/waiting_refunds.update_waiting_refund`. Mirrored
# client-side by `frontend/src/constants/roles.ts::REFUND_PAPERWORK_PROFILES`.
REFUND_PAPERWORK_PROFILES = ADJUST_PAYMENTS_PROFILES + REFUND_ACCOUNTANT_PROFILES

# May delete a Cancelled Vendor Refund from its PO's Transaction Details (owner, 2026-10-13): an Admin or
# material Procurement (waiting refunds, and so Cancelled ones, are PO-only). ENFORCEMENT boundary for
# `api/vendor_refunds/waiting_refunds.delete_cancelled_refund`. Mirrored client-side by
# `frontend/src/constants/roles.ts::REFUND_DELETE_PROFILES`.
REFUND_DELETE_PROFILES = (ADMIN_PROFILE,) + MATERIAL_PROCUREMENT_PROFILES

# Cheques (spec #1407). Admin, Accountant and Accountant Lead run cheques end to end; Procurement may
# view the Cheque Payments report and add a Cheque, but never change its status.
# Project Managers have no access. ENFORCEMENT boundary for every endpoint in `api/cheques/`, which
# write through `services/cheques/writer.py` with `ignore_permissions`: the Cheques DocPerms cannot
# say this (`Nirmaan Procurement Executive` also rides on the Project Lead profile). Not tied to the
# Payment TDS Deduction read permission. Mirrored client-side by
# `frontend/src/constants/roles.ts::CHEQUE_ACCESS_PROFILES` / `CHEQUE_ACCOUNTS_PROFILES`.
CHEQUE_ACCOUNTS_PROFILES = PAYMENT_SETTLE_PROFILES
CHEQUE_ACCESS_PROFILES = CHEQUE_ACCOUNTS_PROFILES + PROCUREMENT_PROFILES


def can_use_cheques(user: str) -> bool:
    """True when `user` may open the Cheque Payments report and add a Cheque. Administrator passes."""
    return has_role_profile(user, CHEQUE_ACCESS_PROFILES)


def assert_cheque_access(user: str) -> None:
    """Refuse a user outside `CHEQUE_ACCESS_PROFILES` (Project Managers included). Every cheques
    endpoint starts with it."""
    if not can_use_cheques(user):
        raise frappe.PermissionError(_("You are not allowed to view or add cheques."))


def assert_cheque_form_access(user: str) -> None:
    """Refuse a user who may neither use cheques nor request a payment (create on Project Payments).
    For the read-only helpers a cheque form calls, Request Payment's Cheque mode included."""
    if not (can_use_cheques(user) or frappe.has_permission("Project Payments", "create", user=user)):
        raise frappe.PermissionError(_("You are not allowed to look up cheques."))


# Reports > Bulk Download: every project's documents, Project and Vendor as table filters (owner,
# 2026-10-28: "only Admin, Accountant"; Accountant Lead mirrors Accountant). The tab is hidden from
# everyone else AND the all-scope endpoints refuse them (`api/pdf_helper/bulk_download._scope`,
# `mtc_api.get_mtcs(all_projects=1)`), so a typed URL or a crafted call fetches nothing. The project and
# vendor Bulk Download tabs keep their own rules. Mirrored client-side by
# `frontend/src/constants/roles.ts::REPORTS_BULK_DOWNLOAD_PROFILES` -- keep the two in sync.
REPORTS_BULK_DOWNLOAD_PROFILES = (ADMIN_PROFILE, ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE)


def assert_reports_bulk_download_access(user: str) -> None:
    """Refuse a user outside `REPORTS_BULK_DOWNLOAD_PROFILES` (Administrator passes). Every all-scope
    Bulk Download call starts with it, the background job included."""
    if not has_role_profile(user, REPORTS_BULK_DOWNLOAD_PROFILES):
        raise frappe.PermissionError(_("You are not allowed to download documents across all projects."))


# Payees (spec #1420, ADR-0033). Admin, Accountant and Accountant Lead manage Payees on the Payees page:
# list them, add one, and (#1423) edit a holder name. Procurement adds Payees only
# through the vendor screens, and anyone raising an Expense Request only through the request; those
# endpoints carry their own checks and call the same Payee module (`services/payees/`). ENFORCEMENT
# boundary for every endpoint in `api/payees/`, which write with `ignore_permissions`. Mirrored
# client-side by `frontend/src/constants/roles.ts::PAYEE_MANAGE_PROFILES`.
PAYEE_MANAGE_PROFILES = (ADMIN_PROFILE, ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE)


def can_manage_payees(user: str) -> bool:
    """True when `user` may use the Payees page. Administrator passes."""
    return has_role_profile(user, PAYEE_MANAGE_PROFILES)


def assert_payee_manager(user: str) -> None:
    """Refuse a user outside `PAYEE_MANAGE_PROFILES`. Every Payees-page endpoint starts with it."""
    if not can_manage_payees(user):
        frappe.throw(_("Only Accounts and Admins can manage payees here."), frappe.PermissionError)


# The vendor screens' Payee step (#1425/#1426): who may create a vendor, and so pick its Payee or add
# one from new bank details. Everyone who reaches a new-vendor form today: Procurement (the Vendors
# page and the PR / WO vendor sheets), Admin and PMO (Admin Options > Vendors), the Project Lead (Custom
# PR's New Vendor) and Accounts (the Vendors page). ENFORCEMENT boundary for `api/payees/vendor_payee`
# and `api/create_vendor_and_address`, which write with `ignore_permissions`. Mirrored client-side by
# `frontend/src/constants/roles.ts::VENDOR_PAYEE_PROFILES` for the vendor page's Edit bank details and Use a different payee (#1426, #1435).
VENDOR_PAYEE_PROFILES = (
    (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE, PROJECT_LEAD_PROFILE) + PROCUREMENT_PROFILES + PAYEE_MANAGE_PROFILES
)


def assert_vendor_payee_access(user: str) -> None:
    """Refuse a user outside `VENDOR_PAYEE_PROFILES` (Administrator passes). Every vendor-screen Payee
    endpoint starts with it, and the `Vendors` `validate` refuses a `payee` set or change by anyone
    else (`payees.guard`)."""
    if not has_role_profile(user, VENDOR_PAYEE_PROFILES):
        frappe.throw(_("You are not allowed to set a vendor's bank account."), frappe.PermissionError)

# Project Ledger (owner, 2026-10-28), enforced by `api/projects/project_ledger`; client twin in `roles.ts`.
PROJECT_LEDGER_PROFILES = (ADMIN_PROFILE, PMO_EXECUTIVE_PROFILE, ACCOUNTANT_PROFILE, ACCOUNTANT_LEAD_PROFILE)
