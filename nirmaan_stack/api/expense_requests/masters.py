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

from nirmaan_stack.api.expense_requests.access import is_admin


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
	the named ones fit, that category is `Other`. Leaving it blank was an option briefly, and
	it produced a type that looked categorised in no list and routed to the default reviewer
	for reasons nobody had chosen.

	⚠️ The RUNTIME still tolerates a blank -- `expense_request_routing` falls back to the
	default reviewer rather than refusing. That asymmetry is deliberate: a type created
	directly in Desk, or one predating this rule, must never become silently un-requestable.
	The app enforces the rule; the runtime fails open.
	"""
	category = (expense_category or "").strip()
	if not category:
		frappe.throw(
			"Pick a category. Use 'Other' if none of the named ones fit.",
			title="Category required",
		)
	if not frappe.db.exists("Expense Category", category):
		frappe.throw(f"'{category}' is not an expense category.", title="Unknown category")
	return category


def _validate_scope(project: int, non_project: int) -> None:
	if not project and not non_project:
		frappe.throw(
			"An expense type must allow project use, non-project use, or both. "
			"A type flagged for neither cannot be requested at all.",
			title="Scope required",
		)


@frappe.whitelist(methods=["POST"])
def create_expense_type(expense_name: str, project=0, non_project=0, expense_category=None):
	"""Add an Expense Type, optionally assigning it to an existing category."""
	_require_admin()
	category = _validate_category(expense_category)
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
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def update_expense_type(name: str, project=0, non_project=0, expense_category=None):
	"""Change a type's scope and its category.

	The NAME is deliberately not editable HERE. It is the docname, so changing it is a
	`rename_doc` operation rather than a field write -- a different thing with different
	consequences, and not something a scope-editing dialog should do implicitly.

	(The stronger reason has since gone: the reviewer-routing map used to hardcode these
	names, so a rename broke routing silently. Routing is now a Link on the type, which
	`rename_doc` updates like any other. Renaming could be offered deliberately as its own
	action -- it is simply not this one.)
	"""
	_require_admin()
	if not frappe.db.exists("Expense Type", name):
		frappe.throw(f"'{name}' is not an expense type.", title="Unknown expense type")

	project, non_project = int(project or 0), int(non_project or 0)
	_validate_scope(project, non_project)
	category = _validate_category(expense_category)

	doc = frappe.get_doc("Expense Type", name)
	doc.project = project
	doc.non_project = non_project
	doc.expense_category = category
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"name": name, "project": project, "non_project": non_project,
	        "expense_category": category}


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

	frappe.db.set_value("Expense Type", name, "source_format", raw or None)
	frappe.db.commit()
	return {"name": name, "has_format": bool(raw)}
