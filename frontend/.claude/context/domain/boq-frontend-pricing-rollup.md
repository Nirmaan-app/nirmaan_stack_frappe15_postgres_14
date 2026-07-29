# BoQ Frontend — Pricing Editor: rollup, priceability & reconciliation

> pricingRollup + SummaryPanel, priceability.ts review-flag layer (Slice 4b-A / Cluster A), incomplete subtotals, Cluster B reconciliation store and the DOC-0 flip.

> Split from `boq-frontend.md` (287KB) on 2026-07-29. Surfaces and pricing clusters defined by the owner.

## Contents

- Summary formula-fix `pricingRollup.ts` + `SummaryPanel.tsx` (post-F4 fix; full detail: plan §"Summary fix")
- Prepopulated-rate fix `PricingGrid.lookupOperandValue` (RATE branch; full detail: plan §"Prepopulated-rate fix")
- Computed review-flag layer `priceability.ts` (Slice 4b-A, Cluster A; full detail: plan §"Slice 4b-A")
- Priced-count + filter (header)
- Incomplete-subtotal `pricingRollup.ts` + `SummaryPanel.tsx` (Slice 4b-A, STEP 7+8; strip->summary fix)
- Cluster B (the formula-vs-document reconciliation CHOICE store) is now BUILT
- D1
- Cluster B amendment -- DOC-0 default flip (`reconcile.ts` ONLY; frontend-only, NO migrate, 2026-06-27)
- yellow BACKGROUND, not a ring

---

**Summary formula-fix `pricingRollup.ts` + `SummaryPanel.tsx` (post-F4 fix; full detail: plan §"Summary fix"):** F4 swapped
the GRID amount compute to formulas but the SUMMARY rollup still used the old `findPairedRateDescriptor` path, so
formula-only amount columns rolled up ZERO (Alorica throughout; Electrical Phase 2). FIX: `rollupByParent(rows,
columnDescriptors, columnFormulas=[])` + `rowOwnAmount` is now **formula-aware ONLY when a formula applies** -- `pickFormula`
(REUSED) -> `evaluateAmountColumn` with a **saved-only** lookup (`lookupOperandValue(row, ref, descriptors, {})` -- empty
draftRates skips the draft branch; un-priced -> not_yet -> null -> 0). **NO-formula columns are byte-for-byte unchanged**
(the D-2 guard -- NOT routed through `evaluateAmountCell`). **SAVE-TIME** (Option A: saved values only, no `draftRates`
threaded; the summary refreshes a beat after each auto-save's `mutate()`). Added: a **grand-total `<tfoot>` row** (Option 1
= sum of top-level rolled totals, root orphans included, each item once) + a **reconciliation guard** (Option 1 vs Option 2
= flat line-item sum; mismatch beyond `max(0.01, 1e-9*mag)` -> an amber integrity banner naming the column + both numbers,
the Option-1 value still shown). New prop `columnFormulas` threaded `SheetPricingPage`->`SummaryPanel`->`rollupByParent`.
not_yet/broken fold to 0 (the 4b incomplete-marker is deferred). No circular import (`pricingRollup`->`PricingGrid` already
existed). The grid compute / rate-save / nav / color / remarks / backend untouched.

**Prepopulated-rate fix `PricingGrid.lookupOperandValue` (RATE branch; full detail: plan §"Prepopulated-rate fix"):** a
formula ignored a PREPOPULATED committed rate (a real non-zero tender value with no editor MARKER) because the rate read
gated on `isCellPriced`, not value-presence -> the amount blanked until re-edited (confirmed on 150/166 by a DB peek). FIX:
a RATE operand is usable when `isCellPriced(row, rd)` **OR the resolved committed value is a NON-ZERO finite number**.
Three states: editor-priced (marker, any value incl. 0) -> value; committed NON-ZERO (no marker) -> value [THE FIX];
committed 0.0 (no marker) -> undefined -> not_yet ("needs a rate"). Owner-accepted: a genuine-0 never-priced rate BLANKS
(safer; price it 0 to set the marker). **RATE branch ONLY** -- the qty/plain-amount read is untouched (a committed qty 0
still reads 0); `isCellPriced` itself is UNCHANGED (its 5 other consumers -- pairing fallback, prefill/cleanup, priced
tint -- unaffected). No new storage/flag (non-zeroness is the distinguisher; the committed tier has no NULLs). The fix is
in the SINGLE shared `lookupOperandValue`, so it flows to BOTH the grid cell AND the summary rollup (drafts={}) -- the
rollup SOURCE was not edited.

