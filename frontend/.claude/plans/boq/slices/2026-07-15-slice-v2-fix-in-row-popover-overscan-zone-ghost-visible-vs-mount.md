### Slice V2-FIX -- in-row popover overscan-zone ghost (visible-vs-mounted gap) (FRONTEND, NO migrate, base tip e557b060, 2026-07-15)

**Bug (owner screenshot-verified).** A remark popover open with typed text; a search-jump/scroll moved its anchor row
OFF-SCREEN but it stayed MOUNTED (the overscan zone), so the V2 mounted-set close predicate
(`shouldCloseOverlay` over `getVirtualItems()`, which INCLUDES overscan) never fired -> Radix collision-pinned the open
`PopoverContent` into the viewport as a floating "ghost" detached from any row. The CategoryVerdictPicker was immune
because its close is an `IntersectionObserver` on the anchor = VISIBILITY-based, not mounted-set.

**Fix -- make the in-row popovers close on VISIBILITY loss (consistent with the picker), VIRTUALIZED-gated, all in
`PricingGrid.tsx`:**
- New `VirtualizedContext` (a boolean, provided around BOTH grid return trees -- twoPane + single -- next to the existing
  `CollapseContext.Provider`; renders no DOM, flips only on the A/B toggle) so the in-row popovers learn `virtualized`
  WITHOUT a new row prop (memo shield intact -- context is orthogonal to `pricingRowPropsAreEqual`).
- New shared hook `useCloseWhenScrolledOut(triggerRef, open, onClose)`: when `open && virtualized`, observe the trigger
  element with an `IntersectionObserver` (viewport root, threshold 0 -- the SAME pattern as the page-owned picker) and call
  `onClose` on `!isIntersecting`. No-op in classic or while closed. Closing DISCARDS any unsaved draft (owner-accepted).
- Wired into the three ghosting in-row popovers via a `ref` on each trigger button (Radix `asChild`/Slot composes the ref
  -- no trigger-behaviour change): **RemarkCell** (`onClose=()=>onOpenChange(false)`, clears the grid-level
  `openRemarkExcelRow`), **ColorPicker** (`setOpen(false)`), **ReconcileBadge** (`setOpen(false)`).
- The existing grid-level `shouldCloseOverlay` mounted-set effect is KEPT as the remark **backstop** (unchanged).

**In-row popover survey (all four):** RemarkCell (grid-level state) -> **ghosted, FIXED**. ColorPicker (local state,
per-cell) -> **could ghost, FIXED** (same hook). ReconcileBadge (local state, per-cell) -> **could ghost, FIXED** (same
hook). **AmountFormulaBuilder** -> **IMMUNE, no change** -- it renders in the STICKY `<th>` header (`sticky top-0`), which
never scrolls off vertically, so it cannot become an overscan-zone ghost.

**Invariant correction (supersedes the V2 wording "in-row popovers close on unmount"):** an in-row Radix popover in a
VIRTUALIZED grid must close on VISIBILITY loss (IntersectionObserver on the trigger), NOT rely on unmount -- the overscan
zone keeps the row mounted while off-screen, so unmount-only leaves a collision-pinned ghost. Unmount is the last-resort
backstop, not the primary close.

**Gates:** wizard-scoped `tsc` **0** (changed files); vitest **507 -> 507** (DOM/IntersectionObserver behaviour, no new
pure logic -- the live check is the behavioural gate; all 143 PricingGrid tests green + UNMODIFIED); `yarn build` OK.
Classic path byte-identical (the close is VIRTUALIZED-gated); V0 memo shield intact (context, not a row prop);
FIX-2 measure path + V2's search-jump/nav/picker-close/durable-re-key untouched. Scope: `PricingGrid.tsx` ONLY (+ docs).

**Live check (Chrome DevTools MCP, PUNE ELECTRICAL BOQ = BOQ-26-00003 / BQSH-26-00258, 870 rows, Fast render ON; destaled:
Vite restart + SW unregister). See the V2-FIX report for the observed numbers per popover.**

**Gates:** wizard-scoped `tsc` 0 (app-wide pre-existing tsc noise is standing, none in the changed files); vitest **501** (unchanged -- the change is DOM-measurement, not pure logic, so no new unit test; the live numeric gate is the behavioral acceptance test); `yarn build` OK. Classic path byte-identical (toggle OFF); unfrozen-virtualized unaffected; 143 PricingGrid tests green + UNMODIFIED. Scope: `PricingGrid.tsx` ONLY (+ docs). Env: same Vite-restart + SW-unregister dance as V1-FIX (Docker-Windows bind mount, no HMR).

---

