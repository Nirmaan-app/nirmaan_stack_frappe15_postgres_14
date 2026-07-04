# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Anthropic-backed AI structure-suggestion service for the BoQ review AI pass.

Slice AI-2b -- SERVICE LOGIC ONLY. This module sends a parsed sheet's review rows
to Claude and returns structural correction suggestions (classification / parent)
mapped back to internal row_index. It does the API call + input serialisation +
output parsing and NOTHING else:
  - NO endpoint / background worker / in-progress flag / socket  (those are AI-2c)
  - NO frontend                                                  (AI-3)

STATELESS BY DESIGN: `settings` (dict) and `api_key` (str) are INJECTED by the
caller (the future AI-2c worker, via the AI-2a helpers get_boq_ai_settings /
get_boq_ai_api_key). The service never reads them itself, so it stays trivially
unit-testable with a mocked Anthropic client.

CACHING IS NOT IN THIS SLICE: per-sheet-draft caching (keyed on last_parsed_at)
belongs in the AI-2c worker, which holds the sheet-draft context. This service is
stateless -- do NOT add caching here.

Structural template: services/extraction/gemini.py (the retry/backoff/transient
pattern). DIFFERENCE: on terminal failure this RAISES _NonRetryable rather than
frappe.throw -- it runs in a worker (AI-2c), which converts the raise into a
socket error event; a throw would be wrong outside a request context.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any

import anthropic
import frappe

from nirmaan_stack.services.boq_parser.classifier import RowClassification

# --- Retry / transience (mirror gemini.py) ---------------------------------
_MAX_RETRIES = 2
_BACKOFF_SECONDS = 1.5
# Anthropic transient signals. 529 is Anthropic's "overloaded" status code.
_TRANSIENT_MARKERS = (
    "OVERLOADED", "RATE_LIMIT", "429", "500", "502", "503", "529",
    "TIMEOUT", "CONNECTION",
)

# --- Chunking (R2 / ADR-0005) ----------------------------------------------
# DUPLICATED from boq_gemini_assist on purpose: ADR-0003 §8 keeps the Claude (ai_*)
# and Gemini (gemini_*) services hard-separated with a ONE-DIRECTIONAL import
# (Gemini imports from Claude, never the reverse). Do NOT import chunk_rows from
# boq_gemini_assist -- that would invert the dependency. Sizes start at Gemini's
# 120 / 100 / 200 and are tuned empirically against the reference sheets.
_CHUNK_THRESHOLD = 120          # <= this -> a single call (best accuracy, no spine needed)
_CHUNK_TARGET = 100             # aim for chunks of this size
_CHUNK_HARD_MAX = 200           # never grow a chunk past this even with no preamble boundary
# Defensive caps on the carried-spine text so the {CONTEXT} block stays compact.
_SPINE_DESC_MAX = 120           # truncate a carried section header's description
_SPINE_MAX_OPEN = 40            # never list more than this many open preambles

# Assignable classification targets (mirror review_screen._ASSIGNABLE_CLASSIFICATIONS):
# subtotal_marker / header_repeat are parser-only detections, never AI targets.
_ASSIGNABLE_CLASSIFICATIONS = frozenset({"line_item", "preamble", "note", "spacer"})
_CONFIDENCE_VALUES = frozenset({"High", "Medium", "Low"})

# The sentinel the model uses to say "parent is correct, don't change it".
_NO_CHANGE = "NO_CHANGE"

logger = frappe.logger("boq_ai")


class _NonRetryable(Exception):
    """A failure that must not be retried (auth error, malformed output, empty
    response, unexpected stop_reason). _is_transient returns False for it."""


