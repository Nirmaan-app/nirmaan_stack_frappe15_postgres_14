### Amount-column formula-status badge (FRONTEND, display + trigger relocation, NO migrate, base tip 0ec97fcc, 2026-06-21)

**Problem.** After the mandatory formula gate the user had no per-column guidance -- which amount columns still NEED a
formula (pending) vs which are DONE. The only formula affordance was the `AmountFormulaBuilder` trigger, rendered as a
small *secondary line UNDER* each amount column's label, far right, in a narrow `<th>`. A read-only recon
(Checklist-B PASS) established: (1) that far-right "blue thing" is NOT a passive status light -- it IS the EDITOR TRIGGER
(the `PopoverTrigger`), showing a blue `tokensToText` preview when a formula resolves and "set formula" when not; and
(2) its "sometimes doesn't render / easy to miss" behavior is a **layout/visibility** problem (a tiny truncated 2nd line
on far-right, often-scrolled-off, narrow columns) -- **NOT a data bug**: the control already used `pickFormula` correctly
(wildcard-aware), and the recon Q6 cross-check found NO gate-vs-column disagreement (VRF's 9 cols / 6 records all resolve).

**Owner-approved design (option (a) -- MERGE status + trigger into ONE control).**
- A leading `ƒ` STATUS BADGE at the START of each amount column `<th>`, BEFORE the label: **AMBER** when the column has
  no covering formula (pending), **GREEN** when covered. The badge **IS the `PopoverTrigger`** -- clicking it opens the
  SAME `AmountFormulaBuilder` popover (all builder logic / `onSave` / structural validation / cycle-check UNCHANGED;
  only the trigger's look + position changed).
- The redundant far-right secondary preview line is **REMOVED** (its blue preview is superseded by the badge; the full
  formula still shows in the popover and rides the badge `title`). **Relocating the trigger to the prominent leading
  badge IS the render-bug fix.**
- A subtle full-`<th>` **amber tint** (`bg-amber-50 dark:bg-amber-950/40`, mirroring the gate banner) washes PENDING
  amount columns so a wide sheet (VRF 9 cols) is scannable at a glance; covered/non-amount columns keep neutral `bg-muted`.
- The page-level "Declare amount formulas to enable rate entry." banner is unchanged.

**Badge⇔gate agreement (by construction).** NEW pure `priceability.isAmountColumnCovered(d, columnFormulas)` =
`!!(pickFormula({value_field,value_key,rate_subkey}, columnFormulas)?.formula)` is the SINGLE per-column coverage
predicate; `areFormulasComplete` now folds `.every()` over it (behavior IDENTICAL -- its tests stay green). So **every
amount column GREEN ⇔ `areFormulasComplete` true ⇔ rate gate open + banner hidden.** The badge color reuses
`AmountFormulaBuilder`'s already-computed `applicable = pickFormula(...)` (`covered = !!(applicable && applicable.formula)`
-- the SAME resolution, no second path). **No import cycle:** `AmountFormulaBuilder` does NOT import `priceability` (it
uses its local `applicable`), and the `<th>` tint check is `pickFormula` **inline** in `PricingGrid` (already imported
from `amountFormula.ts`), NOT `priceability.isAmountColumnCovered` -- importing priceability into PricingGrid would
reverse the one-way dependency (priceability imports PricingGrid) into a cycle, the SAME reason `isNonZeroNum` is a
self-contained copy in PricingGrid. All three (gate fold, badge color, tint) share `pickFormula`'s override>area-wildcard
resolution, so none can drift. (This is a deliberate, recorded deviation from the build brief's literal "use
isAmountColumnCovered in PricingGrid" -- the equivalent inline `pickFormula` preserves the badge⇔gate guarantee without
the forbidden cycle.)

**Read-only branch preserved.** When `onSaveFormula` is withheld (locked / taken-over / general-specs) the badge renders
as a STATIC amber/green glyph with NO popover -- status always visible, editing gated by `onSave` exactly as before.

**Display-only.** The amount-column header is in `<thead>`, OUTSIDE the memoized `PricingGridRow` -- so a badge/tint
re-render is free. UNTOUCHED: the gate logic / `formulasComplete` result, the rate-edit gate / override,
`isRateEditableRow` / `isPriceableLine` / flags / count / rollup, the perf memo + `pricingRowPropsAreEqual`, the builder
popover / `onSave` / validation / cycle-check, `pickFormula` / `amountFormula.ts`, all backend/schema/migrate. Non-amount
columns get no badge + no tint.

**Files.** `priceability.ts` (+`isAmountColumnCovered`, `areFormulasComplete` refactor), `AmountFormulaBuilder.tsx`
(trigger -> leading badge; dropped `FunctionSquare` import + the preview-line markup), `PricingGrid.tsx` (badge moved
before the label inside an `inline-flex` span; amber `<th>` tint via inline `pickFormula`), `priceability.test.ts` (+6).

**Verification.** vitest 235 -> 241 (priceability 36 -> 42: `isAmountColumnCovered` covered-by-override / covered-by-
wildcard-both-areas / uncovered / cleared-null-formula / scalar / the `areFormulasComplete == every isAmountColumnCovered`
agreement). No RTL in this env, so the badge RENDER is not unit-tested -- the underlying coverage boolean is. tsc 3175 (0
new, 0 in boq-wizard/boqTypes); in-container Vite build exit 0. Manual live-cert (owner; current live state per recon Q6:
only 145 Fire Fitting 0/2 is uncovered -- use it for amber, or remove a formula to manufacture amber): LC1 amber badge +
amber `<th>` tint on an uncovered amount col (rates locked + banner); LC2 green badge + neutral tint on a covered col;
LC3 click badge -> builder popover opens -> declare/edit -> badge flips amber->green + tint clears + (if last uncovered)
rates unlock + banner clears; LC4 VRF one wildcard default flips MULTIPLE per-area badges green at once; LC5 the far-right
preview line is GONE; LC6 read-only/locked sheet -> badge shows status but click does NOT open the builder; LC7-9
no-regression (declare/edit works as before; gate still every-green⇔editable; perf intact, non-amount headers unchanged).
Pending Nitesh.

