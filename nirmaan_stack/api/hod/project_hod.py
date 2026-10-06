# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Handover Documents tab: the project-side endpoints. Thin orchestrators (ADR-0010 B4).

A project hands over only the systems the team ADDS (owner ruling 2026-09-21): "Create Handover Documents"
/ "+ Add system" creates each chosen system's 16 `Project HOD Document` rows at once, and the project's system tabs are simply the
systems that have rows -- there is no parent record. Every later action updates one row.

Permissions are the doctype's own (write = System Manager, PMO, Project Lead, Project Manager): rows are
inserted / saved / deleted through the document layer, so the controller's rules and the role checks
apply exactly as they would in Desk.
"""

import json

import frappe
from frappe import _

from nirmaan_stack.api.hod.from_app import commission_categories, system_meta
from nirmaan_stack.api.hod.project_info import as_dict, project_info
from nirmaan_stack.services.hod import blanks, checklist, index, sources

DOCTYPE = "Project HOD Document"
ROW_FIELDS = ["name", "hod_system", "document", "status", "disabled", "remarks", "form_data", "modified", "creation"]
# `status` IS editable since 2026-09-24 -- since 2026-10-06 it is the document's progress
# (Not Started / WIP / Done); the checklist's YES / NO is the `disabled` switch.
# The controller guards it: Done is refused on a From Nirmaan document with nothing ticked or uploaded.
EDITABLE_FIELDS = ("status", "disabled", "remarks", "form_data")
EV_CHANGED = "hod:rows_changed"


def _require_project_read(project: str):
	if not project or not frappe.db.exists("Projects", project):
		frappe.throw(_("Project not found."))
	if not frappe.has_permission("Projects", "read", doc=project):
		raise frappe.PermissionError(_("Not permitted to read this project."))


def project_packages(project: str) -> list:
	"""The project's packages that are Work Packages, in the project's own order.

	Read from `project_wp_category_makes` (filled on almost every project) and the legacy
	`project_work_packages` JSON (missing on many newer projects) -- a union, first-seen order.
	Procurement-only entries (Tool & Equipments, Services, Additional Charges) are dropped.
	"""
	names = frappe.get_all(
		"Project Work Package Category Make",
		filters={"parent": project, "parenttype": "Projects"},
		pluck="procurement_package",
		order_by="idx asc",
	)
	legacy = as_dict(frappe.db.get_value("Projects", project, "project_work_packages"))
	names += [w.get("work_package_name") for w in (legacy.get("work_packages") or []) if isinstance(w, dict)]
	work_packages = set(frappe.get_all("Work Packages", pluck="name"))
	out = []
	for n in names:
		if n and n in work_packages and n not in out:
			out.append(n)
	return out


def _rows(project: str) -> list:
	rows = frappe.get_all(DOCTYPE, filters={"project": project}, fields=ROW_FIELDS, order_by="creation asc")
	for r in rows:
		r.form_data = as_dict(r.form_data)
		r.disabled = int(r.disabled or 0)
		r.status = checklist.normalise_status(r.status)
	return rows


def _counts(hod_system: str, rows: list) -> dict:
	"""checklist.counts + `touched`: how many rows hold entries (removing the system loses them)."""
	off = checklist.default_disabled_keys(frappe.db.get_value("HOD System", hod_system, "default_disabled_documents"))
	out = checklist.counts(rows)
	out["touched"] = sum(0 if checklist.is_untouched(r, r.document in off) else 1 for r in rows)
	return out


def get_payload(project: str) -> dict:
	rows = _rows(project)
	added = []
	by_system = {}
	for r in rows:
		if r.hod_system not in by_system:
			added.append(r.hod_system)
			by_system[r.hod_system] = []
		by_system[r.hod_system].append(r)
	order = {k: i for i, k in enumerate(index.KEYS)}
	for sys_rows in by_system.values():
		sys_rows.sort(key=lambda r: order.get(r.document, 99))

	packages = project_packages(project)
	systems = frappe.get_all(
		"HOD System",
		fields=["name", "display_name", "work_package", "is_active"],
		order_by="work_package asc, name asc",
	)
	return {
		"project": project_info(project),
		"documents": index.public_list(),
		"packages": packages,
		"systems": [
			{
				"name": s.name,
				"display_name": s.display_name,
				"work_package": s.work_package,
				"is_active": int(s.is_active or 0),
				"suggested": s.work_package in packages,
				"added": s.name in by_system,
			}
			for s in systems
			if s.is_active or s.name in by_system
		],
		"added": added,
		"rows": by_system,
		"counts": {name: _counts(name, sys_rows) for name, sys_rows in by_system.items()},
		"can_edit": bool(frappe.has_permission(DOCTYPE, "write")),
		# No HOD System yet -> the tab points whoever may create one to the library screens.
		"library_empty": not frappe.db.count("HOD System"),
		"can_edit_library": bool(frappe.has_permission("HOD System", "create")),
	}


@frappe.whitelist()
def get_project_hod(project: str) -> dict:
	"""Everything the Handover Documents tab needs for one project."""
	_require_project_read(project)
	return get_payload(project)


def _publish(project: str):
	frappe.publish_realtime(EV_CHANGED, {"project": project}, after_commit=True)


@frappe.whitelist(methods=["POST"])
def add_systems(project: str, hod_systems) -> dict:
	"""Start handing over one or more systems: create each one's 16 rows (its default documents switched
	off). All or nothing -- every system is checked before any row is written, and one commit covers them."""
	if isinstance(hod_systems, str):
		hod_systems = json.loads(hod_systems or "[]")
	names = [s for s in dict.fromkeys(hod_systems or []) if s]
	if not names:
		frappe.throw(_("Select at least one system."))
	_require_project_read(project)
	if not frappe.has_permission(DOCTYPE, "create"):
		raise frappe.PermissionError(_("Not permitted to add handover documents."))

	systems = []
	for name in names:
		if frappe.db.exists(DOCTYPE, {"project": project, "hod_system": name}):
			frappe.throw(_("{0} is already added to this project.").format(name))
		system = system_meta(name)
		if not system.is_active:
			frappe.throw(_("{0} is not active.").format(name))
		systems.append(system)

	for system in systems:
		off = checklist.default_disabled_keys(system.default_disabled_documents)
		for d in index.DOCUMENTS:
			frappe.get_doc(
				{
					"doctype": DOCTYPE,
					"project": project,
					"hod_system": system.name,
					"document": d["key"],
					"status": checklist.STATUS_NOT_STARTED,
					"disabled": 1 if d["key"] in off else 0,
				}
			).insert()
	frappe.db.commit()
	_publish(project)
	return get_payload(project)


@frappe.whitelist(methods=["POST"])
def remove_system(project: str, hod_system: str, force=False) -> dict:
	"""Take a system off the project. When anything was entered on it (forms, remarks, uploads, switches),
	the screen warns first and sends `force` once the user confirms -- the entries are deleted with it."""
	_require_project_read(project)
	if not frappe.has_permission(DOCTYPE, "delete"):
		raise frappe.PermissionError(_("Not permitted to remove handover documents."))
	rows = [r for r in _rows(project) if r.hod_system == hod_system]
	if not rows:
		frappe.throw(_("{0} is not added to this project.").format(hod_system))
	off = checklist.default_disabled_keys(system_meta(hod_system).default_disabled_documents)
	touched = [r for r in rows if not checklist.is_untouched(r, r.document in off)]
	if touched and not frappe.utils.cint(force):
		frappe.throw(
			_("{0} document(s) of {1} already have entries. Confirm the removal to delete them.").format(
				len(touched), hod_system
			)
		)
	for r in rows:
		frappe.delete_doc(DOCTYPE, r.name)
	frappe.db.commit()
	_publish(project)
	return get_payload(project)


@frappe.whitelist(methods=["POST"])
def update_row(name: str, patch) -> dict:
	"""Change one row: the on/off switch, its status, remarks or its form data."""
	if isinstance(patch, str):
		patch = json.loads(patch or "{}")
	doc = frappe.get_doc(DOCTYPE, name)
	for field in EDITABLE_FIELDS:
		if field not in patch:
			continue
		value = patch[field]
		if field == "form_data":
			if not isinstance(value, dict):
				frappe.throw(_("form_data must be an object."))
			value = json.dumps(value)
		elif field == "disabled":
			value = 1 if value else 0
		doc.set(field, value)
	doc.save()
	frappe.db.commit()
	_publish(doc.project)
	row = {f: doc.get(f) for f in ROW_FIELDS}
	row["form_data"] = as_dict(doc.form_data)
	return row


@frappe.whitelist()
def get_system_library(project: str, hod_system: str) -> dict:
	"""The library a system's template documents read, plus the project's default part ticks."""
	_require_project_read(project)
	system = system_meta(hod_system)
	contents = frappe.get_all(
		"HOD Library Content",
		filters={"hod_system": hod_system},
		fields=["name", "document", "sub_system", "title", "content", "list_1", "list_2", "display_order"],
		order_by="document asc, display_order asc, creation asc",
	)
	categories = commission_categories(project)
	grouped = {}
	for c in contents:
		grouped.setdefault(c.document, []).append(
			{
				"name": c.name,
				"sub_system": c.sub_system or "",
				"title": c.title,
				"content": c.content or "",
				"list_1": checklist.parse_lines(c.list_1),
				"list_2": checklist.parse_lines(c.list_2),
				"blanks": blanks.find_blanks(c.content),
			}
		)
	defaults = {
		doc: (sources.default_included([i["sub_system"] for i in items], categories) if len(items) > 1 else [items[0]["sub_system"] or "all"])
		for doc, items in grouped.items()
	}
	return {
		"system": {
			"name": system.name,
			"display_name": system.display_name,
			"work_package": system.work_package,
			"tools": checklist.parse_lines(system.tools),
			"warranty_equipment": checklist.parse_lines(system.warranty_equipment),
		},
		"contents": grouped,
		"default_included": defaults,
		"commission_categories": categories,
	}