# ---------------------------------------------------------------------------
# The validated AI-pass prompt (BoQ_Phase4_AI_Pass_Prompt_v1_1). EMBEDDED VERBATIM
# -- validated against 5 real sheets; do NOT paraphrase or "improve". Two slots
# {SHEET_NAME} and {ROWS_JSON} are filled via str.replace (NOT str.format -- the
# body contains literal JSON braces that would break format()).
# ---------------------------------------------------------------------------
_AI_PASS_PROMPT_TEMPLATE = """You are reviewing the parsed structure of a single sheet from a construction Bill of Quantities (BoQ) workbook. A deterministic parser has already classified each row and assigned a parent and hierarchy level. Your job is to find rows where the parser's STRUCTURE is wrong and suggest corrections.

## What a BoQ sheet is

A BoQ lists construction work items grouped into sections. Each row has been classified as one of:
- "line_item" — a priceable work item (has or will have a quantity, rate, amount). e.g. "3.5C x 240 sqmm Al cable", "300 mm Round Diffuser"
- "preamble" — a section or sub-section HEADER that groups line items beneath it. e.g. "LT CABLES", "HVAC - High Side Works", "Ducting". Preambles are never priced themselves; they organise the items under them.
- "note" — descriptive text, a remark, or a specification note that is not itself a work item and not a section header. e.g. "Note:", "Consider Carrier Make", "All materials shall be as per standards"
- "spacer" — an empty or blank row
- "subtotal_marker" — a row showing a section total (e.g. "TOTAL")
- "header_repeat" — a repeated column-header row

## Hierarchy: parent and level

- Each row has a parent (the excel_row number of its parent), or null if it is a root-level row.
- "level" applies to preambles only: level 1 = top-level section, level 2 = sub-section under a level-1, level 3 = sub-sub-section, etc. Level is derived from the parent chain.
- line_items are parented to the preamble (section) they belong to.
- A preamble's children are the rows that sit under it until the next preamble of equal or higher level.

## The sl_no signal (read this carefully)

Each row may carry an sl_no (serial number) from the original sheet. The numbering scheme is one of your strongest structural signals:
- A RESTART of the sequence (e.g. ...5, 6, then a new header, then 1, 2, 3) means a NEW section has begun. Rows after the restart belong to the new section, not the previous one.
- The PREFIX of a dotted sl_no indicates grouping: 1.1, 1.2, 1.3 are siblings under group 1; 2.1, 2.2 are siblings under a DIFFERENT group 2. If consecutive sections carry prefixes 1.x then 2.x then 3.x, they are siblings of each other, NOT all nested under the first one.
- Use the sl_no scheme together with the section headers to reconstruct the intended hierarchy.

## What to look for (the error classes)

1. MIS-PARENTING: a row attached to the wrong parent. The most common cause: a new section header appears, but the parser keeps attaching subsequent rows to an earlier section instead of the new one. Watch for a block of consecutive rows whose parents jump backwards to scattered earlier sections — they usually all belong to the most recent section header above them. The sl_no restart confirms this.

2. SECTION RESTART: when the sl_no sequence restarts, a new section has begun (see the sl_no signal above).

3. MIS-CLASSIFICATION: a row classified as preamble that is really a line_item (or vice versa), or a "note"-like row (e.g. "Note:") wrongly made a structural preamble root.

4. ORPHAN / WRONG LEVEL: a preamble with no parent that clearly belongs under a section, or a preamble at the wrong level given its surrounding context and sl_no prefix.

## Hard constraints

- You analyse STRUCTURE ONLY: classification, parent, level. NEVER suggest changes to quantities, rates, amounts, units, or description text.
- Only suggest a change where you have a clear structural reason. Do not suggest cosmetic or speculative changes. If the parser is right, say nothing for that row.
- For each suggested change, assign a confidence: "High" (clear structural evidence, e.g. an unambiguous sl_no restart), "Medium" (likely but some ambiguity), "Low" (plausible, worth a human look but you are not sure).
- Parent is expressed as an excel_row number, or null for a root-level row.
- Classification suggestions must use one of the assignable values: line_item, preamble, note, spacer. (subtotal_marker and header_repeat are parser-only detections — never suggest them as a target.)
- When you reclassify a structural preamble to "note" (e.g. a "Note:" row that was wrongly made a section root), do NOT also suggest re-parenting that preamble's existing children. The human review tool handles re-homing the children when the reclassification is accepted. Suggest only the classification change for that row.

## Output format

Return ONLY a JSON array (no preamble, no markdown fences). Each element is a row you want to change:

[
  {
    "excel_row": <int>,
    "suggested_classification": <string, or null if no classification change>,
    "classification_confidence": <"High"|"Medium"|"Low", or null>,
    "suggested_parent": <int excel_row, null for root, or "NO_CHANGE" if parent is correct>,
    "parent_confidence": <"High"|"Medium"|"Low", or null>,
    "explanation": <one concise sentence explaining the structural reason>
  }
]

Rules for the output:
- Include a row ONLY if you suggest at least one change (classification, parent, or both) for it.
- If you suggest a classification change but the parent is fine: suggested_parent = "NO_CHANGE", parent_confidence = null.
- If you suggest a parent change but the classification is fine: suggested_classification = null, classification_confidence = null.
- If both change, fill both.
- Do not include rows you are not changing.
- If you find no issues at all, return an empty array [].
- CRITICAL: output the JSON array and NOTHING else. Do not write any explanation, reasoning, or text before or after the array. Your entire response must be the array itself, starting with [ and ending with ].

## Carried context (rows above this slice)

Large sheets are reviewed in ordered slices. The rows below are ONE slice; earlier slices have already been reviewed. The CARRIED CONTEXT block tells you what came immediately above this slice so the global signals (the sl_no sequence and the open section headers) survive the slice boundary:
- OPEN SECTIONS lists the section headers (preambles) still open above this slice, with their excel_row and level — the rows in this slice most likely belong under the deepest of these unless a new header appears. You MAY suggest one of these excel_rows as a suggested_parent.
- LAST sl_no is the serial number on the row immediately above this slice; use it to judge whether this slice's sl_no sequence is a continuation or a RESTART.
When the CARRIED CONTEXT says "first slice", this is the top of the sheet and nothing precedes it. Only suggest a suggested_parent that is an excel_row present in THIS slice or listed under OPEN SECTIONS — never an excel_row from a later slice you have not seen.

CARRIED CONTEXT:
{CONTEXT}

## The sheet to review

Sheet name: {SHEET_NAME}
Rows (JSON):
{ROWS_JSON}"""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get(row: Any, key: str) -> Any:
    """Field access for dict / frappe._dict review rows."""
    if isinstance(row, dict):
        return row.get(key)
    return getattr(row, key, None)


