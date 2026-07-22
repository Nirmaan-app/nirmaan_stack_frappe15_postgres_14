# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
#
# Pricing Module -- backend API (PM-1).
#
# ALL user access to the Pricing Workbook / Version / Access Log doctypes flows
# through the whitelisted endpoints in this module. The three doctypes are
# permissioned "System Manager only" on purpose: `_require_pricing_access()` is
# the single-point gate, and every internal read/write below uses
# `ignore_permissions=True` because the gate -- not the doctype ACL -- is the
# authority. Decision on record (see frontend/.claude/plans/pricing-module-plan.md).

import json

import frappe
from frappe import _
from frappe.utils import get_datetime, now_datetime, time_diff_in_seconds

# ---------------------------------------------------------------------------
# ACCESS SET
# ---------------------------------------------------------------------------
# The EXACT role-profile and role name strings that grant Pricing Module access.
# These were discovered by directly querying the live `localhost` database this
# session (2026-07-22): every `role_profile_name` on an enabled user and every
# non-disabled Role whose name contains "Admin" or "Estimat" (case-insensitive),
# excluding generic Frappe built-ins ("All", "Guest", and the bare "Administrator"
# role -- the Administrator USER is handled by the explicit branch below). The
# result scopes access to administrators + estimation users only.
#
# DB-verified 2026-07-22. Re-query the DB before editing this set; do not guess.
PRICING_ACCESS_SET = frozenset(
	{
		"Nirmaan Admin Profile",                # role_profile_name AND role
		"Nirmaan Estimates Executive Profile",  # role_profile_name
		"Nirmaan Estimates Executive",          # role
	}
)

WORKBOOK_DT = "Pricing Workbook"
VERSION_DT = "Pricing Workbook Version"
LOG_DT = "Pricing Access Log"

# Auto-expiry for a held checkout lock: 30 minutes.
LOCK_EXPIRY_SECONDS = 30 * 60
# Retain at most this many version snapshots per workbook (newest wins).
MAX_VERSIONS = 20


# ---------------------------------------------------------------------------
# Gate + internal helpers
# ---------------------------------------------------------------------------
def _require_pricing_access():
	"""Single-point access gate for the whole Pricing Module.

	Allows the request when the session user is Administrator, OR the user's
	role_profile_name is in the ACCESS SET, OR any of the user's roles intersects
	the ACCESS SET. Otherwise raises PermissionError. Returns the user id.
	"""
	user = frappe.session.user
	if user == "Administrator":
		return user
	if not user or user == "Guest":
		frappe.throw(_("You do not have access to the Pricing Module."), frappe.PermissionError)

	role_profile = frappe.db.get_value("User", user, "role_profile_name")
	if role_profile and role_profile in PRICING_ACCESS_SET:
		return user

	if set(frappe.get_roles(user)) & PRICING_ACCESS_SET:
		return user

	frappe.throw(_("You do not have access to the Pricing Module."), frappe.PermissionError)


def _normalize_json(workbook_json):
	"""Validate that `workbook_json` is JSON and return it as a compact string.

	Structure is frontend-owned; we only guarantee it parses. Accepts either a
	JSON string (validated) or an already-decoded dict/list (re-serialized).
	"""
	if workbook_json is None:
		frappe.throw(_("workbook_json is required."), frappe.ValidationError)
	if isinstance(workbook_json, (dict, list)):
		return json.dumps(workbook_json)
	if isinstance(workbook_json, str):
		try:
			json.loads(workbook_json)
		except (ValueError, TypeError):
			frappe.throw(_("workbook_json is not valid JSON."), frappe.ValidationError)
		return workbook_json
	frappe.throw(_("workbook_json is not valid JSON."), frappe.ValidationError)


def _as_json_string(value):
	"""Return a stored JSON field as a string regardless of how Frappe hydrated it."""
	if value is None:
		return None
	if isinstance(value, (dict, list)):
		return json.dumps(value)
	return value


def _lock_expired(checked_out_at):
	"""True when there is no lock timestamp or the lock is older than the expiry."""
	if not checked_out_at:
		return True
	age = time_diff_in_seconds(now_datetime(), get_datetime(checked_out_at))
	return age > LOCK_EXPIRY_SECONDS


def _log(workbook, action):
	frappe.get_doc(
		{
			"doctype": LOG_DT,
			"workbook": workbook,
			"user": frappe.session.user,
			"action": action,
			"at": now_datetime(),
		}
	).insert(ignore_permissions=True)


