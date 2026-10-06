# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The handover box, drawn on EVERY page of an already-rendered PDF.

The O&M Manual's box has to be a full-height rectangle on every page, whatever that page holds. The
owner's reference binder draws it that way -- its last page keeps the whole box while the text stops
80% down -- and "the border box every page, not based content" is the rule (owner 2026-09-28).

NO CSS reaches that in wkhtmltopdf, which paints everything against the content FLOW, and the flow ends
where the text ends. Four routes were measured before this module was written, so nobody retries them:

    a bordered table          its bottom rule draws on the LAST FRAGMENT only, so pages 1..n-1 hang open
    `position: fixed`         does not repeat per page -- it stretches over the whole document, leaving
                              pages 2..n-1 with sides and nothing else, exactly like the table
    a repeating background    tiles per page correctly, but paints the flow: it stops at the text on the
                              last page like everything else
    a page-tall spacer with   wkhtmltopdf paginates for the spacer and emits a blank extra page
    a cancelling margin

A rule in the page HEADER does repeat (that is how the logo strip works), but it is confined to the top
margin, so it can give the box a top and nothing else -- and the header page is laid out at the FULL
page width while the body is inset by the side margins, so its rule overhangs the box's sides.

So the box is not drawn by the renderer at all. One blank page carrying just the rectangle is rendered
once and merged onto every page of the finished PDF, which is exact by construction and cannot be
knocked out of shape by the content.
"""

import io

import frappe
import pdfkit
from pypdf import PdfReader, PdfWriter

# The rectangle's inset from the page edge, in mm.
#
# Top and sides are `hod-document.html`'s own page margins, so the box opens where the content area does,
# just under the logo strip.
#
# ⚠️ THE BOTTOM IS NOT THE PAGE MARGIN, and using the page margin was the bug. Every other handover
# document draws its box as `.hd-sheet { height: 258mm }` sitting at the 20mm top margin, so its bottom
# rule lands 297 - 20 - 258 = 19mm up -- 5mm SHORT of the 14mm printable edge. Filling the printable area
# hung the O&M's box 5mm lower than the box on every page around it, and those pages are read one after
# the other (measured on the Maersk Kolkata Electrical binder, 2026-09-28: 14.5mm against 19.3mm
# everywhere else). The frame reproduces the SHEET, not the printable area, so the number is DERIVED from
# the sheet rather than typed a second time.
PAGE_HEIGHT = 297  # A4 portrait -- the page every framed document prints on
SHEET_HEIGHT = 258  # `hod-document.html` .hd-sheet
MARGIN_TOP = 20
# What `.print-format` declares as the page's bottom margin on the boxed sheets (and the binder's divider
# pages, which read it). The box stops ABOVE this, and the gap is what keeps a full-height box from tipping
# wkhtmltopdf onto an extra page. NOT the O&M Manual's: its text flows under this stamped frame, so it
# declares 22mm -- 3mm inside MARGIN_BOTTOM -- or its last line prints on the rule.
PAGE_MARGIN_BOTTOM = 14
MARGIN_BOTTOM = PAGE_HEIGHT - MARGIN_TOP - SHEET_HEIGHT  # 19
MARGIN_SIDE = 12

# The documents whose pages carry the box. Only the O&M Manual runs long enough to break across pages and
# need one drawn this way; every other document draws its own sheet within a single page, where ordinary
# CSS works. Keyed on `services/hod/index` document keys.
FRAMED = ("om_manual",)


def needs_frame(document: str) -> bool:
	return document in FRAMED

# 1pt = 1/72in; wkhtmltopdf writes its page boxes in points, and the frame is measured against the page
# it is stamped on rather than an assumed A4, so a landscape or custom page still gets a fitting box.
_MM_PER_PT = 25.4 / 72


def _frame_pdf(width_pt: float, height_pt: float) -> bytes:
	"""A one-page PDF of exactly this size holding nothing but the box."""
	w, h = width_pt * _MM_PER_PT, height_pt * _MM_PER_PT
	# Rendered through pdfkit DIRECTLY, not `frappe.utils.pdf.get_pdf`. That wrapper rewrites the page
	# options on the way past: it forces `margin-top: 15mm` on any html with no `#header-html` (which put
	# the whole box 15mm down the page, under the text it is meant to contain) and it turns a `Custom`
	# page size into a literal `--page-size Custom`, which wkhtmltopdf rejects outright. The frame needs
	# exact zero margins and this exact page size, and it loads nothing from disk or the network, so the
	# wrapper buys it nothing.
	html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
	html, body {{ margin: 0; padding: 0; }}
	/* Positioned off the page's own edges, NOT off a content flow -- that is the whole point. */
	.fr {{
		position: absolute;
		top: {MARGIN_TOP}mm; left: {MARGIN_SIDE}mm;
		width: {w - 2 * MARGIN_SIDE}mm; height: {h - MARGIN_TOP - MARGIN_BOTTOM}mm;
		border: 1px solid #000; box-sizing: border-box;
	}}
	</style></head><body><div class="fr"></div></body></html>"""
	return pdfkit.from_string(
		html,
		options={
			"page-width": f"{w}mm",
			"page-height": f"{h}mm",
			"margin-top": "0mm",
			"margin-bottom": "0mm",
			"margin-left": "0mm",
			"margin-right": "0mm",
			"print-media-type": None,
			"encoding": "UTF-8",
			"quiet": None,
			# WITHOUT this wkhtmltopdf "smart shrinks" the page and the box comes out at about 0.79 of
			# its stated size -- measured. `frappe.utils.pdf.get_pdf` passes it for the same reason;
			# bypassing that wrapper means passing it here.
			"disable-smart-shrinking": "",
			"disable-javascript": "",
			"disable-local-file-access": "",
		},
	)


