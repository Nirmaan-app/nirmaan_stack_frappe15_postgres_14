"""The two doors only Nirmaan users pass (owner, 2026-11-05): logging in, and every request after.

An exited employee's login is switched off when their record is removed (`services/exited_employees`).
These doors also stop anyone with no Nirmaan Users record whose login is still on, however they
authenticate: password, cookie session, API key or token. Administrator and Guest always pass.
"""

import frappe
from frappe import _
from frappe.sessions import delete_session

from nirmaan_stack.services.nirmaan_users import is_nirmaan_user

ALWAYS_PASS = ("Administrator", "Guest")


def _may_enter(user: str) -> bool:
	return user in ALWAYS_PASS or is_nirmaan_user(user)


def _refuse():
	frappe.throw(_("Your account is no longer active."), frappe.AuthenticationError)


def refuse_login(login_manager):
	"""`on_session_creation`: refuse the login, and end the session Frappe has just made for it."""
	if _may_enter(login_manager.user):
		return
	delete_session(frappe.session.sid, user=login_manager.user, reason="Not a Nirmaan user")
	_refuse()


def refuse_request():
	"""`auth_hooks`: Frappe runs it on every request once it knows the user."""
	if not _may_enter(frappe.session.user):
		_refuse()
