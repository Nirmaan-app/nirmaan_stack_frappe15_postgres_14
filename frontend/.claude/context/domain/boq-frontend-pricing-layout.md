# BoQ Frontend — Pricing Editor: layout & navigation

> SheetPricingPage, parent click-to-jump, frozen-left panes, the two-pane split table, scroll/jump retarget, memo interaction with row skipping.

> Split from `boq-frontend.md` (287KB) on 2026-07-29. Surfaces and pricing clusters defined by the owner.

## Contents

- `SheetPricingPage.tsx`
- Parent click-to-jump (`PricingGrid.tsx`; view-layer; restores §13-3a which 3a shipped read-only)
- Frozen-left (Option B)
- memoized rows are skipped
- WHY (structural)
- two-pane split table
- TWO-PANE split
- Scroll/jump retarget

---

**`SheetPricingPage.tsx`:** `allReviewEntries` (the full sorted feed) -> `activeReviewEntries` (filtered) -> `reviewEntries`
= `showDismissed ? all : active`; the toolbar Review-count reads the ACTIVE count; the strip header gains a "Show dismissed
(N)" / "Hide dismissed" toggle (shown only when `dismissedCount > 0`, per-sheet, reset on tab switch); each strip row gains
a per-entry "Looks OK" (dismiss) / "Restore" (un-dismiss) ghost button -- `stopPropagation` (the row click scroll-jumps),
WITHHELD when `locked` (the read-only sheet has no dismiss action, mirroring the rate-save gate). `handleSaveDismiss`
mirrors `handleSaveColor` (in-flight count, takeover detection, `mutate()`); wires `save_cell_dismissal`
(`dismissed:false` un-dismisses). **RE-ARM is SERVER-side** (a successful `save_cell_price` freezes the row's computed
dismissals, EXCLUDING remark) -- the frontend just re-reads via `mutate()`; there is NO client re-arm logic.

