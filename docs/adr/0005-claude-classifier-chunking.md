# 5. Claude review classifier: chunking with a carried hierarchy spine

Date: 2026-06-24

## Status

Accepted; **amended 2026-10-12 — see [Amendment A](#amendment-a-2026-10-12--the-guided-prompt-v2-and-the-examples-library-slice-s1b) at the end** (the guided prompt v2 and the examples library). Extends the chunking pattern established for Gemini in [ADR-0002](./0002-boq-review-ai-classifier.md) to the **Claude corrector**, with a corrector-specific carried-context design. Built on `feature/boq-ai-validations`.

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


## Amendment A (2026-10-12) — the guided prompt (v2) and the examples library (slice S1b)

**Status:** Accepted. Amends decisions 1, 3 and 4. Decisions 2, 5, 6 and 7 are unchanged. Built on `feature/boq-jev-integration`.

**Why.** Two measurement runs on 119 committed sheets (16,851 rows) showed that a *guided* prompt — reworded row-type definitions, a quantity yes/no on each row, and per-row worked examples plus candidate parents — lifts row-type accuracy from the parser's 95.9% to about 98% at the same call count. The owner ruled to build it.

**Owner rulings, quoted.**

- On using Claude's own output: *"WE WILL USE THE CLAUDE own output for now."*
- On the Claude job: *"we should increse the 10 min limit to 20 mins"*.
- On the design choices put to the owner after the first measurement (rewording the six definitions; the library as a cached file; excluding the checked BoQ, its revision family and TestProject BoQs; every committed sheet counts as reviewed; near-copy tenders included; a 300-second per-request timeout): *"go with your suggestions"*.
- On the review and save paths: *"No fucntionlaity related to the checks and worflows of how changes are made and saved chould be changed because they handle a lot of different type of scenarios."*
- On a nightly rebuild: *"i dsont want any unnecssary jobs in production"* — so there is no scheduled job.

**What changes.**

1. **Decision 3 (the verbatim prompt) — two ruled changes to the body.** The six row-type definitions are replaced by the `meanings_v4` texts, and one paragraph is inserted directly before `Rows (JSON):` explaining `has_qty` and the GUIDANCE block. Everything else in the body is byte-for-byte as before. The result is the prompt that was measured; it is identified by `boq_ai_assist.PROMPT_VERSION = "v2"` and is still marked "EMBEDDED VERBATIM". Both passages are test-pinned (`TestGuidedPromptPins`), and the whole rendered prompt is pinned byte-for-byte on one real sheet (`TestGuidedPromptFixture`: BOQ-26-00244 / CCTV, sha256 `799d00a1…fe3423`, 43,699 characters).

2. **The wire row gains one key.** Each row sent to the model has exactly 7 keys: the previous 6 plus `has_qty`, a true / false derived from the review row's `qty_total` / `qty_by_area`. No quantity, rate or amount value is ever sent (`TestClaudeWirePin`).

3. **A GUIDANCE block follows the rows on every call.** Keyed by `excel_row`, it gives for each row up to 5 `similar_reviewed_rows` (rows from *other* BoQs whose row type is already committed) and `candidate_parents` (shortlist rule v4 over the parser's own row types and parents, plus "none (top level)"). A row with no guidance gets two empty lists.

4. **Decision 4 (no new fetch field) is amended.** The worker's fetch gains `qty_total` and `qty_by_area`. They feed `has_qty` and the look-up only.

5. **Decision 1 (the worker is untouched) is amended, narrowly.** `api/boq/wizard/ai_assist.py` changes in four places: the two fetch fields; the prompt version in the result-cache key (so a result produced by an earlier prompt is never served for this one); the Claude job limit 600 → 1200 seconds (Gemini's and the parse job's 600 are untouched); and the worker building the guidance and handing it to the service. The chunk loop still lives inside the service. The `ai_in_progress` flag, the `boq:ai_pass_done` event, `_apply_ai_suggestions` and the accept / reject / revert endpoints are byte-identical.

6. **The examples library** (`services/boq_ai_guidance.py`). Built from committed data (current `BoQ Sheet` + `BOQ Nodes`; the committed `row_class` is the truth; text from the committed grid's sl_no / description / unit / qty columns only). It is one file under the site's private folder — deliberately not a Frappe File record, so it never reaches the cloud bucket. Exclusions are applied at look-up: the checked BoQ and its revision family (the `BOQs.source_boq` chain, read live) and TestProject BoQs. **It is rebuilt on demand only:** a Claude run that finds the file missing or older than 24 hours rebuilds it first, under one lock; a run that meets a rebuild in progress waits up to 3 minutes and then uses the new file. If the library cannot be had, the pass still runs — with candidate parents and no examples — and an ERROR line in the `boq_ai` log says why.

**Consequences.**

- A guided call is about five times the size of the previous one (measured: 610 input tokens per row against 121).
- The first Claude run after the file goes stale pays for the rebuild (about 70 seconds on the dev2 copy: 133,477 rows from 298 BoQs, a 183 MB file). Each job holds the library in memory while it runs (about 590 MiB peak measured).
- A BoQ committed today becomes an example only after the next rebuild, i.e. within 24 hours of the next Claude run.
- The sentence "Prefer a parent from candidate_parents" is part of the measured prompt and stays, although Claude's parent suggestions are still only *offered* — nothing is applied without the reviewer (ADR-0006 is untouched).
- Changing the template, the wire row or the GUIDANCE block requires bumping `PROMPT_VERSION` and updating the pins first.
