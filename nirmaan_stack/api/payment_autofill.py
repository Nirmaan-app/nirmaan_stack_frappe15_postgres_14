import re

import frappe

from nirmaan_stack.services.cheques.photo import cheque_photo_fields
from nirmaan_stack.services.extraction import extract
from nirmaan_stack.services.extraction.base import CHEQUE
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
from nirmaan_stack.services.role_profiles import assert_cheque_form_access

MIN_CONFIDENCE = 0.70

#: `extract_payment_fields(mode=...)`: a bank-transfer receipt (the default) or a cheque photo.
RECEIPT_MODE = "receipt"
CHEQUE_MODE = "cheque"

# Rounding tolerance when comparing Transfer_Amount from the receipt against
# the requested payment amount. Banks round paise differently and some receipts
# strip the decimal; ₹2 absorbs that noise without hiding a real discrepancy.
AMOUNT_DELTA = 2.0

UTR_KEYS = ("utr",)
PAYMENT_DATE_KEYS = ("payment_date",)
TRANSFER_AMOUNT_KEYS = ("transfer_amount",)
# Used only to verify the receipt's payee matches this payment's vendor (soft
# warning) — never a form field, never persisted.
BENEFICIARY_NAME_KEYS = ("beneficiary_name",)

# Generic words dropped before comparing the receipt beneficiary to the vendor
# name so they don't create spurious token "matches".
_NAME_STOPWORDS = {
    "the", "and", "for", "pvt", "ltd", "limited", "co", "company",
    "enterprises", "enterprise", "traders", "trading", "industries",
}


@frappe.whitelist()
def extract_payment_fields(file_url, mode=RECEIPT_MODE):
    """Extract a payment's details from an uploaded file. Persists nothing.

    `mode="receipt"` (the default) reads a bank-transfer receipt: UTR, payment date and transfer
    amount. Called from the New Payments → Pay dialog when the user selects an attachment.

    `mode="cheque"` reads a photo of one of our paper cheques (spec #1407): bank, bank name,
    cheque number, cheque date, amount and payee, for the Add Cheque form and the PO/WO Request
    Payment dialog. The photo may be attached to nothing yet.

    Only fields the model could read are returned populated; everything else comes back empty
    for manual entry.
    """
    if mode not in (RECEIPT_MODE, CHEQUE_MODE):
        frappe.throw(f"Unknown mode {mode!r}: use {RECEIPT_MODE!r} or {CHEQUE_MODE!r}.")
    file_doc, file_ext, settings, content = _read_file(file_url)
    if mode == CHEQUE_MODE:
        return _cheque_fields(content, file_ext, settings)

    # Payment receipts have no line-item table — the third return value is always [].
    _, entities, _ = extract(content, file_ext, settings, doc_kind="payment")

    utr, utr_conf = pick_entity(entities, UTR_KEYS)
    payment_date, payment_date_conf = pick_entity(entities, PAYMENT_DATE_KEYS, prefer_normalized=True)
    transfer_amount, transfer_amount_conf = pick_entity(
        entities, TRANSFER_AMOUNT_KEYS, prefer_normalized=True
    )
    # Beneficiary is a soft-check only (not gated on confidence, like customer_name).
    beneficiary_name, _ = pick_entity(entities, BENEFICIARY_NAME_KEYS)

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
    validation["vendor_match"] = _build_vendor_match(file_doc, beneficiary_name)

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


def _read_file(file_url):
    """The uploaded file's File record, extension, the extraction settings and its bytes."""
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
    return file_doc, file_ext, settings, content


