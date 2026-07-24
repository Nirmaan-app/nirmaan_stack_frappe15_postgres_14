# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
#
# Pricing Module -- backend API (PM-1).
#
# ALL user access to the Pricing Workbook / Version / Access Log doctypes flows
# through the whitelisted endpoints in this module. The three doctypes are
# permissioned "System Manager only" on purpose: the gates below are the
# single-point authority, and every internal read/write uses
# `ignore_permissions=True` because the gate -- not the doctype ACL -- is what
# decides. Decision on record (see frontend/.claude/plans/pricing-module-plan.md).
#
# TWO gates since PW-2a:
#   _require_pricing_access()       READ  -- admins + estimation (list, get)
#   _require_pricing_write_access() WRITE -- admins only (checkout, release,
#                                            save, create)
# The write gate is layered on the read gate, so the messages stay honest for both
# an outsider and an in-module read-only user. The frontend mirrors this split for
# UX only; THIS module is the enforcement boundary.

import gzip
import json

import frappe
from frappe import _
from frappe.utils import get_datetime, now_datetime, time_diff_in_seconds

# Hard ceiling on the DECOMPRESSED workbook payload. gzip on this data runs ~10:1,
# so a hostile or corrupt archive could expand far beyond the request-size limit
# the compressed upload passed; this bounds what a single request can allocate.
# Real workbooks are ~5-22 MB decompressed, so this leaves ample headroom.
MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024

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

# ---------------------------------------------------------------------------
# WRITE SET (PW-2a)
# ---------------------------------------------------------------------------
# The module splits READ from WRITE. Everyone in PRICING_ACCESS_SET may LIST and
# OPEN a workbook; only this narrower set may take the lock or persist anything
# (checkout / release / save / create). Estimation users get read access plus the
# client-side Sandbox -- a local, never-persisted edit session -- so the split costs
# them nothing they previously had, because before PW-2a they could not edit
# without also taking the single-editor lock away from an admin.
#
# "Nirmaan Admin Profile" exists BOTH as a role_profile_name and as a Role
# (DB-verified 2026-07-22, re-verified 2026-07-23), which is why the check below
# tests both, exactly like the read gate. The Administrator USER is handled by its
# own branch.
PRICING_WRITE_SET = frozenset({"Nirmaan Admin Profile"})

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


def _require_pricing_write_access():
	"""Write gate for the Pricing Module (PW-2a): admins only.

	LAYERED on top of the read gate deliberately: a user outside the module still
	gets the module-level "no access" message, while an estimation user -- who DOES
	belong to the module -- gets an honest "read-only for your role" message the
	frontend can surface verbatim. Returns the user id.

	Applied to the four write endpoints (checkout / release / save / create). The
	read endpoints (list_workbooks / get_workbook) keep the wider gate.
	"""
	user = _require_pricing_access()
	if user == "Administrator":
		return user

	role_profile = frappe.db.get_value("User", user, "role_profile_name")
	if role_profile and role_profile in PRICING_WRITE_SET:
		return user

	if set(frappe.get_roles(user)) & PRICING_WRITE_SET:
		return user

	frappe.throw(
		_("Pricing workbooks are read-only for your role."), frappe.PermissionError
	)


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


def _gunzip_payload(blob):
	"""Gunzip an uploaded workbook payload and return the JSON text.

	Split out from the request plumbing so it is directly unit-testable. Raises a
	user-facing ValidationError on a corrupt archive or an oversized expansion.
	"""
	if not blob:
		frappe.throw(_("No workbook payload was uploaded."), frappe.ValidationError)
	try:
		raw = gzip.decompress(blob)
	except Exception:
		frappe.throw(
			_("The uploaded workbook payload is not a valid gzip archive."),
			frappe.ValidationError,
		)
	if len(raw) > MAX_DECOMPRESSED_BYTES:
		frappe.throw(
			_("Workbook payload is too large ({0} MB decompressed; limit is {1} MB).").format(
				round(len(raw) / (1024 * 1024)), MAX_DECOMPRESSED_BYTES // (1024 * 1024)
			),
			frappe.ValidationError,
		)
	return raw.decode("utf-8")


