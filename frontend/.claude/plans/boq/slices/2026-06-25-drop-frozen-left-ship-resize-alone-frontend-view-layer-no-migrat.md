### Drop frozen-left, ship resize alone (FRONTEND, view-layer, NO migrate, base tip 5415fd20, 2026-06-25)

**Subtractive slice: the frozen-left HALF of the bundle above is REMOVED; the column-resize half STAYS** (`PricingGrid.tsx`
only -- `PricingGrid.test.ts` UNCHANGED). Frontend-only, NO backend/doctype/migrate/persistence, `reviewRender.tsx`/
`SheetPricingPage.tsx` UNTOUCHED.

- **WHY (structural, not cosmetic).** The red-box experiment confirmed cell-level **multi-column sticky-left does not track
  horizontal scroll**: the frozen anchor cells paint in place but the scrolling columns clip BEHIND them and do NOT reset
  on scroll-back -- a STRUCTURAL failure of cumulative per-cell `sticky left:var(--fcol-N)` on a `table-fixed` table, not an
  opacity/border bug. The **`border-collapse` -> `border-separate` flip tried during debugging was a WRONG-AXIS attempt**
  (the problem is h-scroll tracking, not border mode) and was **reverted** (border-collapse is unchanged in the shipped
  code). The only real fix is a **two-pane split table** (frozen columns in one table, scrolling in another, scroll-synced)
  -- but the feasibility recon found a split **fights resize's wrap-and-grow** (Description, the tallest-wrapping column, is
  in the frozen pane while Remarks, also growable, scrolls -> two-directional per-row height-sync over 120-194 rows) **and
  doubles the row memo** (the `<tr>` would split into two memoized halves). NAV across the split is tractable (the nav is
  already a shared ref-map + pure `nextCell` + grid-level `activeCell`), but the row-height antagonism is not worth it now.
  Decided: drop frozen-left, ship the certed resize alone.

- **WHAT WAS REMOVED (frozen-left only).** R1 the opaque `frozenBg` const (the per-row sticky-cell bg) + the now-unused
  `group` class on the `<tr>` (its only consumer was `frozenBg`'s `group-hover:`). R2 the 5 anchor body `<td>`s lose
  `style={{left:"var(--fcol-N)"}}` + `sticky z-10` + `frozenBg` -> normal scrolling cells (padding/border/align/
  `cellNavClass`, the col-0 flag accents, the col-2 parent-jump button, the col-4 depth indent ALL stay). R3 the `fcol0..4`
  cumulative-offset derivations + the `--fcol-0..4` CSS vars on `tableStyle` (now `{ width }` only; the unused
  `type CSSProperties` import was dropped). R4 the 5 anchor `<th>`s are downgraded from the z-30 corner tier back to the
  descriptor-header `sticky top-0 z-20 bg-muted` (the **VERTICAL sticky header STAYS** -- only the horizontal freeze +
  corner tier went).

- **WHAT STAYS (resize, UNCHANGED + certed).** `table-fixed` + the `<colgroup>` (5 anchor + visibleDescriptors + Remarks
  `<col>`); `width: ${totalWidth}px`; `colWidths` state; ALL resize handlers (`startResize`/`moveResize`/`endResize`/
  `autofitColumn`/`resizeHandle`); the rate min-width clamp (`clampColumnWidth`/`RATE_COL_MIN_PX`); the seed helpers
  (`seedWidthPx`/`columnWidthKey`/`seedForWidthKey`); headers-truncate (D4) / body-wrap-and-grow (D3); `data-colkey` on all
  cells (autofit reads it); the VERTICAL sticky header; the **row memo `pricingRowPropsAreEqual` UNCHANGED**. NAV /
  parent-jump / 3s flash / rate edit + auto-save all unchanged (resize changes WIDTH, not column count/order).

- **Frozen-left = DEFERRED (NOT dropped from scope).** It returns as a dedicated **structural two-pane slice** (recon option
  c) if/when prioritized -- the editor-design §14 frozen-left row stays a SCHEDULED item.

- **Tests + gates.** NO test changed (subtractive className/style removal -- no pure-helper touched; the resize helpers +
  their PricingGrid.test.ts tests stay green). **Vitest 303 -> 303** (PricingGrid 129), tsc 3175 (0 new in PricingGrid),
  in-container Vite build exit 0, 2026-06-25.

- **Live-cert (pending Nitesh, 145/150/166).** RESIZE (the kept feature): LC1 every border drags; LC2 narrowing wraps body
  + that row grows; LC3 headers stay single-line + tooltip; LC4 double-click autofits; LC5 rate column can't clip its input;
  LC6 reload + sheet-switch reset widths. FROZEN-LEFT GONE: LC7 scroll right -> anchors scroll AWAY normally (not pinned,
  not half-stuck -- the freeze bug is gone because the freeze is gone); LC8 the vertical sticky header STILL pins on vertical
  scroll; LC9 current-hit yellow / jump-flash blue / row hover still show on the anchor cells (now via the normal `<tr>` bg);
  LC10 nav / parent-jump+flash / rate edit + auto-save still behave; LC11 full-screen resize + sticky header + nav; LC12
  repeat LC1/LC2/LC7 on 145/150/166.

