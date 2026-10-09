# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""4 Material Data Sheet, as the binder puts it in: the project's OWN TDS report.

The handover screen opens the TDS tab's "Confirm TDS Export" dialog and exports through
`api/tds/tds_report.export_tds_report`. The binder now builds the SAME document with the SAME
renderer (`build_tds_report_pdf`) -- it used to staple the loose data sheets behind an HOD list page,
so the handover pack and a download from the dialog were two different documents.

The filters the dialog applies on screen are applied here instead, from the row itself:
    package + `HOD System.source_keywords`  ->  `from_app.tds_items` (the system's own items)
    the ticks saved on the row              ->  `form_data.selected` (absent = all of them)
and the stakeholder cover comes from the project's `Project TDS Setting`, mapped exactly as the
frontend maps it (`frontend/src/pages/projects/data/tds/tdsSettings.ts` -- keep the two in step; three
of the field names are misspelled in the doctype and are load-bearing).
"""

import json

import frappe

from nirmaan_stack.api.hod.from_app import tds_items
from nirmaan_stack.api.hod.project_info import as_dict
from nirmaan_stack.api.tds.client_status import CLIENT_STATUS_REJECTED
from nirmaan_stack.api.tds.tds_report import build_tds_report_pdf

SETTING = "Project TDS Setting"

# role in the report's payload -> (name field, logo field, enabled field) on `Project TDS Setting`.
_ROLES = {
	"client": ("client_name", "client_logo", "enable_client"),
	"projectManager": ("manager_name", "mananger_logo", "enable_manager"),
	"architect": ("architect_name", "architect_logo", "enable_architect"),
	"consultant": ("data_tjxu", "consultant_logo", "enable_consultant"),
	"gcContractor": ("gc_contractor_name", "gc_contractor_logo", "enable_gc_contractor"),
	"mepContractor": ("mep_contractor_name", "mep_contractorlogo", "enable_mep_contractor"),
}


def report_settings(project: str) -> dict | None:
	"""The project's six stakeholder cards, or None when its TDS Repository was never set up."""
	name = frappe.db.get_value(SETTING, {"tds_project_id": project}, "name")
	if not name:
		return None
	doc = frappe.db.get_value(
		SETTING, name, [f for fields in _ROLES.values() for f in fields], as_dict=True
	)
	return {
		role: {
			"name": doc.get(name_field) or "",
			"logo": doc.get(logo_field) or None,
			"enabled": bool(doc.get(enabled_field)),
		}
		for role, (name_field, logo_field, enabled_field) in _ROLES.items()
	}


def report_items(project: str, system, form_data) -> list:
	"""The FULL rows the report prints: the system's own items, narrowed to the ticked ones.

	`tds_items` answers WHICH items belong to the system (one rule, shared with the screen); the report
	template reads more fields than the screen does, so they are read again in full for the ones that
	survive both filters.

	Saved ticks print in the order they were saved, which is the Download TDS PDF dialog's print order.
	A *Rejected by Client* row never prints, even under a tick saved before the client rejected it."""
	mine = tds_items(project, system)
	selected = as_dict(form_data).get("selected")
	names = [i.name for i in mine]
	if isinstance(selected, list):
		mine_names = set(names)
		names = list(dict.fromkeys(str(s) for s in selected if str(s) in mine_names))
	if not names:
		return []
	rows = frappe.get_all(
		"Project TDS Item List",
		filters={"name": ["in", names], "client_status": ["!=", CLIENT_STATUS_REJECTED]},
		fields=["*"],
	)
	order = {n: i for i, n in enumerate(names)}
	rows.sort(key=lambda r: order.get(r.name, len(order)))
	# The dialog posts rows that have been through JSON; `fields=["*"]` hands back `datetime`s, which the
	# report's own json.dumps refuses. Round-tripping here keeps the renderer untouched for both callers.
	return json.loads(frappe.as_json(rows))


def build_pack(project: str, hod_system: str, form_data) -> bytes:
	"""The binder's Material Data Sheet section. Raises when there is nothing to print -- the binder
	names the document and stops, exactly as it does for every other empty document."""
	from nirmaan_stack.api.hod.from_app import system_meta

	items = report_items(project, system_meta(hod_system), form_data)
	if not items:
		raise ValueError(f"No TDS item to hand over for {hod_system} on {project}.")
	settings = report_settings(project)
	if settings is None:
		raise ValueError(f"{project} has no TDS Repository set up, so its TDS report cannot be built.")
	pdf, _failed = build_tds_report_pdf(settings, items)
	return pdf
