### Slice 4c full-screen editor (FRONTEND, layout/presentational, NO migrate, base tip cca150b0, 2026-06-24)

**Goal.** A full-screen / maximize mode for the dense pricing editor: a "Full screen" toggle grows the editor to fill the
viewport (more rows/columns visible); "Exit full screen" / Esc collapses back. Pure FRONTEND, layout-only -- NO data
model, NO endpoint, NO change to pricing / gate / badge / flag / lock / rollup LOGIC. Built on the read-only recon
(Checklist-B PASS) whose findings are the spec.

**Files (3 source + 1 test).** `SheetPricingPage.tsx` (the toggle, state, Esc effect, root-class swap, grid slot),
`PricingGrid.tsx` (the `expanded` prop relaxing the container cap + the pure `shouldExitFullscreenOnEsc` helper),
`SheetDataGrid.tsx` (the same `expanded` cap-relax for the grid-only read-only fork), `PricingGrid.test.ts` (+4 tests).

**APPROACH -- in-app maximize (recon Q2 (a)).** The page root `<div>` className flips between EMBEDDED
(`flex-1 space-y-4 max-w-5xl mx-auto pt-6 pb-10 px-4`, byte-for-byte the prior layout) and FULL
(`fixed inset-0 z-50 flex flex-col space-y-4 overflow-auto bg-background p-4`) via `cn(expanded ? FULL : EMBEDDED)`. FULL
covers the app shell exactly like the house Dialog/Sheet overlay (`fixed inset-0 z-50`). **NOT** the native Fullscreen API
(the codebase never uses it; it hides browser chrome + fights our Esc), **NOT** a Dialog / Sheet / `createPortal` (they
remount the subtree -- see below).

**THE LOAD-BEARING NO-REMOUNT RULE (recon Q3).** The grid holds un-persisted state -- `draftRates` (typed-but-unsaved
rates), `proposedRates`, `activeCell` (cursor), per-cell debouncer timers, `openRemarkRowIdx`, the imperative `gridRef`
(used by the review strip's `scrollToRow`) -- plus page state (the single-editor lock / `takenOver`, `override`,
`showOnlyUnpriced`, `reviewOpen`, `lastSavedAt`). The grid is `key={sheetName}` and FLUSHES drafts on unmount. So the
implementation toggles ONLY the root wrapper's className: **ONE JSX tree, same children, same positions, same PricingGrid
key**. React reconciles the same element in place -> expand/collapse NEVER remounts the grid -> ALL of that state
survives. A Dialog / Sheet / portal / a second return-branch with a different child tree would remount and DROP unsaved
rates + re-fire the unmount-flush + lose the cursor -- explicitly avoided.

**Grid height (recon Q4).** FULL root is `flex flex-col`; the grid SLOT (a wrapper `<div className={cn(expanded &&
"flex min-h-0 flex-1 flex-col")}>` around the render fork) takes `flex-1 min-h-0`; each grid's OUTER scroll container
relaxes its `max-h-[calc(100vh-14rem)]` cap to `flex-1 min-h-0` when `expanded` (new `expanded?: boolean` prop, default
false, on BOTH `PricingGrid` and `SheetDataGrid`). The grids' sticky header (`sticky top-0 z-20`) + horizontal
`overflow-auto` are scroll-container-relative -- they carry into full-screen unchanged; NO grid scroll/sticky internals
were touched. **`expanded` is a per-GRID prop, NOT a per-row prop** -- it never enters `PricingGridRowProps` /
`pricingRowPropsAreEqual` / the row render, so the perf memo is intact (display-only).

**Esc handling (recon Q5).** A `window` keydown listener mounted ONLY while `expanded` (`useEffect([expanded])`, removed
on collapse/unmount) calls the pure `shouldExitFullscreenOnEsc(e, document.activeElement)` (exported from `PricingGrid.tsx`
alongside `deriveSaveStatus`/`isGridOnlySheet`/`isTakeoverError`/`orderCommittedSheets` -- the established home for
page-level pure helpers, sdk/router-free so it is unit-testable in `PricingGrid.test.ts`; the page already imports several
helpers from there). It returns true ONLY for a bare `Escape` that is **not `e.defaultPrevented`** AND not while an
`<input>`/`<textarea>` is focused. **The popover-Esc resolution:** the RemarkCell + AmountFormulaBuilder Radix popovers
`preventDefault` THEIR Escape-dismiss, so `defaultPrevented` cleanly distinguishes "Esc closed a popover" (don't exit)
from "Esc should exit full-screen". DELIBERATELY a window listener (not the grid `<table>` -- it would miss Escs fired
while focus is in a portaled popover); the grid's own `handleGridKeyDown` / `nextCell` are UNTOUCHED.

**Toggle placement -- outside the `!isGridOnly` gate.** The right-cluster wrapper (`ml-auto shrink-0 flex ...`) now renders
unconditionally with the Maximize2/Minimize2 toggle always inside it; only the Save/Summary/Review/override/unpriced
buttons stay gated by `!isGridOnly` (wrapped in a fragment). So a read-only / grid-only / general-specs sheet can ALSO
maximize -- full-screen is orthogonal to editability and composes with the lock (a locked sheet stays read-only but is
expandable). Per-session; DELIBERATELY NOT reset on a tab switch (staying maximized across sheets is the useful
behaviour).

**Scope.** Layout-only: NO pricing/gate/badge/flag/lock/rollup logic, NO perf-memo change, NO endpoint, NO backend, NO
doctype, NO migrate, NO new fetch. Backwards-compat: embedded layout byte-for-byte unchanged when `expanded=false`;
expand is purely additive.

**Tests / build.** vitest 241->245 (PricingGrid 109->113: `shouldExitFullscreenOnEsc` -- Escape+non-input+not-prevented
exits; defaultPrevented -> no exit; input/textarea focus -> no exit; non-Escape key -> no exit). The className toggle /
overlay / state-survival / popover-Esc are inherently render/interaction behaviour and are covered by the live-cert (the
node/no-RTL env can't assert them). tsc 3175 (0 new; 0 in the 3 edited files), in-container Vite build exit 0
(`Done in 382s`, PWA 167 entries). NO root CLAUDE.md change (frontend-only slice).

**Manual live-cert (owner; three-BoQ 145/150/166, de-stale first):** LC1 Expand -> editor fills the viewport (covers
sidebar), Collapse/Esc -> back. LC2 (load-bearing) state survives: type an unsaved rate -> Expand -> still there; cursor
preserved; lock not re-acquired (no takeover flicker). LC3 Esc: popover open -> Esc closes the POPOVER, stays full-screen;
nothing open -> Esc exits; typing in a cell -> Esc does NOT exit. LC4 works on a read-only / grid-only sheet (Expand
available, fills screen). LC5 no-regression: in full-screen, rate save + amount compute + badges + banners + review strip
+ summary + scroll-to-row all work; Collapse -> still works embedded. LC6 perf intact (big sheets fast both modes).
Pending Nitesh.

