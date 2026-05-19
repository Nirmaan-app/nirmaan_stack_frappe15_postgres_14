import re

import frappe

from nirmaan_stack.api.invoices._validation import (
    existing_invoiced_sum,
    gstin_match,
)
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
# `total_amount` (grand total, incl. tax) — never fall back to `net_amount`
# because the form field labeled "Amount (Incl. GST)" must always be the
# tax-inclusive total. If V1-base misses total_amount, leave it blank.
AMOUNT_KEYS = ("total_amount",)
# `net_amount` (pre-tax subtotal) — surfaced separately for forms that have
# a distinct "Amount (Excl. GST)" field (currently Project Invoices).
NET_AMOUNT_KEYS = ("net_amount",)


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
    net_amount, net_amount_conf = _pick_entity(entities, NET_AMOUNT_KEYS, prefer_normalized=True)
    supplier_gstin, _ = _pick_entity(entities, ("supplier_gstin",))
    receiver_gstin, _ = _pick_entity(entities, ("receiver_gstin",))

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

    normalized_amount = _normalize_amount(amount) if amount_conf >= MIN_CONFIDENCE else ""
    normalized_net_amount = _normalize_amount(net_amount) if net_amount_conf >= MIN_CONFIDENCE else ""
    validation = _build_validation(file_doc, normalized_amount, supplier_gstin, receiver_gstin)

    return {
        "invoice_no": invoice_no if invoice_no_conf >= MIN_CONFIDENCE else "",
        "invoice_date": _normalize_date(invoice_date) if invoice_date_conf >= MIN_CONFIDENCE else "",
        "amount": normalized_amount,
        "net_amount": normalized_net_amount,
        # Surface the raw extracted GSTINs so the frontend can persist them to
        # the Vendor Invoice on submit (auto-approve gates 6 & 7 read them
        # from dedicated columns instead of re-parsing autofill_all_entities_json).
        "supplier_gstin": (supplier_gstin or "").strip(),
        "receiver_gstin": (receiver_gstin or "").strip(),
        "confidence": {
            "invoice_no": round(invoice_no_conf, 3),
            "invoice_date": round(invoice_date_conf, 3),
            "amount": round(amount_conf, 3),
            "net_amount": round(net_amount_conf, 3),
        },
        "entities": all_entities,
        "min_confidence": MIN_CONFIDENCE,
        "processor_id": processor_id,
        "validation": validation,
    }


def _build_validation(file_doc, extracted_amount, extracted_supplier_gstin, extracted_receiver_gstin):
    """Compute validation status against the parent PO (no-op for non-PO docs).

    Returns a dict with three sub-blocks (amount, supplier_gstin, receiver_gstin).
    Each sub-block has `match` (bool), `expected`, `extracted`, and a
    user-facing `message`. Frontend uses these to surface inline warnings and
    block submit on amount overage.
    """
    parent_doctype = (file_doc.attached_to_doctype or "").strip()
    parent_name = (file_doc.attached_to_name or "").strip()

    result = {
        "applicable": False,
        "doctype": parent_doctype,
        "docname": parent_name,
        "amount": None,
        "supplier_gstin": None,
        "receiver_gstin": None,
    }

    # Only POs have full validation context; SR / other doctypes skip validation.
    if parent_doctype != "Procurement Orders" or not parent_name:
        return result

    try:
        po = frappe.db.get_value(
            "Procurement Orders",
            parent_name,
            ["total_amount", "project_gst", "vendor"],
            as_dict=True,
        )
    except Exception:
        return result
    if not po:
        return result

    result["applicable"] = True

    # --- Amount overage check ---
    po_total = float(po.get("total_amount") or 0)
    existing_sum = existing_invoiced_sum(parent_name)
    new_amount = 0.0
    try:
        new_amount = float(extracted_amount) if extracted_amount else 0.0
    except (TypeError, ValueError):
        new_amount = 0.0
    would_be_total = existing_sum + new_amount
    # Tolerate up to ₹10 of rounding drift — must match the hard-block threshold
    # in update_invoice_data._check_po_amount_overage. Tighter checks triggered
    # false positives on real invoices with ₹0.10–₹5 GST/freight rounding.
    would_exceed = po_total > 0 and would_be_total > po_total + 10
    result["amount"] = {
        "po_total": round(po_total, 2),
        "existing_invoiced_sum": round(existing_sum, 2),
        "new_amount": round(new_amount, 2),
        "would_be_total": round(would_be_total, 2),
        "would_exceed": would_exceed,
        "message": (
            f"Total invoiced would be ₹{would_be_total:,.2f}, exceeds PO total "
            f"₹{po_total:,.2f}. Revise the amount or upload less."
            if would_exceed
            else None
        ),
    }

    # --- Supplier GSTIN check (extracted vs vendor's vendor_gst) ---
    vendor_gst = ""
    if po.get("vendor"):
        vendor_gst = (frappe.db.get_value("Vendors", po["vendor"], "vendor_gst") or "").strip()
    result["supplier_gstin"] = gstin_match(
        extracted_supplier_gstin, vendor_gst, "supplier"
    )

    # --- Receiver GSTIN check (extracted vs PO.project_gst) ---
    project_gst = (po.get("project_gst") or "").strip()
    result["receiver_gstin"] = gstin_match(
        extracted_receiver_gstin, project_gst, "receiver"
    )

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
