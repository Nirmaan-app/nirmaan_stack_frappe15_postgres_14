### Slice V2 -- unmount-safety retrofits for the virtualized pricing grid (FRONTEND, NO migrate, base tip 8e898738, 2026-07-15)

Closes the three V1 KNOWN GAPS (nav/search-to-unmounted, overlay close-on-scroll-out, RemarkCell durable re-key)
plus the tab-return rider. FRONTEND-ONLY; classic mode byte-identical (143 PricingGrid tests green + UNMODIFIED);
memo shield (V0/T2) intact -- no new/destabilized row prop. Scope: `PricingGrid.tsx` + `SheetPricingPage.tsx` +
`pricingVirtual.ts` (+ test).

**1. Nav + search to UNMOUNTED rows.** Nav (`focusCell`) + jump/search (`jumpToRow`, the sole path -- imperative
`scrollToRow` + search `stepHit` both delegate) now scroll the window to an off-window target before focusing,
VIRTUALIZED-only. Two refs assigned right after `useVirtualizer` (both stable/cheap, synced each render like
`rowsRef`/`splitRef`): `virtualizedRef` (mirrors the prop) + `scrollRowIntoWindowRef` (=`rowVirtualizer.scrollToIndex(idx,
{align:"center"})`). `focusCell`/`jumpToRow` stay reference-stable (deps `[]`/`[onRevealRow]`, read only refs) -> the row
memo (`focusCell`/`onJumpToRow` props) is untouched. Both branch on the pure `resolveJumpAction(isMounted, virtualized)`
(`"focus"` | `"scroll-then-focus"` | `"noop"`): a mounted target focuses synchronously exactly as before; an off-window
target (virtualized) does `scrollToIndex(center)` then focuses after the mount re-render commits (the reveal-then-defer
scaffold, 50ms); classic never has an unmounted target -> `"noop"` / `focusEl` guards. **align is "center", NOT "auto":**
with DYNAMIC row measurement an unmeasured just-past-window row's ESTIMATED offset reads as already-visible, so `"auto"`
no-ops (live-verified arrow-nav stall at the bottom edge); `"center"` forces the scroll. Focus never lands on
`document.body` mid-jump -- a col-0 (non-editable) cell isn't blurred by `commitActiveRate`, so focus stays on the current
cell through the defer until it moves to the target.

**2. Overlay close-on-scroll-out (virtualized).** (a) **CategoryVerdictPicker** (page-owned, anchored to a captured
`pickerState.anchorEl` -- the only overlay that truly orphans): a `useEffect([pickerState, virtualized])` in
`SheetPricingPage` attaches an `IntersectionObserver` (viewport root, threshold 0) on the anchor; `!isIntersecting`
(scrolled off-screen OR removed from the DOM) -> `setPickerState(null)`. VIRTUALIZED-gated (classic never unmounts ->
byte-identical). (b) **Remark popover** (rendered INSIDE the row -> Radix portal already tears down on unmount, no orphan):
a grid effect keyed on `rowVirtualizer.range` (start/end) clears `openRemarkExcelRow` when its excel row leaves the mounted
set (pure `shouldCloseOverlay(openExcelRow, mountedExcelRows)`) -- makes the close explicit and stops reopen-on-scroll-back.
(c) **Reconciliation chooser** -- LOCAL state inside the row, auto-closes on unmount; no code change (verified graceful).

**3. RemarkCell durable re-key.** `openRemarkRowIdx` (window array index) -> `openRemarkExcelRow` (`source_row_number`).
`renderRow`: `openRemark={openRemarkExcelRow === row.source_row_number}` (was `=== rowIdx`); `setOpenRemark(excelRow, open)`
(row calls it with `row.source_row_number`); the keydown Enter-opens-remark resolves `rows[activeCell.rowIndex]?.source_row_number`.
The row prop `openRemark` stays a by-value boolean -> `pricingRowPropsAreEqual` UNCHANGED. Fixes the latent index-reuse
mis-target under row recycling (a collapse/filter reshuffle made array index N map to a different row). Survey: no other
per-row overlay state is array-index-keyed (category picker is already excel-row-keyed page-side; recon/color/formula are
local or excel-keyed) -- nothing else needed re-keying.