def _effective_classification(row: Any) -> Any:
    """effective_classification when present (rows come through resolve_effective),
    else the raw parser classification."""
    eff = _get(row, "effective_classification")
    return eff if eff else _get(row, "classification")


def _effective_parent_internal(row: Any):
    """Internal effective parent row_index, or None for root.

    Prefer the resolve_effective value (None already means root); fall back to the
    raw parent_index with the -1/None sentinel translated to None.
    """
    if (isinstance(row, dict) and "effective_parent_index" in row) or (
        not isinstance(row, dict) and hasattr(row, "effective_parent_index")
    ):
        return _get(row, "effective_parent_index")  # None = root, else int
    rp = _get(row, "parent_index")
    return None if rp in (None, -1) else rp


def _effective_level_for_payload(row: Any) -> Any:
    """Effective (edit-aware) nesting level when the caller enriched the row, else the
    raw parser level.

    The AI-2c worker attaches `effective_level` via derive_effective_levels (ADR-0009 --
    the SAME derivation feeding the review screen + the commit pipeline), so a re-parented
    row's level is correct rather than the frozen parser value. When the key is absent
    (the service called standalone, e.g. a unit test) fall back to the raw parser `level`
    so the service stays independently testable. Mirrors _effective_parent_internal's
    "present -> effective, else parser" shape. This level is an INTERNAL spine signal --
    it is STRIPPED from the model wire by _wire_element (the model no longer receives a
    per-row level; only preambles carry a level, surfaced in the OPEN SECTIONS context).
    """
    if (isinstance(row, dict) and "effective_level" in row) or (
        not isinstance(row, dict) and hasattr(row, "effective_level")
    ):
        return _get(row, "effective_level")
    return _get(row, "level")


# ---------------------------------------------------------------------------
# Input serialisation
# ---------------------------------------------------------------------------

def _build_excel_maps(review_rows: list) -> tuple[dict, dict]:
    """Build (rowidx_to_excel, idx_map) for the WHOLE sheet.

    rowidx_to_excel: internal row_index -> excel row (source_row_number).
    idx_map:         excel row -> internal row_index (suggestion mapping, sheet-wide).

    R2: idx_map is built from EVERY review row up front so a suggestion in a later
    chunk can name a parent that lives in an earlier chunk (cross-chunk resolution).
    """
    rowidx_to_excel: dict = {}
    idx_map: dict = {}
    for row in review_rows:
        ridx = _get(row, "row_index")
        excel = _get(row, "source_row_number")
        if ridx is not None and excel is not None:
            rowidx_to_excel[ridx] = excel
            idx_map[excel] = ridx
    return rowidx_to_excel, idx_map


def _build_row_payload(row: Any, rowidx_to_excel: dict) -> dict:
    """Serialise ONE review row into the INTERNAL payload element.

    Element keys: excel_row (= source_row_number), classification (effective), level
    (EFFECTIVE nesting depth; see below), parent_excel_row (the PARENT row's excel row,
    or None for a root row), sl_no, description, unit.

    `level` is an INTERNAL spine signal ONLY -- it feeds update_spine / render_context
    (the carried OPEN SECTIONS block). It is the EFFECTIVE level (edit-aware, ADR-0009),
    NOT the frozen parser value. `_wire_element` STRIPS it before the element reaches the
    model, so the model no longer receives a per-row level (recomputed at commit; only
    preambles carry a level, shown in OPEN SECTIONS).
    """
    eff_parent = _effective_parent_internal(row)
    if eff_parent is None:
        parent_excel = None
    else:
        # Defensive: a parent internal index with no excel mapping -> None (root-ish).
        parent_excel = rowidx_to_excel.get(eff_parent)
    return {
        "excel_row": _get(row, "source_row_number"),
        "classification": _effective_classification(row),
        "level": _effective_level_for_payload(row),
        "parent_excel_row": parent_excel,
        "sl_no": _get(row, "sl_no_value"),
        "description": _get(row, "description"),
        "unit": _get(row, "unit"),
    }


