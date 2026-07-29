### Frozen-left Slice 2 of 2 -- manual row-resize + column-resize re-measure + frozen-pane border (FRONTEND, view-layer, NO migrate, base tip fd841657, 2026-06-27)

**Completes the frozen-left arc.** Frontend-only: `PricingGrid.tsx` + `PricingGrid.test.ts` (SheetPricingPage NOT touched --
row-resize state lives entirely in the grid). NO backend / doctype / migrate. All three additions are gated to the split
(frozen) render; the unfrozen single table is unchanged except manual heights are PRESERVED in state.

**PART 1 -- frozen-pane right-border fix.** Once split, the frozen `<table>`'s own right edge (the Description cell
`border-r`) is CLIPPED by the frozen pane's `overflow-hidden` (table width === pane width), so the freeze boundary read as
invisible. Fix: draw `border-r border-border` ONCE on the frozen-pane CONTAINER div -- its border-box is not clipped by its
own overflow, and the clipped cell border can't show, so there is NO double-up: one crisp vertical line at the boundary.
Affects ONLY the split render.

**PART 2 -- manual row-resize.** A bottom-edge drag handle (`role="separator"`, `cursor-row-resize`, `absolute inset-x-0
bottom-0 h-1.5`) renders inside the col-0 Excel-row gutter cell (made `relative`), ONLY when `pane==="frozen"` -- the
spreadsheet row-resize idiom (drag the row-number's bottom border). It mirrors the proven column-resize pointer-capture
pattern on the Y axis: a `rowResizeRef` holds `{rowIndex: row.row_index, startY, startHeight}`; pointerDown captures +
records the row's current applied height as the start; move computes `clampRowHeight(startHeight + dy)` and writes it to the
`manualRowHeights` map; up releases. New pure helper **`clampRowHeight(px) = max(ROW_MIN_PX 40, round(px))`** -- the floor is
**40px**, deliberately ABOVE the tallest irreducible single-line cell across BOTH panes (the scrolling pane's rate input,
h-7=28px + py-1=8px ~= 36px) so a dragged-short row can actually REACH the same height in the scrolling pane too; a lower
floor would let the frozen pane clip shorter while the scrolling pane stayed tall (content min) -> drift. `clampRowHeight` is
unit-tested (mirrors `clampColumnWidth`: clamps up to 40 incl. negative/zero drag-past-top; passes through + rounds above).
**Memo-safety:** the three handlers are STABLE `useCallback([])` grid callbacks passed as row props (added to
`PricingGridRowProps` + `pricingRowPropsAreEqual`, reference-stable like registerCell/focusCell), so the row memo is NOT
defeated -- a row drag re-renders via the `manualRowHeights` state change (the dragged row's `rowHeight` scalar changes),
exactly like a captured-height change. The dragged height applies to BOTH panes (frozen + scrolling) via the shared applied
height, so the row resizes in both and stays aligned (A8).

**PART 3 -- sticky manual heights (Option A, owner-locked) + column-resize re-measure.** Representation: TWO maps, both keyed
by `row.row_index` -- `rowHeights` (auto-CAPTURED at freeze / re-measure) and `manualRowHeights` (user-DRAGGED). The APPLIED
height = `manualRowHeights[ri] ?? rowHeights[ri]` (manual wins); the `split` gate + the row prop both use it; the measure
effect skips any row that already has a manual OR captured height. (A1) **Manual survives unfreeze:** the unfreeze branch
clears ONLY `rowHeights`; `manualRowHeights` persists, so a freeze->unfreeze->re-freeze keeps the user's dragged rows and
re-measures only the untouched ones. Both maps reset on the `key={sheetName::version}` remount (session+sheet scoped; no
backend persist). (A2) **Column-resize-while-frozen re-measure (closes the Slice-1 limitation):** on a column resize commit
(`endResize`) or double-click `autofitColumn` while split, clear `rowHeights` (captured only). That drops an applied height
for the non-manual rows -> `split` goes false for one render -> the SINGLE table re-renders at NATURAL height with the NEW
column widths -> the existing measure layout-effect re-reads true natural (re-wrapped) heights for the non-manual rows ->
split re-commits. This reuses the Slice-1 measure path entirely and runs inside a layout-effect cycle (post-layout /
pre-paint), so it is **FLASH-FREE** -- the invalidate-on-next-paint fallback was NOT needed. MANUAL rows are never
re-measured (the measure loop skips them), so a column resize cannot clobber a dragged height.

**Memo / comparator (A13).** Added exactly the three stable resize-handler props to `pricingRowPropsAreEqual`
(`onRowResizePointerDown/Move/Up`, all reference-stable). `rowHeight` stays the per-row scalar (now = applied height). No
other comparator change; no memo defeat.

**Tests + gates.** `clampRowHeight` added + unit-tested (the one new pure fn). **Vitest 341 (boq-wizard; PricingGrid 131,
+2)**, tsc 3175 (0 new in the two touched files), in-container Vite build exit 0, 2026-06-27. Two commits (feat + docs); NOT
pushed (owner pushes after live-cert on 145/150/166).

**Live-cert (pending Nitesh, 145/150/166).** RC1 freeze -> a crisp vertical line at the freeze boundary (Description right
edge), no gap, no double; RC2 drag a frozen row's bottom edge -> that row grows/shrinks in BOTH panes together, staying
aligned; RC3 a row can't be dragged below ~40px (still shows a usable line in both panes); RC4 drag row A, then resize a
COLUMN -> A keeps its manual height while the other (captured) rows re-measure to the new wrap, no flash; RC5 drag row A ->
unfreeze -> re-freeze -> A keeps its manual height, the rest re-measure; RC6 sheet/version switch -> all heights reset; RC7
manual + column resize + collapse + version-view + full-screen compose without misalignment; RC8 repeat RC1/RC2/RC4/RC5 on
145/150/166.

