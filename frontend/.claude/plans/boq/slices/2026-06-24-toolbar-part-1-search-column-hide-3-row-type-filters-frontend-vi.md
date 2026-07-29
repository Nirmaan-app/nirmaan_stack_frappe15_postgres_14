### Toolbar Part 1 -- search + column-hide + 3 row-type filters (FRONTEND, view-layer, NO migrate, base tip 1f199f74, 2026-06-24)

**FIVE view-layer toolbar controls added to the pricing editor** (`SheetPricingPage.tsx` + `PricingGrid.tsx` + the NEW
`PricingToolbar.test.ts`). Frontend-only -- NO backend, NO doctype, NO migrate. The toolbar LAYOUT rework (button
sizing / overflow / clustering) is **Part 2, explicitly deferred until after Slice 5** -- this slice only DROPS the five
controls into the existing header flex cluster (the `!isGridOnly` block, beside "Show unpriced"). All five default to the
CURRENT behaviour (nothing hidden, no search), so a user who touches nothing sees the exact prior grid (A10 back-compat).

- **CONTROL 1 -- column-hide.** A "Columns" Popover of checkboxes hides NON-AMOUNT descriptor columns. **LOCKED owner
  decision: AMOUNT COLUMNS ARE NEVER HIDEABLE** -- their formula-status `ƒ` badge must never be hidden (it is the only
  remedy for a gate-locked rate state). One source of truth: the popover lists `hideableDescriptors(columnDescriptors)`
  (`!FIXED_ROLE_DEDUPE.has(role) && !isAmountDescriptor(d)` -- the SAME `isAmountDescriptor` the badge / amber-pending tint
  use), and the grid guard `isColumnVisible(d, hiddenCols)` returns true for any amount column regardless of the set. State
  is a per-GRID `hiddenCols: Set<string>` -- **tracked as HIDDEN (not visible), default EMPTY = nothing hidden** so the
  default needs NO seeding from `columnDescriptors` (which the page does not have until the fetch lands; a visible-set
  lazy-init would flash all columns hidden for one paint on every sheet open). The grid renders + navigates a
  `visibleDescriptors` set (= `displayDescriptors` filtered by `isColumnVisible`), used UNIFORMLY for the header `<th>`
  map, the row `<td>` map, the nav dims (`remarksColIndex`/`colCount`), AND the `commitActiveRate` colIndex reverse-lookup
  -- so the colIndex matrix re-indexes over the visible set and the cursor can NEVER land on a hidden column (the column
  analog of the row nav-skip). The FULL `displayDescriptors` is KEPT for the data-fanout concerns (cross-area prefill
  `findCorrespondingRateDescriptors`, autosave col lookup) so `commitRate`'s `useCallback` dep stays stable across a hide
  (a hide must not churn `commitRate`'s identity, which the row memo compares). `hiddenCols` is per-GRID -- it changes
  `visibleDescriptors`' reference, re-rendering all rows ONCE (like `formulasComplete`); it NEVER enters the row memo.

- **CONTROL 2 -- description search.** A thin case-insensitive substring matcher over `row.description` (NO review-tier
  AI/Gemini/class/status compose -- those do not exist in pricing). `buildSearchHits(displayRows, query)` -> ordered Excel
  row numbers of matching rows (over the RENDERED set, so a hit is always visible/scroll-to-able); an N-of-M counter +
  prev/next steppers that `stepHit`-wrap the pointer and jump via the grid's EXISTING `gridRef.scrollToRow(excelRow)` (NOT
  ReviewTree's tree-collapse-aware `revealAndScrollToRow` -- the pricing grid is flat). **THE ONE ROW-MEMO TOUCH:** the
  per-row `isCurrentHit` boolean is added to `PricingGridRowProps` AND `pricingRowPropsAreEqual` (exactly like
  `reconChoiceMap`) so the highlight REPAINTS as the user steps (without it, memo'd rows would not re-render on a step). The
  current-hit row is highlighted with a **yellow BACKGROUND, not a ring** -- the table is `border-collapse` (ring-inset on a
  `<tr>` is unreliable, ReviewTree's documented caveat) and a blue ring would collide with the blue active-cell ring; the bg
  shows through the anchor/Description cells (exactly where the matched text is). The page owns `searchQuery` +
  `searchCurrentIdx`; the grid receives only `currentHitExcelRow` (a per-GRID prop) + derives `isCurrentHit` per row.

- **CONTROLS 3/4/5 -- row-type filters (spacers / notes / subtotals).** Three booleans, default true. **PREDICATE AXIS =
  `effective_classification`, NOT node_type** (node_type collapses spacer/note/subtotal all into "Other" and cannot tell
  them apart). `classificationVisible(cls, toggles)` keys on the literal tokens `"spacer"` / `"note"` /
  `"subtotal_marker"` (mirrors ReviewTree). **SEAM = the EXISTING page-side `displayRows` filter** -- the row-type predicate
  is AND-composed into the SAME single `.filter()` that produces `displayRows` (the `showOnlyUnpriced` pass), and the
  `=== rows` stable-reference fast path is preserved at default (nothing hidden) so the grid's `byIdx`/`depths` memos hold.
  **VIEW-ONLY (load-bearing):** the three toggles live in the `displayRows` pass EXCLUSIVELY -- `computePricedCount` (reads
  `rows`), `SummaryPanel` (`rows={rows}`), and the review-flag/strip feed (built from `rows`) all read the UNFILTERED rows,
  so hiding a row-type can move NO total and NO N-of-M priceable count. **NAV-SKIP is free:** the grid receives the
  already-filtered `displayRows` as its `rows` prop, `nextCell` uses `rows.length`, and `cellRefs` holds only rendered rows
  -- the cursor cannot land on a hidden row (the `showOnlyUnpriced` precedent).

- **A20 pre-step verified:** `effective_classification` is present on the priced rows at runtime (`PricedRow extends
  ReviewRow`; rendered by `ClassificationPill` at `PricingGrid.tsx`'s row + read for the preamble/line-item styling) -- NO
  backend field added.
- **Pure helpers** (`searchMatches`/`buildSearchHits`/`stepHit`/`isCurrentHitRow`/`classificationVisible`/
  `hideableDescriptors`/`isColumnVisible`) live in `PricingGrid.tsx` (the established SDK-free pure-helper home) + are
  unit-tested in the NEW `PricingToolbar.test.ts` (+23: search matcher incl. null-desc NEG, hit-list, stepper wrap,
  current-hit boolean, row-type predicate incl. the line_item/preamble NEG, hideable filter [amount excluded] + the
  amount-always-visible NEG, and the VIEW-ONLY invariant). **Vitest 264 -> 287**, tsc 3175 (0 new in touched files),
  in-container build exit 0, 2026-06-24.
- **Live-cert (pending Nitesh, all 3 canonical BoQs 145/150/166):** LC1 search highlights + N-of-M + prev/next jump+scroll;
  LC2 Columns hides a non-amount column from header+rows, amount columns not offered + never hide; LC3 uncheck spacers/notes/
  subtotals -> those rows vanish, priced-count + grand-total UNCHANGED; LC4 with a row-type hidden, keyboard-nav never lands
  on a hidden row; LC5 all controls at default == the exact current grid; LC6 repeat on 145/150/166.

