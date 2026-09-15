# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Read an ITNS 281 challan receipt so the Add-New-Challan form arrives pre-filled.

⚠️ "TDS" HERE IS **TAX DEDUCTED AT SOURCE**, not the Technical Data Sheet family.

Sits beside `invoice_autofill` / `payment_autofill` and works identically: read the uploaded file,
hand it to the shared `services/extraction` seam with `doc_kind="tds_challan"`, return only the
fields the model could actually read. NOTHING IS PERSISTED HERE — the response feeds a form the
user can correct, and `api/tds_challan/pay_tds.create_challan_and_pay` is what writes.

TRUST IS COMPUTED, NOT MODEL-REPORTED (the house rule from the invoice flow — a generative model
self-reports ~100% confidence, so its number means nothing). Two deterministic checks carry the
weight here, and they are returned as `validation` for the UI to render as soft warnings:

  * `amount` vs the receipt's own TAX BREAKUP (Tax + Surcharge + Cess + Interest + Penalty + Fee).
    ⚠️ THIS IS THE LOAD-BEARING ONE. The challan amount becomes the CEILING on what can be paid
    against it, so a misread there silently caps every future payment — and it is the one field the
    receipt itself states twice, which is what makes the cross-check possible at all.
  * `financial_year` format. The receipt prints the Assessment Year directly above the Financial
    Year and they differ by one; the prompt says which to take, and this catches it when the model
    takes the other anyway.

⚠️ `mode_of_payment` IS SNAPPED TO THE DOCTYPE'S SELECT OPTIONS, and it has to be. The model returns
the receipt's wording; a value outside the Select's list makes the eventual insert fail Frappe's
own option validation, so an unrecognised mode comes back BLANK for the user to pick rather than
poisoning the create.
"""

import re

import frappe
from frappe.utils import flt

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
    pick_entity,
)

MIN_CONFIDENCE = 0.70

# Rupee tolerance when comparing the stated amount against the summed breakup. The breakup rows are
# whole rupees on every real receipt; ₹1 absorbs a rounding artefact without hiding a real gap.
BREAKUP_DELTA = 1.0

FY_PATTERN = re.compile(r"^(\d{4})-(\d{2})$")

# Must stay in step with `TDS Challan Attachment.mode_of_payment`'s Select options.
MODE_OPTIONS = (
    "Net Banking",
    "Debit Card",
    "RTGS/NEFT",
    "Pay at Bank Counter",
    "Payment Gateway",
)

BREAKUP_KEYS = (
    "breakup_tax",
    "breakup_surcharge",
    "breakup_cess",
    "breakup_interest",
    "breakup_penalty",
    "breakup_fee",
)


def _clean(value) -> str:
    return str(value).strip() if value is not None else ""


def _match_mode(raw: str) -> str:
    """Snap the receipt's wording onto one Select option, or return "" (user picks)."""
    text = re.sub(r"[^a-z]", "", _clean(raw).lower())
    if not text:
        return ""
    for option in MODE_OPTIONS:
        if re.sub(r"[^a-z]", "", option.lower()) == text:
            return option
    # "Internet Banking" / "NetBanking", "NEFT", "Counter" and friends.
    if "net" in text and "bank" in text:
        return "Net Banking"
    if "rtgs" in text or "neft" in text:
        return "RTGS/NEFT"
    if "counter" in text:
        return "Pay at Bank Counter"
    if "debit" in text:
        return "Debit Card"
    if "gateway" in text or "upi" in text:
        return "Payment Gateway"
    return ""


def _financial_year_state(value: str) -> dict:
    """VALID / INVALID / ABSENT — never conflated (the invoice flow's three-state convention)."""
    if not value:
        return {"state": "ABSENT"}
    match = FY_PATTERN.match(value)
    if not match:
        return {"state": "INVALID", "extracted": value, "reason": "format"}
    start, end = int(match.group(1)), int(match.group(2))
    if end != (start + 1) % 100:
        return {"state": "INVALID", "extracted": value, "reason": "not_consecutive"}
    return {"state": "VALID", "extracted": value}


