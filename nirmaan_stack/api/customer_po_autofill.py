import json
import re

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
    pick_entity,
)

MIN_CONFIDENCE = 0.70

# Keys match the "Customer PO Child Table" doctype fields 1:1.
PO_NUMBER_KEYS = ("customer_po_number",)
PO_DATE_KEYS = ("customer_po_date",)
PO_VALUE_INCTAX_KEYS = ("customer_po_value_inctax",)
PO_VALUE_EXCTAX_KEYS = ("customer_po_value_exctax",)
# Used only to verify the PO belongs to this project (not a form field).
PROJECT_REF_KEYS = ("project_reference",)
# Used only to verify the PO's ISSUER matches this project's customer (not form fields).
CUSTOMER_NAME_KEYS = ("customer_name",)
CUSTOMER_GSTIN_KEYS = ("customer_gstin",)
# Payment schedule rows → fill the dialog's Payment Terms section.
PAYMENT_TERMS_KEYS = ("payment_terms",)

# Generic words stripped before comparing the PO's project reference to the
# project name, so they don't create spurious "matches".
_NAME_STOPWORDS = {
    "the", "and", "for", "pvt", "ltd", "limited", "project",
    "po", "purchase", "order", "site", "works", "work",
}


@frappe.whitelist()
def extract_customer_po_fields(file_url, project_name=None):
    """Extract PO number + tax-inclusive/exclusive values from a customer PO file.

    Called from the Add Customer PO dialog when the user attaches a PO file. Only
    fields the model could read are returned populated; everything else comes
    back empty for manual entry. Mirrors payment_autofill (the simple variant —
    no GSTIN checks, no reconciliation, no auto-approve). The response is never
    persisted server-side.

    When `project_name` (the Projects docname) is passed, a soft project-match
    check compares the project reference read off the PO against the project's
    display name and surfaces the result in `validation.project_match` — the
    frontend renders it as a non-blocking warning.
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

    _, entities = extract(content, file_ext, settings, doc_kind="customer_po")

    po_number, po_number_conf = pick_entity(entities, PO_NUMBER_KEYS)
    po_date, po_date_conf = pick_entity(entities, PO_DATE_KEYS)
    value_inctax, value_inctax_conf = pick_entity(
        entities, PO_VALUE_INCTAX_KEYS, prefer_normalized=True
    )
    value_exctax, value_exctax_conf = pick_entity(
        entities, PO_VALUE_EXCTAX_KEYS, prefer_normalized=True
    )
    project_reference, _ = pick_entity(entities, PROJECT_REF_KEYS)
    customer_name, _ = pick_entity(entities, CUSTOMER_NAME_KEYS)
    customer_gstin, _ = pick_entity(entities, CUSTOMER_GSTIN_KEYS)
    payment_terms_raw, _ = pick_entity(entities, PAYMENT_TERMS_KEYS)
    payment_terms = _parse_payment_terms(payment_terms_raw)

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
        "customer_po_number": po_number if po_number_conf >= MIN_CONFIDENCE else "",
        # Date normalized to YYYY-MM-DD for the <input type="date"> ('' if unparseable).
        "customer_po_date": (
            normalize_date(po_date) if po_date_conf >= MIN_CONFIDENCE else ""
        ),
        "customer_po_value_inctax": (
            normalize_amount(value_inctax) if value_inctax_conf >= MIN_CONFIDENCE else ""
        ),
        "customer_po_value_exctax": (
            normalize_amount(value_exctax) if value_exctax_conf >= MIN_CONFIDENCE else ""
        ),
        "payment_terms": payment_terms,
        "confidence": {
            "customer_po_number": round(po_number_conf, 3),
            "customer_po_date": round(po_date_conf, 3),
            "customer_po_value_inctax": round(value_inctax_conf, 3),
            "customer_po_value_exctax": round(value_exctax_conf, 3),
        },
        "validation": {
            "project_match": _build_project_match(project_name, project_reference),
            "customer_match": _build_customer_match(project_name, customer_name, customer_gstin),
        },
        "entities": all_entities,
        "min_confidence": MIN_CONFIDENCE,
        "processor_id": settings.get("gemini_model"),
    }


def _parse_payment_terms(raw):
    """Parse the payment_terms JSON-string entity into a clean list of dicts.

    Each row matches the dialog's PaymentTerm shape: {label, percentage,
    description}. Returns [] on absent / unparseable / non-list input — the
    Payment Terms section just stays empty for manual entry.
    """
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return []
    if not isinstance(parsed, list):
        return []
    terms = []
    for t in parsed:
        if not isinstance(t, dict):
            continue
        label = str(t.get("label") or "").strip()
        description = str(t.get("description") or "").strip()
        if not (label or description):
            continue  # skip empty rows
        terms.append({
            "label": label,
            "percentage": t.get("percentage") or 0,
            "description": description,
        })
    return terms


def _build_project_match(project_name, extracted_reference):
    """Soft check that the uploaded PO is for `project_name` (the Projects docname).

    Compares the project reference read off the PO against the project's display
    name (`Projects.project_name`). Returns {expected, extracted, match} where
    match is True/False, or None when there's nothing to compare ("can't verify")
    — a missing reference must never be reported as a confirmed mismatch.
    """
    result = {"expected": "", "extracted": (extracted_reference or "").strip(), "match": None}
    if not project_name:
        return result

    try:
        expected = frappe.db.get_value("Projects", project_name, "project_name") or ""
    except Exception:
        return result
    result["expected"] = expected.strip()

    result["match"] = _names_match(result["expected"], result["extracted"])
    return result


def _build_customer_match(project_name, extracted_name, extracted_gstin):
    """Soft check that the PO's ISSUER matches this project's customer.

    Decision is NAME-ONLY: the customer name read off the PO is fuzzy-compared to the
    project's customer doc name (`Customers.company_name`). GSTIN is captured for
    reference only — NOT used to decide a mismatch, because a company's per-state
    GSTINs differ and that caused false "different customer" flags. Returns
    {expected_name, extracted_name, expected_gstin, extracted_gstin, match, by} where
    match is True/False/None ("can't verify") — a missing customer or an unreadable
    name reads as None, never a mismatch.
    """
    result: dict = {
        "expected_name": "",
        "extracted_name": (extracted_name or "").strip(),
        "expected_gstin": "",
        "extracted_gstin": (extracted_gstin or "").strip(),
        "match": None,
        "by": None,
    }
    if not project_name:
        return result

    try:
        customer = frappe.db.get_value("Projects", project_name, "customer")
    except Exception:
        return result
    if not customer:
        return result  # project has no customer set → nothing to compare

    try:
        expected_name, expected_gstin = frappe.db.get_value(
            "Customers", customer, ["company_name", "company_gst"]
        ) or ("", "")
    except Exception:
        return result
    result["expected_name"] = (expected_name or "").strip()
    result["expected_gstin"] = (expected_gstin or "").strip()

    # Name-only decision: compare the PO's customer name to the project's customer
    # doc name (Customers.company_name). GSTIN is NOT consulted — per-state GSTINs of
    # the same company differ and produced false "different customer" flags.
    result["match"] = _names_match(result["expected_name"], result["extracted_name"])
    result["by"] = "name" if result["match"] is not None else None
    return result


def _name_tokens(value):
    cleaned = re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()
    return {t for t in cleaned.split() if len(t) >= 3 and t not in _NAME_STOPWORDS}


def _names_match(expected, extracted):
    """Lenient fuzzy match (soft warning, so bias toward NOT crying wolf).

    None  → can't verify (either side empty after normalization).
    True  → equal, one contains the other, or they share a meaningful token.
    False → no overlap at all (a clearly different project).
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
