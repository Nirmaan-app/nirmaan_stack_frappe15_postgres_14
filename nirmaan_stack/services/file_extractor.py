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

def process_file_in_background(file_name):
    try:
        file_doc = frappe.get_doc("File", file_name)
        if not file_doc.file_name:
            return

        file_ext = file_doc.file_name.split('.')[-1].lower()
        frappe.log_error(title=f"Extraction Start: {file_name}", message=f"Starting extraction for file: {file_doc.file_name} with extension: {file_ext}")

        if file_ext not in SUPPORTED_EXTS:
            frappe.log_error(title=f"Extraction Unsupported: {file_name}", message=f"Extension {file_ext} is not supported.")
            _mark_index_failed(file_doc, f"Extension {file_ext} is not supported.")
            return

        doc_ai_settings = _get_document_ai_settings()
        existing_index = frappe.db.get_value(
            "File Text Search Index",
            {"file": file_doc.name},
            ["name", "source_content_hash", "extraction_provider"],
            as_dict=True,
        )

        # Skip only when indexed data is already for the same content hash
        # and there is no provider upgrade needed.
        if existing_index and existing_index.get("source_content_hash") and existing_index.get("source_content_hash") == file_doc.content_hash:
            if doc_ai_settings.get("enabled"):
                if existing_index.get("extraction_provider") == "google_document_ai":
                    return
            else:
                return

        try:
            content = _fetch_file_content(file_doc, file_name)

            if not content:
                frappe.log_error(title=f"Extraction Empty Content: {file_name}", message=f"File {file_doc.file_name} has no content bytes returned from get_content(). URL: {file_doc.file_url}")
                _mark_index_failed(file_doc, "File has no content bytes.")
                return
            frappe.log_error(title=f"Extraction File Downloaded: {file_name}", message=f"Successfully downloaded {len(content)} bytes.")
        except Exception as exc:
            frappe.log_error(title=f"File Extraction Failed Download: {file_name}", message=frappe.get_traceback())
            _mark_index_failed(file_doc, f"File download failed: {str(exc)[:100]}")
            return

        extracted_text, provider, extracted_entities, used_processor_id = _extract_text_and_entities(
            content, file_ext, file_name, file_doc.attached_to_doctype, doc_ai_settings
        )

        if provider == "document_ai_disabled":
            _mark_index_failed(file_doc, "Document AI is disabled in Settings.")
            return

        if not extracted_text or not extracted_text.strip():
            frappe.log_error(
                title=f"Extraction Empty Result: {file_name}",
                message=(
                    f"Provider={provider}\n"
                    f"Processor ID={used_processor_id}\n"
                    f"Entity Count={len(extracted_entities)}\n"
                    f"The extraction pipeline returned no text for {file_doc.file_name}."
                ),
            )
            _mark_index_failed(file_doc, "Document AI returned no text.")
            return

        if extracted_text and extracted_text.strip():
            entities_json = json.dumps(extracted_entities, ensure_ascii=True) if extracted_entities else None
            clean_structured_fields = _build_clean_structured_fields(extracted_entities, min_confidence=0.60)
            clean_structured_fields_json = (
                json.dumps(clean_structured_fields, ensure_ascii=True) if clean_structured_fields else None
            )

            index_payload = {
                "file": file_doc.name,
                "attached_to_doctype": file_doc.attached_to_doctype,
                "attached_to_name": file_doc.attached_to_name,
                "extracted_text": extracted_text.lower(),
                "extraction_provider": provider,
                "document_ai_processor_id": used_processor_id,
                "source_content_hash": file_doc.content_hash,
                "extracted_entities_json": entities_json,
                "clean_structured_fields_json": clean_structured_fields_json,
            }

            if existing_index and existing_index.get("name"):
                index_doc = frappe.get_doc("File Text Search Index", existing_index.get("name"))
                index_doc.update(index_payload)
                index_doc.save(ignore_permissions=True)
            else:
                frappe.get_doc({"doctype": "File Text Search Index", **index_payload}).insert(ignore_permissions=True)

            frappe.db.commit()

    except Exception as exc:
        frappe.log_error(title=f"File Extraction Error: {file_name}", message=frappe.get_traceback())
        if "file_doc" in locals():
            _mark_index_failed(file_doc, f"Extraction Exception: {str(exc)[:100]}")

def process_file(doc, method):
    # Only enqueue if it's an uploaded file
    if not doc.file_name:
        return

    ext = doc.file_name.split('.')[-1].lower()
    if ext in SUPPORTED_EXTS:
        frappe.enqueue("nirmaan_stack.services.file_extractor.process_file_in_background", queue="long", file_name=doc.name)


