"""Mobile-number login endpoint.

Resolves a 10-digit `User.mobile_no` to a user, then runs the normal Frappe
login flow via `LoginManager`. The session cookie set by `post_login()` is
identical to the one set by `/api/method/login`, so downstream auth (CSRF,
`useFrappeAuth`, `ProtectedRoute`, boot) works unchanged.

`User.mobile_no` is the canonical lookup source rather than
`Nirmaan Users.mobile_no`, because the fallback path in
`integrations`/`nirmaan_users.create_user_profile` historically could leave
`Nirmaan Users.mobile_no` blank. The unique constraint on
`Nirmaan Users.mobile_no` plus the duplicate check in `api.users.create_user`
prevents new drift; this endpoint also defensively rejects ambiguous matches.
"""

import re

import frappe
from frappe import _
from frappe.auth import LoginManager


_MOBILE_RE = re.compile(r"\d{10}")


@frappe.whitelist(allow_guest=True)
def login_with_mobile(mobile_no: str, password: str):
	if not mobile_no or not password:
		frappe.throw(_("Mobile number and password are required"))

	mobile_no = mobile_no.strip()
	if not _MOBILE_RE.fullmatch(mobile_no):
		frappe.throw(_("Mobile number must be exactly 10 digits"))

	matches = frappe.db.get_all(
		"User",
		filters={"mobile_no": mobile_no, "enabled": 1},
		pluck="name",
		limit=2,
	)
	if not matches:
		frappe.throw(_("No account found for this mobile number"))
	if len(matches) > 1:
		# Should not happen once the create-user duplicate check and the unique
		# constraint on Nirmaan Users.mobile_no are in place. Guard against
		# legacy rows that pre-date them.
		frappe.throw(_("Multiple accounts share this number. Please log in with email."))

	user_name = matches[0]

	login_manager = LoginManager()
	login_manager.authenticate(user=user_name, pwd=password)
	login_manager.post_login()

	return {
		"message": "Logged In",
		"home_page": "/",
		"full_name": frappe.db.get_value("User", user_name, "full_name"),
	}
