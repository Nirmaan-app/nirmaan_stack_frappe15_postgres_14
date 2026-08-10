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
"""

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
