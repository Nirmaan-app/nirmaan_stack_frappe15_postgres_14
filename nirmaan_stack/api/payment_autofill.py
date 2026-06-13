import frappe

from nirmaan_stack.services.extraction import extract
from nirmaan_stack.services.extraction.files import (
    SUPPORTED_EXTS,
    fetch_file_content,
    get_extraction_settings,
)
from nirmaan_stack.services.extraction.helpers import (
    get_file_doc_by_url,
    normalize_amount,
    normalize_date,
    normalize_utr,
    pick_entity,
)

MIN_CONFIDENCE = 0.70

# Rounding tolerance when comparing Transfer_Amount from the receipt against
# the requested payment amount. Banks round paise differently and some receipts
# strip the decimal; ₹2 absorbs that noise without hiding a real discrepancy.
AMOUNT_DELTA = 2.0

UTR_KEYS = ("utr",)
PAYMENT_DATE_KEYS = ("payment_date",)
TRANSFER_AMOUNT_KEYS = ("transfer_amount",)


@frappe.whitelist()
def extract_payment_fields(file_url):
    """Extract UTR, payment date, and transfer amount from a payment receipt.

    Called from the New Payments → Pay dialog when the user selects an
    attachment. Only fields the model could read are returned populated;
    everything else comes back empty for manual entry. The response is never
    persisted server-side.
    """
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

    # Payment receipts have no line-item table — the third return value is always [].
    _, entities, _ = extract(content, file_ext, settings, doc_kind="payment")

    utr, utr_conf = pick_entity(entities, UTR_KEYS)
    payment_date, payment_date_conf = pick_entity(entities, PAYMENT_DATE_KEYS, prefer_normalized=True)
    transfer_amount, transfer_amount_conf = pick_entity(
        entities, TRANSFER_AMOUNT_KEYS, prefer_normalized=True
    )

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
        normalize_amount(transfer_amount) if transfer_amount_conf >= MIN_CONFIDENCE else ""
    )
    validation = _build_validation(file_doc, normalized_transfer_amount)

    return {
        "utr": normalize_utr(utr) if utr_conf >= MIN_CONFIDENCE else "",
        "payment_date": normalize_date(payment_date) if payment_date_conf >= MIN_CONFIDENCE else "",
        "transfer_amount": normalized_transfer_amount,
        "confidence": {
            "utr": round(utr_conf, 3),
            "payment_date": round(payment_date_conf, 3),
            "transfer_amount": round(transfer_amount_conf, 3),
        },
        "entities": all_entities,
        "min_confidence": MIN_CONFIDENCE,
        "processor_id": settings.get("gemini_model"),
        "validation": validation,
    }


def _build_validation(file_doc, extracted_transfer_amount):
    """Return raw values for an amount-mismatch soft-check.

    The frontend does the comparison because the effective expected amount
    depends on TDS (entered after autofill). The server just looks up the gross
    requested amount and surfaces the extracted transfer amount + tolerance so
    the frontend can recompute the match reactively. `applicable` is False for
    anything not attached to a Project Payments row.
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
