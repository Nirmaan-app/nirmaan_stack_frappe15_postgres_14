# 5. Claude review classifier: chunking with a carried hierarchy spine

Date: 2026-06-24

## Status

Accepted. Extends the chunking pattern established for Gemini in [ADR-0002](./0002-boq-review-ai-classifier.md) to the **Claude corrector**, with a corrector-specific carried-context design. Built on `feature/boq-ai-validations`.

## Context

The Claude review classifier sends the **entire sheet in one** `client.messages.create` call — the stateless service `boq_ai_assist.run_ai_pass(sheet_name, review_rows, settings, api_key)` (`services/boq_ai_assist.py:450`, LLM call at `:471`, prompt `_AI_PASS_PROMPT_TEMPLATE` at `:68`). On large sheets this exceeds `request_timeout_seconds` (120s) and the pass fails with a response-timeout error.

Gemini already chunks (`services/boq_gemini_assist.py::chunk_rows`, threshold/target/hard-max **120 / 100 / 200**) and carries forward previously-seen **preambles as nameable parents** so a *blind* chunk-2 child can reference a chunk-1 section.

Claude differs in a way that matters for chunking: it is a **corrector**, not a blind classifier. Its prompt receives the parser's `parent_excel_row` for every row and leans on two **global** signals a naive cut would fragment:

- **`sl_no` restart detection** (prompt L88-98) — needs the serial-number sequence spanning the cut.
- the **backward-parent-jump** mis-parenting heuristic (prompt L96) — needs the section header that sits *above* the chunk.

So porting Gemini's preamble-carry alone is insufficient: a chunk starting mid-section would lose the open-section context and the running `sl_no`, degrading corrections near boundaries.

The Claude prompt is owner-locked, marked "EMBEDDED VERBATIM … do NOT paraphrase" (validated against 5 reference sheets). ADR-0003 §8 keeps the Claude (`ai_*`) and Gemini (`gemini_*`) services hard-separated with a **one-directional** import (Gemini imports from Claude, never the reverse).

## Decision

1. **Chunk inside the service.** The chunk loop lives *inside* `boq_ai_assist.run_ai_pass`; the endpoint + `_run_ai_pass_worker` in `api/boq/wizard/ai_assist.py` call it once and are **untouched**, preserving the `ai_in_progress` flag / `boq:ai_pass_done` socket / resume + freeze-gate lifecycle.

2. **Carry the full hierarchy spine, not just preambles.** Each later chunk's prompt receives a `{CONTEXT}` block carrying the **open preambles + their levels + the last-seen `sl_no` + the active section header**, so a mid-section chunk knows which section it is in and whether an `sl_no` restart already happened. This is deliberately *more* than Gemini carries, because the corrector's heuristics are global.

3. **Additive verbatim-prompt edit + re-validation.** Add a new `{CONTEXT}` section + a short instruction to `_AI_PASS_PROMPT_TEMPLATE`, leaving the validated corrector body byte-for-byte unchanged (a sanctioned additive exception). The change is **re-validated against the reference sheets** before shipping.

4. **Cut on parser `preamble`.** Chunk boundaries are placed just before a parser-identified `preamble` row (already present in the Claude payload), avoiding a new fetch field. Sizes start at Gemini's 120 / 100 / 200 and are tuned empirically.

5. **All-or-nothing, single commit.** Mirroring the dual-AI Gemini (`classify_sheet` accumulates all chunks in memory; the worker writes + commits once and rolls back on failure — `gemini_assist.py:754-761`), `boq_ai_assist.run_ai_pass` classifies all chunks in memory and returns the merged suggestion list; the existing worker applies + commits once. A terminal chunk failure re-raises and persists nothing.

6. **Duplicate, don't import.** `chunk_rows` and the spine-builder are **duplicated** into `boq_ai_assist` (consistent with ADR-0003 §8's one-directional Claude←Gemini import and the owner-locked/verbatim status of the Claude service), not extracted to a shared module that would invert the dependency.

7. **`ai_*` contract unchanged.** `parse_ai_response` / `_apply_ai_suggestions` output keys, the doctype JSON, and the write-back are untouched — chunking only changes the *source* of the suggestion list. The pending per-pass token-logging fix (`boq_ai.log`) is satisfied by **one aggregated info line per pass** with per-chunk usage at `.debug` (replacing the current per-call `_log_usage` line).

## Consequences

- Large sheets no longer time out; each request is bounded to ~100 rows.
- The corrector's `sl_no`-restart and backward-jump heuristics survive chunk boundaries because the spine travels with each chunk.
- The verbatim prompt gains one additive section; shipping is gated on re-validation against the 5 reference sheets.
- Slight duplication (`chunk_rows`/spine helper in both services) is accepted to preserve the one-directional dependency and owner-lock.
- All-or-nothing means a late-chunk failure re-runs the whole pass — acceptable since each chunk is small and the worker's resume mode still recovers a stuck in-progress flag.
- A corrector reparenting to a section in a not-yet-seen later chunk (a forward reference) is dropped/logged rather than honored; reparenting targets earlier/known sections via the carried spine + sheet-wide `idx_map`.
