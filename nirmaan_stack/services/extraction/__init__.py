"""Modular document-extraction seam.

`extract(content, file_ext, settings, doc_kind)` dispatches to the configured
provider. Today there is one provider (Gemini); adding another is one module
implementing base.Extractor plus one entry in _PROVIDERS.
"""
from __future__ import annotations

import frappe

from .gemini import GeminiExtractor

# provider key (lower-case) -> extractor class
_PROVIDERS = {"gemini": GeminiExtractor}


def get_extractor(settings):
    name = (settings.get("provider") or "gemini").strip().lower()
    cls = _PROVIDERS.get(name)
    if not cls:
        frappe.throw(f"Unknown extraction provider: {name}")
    return cls()


def extract(content, file_ext, settings, doc_kind):
    """Return (raw_text, entities) from the configured provider."""
    return get_extractor(settings).extract(content, file_ext, settings, doc_kind)
