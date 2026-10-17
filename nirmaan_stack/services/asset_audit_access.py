"""Who may switch a category's monthly audit on or off (owner, 2026-10-14).

Admin only -- the Admin profile and the Administrator user (`ASSET_CATEGORY_AUDIT_PROFILES` in
`services/role_profiles.py`; owner 2026-10-14). Checked in `AssetCategory.validate` (a change, or a new category
created with it on), so Desk and the REST API pass through it, and in `api/assets/audits.set_category_audit`.
"""

import frappe

from nirmaan_stack.services.role_profiles import ASSET_CATEGORY_AUDIT_PROFILES, has_role_profile


def check_may_switch_category_audit() -> None:
    """Refuse (PermissionError) when the session user may not switch a category's monthly audit."""
    if not has_role_profile(frappe.session.user, ASSET_CATEGORY_AUDIT_PROFILES):
        frappe.throw(
            "Only Admin can switch a category's monthly audit on or off.", frappe.PermissionError
        )
