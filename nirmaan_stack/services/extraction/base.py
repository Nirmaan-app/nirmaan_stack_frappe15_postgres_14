"""Provider-agnostic contract for document field extraction.

Every extractor (Gemini today, others later) returns the SAME (text, entities,
line_items) shape, so all downstream consumers of the flat `entities` list —
pick_entity, the autofill endpoints, _build_validation, _auto_approve — are
untouched. Adding a new provider later is one new module implementing `extract()`
plus one line in the registry in `__init__.py`.

`line_items` is a DEDICATED channel for nested tabular data (invoice line items).
It is intentionally NOT folded into `entities` — the entity list stays flat and
scalar so the existing scalar consumers never see the nested rows. Only the
invoice doc_kind populates it; payment returns [].
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


class LineItem(TypedDict, total=False):
    """One row of an invoice's item table. Every field is optional — an absent
    cell is None (never fabricated). `amount` is the line's taxable value (pre-tax)
    so it reconciles against the extracted net_amount and the PO item's `amount`.
    """
    description: str | None
    unit: str | None
    quantity: float | None
    rate: float | None
    amount: float | None
    tax_rate: float | None
    discount: float | None


class Extractor(Protocol):
    def extract(
        self, content: bytes, file_ext: str, settings: dict, doc_kind: str
    ) -> tuple[str, list[Entity], list[LineItem]]:
        """Return (raw_text, entities, line_items).

        raw_text may be '' (no consumer reads it). line_items is [] for any
        doc_kind that has no tabular data (e.g. payment receipts).
        """
        ...
