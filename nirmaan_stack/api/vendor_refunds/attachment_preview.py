# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Show a refund's spreadsheet attachment in the app instead of downloading it.

An imported refund's `refund_attachment` is the bank statement (.xlsx / .csv) it was matched from. The
signed storage URL already carries an inline disposition, but a browser cannot render a spreadsheet, so
opening the link always downloaded it. This endpoint reads the file server-side (the storage URL is
cross-origin, so the browser cannot fetch the bytes itself) and returns the cells as a grid.

⚠️ PERMISSION-AWARE: the caller must be able to READ the refund, so a project-scoped user previews only
the attachments of refunds they can already see.
"""

import urllib.parse

import frappe

from nirmaan_stack.services.outflow_import.parser import _read_grid
from nirmaan_stack.services.vendor_refunds import VENDOR_REFUNDS

_PREVIEW_MAX_ROWS = 2000
_SHEET_EXTENSIONS = (".xlsx", ".csv")


def _file_name(file_url: str) -> str:
    parsed = urllib.parse.urlparse(file_url)
    names = urllib.parse.parse_qs(parsed.query).get("file_name")
    return names[0] if names else parsed.path.rsplit("/", 1)[-1]


def _read_bytes(file_url: str) -> bytes:
    key = urllib.parse.parse_qs(urllib.parse.urlparse(file_url).query).get("key")
    if not key:
        # A local /files or /private/files attachment, still on disk.
        return frappe.get_doc("File", {"file_url": file_url}).get_content()

    from frappe_gcp_attachment.controller import S3Operations  # noqa: PLC0415

    return S3Operations().read_file_from_s3(key[0])["Body"].read()


@frappe.whitelist()
def get_refund_attachment_preview(refund: str):
    """The cells of one refund's spreadsheet attachment, capped at `_PREVIEW_MAX_ROWS` rows."""
    doc = frappe.get_doc(VENDOR_REFUNDS, refund)
    doc.check_permission("read")

    file_url = (doc.refund_attachment or "").strip()
    if not file_url:
        frappe.throw("This refund has no attachment.")

    file_name = _file_name(file_url)
    if not file_name.lower().endswith(_SHEET_EXTENSIONS):
        frappe.throw("Only .xlsx and .csv attachments can be previewed.")

    grid = _read_grid(_read_bytes(file_url))
    return {
        "file_name": file_name,
        "rows": grid[:_PREVIEW_MAX_ROWS],
        "total_rows": len(grid),
    }
