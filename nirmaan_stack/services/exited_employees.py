"""Exited employees: a person whose Nirmaan Users record was removed when they left (GLOSSARY.md).

Their Frappe User stays, because many records link to it, but it is switched off and stripped
(ADR "An exited employee's login is switched off and stripped, not deleted").
"""

import frappe
from frappe.sessions import clear_sessions
from frappe.utils.password import remove_encrypted_password

# Frappe's own accounts, never an employee.
SYSTEM_USERS = ("Administrator", "Guest")


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
