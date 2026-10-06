# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rules over one system's 16 checklist rows. PURE -- rows come in as plain dicts.

A row dict carries the `Project HOD Document` fields: document, status, disabled, remarks, form_data.

The on/off switch (`disabled`) is the ONLY "not needed" mechanism (owner, 2026-09-21): a switched-off
document is blocked, left out of the binder, and REMOVED from the printed checklist with the S.No
closed up -- it is never printed as "NA".
"""

import json

from nirmaan_stack.services.hod import index

# THE handover checklist answer, picked BY HAND (owner 2026-09-24, replacing the derived
# Pending / Form Filled / Completed). It is what the printed checklist shows and what the binder
# takes: only YES documents go in.
STATUS_YES = "YES"  # handed over
STATUS_NO = "NO"  # not handed over (the default a row is created with)
STATUS_NA = "NA"  # not applicable to this project
STATUSES = (STATUS_YES, STATUS_NO, STATUS_NA)


def normalise_status(value) -> str:
	"""Any stored value -> one of the three answers. THE reader, used by the controller, the tab's read
	and the printed checklist, so a row can never show or print something that is not an answer.

	Anything unrecognised becomes NO. That covers blanks and, in particular, the RETIRED
	Pending / Form Filled / Completed: rows carrying those read as NO at once and are written back as NO
	the next time they are saved, so no backfill script is needed (owner 2026-09-24 -- localhost only,
	the feature has not gone live). The controller runs BEFORE Frappe's own Select check
	(`run_before_save_methods` precedes `_validate`), which is what lets the heal land in time.
	"""
	answer = str(value or "").strip().upper()
	return answer if answer in STATUSES else STATUS_NO


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


# Keys `form_data` carries for the screen's own bookkeeping rather than as something a user entered.
# `is_saved` must not count them, or ticking a box would make an empty form look filled.
_META_KEYS = ("completed",)


def is_saved(form_data) -> bool:
	"""Has someone actually done this document? -- the ONE test behind the YES gate, asked of the
	documents `needs_saving` covers.

	It reads the same for all three kinds, because each stores what it collects in `form_data`:
	a FORM keeps its entries, a LIBRARY text keeps the parts it includes, a FROM NIRMAAN document
	keeps the records ticked for the handover. So "saved" is simply: `form_data` holds something a
	person put there, ignoring the screen's own bookkeeping keys.
	"""
	data = _as_data(form_data)
	if isinstance(data, dict):
		data = {k: v for k, v in data.items() if k not in _META_KEYS}
	return has_user_input(data)


def uploaded_file(document: str, form_data) -> str | None:
	"""The file a project uploaded to REPLACE what Nirmaan generates for this document, or None.

	THE reader of `form_data.upload` (`{"url", "file_name"}`), used by the binder and the single-document
	PDF. Every document may carry one (owner 2026-10-06). Mirrored by `hodRules.uploadedFile`.

	An upload also counts as the document being SAVED (`is_saved` sees it as user input), so a From Nirmaan
	document with a file and no ticked records may still be answered YES -- the file is its content.
	"""
	if not index.is_valid(document):
		return None
	data = _as_data(form_data)
	upload = data.get("upload") if isinstance(data, dict) else None
	url = upload.get("url") if isinstance(upload, dict) else None
	return url.strip() if isinstance(url, str) and url.strip() else None


def needs_saving(document: str) -> bool:
	"""Does this document have to be SAVED before it can be called handed over?

	Only a FROM NIRMAAN document does (owner 2026-09-28). What it hands over IS the records ticked on it
	-- reports, data sheets, snag batches, drawings -- so with none ticked there is no content and no
	pages to print.

	A FORM or a LIBRARY text does NOT. Its sheet prints from its OWN layout whether or not anyone typed
	in it -- a blank Key List or Attic Stock List is a real handover page, written in by hand on site --
	and a library text carries the library's content, edited centrally in Packages Settings. Holding
	either to a save left every document that needs no filling permanently un-answerable.

	This is NOT "has something to fill": that is `index`'s own `fill` flag, which still decides whether a
	row gets an editor (frontend `hodRules.hasEditor`).
	"""
	entry = index.get(document) or {}
	return entry.get("kind") == index.FROM_APP


def can_be_yes(document: str, form_data) -> bool:
	"""May this row be set to YES? A FROM NIRMAAN document must have its records ticked and saved
	(`needs_saving`); a form or a library text is ready as it stands, because its sheet prints from its
	own layout (owner 2026-09-28). NO and NA are always allowed -- a document nobody will ever fill must
	still be markable NA."""
	return is_saved(form_data) if needs_saving(document) else True


def is_untouched(row: dict, default_disabled: bool) -> bool:
	"""True while nothing on the row differs from how "+ Add system" created it. Removing a system whose
	rows are not all untouched asks the user first (the entries are lost)."""
	return (
		bool(row.get("disabled")) == bool(default_disabled)
		and not (row.get("remarks") or "").strip()
		and not has_user_input(row.get("form_data"))
	)


def counts(rows) -> dict:
	"""Progress over one system: YES / NO / NA among switched-on rows; switched off.

	`completed` is kept as the YES count under its old name -- the screens and the printed checklist
	read it to say how far the handover has got."""
	out = {"completed": 0, "no": 0, "na": 0, "off": 0}
	for r in rows:
		if r.get("disabled"):
			out["off"] += 1
			continue
		status = normalise_status(r.get("status"))
		out["completed" if status == STATUS_YES else "na" if status == STATUS_NA else "no"] += 1
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


# How the binder takes each switched-on document (owner rulings 2026-09-21; the uploaded-copy part was
# retired with the upload itself on 2026-09-24). The upload that came back on 2026-10-06 is NOT a part of
# its own: a row keeps its kind's part, and the binder takes the file from `uploaded_file` instead.
PART_PAGE = "page"  # the "HOD Document" print of the row
PART_SOURCES = "sources"  # the records the document reads from Nirmaan (no index page since 2026-09-25)


def binder_parts(rows) -> list:
	"""The binder's sections after the cover + checklist: `[(sno, row, part), ...]` in checklist order.

	Switched-off rows are left out (same numbering as the printed checklist).
	"""
	out = []
	for sno, r in printable_rows(rows):
		entry = index.get(r.get("document"))
		if entry["kind"] == index.FROM_APP:
			part = PART_SOURCES
		else:
			part = PART_PAGE
		out.append((sno, r, part))
	return out
