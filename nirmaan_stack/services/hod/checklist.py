# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Rules over one system's 16 checklist rows. PURE -- rows come in as plain dicts.

A row dict carries the `Project HOD Document` fields: document, status, disabled, remarks, form_data.

The on/off switch (`disabled`) IS the checklist answer (owner 2026-10-06): switched ON = YES, the
document is on the printed checklist (which prints YES for every row it carries); switched OFF = NO, the
document is blocked, left out of the binder and REMOVED from the printed checklist with the S.No closed
up.

`status` is a different question -- how far the document's own work has got (Not Started / WIP / Done) --
and only a DONE document puts pages in the binder.
"""

import json

from nirmaan_stack.services.hod import index

# THE document's progress (owner 2026-10-06, replacing the hand-picked YES / NO / NA of 2026-09-24).
# Done is set by "Mark as Done" in the document's dialog (or an upload); WIP and Not Started are picked
# from the Status dropdown. Only DONE documents put pages in the binder.
STATUS_NOT_STARTED = "Not Started"  # the default a row is created with
STATUS_WIP = "WIP"
STATUS_DONE = "Done"
STATUSES = (STATUS_NOT_STARTED, STATUS_WIP, STATUS_DONE)

# The answers of 2026-09-24, should a row still carry one: YES -> Done; NO and NA -> Not Started.
# No patch converts them -- the feature was local only and its rows were cleared (owner 2026-10-06).
_LEGACY = {"YES": STATUS_DONE}
_BY_UPPER = {s.upper(): s for s in STATUSES}


def normalise_status(value) -> str:
	"""Any stored value -> one of the three statuses. THE reader, used by the controller, the tab's read
	and the binder, so a row can never show something that is not a status.

	A legacy YES reads as Done; anything else unrecognised -- a blank, NO, NA, or the older
	Pending / Form Filled / Completed -- reads as Not Started. The controller writes the healed value
	back on save -- it runs BEFORE Frappe's own Select check (`run_before_save_methods` precedes
	`_validate`).
	"""
	text = str(value or "").strip().upper()
	return _BY_UPPER.get(text) or _LEGACY.get(text) or STATUS_NOT_STARTED


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
	"""Has someone actually done this document? -- the ONE test behind the Done gate, asked of the
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
	document with a file and no ticked records may still be Done -- the file is its content.
	"""
	if not index.is_valid(document):
		return None
	data = _as_data(form_data)
	upload = data.get("upload") if isinstance(data, dict) else None
	url = upload.get("url") if isinstance(upload, dict) else None
	return url.strip() if isinstance(url, str) and url.strip() else None


def needs_saving(document: str) -> bool:
	"""Does this document have to be SAVED before it can be Done?

	Only a FROM NIRMAAN document does (owner 2026-09-28). What it hands over IS the records ticked on it
	-- reports, data sheets, snag batches, drawings -- so with none ticked there is no content and no
	pages to print.

	A FORM or a LIBRARY text does NOT. Its sheet prints from its OWN layout whether or not anyone typed
	in it -- a blank Key List or Attic Stock List is a real handover page, written in by hand on site --
	and a library text carries the library's content, edited centrally in Packages Settings. Holding
	either to a save left every document that needs no filling permanently un-answerable.

	An uploaded file counts as saved content (`is_saved`), so a From Nirmaan document with its own file can
	be Done without ticking records.
	"""
	entry = index.get(document) or {}
	return entry.get("kind") == index.FROM_APP


def can_be_done(document: str, form_data) -> bool:
	"""May this row be Done? A FROM NIRMAAN document must have its records ticked and saved, or a file
	uploaded (`needs_saving`); a form or a library text is ready as it stands, because its sheet prints
	from its own layout (owner 2026-09-28). WIP and Not Started are always allowed."""
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
	"""Progress over one system: Done / WIP / Not Started among switched-on rows; switched off.

	`completed` is the Done count, kept under its old name -- the screens and the tracker read it to say
	how far the handover has got. `needed` is the switched-on rows (the checklist's YES rows)."""
	out = {"completed": 0, "wip": 0, "not_started": 0, "off": 0}
	bucket = {STATUS_DONE: "completed", STATUS_WIP: "wip", STATUS_NOT_STARTED: "not_started"}
	for r in rows:
		if r.get("disabled"):
			out["off"] += 1
			continue
		out[bucket[normalise_status(r.get("status"))]] += 1
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

	Switched-off rows are left out (same numbering as the printed checklist). Every switched-on row is
	returned whatever its status; the binder keeps the Done ones (`is_done`).
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


def is_done(row) -> bool:
	"""Does this switched-on row put pages in the binder? Only a Done one does (owner 2026-10-06): a WIP or
	Not Started document stays on the printed checklist with no pages behind it."""
	return normalise_status(row.get("status")) == STATUS_DONE
