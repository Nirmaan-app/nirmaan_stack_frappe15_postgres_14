# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which stakeholder logos head this project's handover documents (the tab's "Header logos" dialog).

The CHOICE is one `Project HOD Setting` row per project, named after the project. The names and logos
themselves are NOT copied here: they stay in `Project TDS Setting` and are read fresh, so a logo
replaced there shows on the next print with nothing to re-save. The rule for which roles may be picked
is the pure `services/hod/header_logos`.

Thin orchestrator (ADR-0010 B4): permission, read, call the rule, persist, return the same shape the
dialog opened with.
"""

import frappe
from frappe import _

from nirmaan_stack.services.hod import header_logos

SETTING = "Project HOD Setting"
TDS_SETTING = "Project TDS Setting"
ROW_DOCTYPE = "Project HOD Document"

# Every name / logo field the rule reads, asked for in one go.
_TDS_FIELDS = sorted({f for _label, name_f, logo_f in header_logos.ROLES.values() for f in (name_f, logo_f)})


def _require_project(project: str):
	if not project or not frappe.db.exists("Projects", project):
		frappe.throw(_("Project not found."))
	if not frappe.has_permission("Projects", "read", doc=project):
		raise frappe.PermissionError(_("Not permitted to read this project."))


def tds_setting(project: str) -> tuple:
	"""(name, fields) of the project's TDS Setting -- (None, {}) when it has none."""
	name = frappe.db.get_value(TDS_SETTING, {"tds_project_id": project}, "name")
	if not name:
		return None, {}
	return name, (frappe.db.get_value(TDS_SETTING, name, _TDS_FIELDS, as_dict=True) or {})


def stored_roles(project: str) -> str:
	"""The project's stored pick. Absent row = blank = every selectable role prints."""
	return frappe.db.get_value(SETTING, project, "header_roles") or ""


def header_context(project: str, document: str) -> dict:
	"""What a print format needs for one document: the letterhead flag, or the logos to print."""
	if header_logos.uses_letterhead(document):
		return {"letterhead": True, "logos": []}
	_name, fields = tds_setting(project)
	return {"letterhead": False, "logos": header_logos.header_logos(fields, stored_roles(project))}


def _payload(project: str) -> dict:
	name, fields = tds_setting(project)
	usable = header_logos.selectable(fields)
	return {
		"roles": [
			{
				"role": role,
				"label": header_logos.ROLES[role][0],
				"name": (fields.get(header_logos.ROLES[role][1]) or "").strip(),
				"logo": (fields.get(header_logos.ROLES[role][2]) or "").strip(),
				"selectable": role in usable,
			}
			for role in header_logos.ROLE_ORDER
		],
		# What WILL print -- the pick narrowed to what is still selectable, or everything when blank.
		"selected": [r["role"] for r in header_logos.header_logos(fields, stored_roles(project))],
		# So the dialog can send the user to the right place to fix a missing name or logo.
		"tds_setting": name,
		"order": list(header_logos.ROLE_ORDER),
	}


@frappe.whitelist()
def get_header_roles(project: str) -> dict:
	"""The six roles with their name / logo / whether they can be picked, and what prints today."""
	_require_project(project)
	return _payload(project)


@frappe.whitelist(methods=["POST"])
def set_header_roles(project: str, roles) -> dict:
	"""Store the project's pick. An empty list is meaningful: it means "print everything eligible"."""
	_require_project(project)
	if not frappe.has_permission(ROW_DOCTYPE, "write"):
		raise frappe.PermissionError(_("Not permitted to change this project's handover documents."))
	if isinstance(roles, str):
		roles = frappe.parse_json(roles)

	picked = header_logos.valid_roles(roles)
	_name, fields = tds_setting(project)
	refused = [r for r in picked if r not in header_logos.selectable(fields)]
	if refused:
		frappe.throw(
			_("{0} cannot be picked: this project's TDS Setting needs both a name and a logo for it.").format(
				", ".join(header_logos.ROLES[r][0] for r in refused)
			)
		)

	value = "\n".join(picked)
	if frappe.db.exists(SETTING, project):
		doc = frappe.get_doc(SETTING, project)
		doc.header_roles = value
		doc.save()
	else:
		frappe.get_doc({"doctype": SETTING, "project": project, "header_roles": value}).insert()
	frappe.db.commit()
	return _payload(project)