@frappe.whitelist()
def search_document_text(keyword):
    if not keyword:
        return []
        
    keyword = keyword.lower()
    
    # Using frappe.db.sql for ILIKE performance (case insensitive)
    query = """
        SELECT 
            idx.file,
            f.file_name,
            f.file_url,
            idx.attached_to_doctype,
            idx.attached_to_name,
            idx.extracted_text
        FROM `tabFile Text Search Index` idx
        LEFT JOIN `tabFile` f ON idx.file = f.name
        WHERE idx.extracted_text ILIKE %(kw)s
        LIMIT 50
    """
    
    results = frappe.db.sql(query, {"kw": f"%{keyword}%"}, as_dict=True)
    
    # Generate contextual snippets from the matched text
    for res in results:
        text = res.get("extracted_text", "")
        idx = text.find(keyword)
        if idx != -1:
            start = max(0, idx - 50)
            end = min(len(text), idx + 50 + len(keyword))
            res["snippet"] = "..." + text[start:end] + "..."
        else:
            res["snippet"] = "Match found."
            
        # Remove the massive block of text to save network bandwidth to the frontend
        del res["extracted_text"]

    return results


@frappe.whitelist()
def advanced_document_search(keyword="", mode="text"):
    """Experimental API to search by text, structured json, or both."""
    if not keyword:
        return []
        
    query = """
        SELECT 
            idx.file,
            f.file_name,
            f.file_url,
            idx.attached_to_doctype,
            idx.attached_to_name,
            idx.extracted_text,
            idx.clean_structured_fields_json
        FROM `tabFile Text Search Index` idx
        LEFT JOIN `tabFile` f ON idx.file = f.name
        WHERE 1=1
    """
    
    kw = f"%{keyword.lower()}%"
    if mode == "text":
        query += " AND idx.extracted_text ILIKE %(kw)s "
    elif mode == "json":
        query += " AND idx.clean_structured_fields_json ILIKE %(kw)s "
    elif mode == "combined":
        query += " AND (idx.extracted_text ILIKE %(kw)s OR idx.clean_structured_fields_json ILIKE %(kw)s) "
        
    query += " LIMIT 50"
    
    results = frappe.db.sql(query, {"kw": kw}, as_dict=True)
    
    for res in results:
        text = res.get("extracted_text") or ""
        struct_json = res.get("clean_structured_fields_json") or ""
        
        snippets = []
        if mode in ["text", "combined"]:
            idx = text.find(keyword.lower())
            if idx != -1:
                start = max(0, idx - 50)
                end = min(len(text), idx + 50 + len(keyword))
                snippets.append("TXT: ..." + text[start:end] + "...")
                
        if mode in ["json", "combined"]:
            idx = struct_json.lower().find(keyword.lower())
            if idx != -1:
                start = max(0, idx - 40)
                end = min(len(struct_json), idx + 40 + len(keyword))
                snippets.append("JSON: ..." + struct_json[start:end] + "...")
                
        res["snippet"] = " | ".join(snippets) or "Match found."
        
        if "extracted_text" in res:
            del res["extracted_text"]
        if "clean_structured_fields_json" in res:
            del res["clean_structured_fields_json"]

    return results


def _fetch_file_content(file_doc, file_name):
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
            frappe.log_error(title=f"Extraction S3 Error: {file_name}", message=str(exc) + "\n" + frappe.get_traceback())
            return None

    return file_doc.get_content()


def _extract_text_and_entities(content, file_ext, file_name, attached_to_doctype, settings=None):
    settings = settings or _get_document_ai_settings()
    extracted_entities = []
    selected_processor_id = None
    logger = frappe.logger("document_ai")

    if not settings.get("enabled"):
        frappe.log_error(
            title=f"Document AI Disabled: {file_name}",
            message=f"Document AI is disabled in settings. attached_to_doctype={attached_to_doctype}",
        )
        return "", "document_ai_disabled", [], None

    selected_processor_id = _resolve_processor_id(settings, attached_to_doctype)
    if not selected_processor_id:
        frappe.log_error(
            title=f"Document AI Processor Missing: {file_name}",
            message=(
                f"No processor could be resolved for attached_to_doctype={attached_to_doctype}. "
                "Please configure Invoice/Expense/Default processor IDs in Document AI Settings."
            ),
        )
        return "", "google_document_ai", [], None

    try:
        logger.info(
            "Document AI attempt file=%s attached_to_doctype=%s processor_id=%s",
            file_name,
            attached_to_doctype,
            selected_processor_id,
        )
        extracted_text, extracted_entities = _extract_with_document_ai(
            content, file_ext, settings, selected_processor_id
        )

        entity_types = [entity.get("type") for entity in extracted_entities[:10] if entity.get("type")]
        frappe.log_error(
            title=f"Document AI Debug: {file_name}",
            message=(
                f"processor_id={selected_processor_id}\n"
                f"attached_to_doctype={attached_to_doctype}\n"
                f"entity_count={len(extracted_entities)}\n"
                f"sample_entity_types={entity_types[:5]}"
            ),
        )
        print(
            f"[DocumentAI] file={file_name} processor={selected_processor_id} "
            f"entities={len(extracted_entities)} sample_types={entity_types[:5]}"
        )

        if extracted_text and extracted_text.strip():
            return extracted_text, "google_document_ai", extracted_entities, selected_processor_id

        frappe.log_error(
            title=f"Document AI Empty Text: {file_name}",
            message=(
                f"processor_id={selected_processor_id}\n"
                f"attached_to_doctype={attached_to_doctype}\n"
                "Document AI response had empty text."
            ),
        )
        return "", "google_document_ai", extracted_entities, selected_processor_id
    except Exception:
        frappe.log_error(
            title=f"Document AI Extraction Error: {file_name}",
            message=frappe.get_traceback(),
        )
        return "", "google_document_ai", [], selected_processor_id


