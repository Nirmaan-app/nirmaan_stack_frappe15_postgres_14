import frappe

from nirmaan_stack.services.document_ai import (
    SUPPORTED_EXTS,
    extract_with_document_ai,
    fetch_file_content,
    get_document_ai_settings,
    resolve_processor_id,
)

MIN_CONFIDENCE = 0.70

INVOICE_NO_KEYS = ("invoice_id", "invoice_number", "invoice_no")
INVOICE_DATE_KEYS = ("invoice_date",)
AMOUNT_KEYS = ("total_amount", "net_amount", "amount_due", "amount")


@frappe.whitelist()
def extract_invoice_fields(file_url):
    """Extract invoice number, date, and total amount from an uploaded invoice file.

    Called from the Add Invoice dialog when the user clicks the Auto-fill button.
    Only fields with confidence >= MIN_CONFIDENCE are returned populated; lower-
    confidence fields are returned as empty strings so the frontend leaves them
    blank for manual entry.
    """
    if not file_url:
        frappe.throw("file_url is required")

    file_doc = _get_file_doc_by_url(file_url)
    if not file_doc:
        frappe.throw(f"No File record found for url: {file_url}")

    if not file_doc.file_name:
        frappe.throw("File has no file_name; cannot determine type.")

    file_ext = file_doc.file_name.rsplit(".", 1)[-1].lower()
    if file_ext not in SUPPORTED_EXTS:
        frappe.throw(f"Unsupported file type: .{file_ext}. Allowed: {sorted(SUPPORTED_EXTS)}")

    settings = get_document_ai_settings()
    if not settings.get("enabled"):
        frappe.throw("Document AI is disabled. Please enable it in Document AI Settings.")

    processor_id = resolve_processor_id(settings, "Vendor Invoices")
    if not processor_id:
        frappe.throw("No Document AI processor configured for invoices. Set invoice_processor_id in Document AI Settings.")

    content = fetch_file_content(file_doc, file_doc.name)
    if not content:
        frappe.throw("Could not read file content.")

    try:
        _, entities = extract_with_document_ai(content, file_ext, settings, processor_id)
    except Exception as exc:
        frappe.log_error(
            title=f"Invoice Autofill Error: {file_doc.name}",
            message=frappe.get_traceback(),
        )
        frappe.throw(f"Document AI extraction failed: {exc}")

    invoice_no, invoice_no_conf = _pick_entity(entities, INVOICE_NO_KEYS)
    invoice_date, invoice_date_conf = _pick_entity(entities, INVOICE_DATE_KEYS, prefer_normalized=True)
    amount, amount_conf = _pick_entity(entities, AMOUNT_KEYS, prefer_normalized=True)

    return {
        "invoice_no": invoice_no if invoice_no_conf >= MIN_CONFIDENCE else "",
        "invoice_date": _normalize_date(invoice_date) if invoice_date_conf >= MIN_CONFIDENCE else "",
        "amount": _normalize_amount(amount) if amount_conf >= MIN_CONFIDENCE else "",
        "confidence": {
            "invoice_no": round(invoice_no_conf, 3),
            "invoice_date": round(invoice_date_conf, 3),
            "amount": round(amount_conf, 3),
        },
        "min_confidence": MIN_CONFIDENCE,
        "processor_id": processor_id,
    }


def _get_file_doc_by_url(file_url):
    name = frappe.db.get_value("File", {"file_url": file_url}, "name")
    if not name:
        return None
    return frappe.get_doc("File", name)


def _pick_entity(entities, candidate_keys, prefer_normalized=False):
    """Return (value, confidence) for the highest-confidence entity matching any candidate key."""
    best_value = ""
    best_conf = 0.0
    candidates = {k.lower() for k in candidate_keys}

    for entity in entities or []:
        entity_type = (entity.get("type") or "").lower().strip()
        if entity_type not in candidates:
            continue

        confidence = float(entity.get("confidence") or 0)
        if confidence <= best_conf:
            continue

        normalized = (entity.get("normalized_text") or "").strip()
        mention = (entity.get("mention_text") or "").strip()

        if prefer_normalized:
            value = normalized or mention
        else:
            value = mention or normalized

        if not value:
            continue

        best_value = value
        best_conf = confidence

    return best_value, best_conf


def _normalize_date(value):
    """Normalize a date string into YYYY-MM-DD if possible; otherwise return as-is."""
    if not value:
        return ""

    value = value.strip()

    from datetime import datetime

    candidate_formats = (
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%d %b %Y",
        "%d %B %Y",
        "%d-%b-%Y",
        "%d-%B-%Y",
    )
    for fmt in candidate_formats:
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return value


def _normalize_amount(value):
    """Strip currency symbols and commas; return numeric string, else original."""
    if not value:
        return ""

    cleaned = value.strip().replace(",", "").replace("₹", "").replace("Rs.", "").replace("INR", "").strip()
    try:
        return str(float(cleaned))
    except ValueError:
        return value
