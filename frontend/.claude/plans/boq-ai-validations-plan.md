# BoQ AI Validations — Implementation Plan

**Branch:** `feature/boq-ai-validations` (off `develop`; contains the dual-AI work; merges back to `develop` conflict-free).
**Design status:** locked via `/grill-with-docs` 2026-06-24.
**ADRs:** [0005](../../../docs/adr/0005-claude-classifier-chunking.md) (Claude chunking + carried spine) · [0006](../../../docs/adr/0006-ai-apply-block-then-revert.md) (apply exclusivity, revises ADR-0003 §4) · [0003](../../../docs/adr/0003-dual-provider-boq-ai-assist.md) (§4/§5 amended).

Five requirements: **R1** Gemini diffs-only highlight · **R2** Claude chunking · **R3a** one-AI-apply (block, not overwrite) · **R3b** restructure-lock polish · **R4** review-phase warnings panel.

---

## Execution Strategy

Execute via the Plan-to-Parallel workflow (see CLAUDE.md). Create tasks with `TaskCreate`, set dependencies with `TaskUpdate`, launch each wave as parallel `general-purpose` subagents.

- **Wave 1 (parallel):** R2 (backend-only, isolated), R1 (one frontend file), R4 (warnings panel).
- **Wave 2 (after Wave 1):** R3a — the keystone. Depends on R1 + R4 only because all three edit `ReviewTree.tsx`; serialize the `ReviewTree.tsx` edits to avoid intra-branch churn. R2 is backend and does not block.
- **Wave 3 (after Wave 2):** R3b polish (small; touches the restructure modal, downstream of R3a's apply guard).

`ReviewTree.tsx` is the shared frontend hotspot (R1, R4, R3a all touch it) → serialize those three. `boq_ai_assist.py` (R2) and `RestructureModal.tsx` (R3b) are otherwise isolated.

Each subagent prompt must include the **why** (per CLAUDE.md), the file:line targets below, the relevant ADR, and the test expectations.

---

## R1 — Gemini diffs-only highlight  *(display-only)*

**Files:** `frontend/src/pages/boq-wizard/GeminiSuggestionColumn.tsx`, `ReviewTree.tsx`.

**Changes:**
1. `geminiSuggestionInfo` (`GeminiSuggestionColumn.tsx:36-55`):
   - **Parent branch (44-47):** `hasParent` true only when the Gemini parent differs from the **parser** `parent_index` — (a) Gemini root (`gemini_suggested_is_root === 1`) while parser is non-root (`parent_index != null && >= 0`), or (b) a real `gemini_suggested_parent` (`!= null && !== -1`) ≠ `row.parent_index`. Root-vs-root ⇒ no signal. Compare against **parser** `parent_index`, not `effective_parent_index`.
   - **Classification branch (40-43):** already diffs vs parser; **add** an exclusion so `gemini_suggested_classification ∈ {subtotal_marker, header_repeat}` does **not** set `hasClass` (suppress detection-only divergence).
2. **Violet row tint:** derive `hasPendingGemini` (= the new diffs-only `hasClass || hasParent`) and add a full-row **violet** tint in `ReviewTree.tsx`, mirroring the Claude indigo tint at `:1613`. Keep the existing H/M/L confidence pill.
   - **Both-providers-disagree precedence** (build detail): Claude indigo keeps the full-row tint; Gemini shows a **violet left-edge accent** when both disagree, so both are visible. (Resolve final visual in build/review.)
3. The Gemini column filter (`ReviewTree.tsx:1102-1111`) consumes `geminiSuggestionInfo` → auto-tightens to the diffs-only set (intended; verify).

**Tests:** `tsc` clean (delta 0). Manual: parser-agree parent ⇒ no badge/tint; differ ⇒ badge + tint; divergence to `subtotal_marker` ⇒ no highlight. Add/adjust any `GeminiSuggestionColumn` unit test if one exists.

---

## R2 — Claude classifier chunking  *(backend-only; ADR-0005)*

**Files:** `nirmaan_stack/services/boq_ai_assist.py` (primary). `api/boq/wizard/ai_assist.py` endpoint/worker **untouched** (confirm).

**Changes (inside `boq_ai_assist.run_ai_pass`, `:450`):**
1. Extract a **per-row payload builder** from `build_rows_payload` (`:180-227`); build a **sheet-wide `idx_map`** up front (so a cross-chunk parent resolves).
2. Add `chunk_rows` + constants (`_CHUNK_THRESHOLD=120`, `_TARGET=100`, `_HARD_MAX=200`) — **duplicated** into this service (not imported from Gemini). Cut just before a parser `preamble` row.
3. Add a **spine-builder**: as chunks are processed, track open preambles + their levels + last-seen `sl_no` + active section header.
4. Add a `{CONTEXT}` slot to `_AI_PASS_PROMPT_TEMPLATE` (`:68`) — **additive**, validated body unchanged; fill it per chunk with the carried spine.
5. Loop chunks in `run_ai_pass`: per chunk build prompt (chunk rows + `{CONTEXT}`), keep the existing **retry loop per chunk** (`client.messages.create:471`), `parse_ai_response` per chunk against the sheet-wide `idx_map`, **accumulate** suggestions. Return the merged list (worker applies + commits once → all-or-nothing).
6. **Token logging:** one aggregated `info` line per pass; per-chunk usage at `.debug` (replaces the per-call `_log_usage`, `:431`).
7. Forward-reference reparenting (suggested parent in an unseen later chunk) ⇒ drop + log.

**Tests:** backend unit tests (mirror `test_gemini_assist`): `chunk_rows` boundary placement (cuts before preamble); spine-builder carries open-section + `sl_no` across a cut; multi-chunk `run_ai_pass` with a fake Anthropic client accumulates correctly; single-call path unchanged for small sheets. **Re-validate `_AI_PASS_PROMPT_TEMPLATE` against the 5 reference sheets before shipping.**

---

## R3a — One-AI-apply (block, not overwrite)  *(keystone; ADR-0006)*

**Files:** `api/boq/wizard/review_screen.py` (chokepoint `_apply_and_save_row_edit` `~1018-1083`, `get_review_rows`), `ai_assist.py` (`accept_ai_suggestion`, `revert_ai_acceptance`), `gemini_assist.py` (`accept_gemini_suggestion` `:438-448`, `claude_reverted` `:369/443-446/533`, `revert_gemini_acceptance`), `review_screen.py::save_review_restructure` (`~2116/2148`). Frontend: `GeminiAcceptBlock.tsx` (handleApply `:165`, Apply `:335-342`, revert `:237`), `ReviewTree.tsx` (handleApplyAi `:512`, Claude revert `:576`, `revert_available` consumption).

**Changes:**
1. **Block guard:** in `accept_ai_suggestion`, `accept_gemini_suggestion`, and `save_review_restructure`, throw `ValidationError` if the row is **not at parser baseline** (any `*_suggestion_status == "Accepted"` OR a manual `human_*` override). Replace the auto-revert path.
2. **Remove** the pre-revert block (`gemini_assist.py:438-448`) and the `claude_reverted` field; rewrite/remove the chokepoint ASYMMETRY NOTE + the auto-clear-the-other-provider logic (`1018-1019/1056-1057`) — no longer needed since stacking is blocked.
3. **Unified "Revert to parser":** one endpoint/path that restores the parser baseline for a row + any children a restructure moved, for **both** AI acceptances and manual overrides. `get_review_rows` exposes a single per-row "has standing override / revertable" boolean (extend `revert_available` to also be true for a manual override).
4. **Frontend:** disable both providers' Apply when the row has any standing override; render the unified "Revert to parser" affordance (replacing the two provider-specific reverts, or unifying their handler).

**Tests:** backend — cross-provider apply throws; apply-over-manual-edit throws; unified revert restores parser baseline (AI case, manual case, with-children case); sticky/re-run semantics intact. **Rewrite `TestDualAISwitch`** (currently asserts auto-revert) to assert block. Target: `test_review_screen` + `test_gemini_assist` + `test_ai_assist` all green.

---

## R3b — Restructure-lock polish  *(verify/polish; after R3a)*

**Files:** `frontend/src/pages/boq-wizard/RestructureModal.tsx` (message line `:349-358`, controls `:363-443`, seeding `:165-172`, title `:319-339`), `ReviewTree.tsx` (`handleApplyAi:510-536` preset wiring).

**Changes:** render the locked "This Row's Position" as a **disabled-but-visible control** (move radio selected + greyed picker showing the AI-chosen parent) instead of the read-only message line; change the modal **title/subtitle** when `hasPresetParent` to signal the AI lock ("AI set this row's position — place its children"). Keep current scope: **parent/level change locks; classification-only opens unlocked**; **no default child placement** (user places each child).

**Tests:** frontend manual — disabled control shows the AI parent; children still required (`canSave` blocks until all placed); both providers.

---

## R4 — Review-phase warnings panel

**Files:** `api/boq/wizard/review_screen.py` (`get_structural_breaks` `:2360` already exists; `FLAG_LABELS` `:176-184`), `frontend/src/pages/boq-wizard/SheetReviewPage.tsx` (flags array, `FLAG_LABELS/FLAG_REASONS` `:531-537`, count strip `:796-802`, `dismissedRowIdx` `:544-546`), `ReviewTree.tsx` (`revealAndScrollToRow` `:1010-1031`, `rowRefs`, `highlightedIdx`, `flags_dismissed`).

**Changes:** fetch `get_structural_breaks` alongside the advisory flags; render a **clickable panel inside `ReviewTree`** — **one entry per row** with its flag/break badges, **structural breaks grouped distinctly** (must-fix) from advisories. Click ⇒ `revealAndScrollToRow(row_index)` + amber pulse (keep `block:'nearest'`, no focus). **Evolve the count-only strip into the panel** (keep the "– N cleared" rollup). **Hide dismissed rows by default + a "Show dismissed" toggle** (pricing-strip parity).

**Tests:** frontend manual — click an entry scrolls + pulses the correct row; breaks vs advisories grouped; dismissed handling; works with the Gemini column mounted.

---

## Open build details (resolve in build)
- R1: final visual for the both-providers-disagree row (proposed: Claude full-row indigo + Gemini violet left-edge accent).
- R2: exact `{CONTEXT}` wording in the verbatim prompt (additive; re-validate).
- R3a: whether the unified revert is a new endpoint or an extension of `revert_ai_acceptance`/`revert_gemini_acceptance` into a single `revert_to_parser`.

## Doc artifacts
ADR-0005, ADR-0006 (written) · ADR-0003 §4/§5 amendment (written) · per-slice entries appended to `boq-changelog.md` during build.