def _extract_with_document_ai(content, file_ext, settings, processor_id):
    from google.cloud import documentai
    from google.oauth2 import service_account

    service_account_json = _get_document_ai_service_account_json()
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


def _get_document_ai_settings():
    try:
        settings = frappe.get_single(DOC_AI_SETTINGS_DOCTYPE)
    except Exception:
        return {
            "enabled": False,
            "timeout_seconds": 90,
        }

    return {
        "enabled": bool(cint(settings.get("enabled"))),
        "project_id": (settings.get("project_id") or "").strip(),
        "location": (settings.get("location") or "us").strip(),
        "processor_id": (settings.get("processor_id") or "").strip(),
        "invoice_processor_id": (settings.get("invoice_processor_id") or "").strip(),
        "expense_processor_id": (settings.get("expense_processor_id") or "").strip(),
        "invoice_target_doctypes": _parse_doctypes_list(settings.get("invoice_target_doctypes")),
        "expense_target_doctypes": _parse_doctypes_list(settings.get("expense_target_doctypes")),
        "timeout_seconds": int(settings.get("timeout_seconds") or 90),
    }


def _get_document_ai_service_account_json():
    try:
        settings = frappe.get_single(DOC_AI_SETTINGS_DOCTYPE)
    except Exception:
        return None
    return (settings.get("service_account_json_input") or "").strip() or None


def _resolve_processor_id(settings, attached_to_doctype):
    doc_type = (attached_to_doctype or "").strip()
    if not doc_type:
        return settings.get("processor_id")

    invoice_targets = set(settings.get("invoice_target_doctypes") or [])
    expense_targets = set(settings.get("expense_target_doctypes") or [])

    if doc_type in invoice_targets and settings.get("invoice_processor_id"):
        return settings.get("invoice_processor_id")
    if doc_type in expense_targets and settings.get("expense_processor_id"):
        return settings.get("expense_processor_id")

    # Fallback heuristic in case the target-doctype fields are not maintained.
    lower_name = doc_type.lower()
    if "invoice" in lower_name and settings.get("invoice_processor_id"):
        return settings.get("invoice_processor_id")
    if "payment" in lower_name and settings.get("invoice_processor_id"):
        return settings.get("invoice_processor_id")
    if "expense" in lower_name and settings.get("expense_processor_id"):
        return settings.get("expense_processor_id")

    return settings.get("processor_id")


def _parse_doctypes_list(value):
    raw = (value or "").strip()
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def _build_clean_structured_fields(entities, min_confidence=0.20):
    """
    Build a compact structured key-value JSON from entities.
    Keep only entities >= min_confidence and non-empty values.
    """
    clean = {}

    for entity in entities or []:
        confidence = float(entity.get("confidence") or 0)
        if confidence < min_confidence:
            continue

        key = (entity.get("type") or "").strip()
        if not key:
            continue

        # Prefer normalized value, fallback to mention text.
        normalized = (entity.get("normalized_text") or "").strip()
        mention = (entity.get("mention_text") or "").strip()
        value = normalized or mention
        if not value:
            continue

        # If multiple values appear for same key, keep unique list.
        existing = clean.get(key)
        if existing is None:
            clean[key] = value
            continue

        if isinstance(existing, list):
            if value not in existing:
                existing.append(value)
            continue

        if existing != value:
            clean[key] = [existing, value]

    return clean


def _mark_index_failed(file_doc, error_reason):
    index_payload = {
        "file": file_doc.name,
        "attached_to_doctype": file_doc.attached_to_doctype,
        "attached_to_name": file_doc.attached_to_name,
        "extracted_text": f"SYSTEM_ERROR: {error_reason}",
        "extraction_provider": "error",
        "document_ai_processor_id": None,
        "source_content_hash": file_doc.content_hash,
        "extracted_entities_json": None,
        "clean_structured_fields_json": None,
    }
    existing_index = frappe.db.get_value("File Text Search Index", {"file": file_doc.name}, "name")
    if existing_index:
        index_doc = frappe.get_doc("File Text Search Index", existing_index)
        index_doc.update(index_payload)
        index_doc.save(ignore_permissions=True)
    else:
        frappe.get_doc({"doctype": "File Text Search Index", **index_payload}).insert(ignore_permissions=True)
    frappe.db.commit()
