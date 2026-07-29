### Mandatory amount-formula gate (FULL-STACK, NO migrate, base tip 31369808, 2026-06-24)

**What + why.** Amount formulas (F1-F4) were OPTIONAL. The owner wants them MANDATORY before pricing: every amount column on
a sheet must have a declared builder formula before ANY rate cell on that sheet is editable. This REVERSES the F1-F4
"formula optional" property. The gate is **ABSOLUTE** -- the "Price any row" override (`allow_non_priceable`) does NOT bypass
it (override loosens ONLY the type/qty axis). Declaration must stay live while rates are locked (else the gate is
unsatisfiable). NO migrate -- the gate READS the existing `BoQ Cell Amount Formula` storage.

**The completeness predicate (per-COVERAGE, NOT per-record).** A sheet is COMPLETE iff for EVERY amount column descriptor
`d` (`isAmountDescriptor(d)`), `pickFormula({value_field, value_key, rate_subkey}, columnFormulas)` returns a record with a
non-null `.formula`. "Covered" is `pickFormula`'s override>area-wildcard-default resolution: an area-WILDCARD default
(`target_value_key=null`) covers ALL per-area amount columns sharing its `(value_field, rate_subkey)`; a per-area OVERRIDE
covers its own column; a CLEARED record (null `.formula`) does NOT count. A sheet with **zero** amount columns is
**TRIVIALLY complete** (rate editing NOT blocked). This REUSES the EXACT `pickFormula` resolution `evaluateAmountCell` uses,
so completeness can never drift from how amounts compute.

**Client threading (override-proof).** `priceability.areFormulasComplete(columnDescriptors, columnFormulas)` (new pure
export; imports `pickFormula` from the leaf `amountFormula.ts` -- no cycle). `SheetPricingPage` computes
`const formulasComplete = areFormulasComplete(columnDescriptors, columnFormulas)` (data already in hand from
`get_priced_rows` -- NO new fetch) and passes it as a NEW per-SHEET prop `formulasComplete?: boolean` (**default TRUE**,
back-compat). The grid ANDs it OUTSIDE `isRateEditableRow`:
`onSaveRate && formulasComplete && isRateDescriptor(d) && isRateEditableRow(row, override)` -- the override lives INSIDE
`isRateEditableRow`, so it can NEVER reach past `formulasComplete`. Added to `PricingGridRowProps` AND
`pricingRowPropsAreEqual` (memo-safe: a per-sheet boolean flips identically for all rows -> a flip re-renders all rows ONCE).
`onSaveFormula`/the `AmountFormulaBuilder` mount is UNTOUCHED (gated only by `isAmountDescriptor(d) && onSaveFormula`), so
declaration works under the gate. A `SheetPricingPage` amber banner "Declare amount formulas to enable rate entry." shows
when `!isGridOnly && !locked && !pricedLoading && !pricedError && !formulasComplete`.

**Server restructure (override-proof).** `pricing.py`: NEW `_formula_target_matches_column(target_vf, target_vk, target_rk,
column)` -- the SHARED override-or-wildcard primitive, now backing BOTH `save_amount_formula`'s target-gate AND the new
`_formula_covers(column, current_records)` / `_sheet_formulas_complete(boq, sheet, version)` (over
`_committed_amount_descriptors` + `_current_formula_records`; `[]` amount cols -> True). The throw
(`title="Formulas incomplete"`) sits in `save_cell_price` AFTER `_resolve_committed_cell` and OUTSIDE/BEFORE the
`if not _coerce_bool(allow_non_priceable):` block (so override can't skip it) and BEFORE the lock/freeze/insert
(reject-mutates-nothing). `save_amount_formula` is NOT gated (declaration under the gate). **Live re-gate:** removing a
formula flips completeness back to false (re-locking) as a natural consequence of the live `column_formulas` read.

**Q7 magnitude (current committed versions, owner-confirmed, intended -- the gate LOCKS existing sheets until declared):**

| BoQ | Sheet | amount cols | declared | post-gate |
|---|---|---|---|---|
| 145 | Electrical | 2 (F,I) | 1 | LOCKED |
| 145 | HVAC | 2 (F,I) | 1 | LOCKED |
| 145 | Fire Fitting | 2 (F,I) | 0 | LOCKED |
| 145 | FAS | 0 | 0 | editable (trivially complete) |
| 150 | low side | 1 (G) | 1 | editable |
| 166 | VRF System | 9 (Q-Y) | 0 | LOCKED (1 wildcard default per kind unlocks all 9) |

**Tests + verification.** Backend `test_pricing` 104 -> 110: a shared `_declare_fixture_amount_formulas(boq, sheet, cv)` (two
wildcard defaults -- the per-area fixture's two amount cols carry DIFFERENT rate_subkeys total+install) declared in the
setUpClass of the 7 fixture-pricing classes (TestCellPricing / TestGetPricedRows / TestSingleEditorLock /
TestLockPerSheetIsolation [both sheets] / TestPriceabilityGuard [restores the priceability-message ordering --
formula-gate-before-priceability] / TestPreambleQtyBearingGuard / TestCellDismissal) so they stay green; NEW
`TestMandatoryFormulaGate` (+6): the predicate (true / partial-false / zero-cols-true), `save_cell_price` throws "Formulas
incomplete" EVEN WITH `allow_non_priceable=True` + reject-mutated-nothing (no price row, no lock), success once complete,
declaration works while locked. The `column_formulas`-assertion tests (in TestAmountFormula -- NOT one of the 7) are
untouched (the per-class approach, not a centralized fixture change, leaves them green). Frontend vitest 226 -> 235
(priceability 30->36 `areFormulasComplete`; PricingGrid 106->109 the comparator + the override-can't-bypass composition).
tsc 3175 (0 new wizard errors). In-container Vite build exit 0. Two commits (feat + docs).

**Manual live-cert (pending Nitesh, on 145/150/166).** 1) incomplete sheet (145 Fire Fitting / 166 VRF) -> rate cells
READ-ONLY + banner. 2) override ON on the incomplete sheet -> STILL read-only (the load-bearing override-can't-bypass
check). 3) declare the missing formula(s) via the header builder while rates are locked (must work). 4) VRF: ONE
wildcard-default declaration unlocks all 9 per-area amount cols. 5) complete sheet (150 low side) -> editable, no banner.
6) remove a formula on a now-complete sheet -> re-locks + banner returns. 7) on a complete sheet the asymmetric
Preamble/Line-Item gate still applies. 8) perf / acknowledge re-arm / markers / annotations / lock intact. Divergence in
7-8 = regression.

