### Phase 5 Pricing Editor -- Slice 4b-A -- the computed review-flag layer (Cluster A) (FRONTEND, feat 2026-06-23)

**Scope.** Cluster A of the 4b review-flag feature: the computed flags + their surfacing, riding existing surfaces.
FRONTEND-only, NO new doctype / migrate / backend / endpoint. Cluster B (the formula-vs-document reconciliation CHOICE
store) is a SEPARATE later slice -- DEFERRED here (no choice store, no overlay, no rollup-source switch, no
document-vs-formula mismatch flag). Files: NEW `priceability.ts`; `boqTypes.ts` (additive types); `PricingGrid.tsx`;
`SheetPricingPage.tsx`; `pricingRollup.ts`; + tests (`priceability.test.ts` NEW, `pricingRollup.test.ts` +3).

**The ONE shared spine (`priceability.ts`).** The single home of the LOCKED owner rule (the §6 one-shared-definition):
- **PRICEABLE LINE** iff `isPriceableType(node_type)` (Preamble/Line Item) AND **qty-bearing in >=1 pricing area**. A
  zero-qty-everywhere priceable row DROPS OUT of the population (not counted, not "needs a rate").
- **FILLED** (never a bare zero-check) = `isCellPriced` (an editor marker, incl. a deliberate 0) OR a prepopulated
  committed NON-ZERO rate -- expressed as `lookupOperandValue(row, ref, descriptors, {}) !== undefined`, so "filled" REUSES
  the editor's single source of truth (the prepopulated-rate fix flows through; an unfilled committed 0 is NOT filled).
- **FULLY PRICED** (option-(i), owner-locked): for EVERY qty-bearing area, all that area's rate cells filled; a no-qty area
  is IGNORED. Per-ROW count (owner-locked), strict done-test.
- Area model: a `pricingAreas(descriptors)` set of per-area `value_key`s + a SCALAR sentinel (`null`) when scalar rate
  columns exist; `qtyBearingAreas` = pricingAreas qty-bearing on the row; `isAreaFullyPriced` = all that area's rate cells
  filled. An area with qty but NO rate column is excluded from the priceable surface.
- Exports: `isPriceableLine` / `isFullyPriced` / `qtyBearingAreas` / `isRateFilled` / `computeRowFlags` /
  `computePricedCount` / `isRowIncomplete` / `buildFlagEntries` / `hasAnyFlag` / `flagSeverity`.

**No circular import (the load-bearing structure call).** `priceability` IMPORTS PricingGrid's leaf predicates
(`isPriceableType`/`isCellPriced`/`isRateDescriptor`/`isAmountDescriptor`/`lookupOperandValue`/`evaluateAmountCell`) +
`amountFormula.pickFormula` (the established consumer-of-PricingGrid pattern, like `pricingRollup`). PricingGrid NEVER
imports `priceability` -- it RECEIVES the flags as a `rowFlags?: Map<number, RowReviewFlags>` PROP. The flag types
(`AreaKey`/`ReviewFlagKind`/`RowReviewFlags`/`ReviewEntry`/`PricedLineCount`) live in `boqTypes.ts` so the grid consumes
`RowReviewFlags` without importing `priceability` (which would be the cycle). `pricingRollup` imports `priceability` (one
direction toward PricingGrid leaves; no cycle).

**The flags (DERIVED on the fly -- no stored field).** `computeRowFlags(row, descriptors, columnFormulas)`:
- **needs_rate** -- priceable line with a qty-bearing area not filled. PER-AREA aware (priced in X but not qty-bearing Y
  fires for Y; `needsRateAreas` carries the specific areas).
- **qty_anomaly** -- a NON-priceable node_type carrying a non-zero qty anywhere (the inverse guardrail).
- Plus F4's **broken** / **not_yet** surfaced by READING `evaluateAmountCell(d,row,...,{})` (saved-state, empty draftRates --
  a consistent snapshot matching the rollup; the live grid keeps its own draft-aware broken `AlertTriangle`). **GATED behind
  the priceability spine (cert fix -- see Amend 2):** the loop is skipped entirely on a non-priceable row, and within it a
  no-qty area's amount cell is ignored (option-(i), reusing `isAreaQtyBearing`), symmetric with needs_rate. **not_yet is also
  DE-DUPED per-area against needs_rate (cert fix -- see Amend 3):** suppressed when its area is already in `needsRateAreas`
  (same rate gap); broken is never suppressed; not_yet still fires for a non-rate cause.
