import json

import frappe
from frappe.utils import cint

SUPPORTED_EXTS = {"pdf", "png", "jpg", "jpeg"}
MIME_TYPES = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
}
DOC_AI_SETTINGS_DOCTYPE = "Document AI Settings"


def fetch_file_content(file_doc, file_name=None):
    if file_doc.file_url and "/api/method/frappe_s3_attachment" in file_doc.file_url:
        try:
            import requests
            import urllib.parse
            from frappe_s3_attachment.controller import S3Operations

            s3 = S3Operations()
            s3_key = file_doc.content_hash
            if not s3_key:
                s3_key = urllib.parse.parse_qs(urllib.parse.urlparse(file_doc.file_url).query)["key"][0]

            s3_key = urllib.parse.unquote(s3_key)
            presigned_url = s3.get_url(s3_key)
            resp = requests.get(presigned_url, timeout=30)
            resp.raise_for_status()
            return resp.content
        except Exception as exc:
            frappe.log_error(
                title=f"Document AI S3 Fetch Error: {file_name or file_doc.name}",
                message=str(exc) + "\n" + frappe.get_traceback(),
            )
            return None

    return file_doc.get_content()


def get_document_ai_settings():
    """Read Document AI Settings via direct DB access — bypasses doctype-level
    read permissions so non-admin users (Procurement Executive, PM, Accountant,
    etc.) can use the invoice autofill flow. The settings doctype is still only
    *writable* by System Manager; this only relaxes read-side access."""
    try:
        get = lambda field: frappe.db.get_single_value(DOC_AI_SETTINGS_DOCTYPE, field)
        return {
            "enabled": bool(cint(get("enabled"))),
            "project_id": (get("project_id") or "").strip(),
            "location": (get("location") or "us").strip(),
            "processor_id": (get("processor_id") or "").strip(),
            "invoice_processor_id": (get("invoice_processor_id") or "").strip(),
            "expense_processor_id": (get("expense_processor_id") or "").strip(),
            "invoice_target_doctypes": _parse_doctypes_list(get("invoice_target_doctypes")),
            "expense_target_doctypes": _parse_doctypes_list(get("expense_target_doctypes")),
            "timeout_seconds": int(get("timeout_seconds") or 90),
        }
    except Exception:
        frappe.log_error(
            title="Document AI Settings load failed",
            message=frappe.get_traceback(),
        )
        return {
            "enabled": False,
            "timeout_seconds": 90,
        }


def get_document_ai_service_account_json():
    """Read service-account JSON via direct DB access (bypasses doctype perms)."""
    try:
        value = frappe.db.get_single_value(DOC_AI_SETTINGS_DOCTYPE, "service_account_json_input")
        return (value or "").strip() or None
    except Exception:
        return None


def resolve_processor_id(settings, attached_to_doctype):
    doc_type = (attached_to_doctype or "").strip()
    if not doc_type:
        return settings.get("processor_id")

    invoice_targets = set(settings.get("invoice_target_doctypes") or [])
    expense_targets = set(settings.get("expense_target_doctypes") or [])

    if doc_type in invoice_targets and settings.get("invoice_processor_id"):
        return settings.get("invoice_processor_id")
    if doc_type in expense_targets and settings.get("expense_processor_id"):
        return settings.get("expense_processor_id")

    lower_name = doc_type.lower()
    if "invoice" in lower_name and settings.get("invoice_processor_id"):
        return settings.get("invoice_processor_id")
    if "payment" in lower_name and settings.get("invoice_processor_id"):
        return settings.get("invoice_processor_id")
    if "expense" in lower_name and settings.get("expense_processor_id"):
        return settings.get("expense_processor_id")

    return settings.get("processor_id")


def extract_with_document_ai(content, file_ext, settings, processor_id):
    """Call Google Document AI processor and return (text, entities)."""
    from google.cloud import documentai
    from google.oauth2 import service_account

    service_account_json = get_document_ai_service_account_json()
    if not service_account_json:
        frappe.throw("Document AI is enabled but service account JSON is not configured.")

    parsed_credentials = json.loads(service_account_json)
    credentials = service_account.Credentials.from_service_account_info(parsed_credentials)

    location = settings.get("location")
    endpoint = f"{location}-documentai.googleapis.com"
    client = documentai.DocumentProcessorServiceClient(
        credentials=credentials,
        client_options={"api_endpoint": endpoint},
    )

    request = documentai.ProcessRequest(
        name=client.processor_path(
            settings.get("project_id"),
            location,
            processor_id,
        ),
        raw_document=documentai.RawDocument(
            content=content,
            mime_type=MIME_TYPES.get(file_ext, "application/octet-stream"),
        ),
    )

    timeout_seconds = settings.get("timeout_seconds", 90)
    result = client.process_document(request=request, timeout=timeout_seconds)
    document = result.document

    entities = []
    for entity in document.entities:
        normalized_value = ""
        if entity.normalized_value and getattr(entity.normalized_value, "text", None):
            normalized_value = entity.normalized_value.text

        page_no = None
        if entity.page_anchor and entity.page_anchor.page_refs:
            page_no = int(entity.page_anchor.page_refs[0].page) + 1

        start_offset = None
        end_offset = None
        if entity.text_anchor and entity.text_anchor.text_segments:
            start_offset = int(entity.text_anchor.text_segments[0].start_index or 0)
            end_offset = int(entity.text_anchor.text_segments[0].end_index or 0)

        entities.append(
            {
                "type": entity.type_,
                "mention_text": entity.mention_text or "",
                "normalized_text": normalized_value,
                "confidence": float(entity.confidence or 0),
                "page_no": page_no,
                "start_offset": start_offset,
                "end_offset": end_offset,
            }
        )

    return (document.text or ""), entities


def _parse_doctypes_list(value):
    raw = (value or "").strip()
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]
