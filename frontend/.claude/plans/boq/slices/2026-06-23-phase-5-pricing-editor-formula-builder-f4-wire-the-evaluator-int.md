### Phase 5 Pricing Editor -- Formula Builder F4 -- wire the evaluator into the grid (the finale) (FRONTEND, feat 2026-06-23)

**Why + scope.** The LAST slice of the formula arc: replace the amount-cell value-compute in `PricingGrid.tsx` (the old
`findPairedRateDescriptor` -> qty x ONE paired rate) with a call to F2's evaluator, so amounts finally RECOMPUTE from
user-defined formulas -- **killing the supply+install -> single-total STALE-AMOUNT bug at the root** (that case has
separate supply + install rate columns but one total-amount column, which `findPairedRateDescriptor` returns null for ->
the cell fell back to the stale committed value). Additive-by-precedence: **formula-wins, else the UNCHANGED pairing.**
F4 touches ONLY the amount-cell VALUE compute -- rate-edit/save, keyboard-nav, color, remarks, the formula storage/builder
(F1/F3), and the evaluator (F2) are all untouched. `pricingRollup.ts`/`SummaryPanel` (the cross-row subtotal surface) is
NOT edited -- it benefits AUTOMATICALLY where it reuses the per-row amount via the shared `computeAmount`/pairing.

**The swap (`PricingGrid.tsx`, all in one PURE exported helper `evaluateAmountCell`).** The amount-cell render is now a
thin map over `evaluateAmountCell(d, row, columnDescriptors, columnFormulas, draftRates) -> AmountCellResult` (`{kind:
"value", value}` | `{kind:"committed"}` | `{kind:"blank", reason:"not_yet"|"broken"}`). Logic:
- pick the applicable formula via F2 `pickFormula` (per-area OVERRIDE for this area > area-WILDCARD DEFAULT > none) --
  REUSED, not reimplemented;
- **HAS a formula:** pre-validate the operand refs (`validateFormulaRefs` -- below), then `evaluateAmountColumn(concreteCol,
  columnFormulas, lookup)`. F4 passes the CONCRETE column (its area as `value_key`); **F2 binds the wildcard default's
  operands to that area itself -- F4 never pre-binds.** `ok` -> value; `not_yet`/`broken` -> blank;
- **NO formula:** the EXISTING `findPairedRateDescriptor` -> `computeAmount(qty, rate)` path, byte-for-byte (rate via the
  optimistic draft / the saved-when-priced value; else the committed value). The old `pairedRateByAmountCol` precompute is
  retired (the helper computes the pairing internally).

**The injected operand lookup (`lookupOperandValue`, the one place F4 is more than a swap).** Mirrors
`resolveDescriptorValue`'s absent-vs-zero contract (real 0 -> 0; a missing key -> undefined; NEVER 0-substituted). It maps
a ref to its descriptor (exact `value_field`/`value_key`/`rate_subkey` match) and resolves: a **RATE** operand is
DRAFT-AWARE -- `draftRates[`${row_index}:${rateCol}`]` if editing (live recompute, blank/NaN -> 0), else the saved rate
when priced, else undefined (un-priced -> the formula blanks "needs a rate"); a **QTY / plain-AMOUNT** operand reads its
stored value. This is the real change from the old single-paired-rate read: a formula references MULTIPLE rate operands
and F4 resolves the draft for EACH, so the amount updates live as you type any of them.

**Dangling-ref pre-validation (`validateFormulaRefs` -- the upgrade F2 deferred to F4).** F2 surfaces a ref to a
non-existent column as `not_yet` (it can't tell "no such column" from "absent value"). F4 HAS the descriptor set, so it
walks the applicable formula's DIRECT leaf refs, binds each (`bindRef`) to the concrete area, and checks each matches a
live descriptor; a ref matching NONE -> **broken** ("check formula"), not a silent not_yet -- the correctness gate that
catches a formula orphaned by a re-commit that moved/removed columns. Scope: each amount column pre-validates its OWN
formula at its OWN cell (a transitive dangling ref surfaces broken at that column's cell).

**Render of the fail-safe (the §0 core).** `value` -> the number (`renderDescriptorCell`/`fmtNum`, unchanged); `committed`
-> the stored committed amount (the no-formula/un-priced fallback); `not_yet` -> BLANK + `title="Needs a rate"`; `broken`
-> BLANK + a small `AlertTriangle` destructive marker + `title="Check formula"`. **NEVER a stale/wrong number when a
formula applies but can't resolve.** Flag wiring into the review-list seam (4a's `{kind, excelRow, description, text}`
list) is a 4b concern -- F4 leaves the cell blank + the per-cell marker/title hook; surfacing entries UP to the page is
deferred (recorded for 4b).

**Tests + gates.** Vitest **136 -> 155** (+19 in `PricingGrid.test.ts`): `lookupOperandValue` (draft / saved-priced /
un-priced->undefined / qty stored / real-0 / missing), `validateFormulaRefs` (all-match / dangling / wildcard-binds),
`evaluateAmountCell` formula-wins (THE BUG FIX: qty x (supply+install) recomputes from drafts; single-draft + saved /
missing-rate->not_yet / real-0->0 / cycle->broken / dangling->broken) + no-formula fallback (draft pairing / saved pairing
/ un-priced->committed / no-pair->committed / per-area override-wins). All existing PricingGrid tests green. tsc **3178 ==
baseline** (0 in touched files). Vite build exit 0. **F2 unchanged** (no edit -- `pickFormula`/`evaluateAmountColumn`/
`bindRef` were already exported).

**FORMULA ARC F1-F4 COMPLETE.** F1 storage (doctype + endpoints) -> F2 pure evaluator -> F3 click-to-insert builder ->
F4 grid compute swap. The stale-amount bug is fixed for the case it was born to fix. Still owed (later, not this arc): the
4b flag layer surfacing not_yet/broken into the review-list, and live-cert on BOQ-26-00145.