**Computed review-flag layer `priceability.ts` (Slice 4b-A, Cluster A; full detail: plan §"Slice 4b-A"):** the NEW shared
spine `priceability.ts` is the ONE place the "qty-bearing priceable line" rule lives -- the §6 one-shared-definition. LOCKED
owner rule: a row is a PRICEABLE LINE iff `isPriceableType(node_type)` (Preamble/Line Item) AND it is QTY-BEARING in >=1
pricing area (a zero-qty-everywhere priceable row DROPS OUT of the population). FILLED = `isCellPriced` OR a
prepopulated-committed-non-zero rate -- expressed as `lookupOperandValue(row, ref, descriptors, {}) !== undefined`, so it
REUSES the editor's single source of truth (never a bare zero-check; a deliberate editor-0 counts, an unfilled 0 does not).
FULLY PRICED = option-(i): every QTY-BEARING area's rate cell(s) filled (no-qty areas IGNORED). Per-ROW count (owner-locked).
Every consumer routes through this module: `computeRowFlags` (the flags + F4 not_yet/broken), `computePricedCount`
(N/M done-test), `isRowIncomplete` (the incomplete-subtotal atom), and the `pricingRollup` alignment. **No circular import:**
`priceability` imports PricingGrid's leaf predicates (`isPriceableType`/`isCellPriced`/`isRateDescriptor`/`isAmountDescriptor`/
`lookupOperandValue`/`evaluateAmountCell`); PricingGrid NEVER imports `priceability` -- it
RECEIVES the flags as a `rowFlags?: Map<number, RowReviewFlags>` prop (the flag types `AreaKey`/`ReviewFlagKind`/
`RowReviewFlags`/`ReviewEntry`/`PricedLineCount` live in `boqTypes.ts` so the grid consumes them without the cycle).

The flags (all DERIVED on the fly -- no stored field): **needs_rate** (priceable line, a qty-bearing area not filled --
per-area aware: priced in X but not qty-bearing Y still fires for Y); **qty_anomaly** (a NON-priceable node_type carrying
qty -- the inverse guardrail). Plus F4's **broken**/**not_yet** surfaced by READING `evaluateAmountCell(d,row,...,{})`
(saved-state; the live grid keeps its own draft-aware broken `AlertTriangle`). **broken/not_yet are GATED behind the
priceability spine (cert fix):** they fire ONLY on (1) a PRICEABLE LINE (`isPriceableLine` -- the whole loop is skipped on a
non-priceable row) and (2) an amount cell whose AREA is QTY-BEARING on that row (option-(i), reusing the SAME
`isAreaQtyBearing` the `qtyBearingAreas` set is built from -- NO new qty check), SYMMETRIC with needs_rate -- so a
notes/header/non-priceable row never flags, and a no-qty area's amount cell is ignored on a priceable row. (The same gate is
applied to `isRowIncomplete` so the Summary message agrees with the grid.) **not_yet is also DE-DUPED against needs_rate
(cert fix, PER-AREA):** an amount cell's not_yet is SUPPRESSED when its area is already in the row's `needsRateAreas` -- the
amount-not-computed there is the SAME rate gap needs_rate reports (two messages for one problem = noise); the suppression is
a membership test reusing `needsRateAreas` (no recompute, no new rate check). **broken is NEVER suppressed** (a malformed /
cyclic formula is a different, real problem); and not_yet STILL fires for a non-needs_rate area whose formula blanks for a
NON-rate cause (e.g. an uncomputed amount operand). `isRowIncomplete` is unaffected -- a needs_rate row is already
`!isFullyPriced` -> incomplete before its amount loop, so the Summary stays correct. (**`wont_compute` was removed before
push** --
superseded by the forthcoming mandatory amount-formula-declaration gate, which makes the no-formula-at-pricing state
impossible, so the flag could never fire.) **In-grid marker (`PricingGrid.tsx`):** a left accent + `Flag` icon
in the Excel-Row GUTTER (col 0) -- DELIBERATELY in the gutter (which carries no priced tint / colour border) so a system flag
never collides with the emerald/amber priced background or the user colour border (§6); rose accent = critical
(broken/qty_anomaly), amber = attention. **Review strip (`SheetPricingPage.tsx`):** the 4a remark feed is EXTENDED IN PLACE
(one `ReviewEntry[]` list, no fork) = remarks + `buildFlagEntries` (the incomplete-subtotal STRIP entries were removed as
noise -- see below); each entry click-jumps via the existing `gridRef.current?.scrollToRow(excelRow)`; per-kind badge/colour
via the module-level `REVIEW_ENTRY_META`.
**Priced-count + filter (header):** a live "N of M priceable lines priced" readout (`computePricedCount`; "ready to finalize"
text when N===M, NO finalize logic -- that is a later slice) + a "Show unpriced" toggle filtering `displayRows` to
priceable-but-not-fully-priced (filtered PAGE-side; the grid's nav/byIdx stay consistent over the rendered set; `draftRates`
keyed by `row_index` persist across the toggle -- the grid is keyed on `sheetName` only, no remount).