- **`wont_compute` was REMOVED before push** (the original 4b-A shipped it as "priceable + being-priced + amount column
  has no applicable `pickFormula`"). It is superseded by the forthcoming MANDATORY amount-formula-declaration gate, which
  makes the no-formula-at-pricing-time state impossible -- so the flag could never fire. Dropped from `ReviewFlagKind`,
  `RowReviewFlags`, `computeRowFlags`, `buildFlagEntries`, the in-grid marker, and `REVIEW_ENTRY_META`; its 2 dedicated
  unit tests removed (priceability.test.ts 22 -> 20). `priceability` no longer imports `amountFormula.pickFormula`.

**In-grid marker (`PricingGrid.tsx`).** A left accent (`border-l-4`) + a `Flag` icon in the Excel-Row GUTTER (col 0).
DELIBERATELY in the gutter -- which carries no priced tint / colour border -- so a system flag never collides with the
emerald/amber priced background or the user colour border (§6). Rose = critical (broken/qty_anomaly), amber = attention.
The grid only READS the passed `rowFlags` (a tiny boolean->severity map inline; NOT a priceability re-derivation). The
existing amount-cell broken `AlertTriangle` is untouched.

**Review strip + count + filter (`SheetPricingPage.tsx`).** The 4a remark feed is EXTENDED IN PLACE (one `ReviewEntry[]`,
NO fork): remarks + `buildFlagEntries`, sorted by Excel row; each entry click-jumps via the
existing `gridRef.current?.scrollToRow(excelRow)`; per-kind badge/colour via a module-level `REVIEW_ENTRY_META`. (The
incomplete-subtotal entries were part of the original 4b-A feed; they were removed as noise -- see Amend 2.) The header
gains a live **N of M priceable lines priced** readout (`computePricedCount`; "ready to finalize" text when N===M -- NO
finalize logic, that is slice 6) + a **"Show unpriced"** toggle filtering `displayRows` to priceable-but-not-fully-priced.
The filter is PAGE-side (the grid's nav/byIdx stay consistent over the rendered set; `draftRates` keyed by `row_index`
persist across the toggle -- the grid is keyed on `sheetName` only, no remount). The flag map + count + entries are plain
consts (computed AFTER the early-return guards -> not `useMemo`, hooks-after-return is illegal; the page re-renders on
save/toggle, never per keystroke).

**Incomplete-subtotal + rollup alignment (`pricingRollup.ts`, STEP 7+8).** `RollupNode` gains `incomplete: boolean` = an OR
over self + descendants of `priceability.isRowIncomplete` (a qty-bearing priceable row not fully priced / not_yet / broken).
**Zero-qty / non-priceable descendants NEVER flag a parent** (owner: only qty-bearing rows count). Originally surfaced as
per-subtotal review-strip entries via `incompleteSubtotalEntries`; **that fn was REMOVED (Amend 2) -- the signal now drives
ONE quiet `SummaryPanel` message instead** (`RollupNode.incomplete` + its plumbing are KEPT). **ALIGNMENT (KEPT):** the
stale header comment ("node_type is NOT on the delivered row") is corrected -- node_type IS now on `PricedRow`, and the
priceable-POPULATION decision (the incomplete signal) routes through the shared helper. The amount SUMMATION (`rowOwnAmount`)
is INTENTIONALLY **NOT regated** -- regating would change committed-amount totals (the HARD-GATE STOP), so only the SIGNAL
uses the helper and the existing rollup totals are byte-for-byte unchanged.

**Tests + gates.** Vitest **170 -> 195** (+25) at ship: NEW `priceability.test.ts` (+22 -- the spine: zero-qty-everywhere
excluded / single-area scalar / multi-area partial-qty fully-priced-ignores-no-qty-area / fully- vs half-priced /
filled-is-not-a-zero-check (editor-0 vs unfilled-0 vs prepopulated-non-zero); the flags; F4 not_yet/broken surfaced; N/M
count; `isRowIncomplete` incl. the zero-qty-don't-flag case; `buildFlagEntries`), `pricingRollup.test.ts` (+3 -- half-priced
child -> parent incomplete + strip entry / zero-qty-only-unpriced -> COMPLETE / fully-priced + totals unaffected by the
signal). The existing **20** pricingRollup tests stayed GREEN before AND after the alignment (no existing total silently
changed -- the HARD GATE held). tsc **3178 == baseline** (0 new in touched files, test files included). Vite build exit 0.
Backend / rate-save / nav / color / remarks / `amountFormula` / `evaluateAmountCell` internals / `SummaryPanel` UNTOUCHED.
**Amend (`wont_compute` removal, before push):** its 2 dedicated unit tests dropped -> Vitest **195 -> 193**
(`priceability.test.ts` 22 -> 20); one `wont_compute` assertion struck from the multi-flag `buildFlagEntries` strip-feed
test (the rest intact); tsc **3178 == baseline**, build exit 0. `pricingRollup.ts`/`pricingRollup.test.ts` untouched.

**Amend 2 (two cert-surfaced fixes, before push).** (1) **not_yet/broken gated behind the priceability spine.** The bug:
not_yet/broken fired on NON-priceable rows (notes / headers) that happen to have amount columns and evaluate blank --
noise. Root cause: `computeRowFlags`' not_yet/broken loop ran over amount descriptors with NO `isPriceableLine` gate and NO
per-area qty-bearing check (unlike needs_rate). Fix (LOCKED, option-(i), symmetric with needs_rate): the loop is skipped
entirely when `!isPriceableLine`, and within it each amount cell's area (`amount_by_area` -> value_key; scalar -> the SCALAR
sentinel) must be `isAreaQtyBearing` -- a no-qty area's amount is ignored. The SAME gate was applied to `isRowIncomplete`'s
loop so the Summary message agrees with the grid (a fully-priced row with a no-qty area whose formula evaluates not_yet would
otherwise falsely read incomplete). needs_rate / qty_anomaly / the return shape are unchanged; `PricingGrid` is UNTOUCHED
(the marker booleans' SHAPE is unchanged -- only WHEN they fire). (2) **incomplete-subtotal strip -> one Summary message.**
The per-subtotal "Incomplete subtotal..." review-STRIP entries were noise: `incompleteSubtotalEntries` is DELETED from
`pricingRollup.ts` (its `ReviewEntry` import too), the `incompleteEntries` call/concat dropped from `SheetPricingPage`, the
`"incomplete_subtotal"` kind removed from `ReviewFlagKind` + `REVIEW_ENTRY_META`. `RollupNode.incomplete` +
`ownIncompleteByIdx`/`rolledIncomplete`/`isRowIncomplete` are KEPT. `SummaryPanel` (a DELIBERATE scope addition -- the owner
brought it in) shows ONE muted panel-level line "Some priceable lines aren't fully priced yet." when
`roots.some(r => r.incomplete)` (a root's `incomplete` already ORs its subtree); NO per-subtotal markers (owner option (a));
no new prop/fetch (SummaryPanel already rolls up internally). The §6 rollup ALIGNMENT is KEPT (owner-explicit), not reverted.
**Tests:** Vitest **193 -> 197** (+4): `priceability.test.ts` 20 -> 24 (+4 FIX-1 gate tests -- the non-priceable bug repro;
the option-(i) A1-fires/A2-ignored multi-area case; broken gated-out on non-priceable vs fires on priceable; a no-regression
priceable-no-rate -> not_yet). `pricingRollup.test.ts` stays **23**: the 2 combined incomplete tests were TRIMMED in place
(the `incompleteSubtotalEntries` assertions removed, their `node.incomplete` assertions KEPT) + the totals-unaffected test
KEPT -- no whole node.incomplete test deleted. No SummaryPanel test harness exists (all boq-wizard tests are pure-function
units) -> none scaffolded; covered by the `node.incomplete` units + live cert. tsc **3178 == baseline**, build exit 0.
`PricingGrid.tsx` UNTOUCHED.

**Amend 3 (`not_yet` de-duped against `needs_rate`, before push).** The bug (live-cert): on a priceable qty-bearing row
with no rate, TWO flags fired from ONE cause -- `needs_rate` (the rate is missing) AND `not_yet` (the amount couldn't compute
BECAUSE that same rate operand is missing). The `not_yet` there just restates the rate gap -- noise. Fix (LOCKED, owner,
PER-AREA, `computeRowFlags` only): an amount cell contributes to `notYetCols` ONLY IF its area is NOT in the row's
`needsRateAreas` (already computed for `needs_rate`; the amount cell's area is resolved the SAME way the loop already does --
`amount_by_area` -> `value_key`, scalar -> the SCALAR sentinel; SAME key space, since both per-area columns of an area share
`value_key=area`). A membership test -- REUSES `needsRateAreas`, no recompute, no new rate check. **`broken` is NEVER
suppressed** (a malformed/cyclic formula is a different, real problem). **`not_yet` STILL fires** for a non-`needs_rate`
area whose formula blanks for a NON-rate cause (e.g. an uncomputed amount operand). **`isRowIncomplete` is UNCHANGED** and
VERIFIED unaffected: a `needs_rate` row is already `!isFullyPriced` -> returns true BEFORE its amount loop, so the Summary
message stays correct (no flip to "complete"). The flag SHAPE is unchanged (`notYet` boolean + `notYetCols` stay; only WHICH
cols populate changes). **Tests:** Vitest **197 -> 200** (+3): `priceability.test.ts` 24 -> 27. THREE existing
not_yet-on-a-needs_rate-row tests were updated to the new behavior (CALLED OUT): "not_yet fires when a formula needs a
not-yet-entered rate" -> flipped to assert `needsRate` true + `notYet` FALSE (single-area de-dupe); the option-(i) test's
A1 positive (`notYetCols.toContain("F")`) -> fixed to `needsRateAreas.toContain("A1")` + `notYetCols` has neither F nor I;
the "no regression STILL flags not_yet" test (whose premise is exactly inverted by the de-dupe) -> REMOVED, replaced by the
de-dupe block. FOUR new tests added (de-dupe block): per-area A1-rated-computes/A2-unrated-de-duped; non-rate not_yet
SURVIVES (rate filled, an uncomputed `amount_supply` operand referenced); broken NOT suppressed on a needs_rate row;
`isRowIncomplete` stays true for a needs_rate row. A non-needs_rate `not_yet`/`broken`/`qty_anomaly` test stays green
unchanged. tsc **3178 == baseline**, build exit 0. Only `priceability.ts` (+ its test) touched -- `PricingGrid` /
`SheetPricingPage` / `pricingRollup` / `boqTypes` / `SummaryPanel` UNTOUCHED.

