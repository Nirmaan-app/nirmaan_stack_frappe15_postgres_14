"""Exited employees: a person whose Nirmaan Users record was removed when they left (GLOSSARY.md).

Their Frappe User stays, because many records link to it, but it is switched off and stripped
(ADR "An exited employee's login is switched off and stripped, not deleted").
"""

import frappe
from frappe.sessions import clear_sessions
from frappe.utils.password import remove_encrypted_password

from nirmaan_stack.services.nirmaan_users import SYSTEM_USERS


def switch_off_login(user: str) -> None:
    """Disable `user`'s login, take away all its roles and its role profile, clear its API key and secret,
    and end its sessions once the transaction commits. Safe to run again on a user already switched off.

    Written below the User document on purpose: saving the User would run `on_user_update`, which creates
    a Nirmaan Users record for a User with none (making the person a Nirmaan user again), and Frappe's own
    save would put the profile's roles back. Nothing is derived from these fields, so no recompute is due.
    """
    if user in SYSTEM_USERS:
        return
    frappe.db.set_value("User", user, {"enabled": 0, "role_profile_name": None, "api_key": None})
    frappe.db.delete("Has Role", {"parent": user, "parenttype": "User"})
    remove_encrypted_password("User", user, "api_secret")

    def end_sessions():
        # `delete_session` commits, so it waits for the caller's transaction instead of committing it half done.
        clear_sessions(user, force=True)
        frappe.clear_cache(user=user)

    frappe.db.after_commit.add(end_sessions)


def logins_still_on(users: list[str] | None = None) -> list[frappe._dict]:
    """Users with no Nirmaan Users record whose login is not fully switched off: still enabled, or still holding
    a role, a role profile or an API key. Each row says which (`enabled`, `roles`, `role_profile_name`,
    `api_key`). `users` limits the search to those names; None means every user. Administrator and Guest
    are never listed. Read-only.
    """
    scope = "AND u.name IN %(users)s" if users is not None else ""
    if users is not None and not users:
        return []
    return frappe.db.sql(
        f"""
        SELECT u.name, u.enabled, u.role_profile_name, u.api_key,
            (SELECT STRING_AGG(r.role, ', ' ORDER BY r.role) FROM "tabHas Role" r
             WHERE r.parent = u.name AND r.parenttype = 'User') AS roles
        FROM "tabUser" u
        WHERE u.name NOT IN %(system)s {scope}
            AND NOT EXISTS (SELECT 1 FROM "tabNirmaan Users" nu WHERE LOWER(nu.name) = LOWER(u.name))
            AND (u.enabled = 1 OR COALESCE(u.role_profile_name, '') <> '' OR COALESCE(u.api_key, '') <> ''
                OR EXISTS (SELECT 1 FROM "tabHas Role" r WHERE r.parent = u.name AND r.parenttype = 'User'))
        ORDER BY u.name
        """,
        {"system": SYSTEM_USERS, "users": tuple(users or ())},
        as_dict=True,
    )


def switch_off_logins_still_on(users: list[str] | None = None) -> list[str]:
    """`switch_off_login` for every user `logins_still_on` lists; returns their names. A second run finds none."""
    names = [row.name for row in logins_still_on(users)]
    for name in names:
        switch_off_login(name)
    return names
