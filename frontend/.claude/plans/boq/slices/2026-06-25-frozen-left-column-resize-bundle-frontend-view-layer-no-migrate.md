### Frozen-left + column-resize bundle (FRONTEND, view-layer, NO migrate, base tip 78dc7cfd, 2026-06-25)

**The heaviest editor slice: ONE structural table-layout change (`table-fixed` + `<colgroup>`) carrying TWO features --
frozen-left anchors AND column resize** (`PricingGrid.tsx` + `PricingGrid.test.ts`). Frontend-only -- NO backend, NO
doctype, NO migrate, NO persistence, `reviewRender.tsx`/`SheetPricingPage.tsx` UNTOUCHED. They are BUNDLED because they
SHARE the authoritative-width foundation (Option B's fixed-width Description + the live frozen offsets both need the
colgroup that resize needs) -- building them apart would lay it twice.

- **SUPERSEDES the "independent" claim (recorded correction).** The standalone column-resize spec (§6/§2) and the editor
  design doc (§14) said frozen-left and column-resize are INDEPENDENT. Option B (freeze through a FIXED-width Description,
  offsets from the live colgroup) COUPLES them -- they share `table-fixed`+`<colgroup>` and were built in one slice. The
  PK design docs get this correction separately; recorded here so the in-repo record is consistent.

- **The structural change (D5/C1/C2).** `<table>` goes auto-layout -> **`table-fixed`** with a **`<colgroup>`** of `<col>`
  widths = AUTHORITATIVE. The colgroup = 5 anchor `<col>` + one per **`visibleDescriptors`** entry (keyed by `d.col` so a
  hide+reshow keeps the width) + one Remarks `<col>` (rebuilds when column-hide changes the visible set). The table width
  is an explicit px TOTAL (sum of widths), **NOT `w-full`** -- `w-full` would let table-fixed redistribute slack and break
  the frozen-offset math. Seeds mirror the old Tailwind hints (`seedWidthPx`: `w-16`=64, `w-36`=144, `w-28`=112, `w-48`=192,
  Description=280), so day-one render is **NEAR-identical** (acknowledged change: columns stop auto-sizing; a narrow sheet
  no longer stretches to fill).

- **The 8 resize decisions.** D1 ALL columns resizable (anchors + descriptors + Remarks) via a pointer-capture drag handle
  on each header's right edge (`startResize`/`moveResize`/`endResize`, `setPointerCapture`). D2 SESSION-ONLY: a sparse
  grid-level `colWidths` useState (absent key => the seed), reset per sheet by the page's `key={sheetName}` remount -- no
  store/schema/backend/localStorage. D3 narrowing WRAPS body + the row grows (body cells already wrap; no `whitespace-nowrap`
  there). D4 HEADERS truncate single-line (`truncate` + `title`) so the sticky header keeps one height. D6 DOUBLE-CLICK a
  handle = AUTOFIT: `autofitColumn` measures the max content width over the column's `data-colkey` cells via a temporary
  `whiteSpace:nowrap` + `scrollWidth` read, restored synchronously (no paint between -> no flash). D7 MIN-WIDTH clamp
  (`clampColumnWidth`): rate columns floor at `RATE_COL_MIN_PX=96` (the w-20 input + padding), others `COL_MIN_PX=48`. D8
  ZERO change to `reviewRender.tsx` (verified -- no width coupling).

- **Frozen-left (Option B, F1-F5).** The **5 anchors through Description** pin sticky-LEFT (descriptor + Remarks scroll).
  Description seeds 280px (F2) but stays a **normal resizable column** (F3). **F4 (the bundling payoff):** the cumulative
  frozen LEFT offsets are computed from the LIVE widths (`fcol1=w(a0)`, `fcol2=+w(a1)`, ...) and exposed as **CSS vars
  `--fcol-0..4` on the `<table>`**; the body anchor `<td>`s reference them with a STATIC `left: var(--fcol-N)` -- so a
  resize updates ONLY the table's vars + the colgroup, the frozen strip STAYS ALIGNED, and (critically) the memoized rows
  are SKIPPED (width never becomes a per-row prop). F5: the z-stack mirrors SheetDataGrid -- **frozen header z-30 (corner)
  > descriptor/remarks header z-20 > frozen body z-10 > body**; frozen anchor `<td>`s get an **opaque `frozenBg`** that
  mirrors the row state (jump-flash blue / search-hit yellow / `group-hover`, the `<tr>` is now a `group`) so freezing
  never MASKS those cues; **border-collapse is KEPT** (frozen cells carry `border-r`; S7 not triggered). The 5 anchors are
  never hideable, so the frozen block is always exactly those 5 regardless of column-hide (F5d).

- **Row memo INTACT (S8 honored).** Width is GRID-LEVEL only (the colgroup + the `--fcol` CSS vars live on the `<table>`).
  NO width prop was added to `PricingGridRow`; `pricingRowPropsAreEqual` is UNCHANGED. On a resize drag only the grid
  re-renders (colgroup + table vars + headers); the rows are memo-skipped (their props -- `frozenBg` derives from the
  existing `isJumpFlash`/`isCurrentHit`, the `left: var(...)` is static, `data-colkey` is static -- don't change).

- **Integration (C4/C8/C9).** The resize handle is edge-only (`absolute right-0 w-1.5`) so on an amount `<th>` it never
  overlaps / steals the ƒ formula-badge popover trigger's click. table-fixed + colgroup + frozen-left hold in BOTH embedded
  and full-screen (one JSX tree). NAV (`colCount`/`visibleDescriptors`/`nextCell`), parent-jump, the 3s flash, rate
  editing + auto-save are untouched (resize changes WIDTH, not column count/order).

- **Tests + gates.** NEW pure `seedWidthPx` / `columnWidthKey` / `clampColumnWidth` unit-tested in `PricingGrid.test.ts`
  (+9: key resolver incl. the NEG no-collide, seed map incl. the NEG unknown->default, clamp rate/non-rate/passthrough).
  The pointer-drag, autofit measure, and sticky-left rendering are manual-cert (DOM-bound). **Vitest 294 -> 303**
  (PricingGrid 120 -> 129), tsc 3175 (0 new in touched files), in-container Vite build exit 0, 2026-06-25.

- **Live-cert (pending Nitesh, 145/150/166) -- the big matrix.** RESIZE: LC1 every border drags (anchors/descriptors/
  Remarks); LC2 narrowing wraps body + that row grows; LC3 headers stay single-line + tooltip; LC4 double-click autofits;
  LC5 a rate column can't clip its input (min-width); LC6 reload + sheet-switch reset widths (session-only). FROZEN-LEFT:
  LC7 scroll right -> the 5 anchors stay pinned; LC8 frozen anchors opaque + flash/hit/hover still show; LC9 resize
  Description -> it resizes AND the freeze stays aligned; LC10 corner cell layers over headers + frozen body. INTEGRATION:
  LC11 column-hide rebuilds the colgroup, frozen block still the 5 anchors; LC12 the ƒ badge popover still opens; LC13
  full-screen still works (no remount); LC14 nav / parent-jump+flash / rate edit + auto-save still behave; LC15 repeat
  LC1/LC2/LC7/LC9 on 145/150/166.

