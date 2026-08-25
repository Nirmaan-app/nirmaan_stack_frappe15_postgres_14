# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which Expense Types a requester may raise, and WHO REVIEWS each one.

Reads the `Expense Category` master. This REPLACED a temporary Python constant
(`services/expense_request_catalog.py`, deleted 2026-08-18): categorising expenses and
choosing their reviewer is master data, so changing either is an edit in the app, not a
deploy.

Routing ONLY. The form a type asks for lives on the type itself
(`Expense Type.source_format`) -- do not add form concerns here.
"""

import frappe

# ⚠️ A reviewer is a `Nirmaan Users.role_profile` VALUE, not a Frappe Role -- the axis
# `useUserData` and `pricing._is_nirmaan_admin` gate on. `Expense Category.reviewer_role`
# links to `Role Profile`, whose docname IS that value, so the two agree by construction.
#
# Getting this wrong fails SILENTLY: the Role Profile "Nirmaan Admin Profile" grants
# `Nirmaan Project Manager` among seven others, and a *Role* of that exact name is assigned
# to nobody -- so a `frappe.get_roles()` check would match no reviewer and read every Admin
# as a PM.
DEFAULT_REVIEWER_ROLE = "Nirmaan Admin Profile"

_CACHE_KEY = "_expense_request_routing"


def _routing() -> dict:
	"""`{expense_type: (category, reviewer_role)}`, cached for the life of the request.

	One query. `get_permission_query_conditions` runs on every list read and Frappe may call
	it several times while building one query, so re-reading a 40-row table each time is
	pure waste.
	"""
	cached = getattr(frappe.local, _CACHE_KEY, None)
	if cached is not None:
		return cached

	reviewers = {
		r["name"]: (r["reviewer_role"] or DEFAULT_REVIEWER_ROLE)
		for r in frappe.get_all("Expense Category", fields=["name", "reviewer_role"])
	}
	out = {}
	for r in frappe.get_all("Expense Type", fields=["name", "expense_category"]):
		category = r["expense_category"]
		# A type with NO category is still requestable -- it simply routes to Admin. Refusing
		# it instead would make a newly created type silently un-requestable until someone
		# remembered to categorise it.
		out[r["name"]] = (category, reviewers.get(category, DEFAULT_REVIEWER_ROLE))
	setattr(frappe.local, _CACHE_KEY, out)
	return out


def clear_cache() -> None:
	"""Drop the per-request cache. Tests that re-route mid-run must call this."""
	setattr(frappe.local, _CACHE_KEY, None)


def requestable_types() -> tuple[str, ...]:
	return tuple(_routing().keys())


def is_requestable(expense_type: str) -> bool:
	return expense_type in _routing()


def category_for_type(expense_type: str) -> str | None:
	entry = _routing().get(expense_type)
	return entry[0] if entry else None


def reviewer_role_for_type(expense_type: str) -> str:
	"""Never returns None -- an unroutable request would be invisible to every reviewer,
	which is worse than over-routing it to Admin."""
	entry = _routing().get(expense_type)
	return entry[1] if entry else DEFAULT_REVIEWER_ROLE


def types_reviewed_by(role_profile: str) -> tuple[str, ...]:
	"""Every type whose reviewer is `role_profile` -- how a reviewer's queue is scoped."""
	return tuple(t for t, (_c, rev) in _routing().items() if rev == role_profile)


def resolved_categories() -> list[tuple[str, str, tuple[str, ...]]]:
	"""`(category, reviewer_role, types)` per category, plus an uncategorised bucket."""
	grouped: dict[str | None, list[str]] = {}
	revs: dict[str | None, str] = {}
	for t, (category, reviewer) in _routing().items():
		grouped.setdefault(category, []).append(t)
		revs[category] = reviewer
	out = [
		(c or "Uncategorised", revs[c], tuple(sorted(grouped[c])))
		for c in grouped
	]
	# Named categories first, uncategorised last -- it is a leftover, not a peer.
	return sorted(out, key=lambda x: (x[0] == "Uncategorised", x[0]))
