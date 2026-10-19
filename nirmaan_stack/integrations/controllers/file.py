"""File lifecycle hooks (CU-A AC5 (b)): the dev-only cloud-upload off-switch.

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
