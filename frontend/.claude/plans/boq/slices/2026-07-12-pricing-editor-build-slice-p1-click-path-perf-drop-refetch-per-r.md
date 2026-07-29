## Pricing editor -- Build slice P1 (click-path perf: drop refetch + per-row category prop) COMPLETE

Frontend-only. Recon (2026-07-12) found the DB is fixed (reads 1-9 ms warm) but the editor still lags on a
big sheet because a category verdict pick triggered (a) a redundant whole-sheet category refetch and (b) a
re-render of ALL ~870 rows, TWICE. P1 lands recon fixes #1 + #2 (no backend/payload change, no
virtualization):
- **FIX 1 -- drop the redundant refetch (`SheetPricingPage.tsx handleVerdictSelect`).** On a successful pick,
  the optimistic `categoryOverrides` entry is now AUTHORITATIVE -- the `await mutateCategories()` full refetch
  (a 188 KB round-trip that forced a second full-grid pass) is REMOVED. The override persists for the session;
  the write still lands in the DB (verified: category persists across a page refresh) and re-derives on the
  next sheet load / classify. On FAILURE the override is reverted (`dropOverride`) + the existing inline
  `saveError` strip surfaces the message -- no new UI, a failed write never leaves a lying cell.
  `mutateCategories`' OTHER call sites (classify-run refetch) are untouched.
- **FIX 2 -- per-row category prop (`PricingGrid.tsx`).** `PricingGridRow` no longer receives the whole
  `categoriesByExcelRow` Map (which `pricingRowPropsAreEqual` compared by IDENTITY -> any new Map re-rendered
  every row). It now receives `category` = THIS row's entry (`categoriesByExcelRow.get(source_row_number)`,
  passed in the shared `renderRow` so both panes get it), compared by reference in the memo comparator; `hasRun`
  is now compared explicitly (it used to piggyback on the map compare). Because a pick rebuilds ONLY the picked
  excel_row's entry (a new optimistic object) and every other row keeps its `catData` object reference, ONLY the
  picked row (+ its frozen-pane counterpart) re-renders -- proven from the comparator, not debug logging (none
  shipped). The grid still holds the full Map for grid-level use (keydown Enter-to-open, `hasRun` = size>0).
- **Verification:** `tsc --noEmit` clean on both touched files (pre-existing unrelated project errors remain --
  baseline tsc is red, the app builds via vite); `yarn build` -> BUILD_OK_MARKER (in-container). Manual matrix
  for the owner: open PUNE (loads normally) / pick a category (instant, no full-grid flash) / pick-wrong-then-clear
  (reverts to machine answer) / refresh (pick persisted) / open 12-row CONVENTIONAL LIGHTING (normal) / classify
  from the UI (categories refresh -- the non-pick refetch paths intact).
- **Perf-slice backlog (owner-deferred, NOT this slice):** #3 virtualize the 870-row x 2-pane grid (the ceiling
  fix for first-paint on big sheets) and #4 trim the `get_sheet_categories` payload (188 KB -> ~79 KB by dropping
  `routing_reason` + unused rule/ai fields for the cell). Both remain open.

