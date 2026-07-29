# BoQ Frontend — retired as-built log (HISTORICAL)

> QUARANTINED 2026-07-29. Two rolling 'latest frontend slice' narratives that accumulated inside the conventions doc, carrying test counts and commit hashes. This is per-slice as-built detail: it belongs in plans/boq/slices/, and much of it is likely already there. Retained pending a duplication check — do not load, do not extend.

> Split from `boq-frontend.md` (287KB) on 2026-07-29. Surfaces and pricing clusters defined by the owner.

## Contents

- Live status + per-slice as-built detail: see `boq-upload-plan.md`
- Live status + per-slice as-built detail: see `boq-upload-plan.md`

---

**Live status + per-slice as-built detail: see `boq-upload-plan.md`** (the `## Phase 5 Pricing Editor -- slice detail`,
`### Slice ...`, and `### Module 3 Slice ...` sections). The prepended per-slice status-block history was removed in the
docs-hygiene cleanup (git holds it). **Latest frontend change: Cluster B DOC-0 default flip** (2026-06-27) -- when the
committed document amount is ~0 (absent/blank on an unpriced BoQ) a divergent amount cell now uses the FORMULA value
silently (no badge / strip / chooser); ONE line in `reconcile.ts` `resolveDivergence` (returns `{diverges:false}` so all
three consumers fall through to the formula), non-zero divergences UNCHANGED, moves totals (intended), frontend-only; see the
"Cluster B amendment -- DOC-0" paragraph above. **Prior frontend slice: Frozen-left Slice 2 of 2** (COMPLETES the arc) -- manual
row-resize (drag a frozen row's bottom edge -> `clampRowHeight` floor 40px -> `manualRowHeights`, applied to both panes via
stable memo-safe handlers), sticky manual heights surviving unfreeze (Option A: two maps, applied = manual ?? captured),
column-resize-while-frozen AUTO re-measure of captured rows (flash-free layout-effect cycle, manual rows untouched -- the
Slice-1 limitation is now CLOSED), and the frozen-pane right-border fix (one `border-r` on the container; the table's clipped
edge border was the invisible-boundary cause). **Prior frontend slice: Frozen-left Slice 1 of 2** -- two-pane split (frozen anchors
pane + scrolling descriptors/Remarks pane, scroll-coupled) + measure-at-freeze row heights ("Fork A", `useLayoutEffect` ->
`rowHeights` keyed by `row.row_index`, applied as a per-row `rowHeight` scalar to both panes + Description wrap/clip) +
native `title` full-text tooltip; page-owned `frozen` toggle gated off for grid-only; unfrozen renders today's single table
byte-for-byte; vitest 339 (PricingGrid 129),
tsc 3175 (0 new), in-container build exit 0, 2026-06-27, see the Frozen-left Slice 1 paragraph above + plan §"Frozen-left
Slice 1". **Prior frontend slice:** Drop frozen-left, ship resize alone -- the frozen-left
(sticky-left) half of the bundle was structurally broken (cell-level multi-column sticky-left doesn't track horizontal
scroll: frozen cells paint in place, scrolling columns clip behind + don't reset on scroll-back; the border-separate flip
was wrong-axis + reverted; a two-pane fix fights resize's wrap-grow + doubles the row memo -- not worth it now), so the
sticky-left/`--fcol`/`frozenBg`/z-30-corner are REMOVED and the anchors are normal scrolling columns again; column resize
(table-fixed + colgroup + drag/autofit/clamp + wrap/truncate) + the VERTICAL sticky header + the row memo all RETAINED +
certed; frozen-left DEFERRED to a dedicated structural two-pane slice; vitest 303 (PricingGrid 129, unchanged), tsc 3175
(0 new), 2026-06-25, see the drop-frozen-left paragraph above + plan §"Drop frozen-left, ship resize alone".
Frozen-left anchors + column resize (the now-partly-superseded bundle) -- ONE structural
slice (`table-fixed` + `<colgroup>`) carrying TWO features: the 5 anchors through Description pinned sticky-left (z-30/z-20/
z-10 stack, opaque row-state bg, border-collapse kept) and every column drag-resizes session-only (header-edge handle,
double-click autofit, rate min-width clamp, headers truncate / body wraps+grows); the frozen LEFT offsets derived from the
LIVE colgroup widths via CSS vars on the table so a frozen resize stayed aligned (the bundling payoff); colgroup derives
from `visibleDescriptors`; width is GRID-LEVEL so the row memo is UNCHANGED; reviewRender untouched; SUPERSEDED the prior
"frozen-left + resize are independent" claim (Option B couples them) -- frozen-left then DROPPED (above); vitest 294->303,
tsc 3175 (0 new), 2026-06-25, see the frozen-left/resize paragraph above + plan §"Frozen-left + column-resize bundle". Parent-jump landing flash -- a jump now flashes the WHOLE
landed row blue for 3s then clears (grid-level `flashExcelRow` + timeout ref, resets on a new jump; derived per-row
`isJumpFlash` in `pricingRowPropsAreEqual` via the NEW pure `isJumpFlashRow`; blue wins over search-yellow for its 3s;
instant on/off = reduced-motion-safe; also flashes on the shared `scrollToRow` so review-strip/search jumps flash too);
vitest 291->294, tsc 3175 (0 new), 2026-06-25, see the parent-click-to-jump paragraph above + plan §"Parent click-to-jump".
Parent click-to-jump -- the pricing grid's Parent cell
(col 2) is now a clickable jump to the parent row via the existing `scrollToRow` (restores §13-3a, which 3a shipped
read-only); the button is col 2's roving nav target (no second tab stop), root rows keep the `<td>` nav target + render no
button, Enter jumps via a col-2 `handleGridKeyDown` special-case (Space/click fire the button natively), the NEW pure
`parentExcelRowOf` de-dups the resolution + the new `onJumpToRow` stable prop is in `pricingRowPropsAreEqual`; frozen-left +
column-resize stay a SEPARATE later bundled slice; vitest 287->291, tsc 3175 (0 new), 2026-06-25, see the parent-click-to-
jump paragraph above + plan §"Parent click-to-jump". Toolbar Part 1 -- FIVE view-layer pricing-editor toolbar
controls (description SEARCH with N-of-M + prev/next jumping via the grid's `scrollToRow` + a yellow current-hit-row
highlight whose per-row `isCurrentHit` boolean is the ONE row-memo touch; COLUMN-HIDE via a "Columns" popover that EXCLUDES
amount columns [locked] and re-indexes the nav over a `visibleDescriptors` set; and 3 ROW-TYPE filters [spacers/notes/
subtotals] keyed on `effective_classification`, AND-composed into the page-side `displayRows` pass, VIEW-ONLY so no count/
total moves); pure helpers in `PricingGrid.tsx` + the NEW `PricingToolbar.test.ts`; vitest 264->287, tsc 3175 (0 new),
2026-06-24, see the Toolbar-Part-1 paragraph above + plan §"Toolbar Part 1" (Part 2 layout rework deferred until after
Slice 5). Formula-vs-document reconciliation (Cluster B) -- a per-cell
"keep document / use formula" choice on a divergent amount cell (NEW pure leaf `reconcile.ts` with the SHARED `amountsEqual`
tolerance; document-DEFAULT [D1]; a STRONG violet `ReconcileBadge` cell cue + chooser, muted when resolved; a "divergence"
review-strip kind; the chosen value resolved ONCE in `pricingRollup.rowOwnAmount` [D4]; divergence fires only on
`cell.kind === "value"`); vitest 245->264, tsc 3175 (0 new), 2026-06-24, see the reconciliation paragraph above + plan
§"Cluster B". Full-screen / maximize editor (Slice 4c) -- a "Full
screen" toggle expands the pricing editor to a `fixed inset-0` full-viewport overlay (in-app maximize via a root
className toggle, NOT native Fullscreen, NOT a Dialog/portal); the NO-REMOUNT rule (one JSX tree -> grid drafts / cursor /
lock / all state survive expand/collapse), each grid's `expanded` prop relaxing its `max-h` cap to `flex-1 min-h-0`, Esc-
to-exit via a `defaultPrevented`-guarded window listener (`shouldExitFullscreenOnEsc`, so a popover-Esc doesn't exit), the
toggle rendered outside the `!isGridOnly` gate (works on read-only sheets too); display-only (perf memo intact); vitest
241->245 (PricingGrid 109->113), tsc 3175 (0 new), 2026-06-24, see the full-screen paragraph above + plan §"Slice 4c
full-screen editor". Amount-column formula-status badge -- a leading amber
(pending) / green (covered) `ƒ` badge that IS the `AmountFormulaBuilder` trigger (status + action merged; far-right
preview line removed -- the layout/visibility render-bug fix) + a pending amber `<th>` tint + the shared
`priceability.isAmountColumnCovered` predicate (`areFormulasComplete` folds over it -> badge⇔gate by construction);
display-only (header outside the row memo); read-only branch preserved; vitest 235->241, tsc 3175 (0 new), 2026-06-21;
see the formula-status-badge paragraph above + plan §"Amount-column formula-status badge". MANDATORY amount-formula gate -- amount formulas required
before any rate is editable (REVERSES "formula optional"); `priceability.areFormulasComplete` (per-COVERAGE via `pickFormula`,
wildcard-default covers per-area cols) -> a per-sheet `formulasComplete` boolean ANDed into the grid rate gate OUTSIDE
`isRateEditableRow` (override CANNOT bypass) + added to `pricingRowPropsAreEqual` (memo-safe) + a "Declare amount formulas to
enable rate entry." banner; `onSaveFormula`/declaration stays live under the gate; vitest 226->235 (priceability 30->36,
PricingGrid 106->109), tsc 3175 (0 new), 2026-06-24, see the gate paragraph above + plan §"Mandatory amount-formula gate";
Editor perf fix -- `PricingGrid` row-level memoization
(extract the `<tr>` into a `React.memo`'d `PricingGridRow` + `groupDraftsByRow` per-row draft slices [the anti-defeat rule]
+ `useMemo`'d grid derivations; the `activeColIndex` cursor lever; fixes the arrow-key/click lag on big sheets; NO
behaviour change; PricingGrid.test 83->94, suite 203->214, see the memoization-contract paragraph above + plan §"Editor
perf fix", 2026-06-24); Slice 4b-ACKNOWLEDGE -- the per-entry "reviewed / looks OK"
docs-hygiene cleanup (git holds it). **Latest frontend slices:** Fuzzy description search (2026-06-25) -- the
case-insensitive SUBSTRING search in BOTH `ReviewTree.tsx` (#159 find-&-filter) and `SheetSearchView.tsx` (row-finder +
RestructureModal parent-picker) replaced by the app-wide token-scoring matcher (`utils/tokenSearch`) via ONE shared helper
`boqDescriptionSearch.ts` (`fuzzyDescriptionMatchSet`); token AND, partial, min length 2; fuzzy = MEMBERSHIP only, hits
re-emitted in DOCUMENT order so prev/next still steps top-to-bottom. RestructureModal inherits (no change). See the "Fuzzy
description search" rule below. Prior: Detail-panel read views (2026-06-25) -- ADDITIVE
`ParentChain.tsx` (ancestor breadcrumb) + `ChildrenList.tsx` (direct children + `▸N`) mounted in the EXISTING review-screen
detail panel, clickable to drill-navigate; the ORIGINAL single-column panel design is unchanged (a two-column revamp was
prototyped then reverted -- only the two read views were kept). See the "Detail-panel read views" rule below. Prior:
Slice 4b-ACKNOWLEDGE -- the per-entry "reviewed / looks OK"
review-strip DISMISS (pure `priceability.ts` filter helpers + `SheetPricingPage` active/show-all feed + "Show dismissed"
toggle + per-entry Looks-OK/Restore action wired to `save_cell_dismissal`; `ReviewEntry` UNCHANGED; server-side re-arm,
priceability 27->30, 2026-06-23); Slice 4b-A computed-flag layer -- the shared
`priceability.ts` spine + the flags (needs_rate / qty_anomaly / broken / not_yet, broken/not_yet GATED behind the
priceability spine + not_yet DE-DUPED per-area against needs_rate [cert fixes]; `wont_compute` removed before push) +
in-grid markers + unified review strip + N/M
priced-count & unpriced filter + the incomplete-subtotal signal as ONE quiet `SummaryPanel` message (the per-subtotal STRIP
entries removed as noise) + rollup alignment
(`priceability.ts`/`PricingGrid`/`SheetPricingPage`/`pricingRollup`/`SummaryPanel`,
2026-06-23); Prepopulated-rate fix -- formula reads committed rates by
non-zero value, not just the priced marker (`PricingGrid.lookupOperandValue`, 2026-06-23); Summary formula-fix --
formula-aware rollup + grand-total row + reconciliation guard (`pricingRollup`/`SummaryPanel`, 2026-06-23).

(Completed-arc changelog + the C-values OWED note collapsed -- the full per-slice as-built history lives in
`boq-upload-plan.md` under the dedicated `### Slice ...` / `### Module 3 Slice ...` detail sections.)

**Live status + per-slice as-built detail: see `boq-upload-plan.md`** (the `## Phase 5 Pricing Editor -- slice detail`,
`### Slice ...`, and `### Module 3 Slice ...` sections). The prepended per-slice status-block history was removed in the
docs-hygiene cleanup (git holds it). **Latest frontend slices:** Deliberate lock/unlock (2026-06-26) -- a user-controlled,
persisted, cross-user, SERVER-ENFORCED per-sheet read-only lock (the pricing twin of the review "Finalized" freeze): rides
the existing `locked` choke point (`locked = editable===false || takenOver || isLocked`, the override can't bypass it,
`pricingRowPropsAreEqual` untouched), a top-ribbon teal `ShieldCheck` Lock/Unlock toggle [stays live when locked, distinct
icon from the override] -> `lock_sheet`/`unlock_sheet` + mutate, a teal banner that DOMINATES the amber concurrency banners,
override + Save-now disabled when locked; backend = `BoQ Sheet.is_locked` + `_guard_sheet_not_locked` in all six save_*
endpoints + the `get_priced_rows`/`get_committed_state` fold (root CLAUDE.md); test_pricing 151->158, vitest 323, tsc 3175
(0 new); see the lock/unlock rule above + plan §"Lock/unlock edits". Prior: Collapse/expand ALL (2026-06-26) -- a bottom-ribbon
state-aware toggle that folds/unfolds the WHOLE pricing-grid hierarchy (Option A = `collapsibleParents` = every parent;
`collapsed.size === 0` drives label "Collapse all"/"Expand all"; disabled on a flat sheet; reuses the slice-1 `collapsed`
set + engine, NO new state, memo + full-screen `expanded` untouched); vitest 320 -> 323, tsc 3175 (0 new), see the
collapse/expand-all rule above + plan §"Collapse/expand ALL". Prior: Hierarchy collapse/expand (2026-06-26) -- single-row
collapse in the pricing grid (click a parent chevron to fold its whole descendant subtree; NEW pure leaf `collapse.ts`;
page-owned `collapsed: Set<number>` composing the upstream `displayRows` filter [Option A]; `isHiddenByCollapse` mirrors
ReviewTree.isVisible; a `+N hidden` badge DERIVED live; search PIERCES collapse + reveal-then-scroll via `onRevealRow`;
the row memo `pricingRowPropsAreEqual` is UNTOUCHED -- the chevron flips via a `CollapseContext`-reading `RowChevron`, not
a per-row prop; full-screen `expanded` untouched); vitest 307 -> 320, tsc 3175 (0 new), see the collapse/expand rule above
+ plan §"Collapse/expand". Prior: Drop frozen-left, ship resize alone -- the frozen-left
(sticky-left) half of the bundle was structurally broken (cell-level multi-column sticky-left doesn't track horizontal
scroll: frozen cells paint in place, scrolling columns clip behind + don't reset on scroll-back; the border-separate flip
was wrong-axis + reverted; a two-pane fix fights resize's wrap-grow + doubles the row memo -- not worth it now), so the
sticky-left/`--fcol`/`frozenBg`/z-30-corner are REMOVED and the anchors are normal scrolling columns again; column resize
(table-fixed + colgroup + drag/autofit/clamp + wrap/truncate) + the VERTICAL sticky header + the row memo all RETAINED +
certed; frozen-left DEFERRED to a dedicated structural two-pane slice; vitest 303 (PricingGrid 129, unchanged), tsc 3175
(0 new), 2026-06-25, see the drop-frozen-left paragraph above + plan §"Drop frozen-left, ship resize alone".
Frozen-left anchors + column resize (the now-partly-superseded bundle) -- ONE structural
slice (`table-fixed` + `<colgroup>`) carrying TWO features: the 5 anchors through Description pinned sticky-left (z-30/z-20/
z-10 stack, opaque row-state bg, border-collapse kept) and every column drag-resizes session-only (header-edge handle,
double-click autofit, rate min-width clamp, headers truncate / body wraps+grows); the frozen LEFT offsets derived from the
LIVE colgroup widths via CSS vars on the table so a frozen resize stayed aligned (the bundling payoff); colgroup derives
from `visibleDescriptors`; width is GRID-LEVEL so the row memo is UNCHANGED; reviewRender untouched; SUPERSEDED the prior
"frozen-left + resize are independent" claim (Option B couples them) -- frozen-left then DROPPED (above); vitest 294->303,
tsc 3175 (0 new), 2026-06-25, see the frozen-left/resize paragraph above + plan §"Frozen-left + column-resize bundle". Parent-jump landing flash -- a jump now flashes the WHOLE
landed row blue for 3s then clears (grid-level `flashExcelRow` + timeout ref, resets on a new jump; derived per-row
`isJumpFlash` in `pricingRowPropsAreEqual` via the NEW pure `isJumpFlashRow`; blue wins over search-yellow for its 3s;
instant on/off = reduced-motion-safe; also flashes on the shared `scrollToRow` so review-strip/search jumps flash too);
vitest 291->294, tsc 3175 (0 new), 2026-06-25, see the parent-click-to-jump paragraph above + plan §"Parent click-to-jump".
Parent click-to-jump -- the pricing grid's Parent cell
(col 2) is now a clickable jump to the parent row via the existing `scrollToRow` (restores §13-3a, which 3a shipped
read-only); the button is col 2's roving nav target (no second tab stop), root rows keep the `<td>` nav target + render no
button, Enter jumps via a col-2 `handleGridKeyDown` special-case (Space/click fire the button natively), the NEW pure
`parentExcelRowOf` de-dups the resolution + the new `onJumpToRow` stable prop is in `pricingRowPropsAreEqual`; frozen-left +
column-resize stay a SEPARATE later bundled slice; vitest 287->291, tsc 3175 (0 new), 2026-06-25, see the parent-click-to-
jump paragraph above + plan §"Parent click-to-jump". Toolbar Part 1 -- FIVE view-layer pricing-editor toolbar
controls (description SEARCH with N-of-M + prev/next jumping via the grid's `scrollToRow` + a yellow current-hit-row
highlight whose per-row `isCurrentHit` boolean is the ONE row-memo touch; COLUMN-HIDE via a "Columns" popover that EXCLUDES
amount columns [locked] and re-indexes the nav over a `visibleDescriptors` set; and 3 ROW-TYPE filters [spacers/notes/
subtotals] keyed on `effective_classification`, AND-composed into the page-side `displayRows` pass, VIEW-ONLY so no count/
total moves); pure helpers in `PricingGrid.tsx` + the NEW `PricingToolbar.test.ts`; vitest 264->287, tsc 3175 (0 new),
2026-06-24, see the Toolbar-Part-1 paragraph above + plan §"Toolbar Part 1" (Part 2 layout rework deferred until after
Slice 5). Formula-vs-document reconciliation (Cluster B) -- a per-cell
"keep document / use formula" choice on a divergent amount cell (NEW pure leaf `reconcile.ts` with the SHARED `amountsEqual`
tolerance; document-DEFAULT [D1]; a STRONG violet `ReconcileBadge` cell cue + chooser, muted when resolved; a "divergence"
review-strip kind; the chosen value resolved ONCE in `pricingRollup.rowOwnAmount` [D4]; divergence fires only on
`cell.kind === "value"`); vitest 245->264, tsc 3175 (0 new), 2026-06-24, see the reconciliation paragraph above + plan
§"Cluster B". Full-screen / maximize editor (Slice 4c) -- a "Full
screen" toggle expands the pricing editor to a `fixed inset-0` full-viewport overlay (in-app maximize via a root
className toggle, NOT native Fullscreen, NOT a Dialog/portal); the NO-REMOUNT rule (one JSX tree -> grid drafts / cursor /
lock / all state survive expand/collapse), each grid's `expanded` prop relaxing its `max-h` cap to `flex-1 min-h-0`, Esc-
to-exit via a `defaultPrevented`-guarded window listener (`shouldExitFullscreenOnEsc`, so a popover-Esc doesn't exit), the
toggle rendered outside the `!isGridOnly` gate (works on read-only sheets too); display-only (perf memo intact); vitest
241->245 (PricingGrid 109->113), tsc 3175 (0 new), 2026-06-24, see the full-screen paragraph above + plan §"Slice 4c
full-screen editor". Amount-column formula-status badge -- a leading amber
(pending) / green (covered) `ƒ` badge that IS the `AmountFormulaBuilder` trigger (status + action merged; far-right
preview line removed -- the layout/visibility render-bug fix) + a pending amber `<th>` tint + the shared
`priceability.isAmountColumnCovered` predicate (`areFormulasComplete` folds over it -> badge⇔gate by construction);
display-only (header outside the row memo); read-only branch preserved; vitest 235->241, tsc 3175 (0 new), 2026-06-21;
see the formula-status-badge paragraph above + plan §"Amount-column formula-status badge". MANDATORY amount-formula gate -- amount formulas required
before any rate is editable (REVERSES "formula optional"); `priceability.areFormulasComplete` (per-COVERAGE via `pickFormula`,
wildcard-default covers per-area cols) -> a per-sheet `formulasComplete` boolean ANDed into the grid rate gate OUTSIDE
`isRateEditableRow` (override CANNOT bypass) + added to `pricingRowPropsAreEqual` (memo-safe) + a "Declare amount formulas to
enable rate entry." banner; `onSaveFormula`/declaration stays live under the gate; vitest 226->235 (priceability 30->36,
PricingGrid 106->109), tsc 3175 (0 new), 2026-06-24, see the gate paragraph above + plan §"Mandatory amount-formula gate";
Editor perf fix -- `PricingGrid` row-level memoization
(extract the `<tr>` into a `React.memo`'d `PricingGridRow` + `groupDraftsByRow` per-row draft slices [the anti-defeat rule]
+ `useMemo`'d grid derivations; the `activeColIndex` cursor lever; fixes the arrow-key/click lag on big sheets; NO
behaviour change; PricingGrid.test 83->94, suite 203->214, see the memoization-contract paragraph above + plan §"Editor
perf fix", 2026-06-24); Slice 4b-ACKNOWLEDGE -- the per-entry "reviewed / looks OK"
docs-hygiene cleanup (git holds it). **Latest frontend slices:** Fuzzy description search (2026-06-25) -- the
case-insensitive SUBSTRING search in BOTH `ReviewTree.tsx` (#159 find-&-filter) and `SheetSearchView.tsx` (row-finder +
RestructureModal parent-picker) replaced by the app-wide token-scoring matcher (`utils/tokenSearch`) via ONE shared helper
`boqDescriptionSearch.ts` (`fuzzyDescriptionMatchSet`); token AND, partial, min length 2; fuzzy = MEMBERSHIP only, hits
re-emitted in DOCUMENT order so prev/next still steps top-to-bottom. RestructureModal inherits (no change). See the "Fuzzy
description search" rule below. Prior: Detail-panel read views (2026-06-25) -- ADDITIVE
`ParentChain.tsx` (ancestor breadcrumb) + `ChildrenList.tsx` (direct children + `▸N`) mounted in the EXISTING review-screen
detail panel, clickable to drill-navigate; the ORIGINAL single-column panel design is unchanged (a two-column revamp was
prototyped then reverted -- only the two read views were kept). See the "Detail-panel read views" rule below. Prior:
Slice 4b-ACKNOWLEDGE -- the per-entry "reviewed / looks OK"
review-strip DISMISS (pure `priceability.ts` filter helpers + `SheetPricingPage` active/show-all feed + "Show dismissed"
toggle + per-entry Looks-OK/Restore action wired to `save_cell_dismissal`; `ReviewEntry` UNCHANGED; server-side re-arm,
priceability 27->30, 2026-06-23); Slice 4b-A computed-flag layer -- the shared
`priceability.ts` spine + the flags (needs_rate / qty_anomaly / broken / not_yet, broken/not_yet GATED behind the
priceability spine + not_yet DE-DUPED per-area against needs_rate [cert fixes]; `wont_compute` removed before push) +
in-grid markers + unified review strip + N/M
priced-count & unpriced filter + the incomplete-subtotal signal as ONE quiet `SummaryPanel` message (the per-subtotal STRIP
entries removed as noise) + rollup alignment
(`priceability.ts`/`PricingGrid`/`SheetPricingPage`/`pricingRollup`/`SummaryPanel`,
2026-06-23); Prepopulated-rate fix -- formula reads committed rates by
non-zero value, not just the priced marker (`PricingGrid.lookupOperandValue`, 2026-06-23); Summary formula-fix --
formula-aware rollup + grand-total row + reconciliation guard (`pricingRollup`/`SummaryPanel`, 2026-06-23).

**Download priced tender conventions (Phase 5 Slice 5b -- `PricedTenderDialog.tsx` + `downloadBlob.ts` + `BoqHubPage.tsx` + `SheetCard.tsx` + `boqTypes.ts`; full detail: plan section "Slice 5b"):** the hub UI for the 5a Excel write-back. **DELIBERATELY DISTINCT from "Export Parsed BoQ"** (`ExportWorkbookDialog`, the D2b fresh review .xlsx built client-side from review rows; label renamed from "Export Finalized") -- this DOWNLOADS THE ORIGINAL TENDER FILE with the priced rates + the user's colour/remark notes stamped in SERVER-SIDE (the 5a `export_priced_workbook` endpoint). The two must never read as duplicates -- both now live as items in the hub footer "Export" overflow menu (see the toolbar-rework note below).

- **The button:** a NEW "Download priced tender" Button (6th sibling in the hub header action cluster, after Tendering), `variant="outline"` + `<Download/>` icon, gated `disabled={committedMap.size === 0}` with the Tooltip disabled-reason pattern (mirrors the Tendering button). Opens `PricedTenderDialog`.
- **`PricedTenderDialog`** mirrors `CommitDialog`'s `committedState`-driven rows + per-row metadata sub-line, with `ExportWorkbookDialog`'s self-contained "confirm does the download" shape (it calls the endpoint, downloads, then hands the result up via `onDownloaded` -- no result-callback-then-hub-does-the-work split). **Source = `committedMap`** (the COMMITTED sheets, the SAME source `TenderingDialog` uses -- NOT `committableSheets`/eligibility). **All finalized (`grid_and_nodes`) rows ticked by default**; grid-only general-specs rows (`sheet_disposition === "grid_only"`) are **SHOWN but DISABLED** (`checked={!isGridOnly && isTicked}`, `disabled={running || isGridOnly}`) labelled "(no rates to write)" -- they pass through the workbook untouched so ticking would be a no-op. Per-row sub-line: `last exported {date}` / `never exported` + an amber "changed since export" when `pricing_changed_since_export`. Reset ticked set in `useEffect([open])`; dismiss-guard while `running`; inline `getFrappeError`.
- **`downloadBlob.ts` (NEW, the download mechanics):** `base64ToBytes(base64): Uint8Array` is PURE (atob loop) + unit-tested (`downloadBlob.test.ts`); `downloadBytes(bytes, filename, contentType)` is the `exportReviewXlsx` download tail (`new Blob([bytes],{type}) -> URL.createObjectURL -> anchor[download] -> click -> revokeObjectURL`) -- DOM-side, **owner-cert-live, NOT headless-unit-runnable**. The dialog decodes `res.message.content_base64` and downloads under `res.message.filename`. (5a returns base64-in-JSON because the file-only `frappe.response.filecontent` can't also carry the skipped-formula report.)
- **Skipped-formula message:** the hub's `onDownloaded` opens an acknowledge-only `AlertDialog` (single OK, mirrors `CommitResultsModal`) confirming the download + -- when `skipped_formula_columns` is non-empty -- naming the sheets+columns left untouched because they hold formulas (the 0 client-owned-doc requirement: tell the user what we did NOT write). Plain success when none skipped. `onDownloaded` also `mutateCommittedState()` so the staleness chips refresh.
- **Staleness chip on `SheetCard`:** a muted amber "priced since last export" chip rendered when `committedState.pricing_changed_since_export` -- rides the EXISTING `committedState` prop (NO new prop wiring), styled like the needs-attention chip. `last_exported_at` + `pricing_changed_since_export` are ADDITIVE on `CommittedSheetState` (server-computed by `get_committed_state`, version-isolated to the current commit_version); `ExportPricedWorkbookResponse` is the NEW endpoint response type. **Completes the Slice-5 write-back arc.** vitest 303 -> 307 (+4 `base64ToBytes`), tsc 3175 (0 new). OWED live-cert: (i) VRF formula-skip live proof; (ii) unticked/grid-only-unchanged + chip flip/clear.

