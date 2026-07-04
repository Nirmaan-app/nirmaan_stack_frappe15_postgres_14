# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Gemini-backed BoQ review AI classifier (dual-AI branch) -- pure logic.

This is the GEMINI half of the dual-provider BoQ AI assist (ADR-0003). It runs
ALONGSIDE Nitesh's Claude classifier (services/boq_ai_assist.py, UNTOUCHED) and
must never collide with it: Claude writes ai_* columns, Gemini writes gemini_*
columns. This module is a faithful port of the owner's committed Gemini service
(feature/boq-phase-4-gemini:nirmaan_stack/services/boq_ai_assist.py) with ONLY
namespace + two small behavioural deltas (see "Deltas vs the ported source").

A read-only SECOND OPINION over a parsed BoQ sheet: Gemini independently
re-classifies and re-parents the review rows so a reviewer can see where it
disagrees with the deterministic parser. This module holds the pure, testable
pieces (prompt, schema, row-payload builder, chunker, Gemini call, output
mapping, resume selection); the background worker + endpoint
that read/write the DB live in api/boq/wizard/gemini_assist.py.

Design decisions (docs/adr/0003-dual-provider-boq-ai-assist.md):
  - Provider Gemini; mirrors services/extraction/gemini.py (reuses its cached
    `_client`, mirrors the retry/`_safe_text`/`_is_transient` helpers so the live
    invoice-extraction flow is never coupled to this).
  - Per-row output `{ id, classification, parent_id|null, classification_confidence,
    parent_confidence, reason }`; `id`/`parent_id` are row_index. classification
    constrained to the 6 parser classes; missing confidence -> "Low". The pass does
    NOT output a level -- gemini_suggested_level is stored as the -1 sentinel and the
    real level is derived at commit (derive_effective_levels, ADR-0009).
  - Each row is sent its FACTS + derived signals, never the parser's verdict.
  - Chunk only above a threshold; carry the running list of Gemini-identified
    preambles forward so a child can name its section across chunks.

Statelessness: this module performs NO DB writes and never `frappe.throw`s for a
terminal classify failure -- it raises `_NonRetryable` (blocked/truncated/empty)
or re-raises the transient exception, and the worker (Stage 2) owns persistence,
the gemini_in_progress flag, the socket event and the redis fallback.

Deltas vs the ported source (the ONLY differences):
  1. logger channel "boq_gemini" (source: "boq_ai_assist"); docstrings say Gemini
     dual-AI; output keys are gemini_* (source: ai_*).
  2. map_suggestion emits `gemini_suggested_is_root`: a null/absent parent_id ->
     is_root 1 (with the -1 sentinel); a real parent -> is_root 0. The committed
     gemini source conflated null->-1 with NO is_root flag; this adds it so the
     worker can populate the migrated `gemini_suggested_is_root` (Check) column
     directly instead of re-deriving it.
  3. Token logging is aggregated ONCE PER PASS: `classify_sheet` sums the tokens
     of every chunk and emits a single "boq_gemini pass" log line with the pass
     total (the worker reuses that total for the socket payload). The per-call
     debug log is KEPT (downgraded to .debug) for chunk-level visibility.