def _cheque_fields(content, file_ext, settings):
    """The Add Cheque form's values read off a cheque photo; empty where the photo is unsure."""
    _, entities, _ = extract(content, file_ext, settings, doc_kind=CHEQUE)

    def read(key):
        value, confidence = pick_entity(entities, (key,))
        return value if confidence >= MIN_CONFIDENCE else ""

    return {
        **cheque_photo_fields(
            bank_name=read("bank_name"),
            micr_line=read("micr_line"),
            cheque_date=read("cheque_date"),
            amount_in_figures=read("amount_in_figures"),
            payee=read("payee"),
        ),
        "processor_id": settings.get("gemini_model"),
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


def _build_vendor_match(file_doc, extracted_beneficiary):
    """Soft check that the receipt's beneficiary matches this payment's vendor.

    The beneficiary printed on a bank-transfer receipt is the credited account
    holder, i.e. the vendor's bank `account_name` — often not the vendor's display
    `vendor_name`. So the beneficiary is fuzzy-compared against BOTH and matches if
    it hits EITHER, which keeps the soft warning from crying wolf. Returns
    {expected_name, expected_account_name, extracted, match, by} where match is
    True/False/None ("can't verify") — a missing vendor or an unreadable
    beneficiary reads as None, never a mismatch. Never persisted server-side.
    """
    parent_doctype = (file_doc.attached_to_doctype or "").strip()
    parent_name = (file_doc.attached_to_name or "").strip()
    vendor = None
    if parent_doctype == "Project Payments" and parent_name:
        try:
            vendor = frappe.db.get_value("Project Payments", parent_name, "vendor")
        except Exception:
            vendor = None
    return _vendor_match(vendor, extracted_beneficiary)


@frappe.whitelist()
def match_payee_to_vendor(payee, vendor):
    """Soft check that the payee read off a cheque photo looks like the Vendor picked for the cheque.

    Called by the cheque forms whenever the photo's payee or the picked Vendor changes, so it does
    not matter which the user fills first. A mismatch is a warning only and never blocks a save.
    Returns the same shape as a receipt's `validation.vendor_match`:
    {expected_name, expected_account_name, extracted, match, by}, with match True/False/None.

    Only for people who fill a cheque form (`assert_cheque_form_access`): the answer names the Vendor's
    bank account holder.
    """
    assert_cheque_form_access(frappe.session.user)
    return _vendor_match(vendor, payee)


def _vendor_match(vendor, extracted):
    """`extracted` (a name read off a document) fuzzy-compared with the Vendor's display name and its
    bank account holder name; a hit on EITHER is a match. No vendor or no name is None, never False."""
    result = {
        "expected_name": "",
        "expected_account_name": "",
        "extracted": (extracted or "").strip(),
        "match": None,
        "by": None,
    }
    if not vendor:
        return result  # no vendor → nothing to compare

    try:
        vendor_name, account_name = frappe.db.get_value(
            "Vendors", vendor, ["vendor_name", "account_name"]
        ) or ("", "")
    except Exception:
        return result
    result["expected_name"] = (vendor_name or "").strip()
    result["expected_account_name"] = (account_name or "").strip()

    # Match if the beneficiary hits EITHER the display name or the bank account
    # holder name. match stays None ("can't verify") only when both comparisons
    # are unverifiable; False needs at least one clearly-different name.
    by_name = _names_match(result["expected_name"], result["extracted"])
    by_account = _names_match(result["expected_account_name"], result["extracted"])
    if by_name or by_account:
        result["match"] = True
        result["by"] = "vendor_name" if by_name else "account_name"
    elif by_name is False or by_account is False:
        result["match"] = False
    return result


def _name_tokens(value):
    """Meaningful (≥3-char, non-stopword) lowercase tokens from a name."""
    cleaned = re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()
    return {t for t in cleaned.split() if len(t) >= 3 and t not in _NAME_STOPWORDS}


def _names_match(expected, extracted):
    """Lenient fuzzy match of two names (soft warning, so bias toward NOT crying wolf).

    Normalizes each side to lowercase + non-alphanumerics stripped, then:
    None  → can't verify (either side empty after normalization, or only weak tokens).
    True  → equal, one contains the other, or they share a meaningful token.
    False → no overlap at all (a clearly different party).
    """
    norm_e = re.sub(r"[^a-z0-9]+", " ", (expected or "").lower()).strip()
    norm_x = re.sub(r"[^a-z0-9]+", " ", (extracted or "").lower()).strip()
    if not norm_e or not norm_x:
        return None
    if norm_e == norm_x or norm_e in norm_x or norm_x in norm_e:
        return True
    tokens_e, tokens_x = _name_tokens(expected), _name_tokens(extracted)
    if not tokens_e or not tokens_x:
        return None  # only stopwords/short tokens — not enough signal to judge
    return bool(tokens_e & tokens_x)