def _wire_element(payload: dict) -> dict:
    """The per-row element AS THE MODEL SEES IT: the internal payload minus `level`.

    `level` is an internal spine signal (see _build_row_payload) -- the model is never
    shown a per-row level. The single definition of "what goes on the wire", used by BOTH
    the single-call build_rows_payload path and the chunked _classify_chunk path.
    """
    return {k: v for k, v in payload.items() if k != "level"}


def build_rows_payload(review_rows: list) -> tuple[str, dict]:
    """Serialise review rows into the model's input array + an excel->internal map.

    Returns (json_str, idx_map) where:
      - json_str is the JSON array AS THE MODEL SEES IT: each element has excel_row
        (= source_row_number), classification, parent_excel_row, sl_no, description, unit.
        There is NO per-row `level` (an internal spine signal, stripped by _wire_element).
        parent_excel_row is the PARENT row's source_row_number (excel row), or None
        for a root row (translated from the effective internal parent_index).
      - idx_map maps excel_row (source_row_number) -> internal row_index, for
        mapping the model's suggestions back.

    ALL rows are passed (no cap) -- spacers / notes / subtotals included -- so the
    model sees the full structural context.

    R2 refactor: now a thin wrapper over the per-row builder + the sheet-wide map
    helper, so run_ai_pass can reuse the SAME element shape per chunk.
    """
    rowidx_to_excel, idx_map = _build_excel_maps(review_rows)
    payload = [_build_row_payload(row, rowidx_to_excel) for row in review_rows]
    return json.dumps([_wire_element(p) for p in payload]), idx_map


# ---------------------------------------------------------------------------
# Chunking + carried hierarchy spine (R2 / ADR-0005)
# ---------------------------------------------------------------------------

def _is_preamble_payload(p: dict) -> bool:
    """A parser-identified section header in the model payload -- the chunk-cut
    boundary. Uses the effective `classification` already on the payload element
    (no new fetch field, per ADR-0005 decision 4)."""
    return p.get("classification") == RowClassification.PREAMBLE.value


def chunk_rows(payloads: list[dict]) -> list[list[dict]]:
    """Order-preserving chunker (DUPLICATED from boq_gemini_assist; do NOT import).

    <= threshold -> ONE chunk (single-call path, no spine). Above the threshold ->
    boundary-aware chunks: once a chunk reaches the target size, cut JUST BEFORE the
    next parser-identified `preamble` row (so a slice starts cleanly at a section
    header), with a hard ceiling so a section-less run still terminates.
    """
    if not payloads:
        return []
    if len(payloads) <= _CHUNK_THRESHOLD:
        return [list(payloads)]
    chunks: list[list[dict]] = []
    cur: list[dict] = []
    for p in payloads:
        at_target = len(cur) >= _CHUNK_TARGET
        if cur and ((at_target and _is_preamble_payload(p)) or len(cur) >= _CHUNK_HARD_MAX):
            chunks.append(cur)
            cur = []
        cur.append(p)
    if cur:
        chunks.append(cur)
    return chunks


def _truncate(text: Any, limit: int) -> str:
    s = ("" if text is None else str(text)).strip()
    return s[:limit]


