# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Each package's signed handover copy (owner 2026-10-06).

After the binder is printed, signed and scanned, the scan is uploaded ONCE per package and stored on the
project's `Project HOD Setting`, one `Project HOD Package File` row per package (`package_files`). It is
STORED ONLY: "Download binder" always builds from the current documents, and no document reads it. A new
upload replaces the file on the package's row; there is no remove (owner asked for replace only).

The file itself is uploaded by the screen (Frappe's `upload_file`, private, attached to the setting -- named
after the project, so its name is known before the setting exists); this endpoint records it on the row.

Thin orchestrator (ADR-0010 B4): permission, validate, persist, publish.
"""

import frappe
from frappe import _

from nirmaan_stack.api.hod.header_roles import SETTING, _require_project

CHILD = "Project HOD Package File"
ROW_DOCTYPE = "Project HOD Document"


def _ready() -> bool:
	"""The child table exists. False only between pulling this code and running the migrate that creates
	it -- without the check, the whole Handover Documents tab would fail to load in that window."""
	return frappe.db.table_exists(CHILD)


def signed_copies(project: str) -> dict:
	"""`{hod_system: {"url", "file_name", "uploaded_on", "uploaded_by"}}` for one project -- the tab's read."""
	if not _ready():
		return {}
	rows = frappe.get_all(
		CHILD,
		filters={"parenttype": SETTING, "parent": project, "parentfield": "package_files"},
		fields=["hod_system", "signed_copy", "modified", "modified_by"],
		order_by="modified asc",
	)
	urls = [r.signed_copy for r in rows if r.signed_copy]
	names = {
		f.file_url: f.file_name
		for f in (frappe.get_all("File", filters={"file_url": ["in", urls]}, fields=["file_url", "file_name"]) if urls else [])
	}
	return {
		r.hod_system: {
			"url": r.signed_copy,
			"file_name": names.get(r.signed_copy) or "Signed copy",
			"uploaded_on": str(r.modified),
			"uploaded_by": r.modified_by,
		}
		for r in rows
		if r.signed_copy
	}


def has_signed_copy(project: str, hod_system: str) -> bool:
	return _ready() and bool(
		frappe.db.exists(
			CHILD, {"parenttype": SETTING, "parent": project, "parentfield": "package_files", "hod_system": hod_system}
		)
	)


def drop_signed_copy(project: str, hod_system: str) -> None:
	"""Remove a package's row -- called when the package itself is removed from the project. The File
	record is left in place, like every other replaced attachment in this app."""
	if not has_signed_copy(project, hod_system):
		return
	doc = frappe.get_doc(SETTING, project)
	doc.package_files = [r for r in doc.package_files if r.hod_system != hod_system]
	doc.save()


@frappe.whitelist(methods=["POST"])
def set_signed_copy(project: str, hod_system: str, file_url: str) -> dict:
	"""Store (or replace) a package's signed copy. `file_url` must be a file already uploaded against this
	project's setting -- the screen uploads it first."""
	_require_project(project)
	if not frappe.has_permission(ROW_DOCTYPE, "write"):
		raise frappe.PermissionError(_("Not permitted to change this project's handover documents."))
	if not frappe.db.exists(ROW_DOCTYPE, {"project": project, "hod_system": hod_system}):
		frappe.throw(_("{0} is not added to this project.").format(hod_system))
	if not file_url or not frappe.db.exists(
		"File", {"file_url": file_url, "attached_to_doctype": SETTING, "attached_to_name": project}
	):
		frappe.throw(_("Upload the signed copy first."))

	if frappe.db.exists(SETTING, project):
		doc = frappe.get_doc(SETTING, project)
	else:
		doc = frappe.get_doc({"doctype": SETTING, "project": project})
	row = next((r for r in doc.package_files if r.hod_system == hod_system), None)
	if row:
		row.signed_copy = file_url
	else:
		doc.append("package_files", {"hod_system": hod_system, "signed_copy": file_url})
	if doc.is_new():
		doc.insert()
	else:
		doc.save()
	frappe.db.commit()

	from nirmaan_stack.api.hod import project_hod  # it reads `signed_copies` for its payload

	project_hod._publish(project)
	return signed_copies(project).get(hod_system) or {}
