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

# The rectangle's inset from the page edge, in mm: the same margins `hod-document.html` declares on
# `.print-format`, so the box lands exactly where the content area starts and the logo strip ends.
MARGIN_TOP = 20
MARGIN_BOTTOM = 14
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


def stamp(pdf_bytes: bytes) -> bytes:
	"""Every page of `pdf_bytes`, with the box drawn over it.

	The frame is RENDERED once per page size -- a document is almost always one size -- but it is PARSED
	afresh for every merge, because `merge_page` mutates its argument. It goes on top: the frame page
	carries only the rule and no background, so nothing underneath is hidden.
	"""
	reader = PdfReader(io.BytesIO(pdf_bytes))
	writer = PdfWriter()
	frames: dict = {}
	for page in reader.pages:
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