def update_spine(spine: dict, chunk: list[dict]) -> dict:
    """Advance the carried hierarchy spine over one processed chunk and return the
    NEW spine (the corrector-specific carry, richer than Gemini's preamble-only list).

    The spine carries, for the NEXT chunk's {CONTEXT} block:
      - open_sections: the stack of preambles still open at the end of this chunk, as
        {excel_row, level, description}. A preamble closes the open sections at its
        level-or-deeper (a level-N header pops everything >= N), then pushes itself.
        So a mid-section next chunk sees exactly which sections enclose it.
      - last_sl_no: the sl_no on the LAST row of this chunk that carried one -- the
        running serial number the next chunk uses to detect a restart.

    Mirrors the parser's own section-stack reasoning; cycle-free (single forward pass)
    and bounded (_SPINE_MAX_OPEN caps the stack)."""
    open_sections: list[dict] = list(spine.get("open_sections") or [])
    last_sl_no = spine.get("last_sl_no")

    for p in chunk:
        sl = p.get("sl_no")
        if sl is not None and str(sl).strip():
            last_sl_no = sl
        if _is_preamble_payload(p):
            level = p.get("level")
            # Pop any open section at this level or deeper (a sibling/ancestor header
            # closes them). Levels may be None -> treat as top-level (1) defensively.
            lvl = level if isinstance(level, int) else 1
            open_sections = [
                s for s in open_sections
                if isinstance(s.get("level"), int) and s["level"] < lvl
            ]
            open_sections.append({
                "excel_row": p.get("excel_row"),
                "level": lvl,
                "description": _truncate(p.get("description"), _SPINE_DESC_MAX),
            })
            if len(open_sections) > _SPINE_MAX_OPEN:
                open_sections = open_sections[-_SPINE_MAX_OPEN:]

    return {"open_sections": open_sections, "last_sl_no": last_sl_no}


def render_context(spine: dict, is_first_chunk: bool) -> str:
    """Render the carried spine into the {CONTEXT} prompt block.

    First chunk -> a "first slice" sentinel (nothing precedes it). Later chunks ->
    the OPEN SECTIONS list (deepest last) + the LAST sl_no, so the corrector's
    backward-jump + sl_no-restart heuristics have the above-slice context."""
    if is_first_chunk:
        return "(first slice -- this is the top of the sheet; nothing precedes it.)"
    open_sections = spine.get("open_sections") or []
    if open_sections:
        lines = [
            f"- excel_row {s.get('excel_row')} (level {s.get('level')}): "
            f"{s.get('description') or ''}".rstrip()
            for s in open_sections
        ]
        sections_block = "OPEN SECTIONS (innermost last -- the rows below most likely " \
            "belong under the deepest, unless a new header appears):\n" + "\n".join(lines)
    else:
        sections_block = "OPEN SECTIONS: (none -- no section header is open above this slice.)"
    last_sl_no = spine.get("last_sl_no")
    sl_line = (
        f"LAST sl_no (row immediately above this slice): {last_sl_no}"
        if last_sl_no is not None and str(last_sl_no).strip()
        else "LAST sl_no: (none seen above this slice.)"
    )
    return f"{sections_block}\n{sl_line}"


# ---------------------------------------------------------------------------
# Output parsing
# ---------------------------------------------------------------------------

def _strip_code_fences(text: str) -> str:
    """Remove an accidental ```json ... ``` (or bare ```) wrapper, defensively."""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z0-9]*\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t.strip()


