# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""One handover document as a PDF: the row's Preview and its Download.

This exists only because the page BOX cannot be drawn by the renderer. A document that runs to several
pages needs a full-height rectangle on every one of them, whatever that page holds, and wkhtmltopdf
paints against the content flow -- see `page_frame` for the four routes that were measured and why each
falls short. The box is therefore stamped on AFTER the render, and Frappe's own
`frappe.utils.print_format.download_pdf` gives nowhere to do that.

So the screen asks for its PDFs here instead. Everything else is unchanged: the same "HOD Document"
print format, the same row, no letterhead. A document that needs no box is served exactly as
`download_pdf` would have served it.
"""

import frappe
from frappe import _

from nirmaan_stack.api.hod import page_frame

DOCTYPE = "Project HOD Document"
PRINT_FORMAT = "HOD Document"


def _safe(text) -> str:
	out = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(text or ""))
	return "_".join(p for p in out.split("_") if p) or "document"


@frappe.whitelist()
def document_pdf(name: str):
	"""The "HOD Document" print of one row, with the page box stamped on where the document needs one.

	Served as a file, so the browser and the preview dialog can both take it: the dialog fetches it into
	a blob, the download saves it.
	"""
	if not name:
		frappe.throw(_("A handover document is required."))
	doc = frappe.get_doc(DOCTYPE, name)
	if not frappe.has_permission(DOCTYPE, "read", doc=doc):
		raise frappe.PermissionError(_("Not permitted to read this handover document."))

	pdf = frappe.get_print(DOCTYPE, name, print_format=PRINT_FORMAT, as_pdf=True, no_letterhead=1)
	if page_frame.needs_frame(doc.document):
		pdf = page_frame.stamp(pdf)

	frappe.local.response.filename = f"{_safe(doc.hod_system)}_{_safe(doc.document)}.pdf"
	frappe.local.response.filecontent = pdf
	# `as_raw` types the response from the filename, so a `.pdf` name is what makes this render in the
	# preview iframe instead of downloading out of it.
	frappe.local.response.type = "download"
