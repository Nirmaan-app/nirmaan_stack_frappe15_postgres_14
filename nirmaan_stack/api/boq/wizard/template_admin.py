"""Master-template lifecycle endpoint (ADR-0013 Amendment A1, A1-D10).

Amendment A1 collapses the old N-template management surface (publish / deprecate /
unpublish / duplicate / delete of flagged `BOQs` rows) into a single **singleton**
lifecycle: there is exactly ONE master template, stored in the dedicated `BoQ Template`
doctype, with an `is_active` Check gating whether it appears in the Create-from-Template
picker. An admin flips it inactive to make risky structural edits, then re-activates.

This module now exposes only:

  - set_template_active(active) -- toggle the single master's `is_active` (+ provenance).

The seed/materialize and editor read endpoints live in `template_materialize.py`
(A-T2); the create-from-template clone lives in `create_from_template.py` (A-T3).

Gated to the template-manager roles (Admin + Estimates Executive) plus the
Administrator user (ADR-0013 A1-D10).
"""

import frappe
from frappe import _

# Roles allowed to author / manage the master BoQ template (ADR-0013 A1-D10). The
# Administrator user is always allowed (handled in the gate).
MANAGE_TEMPLATE_ROLES = frozenset(
    {
        "Nirmaan Admin Profile",
        "Nirmaan Estimates Executive Profile",
    }
)


# ---------------------------------------------------------------------------
# Role gate
# ---------------------------------------------------------------------------

def _user_role_profile(user: str) -> str:
    """Role profile for a user. Nirmaan Users is keyed by the user email (== the User
    docname), so look it up with the RAW session user -- matching the established wizard
    convention (pricing.py / draft_lock.py). The Administrator user has no Nirmaan Users
    row so it is mapped to admin explicitly."""
    if user == "Administrator":
        return "Nirmaan Admin Profile"
    return frappe.db.get_value("Nirmaan Users", user, "role_profile") or ""


def _require_template_manager() -> None:
    """Throw PermissionError unless the session user may manage the master template."""
    user = frappe.session.user
    if user == "Administrator":
        return
    if _user_role_profile(user) not in MANAGE_TEMPLATE_ROLES:
        frappe.throw(
            _("You are not permitted to manage the BoQ master template."),
            frappe.PermissionError,
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _coerce_active(active) -> int:
    """Coerce a whitelisted `active` arg (may arrive as 1/0/"true"/"false"/bool) to
    the 0/1 int the `is_active` Check stores."""
    if isinstance(active, bool):
        return 1 if active else 0
    if isinstance(active, (int, float)):
        return 1 if int(active) else 0
    if isinstance(active, str):
        v = active.strip().lower()
        if v in ("1", "true", "yes", "on"):
            return 1
        if v in ("0", "false", "no", "off", ""):
            return 0
    return 1 if active else 0


def _master_template_name() -> str:
    """Docname of the single master `BoQ Template`. Throws if none has been seeded."""
    rows = frappe.get_all(
        "BoQ Template",
        fields=["name"],
        order_by="modified desc",
        limit_page_length=1,
    )
    if not rows:
        frappe.throw(
            _("No master BoQ Template exists. Seed one first via 'Set as master template'."),
            title=_("No master template"),
        )
    return rows[0].name


# ---------------------------------------------------------------------------
# Lifecycle: activate / deactivate the single master
# ---------------------------------------------------------------------------

@frappe.whitelist(methods=["POST"])
def set_template_active(active=None):
    """Toggle the single master template's `is_active` flag.

    Only an active master appears in the Create-from-Template picker (A1-D10). Admins
    flip it inactive to make risky structural edits without exposing a half-edited
    skeleton, then back to active. Touches the provenance stamps
    (`last_updated_by`/`last_updated_on`).

    Returns {"status": "saved", "is_active": <0|1>, "template": <docname>}.
    """
    _require_template_manager()

    active_int = _coerce_active(active)
    master_name = _master_template_name()

    frappe.db.set_value(
        "BoQ Template",
        master_name,
        {
            "is_active": active_int,
            "last_updated_by": frappe.session.user,
            "last_updated_on": frappe.utils.now(),
        },
    )
    frappe.db.commit()

    return {"status": "saved", "is_active": active_int, "template": master_name}