**Formula-vs-document reconciliation `reconcile.ts` + `PricingGrid.tsx` + `priceability.ts` + `pricingRollup.ts` +
`SheetPricingPage.tsx` (Cluster B; full detail: plan §"Cluster B"):** when a committed (DOCUMENT) amount and the
formula-computed amount DIVERGE for the same amount cell, the editor FLAGS it and lets the user CHOOSE per cell which value
wins (stored per committed version via `save_cell_reconciliation_choice`). **NEW pure leaf `reconcile.ts`** (the ONE place
the comparison + resolution live, so grid/strip/rollup agree): `RECON_EPSILON_ABS/REL` + **`amountsEqual`** (the SHARED
tolerance -- `pricingRollup` now imports it for its Option-1-vs-Option-2 integrity guard, so ONE epsilon, never duplicated),
`amountsDiffer` (both sides must be real finite numbers -> a null/NaN side is NOT a divergence), `resolveDivergence` (the
**Parent click-to-jump (`PricingGrid.tsx`; view-layer; restores §13-3a which 3a shipped read-only):** the Parent anchor
cell (col 2) is now a CLICKABLE jump to the parent row -- it scrolls + focuses the parent via the grid's EXISTING
`scrollToRow` path (search / review-strip precedent), NOT a new mechanism. When a parent exists the **`<button>` is col 2's
roving nav target** (it carries the focus props + active ring, exactly like a rate `<input>` owns its cell) so there is NO
second tab stop; a **ROOT row renders no button** and the `<td>` keeps `tdFocusProps(2)` (col 2 always has a nav target) --
backwards-compatible (the cell was a read-only muted span before). Activation: mouse-click + **Space** fire the button
natively (Space is not a nav key -> `handleGridKeyDown` lets it fall through); **Enter** is a col-2 special-case in
`handleGridKeyDown` (mirrors the remarks Enter case) so Enter jumps too (a root row falls through to the generic
Enter->down). The jump is the NEW pure exported `parentExcelRowOf(row, byIdx)` (root / -1-sentinel / parent-absent-from-map
-> null, safe no-op) -- it DE-DUPS the parent Excel-row resolution shared by the row render, the Enter handler, and (via
delegation) the imperative `scrollToRow`, and is unit-tested in `PricingGrid.test.ts`. **Row-memo rule:** the jump arrives
as a NEW per-row prop `onJumpToRow` (a grid-level `useCallback`, reference-STABLE -> memo-safe) added to BOTH
`PricingGridRowProps` AND `pricingRowPropsAreEqual` (the exhaustive comparator). **Frozen-left columns + column-resize
remain a SEPARATE later bundled slice** (recon recommendation (iii)) -- this slice touches NO table layout / widths /
sticky-left / colgroup. vitest 287->291 (PricingGrid 113->117: `parentExcelRowOf`), tsc 3175 (0 new), in-container build
exit 0, 2026-06-25. **Landing flash (follow-up):** a jump now also flashes the WHOLE landed row blue for 3s then clears
(focus alone cued only col 0) -- grid-level `flashExcelRow` state + a timeout ref (a new jump RESETS the timer, no stacking;
cleared on unmount; resets for free on the per-sheet remount), the derived per-row `isJumpFlash` boolean in
`pricingRowPropsAreEqual` (like `isCurrentHit`, via the NEW pure `isJumpFlashRow`); the blue `<tr>` wash WINS over the
search current-hit yellow for its 3s then reverts; instant on/off (NO transition -> calmest + reduced-motion-safe + leaves
the hover/current-hit paint untouched); `jumpToRow` stays reference-stable (deps []), so it ALSO flashes on the shared
imperative `scrollToRow` (review-strip + search jumps). vitest 291->294 (PricingGrid 117->120: `isJumpFlashRow`).

**Frozen-left anchors + column resize (`PricingGrid.tsx`; ONE structural slice carrying TWO view-layer features; owner-
locked):** the grid's `<table>` switches from auto-layout to **`table-fixed` + a `<colgroup>`** so column widths are
AUTHORITATIVE -- the shared foundation BOTH features need (building them apart would lay it twice). **SUPERSEDES the prior
"frozen-left and column-resize are INDEPENDENT" claim** (resize-spec §6/§2 + editor-design §14): Option B couples them, so
they were built together. **Column resize (8 decisions):** ALL columns drag-resize (anchors + descriptors + Remarks) via a
pointer-capture handle on each header's right edge; **session-only** (width overrides in a grid-level `colWidths` useState,
reset per sheet by the page's `key={sheetName}` remount -- no store/schema/backend/localStorage); narrowing **wraps body +
grows the row**, **headers truncate single-line + `title`** (protects the sticky header height); **double-click a handle =
autofit** (measures max content via a temporary `whiteSpace:nowrap` + `scrollWidth` read over the column's `data-colkey`
cells, restored synchronously -- no flash); **rate columns clamp** to the input width (`RATE_COL_MIN_PX=96`), others to a
small floor (`COL_MIN_PX=48`); seeds mirror the old Tailwind hints (`w-16`=64 / `w-36`=144 / `w-28`=112 / `w-48`=192 /
Description=280) so **day-one render is NEAR-identical** (the one acknowledged change: columns stop auto-sizing and take
seeds; the table is now an explicit px total, NOT `w-full`, so it can't redistribute slack and break the offsets).
**Frozen-left (Option B):** the **5 anchors through Description** pin sticky-LEFT; descriptor + Remarks scroll. Description
seeds 280px but stays a **normal resizable column** (F3). **THE BUNDLING PAYOFF (F4):** the cumulative frozen LEFT offsets
derive from the LIVE colgroup widths, exposed as **CSS vars (`--fcol-0..4`) on the `<table>`**, and the body anchor `<td>`s
reference them with a STATIC `left: var(--fcol-N)` -- so a resize updates ONLY the table's vars and the colgroup, and the
**memoized rows are skipped** (width is GRID-LEVEL, NEVER a per-row prop -> `pricingRowPropsAreEqual` UNCHANGED). The
z-stack mirrors SheetDataGrid: **frozen header z-30 (corner) > descriptor/remarks header z-20 > frozen body z-10 > body**;
frozen anchor `<td>`s get an **opaque `frozenBg`** that mirrors the row state (jump-flash blue / search-hit yellow /
`group-hover`) so freezing never masks those cues; **border-collapse is KEPT** (frozen cells carry `border-r`). The
`<colgroup>` derives from **`visibleDescriptors`** (rebuilds on column-hide; the 5 anchors are never hideable so the frozen
block is always exactly those 5). The resize handle is edge-only so on an amount `<th>` it never steals the ƒ
formula-badge popover click (C4). Holds in BOTH embedded + full-screen (one JSX tree). NAV/parent-jump/flash/auto-save
untouched (resize changes width, not column count/order). New pure helpers `seedWidthPx` / `columnWidthKey` /
`clampColumnWidth` (unit-tested); `reviewRender.tsx` UNTOUCHED (zero width coupling). Collapse/expand stays a separate
later slice. vitest 294->303 (PricingGrid 120->129), tsc 3175 (0 new), in-container build exit 0, 2026-06-25.

**Drop frozen-left, ship resize alone (`PricingGrid.tsx`; subtractive; SUPERSEDES the frozen-left HALF of the bundle
above):** the frozen-left (sticky-left) mechanism is **REMOVED**; the column-resize half **STAYS** (certed, unchanged).
**WHY (structural):** the red-box experiment confirmed cell-level **multi-column sticky-left does not track horizontal
scroll** -- the frozen anchor cells paint in place but the scrolling columns clip BEHIND them and never reset on
scroll-back (a structural failure of cumulative per-cell `sticky left:var(--fcol-N)` on `table-fixed`, NOT an opacity/border
bug). The **`border-collapse` -> `border-separate` flip tried during debugging was WRONG-AXIS (the bug is h-scroll
tracking, not border mode) and was reverted** (border-collapse is unchanged in shipped code). The only real fix is a
**two-pane split table**, but the feasibility recon found a split **fights resize's wrap-and-grow** (Description, the
tallest-wrapping column, would be in the frozen pane while Remarks, also growable, scrolls -> two-directional per-row
height-sync over 120-194 rows) **and doubles the row memo** -- not worth it now. **REMOVED:** the opaque `frozenBg` const +
the now-unused `group` class on the `<tr>` (its only consumer was `frozenBg`'s `group-hover:`); the 5 anchor body `<td>`s'
`style={{left:"var(--fcol-N)"}}` + `sticky z-10` + `frozenBg` (-> normal scrolling cells; the col-0 flag accents, col-2
parent-jump button, col-4 depth indent, padding/border/`cellNavClass` ALL stay); the `fcol0..4` derivations + the
`--fcol-0..4` CSS vars on `tableStyle` (now `{ width }` only; the unused `type CSSProperties` import dropped); the 5 anchor
`<th>`s downgraded from the **z-30 corner tier back to `sticky top-0 z-20 bg-muted`** (the VERTICAL sticky header STAYS --
only the horizontal freeze + corner went). **KEPT UNCHANGED (resize):** `table-fixed` + `<colgroup>`; `width:
${totalWidth}px`; `colWidths`; all resize handlers (`startResize`/`moveResize`/`endResize`/`autofitColumn`/`resizeHandle`);
the rate clamp (`clampColumnWidth`/`RATE_COL_MIN_PX`); the seed helpers; headers-truncate (D4) / body-wrap-and-grow (D3);
`data-colkey`; the **row memo `pricingRowPropsAreEqual`**; NAV / parent-jump / 3s flash / rate edit + auto-save.
Frozen-left = **DEFERRED to a dedicated structural two-pane slice** (editor-design §14 frozen-left row stays SCHEDULED,
not dropped). NO test changed (subtractive className/style removal -- no pure helper touched; the resize helpers + their
tests stay green). **vitest 303 (PricingGrid 129, unchanged)**, tsc 3175 (0 new in PricingGrid), in-container build exit 0,
2026-06-25; see plan §"Drop frozen-left, ship resize alone".

**Frozen-left Slice 1 of 2 -- two-pane split + measure-at-freeze heights + wrap/clip/tooltip (`PricingGrid.tsx` +
`SheetPricingPage.tsx`; frontend-only, NO migrate; REVIVES the DEFERRED frozen-left as the structural two-pane slice):**
The reverted approach was cumulative cell-level `sticky left` (broken -- doesn't track h-scroll). This slice ships the
**TWO-PANE split** instead. A page-owned per-sheet **`frozen` toggle** ("Freeze columns" / "Unfreeze", `Pin`/`PinOff`, loud
sky-600 when on) sits in the `!isGridOnly` ribbon cluster (so grid-only general-specs sheets -- rendered by SheetDataGrid --
never get it); reset on tab switch; passed as `frozen` to the PricingGrid only. **When frozen+measured the grid renders TWO
tables in a flex row:** a FROZEN pane (the 5 anchors `a0..a4`, `overflow-hidden`, width = summed anchor `colWidths`,
vertical scroll DRIVEN) + a SCROLLING pane (descriptors + Remarks, owns `overflow-x`+`overflow-y`, `onScroll` mirrors
`scrollTop` to the frozen pane). **Widths come from the SAME `colWidths` map** (each pane renders its own `<col>` slice; NO
duplicate width state). The sticky header (`sticky top-0`) works in BOTH panes (each is its own bounded scroll container).
When **unfrozen, ONE single table renders byte-for-byte as before** (the split is gated on `split = frozen && rows.length>0
&& rows.every(measured)`; structural decisions key on `split`, not `frozen`). **Measure-at-freeze ("Fork A"):** a
`useLayoutEffect([frozen, rows, rowHeights])` captures each row's NATURAL single-table `<tr>` height (via the always-
registered col-0 cell -> `.closest("tr").getBoundingClientRect()`, `Math.ceil`) into a `rowHeights` state keyed by the
stable `row.row_index` -- it runs on the render where `frozen` flipped on (or `rows` changed under freeze) WHILE the single
table is still mounted (split deferred until all rows measured), post-layout/pre-paint, so the user never sees an unmeasured
split frame. **Application:** each row gets a per-row SCALAR `rowHeight` prop (NEVER the whole map -> memo-safe; added to
`PricingGridRowProps` + `pricingRowPropsAreEqual` alongside the new `pane` discriminator), applied as `style.height` on the
`<tr>` in BOTH panes (forces the short scrolling-pane row up to match) + the Description inner wrapper clipped to
`rowHeight - DESC_CLIP_VPAD_PX(12)` with `overflow:hidden` (text still WRAPS via `break-words`, clips from the top via
`align-top`) so a tall row can't push its pane past the other. **Tooltip:** the Description span gains `title={description}`
(native `title`, the grid's idiom -- NO shadcn Tooltip) for full-text-on-hover when clipped (applied regardless of freeze).
**Scroll/jump retarget:** `focusCell` + `jumpToRow` are split-aware (read `splitRef`) -- they `focus({preventScroll:true})`
(so focusing a frozen-pane cell can't desync the panes) and drive the SCROLLING pane (a data cell scrolls itself; an anchor
cell scrolls its scrolling-pane counterpart `<tr>` found by `data-rowidx`); the frozen pane mirrors via `onScroll`.
`unfreeze` clears `rowHeights` ({}); the grid's `key={sheetName::version}` remount resets it for free on sheet/version
switch (so collapse + version-view flow through the SAME `displayRows` into both panes; read-only history stays read-only,
lock/override semantics unchanged). The autofit measure ref moved from the `<table>` to the outer `containerRef` div (spans
both panes). **KNOWN LIMITATION (deferred to Slice 2 with manual row-resize):** a COLUMN resize / double-click autofit WHILE
frozen re-wraps Description + changes natural heights but does NOT refresh the captured map -> heights can go stale until
unfreeze/re-freeze. **Slice 1 does NOT add manual row-resize** (no `rowResizeRef`/`clampRowHeight`/drag handle -- that is
Slice 2). NO new pure helper extracted -> NO test added; **vitest 339 (boq-wizard; PricingGrid 129, unchanged)**, tsc 3175
(0 new in the two touched files), in-container build exit 0, 2026-06-27; see plan §"Frozen-left Slice 1".

**Frozen-left Slice 2 of 2 -- manual row-resize + column-resize re-measure + frozen-pane border (`PricingGrid.tsx` +
`PricingGrid.test.ts`; frontend-only, NO migrate; COMPLETES the frozen-left arc):** Three additions, all gated to the split
(frozen) render. **(1) Frozen-pane right border (PART 1):** once split, the frozen table's own right edge (the Description
`border-r`) is CLIPPED by the frozen pane's `overflow-hidden`, so the freeze boundary looked invisible -- fixed by drawing
`border-r border-border` ONCE on the frozen-pane CONTAINER (its border-box isn't clipped; the clipped cell border can't show
-> no double-up, one crisp line). Unfrozen single table unchanged. **(2) Manual row-resize (PART 2):** the FROZEN pane row
renders a bottom-edge drag handle (`cursor-row-resize`, `absolute inset-x-0 bottom-0`) on the Excel-row gutter cell (col-0,
made `relative`), the spreadsheet row-resize idiom, ONLY when `pane==="frozen"`. It mirrors the column-resize pointer-capture
pattern on the Y axis via a `rowResizeRef` {rowIndex,startY,startHeight} + a new pure `clampRowHeight(px)` (floor **40px** --
above the scrolling pane's tallest irreducible cell, the rate input ~36px, so a dragged-short row reaches the same height in
BOTH panes and can't drift; unit-tested). The drag writes into a SEPARATE `manualRowHeights` map (keyed by row.row_index);
the applied height = `manualRowHeights[ri] ?? rowHeights[ri]` (manual wins), passed to BOTH panes -> the dragged row resizes
in both, aligned. The three handlers are STABLE `useCallback`s passed as memo-safe row props (added to `PricingGridRowProps`
+ `pricingRowPropsAreEqual`, reference-stable -> the row memo holds), mirroring registerCell/focusCell. **(3) Sticky manual
heights (Option A) + column-resize re-measure (PART 3, closes the Slice-1 limitation):** the two maps make a height's origin
unambiguous. On UNFREEZE only the captured `rowHeights` is cleared; `manualRowHeights` SURVIVES -> a re-freeze keeps the
user's dragged rows and re-measures only the rest (the measure effect skips any row that already has a manual OR captured
height). On a COLUMN resize / autofit WHILE frozen, `endResize`/`autofitColumn` clear `rowHeights` (captured only) ->
`split` drops to false for one render -> the single table re-renders at NATURAL height with the new column widths -> the
existing measure layout-effect re-reads true natural heights for the non-manual rows -> split re-commits; all inside a
layout-effect cycle (post-layout / pre-paint) so it is **flash-free** (no invalidate-on-next-paint fallback needed). MANUAL
rows are never re-measured, so a column resize can't clobber a dragged height. BOTH maps reset on the sheet/version remount
(session+sheet scoped; no backend persist). Unfrozen single-table behaviour unchanged except manual heights are PRESERVED in
state (applied only when re-frozen). SheetPricingPage NOT touched (row-resize state lives entirely in the grid). **vitest 341
(boq-wizard; PricingGrid 131, +2 clampRowHeight)**, tsc 3175 (0 new in the two touched files), in-container build exit 0,
2026-06-27; see plan §"Frozen-left Slice 2".

