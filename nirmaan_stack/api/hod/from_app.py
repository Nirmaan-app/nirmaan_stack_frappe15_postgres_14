# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Handover documents that already exist elsewhere in Nirmaan. READ-ONLY: nothing here writes.

  2 Demo & Training, 3 Commissioning, 14 Factory Test -> Commission Report tasks
  4 Material TDS                                        -> Project TDS Item List
  15 Snag List                                         -> Project Snag (whole project: snag categories
                                                          are free text, so they cannot be split by system)
  16 As Built                                          -> Design Tracker tasks in the Handover phase

A system reads the Commission tasks of its Work Package (Commission Report Category carries `work_package`),
narrowed by `HOD System.source_keywords` where one package holds several systems. TDS items are narrowed by
those keywords ONLY on such a shared package (`sources.tds_belongs`): a TDS category names the part, not the
system, so "IP Cameras" would fail CCTV's own keyword. Design Tracker categories
carry no Work Package on this site, so a category belongs to the system NAMED in it ("Electrical", "Fire
Sprinkler" -> Sprinkler); the categories no system claims (ELV, BMS, Overall Project) are searched by keywords.
The matching rules themselves live in `services/hod/sources.py`.
"""

import re

import frappe

from nirmaan_stack.api.hod.project_info import as_dict
from nirmaan_stack.services.hod import checklist, index, sources

NOT_APPLICABLE = "Not Applicable"

COMMISSION_MASTER = "Commission Report Tasks"
PF_COMMISSION = "Project Commission Report - Filled Task"
PF_COMMISSION_LANDSCAPE = "LSProject Commission Report - Filled Task"
_LANDSCAPE_RE = re.compile(r'"printOrientation"\s*:\s*"landscape"', re.IGNORECASE)


def commission_print_formats(categories) -> dict:
	"""(category, task_name) -> the Commission print format that renders the filled report. Same rule as the
	Commission Report screen (`useMasterTaskMap`): the task's template declares its orientation; the
	landscape format is used only when it exists. One query for all the categories."""
	if not categories:
		return {}
	landscape_ok = bool(frappe.db.exists("Print Format", PF_COMMISSION_LANDSCAPE))
	out = {}
	for m in frappe.get_all(
		COMMISSION_MASTER,
		filters={"category_link": ["in", list(categories)]},
		fields=["category_link", "task_name", "source_format"],
	):
		landscape = landscape_ok and bool(_LANDSCAPE_RE.search(m.source_format or ""))
		out[(m.category_link, m.task_name)] = PF_COMMISSION_LANDSCAPE if landscape else PF_COMMISSION
	return out


def system_meta(hod_system: str) -> frappe._dict:
	row = frappe.db.get_value(
		"HOD System",
		hod_system,
		["name", "system_name", "display_name", "work_package", "source_keywords", "tools",
		 "warranty_equipment", "default_disabled_documents", "is_active"],
		as_dict=True,
	)
	if not row:
		frappe.throw(f"HOD System {hod_system} not found.")
	row.keywords = checklist.parse_lines(row.source_keywords)
	return row


def _categories_for(doctype: str, work_package: str) -> list:
	return frappe.get_all(doctype, filters={"work_package": work_package}, pluck="name")


def commission_tasks(project: str, system, bucket: str | None = None) -> list:
	"""The project's FINISHED Commission Report tasks for this system.

	Only Submitted / Client Accepted tasks are offered for handover (owner 2026-09-23): a task still being
	worked on has no report the client can be given."""
	categories = _categories_for("Commission Report Category", system.work_package)
	if not categories:
		return []
	rows = frappe.db.sql(
		"""
		select t.name, t.parent, t.task_name, t.commission_category, t.task_status, t.report_type,
		       t.approval_proof, t.file_link, t.task_phase,
		       (coalesce(t.response_data::text, '') not in ('', 'null', '{}')
		        and coalesce(t.response_snapshot_id, '') != '') as has_report
		from "tabCommission Report Task Child Table" t
		join "tabProject Commission Report" p on p.name = t.parent
		where p.project = %(project)s
		  and t.parenttype = 'Project Commission Report'
		  and t.commission_category in %(categories)s
		order by t.commission_category, t.idx
		""",
		{"project": project, "categories": tuple(categories)},
		as_dict=True,
	)
	formats = commission_print_formats({r.commission_category for r in rows})
	out = []
	for r in rows:
		if not sources.commission_is_done(r.task_status):
			continue
		if not sources.matches_keywords(r.task_name, system.keywords):
			continue
		r.bucket = sources.commission_bucket(r.task_name)
		if bucket and r.bucket != bucket:
			continue
		r.has_report = bool(r.has_report)
		r.print_format = formats.get((r.commission_category, r.task_name), PF_COMMISSION)
		out.append(r)
	return out


def commission_categories(project: str) -> list:
	"""The Commission Report categories this project has tasks in (drives the HVAC part pre-ticks)."""
	return [
		r.commission_category
		for r in frappe.db.sql(
			"""
			select distinct t.commission_category
			from "tabCommission Report Task Child Table" t
			join "tabProject Commission Report" p on p.name = t.parent
			where p.project = %s and t.parenttype = 'Project Commission Report'
			  and coalesce(t.task_status, '') != %s
			""",
			(project, NOT_APPLICABLE),
			as_dict=True,
		)
		if r.commission_category
	]


def package_is_shared(work_package) -> bool:
	"""Do several ACTIVE systems hand over the same Work Package? (Critical Room ELV = GSS, VESDA,
	WLD & RRS -- the only one today.) A package with one system needs no narrowing at all."""
	if not work_package:
		return False
	return frappe.db.count("HOD System", {"work_package": work_package, "is_active": 1}) > 1


def tds_items(project: str, system) -> list:
	"""The project's TDS items for the system's package, narrowed by keywords only where the package is
	SHARED (see `sources.tds_belongs`): GSS, VESDA and WLD & RRS all sit in Critical Room ELV and would
	otherwise each show the other two's data sheets."""
	items = frappe.get_all(
		"Project TDS Item List",
		filters={"tdsi_project_id": project, "tds_work_package": system.work_package},
		fields=["name", "tds_item_name", "tds_make", "tds_category", "tds_status", "tds_attachment"],
		order_by="tds_category asc, tds_item_name asc",
	)
	shared = package_is_shared(system.work_package)
	return [i for i in items if sources.tds_belongs(i.tds_category, i.tds_item_name, system.keywords, shared)]


def snag_batches(project: str) -> list:
	"""The project's snag batches with ALL their snags, newest first.

	The WHOLE list is handed over, whatever each snag's status (owner 2026-09-25, replacing the
	completed-only rule of 2026-09-23): the open items are the point of giving the client a snag list.
	So `count` counts every snag in the batch, and the printed list is unfiltered too
	(`binder._content_steps` sends no `statuses` to the Snag List format) -- what prints is what the
	count promises. Only a batch holding no snags at all is left out, having nothing to print.
	"""
	rows = frappe.db.sql(
		"""
		select b.name, b.batch_name, b.uploaded_on, count(s.name) as total
		from "tabProject Snag Batch" b
		left join "tabProject Snag" s on s.batch = b.name
		where b.project = %(project)s
		group by b.name, b.batch_name, b.uploaded_on
		order by b.uploaded_on desc, b.name desc
		""",
		{"project": project},
		as_dict=True,
	)
	return [
		frappe._dict(
			name=r.name,
			batch_name=r.batch_name or r.name,
			uploaded_on=r.uploaded_on,
			count=r.total,
		)
		for r in rows
		if r.total
	]


def snag_summary(project: str) -> dict:
	rows = frappe.db.sql(
		"""select coalesce(status, 'Pending') as status, count(*) as n from "tabProject Snag"
		   where project = %s group by 1""",
		(project,),
		as_dict=True,
	)
	by_status = {r.status: r.n for r in rows}
	return {"total": sum(by_status.values()), "by_status": by_status}


def design_handover_tasks(project: str, system) -> list:
	"""The FINISHED Design Tracker tasks in the Handover phase for this system (the as-built layouts).

	Submitted / Approved only (owner 2026-09-23); a drawing still in progress is not part of the handover."""
	rows = frappe.db.sql(
		"""
		select t.name, t.parent, t.design_category, t.task_name, t.task_status, t.file_link,
		       t.approval_proof, t.task_zone
		from "tabDesign Tracker Task Child Table" t
		join "tabProject Design Tracker" d on d.name = t.parent
		where d.project = %s and t.parenttype = 'Project Design Tracker' and t.task_phase = 'Handover'
		order by t.design_category, t.idx
		""",
		(project,),
		as_dict=True,
	)
	cats = frappe.get_all("Design Tracker Category", fields=["name", "work_package"])
	systems = frappe.get_all("HOD System", fields=["name", "work_package"])
	own = {c.name for c in cats if sources.design_category_belongs(c.name, c.work_package, system.name, system.work_package)}
	claimed = {
		c.name for c in cats for s in systems if sources.design_category_belongs(c.name, c.work_package, s.name, s.work_package)
	}
	out = []
	for r in rows:
		if not sources.design_is_done(r.task_status):
			continue
		r.download_url = sources.drawing_download_url(r.file_link)
		if r.design_category in own:
			if sources.matches_keywords(r.task_name, system.keywords):
				out.append(r)
		elif r.design_category not in claimed and system.keywords and sources.matches_keywords(r.task_name, system.keywords):
			# A category no system claims (ELV, BMS, Overall Project): the system's keywords decide.
			out.append(r)
	return out


def sources_for(project: str, hod_system: str, document: str) -> dict:
	"""What a from-app handover document reads, as {"source", "items" | "summary"}."""
	entry = index.get(document)
	if not entry or entry["kind"] != index.FROM_APP:
		frappe.throw(f"{document} is not read from the app.")
	system = system_meta(hod_system)
	src = entry["source"]
	if src == index.SRC_COMMISSION:
		return {"source": "Project Commission Report", "items": commission_tasks(project, system, entry["bucket"])}
	if src == index.SRC_TDS:
		return {"source": "Project TDS Item List", "items": tds_items(project, system)}
	if src == index.SRC_SNAG:
		return {"source": "Project Snag", "summary": snag_summary(project), "items": snag_batches(project)}
	return {"source": "Design Tracker", "items": design_handover_tasks(project, system)}


@frappe.whitelist()
def get_from_app_sources(project: str, hod_system: str, document: str) -> dict:
	"""The records a from-app handover document shows. Read-only."""
	if not frappe.has_permission("Projects", "read", doc=project):
		raise frappe.PermissionError
	return sources_for(project, hod_system, document)


def included_library(project: str, hod_system: str, library_document: str, form_data) -> list:
	"""The library blocks a row prints: its saved picks, else the default from the project's Commission
	Report categories (see `sources.default_included`)."""
	contents = frappe.get_all(
		"HOD Library Content",
		filters={"hod_system": hod_system, "document": library_document},
		fields=["name", "sub_system", "title", "content", "list_1", "list_2", "display_order"],
		order_by="display_order asc, creation asc",
	)
	if len(contents) <= 1:
		return contents
	picks = as_dict(form_data).get("included")
	if isinstance(picks, list):
		keep = {str(p) for p in picks}
		return [c for c in contents if (c.sub_system or "all") in keep]
	default = set(sources.default_included([c.sub_system for c in contents], commission_categories(project)))
	return [c for c in contents if c.sub_system in default]
