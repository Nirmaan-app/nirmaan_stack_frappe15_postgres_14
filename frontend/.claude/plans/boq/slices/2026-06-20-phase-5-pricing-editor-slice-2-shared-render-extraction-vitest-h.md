### Phase 5 Pricing Editor -- Slice 2 -- shared-render extraction + Vitest harness (FRONTEND, feat pending, 2026-06-20)

**Goal.** Lifts four render helpers OUT of the ~2580-line `ReviewTree.tsx` into a NEW importable sibling
`frontend/src/pages/boq-wizard/reviewRender.tsx` so the future pricing grid (Slice 3a, design v1.3 §4 path b) reuses
them instead of duplicating ReviewTree. ZERO behaviour change, ZERO signature change (byte-identical move). Adds the
repo's FIRST frontend unit-test harness (Vitest) as the extraction's safety net.

**`reviewRender.tsx` (NEW).** Holds the byte-identical bodies of `computeDepths`, `resolveDescriptorValue`,
`renderDescriptorCell`, `ClassificationPill` + their private deps `fmtNum`, `CLS_PILL_CLASSES`, and `CLS_LABELS`.
Exports `computeDepths`, `resolveDescriptorValue`, `renderDescriptorCell`, `ClassificationPill`, `CLS_LABELS`. **`.tsx`
not `.ts` (forced):** ClassificationPill returns JSX. **`CLS_LABELS` moved too (the one design call):**
`ClassificationPill` needs it; had it stayed in ReviewTree, `reviewRender`->ReviewTree->reviewRender would be circular,
so moving `CLS_LABELS` breaks the cycle. `FIXED_ROLE_DEDUPE` did NOT move (ReviewTree-local + exportReviewCsv-only).

**Importers re-pointed:** `ReviewTree.tsx` (removed the 7 defs, imports 5 symbols) + `exportReviewCsv.ts`; no third
importer (`SheetReviewPage` imports the ReviewTree COMPONENT only). No re-export shims.

**Vitest harness.** `vitest` (4.1.9) devDep + `test`/`test:watch` scripts + a STANDALONE `vitest.config.ts` (re-declares
`@vitejs/plugin-react` for automatic JSX + the `@`->src alias; `environment: 'node'`). Run via `yarn test` in-container.
**Method = characterization-before-extraction:** 12 golden tests written against the CURRENT code (GREEN), then re-run
against the moved module (GREEN); the pre/post parity is the behaviour-preservation proof (the design-doc claim that the
backend's ~205 `test_review_screen.py` tests gate this was FALSE -- they never touch these frontend functions). One
golden value corrected per Step 1c (a missing-parent row resolves to depth 1, not 0 -- the TEST was wrong, not the fn).

**Tests + verification.** Vitest **12/12 GREEN** both runs; tsc 3178 (== baseline), 0 in touched wizard files; Vite
build exit 0 (PWA 164 entries). `ClassificationPill` is manual-cert (JSX, no DOM test added). NO backend / doctype /
migrate. Slice 2 unblocks 3a. (See frontend CLAUDE.md `**Status (... Slice 2 ...)**`.)

