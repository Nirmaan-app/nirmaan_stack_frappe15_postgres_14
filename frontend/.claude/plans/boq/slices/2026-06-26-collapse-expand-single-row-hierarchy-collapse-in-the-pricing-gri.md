### Collapse/expand -- single-row hierarchy collapse in the pricing grid (FRONTEND, view-layer, NO migrate, base tip 49366849, 2026-06-26)

**The pricing grid rendered the FULL flat row list with no way to fold a parent's subtree.** This slice adds single-row
hierarchy collapse/expand: click a parent's chevron to hide its ENTIRE descendant subtree; click again to reveal. NEW
per-grid concept, SEPARATE from the full-screen `expanded` flag (untouched). Files: NEW pure leaf `collapse.ts`
(+ `collapse.test.ts`), `PricingGrid.tsx`, `SheetPricingPage.tsx`. No backend / schema / migrate; `reviewRender.tsx` /
`boqTypes.ts` UNTOUCHED.

- **R1 WHOLE SUBTREE.** Collapsing a parent hides every descendant (children, grandchildren, ...), via the upstream
  filter + the structural descendant walk. Verified on the depth-3 145 Electrical sheet.
- **R2 "+N hidden" DERIVED.** A collapsed parent shows a right-chevron + a muted `+N hidden` badge; N =
  `descendantCount(rowIndex, childrenByParent)` (the WHOLE-subtree structural count), DERIVED live -- never stored -- so
  it is correct by construction after a search/jump auto-expand. The review screen has no such badge; built fresh here.
- **R3 SEARCH PIERCES COLLAPSE.** `buildSearchHits` runs over `searchUniverse` (the view-filtered set IGNORING collapse),
  so a match under a collapsed parent is still a hit; stepping to it auto-expands its ancestors before scrolling. When
  nothing is collapsed `searchUniverse === displayRows` (reused, no extra pass).
- **R4 UPSTREAM FILTER (Option A).** Collapse is ONE MORE clause in the page-side `displayRows` `.filter()`, composed in
  the SAME pass as show-unpriced + row-type (`passesViewFilter(r) && (!collapseActive || !isHiddenByCollapse(...))`).
  Hidden-descendant rows are dropped from the rendered list. VIEW-ONLY: the priced count / SummaryPanel / flag feed all
  read the UNFILTERED `rows`, so collapsing moves NO total. The `=== rows` fast path holds when nothing is filtered or
  collapsed.
- **R5 REVEAL-THEN-SCROLL.** The grid's ONE jump path (`jumpToRow` -- parent-click + search-step + review-strip all route
  through it) now calls `onRevealRow(excelRow)` FIRST. The page (`revealRow`) expands the target's collapsed ancestors
  (`collapsedAncestors`) and returns TRUE iff it changed `collapsed`; the grid then defers the scroll 50ms (mirroring
  ReviewTree) so the reveal re-render lands before resolving + scrolling. Nothing collapsed on the chain -> returns
  FALSE -> synchronous scroll, byte-for-byte the prior behaviour. The 3s landing flash still fires after the reveal.
- **R6 MEMO UNTOUCHED (the load-bearing constraint).** Collapse state is page-level `collapsed: Set<number>` of
  `row_index`. NOTHING was added to `pricingRowPropsAreEqual`. The chevron flips on toggle via a NEW `CollapseContext`:
  the chevron is a SEPARATE `RowChevron` component (inside the memoized `PricingGridRow`) that reads the context, so a
  context change re-paints ONLY the chevrons -- the memoized row (which does NOT read the context) is skipped, and a
  keystroke/cursor move is completely unaffected. This is the recon's "derived, not carried on the row" rule realized.
- **isVisible SEMANTICS mirror (collapse.ts).** `isHiddenByCollapse` walks the parent chain from
  `row.effective_parent_index` (the PARENT, never the row), 60-hop cap, breaking on `<0` (root) + `cur===row.row_index`
  (self-cycle). A collapsed parent STAYS visible; only its descendants hide. The loop does NOT start at
  `collapsed.has(row.row_index)` (the explicit "parent disappears" trap). `buildChildrenByParent` is the NEW inverse
  children map the grid lacked (it had only the parent-direction `parentExcelRowOf`). All over the FULL unfiltered rows.
- **Chevron placement + structural cases.** The chevron sits at the Description-cell depth indent
  (`depth * INDENT_PX`), before the text, so it nests with the tree. Chevron ONLY on rows with descendants; leaf rows on
  a hierarchical sheet get an invisible spacer (alignment); a FLAT sheet (`childrenByParent` empty -> `anyParents` false)
  renders NO chevrons/spacers (145 Fire Fitting -- no `+0 hidden`, no crash). Single-child parents ARE collapsible;
  mixed child node_types collapse regardless of type. `tabIndex={-1}` keeps the chevron OUT of the roving-tabindex matrix
  (no second tab stop; nav untouched).
- **Grid-only fork (S4 holds).** Collapse props are passed only to the `PricingGrid` branch; the grid-only general-specs
  fork renders `SheetDataGrid` (no collapse, by construction). Collapse is per-sheet per-session: reset to empty in the
  existing `useEffect([sheetName])` (tab switch + reload start expanded); no backend persist. Independent of full-screen
  / column-resize / column-hide (none reset on a collapse toggle; collapse not reset by them).

**Tests:** vitest 307 -> 320 (+13 in NEW `collapse.test.ts`: buildChildrenByParent incl. flat-sheet empty;
rowHasDescendants incl. single-child + unknown; descendantCount whole-subtree + cycle-guard; isHiddenByCollapse parent-
stays / whole-subtree-hides / root / single-child / self-cycle / chain-cycle / nothing-collapsed; collapsedAncestors).
tsc 3175 (0 new, 0 in touched files). in-container Vite build exit 0. No backend suite (frontend-only -- test_pricing
UNTOUCHED). OWNER live-cert pending: LC1 collapse a depth-1 parent hides its L2/L3 subtree + chevron flips + `+N hidden`;
LC2 expand restores; LC3 search to a hit under a collapsed parent auto-expands + scrolls + flashes; LC4 parent-jump into
a collapsed subtree reveals; LC5 flat sheet has no chevrons; LC6 compose with show-unpriced/row-type/search (counts
unmoved); LC7 full-screen + column-resize unaffected by collapse and vice versa; LC8 tab switch starts expanded.

