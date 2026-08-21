"""Snag List API package.

Wire contract: `frontend/src/pages/SnagList/types.ts` (single source of truth for
every payload shape returned by this package).
Design of record: `frontend/.claude/plans/snag-list-plan.md`.
Storage decision: `docs/adr/0017-snag-rows-are-standalone-documents.md`.

This module owns the feature's PERMISSION TIERS (plan section 6) -- one helper per
tier, defined ONCE here and imported by both `import_wizard.py` and `snags.py`.
Neither of those modules owns the other, so the shared concern lives at the package
level rather than being re-derived per endpoint (ADR-0010: one owning module).

Role resolution mirrors `api/design_tracker/bulk_update_task_status.py`:
`role_profile_name` on `User`, with "Administrator" handled as a LITERAL username
(it is not an email -- root CLAUDE.md, Domain Gotchas).
"""

import frappe

ADMIN_ROLE = "Nirmaan Admin Profile"
PROJECT_LEAD_ROLE = "Nirmaan Project Lead Profile"
PMO_ROLE = "Nirmaan PMO Executive Profile"
PROJECT_MANAGER_ROLE = "Nirmaan Project Manager Profile"
ACCOUNTANT_ROLE = "Nirmaan Accountant Profile"
ACCOUNTANT_LEAD_ROLE = "Nirmaan Accountant Lead Profile"

#: Import a workbook / delete a batch / add a manual snag.
IMPORT_ROLES = frozenset({ADMIN_ROLE, PROJECT_LEAD_ROLE, PMO_ROLE})

#: Change ONE row's status, and the `remark` that rides that change (ADR-0018).
STATUS_ROLES = frozenset(IMPORT_ROLES | {PROJECT_MANAGER_ROLE})

#: BULK status change -- Admin only (mirrors Design Tracker's bulk_update_task_status).
BULK_ROLES = frozenset({ADMIN_ROLE})

#: READ is the ONE tier expressed as a DENY list, and the inversion is deliberate.
#: Plan section 6 grants the tab to "everyone with project access except Accountant",
#: so an allow-list would have to name every present and FUTURE role profile -- and a
#: role added later would be silently locked out of a read-only view. The deny list
#: names the one excluded pair instead; a user with NO role profile at all is still
#: refused, because "no profile" is not "project access".
READ_DENIED_ROLES = frozenset({ACCOUNTANT_ROLE, ACCOUNTANT_LEAD_ROLE})


def _user_role():
    """Return the session user's role profile, or None.

    "Administrator" is a literal username, never an email, and has no role profile
    row worth reading -- callers short-circuit on it before reaching here.
    """
    return frappe.db.get_value("User", frappe.session.user, "role_profile_name")


def _require(allowed, action):
    user = frappe.session.user
    if user == "Administrator":
        return
    if _user_role() in allowed:
        return
    frappe.throw(
        f"You are not permitted to {action}.",
        frappe.PermissionError,
    )


def require_import_access(action="import or delete a snag batch"):
    """Admin / Project Lead / PMO."""
    _require(IMPORT_ROLES, action)


def require_status_access(action="change a snag's status"):
    """Admin / Project Lead / PMO / Project Manager."""
    _require(STATUS_ROLES, action)


def require_bulk_access(action="bulk-update snag statuses"):
    """Admin only."""
    _require(BULK_ROLES, action)


def require_read_access(action="view this project's snag list"):
    """Everyone with project access EXCEPT Accountant (plan section 6).

    Read is deliberately WIDER than write: the four write tiers above are allow-lists,
    this one is the deny-list described at `READ_DENIED_ROLES`. It exists because a
    read endpoint with no guard at all is readable by any logged-in session, which is
    what `get_snag_stats` shipped as.
    """
    user = frappe.session.user
    if user == "Administrator":
        return
    role = _user_role()
    if role and role not in READ_DENIED_ROLES:
        return
    frappe.throw(
        f"You are not permitted to {action}.",
        frappe.PermissionError,
    )
