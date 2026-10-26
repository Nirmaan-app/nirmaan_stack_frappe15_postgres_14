"""List, per role profile, enabled users the app access gate will not lock (frontend/src/utils/appAccess.ts):
no Asset Management row names them (so no declaration to sign, no audit to send), and, for a profile that needs a
project, Nirmaan Users.has_project is "true".

    devenv.sh script <task> .claude/skills/verify/bin/free_users.py [<role profile> ...]

Read-only: it commits nothing. Prints up to 3 users per profile, or `(none ...)` when every user is locked.
"""

import sys

import frappe

# = PROJECT_REQUIRED_PROFILES in frontend/src/constants/roles.ts
PROJECT_REQUIRED = {
    "Nirmaan Project Manager Profile",
    "Nirmaan Project Lead Profile",
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Procurement Lead Profile",
    "Nirmaan Material Procurement Executive Profile",
}

wanted = set(sys.argv[1:])
held = {r[0] for r in frappe.db.sql('select distinct asset_assigned_to from "tabAsset Management"')}
rows = frappe.db.sql(
    """
    select nu.role_profile, nu.name, nu.has_project
    from "tabNirmaan Users" nu join "tabUser" u on u.name = nu.name
    where u.enabled = 1 and coalesce(nu.role_profile, '') != ''
    order by nu.role_profile, nu.name
    """
)
by_profile: dict[str, list[str]] = {}
for profile, user, has_project in rows:
    if wanted and profile not in wanted:
        continue
    free = by_profile.setdefault(profile, [])
    needs_project = profile in PROJECT_REQUIRED and str(has_project) != "true"
    if user not in held and not needs_project and len(free) < 3:
        free.append(user)
for profile, free in by_profile.items():
    print(f"{profile:46} " + ("  ".join(free) if free else "(none: every user holds an asset or lacks a project)"))