**Incomplete-subtotal `pricingRollup.ts` + `SummaryPanel.tsx` (Slice 4b-A, STEP 7+8; strip->summary fix):** `RollupNode`
gains `incomplete: boolean` = an OR over self + descendants of `priceability.isRowIncomplete` (a qty-bearing priceable row
not fully priced / not_yet / broken). **Zero-qty / non-priceable descendants NEVER flag a parent** (owner: only qty-bearing
rows count). **The per-subtotal review-STRIP entries were REMOVED as noise** (the `incompleteSubtotalEntries` fn is deleted);
the signal now surfaces as **ONE quiet panel-level message** in `SummaryPanel` -- "Some priceable lines aren't fully priced
yet." -- shown when `roots.some(r => r.incomplete)` (a root's `incomplete` already ORs its whole subtree), muted style, NO
per-subtotal markers (owner option (a)). `SummaryPanel` already calls `rollupByParent` internally, so it reads
`RollupNode.incomplete` with NO new prop / fetch. **`RollupNode.incomplete` + `ownIncompleteByIdx`/`rolledIncomplete`/
`isRowIncomplete` are KEPT** (the message reads them). **Rollup ALIGNMENT (KEPT, owner-explicit):** the stale header comment
(node_type "NOT on the delivered row") stays corrected -- node_type IS now on `PricedRow`, and the priceable-POPULATION
decision (the incomplete signal) routes through the shared helper. The amount SUMMATION (`rowOwnAmount`) is INTENTIONALLY NOT
regated (regating would change committed-amount totals); only the incompleteness SIGNAL uses the helper, so the existing
rollup totals are byte-for-byte unchanged (the formula-aware / grand-total / reconciliation tests stay green).
**Cluster B (the formula-vs-document reconciliation CHOICE store) is now BUILT** (the choice store, the per-cell overlay,
the rollup-source switch [document-default], and the document-vs-formula divergence flag all shipped -- see the
"Formula-vs-document reconciliation (Cluster B)" paragraph below).

