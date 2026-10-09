# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""`[Blank Name]` placeholders in library text. PURE.

The owner's O&M manuals mark the words a project must supply with square brackets, e.g.
"... the HVAC ducting system in [Facility Name]." The library keeps the text as written; each project
stores only its values (`Project HOD Document.form_data.blanks`), and they are filled in when the page
is shown or printed. An unfilled blank is printed as written, so a missing value stays visible.
"""

import html
import re

# A blank is 2-80 characters between single square brackets, never spanning a line or a tag.
BLANK_RE = re.compile(r"\[([^\[\]\n<>]{2,80})\]")


def find_blanks(text) -> list:
	"""The blank names in `text`, each once, in first-seen order."""
	seen = []
	for m in BLANK_RE.finditer(str(text or "")):
		name = m.group(1).strip()
		if name and name not in seen:
			seen.append(name)
	return seen


def fill_blanks(text, values, escape: bool = True) -> str:
	"""Replace every `[Name]` that has a non-empty value; leave the rest exactly as written.

	`escape=True` (the default) HTML-escapes the value, because the library text is HTML.
	"""
	values = values or {}

	def _sub(m):
		value = values.get(m.group(1).strip())
		if value is None or str(value).strip() == "":
			return m.group(0)
		value = str(value).strip()
		return html.escape(value) if escape else value

	return BLANK_RE.sub(_sub, str(text or ""))
