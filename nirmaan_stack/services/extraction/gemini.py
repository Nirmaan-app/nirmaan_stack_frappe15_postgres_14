# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Gemini-backed document extractor.

Returns the same (text, entities) contract Document AI returned, so the autofill
endpoints, normalization, PO validation and auto-approve are untouched. Trust is
NOT taken from the model (it self-reports ~100%); confidence here is 1.0 for any
present field and the deterministic layer (validation.py) decides what to trust.
"""
from __future__ import annotations

import json
import time
from functools import lru_cache

import frappe

from .base import INVOICE, Entity
from .files import MIME_TYPES, get_gemini_api_key
from .validation import is_absent

_MAX_RETRIES = 2
_BACKOFF_SECONDS = 1.5
_TRANSIENT_MARKERS = (
    "UNAVAILABLE", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED", "INTERNAL",
    "503", "502", "500", "429",
)

# Form-bearing fields + validation-only fields (round_off / other_charges /
# tcs_amount feed reconciliation; they are never populated into the form).
_INVOICE_FIELDS = (
    "invoice_id", "invoice_date", "purchase_order", "supplier_gstin",
    "receiver_gstin", "supplier_name", "net_amount", "total_tax_amount",
    "total_amount", "round_off", "other_charges", "tcs_amount",
)
_PAYMENT_FIELDS = ("utr", "payment_date", "transfer_amount")
_NUMERIC = {
    "net_amount", "total_tax_amount", "total_amount", "round_off",
    "other_charges", "tcs_amount", "transfer_amount",
}

_MEDIA_RESOLUTION = {
    "low": "MEDIA_RESOLUTION_LOW",
    "medium": "MEDIA_RESOLUTION_MEDIUM",
    "high": "MEDIA_RESOLUTION_HIGH",
}

_INVOICE_PROMPT = (
    "Extract the listed fields from this Indian tax invoice and return JSON only.\n"
    "- supplier_gstin = the seller's/vendor's 15-char GSTIN; receiver_gstin = the "
    "buyer's GSTIN.\n"
    "- net_amount = taxable value before GST; total_tax_amount = total GST; "
    "total_amount = grand total including GST and any other charges.\n"
    "- round_off, other_charges (freight/packing/insurance), tcs_amount: include "
    "only if shown on the invoice.\n"
    "- Dates in YYYY-MM-DD format.\n"
    "- If a field is not clearly present, return JSON null. Do NOT guess and do "
    'NOT output the string "null".'
)
_PAYMENT_PROMPT = (
    "Extract the listed fields from this bank-transfer / payment receipt and "
    "return JSON only.\n"
    "- utr = the UTR / UTR No. / transaction reference number.\n"
    "- payment_date = the value/transaction date in YYYY-MM-DD format.\n"
    "- transfer_amount = the amount transferred.\n"
    "- If a field is not clearly present, return JSON null. Do NOT guess."
)


class _NonRetryable(Exception):
    """A failure that must not be retried (blocked / truncated / empty output)."""


def _schema(fields):
    # nullable + NO required: a required, non-nullable field makes controlled
    # generation fabricate a value from training data when the field is unclear
    # (Google's structured-output docs). nullable lets the model return JSON null.
    props = {
        f: {"type": "number" if f in _NUMERIC else "string", "nullable": True}
        for f in fields
    }
    return {"type": "object", "properties": props}


@lru_cache(maxsize=4)
def _client(mode: str, api_key: str, project: str, location: str):
    """Cached client.

    mode 'vertex' → regional Vertex AI via ADC (no secret in the app DB).
    mode 'api_key' → Gemini Developer API (local dev/test).
    """
    from google import genai

    if mode == "vertex":
        return genai.Client(vertexai=True, project=project, location=location)
    return genai.Client(api_key=api_key)


def _is_transient(exc) -> bool:
    if isinstance(exc, _NonRetryable):
        return False
    text = f"{type(exc).__name__} {exc}".upper()
    return any(marker in text for marker in _TRANSIENT_MARKERS)


def _stringify(value) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))  # 3257.0 -> "3257"
    return str(value).strip()


def _safe_text(resp) -> str:
    """Pull text out of a response, raising _NonRetryable on a block/truncation.

    finish_reason is a google.genai enum; compare its `.name` ("STOP"), NOT
    str(enum) (which is "FinishReason.STOP" and would reject every success).
    """
    candidates = getattr(resp, "candidates", None) or []
    if candidates:
        fr = getattr(candidates[0], "finish_reason", None)
        name = (getattr(fr, "name", None) or str(fr or "")).upper()
        if name and name not in ("STOP", "FINISH_REASON_STOP"):
            raise _NonRetryable(f"no usable output (finish_reason={name})")
    text = getattr(resp, "text", None)
    if not text:
        raise _NonRetryable("empty response")
    return text


def _thinking_level(settings) -> str:
    """Clamp to a level the pinned SDK accepts — ThinkingLevel has only LOW/HIGH."""
    lvl = (settings.get("gemini_thinking_level") or "low").strip().lower()
    return lvl if lvl in ("low", "high") else "low"


class GeminiExtractor:
    def extract(self, content, file_ext, settings, doc_kind) -> tuple[str, list[Entity]]:
        from google.genai import types

        mime = MIME_TYPES.get(file_ext)
        if not mime:
            frappe.throw(f"Unsupported file type: .{file_ext}")

        client = self._build_client(settings)
        is_invoice = doc_kind == INVOICE
        fields = _INVOICE_FIELDS if is_invoice else _PAYMENT_FIELDS
        prompt = _INVOICE_PROMPT if is_invoice else _PAYMENT_PROMPT

        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_schema(fields),
            temperature=0,
            thinking_config=types.ThinkingConfig(thinking_level=_thinking_level(settings)),
            media_resolution=_MEDIA_RESOLUTION.get(
                settings.get("gemini_media_resolution"), "MEDIA_RESOLUTION_HIGH"
            ),
            # HttpOptions.timeout is in MILLISECONDS. Set per-request (not on the
            # lru_cached client) so a settings change takes effect without a
            # restart. A stall raises DEADLINE_EXCEEDED, which _is_transient catches.
            http_options=types.HttpOptions(
                timeout=int(settings.get("request_timeout_seconds") or 90) * 1000
            ),
        )
        part = types.Part.from_bytes(data=content, mime_type=mime)
        model = settings.get("gemini_model") or "gemini-3.1-pro-preview"

        data = self._generate(client, model, [part, prompt], config)
        return "", self._to_entities(data, fields)

    def _build_client(self, settings):
        mode = "api_key" if "api" in (settings.get("auth_mode") or "").lower() else "vertex"
        if mode == "vertex":
            project = settings.get("gcp_project_id")
            if not project:
                frappe.throw("GCP Project ID is not configured in Document AI Settings.")
            return _client("vertex", "", project, settings.get("gcp_location") or "asia-south1")
        api_key = get_gemini_api_key()
        if not api_key:
            frappe.throw("Gemini API key is not configured in Document AI Settings.")
        return _client("api_key", api_key, "", "")

    def _generate(self, client, model, contents, config) -> dict:
        for attempt in range(1, _MAX_RETRIES + 2):
            try:
                resp = client.models.generate_content(
                    model=model, contents=contents, config=config
                )
                return json.loads(_safe_text(resp))
            except Exception as exc:
                if attempt <= _MAX_RETRIES and _is_transient(exc):
                    time.sleep(_BACKOFF_SECONDS * attempt)
                    continue
                frappe.log_error(
                    title="Gemini extraction failed", message=frappe.get_traceback()
                )
                frappe.throw("Document extraction failed. Please enter the details manually.")

    def _to_entities(self, data: dict, fields) -> list[Entity]:
        out: list[Entity] = []
        if not isinstance(data, dict):
            return out
        for f in fields:
            raw = data.get(f)
            if is_absent(raw):
                continue  # absent / "null" / "" → no entity (manual entry)
            value = _stringify(raw)
            out.append(
                {"type": f, "mention_text": value, "normalized_text": value, "confidence": 1.0}
            )
        return out