**4. RIDER (tab-return blank) -- INVESTIGATED, NO CHANGE (STOP, as planned).** Static + live finding: the loading gate
(`return isLoading ? <spinner> ...`, SheetPricingPage) + the grid slot's `pricedLoading` both read SWR `data === undefined`,
and the BOQs / get_priced_rows SWR keys are stable across a tab-return; SWR keeps `data` across a revalidation, so a
window-refocus does NOT flip either gate. Live-confirmed: firing `focus` + `visibilitychange` (the signals SWR
`revalidateOnFocus` listens to) left the grid fully rendered (38 rows, header, no spinner, no unmount). The gate is already
revalidation-safe; the only way to blank is a genuine tab-DISCARD cold remount (no cache -> `isLoading`/`keepPreviousData`
cannot help), which exceeds a small contained change. Per the rider's own stopping condition -> STOP, no code.

**New pure helpers (`pricingVirtual.ts`, +6 vitest):** `resolveJumpAction(isMounted, virtualized)` (mounted->"focus";
virtualized-unmounted->"scroll-then-focus"; classic-unmounted->"noop") + `shouldCloseOverlay(openExcelRow, mountedExcelRows)`
(true iff open AND not in the mounted set; null/empty handled). Each positive + negative.

**Gates:** wizard-scoped `tsc` **0** errors (changed files; app-wide pre-existing noise standing); vitest **501 -> 507**
(6 new; all 143 PricingGrid tests green + UNMODIFIED); `yarn build` OK. Classic path byte-identical; unfrozen + frozen
virtualized measure path untouched; freeze/lock/save unchanged.

**Live check (Chrome DevTools MCP, PUNE ELECTRICAL BOQ = BOQ-26-00003 / BQSH-26-00258, 870 rows, Fast render ON;
destaled: Vite restart + SW unregister):**
- **(a) search-jump to an unmounted deep match -- PASS.** Search "earthing" (20 hits), stepped to the last hit
  (Excel row 1371, array idx ~860): the window re-windowed from indices 0-21 to **841-869** (`scrollTop` 0 -> 30127),
  the row MOUNTED, the yellow current-hit highlight applied, focus stayed on the search-nav button (NOT `document.body`).
- **(b) arrow-nav across the window edge -- PARTIAL (focus-safe, no window advance).** Real + synthetic ArrowDown
  advances focus through the mounted window and it NEVER escapes to `document.body` (the hard requirement -- verified it
  stops on the last mounted cell, e.g. idx 844/35, never body), BUT the window does NOT auto-scroll PAST the edge on
  arrow keys. Root cause (diagnosed live): this virtualizer container re-windows on REAL WHEEL events but NOT on
  programmatic scrolls -- `scrollToIndex` for a target ADJACENT to the window is defeated by the dynamic-measurement
  estimate error (a near target's estimated offset reads as already-visible), and the pre-existing mounted-path
  `el.scrollIntoView` likewise doesn't advance it. This is a V1 architectural trait (affects the existing scrollIntoView
  too), NOT a V2 regression -- V1 arrow-nav also stalled at the edge, additionally with search-jump broken. `scrollToIndex`
  DOES work for the FAR jumps of check (a) (a large net scroll fires the event). The `"center"` fix is strictly better than
  the shipped-first `"auto"` (it enables the verified search-jump) and harmless, so it is KEPT; a full arrow-edge fix would
  mean changing how the virtualizer observes scroll (V1 territory) -> left as a documented residual.
- **(c) remark scroll-out close + durable re-key -- PASS.** Opened the remark on array idx 16 (Excel 24) -> 1 popover;
  scrolled it out (window -> 72-113, row unmounted) -> **popover CLOSED, 0 orphans**; scrolled back so idx 16 (Excel 24)
  remounted -> **no spurious/mis-targeted reopen** (0 popovers) -- the durable excel-row key + scroll-out clear behave correctly.
- **item-2 CategoryVerdictPicker close -- PASS.** Opened the verdict picker on the classified idx-0 "Panels" cell
  (engine-scoped Electrical list) -> 1 popover; scrolled the anchor row out (window -> 16-53) -> **picker CLOSED, 0 orphans**
  (IntersectionObserver), no dangle against a detached node.
- **(d) tab-return -- PASS (no blank).** Backgrounded the tab + fired the SWR revalidation signals: grid stayed fully
  rendered, no spinner, no unmount (rider verification -> no change needed).

**V1 KNOWN GAPS status:** #1 nav/search-to-unmounted -> **CLOSED for search-jump; arrow-edge PARTIAL** (focus-safe, window
non-advance documented above). #2 overlay close-on-scroll-out -> **CLOSED** (category picker + remark; recon already safe).
#3 RemarkCell durable re-key -> **CLOSED**.

