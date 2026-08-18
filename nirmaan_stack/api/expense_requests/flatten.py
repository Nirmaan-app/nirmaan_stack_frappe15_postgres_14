# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Turn a request's `source_data` answers into one readable line for the ledger row.

PURE MODULE: no `frappe`, no DB, no request context — so it is unit-testable on its own and
cannot acquire a dependency that drags the ledger write into a wider transaction.

The ledgers have no JSON column and are deliberately not being changed, so the structured
answers reach the accountant as prose. The full structure stays on the request, reachable
through `created_expense`.
"""

import json
import re
from datetime import date

SEP = " · "

# Keys of the response envelope that are METADATA, not answers. Emitting them would put
# `templateId: staff-accommodation-rent` in front of an accountant.
_ENVELOPE_KEYS = {
	"templateId", "templateVersion", "snapshotHash", "filledAt", "filledBy",
	"lastEditedAt", "prefillSnapshot", "attachments",
}


def _label_for(key: str, labels: dict) -> str:
	"""Prefer the format's own label; fall back to a readable version of the key."""
	return labels.get(key) or key.replace("_", " ").strip().title()


def build_label_map(source_format: str | dict | None) -> dict:
	"""`{field_key: label}` harvested from a format, so the flatten reads like the form did.

	Best-effort by design: an unparseable or absent format yields an empty map and every key
	falls back to a title-cased version of itself. A missing label must never cost the
	accountant the VALUE.
	"""
	if not source_format:
		return {}
	fmt = source_format
	if isinstance(fmt, str):
		try:
			fmt = json.loads(fmt)
		except ValueError:
			return {}
	if not isinstance(fmt, dict):
		return {}

	labels: dict = {}
	for section in fmt.get("sections") or []:
		if not isinstance(section, dict):
			continue
		for f in section.get("fields") or []:
			if isinstance(f, dict) and f.get("key"):
				labels[f["key"]] = f.get("label") or f["key"]
		for s in section.get("slots") or []:
			if isinstance(s, dict) and s.get("key"):
				labels[s["key"]] = s.get("label") or s["key"]
		for item in section.get("items") or []:
			if isinstance(item, dict) and item.get("id"):
				labels[item["id"]] = item.get("particular") or item["id"]
	return labels


def _render(value) -> str | None:
	"""One answer as text, or None when there is nothing worth printing.

	A blank string and None are both dropped. **Zero and False are NOT** — a recorded 0 is an
	answer, and dropping it would silently misreport the request.
	"""
	if value is None:
		return None
	if isinstance(value, bool):
		return "Yes" if value else "No"
	if isinstance(value, str):
		v = value.strip()
		return v or None
	if isinstance(value, (list, tuple)):
		parts = [p for p in (_render(v) for v in value) if p]
		return ", ".join(parts) or None
	if isinstance(value, dict):
		# A checklist answer is `{result, remarks}`; anything else is rendered generically.
		parts = [p for p in (_render(v) for v in value.values()) if p]
		return " / ".join(parts) or None
	return str(value)


def flatten_pairs(source_data, source_format=None) -> list[tuple[str, str]]:
	"""The same walk as `flatten_source_data`, but as (label, value) PAIRS.

	The reviewer's dialog needs the answers as a readable list, not a joined sentence, so the
	two share ONE walk rather than one parsing the other's output. `flatten_source_data` is
	now a join over this -- a second implementation is how the ledger description and the
	approval screen would come to disagree about the same request.
	"""
	if not source_data:
		return []
	data = source_data
	if isinstance(data, str):
		try:
			data = json.loads(data)
		except ValueError:
			return []
	if not isinstance(data, dict):
		return []

	labels = build_label_map(source_format)
	responses = data.get("responses")
	if responses is None:
		responses = {k: v for k, v in data.items() if k not in _ENVELOPE_KEYS}
	if not isinstance(responses, dict):
		return []

	out: list[tuple[str, str]] = []
	for section in responses.values():
		if isinstance(section, dict):
			for key, value in section.items():
				text = _render(value)
				if text:
					out.append((_label_for(key, labels), text))
		elif isinstance(section, list):
			for i, row in enumerate(section, start=1):
				text = _render(row)
				if text:
					out.append((f"Row {i}", text))
		else:
			text = _render(section)
			if text:
				out.append(("", text))
	return out


def flatten_source_data(source_data, source_format=None) -> str:
	"""`Label: value · Label: value` from the stored answers.

	Returns "" for absent, unparseable or empty answers — a format-less request must produce
	exactly the same description it would have produced before formats existed.
	"""
	# ONE walk, shared with `flatten_pairs` -- see the note there.
	return SEP.join(
		f"{label}: {value}" if label else value
		for label, value in flatten_pairs(source_data, source_format)
	)


