# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read a vendor's Udyam (MSME) certificate so the vendor form fills in the MSME ID (owner, 2026-11-19).

Works like `tds_challan_autofill` / `customer_po_autofill`: read the uploaded file, hand it to the
shared `services/extraction` seam with `doc_kind="msme_certificate"`, return what the model read.
NOTHING IS PERSISTED HERE: the form shows the MSME ID (the user may correct it) and saves
`msme_id`, `msme_attachment` and the returned `autofill_all_entities_json` with the vendor.

Checks come back as `validation` for the form to show as WARNINGS, never blocks (owner):
  * the file is not a Udyam certificate, or no Udyam number in the right format was read;
  * the certificate's enterprise name does not look like the vendor's name;
  * another vendor already has this MSME ID.
"""

import frappe
from frappe.utils import now_datetime

from nirmaan_stack.services.extraction import extract
from nirmaan_stack.services.extraction.base import MSME_CERTIFICATE
from nirmaan_stack.services.extraction.files import (
    SUPPORTED_EXTS,
    fetch_file_content,
    get_extraction_settings,
)
from nirmaan_stack.services.extraction.helpers import get_file_doc_by_url, normalize_date, pick_entity
from nirmaan_stack.services.vendor_msme import is_valid_udyam, names_match, normalize_udyam

ENTERPRISE_TYPES = ("Micro", "Small", "Medium")


@frappe.whitelist()
def extract_msme_fields(file_url, vendor_name=None, vendor_id=None):
    """Read an uploaded Udyam certificate. Persists nothing.

    `vendor_name` feeds the name check; `vendor_id` (absent on New Vendor) is left out of the
    duplicate check.
    """
    _assert_can_edit_vendors()  # each read is a paid model call
    if not file_url:
        frappe.throw("file_url is required")

    file_doc = get_file_doc_by_url(file_url)
    if not file_doc:
        frappe.throw(f"No File record found for url: {file_url}")
    if not file_doc.file_name:
        frappe.throw("File has no file_name; cannot determine type.")

    file_ext = file_doc.file_name.rsplit(".", 1)[-1].lower()
    if file_ext not in SUPPORTED_EXTS:
        frappe.throw(f"Unsupported file type: .{file_ext}. Allowed: {sorted(SUPPORTED_EXTS)}")

    settings = get_extraction_settings()
    if not settings.get("enabled"):
        frappe.throw("Document extraction is disabled. Please enable it in Document AI Settings.")

    content = fetch_file_content(file_doc, file_doc.name)
    if not content:
        frappe.throw("Could not read file content.")

    _, entities, _ = extract(content, file_ext, settings, doc_kind=MSME_CERTIFICATE)
    read = {key: (pick_entity(entities, (key,))[0] or "").strip() for key in (
        "is_udyam_certificate", "udyam_registration_number", "enterprise_name", "enterprise_type",
        "major_activity", "date_of_udyam_registration", "date_of_incorporation",
    )}

    msme_id = normalize_udyam(read["udyam_registration_number"])
    id_valid = is_valid_udyam(msme_id)
    enterprise_type = next(
        (t for t in ENTERPRISE_TYPES if t.lower() == read["enterprise_type"].lower()), ""
    )

    read_data = {
        "udyam_registration_number": msme_id or None,
        "enterprise_name": read["enterprise_name"] or None,
        "enterprise_type": enterprise_type or None,
        "major_activity": read["major_activity"] or None,
        "date_of_udyam_registration": _date(read["date_of_udyam_registration"]),
        "date_of_incorporation": _date(read["date_of_incorporation"]),
        "file_url": file_url,
        "read_on": str(now_datetime()),
        "model": settings.get("gemini_model") or None,
    }

    return {
        # Only a well-formed number fills the form; anything else is left for the user to type.
        "msme_id": msme_id if id_valid else "",
        "autofill_all_entities_json": read_data,
        "validation": {
            "is_udyam_certificate": read["is_udyam_certificate"].lower() != "no",
            "id_read": msme_id,
            "id_valid": id_valid,
            "name_match": names_match(vendor_name, read["enterprise_name"]),
            "certificate_name": read["enterprise_name"],
            "duplicates": msme_duplicates(msme_id, vendor_id) if id_valid else [],
        },
    }


@frappe.whitelist()
def msme_duplicates(msme_id, vendor_id=None):
    """Other vendors holding this MSME ID: [{name, vendor_name}]. A warning on the form, never a block."""
    _assert_can_edit_vendors()
    msme_id = normalize_udyam(msme_id)
    if not msme_id:
        return []
    filters = [["msme_id", "=", msme_id]]
    if vendor_id:
        filters.append(["name", "!=", vendor_id])
    return frappe.get_all("Vendors", filters=filters, fields=["name", "vendor_name"], limit=5)


def _assert_can_edit_vendors():
    """The same people who may create or edit a vendor today (owner: no new role rule)."""
    if not (frappe.has_permission("Vendors", "create") or frappe.has_permission("Vendors", "write")):
        frappe.throw("You are not allowed to add MSME details to a vendor.", frappe.PermissionError)


def _date(value):
    return (normalize_date(value) or None) if value else None
