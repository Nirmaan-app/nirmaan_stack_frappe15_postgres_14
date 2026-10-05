"""Rename a billing package (Admin Options → Packages Settings → Billing Packages).

Listing, adding and deleting packages go through the standard document API from the
frontend (frappe-react-sdk); the rules for every path live in the `Project Billing Packages`
hooks in `integrations/controllers/project_billing.py`. Only the rename is an endpoint,
because it also renames each project's tracker in the same transaction.
"""

import frappe
from frappe import _

from nirmaan_stack.services.project_billing.rules import clean_package_name


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