def _prune_versions(workbook):
	"""Delete version snapshots beyond the newest MAX_VERSIONS for a workbook."""
	rows = frappe.get_all(
		VERSION_DT,
		filters={"workbook": workbook},
		fields=["name"],
		order_by="version desc",
	)
	for row in rows[MAX_VERSIONS:]:
		frappe.delete_doc(VERSION_DT, row.name, ignore_permissions=True, force=True)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@frappe.whitelist()
def list_workbooks():
	_require_pricing_access()
	return frappe.get_all(
		WORKBOOK_DT,
		fields=["name", "title", "current_version", "checked_out_by"],
		order_by="modified desc",
	)


@frappe.whitelist()
def get_workbook(name):
	user = _require_pricing_access()
	doc = frappe.get_doc(WORKBOOK_DT, name)

	_log(name, "open")
	frappe.db.commit()

	has_lock = bool(doc.checked_out_by)
	return {
		"name": doc.name,
		"title": doc.title,
		"workbook_json": _as_json_string(doc.workbook_json),
		"current_version": doc.current_version,
		"checked_out_by": doc.checked_out_by,
		"checked_out_at": doc.checked_out_at,
		"lock_is_mine": has_lock and doc.checked_out_by == user,
		"lock_expired": _lock_expired(doc.checked_out_at) if has_lock else True,
	}


@frappe.whitelist()
def checkout(name):
	user = _require_pricing_access()
	doc = frappe.get_doc(WORKBOOK_DT, name)

	holder = doc.checked_out_by
	# Blocked only when someone ELSE holds a still-valid (non-expired) lock.
	if holder and holder != user and not _lock_expired(doc.checked_out_at):
		frappe.throw(
			_("Workbook is checked out by {0}.").format(holder),
			frappe.ValidationError,
		)

	doc.checked_out_by = user
	doc.checked_out_at = now_datetime()
	doc.save(ignore_permissions=True)

	_log(name, "checkout")
	frappe.db.commit()
	return {
		"status": "checked_out",
		"checked_out_by": user,
		"checked_out_at": doc.checked_out_at,
	}


@frappe.whitelist()
def release(name):
	user = _require_pricing_access()
	doc = frappe.get_doc(WORKBOOK_DT, name)

	if doc.checked_out_by and (doc.checked_out_by == user or user == "Administrator"):
		doc.checked_out_by = None
		doc.checked_out_at = None
		doc.save(ignore_permissions=True)

	_log(name, "release")
	frappe.db.commit()
	return {"status": "released"}


@frappe.whitelist()
def save_workbook(name, workbook_json):
	user = _require_pricing_access()
	normalized = _normalize_json(workbook_json)

	doc = frappe.get_doc(WORKBOOK_DT, name)

	# Caller must hold a non-expired lock to save.
	if doc.checked_out_by != user or _lock_expired(doc.checked_out_at):
		frappe.throw(
			_("You must hold an active lock on this workbook to save. Check it out first."),
			frappe.ValidationError,
		)

	new_version = (doc.current_version or 0) + 1

	frappe.get_doc(
		{
			"doctype": VERSION_DT,
			"workbook": name,
			"version": new_version,
			"workbook_json": normalized,
			"saved_by": user,
			"saved_at": now_datetime(),
		}
	).insert(ignore_permissions=True)

	doc.workbook_json = normalized
	doc.current_version = new_version
	doc.save(ignore_permissions=True)

	_prune_versions(name)
	_log(name, "save")
	frappe.db.commit()
	return {"status": "saved", "current_version": new_version}


@frappe.whitelist()
def create_workbook(title, workbook_json):
	user = _require_pricing_access()
	normalized = _normalize_json(workbook_json)

	doc = frappe.get_doc(
		{
			"doctype": WORKBOOK_DT,
			"title": title,
			"workbook_json": normalized,
			"current_version": 1,
		}
	)
	doc.insert(ignore_permissions=True)

	frappe.get_doc(
		{
			"doctype": VERSION_DT,
			"workbook": doc.name,
			"version": 1,
			"workbook_json": normalized,
			"saved_by": user,
			"saved_at": now_datetime(),
		}
	).insert(ignore_permissions=True)

	_log(doc.name, "create")
	frappe.db.commit()
	return {"name": doc.name, "title": doc.title, "current_version": 1}
