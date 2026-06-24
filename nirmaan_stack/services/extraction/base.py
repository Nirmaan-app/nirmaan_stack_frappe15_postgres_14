"""Provider-agnostic contract for document field extraction.

Every extractor (Gemini today, others later) returns the SAME (text, entities)
shape Document AI used to return, so all downstream consumers — pick_entity, the
autofill endpoints, _build_validation, _auto_approve — are untouched. Adding a
new provider later is one new module implementing `extract()` plus one line in
the registry in `__init__.py`.
"""
from __future__ import annotations

from typing import Protocol, TypedDict

# doc_kind values
INVOICE = "invoice"
PAYMENT = "payment"
CUSTOMER_PO = "customer_po"


class Entity(TypedDict):
    type: str             # "invoice_id", "total_amount", "supplier_gstin", ...
    mention_text: str     # value as it appears on the document
    normalized_text: str  # normalized value (ISO date / numeric string)
    confidence: float     # 0..1 — generative models don't self-calibrate, so trust
    #                       is computed downstream by services.extraction.validation


class Extractor(Protocol):
    def extract(
        self, content: bytes, file_ext: str, settings: dict, doc_kind: str
    ) -> tuple[str, list[Entity]]:
        """Return (raw_text, entities); raw_text may be '' (no consumer reads it)."""
        ...
