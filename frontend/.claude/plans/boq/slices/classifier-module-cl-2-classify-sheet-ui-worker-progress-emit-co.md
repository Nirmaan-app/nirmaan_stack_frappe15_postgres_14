## Classifier module -- CL-2 (classify-sheet UI + worker progress emit) COMPLETE

Frontend classify-sheet surface on the pricing editor + one small backend addition (incremental progress emit), on `feature/boq-phase-5` (one feat commit + this docs commit). Additive: a NEW socket event, a NEW read-only column, new page state; no existing endpoint contract changed, the row memo intact, no doctype change (no migrate). CL-3 (click-to-edit verdict picker) + the two-engine overlap-conflict fork stay PARKED.

**Backend (small):**
- `orchestrator.classify_sheet_rows` now drives the AI in slices of `_AI_BATCH` (=20, IDENTICAL to `ai_voter._BATCH`) so progress fires BETWEEN 20-row batches (Option A). AI behaviour is byte-identical to the certified smoke test; `ai_voter` is untouched; `progress_cb` is per-batch (was per-row post-AI).
- `classify._classify_worker` passes a `progress_cb` that publishes `boq:classify_sheet_progress {boq, sheet_name, discipline, done, total}`. Terminal `boq:classify_sheet_done` + Redis poll unchanged.

**Frontend (`frontend/src/pages/boq-wizard/`):**
- **`boqTypes.ts`** -- `EngineOption` / `ClassifyScope` / `ClassifySummary` / `SheetCategoryRow`.
- **`ClassifySheetDialog.tsx` (new)** -- modeled on CopyForwardDialog (`Set<selected>` + `Record<id,scope>`). Registry-driven engine picker (`available` gates selectable, no hardcoded names), per-engine whole-sheet | row-range scope (validated start<=end), fires `start_classify` per engine. Pure vitest helpers: `selectableEngines`, `validateRange`, `buildStartArgs`, `clampDone`, `reduceProgress`, `skipRollupText`, `isNeedsReviewCategory`.
- **`PricingGrid.tsx`** -- read-only **Category** column as the FIRST right-pane cell (colIndex `FIXED_ANCHOR_COUNT`; anchors stay 5). Descriptor colIndex base centralized to `DESCRIPTOR_COL_START = FIXED_ANCHOR_COUNT + 1` (the +1 in ONE place); leading `<col>`/`<th>` in the scrolling-pane + single-table colgroups (not the frozen pane). Driven by a reference-stable `categoriesByExcelRow` map (one line in `pricingRowPropsAreEqual`) -- row memo untouched. Amber cue on needs-review; DISPLAY ONLY (CL-3 seam).
- **`SheetPricingPage.tsx`** -- `get_sheet_categories` fetch -> `categoriesByExcelRow`; "Classify sheet" ribbon button beside Collapse-all (inherits `{!isGridOnly}`); the dialog; the page's FIRST screen-scoped socket cluster (`progress`/`done` + reconnect self-heal + `get_classify_status` recovery, guarded on boq+sheet+discipline); inline x-of-y progress bar + honest completion summary (N of M, K flagged, plain-word skip rollup); a "Needs review" view-only filter.

**Tests / gates (in-container):** `ClassifySheetDialog.test.ts` 21 vitest (all helpers) + backend `test_classify` +1 progress test (monotonic done, capped, ends total-of-total). `tsc --noEmit` clean for all boq-wizard files (pre-existing unrelated errors remain -- the project builds via `vite build`, so baseline tsc is red); `vitest` 197 passed (21 new + 131 grid + 45 priceability); `yarn build` exit 0. Backend canaries green: `test_classify` 22, `test_row_category` 23, `test_pricing` 176.

**Manual verification (owner):** restart bench workers first (no hot-reload -- the worker changed). On a committed NBoQ Electrical sheet: Classify sheet -> pick Electrical -> whole-sheet or a small range -> watch x-of-y progress -> summary -> Category column populates + needs-review rows marked -> toggle the needs-review filter. (Editing a verdict is CL-3.)