**Acknowledge dismiss layer `priceability.ts` + `SheetPricingPage.tsx` (Slice 4b-ACKNOWLEDGE; full detail: plan §"Phase 5
Slice 4b-ACKNOWLEDGE"):** a per-entry "reviewed / looks OK" DISMISS on the review strip. A dismissal HIDES a strip entry (a
computed flag OR a remark) from the ACTIVE view WITHOUT changing its condition (an ACKNOWLEDGMENT, not a fix -- the flag
clears for real only when its condition clears). **The store key is (excel_row, flag_kind) -- the SAME identity a
`ReviewEntry` carries, so `ReviewEntry` is UNCHANGED** (no shape edit). `priceability.ts` gains PURE helpers:
`dismissalKey(excelRow, kind)` => `"<kind>:<excelRow>"` (EQUALS the strip's existing `<li>` key `${e.kind}:${e.excelRow}` --
the membership composite is the strip key, locked by a test), `reviewEntryKey`, `buildDismissedKeySet` (from
`get_priced_rows.dismissals`, the additive sheet-level flat list `[{excel_row, flag_kind}, ...]`), `isEntryDismissed`,
`filterActiveReviewEntries` (ONE pass over the already-built `ReviewEntry[]` -- NO new page-level recompute). The new wire
types `DismissalRef` / `DismissalSaveArgs` + the `dismissals` key on `GetPricedRowsResponse` live in `boqTypes.ts`.
**D1** rule: diverge+take_formula -> formula; diverge+unset/keep_document -> **DOCUMENT**; else no-divergence), `reconChoiceKey`
+ `buildReconChoiceMap`. **A LEAF** -- it imports only types, so `PricingGrid`/`priceability`/`pricingRollup` all import it
with no cycle (PricingGrid can NOT import pricingRollup -- that is the cycle reconcile.ts exists to avoid). **Detection
(D2a, `PricingGrid` amount cell):** when `cell.kind === "value"` (a real computed number -- not_yet/broken/committed never
diverge, **F1**), compare `resolveDescriptorValue(row, d)` (document) vs `cell.value` (formula) via `resolveDivergence`; the
SHOWN value defaults to the document (D1). A divergence renders a STRONG **violet `ReconcileBadge` pill** (distinct channel
-- background/left-border/gutter are taken) + a chooser popover labelled with both numbers; a RESOLVED choice shows a MUTED
grey pill (still visible). The badge is read-only (a static pill) when `onSaveReconChoice` is withheld (locked). **The grid
threads `reconChoices` -> a per-sheet `reconChoiceMap` (useMemo, reference-stable across a keystroke like `columnFormulas`)
-> the memoized row (added to `PricingGridRowProps` + `pricingRowPropsAreEqual`), memo intact.** **Strip (D2b):**
`priceability.buildDivergenceEntries` adds a "divergence" `ReviewEntry` kind (one per row, listing the unresolved diverging
cols; a resolved cell DROPS OUT); `ReviewFlagKind` gains `divergence`; `REVIEW_ENTRY_META` violet; the per-entry "Looks OK"
dismiss is WITHHELD for a divergence entry (its kind is not a dismissal token -- the chooser IS its resolution). **Rollup
(D4):** `rollupByParent` gains a `reconChoices` param -> `rowOwnAmount` resolves the chosen value ONCE (document-default) so
Option-1==Option-2 stays balanced; `SummaryPanel` threads it. **`SheetPricingPage`:** reads `reconciliation_choices` from
`get_priced_rows`, `handleSaveReconChoice` (mirrors `handleSaveDismiss`; `choice` null clears), withheld when `locked`. New
wire types `ReconChoice`/`ReconciliationChoiceRef`/`ReconChoiceSaveArgs` + the `reconciliation_choices` key on
`GetPricedRowsResponse` in `boqTypes.ts`. vitest 245->264 (NEW `reconcile.test` 12 + `pricingRollup` +4 + `priceability`
+3), tsc 3175 (0 new), in-container build exit 0, 2026-06-24.

**Cluster B amendment -- DOC-0 default flip (`reconcile.ts` ONLY; frontend-only, NO migrate, 2026-06-27):** the D1 default
gets ONE narrow exception. When the committed DOCUMENT amount is approximately ZERO (`amountsEqual(documentVal, 0)` -- the
EXISTING shared epsilon, no new const) and the formula is a real number that diverges, the **FORMULA value wins SILENTLY** --
no badge, not in the review strip, no chooser, no override. Rationale: we upload UNPRICED BoQs, so almost every amount cell
is doc-0 -- a doc-0 amount is an absent/blank value, not a client-stated price, so the computed amount is the right thing to
show + roll up. **Implementation is ONE line in the single resolver:** `resolveDivergence` returns the SAME `{ diverges:
false }` a true non-divergence returns, placed BEFORE the choice branch -> every consumer already falls through to the
formula value when not diverging (`pricingRollup.rowOwnAmount` -> `return formulaVal`; `PricingGrid` -> `shownAmount` stays
`cell.value`; `priceability.buildDivergenceEntries` -> not listed), so grid display, totals, AND strip all flip identically
with **ZERO per-consumer special-casing** (PricingGrid.tsx / pricingRollup.ts / priceability.ts UNCHANGED). Placed before the
choice branch so the formula ALWAYS wins on doc-0 (no keep-document path for the zero case, even if a stale choice is
stored). **NON-zero document divergences are UNCHANGED** (default document, badge, strip, chooser, overridable). The
integrity guard stays balanced (both Option-1/Option-2 routes read the same resolved value via `ownByIdx`). **This MOVES
TOTALS** (doc-0 divergent cells now roll up their formula value instead of 0) -- intended. Backend untouched (it only stores
explicit choice tokens; "unset" is never persisted; export write-back is rates-only). vitest 341->349 (`reconcile` 12->19,
`pricingRollup` 27->28), tsc 3175 (0 new), in-container build exit 0, 2026-06-27; see plan §"Cluster B amendment -- doc-0".

