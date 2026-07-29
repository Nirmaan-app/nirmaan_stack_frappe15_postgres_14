### Phase 5 Pricing Editor -- Formula Builder F3 -- the click-to-insert builder UI (FRONTEND, feat 2026-06-23)

**Why + scope.** The per-amount-column editor: the user ASSEMBLES a formula by clicking the sheet's REAL columns +
operators (NO free text, NO numeric literals -- there is no number input, so literals are barred by construction),
validates it live (parse + the F2-reusing cycle check), and SAVES via the F1 `save_amount_formula`. Plus the amount-column
header `ƒ = …` label. **F3 only AUTHORS the formula + shows it on the header -- it does NOT wire the formula into the
grid's amount COMPUTE path (`findPairedRateDescriptor` stays; F4 swaps it).** So after F3 you can DEFINE formulas + see
them on headers, but amount cells don't recompute from them yet. `pricingRollup.ts`/`SummaryPanel` untouched; the
rate-edit / keyboard-nav / color / remark paths untouched (the header label is purely additive).

**The internal model (`formulaTokens.ts`, PURE + unit-tested -- the one risk spot).** The builder edits a flat ordered
TOKEN LIST (column chips / operators / brackets); on SAVE it PARSES that list into the F1 token TREE. `parseTokens(tokens)
-> {ok, tree} | {ok:false, error}` is a recursive-descent parser over the tiny grammar `expr = term ("+" term)*; term =
factor ("*" factor)*; factor = column | "(" expr ")"` -- **`×` binds tighter than `+`, brackets override, n-ary operands
flattened**, a single column -> a bare leaf. Errors: `ERR_EMPTY` / `ERR_DANGLING` (operator missing an operand) /
`ERR_UNBALANCED` (bracket). Other pure exports: `tokenRefForMode(d, mode)` (the DEFAULT-as-template transform, below),
`treeToTokens(tree, labelFor)` (hydrate the builder from a stored formula -- minimal brackets, round-trips through
parseTokens), `wouldCreateCycle(target, tree, existing)` (the cycle check -- **REUSES F2**: builds the prospective
formula set [existing minus same-identity + the new tree] and runs `evaluateAmountColumn(target, set, () => 1)`; a `× 1`
dummy lookup means only a CYCLE -- never a missing operand -- yields F2 "broken"; returns broken === cycle, NOT
reimplemented), `refKey`, `OPERAND_VALUE_FIELDS`.

**DEFAULT-as-template (the load-bearing subtlety).** Authoring a DEFAULT (wildcard) formula on a per-area column: the
palette chips for area-bound columns insert a **WILDCARD** leaf (`value_key = null`) so F2 binds it to the area being
computed -- the default is a TEMPLATE applied per area (the chip label shows the role WITHOUT an area; the per-area
duplicates collapse to ONE chip via refKey dedupe). Authoring an OVERRIDE (a concrete area): chips insert the CONCRETE
ref (`value_key` = the area). A scalar amount column: chips are concrete (value_key null = scalar, not wildcard). Encoded
in `tokenRefForMode(d, mode)`: default + area-bound -> wildcard; else concrete.

**The builder component (`AmountFormulaBuilder.tsx`, shadcn Popover -- ColorPicker/RemarkCell house style).** Renders BOTH
the header trigger (`ƒ = <preview>` from the column's APPLICABLE formula via F2's `pickFormula` precedence [override > default];
sublabel "default · all areas" / "this area"; or a faint "ƒ set formula" chip when none) AND the popover editor: title,
the **DEFAULT / THIS-AREA toggle** (shown ONLY on a per-area target -- `value_field === "amount_by_area" && value_key !=
null`; HIDDEN on a scalar amount column), a LIVE PREVIEW strip (info-tinted column chips + operator glyphs + a cursor), a
validity line (`Well-formed.` green / the parse error / `Circular reference…` red), the OPERATOR buttons (`+ × ( )` +
Backspace), the COLUMN PALETTE (qty/rate/amount operands from the sheet descriptors, grouped; the literal self-ref blocked,
amount-refs-OTHER-amount allowed), and the footer **Reset** (local empty) | **Remove** (commit blank = the F1 clear, shown
only when a saved formula exists for the mode) | **Save** (the ONLY formula-commit; DISABLED until parse-ok AND non-cyclic).
On open / mode-flip it HYDRATES the token list from the existing formula for that mode (`treeToTokens`). READ-ONLY when
`onSave` is withheld (locked / takeover / general-specs) -> the label is static text, no popover (the same
callback-presence gate rates/annotations use).

**Grid + page wiring.** `PricingGrid` gained two props -- `columnFormulas?: ColumnFormula[]` (drives the header label +
hydration + cycle check) + `onSaveFormula?: (AmountFormulaSaveArgs) => Promise<void>` -- and mounts
`<AmountFormulaBuilder>` inside each **amount-column** `<th>` (gated on `isAmountDescriptor(d)`); the amount-cell VALUE
render is byte-for-byte unchanged. `SheetPricingPage.handleSaveFormula` mirrors `handleSaveColor` (a `useFrappePostCall`
to `save_amount_formula`, in-flight count, takeover detection, `mutate()` so `column_formulas` refetches + the header
updates); the tree is sent as a JSON string, a null formula as `""` (the F1 clear path). `onSaveFormula` is withheld
(`locked ? undefined`) so a locked sheet's headers render read-only. New wire type `AmountFormulaSaveArgs` in `boqTypes.ts`.

**Tests + gates.** Vitest **110 -> 136** (+26 `formulaTokens.test.ts`): parser structure (leaf / sum / product /
precedence / bracket-override / realistic / n-ary flatten), errors (empty / dangling [leading/trailing/double] /
unbalanced [open/extra-close/empty-group]), `tokenRefForMode` (default-wildcard / override-concrete / scalar),
`treeToTokens` round-trips (qty×(a+b), (a+b)×(c+d), bare leaf), `wouldCreateCycle` (clean=false / self-ref=true / mutual=true
/ amount-refs-other-amount=false), `refKey`. tsc **3178 == baseline** (0 in the touched files). Vite build exit 0.

**SAVE-ARGS contract (live-cert + F4 reference).** The page POSTs `save_amount_formula({boq_name, sheet_name [VERBATIM],
committed_version, target_value_field, target_value_key [null=default/scalar | area=override], target_rate_subkey, formula
[JSON string | "" to clear], target_col, description})`.

**F4 hand-off -- MUST know.** (1) the header reads `get_priced_rows.column_formulas` (now typed); a formula DEFINED in F3
is visible on the header but does NOT yet drive the amount cell; (2) **F4 still owns the amount-cell COMPUTE swap** --
replace `findPairedRateDescriptor` (PricingGrid.tsx amount-cell branch) with `evaluateAmountColumn(col, columnFormulas,
lookup)`, falling back to the existing pairing when a column has no formula; (3) the builder authors DEFAULT formulas as
WILDCARD-operand templates -- F4's eval (F2) binds them per area, so F4 passes the concrete column (area as value_key) and
F2 binds; (4) F4's operand `lookup` reads the row mirroring `resolveDescriptorValue` (real-0 is a value, absent ->
undefined).

