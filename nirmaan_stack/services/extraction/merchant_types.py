# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Gemini picks an expense type for each card merchant, from a list it is given (#1569, ADR-0039 ruling 5).

A text-only call, separate from the document reader (as `mapping.gemini_map_residue` is): one request for
every merchant of a card statement that merchant memory does not know. It only PROPOSES: the caller
(`card_types.choose_type`) refuses an answer off the live list or below the confidence floor, so a wrong or
invented answer can never become a type.
"""

from __future__ import annotations

import frappe

from .gemini import GeminiExtractor, _thinking_level


def _schema():
    return {
        "type": "object",
        "properties": {
            "answers": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "merchant": {"type": "string"},
                        "expense_type": {"type": "string", "nullable": True},
                        "confidence": {"type": "number"},
                    },
                },
            }
        },
    }


def _prompt(merchants: dict[str, str], expense_types: list[str]) -> str:
    merchant_lines = "\n".join(f"  {key!r} (as printed: {example!r})" for key, example in merchants.items())
    type_lines = "\n".join(f"  {name}" for name in expense_types)
    return (
        "These merchants were paid with a company credit card of an Indian construction company. For each "
        "MERCHANT, choose the single EXPENSE TYPE that best describes what the company most likely bought from "
        "it. Use ONLY a type exactly as written in the list. If none fits, or you cannot tell what the merchant "
        "sells, return expense_type = null. Give a confidence from 0 to 1 that the type is right. Answer every "
        "merchant once, with its name exactly as given.\n\n"
        f"MERCHANTS:\n{merchant_lines}\n\nEXPENSE TYPES:\n{type_lines}\n"
    )


def gemini_type_merchants(
    merchants: dict[str, str], expense_types: list[str], settings
) -> dict[str, tuple[str | None, float]] | None:
    """`{merchant: (expense_type or None, confidence)}` for each merchant Gemini answered.

    `merchants` maps each merchant key to one transaction description of it, as printed. Returns None when
    the call fails (logged): the caller types every merchant as it would with no answer.
    """
    if not merchants:
        return {}
    try:
        from google.genai import types

        extractor = GeminiExtractor()
        client = extractor._build_client(settings)
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_schema(),
            temperature=0,
            thinking_config=types.ThinkingConfig(thinking_level=_thinking_level(settings)),
            http_options=types.HttpOptions(timeout=int(settings.get("request_timeout_seconds") or 90) * 1000),
        )
        data = extractor._generate(
            client,
            settings.get("gemini_model") or "gemini-3.1-pro-preview",
            [_prompt(merchants, expense_types)],
            config,
        )
        return read_answers(data, merchants)
    except Exception:
        frappe.log_error(title="Card merchant typing failed", message=frappe.get_traceback())
        return None


def read_answers(data, merchants) -> dict[str, tuple[str | None, float]]:
    """Gemini's reply, kept to the merchants asked about; anything malformed is left out."""
    answers = data.get("answers") if isinstance(data, dict) else None
    out: dict[str, tuple[str | None, float]] = {}
    for answer in answers if isinstance(answers, list) else []:
        if not isinstance(answer, dict) or answer.get("merchant") not in merchants:
            continue
        try:
            confidence = float(answer.get("confidence") or 0)
        except (TypeError, ValueError):
            confidence = 0.0
        expense_type = answer.get("expense_type")
        out[answer["merchant"]] = (expense_type if isinstance(expense_type, str) else None, confidence)
    return out
