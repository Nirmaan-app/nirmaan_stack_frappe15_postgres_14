<!-- Carved from frontend/CLAUDE.md on 2026-07-30 (structural carve).
     frontend/CLAUDE.md is a router; this file holds the detail it points to.
     Load when: Touching ReviewTree.tsx -- the review screen's load-bearing invariants -->

### Review screen (`ReviewTree.tsx`) -- load-bearing invariants

- **Depth / indent comes from the `effective_parent_index` chain (`computeDepths`), NEVER the stored `level`** (which
  diverges after `human_parent` edits). `isVisible` walks from the PARENT, so a collapsed row stays visible.
- **Description is a FAN-OUT of the original columns (MC-4), not the single joined anchor.** When any row carries
  `description_parts_raw` (`sheetHasDescriptionParts`), the Description anchor becomes one column per mapped
  description column via the pure helpers in `reviewRender.tsx` (`buildDescriptionColumns` / `descriptionCellValue`):
  set+order from the `role:"description"` descriptors; per-cell value by `col_letter`; LABEL from the triples'
  `header_label` **union-across-rows** (letter fallback), `" 2"/" 3"`-suffixed on duplicates. The FIRST column is the
  always-on wide anchor (depth indent + `(no description)` fallback via the shared `DescriptionCellInner`); the rest
  are narrower and join the `visibleCols` picker via `pickerColumns`. `totalCols` keeps base `8` + extra visible
  description cols so `colSpan`s stay aligned. **LEGACY FALLBACK:** no parts on any row (pre-MC-2 drafts) -> the
  single anchor renders via the SAME `DescriptionCellInner` (byte-identical). Search still reads the joined
  `row.description` (unchanged); exports keep the single joined Description (MC-5/owner-deferred).
- **Description search uses the shared `boqDescriptionSearch.ts` (`fuzzyDescriptionMatchSet`)** — token-AND, min
  length 2; fuzzy decides MEMBERSHIP, document order drives prev/next. ReviewTree + SheetSearchView both call it;
  RestructureModal inherits via SheetSearchView. Never inline a second matcher.
- **Search highlight = RINGS (`ring-inset`), never backgrounds** (a background would mask the edited-green tint).
- **Filters gate on the FILTER axis (`classificationVisible && passesFilter`), NOT the collapse axis** — a hit can
  never be a filtered-out row, and stepping auto-expands a collapsed-parent hit via `revealAndScrollToRow`.
- **Finalized / "Parsed Check Done" freeze:** `readOnly` HIDES all 11 write affordances; backend
  `_guard_sheet_not_frozen` is the durable backstop. Restructure goes through `RestructureModal` (5 child-placement
  options + a batch cycle-guard). A flag dismissal / remark is NOT an edit (the row stays "Original").


All wizard-frontend code lives in `src/pages/boq-wizard/`. Do not scatter
wizard components into other page folders.

**Wizard-screen detail (project picker, global entry + in-project tab, sidebar gating, colour tokens, UI
library, the Tendering create-modal, `useBoqWizardStore`, the upload screen / drop zone, the
blank-until-parsed + confirm-reset rule, the `uploadStatus` lifecycle, both socket-listener patterns, the
hub parse-completion / recovery / reconnect / dismiss conventions, and the Continue + pre-fill gates)
lives in **`frontend/.claude/context/domain/boq-frontend-wizard-upload.md`** — load it before wizard work.
