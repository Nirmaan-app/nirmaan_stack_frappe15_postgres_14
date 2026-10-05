"""The Billing Packages tab (Admin Options → Packages Settings): list, add, rename, delete.

Who may change packages, and which may be deleted, are decided by the
`Project Billing Packages` hooks in `integrations/controllers/project_billing.py`.
"""

import frappe
from frappe import _

from nirmaan_stack.api.project_billing._queries import require_billing_access
from nirmaan_stack.services.project_billing.rules import clean_package_name
from nirmaan_stack.services.role_profiles import PROJECT_BILLING_PACKAGE_WRITE_PROFILES, has_role_profile


@frappe.whitelist()
def get_billing_packages() -> dict:
	"""Every package, in the order the pickers use."""
	require_billing_access()
	rows = frappe.get_all(
		"Project Billing Packages", fields=["name", "creation"], order_by="creation asc, name asc"
	)
	return {
		"packages": rows,
		"can_edit": has_role_profile(frappe.session.user, PROJECT_BILLING_PACKAGE_WRITE_PROFILES),
	}


@frappe.whitelist(methods=["POST"])
def add_billing_package(package_name: str) -> dict:
	name = clean_package_name(package_name)
	if not name:
		frappe.throw(_("Enter a package name."))
	doc = frappe.get_doc({"doctype": "Project Billing Packages", "package_name": name}).insert()
	frappe.db.commit()
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def rename_billing_package(name: str, new_name: str) -> dict:
	"""Rename a package, and every project package record named after it (one commit)."""
	out = _rename_package(name, new_name)
	frappe.db.commit()
	return out


def _rename_package(name: str, new_name: str) -> dict:
	"""The rename itself, uncommitted, so a failure anywhere rolls all of it back.

	Tracker IDs are `{project}-{package}`, so each is renamed to match; Frappe's rename then
	updates the bills linking to it and the tracker's own child rows (managers, DC log).
	Who may rename, and which packages, is decided by the package's `before_rename` hook.
	"""
	new = clean_package_name(new_name)
	if not new:
		frappe.throw(_("Enter a package name."))
	if new == name:
		return {"name": name, "renamed_trackers": 0}

	frappe.rename_doc("Project Billing Packages", name, new, force=True, rebuild_search=False)
	renamed = 0
	for tracker in frappe.get_all("Project Billing Tracker", filters={"package": new}, fields=["name", "project"]):
		target = f"{tracker.project}-{new}"
		if tracker.name != target:
			frappe.rename_doc("Project Billing Tracker", tracker.name, target, force=True, rebuild_search=False)
			renamed += 1
	return {"name": new, "renamed_trackers": renamed}


@frappe.whitelist(methods=["POST"])
def delete_billing_package(name: str) -> dict:
	frappe.delete_doc("Project Billing Packages", name)
	frappe.db.commit()
	return {"deleted": name}
