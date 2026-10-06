# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The O&M Manual set in the most spacious layout its pages fit.

The owner's reference manuals are not all set the same way (measured 2026-10-06): ACS and Networking are
large type with a blank line round every heading, FAS is the same type with tighter spacing, and
Electrical is small and dense -- its page 2 has no room to spare even in our compact setting. Each fills
its pages down to the box. One setting cannot be all of them, and wkhtmltopdf runs with JavaScript off
(`frappe.utils.pdf`), so a page cannot measure itself.

So the PDF is measured instead. A manual whose text marks its pages (`services/hod/pages`) is rendered in
the first of `LAYOUTS`; the PDF is read back, and a manual whose marked pages did not each print on ONE
sheet moves to the next layout and is rendered again, down to compact -- the layout every marked page was
laid out against. One render per layout tried, three at most, and only for a manual that marks pages: a
manual without markers flows across sheets anyway, so it renders once, compact, exactly as before.
"""

import io

import frappe
from pypdf import PdfReader

from nirmaan_stack.api.hod.from_app import included_library
from nirmaan_stack.api.hod.print_context import LAYOUT_FLAG
from nirmaan_stack.api.hod.project_info import as_dict
from nirmaan_stack.services.hod import blanks, index, pages

# The documents laid out this way. Keyed on `services/hod/index` document keys, like `page_frame.FRAMED`.
FITTED = ("om_manual",)

# Most spacious first; each is a `.hd-om-<layout>` rule set in `hod-document.html`. Past the last, compact.
LAYOUTS = ("roomy", "medium")

# The pictures page that follows the manual -- `hod-document.html` prints this title above them.
PICTURES_TITLE = "Operations & Maintenance Manual - Pictures"


def needs_fit(document: str) -> bool:
	return document in FITTED


def _blocks(doc) -> list:
	"""Every printed block's page starts, as `pages.overflowing` reads them -- text only, no pictures fetched."""
	fd = as_dict(doc.form_data)
	values = fd.get("blanks") if isinstance(fd.get("blanks"), dict) else {}
	out = []
	for c in included_library(doc.project, doc.hod_system, index.LIB_OM, doc.form_data):
		pieces = pages.split_pages(blanks.fill_blanks(c.content, values))
		# The first page opens with the block's title band, every later one with its own first text.
		starts = [pages.start_key(c.title)] + [pages.start_key(p) for p in pieces[1:]]
		out.append({"name": c.name, "starts": starts})
	if fd.get("pictures"):
		out.append({"name": None, "starts": [pages.start_key(PICTURES_TITLE)]})
	return out


def _page_keys(pdf: bytes) -> list:
	# LAYOUT mode, in reading order. The default mode follows wkhtmltopdf's content stream, which writes
	# a page's bold runs before its regular text -- measured: "3.2 Access Control Panel 3.3 4-Door
	# Controller ..." for a page whose second line is a bullet -- so the page never matched its text.
	keys = (pages.start_key(p.extract_text(extraction_mode="layout") or "") for p in PdfReader(io.BytesIO(pdf)).pages)
	return [k for k in keys if k]


def _render_with(layouts: dict, render_fn) -> bytes:
	frappe.flags[LAYOUT_FLAG] = layouts
	try:
		return render_fn()
	finally:
		frappe.flags.pop(LAYOUT_FLAG, None)


def render(doc, render_fn) -> bytes:
	"""`render_fn()` -> the "HOD Document" PDF of `doc`, each marked block in the most spacious layout it fits.

	`render_fn` must render afresh on every call (drop the Jinja cache), since the layout is read when
	the template runs. Blocks start on a page of their own, so each one's fit is its own: a block that
	fits stays where it is while another moves on."""
	blocks = _blocks(doc)
	step = {b["name"]: 0 for b in blocks if b["name"] and len(b["starts"]) > 1}  # index into LAYOUTS
	while True:
		layouts = {name: LAYOUTS[i] for name, i in step.items() if i < len(LAYOUTS)}
		pdf = _render_with(layouts, render_fn)
		if not layouts:
			return pdf
		try:
			spilled = pages.overflowing(blocks, _page_keys(pdf)) & set(layouts)
		except Exception:
			# A PDF that cannot be read back is not known to fit: go straight to compact, which every
			# marked page was laid out against.
			frappe.log_error(title="HOD O&M: page fit not measured", message=frappe.get_traceback())
			return _render_with({}, render_fn)
		if not spilled:
			return pdf
		for name in spilled:
			step[name] += 1
