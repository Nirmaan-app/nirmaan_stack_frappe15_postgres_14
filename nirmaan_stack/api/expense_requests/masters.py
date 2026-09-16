# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Admin-only writes to the `Expense Type` master, behind the Expense Packages tab.

⚠️ WHY THESE EXIST RATHER THAN A CLIENT-SIDE `updateDoc`. `Expense Type` carries `write = 1`
for roughly fifteen roles -- Accountant, Procurement, Project Lead, **Project Manager**,
Design, Estimates, Tendering, Sales, Billing. So a raw client write would let a Project
Manager edit the very form and scope that governs their own requests. These endpoints gate
on the admin profile FIRST, before any resolution or write.

Scope flags are not cosmetic: they decide whether a request asks for a project and which
ledger approval writes to. That is why `create` / `update` refuse the neither-flag
combination outright rather than saving an unusable type.
"""

import json

import frappe

from nirmaan_stack.api.expense_requests.access import ADMIN_PROFILE, is_admin


def _require_admin() -> None:
	if not is_admin():
		frappe.throw(
			"Only an admin may change expense types.",
			frappe.PermissionError,
			title="Admin only",
		)


def _validate_category(expense_category: str | None) -> str:
	"""Categories are created in Frappe Desk; the app only ASSIGNS an existing one.

	REQUIRED on this path (owner ruling): every type belongs to a category, and where none of
	the named ones fit, that category is `Uncategorized`. Leaving it blank was an option
	briefly, and it produced a type that looked categorised in no list and routed to the
	default reviewer for reasons nobody had chosen.

	⚠️ The RUNTIME still tolerates a blank -- `expense_request_routing` falls back to the
	default reviewer rather than refusing. That asymmetry is deliberate: a type created
	directly in Desk, or one predating this rule, must never become silently un-requestable.
	The app enforces the rule; the runtime fails open.
	"""
	category = (expense_category or "").strip()
	if not category:
		frappe.throw(
			"Pick a category. Use 'Uncategorized' if none of the named ones fit.",
			title="Category required",
		)
	if not frappe.db.exists("Expense Category", category):
		frappe.throw(f"'{category}' is not an expense category.", title="Unknown category")
	return category


def _normalise_roles(allowed_roles) -> list[str] | None:
	"""The role profiles that may SEE a type, cleaned; None means "not sent, leave as is".

	Accepts a list or its JSON string (a form post sends the latter). Order is kept and
	repeats are dropped. The Admin profile is REFUSED rather than dropped: an admin sees
	every type, so a client sending it has misunderstood the field.
	"""
	if allowed_roles is None:
		return None
	if isinstance(allowed_roles, str):
		try:
			allowed_roles = json.loads(allowed_roles or "[]")
		except ValueError:
			frappe.throw("Allowed roles must be a list.", title="Invalid roles")
	if not isinstance(allowed_roles, (list, tuple)):
		frappe.throw("Allowed roles must be a list.", title="Invalid roles")

	out: list[str] = []
	for value in allowed_roles:
		profile = (value or "").strip() if isinstance(value, str) else ""
		if not profile or profile in out:
			continue
		if profile == ADMIN_PROFILE:
			frappe.throw(
				f"{ADMIN_PROFILE} already sees every expense type -- leave it out.",
				title="Admin is implicit",
			)
		if not frappe.db.exists("Role Profile", profile):
			frappe.throw(f"'{profile}' is not a role profile.", title="Unknown role profile")
		out.append(profile)
	return out


def _set_roles(doc, profiles: list[str] | None) -> None:
	if profiles is not None:
		doc.set("allowed_roles", [{"role_profile": p} for p in profiles])


@frappe.whitelist()
def get_expense_type_access():
	"""What the Expense Packages screen needs to show and edit `allowed_roles`.

	`role_profiles`: every profile the picker may offer -- all of them EXCEPT Admin, who sees
	every type anyway. `allowed_roles`: `{expense_type: [profile, ...]}` for every type that
	lists any; a type absent here is Admin only.

	Served from here rather than read client-side: Role Profile is a System Manager doctype,
	and the child table is not returned by a list read.
	"""
	_require_admin()
	profiles = [
		p for p in frappe.get_all("Role Profile", pluck="name", order_by="name asc")
		if p != ADMIN_PROFILE
	]
	by_type: dict[str, list[str]] = {}
	for r in frappe.get_all(
		"Expense Type Role",
		filters={"parenttype": "Expense Type", "parentfield": "allowed_roles"},
		fields=["parent", "role_profile"],
		order_by="idx asc",
	):
		by_type.setdefault(r["parent"], []).append(r["role_profile"])
	return {"role_profiles": profiles, "allowed_roles": by_type}


def _validate_scope(project: int, non_project: int) -> None:
	if not project and not non_project:
		frappe.throw(
			"An expense type must allow project use, non-project use, or both. "
			"A type flagged for neither cannot be requested at all.",
			title="Scope required",
		)


@frappe.whitelist(methods=["POST"])
def create_expense_type(expense_name: str, project=0, non_project=0, expense_category=None,
                        allowed_roles=None):
	"""Add an Expense Type, assigning it to an existing category and the roles that see it.

	No roles means Admin only -- see `access.can_request_type`.
	"""
	_require_admin()
	category = _validate_category(expense_category)
	profiles = _normalise_roles(allowed_roles)
	name = (expense_name or "").strip()
	if not name:
		frappe.throw("A name is required.", title="Name required")

	project, non_project = int(project or 0), int(non_project or 0)
	_validate_scope(project, non_project)

	if frappe.db.exists("Expense Type", name):
		frappe.throw(f"'{name}' already exists.", title="Duplicate")

	doc = frappe.new_doc("Expense Type")
	doc.update({"expense_name": name, "project": project, "non_project": non_project,
	            "expense_category": category})
	_set_roles(doc, profiles)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def update_expense_type(name: str, project=0, non_project=0, expense_category=None,
                        allowed_roles=None):
	"""Change a type's scope, its category and the roles that see it.

	`allowed_roles` REPLACES the list when sent; omitted, the list is left as it is.

	The NAME is deliberately not editable HERE. It is the docname, so changing it is a
	`rename_doc` operation rather than a field write -- that is `rename_expense_type`, its own
	admin action with its own guards.
	"""
	_require_admin()
	if not frappe.db.exists("Expense Type", name):
		frappe.throw(f"'{name}' is not an expense type.", title="Unknown expense type")

	project, non_project = int(project or 0), int(non_project or 0)
	_validate_scope(project, non_project)
	category = _validate_category(expense_category)
	profiles = _normalise_roles(allowed_roles)

	doc = frappe.get_doc("Expense Type", name)
	doc.project = project
	doc.non_project = non_project
	doc.expense_category = category
	_set_roles(doc, profiles)
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"name": name, "project": project, "non_project": non_project,
	        "expense_category": category,
	        "allowed_roles": [r.role_profile for r in doc.allowed_roles]}


def names_referenced_in_code() -> set[str]:
	"""Expense Type names the code looks up BY NAME, which a rename would silently orphan.

	Read from their owners rather than listed here, so adding a duplicate rule or changing
	the bank-import fallback updates this guard with no second edit.
	"""
	from nirmaan_stack.api.expense_requests.duplicates import RULES
	from nirmaan_stack.services.outflow_import.cashbook import FALLBACK_EXPENSE_TYPE

	return set(RULES) | {FALLBACK_EXPENSE_TYPE}


@frappe.whitelist(methods=["POST"])
def rename_expense_type(name: str, new_name: str):
	"""Rename an Expense Type -- admin only.

	`frappe.rename_doc` does the work: the docname, `expense_name` (the autoname field), the
	`allowed_roles` child rows, and every LINK to the type (Project Expenses, Non Project
	Expenses, Expense Request, Outflow Import Expense Rule) move to the new name.

	⚠️ WHAT DOES NOT MOVE (owner ruling 2026-09-16, deliberately left alone): two DATA columns
	store the type as plain text and keep the OLD name -- `PO Adjustment Items.expense_type`
	and `Outflow Import Row.suggested_expense_type`.

	⚠️ REFUSED for a name the code looks up by name (`names_referenced_in_code`): renaming one
	would silently switch off its duplicate warning or the bank-import fallback.

	⚠️ The `Expense Type` FIXTURE is keyed by name and re-imported on every migrate, so the
	fixture must be updated too or the next migrate re-creates the old name as a second type.
	"""
	_require_admin()
	old = (name or "").strip()
	new = (new_name or "").strip()
	if not frappe.db.exists("Expense Type", old):
		frappe.throw(f"'{old}' is not an expense type.", title="Unknown expense type")
	if not new:
		frappe.throw("A new name is required.", title="Name required")
	if new == old:
		frappe.throw("The new name is the same as the current one.", title="Nothing to rename")
	if frappe.db.exists("Expense Type", new):
		frappe.throw(f"'{new}' already exists.", title="Duplicate")
	if old in names_referenced_in_code():
		frappe.throw(
			f"'{old}' is used by name in the code (duplicate warnings or the bank-import "
			"fallback), so it cannot be renamed from the app.",
			title="Cannot rename this type",
		)

	# The model-level `rename_doc`: the `frappe.rename_doc` wrapper takes no
	# `ignore_permissions`, and the admin gate above is this action's permission check.
	from frappe.model.rename_doc import rename_doc

	renamed = rename_doc(doctype="Expense Type", old=old, new=new,
	                     ignore_permissions=True, show_alert=False)
	frappe.db.commit()
	return {"name": renamed}


@frappe.whitelist(methods=["POST"])
def set_expense_form_enabled(name: str, enabled=0):
	"""Switch a type's request form on or off.

	OFF keeps the written format but the request dialog asks the standard project /
	non-project fields instead. ON needs a format -- the doctype's `validate` refuses it
	otherwise, so Desk and this endpoint share one rule.
	"""
	_require_admin()
	if not frappe.db.exists("Expense Type", name):
		frappe.throw(f"'{name}' is not an expense type.", title="Unknown expense type")

	doc = frappe.get_doc("Expense Type", name)
	doc.source_format_enabled = 1 if int(enabled or 0) else 0
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"name": name, "source_format_enabled": doc.source_format_enabled}


@frappe.whitelist(methods=["POST"])
def save_expense_format(name: str, source_format=None):
	"""Author (or clear) a type's request form format.

	EMPTY IS A LEGITIMATE VALUE and clears the format -- unlike the commissioning master,
	where an unauthored template hides the Fill button. Here a format-less type must stay
	fully requestable on the native fields alone.

	Only structural JSON-ness is checked here; the grammar itself is validated in the editor
	by `utils/expenseFormat.validateFormat` -- THIS module's own validator, not the
	commissioning parser (their grammars and binding allowlists differ). This is the backstop
	that stops a non-parseable blob reaching a requester as a crashing form.
	"""
	_require_admin()
	if not frappe.db.exists("Expense Type", name):
		frappe.throw(f"'{name}' is not an expense type.", title="Unknown expense type")

	raw = (source_format or "").strip() if isinstance(source_format, str) else None
	if raw:
		try:
			parsed = json.loads(raw)
		except ValueError as e:
			frappe.throw(f"Not valid JSON: {e}", title="Invalid format")
		if not isinstance(parsed, dict):
			frappe.throw("The format must be a JSON object.", title="Invalid format")

	# ⚠️ `set_value` skips `validate`, so clearing the format switches the form OFF here
	# explicitly -- a switch left ON over no format would promise a form that is not there.
	values = {"source_format": raw or None}
	if not raw:
		values["source_format_enabled"] = 0
	frappe.db.set_value("Expense Type", name, values)
	frappe.db.commit()
	return {"name": name, "has_format": bool(raw)}
