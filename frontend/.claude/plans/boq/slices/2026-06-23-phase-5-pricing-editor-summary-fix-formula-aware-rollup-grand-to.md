### Phase 5 Pricing Editor -- Summary fix -- formula-aware rollup + grand-total row + reconciliation guard (FRONTEND, fix 2026-06-23)

**Why.** A bug the F4 arc introduced on the SUMMARY side: `pricingRollup.rowOwnAmount` computed each row's own amount via
the OLD `findPairedRateDescriptor` -> `computeAmount` path that F4 replaced in the grid, so a formula-only amount column
(no paired rate -- e.g. a split supply+install -> single-total) rolled up **ZERO** while the grid cell (F4) showed the
right number. Observed: Alorica summary zero throughout; Electrical Phase 1 correct but Phase 2 zero. Plus two
owner-requested additions: a per-column grand-total row + an Option-1-vs-Option-2 integrity check.

**LOCKED (owner-settled):** SAVE-TIME summary (Option A -- saved values only, `draftRates` NOT threaded; edits auto-save via
the 1s debounce + `mutate()`, so the summary updates a beat after each edit -- VERIFIED `scheduleAutoSave`/`commitRate`/
`mutate()`); not_yet/broken rows FOLD TO 0 (treat-as-0; the 4b "incomplete subtotal" marker DEFERRED); grand total =
Option 1; on a reconciliation mismatch SHOW the Option-1 value AND the banner; the fix is ADDITIVE (no-formula columns
byte-for-byte unchanged -- the D-2 guard).

**(1) The zero-fix (`pricingRollup.rowOwnAmount`, formula-aware-when-a-formula-applies).** `rollupByParent(rows,
columnDescriptors, columnFormulas = [])` gains the (defaulted) param, threaded to `rowOwnAmount(row, amountD, descriptors,
columnFormulas)`. `rowOwnAmount` now: `pickFormula(concreteCol, columnFormulas)` (F2 precedence override>default, REUSED) --
**HAS a formula** -> `evaluateAmountColumn(concreteCol, columnFormulas, (ref) => lookupOperandValue(row, ref, descriptors,
{}))` -- the **saved-only** lookup is F4's `lookupOperandValue` with EMPTY draftRates (the draft branch is skipped, so a
rate reads its saved-WHEN-PRICED value; un-priced -> undefined -> not_yet -> null); `ok` -> value, `not_yet`/`broken` ->
null (folds to 0). **NO formula** -> the EXISTING `findPairedRateDescriptor` -> `computeAmount` path, **byte-for-byte
unchanged** (deliberately NOT routed through `evaluateAmountCell`, whose priced-gate differs from this committed-rate
recompute -- the D-2 regression guard). No circular import (`pricingRollup` already imports from `PricingGrid`; the reverse
does not).

**(2) Grand total (Option 1) + (3) reconciliation (Option 2).** Added to `RollupResult`: `grandTotals: Record<col,
number>` = the sum of the TOP-LEVEL nodes' rolled totals (root orphans are roots, so each line item is counted once),
and `integrityErrors: IntegrityError[]`. The cross-check Option 2 = the flat sum of EVERY row's own amount (same
treat-as-0, same saved-only) -- for a well-formed acyclic forest Option 1 === Option 2 by construction; they diverge ONLY
when the tree is structurally corrupted (e.g. a cycle truncates a subtree). Per column, `|opt1 - opt2| > max(0.01, 1e-9 *
max(|o1|,|o2|))` (absolute floor + relative term so float dust never false-fires) -> an `IntegrityError {col, label,
option1, option2}`.

**(4) Render (`SummaryPanel.tsx`).** New prop `columnFormulas: ColumnFormula[]` (threaded `SheetPricingPage` -> panel ->
`rollupByParent`; the page already derives it at `:227`). A sticky-bottom `<tfoot>` **Grand total** row (bold + strong top
border) renders `grandTotals[col]` per amount column. On any mismatch an amber `AlertTriangle` **integrity banner** (above
the table) names each failing column + BOTH numbers ("tree total X vs line-item total Y"); the grand-total row STILL shows
the Option-1 value (diagnostic, not suppressed). `fmtAmount` unchanged (0 -> "0").

**Tests + gates.** Vitest **155 -> 163** (+8 in `pricingRollup.test.ts`): zero-fix (without-formula Phase 2 rolls up 0 [the
bug] / with-formula Phase 2 contributes + Phase 1 unchanged / D-2 regression Phase-1-identical / not_yet folds to 0 /
cycle folds to 0); grand total (top-level rolled incl. root orphan, counted once / fractional reconciles, epsilon no
false-fire / corrupted 2-cycle FIRES the integrity check). The existing 11 rollup tests (all no-formula) stay green = the
D-2 regression proof. tsc **3178 == baseline** (0 in touched files). Vite build exit 0. The grid amount-cell compute /
rate-save / nav / color / remarks / backend / `draftRates` -- all UNTOUCHED (this is the SUMMARY side, saved-only).