"""
from __future__ import annotations

import json
import time
from typing import Any

import frappe

from nirmaan_stack.services.boq_parser.classifier import RowClassification
from nirmaan_stack.services.extraction.files import get_gemini_api_key

# The 6 parser classes -- the only valid classification targets (honest like-for-like
# comparison with the parser). Sourced from the enum, not re-copied.
_VALID_CLASSES = frozenset(c.value for c in RowClassification)
_CONFIDENCE = {"high": "High", "medium": "Medium", "low": "Low"}

# Chunking: one call under the threshold (best accuracy); above it, ordered
# boundary-aware chunks carrying the Gemini preamble list forward.
_CHUNK_THRESHOLD = 120
_CHUNK_TARGET = 100
_CHUNK_HARD_MAX = _CHUNK_TARGET * 2  # never grow a chunk past this even with no boundary

_MAX_RETRIES = 2
_BACKOFF_SECONDS = 1.5
_TRANSIENT_MARKERS = (
    "UNAVAILABLE", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED", "INTERNAL",
    "503", "502", "500", "429",
)
_EXPLANATION_MAX = 2000  # defensive cap on the stored reason text

_LOGGER = "boq_gemini"  # delta 1: dedicated Gemini channel (source used "boq_ai_assist")

_BOQ_CLASSIFY_PROMPT = (
    "You are independently classifying the rows of a construction Bill of Quantities "
    "(BoQ). For EVERY row decide its type and its parent section. Judge each row only "
    "on the facts given -- you are NOT shown any prior classification.\n"
    "\n"
    "Row types (classification):\n"
    "- preamble: a section header that groups the rows beneath it. The ONLY valid parent.\n"
    "- line_item: a priced/quantified work entry (a leaf). Never a parent.\n"
    "- note: explanatory text attached to a section/item.\n"
    "- spacer: a blank/layout row with no content.\n"
    "- subtotal_marker: a subtotal / carried-forward total row.\n"
    "- header_repeat: a repeated column-header row.\n"
    "\n"
    "Parenting:\n"
    "- A row's parent is the `id` of the preamble that heads its section. Only "
    "preambles are valid parents.\n"
    "- A row with no section header is root: return `parent_id` = null.\n"
    "- Preambles already identified earlier in this sheet are listed under KNOWN "
    "PREAMBLES with their `id` and description. You MAY reference them as a parent_id. "
    "Do NOT invent ids that are not a row in this request or a KNOWN PREAMBLE.\n"
    "\n"
    "Confidence: return High/Medium/Low for classification_confidence and "
    "parent_confidence. If unsure, return null (treated as Low).\n"
    "reason: one short clause explaining the call.\n"
    "\n"
    "Return JSON only, matching the schema: an object with a `rows` array, one entry "
    "per input row, each `{ id, classification, parent_id, classification_confidence, "
    "parent_confidence, reason }`."
)


class _NonRetryable(Exception):
    """A failure that must not be retried (blocked / truncated / empty output)."""


# ---------------------------------------------------------------------------
# Gemini client + low-level call (mirrors services/extraction/gemini.py, but
# reuses that module's cached `_client` so there is ONE client per auth tuple).
# ---------------------------------------------------------------------------
def build_gemini_client(settings: dict):
    """Build (cached) genai client from the shared Document AI Settings auth.

    Vertex mode needs gcp_project_id; API-Key mode needs the encrypted key.
    Raises (frappe.throw) when credentials are missing -- the worker catches it.
    """
    from nirmaan_stack.services.extraction.gemini import _client

    mode = "api_key" if "api" in (settings.get("auth_mode") or "").lower() else "vertex"
    if mode == "vertex":
        project = settings.get("gcp_project_id")
        if not project:
            frappe.throw(
                "GCP Project ID is not configured in Document AI Settings "
                "(required for the BoQ AI classifier in Vertex mode)."
            )
        return _client("vertex", "", project, settings.get("gcp_location") or "asia-south1")
    api_key = get_gemini_api_key()
    if not api_key:
        frappe.throw(
            "Gemini API key is not configured in Document AI Settings "
            "(required for the BoQ AI classifier in API-Key mode)."
        )
    return _client("api_key", api_key, "", "")


def _thinking_level(settings: dict) -> str:
    lvl = (settings.get("gemini_thinking_level") or "low").strip().lower()
    return lvl if lvl in ("low", "high") else "low"


def _is_transient(exc: Exception) -> bool:
    if isinstance(exc, _NonRetryable):
        return False
    text = f"{type(exc).__name__} {exc}".upper()
    return any(marker in text for marker in _TRANSIENT_MARKERS)


def _safe_text(resp) -> str:
    """Pull text from a response, raising _NonRetryable on a block/truncation.

    finish_reason is a google.genai enum; compare its `.name`, not str(enum).
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


def _usage_total(resp) -> int:
    meta = getattr(resp, "usage_metadata", None)
    return int(getattr(meta, "total_token_count", 0) or 0) if meta else 0


def _response_schema() -> dict:
    """Controlled-generation schema. No `enum` (the pinned google-genai is conservative;
    the 6-class + confidence constraints are enforced by the prompt + post-hoc
    validation in map_suggestion / normalize_confidence). parent_id nullable so the
    model returns JSON null for root rather than fabricating an id."""
    return {
        "type": "object",
        "properties": {
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer"},
                        "classification": {"type": "string"},
                        "parent_id": {"type": "integer", "nullable": True},
                        "classification_confidence": {"type": "string", "nullable": True},
                        "parent_confidence": {"type": "string", "nullable": True},
                        "reason": {"type": "string", "nullable": True},
                    },
                },
            },
        },
    }


