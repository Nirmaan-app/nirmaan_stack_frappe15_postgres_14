# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Library documents set in the most spacious layout their pages fit -- the O&M Manual and the Do's & Don'ts.

The owner's reference manuals are not all set the same way (measured 2026-10-06): ACS and Networking are
large type with a blank line round every heading, FAS is the same type with tighter spacing, and
Electrical is small and dense -- its page 2 has no room to spare even in our compact setting. Each fills
its pages down to the box. One setting cannot be all of them, and wkhtmltopdf runs with JavaScript off
(`frappe.utils.pdf`), so a page cannot measure itself.

The Do's & Don'ts follow one rule across every reference: large type, a blank line between items, ONE page
where both lists fit (ACS, HVAC, PAS, ...), and the Do's on one page with the Don'ts on the next where they
do not (Sprinkler, WLD, RRS) -- every page a full box, the title on the first only.

So the PDF is measured instead. A block is rendered in the first layout of its document's ladder
(`LADDERS`); the PDF is read back, and a block whose pages did not each print on ONE sheet moves to the
next layout and is rendered again, down to compact -- the layout every page was laid out against. One
render per layout tried. An O&M manual only climbs the ladder when its text marks its pages: without
markers it flows across sheets anyway, so it renders once, compact, exactly as before.
"""

import io

import frappe
from pypdf import PdfReader

from nirmaan_stack.api.hod.from_app import included_library
from nirmaan_stack.api.hod.print_context import LAYOUT_FLAG
from nirmaan_stack.api.hod.project_info import as_dict
from nirmaan_stack.services.hod import blanks, checklist, index, pages

# Most spacious first, per `services/hod/index` document key. Each layout is a rule set in
# `hod-document.html` (`.hd-om-<layout>`, `.hd-dd-<layout>`); past the last, compact.
LADDERS = {
	"om_manual": ("roomy", "medium"),
	# "one-*" keeps both lists on one sheet, "split-*" gives the Don'ts a sheet of their own.
	"dos_donts": ("one-roomy", "one-medium", "split-roomy", "split-medium"),
}
LIBRARY = {"om_manual": index.LIB_OM, "dos_donts": index.LIB_DOS}

# The documents laid out this way, like `page_frame.FRAMED`.
FITTED = tuple(LADDERS)

# The pictures page that follows the manual -- `hod-document.html` prints this title above them.
PICTURES_TITLE = "Operations & Maintenance Manual - Pictures"
# What opens a Do's & Don'ts sheet of its own for the Don'ts -- the template's heading.
DONTS_HEADING = "Don't:"


def needs_fit(document: str) -> bool:
	return document in FITTED


def _om_blocks(doc) -> list:
	"""Every printed block's page starts, as `pages.overflowing` reads them -- text only, no pictures fetched."""
	fd = as_dict(doc.form_data)
	values = fd.get("blanks") if isinstance(fd.get("blanks"), dict) else {}
	out = []
	for c in included_library(doc.project, doc.hod_system, index.LIB_OM, doc.form_data):
		pieces = pages.split_pages(blanks.fill_blanks(c.content, values))
		# The first page opens with the block's title band, every later one with its own first text.
		starts = [pages.start_key(c.title)] + [pages.start_key(p) for p in pieces[1:]]
		out.append({"name": c.name, "starts": starts, "fits": len(starts) > 1})
	if fd.get("pictures"):
		out.append({"name": None, "starts": [pages.start_key(PICTURES_TITLE)], "fits": False})
	return out


def _dd_blocks(doc, layouts: dict) -> list:
	"""The Do's & Don'ts blocks' page starts under `layouts`: the title, and -- split -- the Don'ts sheet."""
	out = []
	for c in included_library(doc.project, doc.hod_system, index.LIB_DOS, doc.form_data):
		starts = [pages.start_key(c.title)]
		donts = checklist.parse_lines(c.list_2)
		if str(layouts.get(c.name) or "").startswith("split") and donts:
			# The list is an <ol>: its "1." is printed text, so the sheet reads "Don't: 1. <first item>".
			starts.append(pages.start_key(f"{DONTS_HEADING} 1. {donts[0]}"))
		out.append({"name": c.name, "starts": starts, "fits": True})
	return out


# The lowest a Do's & Don'ts line may print, in mm from the page top. The box's bottom rule sits at
# 297 - 19 = 278mm (`page_frame.MARGIN_BOTTOM`, the `.hd-sheet` box); the sheet's padding keeps text
# ~5mm inside it on every sheet that is not overfull.
BOX_TEXT_LIMIT_MM = 272.5
_MM_PER_PT = 25.4 / 72


def _mult(m, n):
	# A PDF text matrix times the current transformation matrix (both [a b c d e f]).
	return [
		m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
		m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
		m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
	]


def _page_marks(pdf: bytes) -> tuple[list, list]:
	"""(start key, lowest text line in mm from the top) of every printed page that holds text."""
	keys, bottoms = [], []
	for p in PdfReader(io.BytesIO(pdf)).pages:
		# LAYOUT mode, in reading order. The default mode follows wkhtmltopdf's content stream, which
		# writes a page's bold runs before its regular text -- measured: "3.2 Access Control Panel 3.3
		# 4-Door Controller ..." for a page whose second line is a bullet -- so the page never matched.
		key = pages.start_key(p.extract_text(extraction_mode="layout") or "")
		if not key:
			continue
		ys = []

		def collect(text, cm, tm, _font, _size):
			if text.strip():
				ys.append(_mult(tm, cm)[5])

		p.extract_text(visitor_text=collect)
		height = float(p.mediabox.height)
		keys.append(key)
		bottoms.append((height - min(ys)) * _MM_PER_PT if ys else 0.0)
	return keys, bottoms


def _render_with(layouts: dict, render_fn) -> bytes:
	frappe.flags[LAYOUT_FLAG] = layouts
	try:
		return render_fn()
	finally:
		frappe.flags.pop(LAYOUT_FLAG, None)


def render(doc, render_fn) -> bytes:
	"""`render_fn()` -> the "HOD Document" PDF of `doc`, each block in the most spacious layout it fits.

	`render_fn` must render afresh on every call (drop the Jinja cache), since the layout is read when
	the template runs. Blocks start on a page of their own, so each one's fit is its own: a block that
	fits stays where it is while another moves on."""
	ladder = LADDERS[doc.document]
	strict = doc.document == "dos_donts"

	def blocks_for(layouts):
		return _dd_blocks(doc, layouts) if strict else _om_blocks(doc)

	step = {b["name"]: 0 for b in blocks_for({}) if b["name"] and b["fits"]}  # index into the ladder
	while True:
		layouts = {name: ladder[i] for name, i in step.items() if i < len(ladder)}
		pdf = _render_with(layouts, render_fn)
		if not layouts:
			return pdf
		try:
			keys, bottoms = _page_marks(pdf)
			# The Do's & Don'ts draw their own box per sheet, and it grows with its text -- so their lines
			# must also stay above the box line. The O&M's box is stamped on; its page margin already
			# stops the text above it.
			spilled = pages.overflowing(
				blocks_for(layouts), keys, strict=strict,
				bottoms=bottoms if strict else None, limit=BOX_TEXT_LIMIT_MM,
			) & set(layouts)
		except Exception:
			# A PDF that cannot be read back is not known to fit: go straight to compact, which every
			# page was laid out against.
			frappe.log_error(title="HOD library layout: page fit not measured", message=frappe.get_traceback())
			return _render_with({}, render_fn)
		if not spilled:
			return pdf
		for name in spilled:
			step[name] += 1