def _count_images(resources, depth: int = 0) -> int:
	"""Images reachable from these resources, following Form XObjects.

	wkhtmltopdf does NOT hang its images off the page's own `/XObject` -- it wraps page content in a
	Form XObject and puts them one level down, so counting only the top level reports zero on a page
	that plainly shows a picture, and the picture page would then be dropped as blank. Measured.
	"""
	if depth > 4 or not resources:
		return 0
	xobjects = resources.get_object().get("/XObject") if hasattr(resources, "get_object") else resources.get("/XObject")
	if not xobjects:
		return 0
	found = 0
	for ref in xobjects.get_object().values():
		obj = ref.get_object()
		subtype = obj.get("/Subtype")
		if subtype == "/Image":
			found += 1
		elif subtype == "/Form":
			found += _count_images(obj.get("/Resources"), depth + 1)
	return found


def _marks(page) -> tuple[bool, int]:
	"""(does this page carry text, how many images it holds) -- read cheaply, off the page's resources.

	Anything that cannot be read counts AS content: a page is only ever dropped on positive evidence
	that it holds nothing.
	"""
	try:
		text = bool((page.extract_text() or "").strip())
	except Exception:
		return True, 0
	try:
		images = _count_images(page.get("/Resources"))
	except Exception:
		return True, 0
	return text, images


def drop_blank_pages(pages: list) -> list:
	"""The pages that actually hold something.

	A block whose text ends flush with the foot of a page spills its trailing whitespace a fraction onto
	the next one, and the following block's forced break then leaves that page EMPTY -- measured on the
	HVAC O&M, page 11 of 18. It cannot be tuned away in CSS: removing the wrapper padding or the list
	margin only reflows the text so the block stops landing flush, which is luck, not a fix -- the next
	manual whose text happens to end on a page boundary brings the blank straight back. Zeroing the
	trailing margin alone, the targeted version, changed nothing at all. So the blank is removed HERE,
	where it can be recognised for what it is.

	The LOGO STRIP is on every page, header and blank alike, so "no images" cannot be the test. The test
	is no text AND no more images than the emptiest page carries -- that baseline IS the strip. A
	pictures sheet therefore survives without a caption on it, because it holds images the strip does
	not. If that would empty the document, nothing is dropped.
	"""
	marks = [_marks(p) for p in pages]
	baseline = min((n for _text, n in marks), default=0)
	kept = [p for p, (text, n) in zip(pages, marks) if text or n > baseline]
	return kept or pages


def stamp(pdf_bytes: bytes) -> bytes:
	"""Every page of `pdf_bytes`, with the box drawn over it.

	Pages holding nothing are dropped first (`drop_blank_pages`). The frame is RENDERED once per page size -- a document is almost always one size -- but it is PARSED
	afresh for every merge, because `merge_page` mutates its argument. It goes on top: the frame page
	carries only the rule and no background, so nothing underneath is hidden.
	"""
	reader = PdfReader(io.BytesIO(pdf_bytes))
	writer = PdfWriter()
	frames: dict = {}
	# Before the box goes on, not after: a blank page is worse once it is framed, because the box makes
	# it read as a page someone meant to leave empty.
	for page in drop_blank_pages(list(reader.pages)):
		box = page.mediabox
		key = (round(float(box.width), 1), round(float(box.height), 1))
		if key not in frames:
			frames[key] = _frame_pdf(*key)
		try:
			# A FRESH page object per merge. `merge_page` mutates the page it is handed, so reusing one
			# object across the document warps it a little more each time -- measured: page 2 correct,
			# the last page's box two thirds of the width. The bytes are cached, the parse is not.
			page.merge_page(PdfReader(io.BytesIO(frames[key])).pages[0])
		except Exception:
			# A page that will not take the overlay is served as it is; a handover download must not fail
			# over a border.
			frappe.log_error("HOD page frame", frappe.get_traceback())
		writer.add_page(page)
	out = io.BytesIO()
	writer.write(out)
	return out.getvalue()
