# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Shared, provider-agnostic helpers for the autofill endpoints.

These were previously copy-pasted byte-for-byte between invoice_autofill.py and
payment_autofill.py. Centralised here so a fix (e.g. a new date format) lands
once for every flow.
"""
from __future__ import annotations

import re
from datetime import datetime

import frappe


def get_file_doc_by_url(file_url):
    name = frappe.db.get_value("File", {"file_url": file_url}, "name")
    if not name:
        return None
    return frappe.get_doc("File", name)


def pick_entity(entities, candidate_keys, prefer_normalized=False):
    """Return (value, confidence) for the highest-confidence entity matching any key.

    Works identically for Document AI's multi-entity output and Gemini's
    one-entity-per-type output (the loop just finds the single match).
    """
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
        value = (normalized or mention) if prefer_normalized else (mention or normalized)
        if not value:
            continue

        best_value = value
        best_conf = confidence

    return best_value, best_conf


_DATE_FORMATS = (
    "%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%m/%d/%Y",
    "%d %b %Y", "%d %B %Y", "%d-%b-%Y", "%d-%B-%Y", "%b %d, %Y", "%B %d, %Y",
    "%d %b, %Y", "%d %B, %Y", "%d-%b-%y", "%d/%m/%y",
)


def normalize_date(value):
    """Normalize a date string into YYYY-MM-DD; '' when unparseable.

    Returns '' rather than the raw string so the frontend's HTML
    <input type="date"> (which silently rejects non-ISO values) stays blank for
    manual entry instead of dropping a malformed value.
    """
    if not value:
        return ""
    value = str(value).strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return ""


def normalize_amount(value):
    """Return a parseable numeric string or '' if value can't be cleanly parsed."""
    if value is None or value == "":
        return ""
    cleaned = re.sub(r"[^\d.\-]", "", str(value).strip())
    if not cleaned or not re.search(r"\d", cleaned):
        return ""
    try:
        return str(float(cleaned))
    except ValueError:
        return ""


def normalize_utr(value):
    """Strip surrounding and internal whitespace from a UTR.

    Banks pretty-print UTRs in 4-char chunks; the uniqueness check compares exact
    strings, so collapse whitespace before returning.
    """
    if not value:
        return ""
    return re.sub(r"\s+", "", str(value).strip())
