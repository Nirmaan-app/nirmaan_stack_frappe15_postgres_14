### Editor toolbar two-ribbon reorg (FRONTEND, presentational, move-only, NO migrate, base tip cbf6bb49, 2026-06-25)

**The pricing-editor sheet screen (`SheetPricingPage.tsx`) had ALL toolbar controls in ONE crowded row.** Reorganized into
TWO ribbons sandwiching the existing sheet-tab strip. **PURE MOVE -- zero behavior change:** every control keeps its exact
`onClick` / state / disabled gate / panel interaction; only its on-screen position changed. (The single file touched.)

- **TOP RIBBON (above the tabs):** Back | title | Full screen | Summary | Review (N) | Price any row | Save now | (ml-auto
  right) status text = the save-status chip + the priced-count readout. The status text MOVED from before the action buttons
  to the ribbon's right end (wrapped in a new `ml-auto` div -- the only structural add). Status + Summary/Review/Price-any-row/
  Save-now stay inside the EXISTING `{!isGridOnly}` gate (a grid-only sheet still shows only Back/title/Full screen, unchanged).
- **BOTTOM RIBBON (below the tabs):** Show unpriced | Search group (input + clear-X + N-of-M counter + prev/next arrows) |
  Columns popover | Show: Spacers/Notes/Subtotals. The WHOLE bottom ribbon is wrapped in the SAME `{!isGridOnly}` gate that
  held these controls before -> a grid-only general-specs sheet renders **NO bottom ribbon** (nothing to filter/search),
  preserving current behavior exactly.
- **The sheet-tab strip (`<Tabs>`) is UNCHANGED** and now sits BETWEEN the two ribbons (it was already a sibling below the
  old toolbar; the bottom ribbon moved to after it).
- **Coupled groups kept intact** as single JSX subtrees (recon-confirmed all backing state is local `useState`, so a moved
  subtree keeps working): the Search group (shares `searchQuery`/`searchHits`/`safeSearchIdx`/`stepSearch`), the Columns
  popover (trigger + content), the Show toggles.
- **Summary/Review kept PLAIN** -- no pressed/active state added (they had none; adding it would be a behavior change).
  **NO Lock/unlock-edits button** -- that is a SEPARATE upcoming slice (the top ribbon will gain it later).

tsc 3175 (0 new), vitest 307 (unchanged -- `PricingToolbar.test.ts` is pure-helper-only, passes identically). NO backend /
schema / migrate / panel-body / handler change. The two-ribbon visual + the grid-only-hides-bottom-ribbon behavior are
OWNER-CERTIFIED LIVE (not unit-provable headless).

