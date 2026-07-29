### Collapse/expand ALL -- bottom-ribbon bulk toggle (FRONTEND, view-layer, NO migrate, base tip 8f610710, 2026-06-26)

**Slice 1 shipped per-parent collapse; this adds ONE state-aware toggle in the bottom grid-controls ribbon that folds or
unfolds the WHOLE sheet's hierarchy at once.** It reuses the slice-1 engine entirely -- NO new state, NO new context, NO
memo touch, NO backend. Files: `collapse.ts` (+ one tiny pure helper + tests), `SheetPricingPage.tsx` (the button + a
one-line handler).

- **OPTION A (owner-locked) -- collapse-all = EVERY collapsible parent.** "Collapse all" does
  `setCollapsed(collapsibleParents(childrenByParent))`, where the NEW pure one-liner
  `collapsibleParents(map) = new Set(map.keys())` is exactly the set of every row that has >=1 child (the inverse-map
  keys). On the depth-3 145 Electrical sheet that folds all 19 parents -> only top-level roots remain, each showing its
  existing chevron + "+N hidden". NOT the shallowest-tier model (that is SummaryPanel's *default view*, a separate thing).
- **size===0 toggle rule (owner-locked).** ONE button; label + action key off `collapsed.size === 0`: size 0 ->
  "Collapse all" (`ChevronsDownUp`) -> collapse every parent; size > 0 -> "Expand all" (`ChevronsUpDown`) ->
  `setCollapsed(new Set())`. A PARTIALLY hand-collapsed sheet (some parents folded via slice-1 chevrons) therefore reads
  "Expand all" -- the button's job in any non-fully-expanded state is to return the sheet to clean (SummaryPanel's proven
  rule, `:126-128`).
- **Placement + gate.** The button sits INSIDE the existing `{!isGridOnly}` bottom-ribbon flex container, immediately
  AFTER the Show-unpriced button, styled to match (`size="sm" variant="outline" className="gap-1.5"` + icon + label). It
  inherits `{!isGridOnly}` BY CONSTRUCTION -> absent on grid-only general-specs sheets (no extra guard).
- **Flat-sheet treatment.** DISABLED when `childrenByParent.size === 0` (a flat sheet, e.g. 145 Fire Fitting -- nothing
  to fold), with a "no hierarchy to collapse" title (mirrors slice-1's "no chevrons" treatment). Single-child parents ARE
  included in collapse-all (they are collapsible parents).
- **Composition (unchanged from slice 1).** Bulk collapse writes the SAME page `collapsed` set the per-parent chevrons
  read via `CollapseContext`, so the chevrons + "+N hidden" reflect it with ZERO new wiring (no memo prop). It composes
  into the existing `displayRows` filter -> VIEW-ONLY (the priced count over `rows`, `SummaryPanel` `rows={rows}`, and the
  flag feed read UNFILTERED rows, so bulk collapse moves NO total). "Expand all" hides nothing -> does NOT route through
  reveal-then-scroll. Independent of full-screen `expanded` / column-resize / column-hide. The per-sheet reset effect
  (`setCollapsed(new Set())` on tab switch) is undisturbed -> a switched-to sheet starts fully expanded + the button reads
  "Collapse all".

**Tests:** vitest 320 -> 323 (+3 `collapse.test.ts`: `collapsibleParents` = every parent / flat-sheet empty /
single-child included). tsc 3175 (0 new, 0 in touched files). in-container Vite build exit 0. No backend (test_pricing
UNTOUCHED). OWNER live-cert pending: LC1 Collapse-all on 145 Electrical -> only roots, each "+N hidden"; LC2 button flips
to "Expand all" -> one click restores; LC3 partial hand-collapse -> button reads "Expand all" -> clears all; LC4 flat
sheet -> button disabled; LC5 grid-only sheet -> button absent; LC6 counts/Summary unmoved by bulk collapse; LC7 tab
switch starts expanded with "Collapse all".

