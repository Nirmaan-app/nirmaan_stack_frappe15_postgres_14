"""File lifecycle hooks (CU-A AC5 (b)): the dev-only cloud-upload off-switch; and `NirmaanFile`, which
refuses a PDF that can't be read with a readable message (spec #1528 walk 3).

The storage app `frappe_gcp_attachment` uploads every new File in its own `after_insert` hook
(`controller.file_upload_to_gcs`) and has no global switch. With the site config
`disable_cloud_upload` set -- dev only, never on production -- this `before_insert` removes that one
handler from the CURRENT request's (or job's) doc-event table, so the File keeps its local copy and
nothing reaches the bucket. No other app is edited.

Why this works: Frappe resolves doc-event handlers on every call from `frappe.get_doc_hooks()`, which
is cached per request in `frappe.local.doc_events_hooks` and rebuilt on the next `frappe.init()`. A
File's `before_insert` always runs before its `after_insert` in the same request, so the upload
handler is gone by the time it would fire. The removal lasts only for this request or job, and the
switch is read again on every File insert.
"""
import logging

import frappe
from frappe import _
from frappe.core.doctype.file.file import File
from pypdf.errors import PyPdfError

GCP_UPLOAD = "frappe_gcp_attachment.controller.file_upload_to_gcs"


def before_insert(doc, method):
    if not frappe.conf.get("disable_cloud_upload"):
        return
    events = frappe.get_doc_hooks().get("File", {})
    handlers = events.get("after_insert") or []
    if GCP_UPLOAD in handlers:
        events["after_insert"] = [h for h in handlers if h != GCP_UPLOAD]
    logger = frappe.logger("nirmaan_cloud_upload", allow_site=True)
    # Frappe file loggers default to ERROR off the dev server (utils/logger.py): INFO needs this
    logger.setLevel(logging.INFO)
    logger.info(
        f"cloud upload disabled (disable_cloud_upload): File {doc.file_name!r} stays local"
    )


UNREADABLE_PDF_REFUSAL = (
    "This PDF can't be read: it may be damaged, cut off in the download, or not a PDF at all. Open it on "
    "your computer, save or export it again as a PDF, and upload that copy."
)


class NirmaanFile(File):
    """`override_doctype_class` for File. Frappe reads every new PDF for scripts (`check_content`, through
    `frappe.utils.pdf.pdf_contains_js`) in the File's own `before_insert`, ahead of any doc-event hook, and a
    file pypdf can't parse raised `PdfReadError` there: a raw 500 on every upload (walk 3, a generated
    invoice's signed copy). Here it is the refusal a person can act on."""

    def check_content(self):
        try:
            super().check_content()
        except PyPdfError:
            frappe.throw(_(UNREADABLE_PDF_REFUSAL), title=_("Damaged PDF"))