def _generate(client, model: str, contents, config) -> tuple[dict, int]:
    """Single Gemini call with retry/backoff. Returns (parsed JSON, total tokens).

    Re-raises on terminal failure -- the worker owns per-sheet failure handling
    (no user-facing invoice message is surfaced from here).

    Delta 3: the per-call token line is kept but downgraded to .debug; the
    once-per-pass aggregate is emitted by classify_sheet."""
    for attempt in range(1, _MAX_RETRIES + 2):
        try:
            resp = client.models.generate_content(model=model, contents=contents, config=config)
            data = json.loads(_safe_text(resp))
            tokens = _usage_total(resp)
            frappe.logger(_LOGGER).debug(
                f"BoQ Gemini classify call: model={model} tokens={tokens}"
            )
            return data, tokens
        except Exception as exc:
            if attempt <= _MAX_RETRIES and _is_transient(exc):
                time.sleep(_BACKOFF_SECONDS * attempt)
                continue
            frappe.log_error(
                title="BoQ Gemini classify failed", message=frappe.get_traceback()
            )
            raise


# ---------------------------------------------------------------------------
# Pure helpers (no DB / no network) -- the testable core.
# ---------------------------------------------------------------------------
def _nonzero(v: Any) -> bool:
    try:
        return v is not None and float(v) != 0.0
    except (TypeError, ValueError):
        return False


def build_row_payload(row: dict) -> dict:
    """Facts + derived signals for one review row -- NEVER the parser's verdict.

    `row` is a plain dict (frappe.db.get_all). Empty/None text fields are dropped
    to keep the prompt compact; the has_* booleans and id are always present.
    """
    g = row.get
    payload = {
        "id": g("row_index"),
        "excel_row": g("source_row_number"),
        "description": ((g("description") or "").strip() or None),
        "sl_no": ((str(g("sl_no_value")).strip() if g("sl_no_value") is not None else "") or None),
        "unit": ((g("unit") or "").strip() or None),
        "has_qty": _nonzero(g("qty_total")),
        "has_rate": _nonzero(g("rate_supply")) or _nonzero(g("rate_install")) or _nonzero(g("rate_combined")),
        "has_amount": _nonzero(g("amount_total")) or _nonzero(g("amount_supply")) or _nonzero(g("amount_install")),
        "preamble_candidate_score": g("preamble_candidate_score"),
        "is_rate_only": 1 if g("is_rate_only") else 0,
        "is_synthetic": 1 if g("is_synthetic") else 0,
    }
    return {k: v for k, v in payload.items() if v is not None}


def _looks_like_section_start(payload: dict) -> bool:
    """A row likely starting a new section -- a preferred chunk-cut boundary.
    Uses the parser's derived candidate score (a SIGNAL, not its verdict)."""
    try:
        return (payload.get("preamble_candidate_score") or 0) > 0
    except TypeError:
        return False


def chunk_rows(payloads: list[dict]) -> list[list[dict]]:
    """Order-preserving chunker. <= threshold -> one chunk. Above -> boundary-aware
    chunks: cut just before a likely section start once at target size, with a hard
    ceiling so a section-less run still terminates."""
    if not payloads:
        return []
    if len(payloads) <= _CHUNK_THRESHOLD:
        return [list(payloads)]
    chunks: list[list[dict]] = []
    cur: list[dict] = []
    for p in payloads:
        at_target = len(cur) >= _CHUNK_TARGET
        if cur and ((at_target and _looks_like_section_start(p)) or len(cur) >= _CHUNK_HARD_MAX):
            chunks.append(cur)
            cur = []
        cur.append(p)
    if cur:
        chunks.append(cur)
    return chunks


def normalize_confidence(value: Any) -> str:
    """Map a model confidence to High/Medium/Low; anything missing/unknown -> Low."""
    if not isinstance(value, str):
        return "Low"
    return _CONFIDENCE.get(value.strip().lower(), "Low")


def map_suggestion(out_row: Any) -> dict | None:
    """Map one Gemini output row to the gemini_* field dict (+ an `id` key the worker pops).

    Returns None for an unusable row (no id, or an off-vocabulary classification) so
    the chunk is not corrupted. status is seeded "Pending" (read-only v1 -- nothing
    is promoted yet).

    Delta 2 -- gemini_suggested_is_root: a null/absent parent_id means the row is a
    root, so gemini_suggested_parent = the -1 sentinel AND gemini_suggested_is_root
    = 1; a real (int) parent means gemini_suggested_parent = that id AND
    gemini_suggested_is_root = 0. A non-int parent_id falls back to the root case
    (sentinel + is_root 1) -- the committed source silently coerced it to -1 with no
    is_root flag; here that coercion is made explicit as "treat as root".
    """
    if not isinstance(out_row, dict):
        return None
    rid = out_row.get("id")
    try:
        rid = int(rid)
    except (TypeError, ValueError):
        return None
    cls = (out_row.get("classification") or "").strip()
    if cls not in _VALID_CLASSES:
        return None
    parent_id = out_row.get("parent_id")
    if parent_id is None:
        gemini_parent = -1
        is_root = 1
    else:
        try:
            gemini_parent = int(parent_id)
            is_root = 0
        except (TypeError, ValueError):
            gemini_parent = -1
            is_root = 1
    reason = out_row.get("reason")
    if isinstance(reason, str):
        reason = reason.strip()[:_EXPLANATION_MAX] or None
    else:
        reason = None
    return {
        "id": rid,
        "gemini_suggested_classification": cls,
        "gemini_suggested_parent": gemini_parent,
        "gemini_suggested_is_root": is_root,
        "gemini_classification_confidence": normalize_confidence(out_row.get("classification_confidence")),
        "gemini_parent_confidence": normalize_confidence(out_row.get("parent_confidence")),
        "gemini_explanation": reason,
        "gemini_suggestion_status": "Pending",
    }


