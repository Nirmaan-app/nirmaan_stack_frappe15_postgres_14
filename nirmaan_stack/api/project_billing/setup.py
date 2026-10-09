"""Set up billing for a project: one Project Billing Tracker per package; Admin removes one."""

import json

import frappe
from frappe import _
from frappe.utils import flt

from nirmaan_stack.services.project_billing.rules import APPROVED_STATUSES, NA_STATUS, removal_confirmed
from nirmaan_stack.services.role_profiles import is_nirmaan_admin


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


def _require_admin():
	if not is_nirmaan_admin(frappe.session.user):
		frappe.throw(_("Only Admin can remove a billing package from a project."), frappe.PermissionError)


def _removal_summary(tracker: str) -> dict:
	"""Everything removing this package deletes, counted for the Admin's warning."""
	t = frappe.db.get_value(
		"Project Billing Tracker", tracker, ["name", "project", "package", "po_value", "supply_dc"], as_dict=True
	)
	if not t:
		frappe.throw(_("Billing package {0} was not found.").format(tracker), frappe.DoesNotExistError)
	bills = frappe.db.sql(
		"""
		SELECT COUNT(*) AS bills,
			COUNT(*) FILTER (WHERE status = %(na)s) AS na_bills,
			COALESCE(SUM(bill_value) FILTER (WHERE status <> %(na)s), 0) AS billed,
			COALESCE(SUM(bill_value) FILTER (WHERE status IN %(approved)s), 0) AS approved,
			COUNT(*) FILTER (WHERE COALESCE(bill_attachment, '') <> '') AS attachments
		FROM "tabProject Billing"
		WHERE billing_tracker = %(tracker)s
		""",
		{"na": NA_STATUS, "approved": tuple(APPROVED_STATUSES), "tracker": tracker},
		as_dict=True,
	)[0]
	managers = frappe.get_all(
		"Project Billing Manager", filters={"parent": tracker, "parenttype": "Project Billing Tracker"}, pluck="manager"
	)
	return dict(
		bills,
		tracker=t.name,
		project=t.project,
		project_name=frappe.db.get_value("Projects", t.project, "project_name") or t.project,
		package=t.package,
		po_value=flt(t.po_value),
		supply_dc=flt(t.supply_dc),
		dc_entries=frappe.db.count("Project Billing DC Log", {"parent": tracker, "parenttype": "Project Billing Tracker"}),
		managers=[frappe.db.get_value("User", m, "full_name") or m for m in managers],
	)


@frappe.whitelist()
def get_package_removal_summary(tracker: str) -> dict:
	"""What removing a package from its project would delete (owner, 2026-10-05). Admin only."""
	_require_admin()
	return _removal_summary(tracker)


@frappe.whitelist(methods=["POST"])
def remove_project_package(tracker: str, confirm_name: str) -> dict:
	"""Remove a package from its project (owner, 2026-10-05): every bill, with its file, then the package
	with its Supply DC log and managers. Admin only, the package's name typed to confirm, one transaction:
	if anything fails nothing is deleted. Frappe keeps each deleted document in Deleted Documents.
	"""
	_require_admin()
	summary = _removal_summary(tracker)
	if not removal_confirmed(confirm_name, summary["package"]):
		frappe.throw(_("Type {0} to confirm removing it.").format(summary["package"]))
	for bill in frappe.get_all("Project Billing", filters={"billing_tracker": tracker}, pluck="name"):
		frappe.delete_doc("Project Billing", bill)
	frappe.delete_doc("Project Billing Tracker", tracker)
	frappe.db.commit()
	return summary