def _amount_state(amount, entities) -> dict:
    """Cross-check the stated amount against the receipt's own Tax Breakup rows."""
    if amount in (None, ""):
        return {"state": "ABSENT"}

    parts, seen_any = 0.0, False
    for key in BREAKUP_KEYS:
        raw, _conf = pick_entity(entities, (key,), prefer_normalized=True)
        if raw in (None, ""):
            continue
        seen_any = True
        parts += flt(normalize_amount(raw) or 0)

    if not seen_any:
        # No breakup table read — nothing to check against, which is ABSENT, not a pass.
        return {"state": "ABSENT", "extracted": flt(amount, 2)}

    stated, summed = flt(amount, 2), flt(parts, 2)
    if abs(stated - summed) <= BREAKUP_DELTA:
        return {"state": "VALID", "extracted": stated, "breakup_total": summed}
    return {
        "state": "INVALID",
        "extracted": stated,
        "breakup_total": summed,
        "delta": flt(stated - summed, 2),
    }


@frappe.whitelist()
def extract_challan_fields(file_url):
    """Extract the challan details from an uploaded ITNS 281 receipt. Persists nothing."""
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

    # A challan receipt has no line-item table — the third return value is always [].
    _, entities, _ = extract(content, file_ext, settings, doc_kind="tds_challan")

    financial_year, fy_conf = pick_entity(entities, ("financial_year",))
    amount_raw, amount_conf = pick_entity(entities, ("amount",), prefer_normalized=True)
    mode_raw, mode_conf = pick_entity(entities, ("mode_of_payment",))
    bank_name, bank_name_conf = pick_entity(entities, ("bank_name",))
    bank_reference_number, bank_ref_conf = pick_entity(entities, ("bank_reference_number",))
    date_of_deposit, deposit_conf = pick_entity(entities, ("date_of_deposit",), prefer_normalized=True)
    bsr_code, bsr_conf = pick_entity(entities, ("bsr_code",))
    challan_no, challan_no_conf = pick_entity(entities, ("challan_no",))
    tender_date, tender_conf = pick_entity(entities, ("tender_date",), prefer_normalized=True)

    amount = normalize_amount(amount_raw) if amount_raw not in (None, "") else ""

    all_entities = [
        {
            "type": (entity.get("type") or "").strip(),
            "value": (entity.get("normalized_text") or entity.get("mention_text") or "").strip(),
            "confidence": round(float(entity.get("confidence") or 0), 3),
        }
        for entity in (entities or [])
        if (entity.get("type") or "").strip()
    ]

    return {
        "financial_year": _clean(financial_year),
        "amount": amount,
        "mode_of_payment": _match_mode(mode_raw),
        "bank_name": _clean(bank_name),
        "bank_reference_number": _clean(bank_reference_number),
        "date_of_deposit": normalize_date(date_of_deposit) if date_of_deposit else "",
        # Strings, never numbers: a BSR code and a challan number keep their leading zeros.
        "bsr_code": _clean(bsr_code),
        "challan_no": _clean(challan_no),
        "tender_date": normalize_date(tender_date) if tender_date else "",
        "confidence": {
            "financial_year": fy_conf,
            "amount": amount_conf,
            "mode_of_payment": mode_conf,
            "bank_name": bank_name_conf,
            "bank_reference_number": bank_ref_conf,
            "date_of_deposit": deposit_conf,
            "bsr_code": bsr_conf,
            "challan_no": challan_no_conf,
            "tender_date": tender_conf,
        },
        "entities": all_entities,
        "min_confidence": MIN_CONFIDENCE,
        "processor_id": settings.get("gemini_model"),
        "validation": {
            "amount": _amount_state(amount, entities),
            "financial_year": _financial_year_state(_clean(financial_year)),
        },
    }