def select_pending_rows(rows: list[dict]) -> list[dict]:
    """The not-yet-classified rows (resume): gemini_suggested_classification empty/None."""
    return [r for r in rows if not (r.get("gemini_suggested_classification") or "").strip()]


def classify_chunk(client, model: str, settings: dict, chunk_payloads: list[dict],
                   known_preambles: list[dict]) -> tuple[list[dict], int]:
    """Classify one chunk. Returns (mapped suggestions, tokens used).

    Off-vocabulary / id-less output rows are dropped by map_suggestion."""
    from google.genai import types

    rows_json = json.dumps({"rows": chunk_payloads}, ensure_ascii=False)
    known_block = _render_known_preambles(known_preambles)
    contents = f"{_BOQ_CLASSIFY_PROMPT}\n\n{known_block}\n\nROWS TO CLASSIFY (JSON):\n{rows_json}"
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=_response_schema(),
        temperature=0,
        thinking_config=types.ThinkingConfig(thinking_level=_thinking_level(settings)),
        http_options=types.HttpOptions(
            timeout=int(settings.get("request_timeout_seconds") or 90) * 1000
        ),
    )
    data, tokens = _generate(client, model, contents, config)
    out_rows = data.get("rows") if isinstance(data, dict) else None
    suggestions: list[dict] = []
    for out in (out_rows or []):
        mapped = map_suggestion(out)
        if mapped is not None:
            suggestions.append(mapped)
    return suggestions, tokens


def classify_sheet(client, model: str, settings: dict, payloads: list[dict]) -> tuple[list[dict], int]:
    """Classify ALL payloads for one sheet (the stateless pass entry point).

    Chunks the payloads, classifies each chunk in order while carrying the running
    list of Gemini-identified preambles forward (so a later chunk's child can name a
    section opened in an earlier chunk), and returns (all mapped suggestions across
    every chunk, token_total for the WHOLE pass).

    Delta 3 -- token logging is aggregated ONCE PER PASS: this function sums each
    chunk's tokens and emits a single info line with the pass total; the per-call
    line in `_generate` is .debug only. The returned `token_total` is the value the
    worker echoes into the "boq:gemini_pass_done" socket payload, so the worker logs
    nothing extra per chunk.

    Pure-ish: no DB writes, no socket, no frappe.throw for a terminal classify
    failure -- a blocked/empty chunk raises _NonRetryable and a still-transient chunk
    re-raises; the worker maps either to an error_code and clears gemini_in_progress.
    """
    chunks = chunk_rows(payloads)
    all_suggestions: list[dict] = []
    known_preambles: list[dict] = []
    token_total = 0
    description_by_id = {p.get("id"): p.get("description") for p in payloads}
    for chunk in chunks:
        suggestions, tokens = classify_chunk(client, model, settings, chunk, known_preambles)
        token_total += tokens
        all_suggestions.extend(suggestions)
        # Carry every preamble this chunk identified forward as a referenceable parent.
        for s in suggestions:
            if s.get("gemini_suggested_classification") == RowClassification.PREAMBLE.value:
                known_preambles.append(
                    {"id": s["id"], "description": description_by_id.get(s["id"])}
                )
    frappe.logger(_LOGGER).info(
        f"BoQ Gemini pass: model={model} chunks={len(chunks)} "
        f"rows={len(all_suggestions)} token_total={token_total}"
    )
    return all_suggestions, token_total


def _render_known_preambles(known_preambles: list[dict]) -> str:
    if not known_preambles:
        return "KNOWN PREAMBLES: (none yet -- this is the first chunk)"
    lines = [
        f"- id {p.get('id')}: {(p.get('description') or '').strip()[:160]}"
        for p in known_preambles
    ]
    return "KNOWN PREAMBLES (earlier sections you may reference as parent_id):\n" + "\n".join(lines)
