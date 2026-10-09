# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Matching rules for the documents HOD reads from existing features. PURE.

The database reads live in `api/hod/from_app.py`; the decisions -- which Commission Report task
belongs under which handover document, which system a task belongs to, which HVAC parts a project
starts with -- live here so they can be tested without a site.
"""

import re

_TRAINING_RE = re.compile(r"training", re.IGNORECASE)
_FACTORY_RE = re.compile(r"factory\s*test", re.IGNORECASE)


def commission_bucket(task_name) -> str:
	"""Which handover document a Commission Report task is filed under.

	"training" -> 2 Demo & Training Certificate; "factory_test" -> 14 Factory Test Reports; every other
	task (commissioning reports AND the other test reports -- Earthing, Megger, pressure tests ...)
	-> 3 Commissioning Report (plan default: the other test reports are listed there).
	"""
	name = str(task_name or "")
	if _TRAINING_RE.search(name):
		return "training"
	if _FACTORY_RE.search(name):
		return "factory_test"
	return "commissioning"


def matches_keywords(name, keywords) -> bool:
	"""True when `name` contains any keyword as a whole word or phrase (case-insensitive), or when there
	are no keywords.

	Keywords (`HOD System.source_keywords`) narrow what a system reads where one package holds several
	systems (Critical Room ELV = GSS, VESDA, WLD & RRS) or where a Design Tracker category is not linked
	to a package (the ELV layouts). Whole words, because the short system names are also word fragments:
	"FA" must match "FA Layout" but not "False ceiling".
	"""
	kws = [str(k).strip() for k in (keywords or []) if str(k).strip()]
	if not kws:
		return True
	text = str(name or "")
	return any(re.search(r"(?<![A-Za-z0-9])" + re.escape(k) + r"(?![A-Za-z0-9])", text, re.IGNORECASE) for k in kws)


def tds_belongs(category, item_name, keywords, package_shared: bool) -> bool:
	"""Does a TDS item belong to this system?

	TDS items are filed by Work Package only, and a TDS category is named after the PART ("IP Cameras",
	"Lock & Accessories", "Addressable Detectors"), not after the system -- so the system's keywords can
	only be asked where they have something to separate: a package SHARED by several HOD Systems
	(Critical Room ELV = GSS, VESDA, WLD & RRS, whose categories really are "RR", "WLD", "Vesda").

	On a package with one system every item is already that system's, and matching would throw most of
	them away ("IP Cameras" holds no "CCTV"), so the package filter stands alone.
	"""
	if not package_shared:
		return True
	return matches_keywords(category, keywords) or matches_keywords(item_name, keywords)


def default_included(sub_systems, categories) -> list:
	"""Which library parts a project starts with ticked, from its Commission Report categories.

	A part is ticked when its name appears in one of the project's category names ("Duct" in "HVAC
	Ducting", "VRF" and "DX" in "HVAC VRF/DX"). When no part appears in any category -- or the project
	has no categories yet -- every part is ticked. Only a default: the team can change the ticks.
	"""
	subs = [s for s in (sub_systems or []) if s]
	cats = " | ".join(str(c or "") for c in (categories or [])).lower()
	ticked = [s for s in subs if s.lower() in cats]
	return ticked or subs


# Only FINISHED reports and drawings belong in a handover pack (owner 2026-09-23): an unfinished one is
# still being worked on, so it is not offered for download and not counted as missing content.
#
# The SNAG LIST is the exception (owner 2026-09-25): a handover snag list carries the WHOLE list -- what
# is done and what is still open -- because the open items are exactly what the client is being handed.
# So no status filter is applied anywhere on the snag path.
COMMISSION_DONE = ("Submitted", "Client Accepted")  # approved report, and the client-signed one
DESIGN_DONE = ("Submitted", "Approved")  # the drawing has been issued


def commission_is_done(status) -> bool:
	return str(status or "").strip() in COMMISSION_DONE


def design_is_done(status) -> bool:
	return str(status or "").strip() in DESIGN_DONE


def selected_items(items, selected):
	"""The records a from-app document includes: the ones ticked on it, or all of them when nothing was
	ticked (`form_data.selected` absent). The printed list and the binder read this same rule, so the
	document's own page and the binder always agree about which records belong to it."""
	if not isinstance(selected, list):
		return list(items or [])
	keep = {str(s) for s in selected}
	return [i for i in (items or []) if str(i.get("name")) in keep]


# What the binder takes for one Commission Report task, best first.
COMMISSION_SIGNED = "signed"  # the client-signed copy in `approval_proof`
COMMISSION_REPORT = "report"  # the filled report, rendered with the Commission print format
COMMISSION_FILE = "file"  # an uploaded report file (`file_link`)


def commission_binder_source(task: dict):
	"""The binder's pick for one task, or None when the task has nothing to print yet."""
	if task.get("approval_proof"):
		return COMMISSION_SIGNED
	if task.get("has_report"):
		return COMMISSION_REPORT
	if task.get("file_link"):
		return COMMISSION_FILE
	return None


_DRIVE_ID = re.compile(r"drive\.google\.com/(?:file/d/|open\?id=|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]{10,})")
_STORED = ("/api/method/frappe_gcp_attachment.controller.generate_file", "/private/files/", "/files/")


def drawing_download_url(link) -> str | None:
	"""Where an As Built drawing can be downloaded from, or None when it cannot be fetched.

	The Design Tracker keeps Google Drive "view" links (shared with anyone who has the link): those are fetched
	from Drive's direct-download address, which also skips the "can't scan for viruses" page of large files.
	A file stored in Nirmaan is fetched as it is. Any other link is only listed, never merged."""
	link = str(link or "").strip()
	if not link:
		return None
	m = _DRIVE_ID.search(link)
	if m:
		return f"https://drive.usercontent.google.com/download?id={m.group(1)}&export=download&confirm=t"
	if link.startswith(_STORED):
		return link
	return None


def design_category_belongs(category, category_work_package, system_name, system_work_package) -> bool:
	"""Does a Design Tracker category hold this system's drawings?

	By its Work Package when the category has one; otherwise by name -- the system's name as a whole word in
	the category name ("Electrical" -> Electrical, "Fire Sprinkler" -> Sprinkler, "Data Networking" ->
	Networking). On this site no Design Tracker category carries a Work Package (checked 2026-09-22)."""
	if category_work_package:
		return category_work_package == system_work_package
	name = str(system_name or "").strip()
	return bool(name) and bool(
		re.search(rf"(?<![A-Za-z0-9]){re.escape(name)}(?![A-Za-z0-9])", str(category or ""), re.IGNORECASE)
	)
