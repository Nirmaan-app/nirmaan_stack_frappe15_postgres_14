# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The HOD library screen (Packages Settings -> Handover Documents): ONE read for the whole screen.

Writes go through the ordinary document API (createDoc / updateDoc / deleteDoc from the SPA), so the
doctype permissions and the controllers apply exactly as they do in Desk; only this read is assembled
here, together with the two lists the screen's pickers need (the 16 documents and the Work Packages).
"""

import frappe

from nirmaan_stack.services.hod import checklist, index

SYSTEM = "HOD System"
CONTENT = "HOD Library Content"
ROW = "Project HOD Document"

SYSTEM_FIELDS = [
	"name",
	"system_name",
	"display_name",
	"work_package",
	"is_active",
	"tools",
	"warranty_equipment",
	"default_disabled_documents",
	"source_keywords",
	"modified",
]
CONTENT_FIELDS = [
	"name",
	"hod_system",
	"document",
	"sub_system",
	"title",
	"content",
	"list_1",
	"list_2",
	"display_order",
	"modified",
]


@frappe.whitelist()
def get_hod_library() -> dict:
	"""Every system with its library blocks, plus how many projects already use it."""
	if not frappe.has_permission(SYSTEM, "read"):
		raise frappe.PermissionError

	systems = frappe.get_all(SYSTEM, fields=SYSTEM_FIELDS, order_by="system_name asc")
	contents = frappe.get_all(
		CONTENT,
		fields=CONTENT_FIELDS,
		order_by="hod_system asc, document asc, display_order asc, creation asc",
	)
	by_system = {}
	for c in contents:
		by_system.setdefault(c.hod_system, []).append(c)

	# A system that projects already hand over cannot be deleted; the screen says so before the attempt.
	used = dict(
		frappe.db.sql(f'select hod_system, count(distinct project) from "tab{ROW}" group by hod_system')
	)
	for s in systems:
		s.is_active = int(s.is_active or 0)
		s.contents = by_system.get(s.name, [])
		s.projects = used.get(s.name, 0)
		# The stored lines as a clean list of valid document keys (unknown lines are ignored, as everywhere).
		s.default_disabled = [d["key"] for d in index.DOCUMENTS if d["key"] in checklist.default_disabled_keys(s.default_disabled_documents)]

	return {
		"systems": systems,
		"documents": index.public_list(),
		"library_documents": list(index.LIBRARY_DOCUMENTS),
		"work_packages": frappe.get_all("Work Packages", pluck="name", order_by="name asc"),
		"can_edit": bool(frappe.has_permission(SYSTEM, "write")),
	}


@frappe.whitelist()
def preview_row(hod_system: str, document: str) -> dict:
	"""A row to preview one document of this system with, or {} when no project has it yet.

	The library screen shows what a change looks like on paper by printing a REAL project's row through
	the ordinary print format (nothing is created and nothing is written); the newest one is used, so it
	is the row someone worked on last.
	"""
	if not frappe.has_permission(SYSTEM, "read") or not frappe.has_permission(ROW, "read"):
		raise frappe.PermissionError
	row = frappe.get_all(
		ROW,
		filters={"hod_system": hod_system, "document": document},
		fields=["name", "project"],
		order_by="modified desc",
		limit=1,
	)
	if not row:
		return {}
	return {
		"name": row[0].name,
		"project": row[0].project,
		"project_name": frappe.db.get_value("Projects", row[0].project, "project_name") or row[0].project,
	}