**Toolbar Part 1 -- search + column-hide + 3 row-type filters (`SheetPricingPage.tsx` + `PricingGrid.tsx`; view-layer,
owner-locked; full detail: plan §"Toolbar Part 1"):** the pricing-editor header now carries FIVE view-only controls
(dropped into the existing `!isGridOnly` flex cluster; the toolbar LAYOUT rework is **Part 2, deferred until after Slice
5** -- only the controls were added, the header was NOT restructured). All default to the current behaviour (nothing
hidden, no search) so a no-touch user sees the exact prior grid. **(1) COLUMN-HIDE** -- a "Columns" Popover hides
NON-AMOUNT descriptor columns; **AMOUNT COLUMNS ARE NEVER HIDEABLE** (owner-locked -- their formula-status `ƒ` badge must
never be hidden). One source of truth: `hideableDescriptors(columnDescriptors)` (reuses `isAmountDescriptor`) lists the
popover; the grid guard `isColumnVisible(d, hiddenCols)` always returns true for amount columns. State = a per-GRID
`hiddenCols: Set<string>` tracked as HIDDEN (default EMPTY = nothing hidden, NO seeding -- a visible-set lazy-init would
flash on every sheet open). The grid renders + navigates a `visibleDescriptors` set used UNIFORMLY (header `<th>` map, row
`<td>` map, `remarksColIndex`/`colCount`, AND the `commitActiveRate` colIndex reverse-lookup) so the cursor can NEVER land
on a hidden column; the FULL `displayDescriptors` is kept for the data-fanout (cross-area prefill, autosave) so
`commitRate`'s identity stays stable across a hide. `hiddenCols` is per-GRID -- NEVER enters the row memo. **(2) SEARCH** --
a thin case-insensitive substring matcher over `row.description` (NO review-tier filter compose); `buildSearchHits` over
the rendered `displayRows` -> an N-of-M counter + prev/next `stepHit`-wrap that jumps via the grid's EXISTING
`gridRef.scrollToRow` (NOT ReviewTree's `revealAndScrollToRow`). **The ONE row-memo touch:** the per-row `isCurrentHit`
boolean is in `pricingRowPropsAreEqual` (like `reconChoiceMap`) so the highlight repaints on step; the current hit is a
**yellow BACKGROUND, not a ring** (the table is `border-collapse` -> a `<tr>` ring-inset is unreliable, and a blue ring
would collide with the active-cell ring). **(3/4/5) ROW-TYPE FILTERS** (spacers/notes/subtotals) -- three booleans keyed on
`effective_classification` (NOT node_type, which can't tell them apart); `classificationVisible` AND-composed into the SAME
page-side `displayRows` `.filter()` (the `=== rows` fast path preserved at default). **VIEW-ONLY (load-bearing):** the
toggles narrow ONLY `displayRows`; `computePricedCount` / `SummaryPanel` / the flag feed all read the UNFILTERED `rows`, so
hiding a row-type moves NO total/count, and nav-skip is free (the grid gets the already-filtered rows). Pure helpers
(`searchMatches`/`buildSearchHits`/`stepHit`/`isCurrentHitRow`/`classificationVisible`/`hideableDescriptors`/
`isColumnVisible`) live in `PricingGrid.tsx` + are unit-tested in the NEW `PricingToolbar.test.ts`. vitest 264->287, tsc
3175 (0 new), in-container build exit 0, 2026-06-24.