def first_mapped_attachment(source_data, source_format=None) -> str | None:
	"""The file that should land on the ledger row's `invoice_attachment`.

	Declared, not conventional: a slot carries `"maps_to": "invoice_attachment"`. At most one
	slot per format may — two would make the winner a coin toss, so the FIRST declaring slot
	wins and the rest are ignored. A format declaring none contributes no file, which is
	honest rather than a silent pick-the-first.
	"""
	if not source_data or not source_format:
		return None
	fmt = source_format
	if isinstance(fmt, str):
		try:
			fmt = json.loads(fmt)
		except ValueError:
			return None
	data = source_data
	if isinstance(data, str):
		try:
			data = json.loads(data)
		except ValueError:
			return None
	if not isinstance(fmt, dict) or not isinstance(data, dict):
		return None

	attachments = data.get("attachments")
	if not isinstance(attachments, dict):
		return None

	for section in fmt.get("sections") or []:
		if not isinstance(section, dict):
			continue
		for slot in section.get("slots") or []:
			if not isinstance(slot, dict) or slot.get("maps_to") != "invoice_attachment":
				continue
			files = attachments.get(slot.get("key"))
			if isinstance(files, str) and files.strip():
				return files.strip()
			if isinstance(files, (list, tuple)):
				for f in files:
					if isinstance(f, str) and f.strip():
						return f.strip()
			return None
	return None


# --- Prose descriptions -------------------------------------------------------------

_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_PLACEHOLDER = re.compile(r"\{([A-Za-z0-9_]+)\}")
# `[[ ... ]]` marks a span that survives only if every answer inside it was given.
_OPTIONAL = re.compile(r"\[\[(.*?)\]\]", re.S)
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _as_dict(value):
	"""A JSON string or a dict as a dict, or None. Best-effort, like everything here."""
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except ValueError:
			return None
	return value if isinstance(value, dict) else None


def flat_responses(source_data) -> dict:
	"""Every answer as one flat `{key: value}` map, sections collapsed.

	A template addresses answers BY KEY, so which section a key sits in is irrelevant to
	it — unlike `flatten_pairs`, which walks section by section precisely to keep the
	ledger line in form order. List-valued sections are SKIPPED: a repeating table has no
	keys, so there is nothing a `{placeholder}` could name.
	"""
	data = _as_dict(source_data)
	if not data:
		return {}

	responses = data.get("responses")
	if responses is None:
		responses = {k: v for k, v in data.items() if k not in _ENVELOPE_KEYS}
	if not isinstance(responses, dict):
		return {}

	out: dict = {}
	for section in responses.values():
		if isinstance(section, dict):
			out.update(section)
	return out


def _prose_value(value) -> str | None:
	"""One answer as it should read INSIDE A SENTENCE.

	Exactly one thing differs from `_render`: an ISO date becomes `1 Aug 2026`. A
	template exists to stop the ledger reading like a form dump, and `2026-08-01` reads
	like a form dump.
	"""
	if isinstance(value, str):
		v = value.strip()
		if _ISO_DATE.fullmatch(v):
			try:
				d = date.fromisoformat(v)
			except ValueError:
				return v
			return f"{d.day} {_MONTHS[d.month - 1]} {d.year}"
	return _render(value)


def _tidy(text: str) -> str:
	"""Close the gaps a dropped span leaves behind."""
	text = re.sub(r"\s+", " ", text)
	text = re.sub(r"\s+([,.;:])", r"\1", text)
	text = re.sub(r",\s*([,.])", r"\1", text)
	return text.strip()


def render_description_template(source_data, source_format=None) -> str:
	"""The format's own sentence, filled in — or "" to fall back to the flatten.

	The template is CONFIG, living beside the fields it names (`description_template` on
	the format), so making a type read well is an edit to that type and touches no code.

	Two placeholder kinds, and the difference is the whole safety story:
	  `{key}`        REQUIRED — no answer means the sentence has a hole in it, so the
	                 WHOLE render is abandoned and the caller falls back to the labelled
	                 flatten. A half-written sentence on a ledger row is worse than a
	                 form dump, because it reads as complete.
	  `[[…{key}…]]`  OPTIONAL — the span is dropped whole when any answer inside it is
	                 missing, which is what keeps a skipped field from leaving ", ," behind.

	Returns "" for an absent or unusable template, so a format that declares none produces
	EXACTLY the description it produced before templates existed.
	"""
	fmt = _as_dict(source_format)
	template = ((fmt or {}).get("description_template") or "").strip()
	if not template:
		return ""

	answers = flat_responses(source_data)
	if not answers:
		return ""

	missing = False

	def fill(match):
		nonlocal missing
		text = _prose_value(answers.get(match.group(1)))
		if not text:
			missing = True
			return ""
		return text

	def optional(match):
		nonlocal missing
		outer, missing = missing, False
		rendered = _PLACEHOLDER.sub(fill, match.group(1))
		dropped, missing = missing, outer
		return "" if dropped else rendered

	body = _PLACEHOLDER.sub(fill, _OPTIONAL.sub(optional, template))
	return "" if missing else _tidy(body)
