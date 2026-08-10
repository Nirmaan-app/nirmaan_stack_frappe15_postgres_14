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

# Every role profile carrying procurement access. Lead's Role Profile is a strict
# superset of Executive's at the Role level, so at the profile level the two are
# treated identically. If Lead ever needs more than Executive, add a dedicated
# gate at that one call site rather than splitting this tuple.
PROCUREMENT_PROFILES = (
    PROCUREMENT_EXECUTIVE_PROFILE,
    PROCUREMENT_LEAD_PROFILE,
)
