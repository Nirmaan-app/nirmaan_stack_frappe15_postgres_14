"""Set up billing for a project: one Project Billing Tracker per package."""

import json

import frappe
from frappe import _
from frappe.utils import flt


def _managers(entry: dict) -> list[str]:
	"""The picked managers, blanks and repeats dropped, in the order picked."""
	picked = entry.get("billing_managers") or []
	if not isinstance(picked, list):
		frappe.throw(_("Billing managers for {0} must be a list.").format(entry.get("package")))
	return list(dict.fromkeys(user for user in picked if user))


@frappe.whitelist(methods=["POST"])
def setup_project_billing(project: str, packages) -> dict:
	"""Create a tracker for each package not yet set up, and set its managers and PO value.

	`packages` is a list of `{"package", "billing_managers": [user, ...], "po_value"}`. A
	package that already has a tracker keeps it; only its managers and PO value are updated.
	Who may call this, and the Won check, are enforced by the tracker's validate.
	"""
	if isinstance(packages, str):
		packages = json.loads(packages)
	if not packages:
		frappe.throw(_("Pick at least one billing package."))

	created, updated = [], []
	for entry in packages:
		package = entry.get("package")
		managers = _managers(entry)
		po_value = flt(entry.get("po_value"))
		if po_value <= 0:
			frappe.throw(_("Enter a PO value greater than 0 for {0}.").format(package))
		manager_rows = [{"manager": user} for user in managers]

		name = frappe.db.get_value("Project Billing Tracker", {"project": project, "package": package})
		if name:
			doc = frappe.get_doc("Project Billing Tracker", name)
			if [row.manager for row in doc.billing_managers] != managers or flt(doc.po_value) != po_value:
				doc.set("billing_managers", manager_rows)
				doc.po_value = po_value
				doc.save()
				updated.append(name)
			continue
		doc = frappe.get_doc(
			{
				"doctype": "Project Billing Tracker",
				"project": project,
				"package": package,
				"billing_managers": manager_rows,
				"po_value": po_value,
			}
		).insert()
		created.append(doc.name)

	frappe.db.commit()
	return {"created": created, "updated": updated}
