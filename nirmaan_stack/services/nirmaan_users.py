"""Nirmaan users: the people with a Nirmaan Users record (GLOSSARY.md). Only they, and Administrator, may log in.

The set of their names is kept in `frappe.cache`, because the login gate asks on every request: a request
costs a cache read, not a DB query. Inserting, renaming or deleting a Nirmaan Users record drops the set
(`integrations/controllers/nirmaan_users.py`), and the next question rebuilds it.
"""

import frappe

CACHE_KEY = "nirmaan_stack:nirmaan_user_names"

# Frappe's own accounts: never a Nirmaan user, never an exited employee, and always let through the login gate.
SYSTEM_USERS = ("Administrator", "Guest")


def _names() -> set[str]:
    return {name.lower() for name in frappe.get_all("Nirmaan Users", pluck="name")}


def is_nirmaan_user(user: str) -> bool:
    """True when `user` has a Nirmaan Users record. Record names are lower-cased emails."""
    return bool(user) and user.lower() in frappe.cache.get_value(CACHE_KEY, generator=_names)


def forget_nirmaan_users() -> None:
    """Drop the cached set now and again once the transaction commits, so a request that reads it before the
    commit cannot keep a stale copy."""
    frappe.cache.delete_value(CACHE_KEY)
    frappe.db.after_commit.add(lambda: frappe.cache.delete_value(CACHE_KEY))
