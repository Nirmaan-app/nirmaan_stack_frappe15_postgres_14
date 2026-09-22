# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rules over one system's 16 checklist rows. PURE -- rows come in as plain dicts.

A row dict carries the `Project HOD Document` fields: document, status, disabled, remarks,
attachment, form_data.

The on/off switch (`disabled`) is the ONLY "not needed" mechanism (owner, 2026-09-21): a switched-off
document is blocked, left out of the binder, and REMOVED from the printed checklist with the S.No
closed up -- it is never printed as "NA".
"""

import json

from nirmaan_stack.services.hod import index

# Status is DERIVED from what was done on the row, never picked by hand (owner 2026-09-22):
STATUS_PENDING = "Pending"
STATUS_FILLED = "Form Filled"  # the form was saved -- only for documents with something to fill (`fill`)
STATUS_COMPLETED = "Completed"  # the signed copy is uploaded
STATUSES = (STATUS_PENDING, STATUS_FILLED, STATUS_COMPLETED)


def parse_lines(text) -> list:
	"""A Small Text "one entry per line" value -> its non-empty stripped lines, in order."""
	return [line.strip() for line in str(text or "").splitlines() if line.strip()]


def default_disabled_keys(text) -> set:
	"""`HOD System.default_disabled_documents` -> the valid document keys it names.

	Unknown lines are ignored rather than refused: the field is hand-edited in Desk, and a typo must
	not stop a system from being added. The field's Desk description lists the valid keys.
	"""
	return {k for k in parse_lines(text) if index.is_valid(k)}


def _as_data(value):
	if isinstance(value, str):
		try:
			return json.loads(value) if value.strip() else None
		except ValueError:
			return value
	return value


def has_user_input(value) -> bool:
	"""True when a stored form holds anything a user typed or picked (not just an empty shell like
	{"levels": [{}, {}, {}]})."""
	value = _as_data(value)
	if isinstance(value, dict):
		return any(has_user_input(v) for v in value.values())
	if isinstance(value, list | tuple):
		return any(has_user_input(v) for v in value)
	if isinstance(value, str):
		return bool(value.strip())
	if isinstance(value, bool):
		return value
	return value is not None


def derive_status(document: str, attachment, form_data) -> str:
	"""THE status rule: an uploaded signed copy completes the document; a saved form on a document that
	has something to fill makes it "Form Filled"; anything else is Pending."""
	if attachment:
		return STATUS_COMPLETED
	entry = index.get(document) or {}
	if entry.get("fill") and has_user_input(form_data):
		return STATUS_FILLED
	return STATUS_PENDING


def is_untouched(row: dict, default_disabled: bool) -> bool:
	"""True while nothing on the row differs from how "+ Add system" created it. Removing a system whose
	rows are not all untouched asks the user first (the entries are lost)."""
	return (
		bool(row.get("disabled")) == bool(default_disabled)
		and not (row.get("remarks") or "").strip()
		and not row.get("attachment")
		and not has_user_input(row.get("form_data"))
	)


def counts(rows) -> dict:
	"""Progress over one system: Completed / Form Filled / Pending among switched-on rows; switched off."""
	out = {"completed": 0, "filled": 0, "pending": 0, "off": 0}
	for r in rows:
		if r.get("disabled"):
			out["off"] += 1
			continue
		status = derive_status(r.get("document"), r.get("attachment"), r.get("form_data"))
		out["completed" if status == STATUS_COMPLETED else "filled" if status == STATUS_FILLED else "pending"] += 1
	out["needed"] = len(rows) - out["off"]
	return out


def printable_rows(rows) -> list:
	"""The rows the printed checklist and the binder show: switched-on only, in index order, with
	the S.No closed up. Returns `[(sno, row), ...]`."""
	by_key = {r.get("document"): r for r in rows}
	out = []
	for d in index.DOCUMENTS:
		r = by_key.get(d["key"])
		if r is None or r.get("disabled"):
			continue
		out.append((len(out) + 1, r))
	return out


# How the binder takes each switched-on document (owner rulings 2026-09-21).
PART_UPLOAD = "upload"  # the uploaded (signed) copy REPLACES everything generated for that document
PART_PAGE = "page"  # the "HOD Document" print of the row
PART_SOURCES = "sources"  # the "HOD Document" list page, then the records it lists


def binder_parts(rows) -> list:
	"""The binder's sections after the cover + checklist: `[(sno, row, part), ...]` in checklist order.

	Switched-off rows are left out (same numbering as the printed checklist). An uploaded copy always
	wins -- for a from-app document too, so a signed certificate is never followed by a duplicate of
	the reports it certifies.
	"""
	out = []
	for sno, r in printable_rows(rows):
		entry = index.get(r.get("document"))
		if r.get("attachment"):
			part = PART_UPLOAD
		elif entry["kind"] == index.FROM_APP:
			part = PART_SOURCES
		else:
			part = PART_PAGE
		out.append((sno, r, part))
	return out
