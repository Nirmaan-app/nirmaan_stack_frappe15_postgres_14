<!-- Recovered 2026-07-30 from frontend/.claude/plans/boq/archive/boq-upload-plan-pre-split.md.
     This record shipped in PR #1133 (2bd6032f) but was never
     distributed into the rotated plan tree: the rotation was
     computed from a 1,286,655 B plan doc and the rebase archived
     develop's 1,352,991 B version. Verbatim copy, write-once. -->

## Build slice RM-3a (panel overlay/sticky mount + hover-only colour icon + grouped workings) COMPLETE

Micro-slice: three owner-reported items from the RM-3 exit cert (which MET its criterion -- zero
silently-wrong). FRONTEND-ONLY. Branch `feature/boq-pricing-helper`. feat `ad81e006` + docs (this entry).
No backend / interpreter / registry / persistence changes. Files in scope only: `SheetPricingPage.tsx`,
`RateHelperPanel.tsx`, `PricingGrid.tsx` (cell-strip render), `rateHelperTypes.ts`, `pricingSheetHelper.ts`
(+ its vitest).

### Defect 1 -- the panel (owner: "this does not work") -> TWO-MODE mount
The single page-level flex-row mount (grid `min-w-0 flex-1` + panel `w-80`) SHRANK the grid whenever the
panel opened. Replaced with a `variant` prop on `RateHelperPanel` and a per-mode mount in `SheetPricingPage`:
- **FULL-SCREEN (`expanded`) -> `variant="overlay"`:** the panel is a VIEWPORT-FIXED drawer
  (`fixed inset-y-0 right-0 z-[60]`, above the `z-50` full-screen wrapper, `shadow-2xl`), rendered OUTSIDE
  the flex row. The grid keeps FULL width -> its width/columns/horizontal-scroll are BYTE-UNCHANGED on
  open/close. The flex-row + grid-shrink wrappers are now gated `helperPanelOpen && !expanded`.
- **EMBEDDED (default) -> `variant="embedded"`:** the panel stays IN the flex row (keeps the certed
  widen-while-open: the outer wrapper still flips `max-w-5xl` -> `w-full`), now `sticky top-4
  max-h-[calc(100vh-2rem)]` so it rides the viewport as the page scrolls (body `min-h-0` so it scrolls
  internally).
- **Scroll-into-view GUARD (1c):** a `useEffect([excelRow, col])` in the panel calls `scrollIntoView`
  ONLY when the panel is genuinely off-screen (`rect.bottom<=0 || rect.top>=innerHeight`) -- a sticky panel
  already pinned at the viewport top no-ops (never yanks the user off the clicked row, e.g. the owner's
  row-83 case), and the fixed overlay is always visible. Never touches horizontal scroll.

### Defect 2 -- cell-strip declutter (owner option (a))
The `ColorPicker` trigger (top-left of every descriptor cell) was persistent `opacity-40`; now
`opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100` -- hidden
at rest, revealed on CELL hover (the 3 descriptor `<td>`s that host `colorPicker` gained `group`) AND on
keyboard focus (no mouse-only trap). The priced dot + suggestion badge/used-check + sparkle opener stay
PERSISTENT; the right strip tightened `gap-1` -> `gap-0.5`. Colour-selection LOGIC unchanged (CSS-only +
the `group` markers).

### Defect 3 -- grouped workings (owner: cable vs termination visually distinct)
`WorkingsSection` gains an optional `sections?: WorkingsGroup[]` (`{label, derivation, finals, matchedRows?,
attributes?}`), rendered GENERICALLY by the panel (guardrail G3, no category-specific panel code): each group
is its own bordered block (header + own derivation + own final values); the SHARED extracted attributes
render ONCE above the groups. **ABSENT `sections` => flat rendering, byte-identical to pre-RM-3a**, so a
single-group suggestion stays backward-shaped. `pricingSheetHelper` emits two groups on a CABLE row
("Cable -- per Mtr" cable pipeline finals; "Termination -- per Set" paired termination finals) and NO
`sections` (flat) on a termination row -- the paired-termination reference line moved OUT of the flat
`derivation` into its own group. Groups are DISPLAY-ONLY; the applied value still comes from
`Suggestion.values`.