def _extract_json_array(text: str) -> str:
    """Extract the first balanced JSON array from text, tolerant of prose around it.

    AI-2e (live-cert finding): the real model often returns explanatory prose BEFORE
    (and sometimes after) the JSON array, e.g. "Looking at the structure...\n\n[...]".
    The bare json.loads in parse_ai_response would then fail on the leading prose. This
    helper locates the array so the parser tolerates surrounding prose.

    Strategy:
      1. Strip code fences first (the existing defensive step).
      2. Find the FIRST "[" and walk forward tracking bracket depth to its MATCHING "]",
         RESPECTING string literals so a "[" / "]" inside a JSON string value (e.g. an
         "explanation" like "row [18] is a note") does NOT affect depth. Toggle in_string
         on an unescaped double-quote; track a backslash-escape flag so \" inside a string
         does not toggle. Count brackets only when NOT in_string. This handles all cases
         uniformly -- a bare array (first "[" at index 0), leading prose, trailing prose
         (the slice stops at the matching "]", dropping anything after), and string-literal
         brackets. A naive "starts with [ -> return as-is" fast path is WRONG: a bare array
         followed by trailing prose starts with "[" yet would hand json.loads "Extra data".
      3. If there is no "[" at all, or no balanced closing "]" is found, return the
         stripped text UNCHANGED -- the caller's json.loads then raises the existing
         _NonRetryable. Genuine garbage is never silently swallowed.
    """
    stripped = _strip_code_fences(text)

    start = stripped.find("[")
    if start == -1:
        return stripped  # no array at all -> caller's json.loads raises _NonRetryable

    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(stripped)):
        ch = stripped[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return stripped[start:i + 1]

    # Unbalanced (no closing "]") -> hand back the stripped text so json.loads raises.
    return stripped


def parse_ai_response(text: str, idx_map: dict, allowed_parent_excels: set | None = None) -> list:
    """Parse the model's JSON array into normalized suggestion dicts keyed by the
    INTERNAL row_index (looked up from idx_map via excel_row).

    Each output dict:
      {row_index, ai_suggested_classification, ai_classification_confidence,
       ai_suggested_parent, ai_suggested_is_root, ai_parent_confidence, ai_explanation}

    Translation + defensive rules:
      - suggested_parent "NO_CHANGE" -> ai_suggested_parent None (no suggestion),
        ai_suggested_is_root False;
        null -> ai_suggested_parent -1 + ai_suggested_is_root True (AI-2d: the root
        signal lives in its own flag; -1 is now ONLY the no-parent-index sentinel);
        <excel_row> -> idx_map lookup -> internal row_index, ai_suggested_is_root False;
        an excel_row not in idx_map -> parent suggestion DROPPED (None) + warn,
        any classification suggestion kept.
      - an element whose excel_row is not in idx_map -> the whole element is skipped
        (the model hallucinated a row) + warn.
      - suggested_classification not in {line_item, preamble, note, spacer} ->
        classification suggestion dropped (None) + warn, parent suggestion kept.
    ai_suggested_level is NOT produced -- the pass no longer outputs a level; the write-back
    stores the -1 "no suggestion" sentinel and commit derives the real level.

    R2 / ADR-0005 decision 7 -- FORWARD-REFERENCE GUARD: when allowed_parent_excels is
    given (the chunked path), a suggested parent excel_row that resolves via the
    SHEET-WIDE idx_map but is NOT in this chunk's addressable set (this chunk's rows +
    the carried OPEN SECTIONS) is a forward reference to a not-yet-seen later chunk ->
    the parent suggestion is DROPPED (None) + logged; any classification is kept. When
    allowed_parent_excels is None (the single-call path), every idx_map parent is
    allowed -- behaviour is byte-identical to the pre-R2 contract.
    """
    # AI-2e: extract the array from surrounding prose (the real model often prefixes
    # an explanation). Genuine garbage (no array) falls through to the json.loads raise.
    raw = _extract_json_array(text)
    try:
        data = json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise _NonRetryable(f"AI response was not valid JSON: {exc}")
    if not isinstance(data, list):
        raise _NonRetryable("AI response JSON was not an array")

    suggestions: list = []
    for element in data:
        if not isinstance(element, dict):
            logger.warning("boq_ai: skipping non-object suggestion element")
            continue
        excel = element.get("excel_row")
        if excel not in idx_map:
            logger.warning("boq_ai: dropping suggestion for unknown excel_row %r", excel)
            continue
        row_index = idx_map[excel]

        # --- classification ---
        raw_cls = element.get("suggested_classification")
        if raw_cls and raw_cls in _ASSIGNABLE_CLASSIFICATIONS:
            ai_cls = raw_cls
            cls_conf = element.get("classification_confidence")
            cls_conf = cls_conf if cls_conf in _CONFIDENCE_VALUES else None
        else:
            if raw_cls:  # present but not assignable -> drop, keep parent
                logger.warning(
                    "boq_ai: dropping invalid classification %r for excel_row %r",
                    raw_cls, excel,
                )
            ai_cls = None
            cls_conf = None

        # --- parent ---
        ai_is_root = False
        raw_parent = element.get("suggested_parent", _NO_CHANGE)
        if raw_parent == _NO_CHANGE:
            ai_parent = None
        elif raw_parent is None:
            # Root suggestion (AI-2d): the signal lives in its OWN flag. -1 stays the
            # "no parent-index suggestion" sentinel; ai_is_root carries "become root".
            ai_parent = -1
            ai_is_root = True
        else:
            try:
                pe = int(raw_parent)
            except (ValueError, TypeError):
                logger.warning(
                    "boq_ai: dropping non-int parent %r for excel_row %r", raw_parent, excel
                )
                ai_parent = None
            else:
                if pe not in idx_map:
                    logger.warning(
                        "boq_ai: dropping parent for excel_row %r -- parent excel_row %r "
                        "not in this sheet", excel, pe,
                    )
                    ai_parent = None
                elif allowed_parent_excels is not None and pe not in allowed_parent_excels:
                    # Forward reference: pe is a real sheet row but in a not-yet-seen
                    # later chunk -> drop + log (the model can only name an earlier
                    # section, carried in OPEN SECTIONS, or a row in this chunk).
                    logger.warning(
                        "boq_ai: dropping forward-reference parent for excel_row %r -- "
                        "parent excel_row %r is in a not-yet-seen later chunk", excel, pe,
                    )
                    ai_parent = None
                else:
                    ai_parent = idx_map[pe]
        # parent confidence only when there is a real parent suggestion (a row index)
        # OR a root suggestion -- a root opinion ("parent = nothing") keeps its confidence.
        parent_conf = element.get("parent_confidence")
        parent_conf = parent_conf if (
            (ai_parent is not None or ai_is_root) and parent_conf in _CONFIDENCE_VALUES
        ) else None

        suggestions.append({
            "row_index": row_index,
            "ai_suggested_classification": ai_cls,
            "ai_classification_confidence": cls_conf,
            "ai_suggested_parent": ai_parent,
            "ai_suggested_is_root": ai_is_root,
            "ai_parent_confidence": parent_conf,
            "ai_explanation": element.get("explanation") or "",
        })

    return suggestions


# ---------------------------------------------------------------------------
# Response text extraction
# ---------------------------------------------------------------------------

def _safe_text(resp) -> str:
    """Concatenate the text of any text content blocks, raising _NonRetryable on an
    empty response or an unexpected stop_reason (the worker converts it to an error
    event). Anthropic returns response.content as a list of typed blocks."""
    stop_reason = getattr(resp, "stop_reason", None)
    if stop_reason and stop_reason not in ("end_turn", "stop", "stop_sequence"):
        raise _NonRetryable(f"no usable output (stop_reason={stop_reason})")

    parts: list = []
    for block in getattr(resp, "content", None) or []:
        if getattr(block, "type", None) == "text":
            t = getattr(block, "text", None)
            if t:
                parts.append(t)
        elif isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
            parts.append(block["text"])

    text = "".join(parts).strip()
    if not text:
        raise _NonRetryable("empty response")
    return text


def _is_transient(exc) -> bool:
    if isinstance(exc, _NonRetryable):
        return False
    text = f"{type(exc).__name__} {exc}".upper()
    return any(marker in text for marker in _TRANSIENT_MARKERS)


def _chunk_usage(resp) -> tuple[int, int]:
    """(input_tokens, output_tokens) for one chunk's response, defaulting to 0."""
    usage = getattr(resp, "usage", None)
    if usage is None:
        return 0, 0
    return (
        int(getattr(usage, "input_tokens", 0) or 0),
        int(getattr(usage, "output_tokens", 0) or 0),
    )


def _log_chunk_usage(resp, settings: dict, sheet_name: str, chunk_idx: int, n_chunks: int) -> tuple[int, int]:
    """Per-chunk token usage at .debug (R2: replaces the per-call info line). Returns
    the (input, output) tokens so run_ai_pass can aggregate them into ONE info line per
    pass. Never logs prompt content or the API key. Logging must never break the pass."""
    try:
        input_tokens, output_tokens = _chunk_usage(resp)
        logger.debug(
            "boq_ai chunk tokens: model=%s sheet=%r chunk=%s/%s input=%s output=%s",
            settings.get("model"), sheet_name, chunk_idx, n_chunks, input_tokens, output_tokens,
        )
        return input_tokens, output_tokens
    except Exception:
        return 0, 0  # logging must never break the pass


def _log_pass_usage(settings: dict, sheet_name: str, n_chunks: int,
                    total_in: int, total_out: int) -> None:
    """ONE aggregated info line per AI pass (R2 / ADR-0005 decision 7). The boq_ai
    logger (NOT the Error Log, so it does not spam). Never logs prompt or key."""
    try:
        logger.info(
            "boq_ai pass tokens: model=%s sheet=%r chunks=%s input=%s output=%s",
            settings.get("model"), sheet_name, n_chunks, total_in, total_out,
        )
    except Exception:
        pass  # logging must never break the pass


# ---------------------------------------------------------------------------
# The API call
# ---------------------------------------------------------------------------

def _classify_chunk(
    client, sheet_name: str, chunk: list[dict], context: str, idx_map: dict,
    allowed_parent_excels: set, settings: dict, chunk_idx: int, n_chunks: int,
) -> tuple[list, int, int]:
    """Classify ONE chunk: build the per-chunk prompt (chunk rows + carried {CONTEXT}),
    run the retry loop, parse the response against the SHEET-WIDE idx_map, and return
    (suggestions, input_tokens, output_tokens).

    The retry loop is IDENTICAL to the pre-R2 single-call loop -- it just runs PER
    CHUNK now: range(1, _MAX_RETRIES + 2); a transient error sleeps and retries; a
    terminal failure logs + RAISES _NonRetryable (NOT frappe.throw -- runs in a worker).
    allowed_parent_excels = this chunk's excel_rows + the carried OPEN SECTIONS, so a
    forward-reference parent (an excel_row in a not-yet-seen later chunk) is dropped +
    logged by parse_ai_response -- the model can only name a parent it was shown (this
    chunk) or one carried in OPEN SECTIONS (an earlier chunk)."""
    # Strip the internal spine-only `level` from every row: the model receives NO per-row
    # level. update_spine still reads `level` off the original `chunk` dicts in run_ai_pass
    # (the OPEN SECTIONS {CONTEXT} carries the effective preamble level). See _wire_element.
    rows_json = json.dumps([_wire_element(p) for p in chunk])
    prompt = (
        _AI_PASS_PROMPT_TEMPLATE
        .replace("{SHEET_NAME}", sheet_name or "")
        .replace("{CONTEXT}", context)
        .replace("{ROWS_JSON}", rows_json)
    )

    for attempt in range(1, _MAX_RETRIES + 2):
        try:
            resp = client.messages.create(
                model=settings["model"],
                max_tokens=settings["max_tokens"],
                messages=[{"role": "user", "content": prompt}],
                timeout=settings["request_timeout_seconds"],
            )
            text = _safe_text(resp)            # raises _NonRetryable on empty / bad stop
            tin, tout = _log_chunk_usage(resp, settings, sheet_name, chunk_idx, n_chunks)
            suggestions = parse_ai_response(text, idx_map, allowed_parent_excels)
            return suggestions, tin, tout
        except Exception as exc:
            if attempt <= _MAX_RETRIES and _is_transient(exc):
                time.sleep(_BACKOFF_SECONDS * attempt)
                continue
            frappe.log_error(title="BoQ AI pass failed", message=frappe.get_traceback())
            if isinstance(exc, _NonRetryable):
                raise
            raise _NonRetryable(str(exc)) from exc


def run_ai_pass(sheet_name: str, review_rows: list, settings: dict, api_key: str) -> list:
    """Run the AI structure-suggestion pass for one sheet and return normalized
    suggestions keyed by internal row_index.

    settings + api_key are INJECTED by the caller (AI-2c worker) -- this service
    never reads get_boq_ai_settings / get_boq_ai_api_key itself (keeps it unit-
    testable). settings keys used: model, max_tokens, request_timeout_seconds.

    R2 / ADR-0005 -- CHUNKING WITH A CARRIED HIERARCHY SPINE: large sheets used to
    send the WHOLE sheet in one client.messages.create call and timed out. The sheet
    is now split into ordered chunks (<= _CHUNK_THRESHOLD rows -> ONE chunk, the
    single-call path is byte-identical to before). Each later chunk's prompt carries a
    {CONTEXT} block built from the running spine (open section headers + last sl_no),
    so the corrector's backward-jump + sl_no-restart heuristics survive a cut. Every
    chunk parses against the SHEET-WIDE idx_map (built up front), so a parent in an
    earlier chunk still resolves. Suggestions from all chunks are accumulated and the
    MERGED list is returned -- the worker still applies + commits ONCE (all-or-nothing).
    A terminal chunk failure re-raises and the whole pass is retried by the worker.

    Token logging (decision 7): per-chunk usage at .debug; ONE aggregated info line
    per pass (replacing the former per-call _log_usage line).
    """
    rowidx_to_excel, idx_map = _build_excel_maps(review_rows)
    payloads = [_build_row_payload(row, rowidx_to_excel) for row in review_rows]
    chunks = chunk_rows(payloads)

    client = anthropic.Anthropic(api_key=api_key)

    all_suggestions: list = []
    spine: dict = {"open_sections": [], "last_sl_no": None}
    total_in = 0
    total_out = 0
    n_chunks = len(chunks)
    single_call = n_chunks <= 1  # one chunk -> NO forward-ref guard (every parent is in-scope)
    for i, chunk in enumerate(chunks):
        context = render_context(spine, is_first_chunk=(i == 0))
        # Allowed parents = this chunk's rows + the carried open sections. None for the
        # single-call path so its behaviour is byte-identical to the pre-R2 contract.
        if single_call:
            allowed_parent_excels: set | None = None
        else:
            allowed_parent_excels = {p.get("excel_row") for p in chunk}
            allowed_parent_excels.update(
                s.get("excel_row") for s in (spine.get("open_sections") or [])
            )
        suggestions, tin, tout = _classify_chunk(
            client, sheet_name, chunk, context, idx_map, allowed_parent_excels,
            settings, i + 1, n_chunks,
        )
        all_suggestions.extend(suggestions)
        total_in += tin
        total_out += tout
        # Advance the spine over this chunk for the NEXT chunk's {CONTEXT}.
        spine = update_spine(spine, chunk)

    _log_pass_usage(settings, sheet_name, n_chunks, total_in, total_out)
    return all_suggestions
