<!-- Recovered 2026-07-30 from frontend/.claude/plans/boq/archive/boq-upload-plan-pre-split.md.
     This record shipped in PR #1133 (2bd6032f) but was never
     distributed into the rotated plan tree: the rotation was
     computed from a 1,286,655 B plan doc and the rebase archived
     develop's 1,352,991 B version. Verbatim copy, write-once. -->

## Build slice RM-4a-filter (Data Viewer per-column-header faceted filters) COMPLETE

Follow-on to RM-4a. Branch `feature/boq-pricing-helper`. feat `6cea15d7` (+ docs, this entry). Frontend
only, ONE file (`RateMasterDataViewer.tsx`); NO backend, NO migration, NO new query -- purely client-side
over the already-loaded active items, read-only, composes cleanly with the RM-4a admin editing.

### What shipped
EVERY column header of the Data Viewer tab -- kind / brand / every category attribute / every rate key /
unit / source sheet / row (14 columns on `wiring_cabling`) -- carries a filter funnel opening a `ColumnFilter`
Popover: a type-to-search box over that column's DISTINCT values + a checkbox multi-select. A unified
`columns` model (`{key, get}`, memoised over `attrCols`/`rateCols`) is the SINGLE source for both the
distinct-values dropdowns (`distinctByColumn`, non-empty values, `localeCompare` numeric sort) AND the row
predicate (`getForColumn` keyed by the same colKey), so the headers and the filtering can never drift.
Composition is **AND across columns, OR within a column**; a global `Clear filters (N)` button shows the
active-column count and resets all. Search inside a funnel narrows the value list case-insensitively; the
list is a `max-h-56 overflow-y-auto` checkbox column with a per-column Clear.

### Gates
tsc 3240 (baseline 3240, 0 new). rate-master vitest 2 files / 19 tests pass (ratePipelineInterpreter 11 +
rateMasterEdit 8; the viewer is a live-cert component, no vitest). Full vitest 1001 unchanged. vite build
exit 0.

### Cert (live, /rate-master Data Viewer, wiring_cabling, 588 active items)
Done in-browser BEFORE the commit (owner instruction). Bundle marker: all 14 headers expose a
`Filter <col>` funnel button. (1) Insulation funnel opened -> dropdown listed the distinct values
[ARMOURED, UNARMOURED] + a search input. (2) Selecting ARMOURED filtered 588 -> 335 rows, zero UNARMOURED
visible. (3) Thickness funnel: 20 distinct values; typing "2.5" in the search narrowed the list to exactly
["2.5"]. (4) Selecting 2.5 AND-composed with ARMOURED -> 22 rows. (5) `Clear filters (2)` showed the active
count, reset to 588 rows, and disappeared. All PASS.

### Files
MODIFIED: `frontend/src/pages/pricing/rate-master/RateMasterDataViewer.tsx` (ONLY). Docs: this entry +
`frontend/CLAUDE.md` (Rate Master frontend conventions). Out of scope (untouched): all backend, all other
frontend files, the RM-4a endpoints, the interpreter, patches.txt, `.claude/settings.local.json`.
