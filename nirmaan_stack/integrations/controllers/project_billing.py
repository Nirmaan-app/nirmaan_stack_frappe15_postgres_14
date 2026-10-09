# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Lifecycle controller for the client billing tracker doctypes.

`Project Billing Tracker`, `Project Billing` and `Project Billing Packages` grant
`System Manager` in their DocPerms, and that role also rides on the Project Lead
and other profiles. Who may WRITE is therefore decided here, by role profile
(`services/role_profiles.py`), not by the DocPerm.
"""

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.api.projects._tendering_guard import validate_won
from nirmaan_stack.services.project_billing.rules import (
	NA_STATUS,
	can_edit_package_bills,
	format_inr,
	raises_over_po,
)
from nirmaan_stack.services.role_profiles import (
	PROJECT_BILLING_PACKAGE_WRITE_PROFILES,
	can_write_project_billing,
	has_role_profile,
	is_nirmaan_admin,
)

_DC_ROW_FIELDS = ("dc_date", "amount")


def has_permission(doc, ptype=None, user=None, debug=False):
	"""Billing is visible to Admin, PMO and billing profiles only (owner, 2026-10-03).

	Can only deny: returning None leaves the role rows in charge.
	"""
	return None if can_write_project_billing(user or frappe.session.user) else False


def get_permission_query_conditions(user=None, doctype=None):
	"""Empty the list for everyone else (the hook above never sees a list)."""
	return "" if can_write_project_billing(user or frappe.session.user) else "1=0"


def _require_billing_writer():
	if not can_write_project_billing(frappe.session.user):
		frappe.throw(_("Only Admin, PMO and Billing users can change billing."), frappe.PermissionError)


def _require_package_editor(tracker: str, managers: list[str] | None = None):
	"""Bills and Supply DC of a package: Admin, or one of its billing managers (owner, 2026-10-03).

	`managers` defaults to the package's saved managers.
	"""
	user = frappe.session.user
	admin = is_nirmaan_admin(user)
	if managers is None and not admin:
		managers = frappe.get_all(
			"Project Billing Manager",
			filters={"parent": tracker, "parenttype": "Project Billing Tracker"},
			pluck="manager",
		)
	if not can_edit_package_bills(user, managers, admin):
		frappe.throw(
			_("Only this package's billing managers or Admin can change its bills and Supply DC."),
			frappe.PermissionError,
		)


def tracker_validate(doc, method):
	_require_billing_writer()
	if doc.is_new():
		validate_won(doc.project, "Billing Tracker")
	_guard_saved_dc_rows(doc)
	_guard_new_dc_rows(doc)


def billing_validate(doc, method):
	_require_billing_writer()
	_require_package_editor(doc.billing_tracker)
	_guard_billed_within_po(doc)


def _guard_billed_within_po(doc):
	"""A bill may not take its package's billed total above the package's PO value (owner, 2026-10-05).

	Billed = the package's non-NA bills, as in every total. Only an increase past the PO is refused,
	so a bill on a package already over its PO can still change status or come down.
	"""
	po_value, package = frappe.db.get_value("Project Billing Tracker", doc.billing_tracker, ["po_value", "package"])
	if not flt(po_value):
		return
	others = flt(
		frappe.db.sql(
			"""SELECT COALESCE(SUM(bill_value), 0) FROM "tabProject Billing"
			WHERE billing_tracker = %s AND name <> %s AND status <> %s""",
			(doc.billing_tracker, doc.name or "", NA_STATUS),
		)[0][0]
	)

	def counted(bill):
		return flt(bill.bill_value) if bill and bill.status != NA_STATUS else 0

	new_total = others + counted(doc)
	if raises_over_po(po_value, others + counted(doc.get_doc_before_save()), new_total):
		frappe.throw(
			_("{0}: billed total would be {1}, more than its PO value of {2}. This bill can be at most {3}.").format(
				package, format_inr(new_total), format_inr(po_value), format_inr(max(flt(po_value) - others, 0))
			)
		)


def billing_on_trash(doc, method):
	_require_billing_writer()
	_require_package_editor(doc.billing_tracker)


def tracker_on_trash(doc, method):
	"""Removing a package from a project deletes its billing history: Admin only (owner, 2026-10-05)."""
	_require_billing_writer()
	if not is_nirmaan_admin(frappe.session.user):
		frappe.throw(_("Only Admin can remove a billing package from a project."), frappe.PermissionError)


def _require_package_writer():
	if not has_role_profile(frappe.session.user, PROJECT_BILLING_PACKAGE_WRITE_PROFILES):
		frappe.throw(_("Only Admin and the Billing Lead can change billing packages."), frappe.PermissionError)


def package_validate(doc, method):
	_require_package_writer()
	# The name is the record's ID and unique as typed; "electrical" beside "Electrical"
	# would still be a second package, so compare ignoring case.
	clash = frappe.db.sql(
		"""SELECT name FROM "tabProject Billing Packages" WHERE LOWER(name) = LOWER(%s) AND name <> %s LIMIT 1""",
		(doc.package_name, doc.name or ""),
	)
	if clash:
		frappe.throw(_("A billing package named {0} already exists.").format(clash[0][0]))


def package_before_rename(doc, method, old, new, merge=False):
	"""A package is renamed by Admin / Billing Lead, never onto an existing name (any case)."""
	_require_package_writer()
	if merge:
		frappe.throw(_("Billing packages cannot be merged."))
	clash = frappe.db.sql(
		"""SELECT name FROM "tabProject Billing Packages" WHERE LOWER(name) = LOWER(%s) AND name <> %s LIMIT 1""",
		(new, old),
	)
	if clash:
		frappe.throw(_("A billing package named {0} already exists.").format(clash[0][0]))


def package_on_trash(doc, method):
	"""A package any project has set up cannot be deleted (owner, 2026-10-05)."""
	_require_package_writer()
	used_by = frappe.db.count("Project Billing Tracker", {"package": doc.name})
	if used_by:
		frappe.throw(
			_("{0} is used by {1} project(s). Remove it from those projects first.").format(doc.name, used_by)
		)


def _guard_new_dc_rows(doc):
	"""A new Supply DC row is logged by Admin or one of the package's billing managers.

	Checked against the managers as saved, so adding yourself and a DC row in one
	save does not pass.
	"""
	previous = doc.get_doc_before_save()
	saved = {row.name for row in previous.dc_log} if previous else set()
	if all(row.name in saved for row in doc.dc_log):
		return
	source = previous or doc
	_require_package_editor(doc.name, [row.manager for row in source.billing_managers])


def _guard_saved_dc_rows(doc):
	"""A DC row, once saved, is changed or removed by Admin only (owner, 2026-10-03).

	Everyone else may only add rows; a mistake is corrected with a negative row.
	"""
	previous = doc.get_doc_before_save()
	if not previous or is_nirmaan_admin(frappe.session.user):
		return

	current = {row.name: row for row in doc.dc_log}
	for old in previous.dc_log:
		row = current.get(old.name)
		if row is None:
			frappe.throw(_("Only Admin can delete a saved Supply DC entry. Add a negative entry to correct it."))
		if any(str(row.get(f) or "") != str(old.get(f) or "") for f in _DC_ROW_FIELDS):
			frappe.throw(_("Only Admin can change a saved Supply DC entry. Add a negative entry to correct it."))
