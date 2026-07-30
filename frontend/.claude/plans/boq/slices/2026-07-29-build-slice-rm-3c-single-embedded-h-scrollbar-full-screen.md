<!-- Recovered 2026-07-30 from frontend/.claude/plans/boq/archive/boq-upload-plan-pre-split.md.
     This record shipped in PR #1133 (2bd6032f) but was never
     distributed into the rotated plan tree: the rotation was
     computed from a 1,286,655 B plan doc and the rebase archived
     develop's 1,352,991 B version. Verbatim copy, write-once. -->

## Build slice RM-3c (single embedded H-scrollbar + full-screen push panel with resize + collapsible top block) COMPLETE

Micro-slice: three items from the owner's live use of RM-3b (Item C added mid-slice). FRONTEND-ONLY,
layout/CSS. Branch `feature/boq-pricing-helper`. feat `c2718a82` + docs (this entry). NO per-row prop /
comparator / virtualizer-math change.

### Phase-0 (verified live)
- Embedded proxy (RM-3b): sticky proxy synced to the active X-scroller; the container KEPT `overflow-auto`
  so its native H-bar still rendered (below-fold at 1207 > viewport 987 -> the two-bars symptom on scroll).
  Clamp: proxy clientWidth 1458 vs container clientWidth 1448 (the ~10-15px vertical-scrollbar leak) ->
  proxyMax 722 vs containerMax 732. Frozen spacer was the COMPUTED `scrollPaneTableWidth`.
- Full-screen overlay (RM-3a/b): `fixed right:0 z-60 w-320`, floats above the grid; the flex chain bounds
  the grid scroller. Push restructure verified live (flex-row `#4` + a fixed-width sibling still bounds the
  grid + keeps the sticky header + narrows the grid).

### Item A -- embedded ONE horizontal scrollbar, full extent
`PricingGrid`: (1) the single-pane container + the frozen scrolling pane get `boq-embed-hidehbar` when
`!expanded`; a scoped `<style>` (rendered with the proxy, in-scope -- NOT `index.css`) does
`.boq-embed-hidehbar::-webkit-scrollbar:horizontal{display:none;height:0}` -- hides ONLY the native H-bar,
keeps the V-bar + `overflow-x:auto` (so wheel/trackpad/keyboard/proxy X-scroll all stay). **Cross-browser
shape:** blink/webkit clean; Firefox has no per-axis scrollbar control so it keeps a below-fold native H-bar,
with the proxy as the primary bar. (2) The proxy width + spacer are now LIVE-MEASURED from the active
scroller via a ResizeObserver (`hScrollMetrics = {clientWidth, scrollWidth}`, observing the scroller + its
table) instead of the one-shot column-width sum: proxy width = scroller.clientWidth (kills the V-bar clamp),
spacer = scroller.scrollWidth (kills the frozen short-scroll). Cert: single-pane proxyMax 732 == containerMax
732 (exact); frozen spacer 1565 == real scrollWidth, proxyMax 733 == scrollPaneMax 733, frozen pane X
unaffected; native H-bar gap 0 (suppressed). Grid-level state -- guarded no-op setState, no per-row prop.

### Item B -- full-screen PUSH panel with resize
`RateHelperPanel` variant renamed `overlay` -> `push`: an IN-FLOW panel (`relative shrink-0 min-h-0 border-l`
+ `style width`) rendered INSIDE the full-screen flex row (`SheetPricingPage`: `#4` is now a flex ROW
[ grid column | push panel ], `#3` the grid COLUMN `min-w-0 flex-1 flex-col`). The grid narrows by exactly
the panel width (cert: 2091 -> 1791, delta 300); the bounded scroller / sticky header / native H-bar keep
working at the reduced width. A left-edge drag HANDLE (`role="separator"`, focusable) resizes live -- clamp
`[280, floor(50% of the wrapper)]`, double-click resets to the **DEFAULT 300px** (meaningfully below the
RM-3a 320 drawer), Arrow-Left/Right nudge by 16, width persisted to **`nirmaan-rate-helper-panel-w`**. Cert:
drag wider, clamps at max 1050 (50%) and min 280, Arrow nudge, double-click -> 300, reload restores 420.
Push keeps its close X; embedded (panel-as-default) is untouched.

### Item C -- full-screen collapsible TOP BLOCK
`SheetPricingPage`: everything above the grid (title row + both ribbons + banners + summary/review panels)
is wrapped in ONE `space-y-4` block that gets `hidden` when `expanded && topCollapsed` -> the grid-slot
(flex-1) fills vertically (cert: grid container height 657 -> 956, +299). A "Collapse toolbars" chevron
(inside the block, top) collapses it; a SLIM RAIL (`expanded && topCollapsed`) re-expands in one click and
shows the truncated sheet name + a compact **banner indicator** -- one amber chip per active blocking/visible
banner (locked / taken-over / frozen / formulas-incomplete / `N without category [(override)]`). **Rendering
choice:** the category chip surfaces whenever the category banner is VISIBLE (blanks present), in its blocking
OR override-informational form, so collapsing never hides the fact (cert on this override sheet: "316 without
category (override)"). **Escape re-expands first** (a second Escape then exits full-screen -- the user is
never trapped). Persisted to **`nirmaan-fullscreen-top-collapsed`**. Keyboard-focusable toggles. **Embedded
is untouched** (`topCollapsed` only bites while `expanded`; no rail, no toggle -- cert-verified).

### Gates
`boq-wizard` vitest **788 pass** (zero regressions; layout/CSS, no pure module changed). tsc **3240 baseline,
0 new** (none in scope). vite build exit 0.

### Cert (live on BOQ-26-00106 / ELECTRICAL BOQ, run BRSR-26-00007) -- V1-V7 PASS
V1 embedded ONE bar (native H-bar gap 0, overflow-x auto retained). V2 full extent single (732==732 exact)
+ frozen (spacer 1565 == scrollWidth, 733==733, frozen pane unaffected). V3 push narrows grid by exactly the
panel width (2091->1791), sticky header + native bar work at reduced width. V4 resize: drag, clamps at
280/1050, Arrow nudge, double-click->300, reload restores 420. V5 no regressions: embedded panel-as-default
intact (sticky, no close X, no handle), RM-3a groups render, type+revert (124->1247->124) zero-write, memo
shield PricingGrid diff +51/-16 touches none of `pricingRowPropsAreEqual`/`PricingGridRowProps`/`rowSuggestions`.
V6 git clean + ZERO rate/pricing/colour writes (Cell Pricing 311=311, Rate Suggestion Event 2=2, colours 0).
V7 collapse: grid +299, header+H-bar+push+resize hold, slim rail + "316 without category (override)" chip,
Escape re-expands, persists across reload, embedded unaffected. (One implementation gap found mid-cert -- the
override-banner chip -- fixed + gates re-run before commit; one stale-bundle detour caught by the E4 marker.)

### Files
MODIFIED: `frontend/.../rate-helper/RateHelperPanel.tsx`, `frontend/.../PricingGrid.tsx`,
`frontend/.../SheetPricingPage.tsx`. Docs: this entry + `frontend/CLAUDE.md` (rate-helper invariant
amendment). Out of scope (untouched): all backend, the interpreter, the registry, run/persistence,
patches.txt, `.claude/settings.local.json`.