### Memo shield
Untouched by construction: NO new per-row `PricingGrid` prop, `pricingRowPropsAreEqual` unchanged; the panel
is a page sibling, not a grid prop; the cell-strip edits are render-only. `PricingGrid.test.ts` (162) passes
unmodified.

### Gates
Rate-helper vitest **24 -> 26** (`pricingSheetHelper` 10 -> 12: +2 grouped-workings tests -- cable=two
labelled groups with own finals + shared attrs once; termination=single flat group, no `sections`; the
existing cable test's flat "Paired termination" assertion re-pointed to the termination SECTION). Full
`boq-wizard` suite **788 pass**. tsc **3240 baseline, 0 new** (none in scope files). vite build exit 0.

### Cert (CC-driven browser, live on BOQ-26-00106 / ELECTRICAL BOQ, run BRSR-26-00007)
DOM-assertion + screenshot cert (badges auto-load, no press). Required a vite restart + browser de-stale
first (the dev server was serving a STALE bundle -- the served module carried none of the new tokens; caught
by the E4 overlay-in-full-screen bundle marker before any cert claim). Session admins@nirmaan.app.
- **V1 (full-screen overlay):** row-83 badge -> panel `position:fixed right:0 top:0 z-index:60`, full
  viewport height, pinned right, fully visible; grid pane `clientWidth` 2091 UNCHANGED (vs the stale bundle
  which shrank it to 1759), table 2180 / Description 280 / Quantity 112 / scrollLeft 0 all identical. Close
  -> grid byte-identical.
- **V2 (embedded):** scrolled deep to rows 75-85, row-83 badge -> wrapper widened `max-w-5xl` (1024) ->
  `w-full` (1822); panel `position:sticky top:16px`, fully visible in viewport. Close -> cap restored (1024).
- **V3 (strip):** colour icon `opacity:0` at rest; real pointer hover on the row-60 C cell -> ONLY that
  cell's trigger `opacity:1` (all 230 others stay 0); keyboard focus (`:focus`) -> `opacity:1`. Colour
  pick+revert end-to-end on row-60/C: applied green (`BCLR-26-02560` is_current=1) then cleared
  (is_current=0, sheet effective colours back to 0 = as-found; superseded row retained per
  freeze-and-supersede).
- **V3b (groups):** row-83 cable panel rendered "Cable -- per Mtr" (supply_per_mtr 1290, install_per_mtr 40,
  combined 1330) and "Termination -- per Set" (supply_per_set 100, install_per_set 30) as two distinct
  bordered blocks, shared attributes (Material/Insulation/Core/Thickness) once above (each group label count
  == 1).
- **V4 (frozen split ON):** 2-pane split active; V1 overlay (fixed, pinned, scrolling-pane unchanged) + V3b
  groups both hold.
- **V5 (memo shield):** no new grid prop / comparator change; clean console apart from the known index.html
  `{{ boot }}` dev SyntaxError.
- **V6:** git clean apart from standing noise; colour reverted; ZERO rate/pricing writes (BoQ Cell Pricing
  311=311, BoQ Rate Suggestion Event 2=2).

### Files
MODIFIED: `frontend/.../rate-helper/{rateHelperTypes.ts, pricingSheetHelper.ts(+.test.ts), RateHelperPanel.tsx}`,
`frontend/.../PricingGrid.tsx`, `frontend/.../SheetPricingPage.tsx`. Docs: this entry +
`frontend/CLAUDE.md` (rate-helper invariant amendment). Out of scope (untouched): all backend, the RM-2
interpreter, the registry mechanism, run/persistence, patches.txt, `.claude/settings.local.json`.
