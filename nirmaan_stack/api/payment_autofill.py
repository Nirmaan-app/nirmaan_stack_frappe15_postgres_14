import re

import frappe

from nirmaan_stack.services.document_ai import (
    SUPPORTED_EXTS,
    extract_with_document_ai,
    fetch_file_content,
    get_document_ai_settings,
)

MIN_CONFIDENCE = 0.70

# Rounding tolerance when comparing Transfer_Amount from the receipt against
# the requested payment amount. Banks sometimes round paise differently and
# some receipts strip the decimal; ₹2 absorbs that noise without hiding a
# real discrepancy.
AMOUNT_DELTA = 2.0

UTR_KEYS = ("utr",)
PAYMENT_DATE_KEYS = ("payment_date",)
TRANSFER_AMOUNT_KEYS = ("transfer_amount",)


@frappe.whitelist()
def extract_payment_fields(file_url):
    """Extract UTR and payment date from an uploaded payment receipt.

    Called from the New Payments → Pay dialog when the user selects an
    attachment. Routes through the Expense Processor (custom-trained on
    bank-transfer receipts) regardless of how the Document AI Settings
    target-doctype lists are configured — this endpoint is hard-coded to
    expense_processor_id because the receipt format is distinct from
    invoices.

    Only fields with confidence >= MIN_CONFIDENCE are returned populated;
    lower-confidence fields are returned as empty strings so the frontend
    leaves them blank for manual entry.
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

    processor_id = (settings.get("expense_processor_id") or "").strip()
    if not processor_id:
        frappe.throw("No Expense Processor configured. Set expense_processor_id in Document AI Settings.")

    content = fetch_file_content(file_doc, file_doc.name)
    if not content:
        frappe.throw("Could not read file content.")

    try:
        _, entities = extract_with_document_ai(content, file_ext, settings, processor_id)
    except Exception as exc:
        frappe.log_error(
            title=f"Payment Autofill Error: {file_doc.name}",
            message=frappe.get_traceback(),
        )
        frappe.throw(f"Document AI extraction failed: {exc}")

    utr, utr_conf = _pick_entity(entities, UTR_KEYS)
    payment_date, payment_date_conf = _pick_entity(entities, PAYMENT_DATE_KEYS, prefer_normalized=True)
    transfer_amount, transfer_amount_conf = _pick_entity(entities, TRANSFER_AMOUNT_KEYS, prefer_normalized=True)

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

    normalized_transfer_amount = (
        _normalize_amount(transfer_amount) if transfer_amount_conf >= MIN_CONFIDENCE else ""
    )
    validation = _build_validation(file_doc, normalized_transfer_amount)

    return {
        "utr": _normalize_utr(utr) if utr_conf >= MIN_CONFIDENCE else "",
        "payment_date": _normalize_date(payment_date) if payment_date_conf >= MIN_CONFIDENCE else "",
        "transfer_amount": normalized_transfer_amount,
        "confidence": {
            "utr": round(utr_conf, 3),
            "payment_date": round(payment_date_conf, 3),
            "transfer_amount": round(transfer_amount_conf, 3),
        },
        "entities": all_entities,
        "min_confidence": MIN_CONFIDENCE,
        "processor_id": processor_id,
        "validation": validation,
    }


def _build_validation(file_doc, extracted_transfer_amount):
    """Return raw values for an amount-mismatch soft-check.

    The frontend does the actual comparison because the effective expected
    amount depends on TDS (which is entered after autofill runs). The server
    just looks up the gross requested amount and surfaces the extracted
    transfer amount + tolerance so the frontend can recompute the match
    reactively as the user types TDS.

    If the file isn't attached to a Project Payments row, `applicable` is
    False and the frontend hides the banner.
    """
    parent_doctype = (file_doc.attached_to_doctype or "").strip()
    parent_name = (file_doc.attached_to_name or "").strip()

    result = {
        "applicable": False,
        "doctype": parent_doctype,
        "docname": parent_name,
        "amount": None,
    }

    if parent_doctype != "Project Payments" or not parent_name:
        return result

    try:
        expected_amount = frappe.db.get_value("Project Payments", parent_name, "amount")
    except Exception:
        return result
    if expected_amount is None:
        return result

    try:
        expected = float(expected_amount or 0)
    except (TypeError, ValueError):
        expected = 0.0

    extracted = None
    if extracted_transfer_amount:
        try:
            extracted = round(float(extracted_transfer_amount), 2)
        except (TypeError, ValueError):
            extracted = None

    result["applicable"] = True
    result["amount"] = {
        "expected": round(expected, 2),
        "extracted": extracted,
        "delta_threshold": AMOUNT_DELTA,
    }
    return result


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


def _normalize_utr(value):
    """Strip surrounding whitespace and internal spaces from a UTR string.

    Banks sometimes pretty-print UTRs with spaces every 4 chars; the
    backend uniqueness check compares exact strings, so we collapse
    whitespace before returning.
    """
    if not value:
        return ""
    return re.sub(r"\s+", "", value.strip())


def _normalize_date(value):
    """Normalize a date string into YYYY-MM-DD for an HTML <input type='date'>."""
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
    return ""


def _normalize_amount(value):
    """Return a parseable numeric string or '' if value can't be cleanly parsed."""
    if not value:
        return ""

    cleaned = re.sub(r"[^\d.\-]", "", value.strip())
    if not cleaned or not re.search(r"\d", cleaned):
        return ""

    try:
        return str(float(cleaned))
    except ValueError:
        return ""
