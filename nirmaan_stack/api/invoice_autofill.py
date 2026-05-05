import re

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
# Only `total_amount` (grand total, incl. tax) — must NOT fall back to
# `net_amount` (pre-tax subtotal) since the form field is "Amount (incl. GST)".
# If V1-base misses total_amount, we'd rather leave it blank than fill the wrong value.
AMOUNT_KEYS = ("total_amount",)


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

    # Slimmed-down view of every entity Document AI returned. Persisted on
    # Vendor Invoices so reviewers can see the full extraction (supplier_name,
    # supplier_gstin, total_tax_amount, purchase_order, etc.) without paying
    # the cost of re-running extraction.
    all_entities = [
        {
            "type": (entity.get("type") or "").strip(),
            "value": (entity.get("normalized_text") or entity.get("mention_text") or "").strip(),
            "confidence": round(float(entity.get("confidence") or 0), 3),
        }
        for entity in (entities or [])
        if (entity.get("type") or "").strip()
        and ((entity.get("normalized_text") or entity.get("mention_text") or "").strip())
    ]

    return {
        "invoice_no": invoice_no if invoice_no_conf >= MIN_CONFIDENCE else "",
        "invoice_date": _normalize_date(invoice_date) if invoice_date_conf >= MIN_CONFIDENCE else "",
        "amount": _normalize_amount(amount) if amount_conf >= MIN_CONFIDENCE else "",
        "confidence": {
            "invoice_no": round(invoice_no_conf, 3),
            "invoice_date": round(invoice_date_conf, 3),
            "amount": round(amount_conf, 3),
        },
        "entities": all_entities,
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
    """Normalize a date string into YYYY-MM-DD.

    The frontend renders the date in an HTML <input type="date"> which silently
    rejects values not in YYYY-MM-DD format. So if we can't normalize, return
    "" rather than the raw string — better to leave the field blank for manual
    entry than to silently drop a non-parseable value into the form.
    """
    if not value:
        return ""

    value = value.strip()

    from datetime import datetime

    candidate_formats = (
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%d.%m.%Y",
        "%m/%d/%Y",
        "%d %b %Y",
        "%d %B %Y",
        "%d-%b-%Y",
        "%d-%B-%Y",
        "%b %d, %Y",
        "%B %d, %Y",
        "%d %b, %Y",
        "%d %B, %Y",
        "%d-%b-%y",
        "%d/%m/%y",
    )
    for fmt in candidate_formats:
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    # Unparseable → return empty so the form field stays blank instead of
    # silently rendering an empty date input from a malformed string.
    return ""


def _normalize_amount(value):
    """Return a parseable numeric string or "" if value can't be cleanly parsed.

    Document AI sometimes returns junk in OCR'd amount values — for example,
    a footnote marker bleeding from a duplicate-copy page (e.g. ``*2,124.00``)
    or stray characters from multi-page invoices. The frontend's amount input
    regex blocks edits on non-numeric strings, so an empty field (which the
    user can fill manually) is strictly better than a non-editable wrong value.

    Strategy: keep only digits, dot, and a leading minus; return empty on any
    parse failure.
    """
    if not value:
        return ""

    cleaned = re.sub(r"[^\d.\-]", "", value.strip())
    if not cleaned or not re.search(r"\d", cleaned):
        return ""

    try:
        return str(float(cleaned))
    except ValueError:
        return ""
