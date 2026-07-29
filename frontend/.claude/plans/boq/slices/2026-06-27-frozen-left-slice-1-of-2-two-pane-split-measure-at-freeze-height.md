### Frozen-left Slice 1 of 2 -- two-pane split + measure-at-freeze heights + wrap/clip/tooltip (FRONTEND, view-layer, NO migrate, base tip 185b2a19, 2026-06-27)

**Revives the DEFERRED frozen-left as the structural TWO-PANE slice** (the recon's option c). The reverted approach was
cumulative cell-level `sticky left` across multiple columns -- structurally broken (does not track horizontal scroll). This
slice ships the two-pane split instead. Frontend-only: `PricingGrid.tsx` + `SheetPricingPage.tsx`. NO backend / doctype /
migrate. Manual row-resize is **Slice 2** (NOT in this slice). Preceded by two read-only recons (feasibility + Fork A).

**Toggle (`SheetPricingPage.tsx`).** A page-owned per-sheet `const [frozen,setFrozen]=useState(false)` + a "Freeze columns" /
"Unfreeze" ribbon button (`Pin`/`PinOff`, loud sky-600 when on, `aria-pressed`, disabled while loading/error/no-rows) placed
INSIDE the `{!isGridOnly && (<>...)}` cluster, so grid-only general-specs sheets (rendered by SheetDataGrid) never see it.
Reset to false on tab switch (the `useEffect([sheetName])`). Passed as `frozen={frozen}` to the PricingGrid branch ONLY
(SheetDataGrid never receives it). Default OFF.

**Split gate (`PricingGrid.tsx`).** `const split = frozen && rows.length>0 && rows.every(r => rowHeights[r.row_index] != null)`.
`splitRef.current = split` each render (so the stable focus/jump callbacks read it at event time). ALL structural decisions
key on `split`, NOT `frozen` -- so the render where `frozen` first flips true (heights not yet captured) still paints the
SINGLE table, which is what the measure effect reads.

**Measure-at-freeze ("Fork A").** A `useLayoutEffect([frozen, rows, rowHeights])`: when `!frozen` -> clear `rowHeights` to {}
(functional update returns prev when already empty -> no loop); when `frozen` AND not every current row is measured -> read
each row's NATURAL `<tr>` height via the always-registered col-0 cell (`cellRefs.get(navKey(i,0)).closest("tr")
.getBoundingClientRect().height`, `Math.ceil`) and `setRowHeights`. It runs post-layout / pre-paint on the single table
(split deferred until measured), so the next synchronous render commits the split with heights applied -- the user never
sees an unmeasured split frame. A `rows` change under freeze (collapse/filter/version) drops an unmeasured row -> `split`
false -> single table re-renders -> re-measures the new set. The grid's `key={sheetName::version}` remount resets
`rowHeights` to {} for free on sheet/version switch (no manual invalidation).

**Two-pane render.** When `split`: a flex row with (1) a FROZEN pane (`frozenPaneRef`, `overflow-hidden shrink-0`, width =
summed anchor `colWidths`) holding a table of the 5 anchor `<col>`/`<th>`/anchor-cells; (2) a SCROLLING pane
(`scrollPaneRef`, `overflow-auto flex-1 min-w-0`, `onScroll` mirrors `scrollTop` to the frozen pane) holding a table of the
descriptor + Remarks `<col>`/`<th>`/cells. Both tables `table-fixed` + their own `<colgroup>` slice from the SAME `colWidths`
map (NO duplicate width state). Sticky header (`sticky top-0`) works per pane (each is its own bounded scroll container; the
height cap `max-h-[calc(100vh-14rem)]` / `min-h-0` when expanded is on the panes). When NOT split: ONE single table renders
byte-for-byte as before (the col/th/row JSX is extracted into shared `anchorCols`/`descriptorCols`/`remarksCol` +
`anchorHeaderCells`/`descriptorHeaderCells`/`remarksHeaderCell` fragments + a `renderRow(row,i,pane?)` factory, used by both
branches -- identical elements). The autofit measure ref moved from `<table>` to the outer `containerRef` div (it now spans
both panes, so a `[data-colkey]` query finds anchor + descriptor cells alike).

**Row cell-grouping + height/clip (`PricingGridRow`).** New per-row props `pane?: "frozen"|"scrolling"` + `rowHeight?: number`
(both added to `PricingGridRowProps` AND the exhaustive `pricingRowPropsAreEqual` -- `pane` is per-instance-constant,
`rowHeight` a per-row scalar like `depth`/`isCurrentHit`, so the memo holds on a keystroke). The row wraps its cells in two
fragments: anchors render when `pane !== "scrolling"`, the data group (descriptors + Remarks) when `pane !== "frozen"` --
so unfrozen (`pane` undefined) emits BOTH (a fragment adds no DOM -> byte-for-byte). `style={rowHeight!=null ? {height} :
undefined}` on the `<tr>` in BOTH panes forces the short scrolling-pane row up to the captured height; the Description inner
wrapper is clipped to `maxHeight: rowHeight - DESC_CLIP_VPAD_PX(12)` + `overflow:hidden` so a tall row can't push its pane
past the other (text still WRAPS via `break-words`, clips from the top via `align-top`). `data-rowidx={pane==="scrolling" ?
rowIndex : undefined}` tags the scrolling rows for the scroll retarget.

**Tooltip.** The Description text span gains `title={row.description ?? undefined}` (native `title` -- the grid's idiom,
NO shadcn Tooltip) for full-text-on-hover when clipped; applied regardless of freeze (harmless when not clipped).

**Scroll / jump retarget.** `focusCell` + `jumpToRow` are split-aware (read `splitRef`): they `focus({preventScroll:true})`
(focusing a frozen-pane cell must not auto-scroll the frozen pane -> would desync the panes) and drive the SCROLLING pane --
a data cell (`c >= FIXED_ANCHOR_COUNT`) scrolls itself (it lives there); an anchor cell scrolls its scrolling-pane
counterpart `<tr>` (found by `scrollPaneRef.querySelector('tr[data-rowidx]')`); the frozen pane then mirrors via `onScroll`.
Unfrozen behaviour unchanged.

**Collapse + version-view + lock/override.** Rows flow through the SAME page-side `displayRows` into both panes (collapse +
view filters compose before the grid; the scrolling pane just renders fewer/more rows and re-measures). Version-view stays
read-only via the existing `locked` choke (save callbacks withheld) -- freeze is orthogonal. Lock / "Price any row" override
semantics are untouched by this slice.

**KNOWN LIMITATION (deferred to Slice 2 with manual row-resize).** A COLUMN resize / double-click autofit WHILE frozen
re-wraps Description + changes natural heights, but the captured `rowHeights` map is NOT refreshed -> heights can go stale
until unfreeze/re-freeze. Out of scope here; Slice 2 (manual row-resize) will own the re-measure/invalidate story.

**Tests + gates.** NO new pure helper extracted (the split predicate + height application are inline; the measure effect +
scroll retarget are DOM, not unit-testable in jsdom) -> NO test added; the existing suite stays green. **Vitest 339
(boq-wizard; PricingGrid 129, unchanged)**, tsc 3175 (0 new in the two touched files), in-container Vite build exit 0,
2026-06-27. Two commits (feat + docs); NOT pushed (owner pushes after live-cert on 145/150/166).

**Live-cert (pending Nitesh, 145/150/166).** FC1 toggle appears on data sheets, ABSENT on grid-only; FC2 freeze ON -> anchors
pin, descriptors/Remarks scroll horizontally past them; FC3 the two panes stay ROW-ALIGNED incl. tall wrapped-Description
rows (the Fork A guarantee -- watch for any drift); FC4 vertical scroll moves both panes together (scrolling pane drives);
FC5 sticky header pins in both panes; FC6 a clipped Description shows full text on hover (native title); FC7 search-jump /
parent-jump / arrow-nav land on the right row with both panes aligned; FC8 unfreeze -> back to the single table, rows return
to natural wrap-grow height; FC9 collapse/expand + version-view while frozen keep both panes aligned + read-only history
read-only; FC10 full-screen + freeze together; FC11 (known-limitation check) a column resize while frozen may leave row
heights stale until unfreeze -- expected, Slice 2; FC12 repeat FC2/FC3/FC8 on 145/150/166.

