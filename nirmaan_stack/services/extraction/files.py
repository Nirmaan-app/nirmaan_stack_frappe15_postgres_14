# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""File fetching + settings/secret access for the extraction layer.

Settings reads use direct DB access (`get_single_value`) to bypass the
System-Manager-only read perm on the settings doctype, so non-admin roles
(Procurement Exec, PM, Accountant) can run autofill. The doctype stays
write-restricted to System Manager.
"""
from __future__ import annotations

import frappe
from frappe.utils import cint

SUPPORTED_EXTS = {"pdf", "png", "jpg", "jpeg"}
MIME_TYPES = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
}
SETTINGS_DOCTYPE = "Document AI Settings"


def fetch_file_content(file_doc, file_name=None):
    """Return raw bytes for a File doc — S3 presigned URL or local bench file."""
    if file_doc.file_url and "/api/method/frappe_s3_attachment" in file_doc.file_url:
        try:
            import urllib.parse

            import requests
            from frappe_s3_attachment.controller import S3Operations

            s3 = S3Operations()
            s3_key = file_doc.content_hash
            if not s3_key:
                s3_key = urllib.parse.parse_qs(
                    urllib.parse.urlparse(file_doc.file_url).query
                )["key"][0]

            s3_key = urllib.parse.unquote(s3_key)
            presigned_url = s3.get_url(s3_key)
            resp = requests.get(presigned_url, timeout=30)
            resp.raise_for_status()
            return resp.content
        except Exception as exc:
            frappe.log_error(
                title=f"Extraction S3 Fetch Error: {file_name or file_doc.name}",
                message=str(exc) + "\n" + frappe.get_traceback(),
            )
            return None

    return file_doc.get_content()


def get_extraction_settings():
    """Read the extraction settings singleton (perm-bypassing).

    On any error returns a degraded {enabled: False} so a transient DB issue
    fails closed rather than raising into the autofill flow.
    """
    try:
        get = lambda field: frappe.db.get_single_value(SETTINGS_DOCTYPE, field)
        return {
            "enabled": bool(cint(get("enabled"))),
            "provider": (get("provider") or "gemini").strip().lower(),
            "auth_mode": (get("gemini_auth_mode") or "Vertex AI").strip(),
            "gcp_project_id": (get("gcp_project_id") or "").strip(),
            "gcp_location": (get("gcp_location") or "asia-south1").strip(),
            "gemini_model": (get("gemini_model") or "gemini-3.1-pro-preview").strip(),
            "gemini_thinking_level": (get("gemini_thinking_level") or "low").strip().lower(),
            "gemini_media_resolution": (get("gemini_media_resolution") or "high").strip().lower(),
            "request_timeout_seconds": int(get("request_timeout_seconds") or 90),
        }
    except Exception:
        frappe.log_error(
            title="Extraction settings load failed",
            message=frappe.get_traceback(),
        )
        return {"enabled": False, "request_timeout_seconds": 90}


def get_gemini_api_key():
    """Read the encrypted Gemini API key (API-Key auth mode only)."""
    from frappe.utils.password import get_decrypted_password

    try:
        value = get_decrypted_password(
            SETTINGS_DOCTYPE, SETTINGS_DOCTYPE, "gemini_api_key", raise_exception=False
        )
        return (value or "").strip() or None
    except Exception:
        frappe.log_error(
            title="Gemini API key read failed", message=frappe.get_traceback()
        )
        return None
