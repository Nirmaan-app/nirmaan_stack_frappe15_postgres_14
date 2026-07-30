<!-- Recovered 2026-07-30 from frontend/.claude/plans/boq/archive/boq-upload-plan-pre-split.md.
     This record shipped in PR #1133 (2bd6032f) but was never
     distributed into the rotated plan tree: the rotation was
     computed from a 1,286,655 B plan doc and the rebase archived
     develop's 1,352,991 B version. Verbatim copy, write-once. -->

## Build slice RM-3b (embedded panel-as-default + sticky full-screen header + always-visible H-scrollbars) COMPLETE

Micro-slice: four owner UX requests post RM-3a. FRONTEND-ONLY, layout/CSS. Branch
`feature/boq-pricing-helper`. feat `3d6877f6` + docs (this entry). No data/prop-shape change (no new
per-row prop, `pricingRowPropsAreEqual` untouched, the virtualizer math untouched -- only its containers'
styling changed). Files in scope: `SheetPricingPage.tsx`, `RateHelperPanel.tsx`, `PricingGrid.tsx`
(render/layout only).

### Phase-0 scroll-container map (verified live BEFORE editing)
- **Embedded, single-pane:** ONE `div.rounded-md.border.overflow-auto.max-h-[calc(100vh-14rem)]`
  (`containerRef`) owns BOTH X and Y scroll; each `<th>` is already `sticky top-0 z-20`. Its bottom (with
  the native H-scrollbar) sat ~1378px down -- BELOW the fold once the ribbons push it down (item 2's bug).
- **Full-screen:** the grid container is `flex-1 min-h-0 overflow-auto` BUT the two RM-3a panel-row wrappers
  between it and the grid slot were EMPTY-class plain blocks (inert when `expanded`), BREAKING the flex chain
  -> the container took full content height (h ~21267, unbounded) and the OUTER `.fixed.inset-0` wrapper
  scrolled instead, so the sticky header scrolled away and the H-scrollbar was off-screen (items 3+4's bug).
- **Frozen two-pane:** `frozenPaneRef` (`overflow-hidden`, vertical scroll DRIVEN via `onScroll` mirror) +
  `scrollPaneRef` (`overflow-auto flex-1`, owns X and Y); both `<thead>`s `sticky top-0`.

### Item 1 -- EMBEDDED panel-as-default
`RateHelperPanel` props `excelRow/col/kind/ctx` are now OPTIONAL; absent => an empty-state card ("Click a
suggestion badge or the sparkle on a rate cell to load that row"); the close X renders ONLY for
`variant="overlay"` (full-screen). `SheetPricingPage` derives `embeddedPanel = RATE_HELPER_ENABLED &&
!expanded`: when true the page wrapper is PERMANENTLY `w-full` (widen-while-open becomes the permanent
embedded layout), the flex row + grid-shrink wrappers are always on, and the embedded panel is ALWAYS
mounted (selection passed only once `helperPanelOpen`). Badge/sparkle click = SELECT (unchanged
`handleSuggestionBadgeClick` -> `helperPanel` page state); the panel replaces the previous row. Prod
(feature off) keeps the centered `max-w-5xl` cap and no panel.

### Items 3+4 -- FULL-SCREEN sticky header + native bottom H-scrollbar (ONE fix)
The two panel-row wrappers now carry `expanded && "flex min-h-0 flex-1 flex-col"` (standard classes), so the
flex column REACHES the grid container -> it BOUNDS to the viewport and becomes the internal Y scroller. The
already-present `sticky top-0` header then stays put, and the native H-scrollbar sits at the container bottom
= the viewport bottom. Proven live: single-pane (header stuck at 336 after scrollTop 4000, container bottom
1034 = viewport bottom, outer wrapper no longer scrolls) AND frozen split (both panes' headers pixel-aligned
at 336). Works classic + virtualized (the fix is purely the flex chain).

### Item 2 -- EMBEDDED always-visible H-scrollbar (mechanism: SYNCED PROXY BAR)
A thin `sticky bottom-0 z-30 overflow-x-auto` bar (`hScrollProxyRef`) rendered as a SIBLING of the scroll
container (so it is not clipped by the pane overflow and it pins to the bottom of the visible grid area /
viewport while the grid is on screen). Its inner spacer width = the X-scroller's content width
(`twoPane ? scrollPaneTableWidth : totalWidth`), so its thumb range tracks the real scroll. A `useEffect`
does the two-way `scrollLeft` sync with the active X-scroller (`scrollPaneRef` when split, else
`containerRef`), a re-entrancy latch stops ping-pong. Rendered ONLY embedded (`!expanded`); full-screen uses
the native bounded-container scrollbar (items 3+4). **Same mechanism FAMILY as item 4 (a viewport-pinned
H-scrollbar reflecting the REAL scroll), realized per-mode:** native via the bounded container in
full-screen; proxy in embedded (where the grid stays in page flow, so a bounded region would fight the
layout). Known cosmetic edge: the proxy's clientWidth exceeds the scroller's by the vertical scrollbar
width (~15px), so at max scroll the thumb stops ~15px short -- functionally complete (drag = exact).

### Gates
Full `boq-wizard` vitest **788 pass** (zero regressions; layout/CSS -- no pure module changed, so no new
tests). tsc **3240 baseline, 0 new** (none in scope). vite build exit 0.

### Cert (CC-driven browser, live on BOQ-26-00106 / ELECTRICAL BOQ, run BRSR-26-00007)
Required a vite restart + browser de-stale first (the dev server served a STALE bundle again -- caught by the
E4 bundle marker before any cert claim). Session admins@nirmaan.app.
- **V1 embedded default:** panel present with NO click (empty-state card, no close X), page widened; row-77
  badge -> "Row 77 (middot) Combined rate", row-83 badge -> REPLACES to "Row 83 (middot) Combined rate";
  panel persists, no close X throughout.
- **V2 embedded scrollbar:** the proxy (spacer 2180 = table width) pins at viewport bottom (~1034); driving
  it scrolls the grid (proxy->grid exact); grid->proxy exact except the ~15px clamp near max. Frozen ON:
  spacer 1564 = scrolling-pane width, driving it scrolls ONLY the scrolling pane (frozen pane X unchanged).
- **V3 full-screen sticky header:** header stuck + visible at 336 after scrollTop 4000/5000 in BOTH classic
  and virtualized; frozen split -> both panes' headers aligned at 336 (numeric gate). Verified via
  computed `th.top === container.top`.
- **V4 full-screen scrollbar:** native H-scrollbar at the wrapper bottom (container bottom 1034 = viewport
  bottom), visible WITH the overlay drawer open.
- **V5 no regressions:** overlay drawer still byte-preserves grid width (table 2180 / pane 2091 identical
  open vs closed); rate cell type+revert works (row 59 1800 -> draft 18007 -> reverted 1800) with ZERO DB
  writes; memo shield -- PricingGrid diff is +59/-0 touching NONE of `pricingRowPropsAreEqual` /
  `PricingGridRowProps` / `rowSuggestions` / row prev./next.
- **V6:** git clean apart from standing noise; ZERO rate/pricing/colour writes (BoQ Cell Pricing 311=311,
  BoQ Rate Suggestion Event 2=2, is_current colours 0). Only console error is the known `{{ boot }}` dev
  artifact.

### Files
MODIFIED: `frontend/.../rate-helper/RateHelperPanel.tsx`, `frontend/.../PricingGrid.tsx`,
`frontend/.../SheetPricingPage.tsx`. Docs: this entry + `frontend/CLAUDE.md` (rate-helper invariant
amendment). Out of scope (untouched): all backend, the interpreter, the registry, run/persistence,
patches.txt, `.claude/settings.local.json`.
