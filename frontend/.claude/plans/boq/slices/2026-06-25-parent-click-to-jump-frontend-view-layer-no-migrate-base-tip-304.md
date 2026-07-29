### Parent click-to-jump (FRONTEND, view-layer, NO migrate, base tip 3049c294, 2026-06-25)

**The pricing grid's Parent anchor cell (col 2) becomes a CLICKABLE jump to the parent row** (`PricingGrid.tsx` + the
existing `PricingGrid.test.ts`). Frontend-only -- NO backend, NO doctype, NO migrate, NO table-layout change.
**Restores §13-3a click-to-jump, which Slice 3a shipped read-only** (3a rendered the Parent column as a static muted
`↑ {parentExcelRow}` span). `SheetPricingPage.tsx` is UNTOUCHED -- the jump is grid-internal (`scrollToRow` is on the
grid's own imperative handle).

- **Reuses the EXISTING jump path.** The parent's Excel row was ALREADY resolved at render and the grid already had a
  `scrollToRow(excelRow)` on its imperative handle (search + review-strip precedent). This slice wires the click to that
  same path -- it does NOT add a new scroll mechanism. The shared resolution is extracted to the NEW pure exported
  `parentExcelRowOf(row, byIdx)` (root `effective_parent_index` null / the -1 sentinel -> null; a parent absent from the
  rendered set's `byIdx` -> null too -> the click is a safe no-op), which now backs THREE call sites (the row render's
  `parentExcelRow`, the Enter handler, and -- via delegation -- the imperative `scrollToRow`), so the resolution is ONE
  source. A grid-level `jumpToRow` `useCallback` (deps `[]`, reads only refs) is the single jump fn; the imperative
  `scrollToRow` now delegates to it.

- **The button is col-2's roving nav target (no second tab stop).** When a parent exists the cell renders a `<button>`
  that CARRIES the col-2 focus props (`tabIndex` via `isTabStop(2)` + `onFocus -> onCellFocus(rowIndex, 2)` + the
  `registerCell` ref) and the active-cell ring -- exactly the pattern a rate `<input>` uses to own its cell -- so there
  is no second tab stop and the roving-tabindex single-tab-stop model holds. A **ROOT row renders no button**, so its
  `<td>` keeps `tdFocusProps(2)` + `cellNavClass(2)` (col 2 ALWAYS has a registered nav target, root or not) --
  backwards-compatible.

- **Activation: click + Space + Enter.** Mouse-click and **Space** fire the `<button>` natively (Space is not a nav key,
  so `handleGridKeyDown` lets it fall through at `if (!dir) return`). **Enter** is a NEW col-2 special-case in
  `handleGridKeyDown` (mirrors the existing remarks-cell Enter case): it resolves the active row's parent via
  `parentExcelRowOf` and `jumpToRow`s it; a ROOT row has no parent so it falls through to the generic Enter->down (nav
  unchanged there).

- **Row-memo rule (load-bearing).** The jump arrives as a NEW per-row prop `onJumpToRow` -- a grid-level `useCallback`,
  reference-STABLE -> memo-safe -- added to BOTH `PricingGridRowProps` AND the exhaustive `pricingRowPropsAreEqual`
  comparator (the established stable-callback pattern, e.g. `commitRate`/`focusCell`). At rest the cell behaves the same
  except it is now clickable; no existing prop/behaviour of `PricingGrid` changes (A10).

- **Frozen-left + column-resize remain a SEPARATE later BUNDLED slice** (per the recon recommendation (iii)): they share a
  `table-fixed + colgroup` foundation, so they are built together later; this slice deliberately touches NO table layout /
  column widths / sticky-left / colgroup. Parent-jump is independent of that table-layout decision.

- **Tests + gates.** NEW pure `parentExcelRowOf` is unit-tested in `PricingGrid.test.ts` (+4: valid-parent -> source_row_
  number, root-null -> null, the -1 root sentinel -> null, parent-absent-from-byIdx -> null NEG/no-throw). **Vitest 287 ->
  291** (PricingGrid 113 -> 117), tsc 3175 (0 new in touched files), in-container Vite build exit 0, 2026-06-25.

- **Live-cert (pending Nitesh, all 3 canonical BoQs 145/150/166):** LC1 click a row's parent ref -> grid scrolls to that
  parent row; LC2 a root row shows no clickable parent / no dead click; LC3 click a parent currently filtered out
  (show-unpriced on, or a row-type hidden) -> safe no-op, no crash; LC4 keyboard: the parent control is focusable +
  activates on Enter/Space; LC5 repeat on 145/150/166.

**Landing flash (follow-up, base tip 2d046dc0, 2026-06-25).** A jump now also FLASHES THE WHOLE landed row blue for 3s
then clears -- focus alone cued only the col-0 cell, leaving the rest of the row without a "you landed here" signal. Same
`PricingGrid.tsx`-only scope (frontend, view-layer, NO backend/doctype/migrate, NO table-layout). `SheetPricingPage.tsx`
untouched.

- **Grid-level state, per-row signal.** A new `flashExcelRow: number | null` `useState` + a `flashTimeoutRef`. In
  `jumpToRow`, AFTER the existing focus + `scrollIntoView`: `setFlashExcelRow(excelRow)`, clear any prior timeout, start a
  **3000ms** timeout that clears it back to null. A new jump RESETS the timer (rapid jumps don't stack -- the latest
  replaces the prior). `jumpToRow` STAYS reference-stable (deps `[]`: only the stable `setFlashExcelRow` setter + the
  timeout ref are added), so the `onJumpToRow` row prop stays memo-safe. Cleared on unmount via a small effect; resets for
  free on a sheet-switch (the page remounts the grid `key={sheetName}`).
- **Row paint + memo.** The derived per-row boolean `isJumpFlashRow(row.source_row_number, flashExcelRow)` (NEW pure
  exported predicate, mirrors `isCurrentHitRow`) is passed as `isJumpFlash` and added to BOTH `PricingGridRowProps` AND
  `pricingRowPropsAreEqual` -- so the flash paints/un-paints as `flashExcelRow` flips (a memo'd row would not otherwise
  re-render). The `<tr>` wash is `isJumpFlash ? blue-100/blue-900-40 : isCurrentHit ? yellow : hover`.
- **Layering + precedence (LOCKED).** Blue is a WHOLE-ROW background (like the search current-hit yellow); per-cell priced
  emerald/amber tints still win on their own `<td>`s (same harmless layering the yellow already accepts). When a row is
  BOTH the search current-hit (yellow) AND the jump target (blue), **the blue jump flash WINS for its 3s** (the jump just
  happened -> the more relevant cue), then reverts to yellow if still the hit. The active-cell ring is unchanged.
- **Reduced-motion.** Implemented as **instant on / held 3s / instant off, NO CSS transition** -- the calmer of the two
  sanctioned options, inherently reduced-motion-safe, and it deliberately leaves the existing hover/current-hit paint
  timing UNTOUCHED (adding a `transition` to the shared `<tr>` would have altered the protected search-hit behaviour).
- **Also flashes on the shared `scrollToRow`.** Since parent-jump delegates to the one `jumpToRow`, the imperative
  `scrollToRow` (review-strip + search "jump to row") now flashes the landed row too -- consistent + desirable.
- **Tests + gates.** NEW pure `isJumpFlashRow` unit-tested in `PricingGrid.test.ts` (+3: matching-row true, null-flash
  false, non-matching false). The 3s timeout/timing itself is manual-cert (not a hollow timer unit test). **Vitest 291 ->
  294** (PricingGrid 117 -> 120), tsc 3175 (0 new in touched files), in-container Vite build exit 0, 2026-06-25.
- **Live-cert (pending Nitesh, 145/150/166):** LC1 click a parent ref -> the WHOLE row flashes blue ~3s then fades to
  normal (not just col 0); LC2 self-clears after 3s, active-cell ring remains; LC3 rapid A-then-B jump -> A's flash stops,
  B flashes (no stuck/stacked flashes); LC4 a row that is both search-hit (yellow) and just-jumped -> blue wins 3s then
  reverts to yellow; LC5 review-strip / search jump also flashes (shared path), not jarring; LC6 repeat on 145/150/166.

