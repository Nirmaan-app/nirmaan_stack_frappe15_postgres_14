# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Who the caller is, and what they may do to an expense request.

⚠️ THIS IS THE SECURITY BOUNDARY OF THE FEATURE. The rest of the expense module gates in the
UI only — button and column visibility, no backend check — and that is not good enough here,
because the entire reason Expense Request exists is to stop a Project Manager turning their
own ask into money. Every gate lives here rather than being restated at each endpoint.
"""

import frappe

from nirmaan_stack.services.expense_request_routing import (
	allowed_roles_for_type,
	is_requestable,
	reviewer_role_for_type,
	types_reviewed_by,
)

ADMIN_PROFILE = "Nirmaan Admin Profile"
PM_PROFILE = "Nirmaan Project Manager Profile"

# Who ELSE may review a request a Project Manager raised (owner, 2026-09-19). Additive: Admin
# still reviews every request. Keyed on the REQUESTER's profile, not the expense type, and
# read at review time like the rest of routing -- a PM who changes role takes their pending
# requests out of this queue.
PM_REQUEST_REVIEWERS = frozenset({
	"Nirmaan Accountant Profile",
	"Nirmaan Accountant Lead Profile",
	"Nirmaan HR Executive Profile",
	"Nirmaan HR Lead Profile",
})

PENDING = "Pending Approval"
APPROVED = "Approved"
REJECTED = "Rejected"
# Set by the LEDGER, never by a reviewer -- see `expense_request_status`.
PAID = "Paid"


def caller_role_profile(user: str | None = None) -> str | None:
	"""The caller's `Nirmaan Users.role_profile`.

	⚠️ ROLE PROFILE, NOT FRAPPE ROLE — see the warning in `expense_request_routing`. A
	`frappe.get_roles()` check cannot answer "what is this person's job" in this system:
	the Admin profile grants the `Nirmaan Project Manager` role, so a role-based gate reads
	every Admin as a PM.

	`Administrator` has no `Nirmaan Users` row, so it maps to the Admin profile — the same
	fake `useUserData` applies on the client.
	"""
	user = user or frappe.session.user
	if user == "Administrator":
		return ADMIN_PROFILE
	return frappe.db.get_value("Nirmaan Users", user, "role_profile")


def is_admin(user: str | None = None) -> bool:
	return caller_role_profile(user) == ADMIN_PROFILE


def can_request_type(expense_type: str, user: str | None = None) -> bool:
	"""May the caller SEE this type when raising a request?

	`Expense Type.allowed_roles` lists the role profiles that may; an Admin sees every type
	and is never listed, so an EMPTY list means Admin only (owner ruling 2026-09-16).
	"""
	profile = caller_role_profile(user)
	if profile == ADMIN_PROFILE:
		return True
	return bool(profile) and profile in allowed_roles_for_type(expense_type)


def guard_requestable(expense_type: str, check_visibility: bool = True) -> None:
	"""Refuse a type that does not exist, or one the caller's role may not see.

	Without this, a requester could post any string straight at the endpoint, bypassing the
	picker. A type with no category simply routes to the default reviewer rather than being
	blocked, so a newly created type is never silently un-requestable by ROUTING -- only its
	`allowed_roles` decide who sees it.

	`check_visibility=False` is for an edit that KEEPS the request's type: narrowing a type's
	roles must not strand a request its owner already raised under it.
	"""
	if not is_requestable(expense_type):
		frappe.throw(
			f"'{expense_type}' cannot be requested.",
			frappe.PermissionError,
			title="Not a requestable expense type",
		)
	if check_visibility and not can_request_type(expense_type):
		frappe.throw(
			f"'{expense_type}' is not available to your role.",
			frappe.PermissionError,
			title="Expense type not available",
		)


def reviews_pm_request(profile: str | None, requester_profile: str | None) -> bool:
	"""Is this an Accountant / HR caller looking at a request a Project Manager raised?

	The ONE statement of the rule: `guard_reviewer` and `get_my_expense_requests` (which
	hands `can_review` to the table) both ask it, so the button and the endpoint agree.
	"""
	return profile in PM_REQUEST_REVIEWERS and requester_profile == PM_PROFILE


def guard_reviewer(req) -> None:
	"""May the caller decide this request?

	Runs BEFORE any resolution or write, so a refusal mutates nothing.

	Two separate refusals, deliberately — they are different failures and deserve different
	messages:
	  * wrong role  — the request is routed to somebody else;
	  * own request — self-review, which is the entire reason the feature exists.

	A caller passes the role check as the type's routed reviewer (always Admin today), or
	as Accountant / HR on a request a Project Manager raised -- see `reviews_pm_request`.

	An Admin passes both. They are the configured fallback reviewer for every unrouted
	category, so blocking Admin self-review would strand any request an Admin raised with
	nobody able to action it.
	"""
	user = frappe.session.user
	profile = caller_role_profile(user)

	if profile == ADMIN_PROFILE:
		return

	expected = reviewer_role_for_type(req.type)
	if profile != expected and not reviews_pm_request(profile, caller_role_profile(req.owner)):
		frappe.throw(
			f"Expense requests of type '{req.type}' are reviewed by {expected}.",
			frappe.PermissionError,
			title="Not your review",
		)

	if req.owner == user:
		frappe.throw(
			"You cannot approve or reject your own expense request.",
			frappe.PermissionError,
			title="Self-review",
		)


def get_permission_query_conditions(user: str | None = None) -> str:
	"""Scope every LIST read of `Expense Request` to what the caller may see.

	⚠️ NOT WIRED. The `permission_query_conditions` entry in hooks.py was REMOVED on request,
	so NOTHING CALLS THIS and list reads are scoped by the read DocPerm alone -- which eight
	roles hold, so every one of them sees every request. Kept because re-wiring it is a
	one-line hooks.py entry; delete it only if the wide read is a settled decision.

	Wired via `permission_query_conditions` in hooks.py, so it applies to the generic
	list/report API the data table uses (which reads through `frappe.desk.reportview`), to
	Frappe Desk, and to any future reader — rather than being re-implemented per endpoint,
	where one surface would eventually forget and leak every request to everyone holding
	the read DocPerm.

	The rule is a UNION, not a choice: a reviewer who also raises requests sees BOTH their
	own and the ones routed to them.

	⚠️ PostgreSQL — the table is double-quoted, never backticked, and every value goes
	through `frappe.db.escape`.
	"""
	user = user or frappe.session.user
	if user == "Administrator":
		return ""

	profile = caller_role_profile(user)
	if profile == ADMIN_PROFILE:
		return ""

	clauses = [f'"tabExpense Request".owner = {frappe.db.escape(user)}']

	reviewed = types_reviewed_by(profile) if profile else ()
	if reviewed:
		types = ", ".join(frappe.db.escape(t) for t in reviewed)
		clauses.append(f'"tabExpense Request".type IN ({types})')

	if profile in PM_REQUEST_REVIEWERS:
		clauses.append(
			'"tabExpense Request".owner IN (SELECT name FROM "tabNirmaan Users" '
			f"WHERE role_profile = {frappe.db.escape(PM_PROFILE)})"
		)

	# Nothing routed: the caller sees only what they raised. A profile-less user (no
	# `Nirmaan Users` row) lands here too, which is the safe direction.
	return f"({' OR '.join(clauses)})" if len(clauses) > 1 else clauses[0]
