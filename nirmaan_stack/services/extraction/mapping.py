# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Targeted Gemini mapper for the line-match residue.

This is a SEPARATE call from extraction — it deliberately does NOT live on
GeminiExtractor, which stays a pure document reader. It proposes invoice-line →
PO item_id pairs only for the leftovers the local fuzzy pass (api/invoices/
_line_match.py) couldn't place. The caller re-verifies every suggestion
numerically before trusting it, so a wrong proposal here can never become a wrong
match. It's a small text-only call (tiny output), so it is not exposed to the
~30s line-items deadline that the document-reading call hits.
"""
from __future__ import annotations

import json

import frappe


def _mapping_schema():
    # nullable po_item_id so the model can honestly say "no credible match".
    return {
        "type": "object",
        "properties": {
            "mappings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "invoice_line_index": {"type": "integer"},
                        "po_item_id": {"type": "string", "nullable": True},
                    },
                },
            }
        },
    }


def _prompt(residue_lines, candidate_po_items) -> str:
    lines_txt = "\n".join(
        f"  [{ln.get('invoice_line_index')}] desc={ln.get('description')!r} "
        f"unit={ln.get('unit')} qty={ln.get('quantity')} rate={ln.get('rate')} "
        f"amount={ln.get('amount')}"
        for ln in residue_lines
    )
    po_txt = "\n".join(
        f"  item_id={po.get('item_id')!r} name={po.get('item_name')!r} "
        f"unit={po.get('unit')} rate={po.get('quote')}"
        for po in candidate_po_items
    )
    return (
        "Reconcile invoice line items to purchase-order items. For each INVOICE "
        "LINE, choose the single best-matching PO ITEM by item_id, using the "
        "description, unit and unit-rate as evidence. If no PO item is a credible "
        "match, return po_item_id = null for that line. NEVER invent an item_id "
        "that is not in the PO list.\n\n"
        f"INVOICE LINES:\n{lines_txt}\n\nPO ITEMS:\n{po_txt}\n"
    )


def gemini_map_residue(residue_lines, candidate_po_items, settings) -> list[dict]:
    """Return [{invoice_line_index, po_item_id|None}] for the residue.

    Best-effort: any failure returns [] (those lines simply stay unmatched). This
    function does not decide matches — the caller (_line_match) ratifies each one.
    """
    if not residue_lines or not candidate_po_items:
        return []
    try:
        from google.genai import types

        from .gemini import GeminiExtractor, _thinking_level

        client = GeminiExtractor()._build_client(settings)
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_mapping_schema(),
            temperature=0,
            thinking_config=types.ThinkingConfig(thinking_level=_thinking_level(settings)),
            http_options=types.HttpOptions(
                timeout=int(settings.get("request_timeout_seconds") or 90) * 1000
            ),
        )
        resp = client.models.generate_content(
            model=settings.get("gemini_model") or "gemini-3.1-pro-preview",
            contents=[_prompt(residue_lines, candidate_po_items)],
            config=config,
        )
        data = json.loads(resp.text or "{}")
        out = data.get("mappings") if isinstance(data, dict) else data
        return out if isinstance(out, list) else []
    except Exception:
        frappe.log_error(
            title="Gemini residue mapping failed", message=frappe.get_traceback()
        )
        return []
