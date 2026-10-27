# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which Expense Types a requester may raise, and WHO REVIEWS each one.

⚠️ EVERY request is reviewed by `DEFAULT_REVIEWER_ROLE`. Per-category reviewers were planned
(`Expense Category.reviewer_role`, 2026-08-18), never set, and removed 2026-09-16; the
`Expense Category` doctype itself was removed 2026-10-27 (owner), so a type belongs to no
category. The reviewer helpers below keep their signatures so callers did not move.

Routing ONLY. The form a type asks for lives on the type itself
(`Expense Type.source_format`) -- do not add form concerns here.
"""

import frappe

# ⚠️ A reviewer is a `Nirmaan Users.role_profile` VALUE, not a Frappe Role -- the axis
# `useUserData` and `pricing._is_nirmaan_admin` gate on.
#
# Getting this wrong fails SILENTLY: the Role Profile "Nirmaan Admin Profile" grants
# `Nirmaan Project Manager` among seven others, and a *Role* of that exact name is assigned
# to nobody -- so a `frappe.get_roles()` check would match no reviewer and read every Admin
# as a PM.
DEFAULT_REVIEWER_ROLE = "Nirmaan Admin Profile"

_CACHE_KEY = "_expense_request_routing"


def _routing() -> dict:
	"""`{expense_type: (reviewer_role, allowed_roles)}`, cached for the request.

	`allowed_roles` is the frozenset of role profiles listed in `Expense Type.allowed_roles`
	-- who may SEE the type when raising a request. The Admin bypass is not applied here; it
	lives beside the other gates in `api/expense_requests/access.can_request_type`.

	One query. `get_permission_query_conditions` runs on every list read and Frappe may call
	it several times while building one query, so re-reading a 40-row table each time is
	pure waste.
	"""
	cached = getattr(frappe.local, _CACHE_KEY, None)
	if cached is not None:
		return cached

	roles: dict[str, set] = {}
	for r in frappe.get_all(
		"Expense Type Role",
		filters={"parenttype": "Expense Type", "parentfield": "allowed_roles"},
		fields=["parent", "role_profile"],
	):
		roles.setdefault(r["parent"], set()).add(r["role_profile"])

	out = {}
	for name in frappe.get_all("Expense Type", pluck="name"):
		out[name] = (DEFAULT_REVIEWER_ROLE, frozenset(roles.get(name, ())))
	setattr(frappe.local, _CACHE_KEY, out)
	return out


def clear_cache() -> None:
	"""Drop the per-request cache. Tests that re-route mid-run must call this."""
	setattr(frappe.local, _CACHE_KEY, None)


def requestable_types() -> tuple[str, ...]:
	return tuple(_routing().keys())


def is_requestable(expense_type: str) -> bool:
	return expense_type in _routing()


def reviewer_role_for_type(expense_type: str) -> str:
	"""Never returns None -- an unroutable request would be invisible to every reviewer,
	which is worse than over-routing it to Admin."""
	entry = _routing().get(expense_type)
	return entry[0] if entry else DEFAULT_REVIEWER_ROLE


def allowed_roles_for_type(expense_type: str) -> frozenset:
	"""The role profiles listed on the type. Empty means Admin only -- see `access`."""
	entry = _routing().get(expense_type)
	return entry[1] if entry else frozenset()


def types_reviewed_by(role_profile: str) -> tuple[str, ...]:
	"""Every type whose reviewer is `role_profile` -- how a reviewer's queue is scoped."""
	return tuple(t for t, entry in _routing().items() if entry[0] == role_profile)