def _read_gzip_payload():
	"""Read + gunzip the `workbook_json_gz` multipart file from the current request.

	THE single payload path for create_workbook / save_workbook (FR-5). The old
	`workbook_json` body parameter no longer exists on those endpoints: nesting the
	workbook as a JSON string escaped every quote (1.23x) and pushed a real workbook
	past the site's 25 MiB request limit. gzip+multipart carries the same data in a
	few MB.
	"""
	files = getattr(frappe.request, "files", None) if getattr(frappe, "request", None) else None
	if not files or "workbook_json_gz" not in files:
		frappe.throw(
			_("Expected a gzipped workbook upload in the 'workbook_json_gz' field."),
			frappe.ValidationError,
		)
	return _gunzip_payload(files["workbook_json_gz"].read())


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
	"""Delete version snapshots beyond the newest MAX_VERSIONS for a workbook.

	Raw `frappe.db.delete`, NOT `frappe.delete_doc`. An imported workbook stores
	`workbook_json` as a JSON ARRAY, which Frappe hydrates back as a Python list;
	`delete_doc` loads the doc and calls `as_dict()`/`as_json()`, which trips
	get_valid_dict's "Value ... cannot be a list" guard -- the same list-valued-JSON
	load wall that `checkout`/`release` dodge with `db.set_value` and the test suite's
	`_purge_all` dodges with raw `db.delete`. Raw delete never hydrates the doc, so it
	side-steps the wall. (Latent since PM-1: only bites once a workbook exceeds
	MAX_VERSIONS snapshots of imported/array content, i.e. the 21st save.)
	"""
	rows = frappe.get_all(
		VERSION_DT,
		filters={"workbook": workbook},
		fields=["name"],
		order_by="version desc",
	)
	for row in rows[MAX_VERSIONS:]:
		frappe.db.delete(VERSION_DT, {"name": row.name})


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
	user = _require_pricing_write_access()
	lock = frappe.db.get_value(
		WORKBOOK_DT, name, ["checked_out_by", "checked_out_at"], as_dict=True
	)
	if not lock:
		frappe.throw(_("Workbook {0} not found.").format(name), frappe.DoesNotExistError)
	holder, checked_out_at = lock.checked_out_by, lock.checked_out_at

	# Blocked only when someone ELSE holds a still-valid (non-expired) lock.
	if holder and holder != user and not _lock_expired(checked_out_at):
		frappe.throw(
			_("Workbook is checked out by {0}.").format(holder),
			frappe.ValidationError,
		)

	now = now_datetime()
	# Write the lock fields with db.set_value, NOT doc.save(): an imported workbook
	# stores `workbook_json` as a JSON ARRAY, which Frappe hydrates back as a Python
	# list, and a full doc.save() then trips get_valid_dict's "Value ... cannot be a
	# list" guard (the same list-valued-JSON save wall documented for BoQ). Lock
	# fields are metadata, so a targeted set_value is correct and side-steps it.
	frappe.db.set_value(
		WORKBOOK_DT,
		name,
		{"checked_out_by": user, "checked_out_at": now},
		update_modified=False,
	)

	_log(name, "checkout")
	frappe.db.commit()
	return {"status": "checked_out", "checked_out_by": user, "checked_out_at": now}


@frappe.whitelist()
def release(name):
	user = _require_pricing_write_access()
	holder = frappe.db.get_value(WORKBOOK_DT, name, "checked_out_by")

	if holder and (holder == user or user == "Administrator"):
		# Targeted set_value (not doc.save) -- see the checkout note on the
		# list-valued workbook_json save wall.
		frappe.db.set_value(
			WORKBOOK_DT,
			name,
			{"checked_out_by": None, "checked_out_at": None},
			update_modified=False,
		)

	_log(name, "release")
	frappe.db.commit()
	return {"status": "released"}


@frappe.whitelist()
def save_workbook(name):
	"""Thin transport wrapper: read + gunzip the multipart payload, then delegate.

	All behaviour (access gate, lock rules, versioning, pruning, JSON validation)
	lives in `_save_workbook` and is unchanged -- the tests target it directly.
	"""
	return _save_workbook(name, _read_gzip_payload())


def _save_workbook(name, workbook_json):
	user = _require_pricing_write_access()
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
def create_workbook(title):
	"""Thin transport wrapper: read + gunzip the multipart payload, then delegate.

	All behaviour lives in `_create_workbook` and is unchanged (see save_workbook).
	"""
	return _create_workbook(title, _read_gzip_payload())


def _create_workbook(title, workbook_json):
	user = _require_pricing_write_access()
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
