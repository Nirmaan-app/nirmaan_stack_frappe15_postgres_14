### Phase 5 Pricing Editor -- Formula Builder F2 -- the pure evaluator (FRONTEND, pure module + Vitest, feat 2026-06-22)

**Why + boundary.** The RISK CORE of the formula feature: a wrong evaluator puts a wrong number on a tender document (a
§0 violation). Built in ISOLATION as a PURE, headless module and hammered with Vitest BEFORE any UI (F3) or grid wiring
(F4). `amountFormula.ts` imports NO React/DOM/Frappe, does NOT read a row, does NOT import `resolveDescriptorValue`
(types only). The CALLER (F4) resolves an operand ref to a value FOR THIS ROW/AREA and INJECTS it via a `lookup`
function; F2 only does tree-walk + `+`/`*` arithmetic + wildcard area-binding + amount-refs-amount dependency resolution
+ cycle detection + the fail-safe. PricingGrid / findPairedRateDescriptor / backend / UI all UNTOUCHED (F4/F3 own those).

**Types (in `boqTypes.ts` -- the house location for wizard wire types; deserialize a stored formula straight in).**
`AmountFormulaRef` {value_field, value_key: string|null, rate_subkey: string|null}; `AmountFormulaOperatorNode`
{op:"+"|"*", operands: AmountFormulaNode[]}; `AmountFormulaLeafNode` {ref}; `AmountFormulaNode` = operator | leaf (NO
literal node); `ColumnFormula` {target_value_field, target_value_key, target_rate_subkey, target_col, formula:
AmountFormulaNode|null} -- one `get_priced_rows.column_formulas` entry; and `GetPricedRowsResponse` gained
`column_formulas: ColumnFormula[]` (the F1 backend already emits the key; this types it). Field names MATCH F1's stored
shape exactly. The evaluator-only types (`EvalResult`, `OperandLookup`) live in `amountFormula.ts` (not wire types).

**The evaluator (`amountFormula.ts`).**
- `EvalResult` = `{ok:true, value:number}` | `{ok:false, reason:"not_yet"|"broken", detail?:string}`. F4 maps reason ->
  flag: **not_yet** = a needed operand legitimately absent (an un-priced rate / value not entered) -> the soft "needs a
  rate" 4b flag; **broken** = a cycle / malformed tree -> "check formula." NEVER throws on bad data.
- `OperandLookup = (ref: AmountFormulaRef) => number | null | undefined` -- the INJECTED, row-bound resolver F4 supplies.
  Returns a number for a real value (INCLUDING 0), or null/undefined when ABSENT (a missing key) -- MUST mirror
  `resolveDescriptorValue`'s absent-vs-zero rule. F2 calls it only for columns WITHOUT a formula (every qty/rate operand,
  and any amount operand that is a plain stored value).
- **Entry: `evaluateAmountColumn(col, formulaSet, lookup)`** (+ a convenience `evaluateAllColumns(set, lookup) ->
  Map<columnKey, EvalResult>`). `col` is the CONCRETE target column {value_field, value_key: concrete area | null for
  scalar, rate_subkey}. Internally `evalColumn` picks the formula (`pickFormula`: OVERRIDE [concrete target_value_key ===
  the area] > DEFAULT [target_value_key === null], matched on value_field+rate_subkey); if none -> `lookup(col)` (a plain
  stored value -> ok / not_yet); if a formula applies -> cycle-guard then walk its tree.
- **Area-binding signal (the chosen discriminator -- entirely data-driven, NO extra field):** a leaf ref binds via
  `bindRef(ref, bindArea)` where `bindArea = the column's value_key`. A WILDCARD leaf (value_key === null AND value_field
  ∈ {qty_by_area, rate_by_area, amount_by_area}) binds to `bindArea`; a SCALAR leaf (null value_key on a scalar
  value_field) is NEVER bound; a concrete value_key is kept as-is; a null `bindArea` (a scalar target) binds nothing. So
  "wildcard null" vs "scalar null" is told apart by the VALUE_FIELD (area-bound set vs not) -- no discriminator field
  needed (the STOP-condition the brief flagged does NOT fire).
- **amount-refs-amount + dependency order:** a leaf whose column has its OWN formula is resolved by RECURSION through
  `evalColumn` (dependency order falls out of the recursion); a leaf whose column has NO formula falls back to `lookup`
  (qty/rate always; a plain stored amount). **Cycle detection:** a `visiting` Set of `columnKey`s on the recursion path;
  re-entering a key -> `{ok:false, reason:"broken", detail:"cycle"}` (covers A<->B and self-cycle A->A).
- **FAIL-SAFE (§0 core):** an operator folds operands; if ANY operand is not ok the WHOLE node is not ok -- NO partial
  sum, NO zero-substitution (a missing operand is NEVER 0; a real 0 IS a value). Reason priority: **broken beats not_yet**
  (a structural problem surfaces ahead of a merely-unpriced one). A malformed node (neither valid operator nor valid leaf,
  bad op, empty operands) -> broken (defensive -- F1 already structurally validates at save; F2 never throws). A
  non-numeric/NaN lookup -> a fail-safe not_yet, never an exception.
- **DESIGN NOTE (reported fork):** a leaf ref to a genuinely NON-EXISTENT column surfaces as **not_yet**, not broken --
  F2's number|undefined lookup cannot distinguish "no such column" from "value absent," and over-flagging "check formula"
  on a merely-unpriced cell is worse. F4, which HAS the descriptor set, may pre-validate refs and flag a dangling ref as
  broken before calling F2.

**Tests (`amountFormula.test.ts`, +29; Vitest 81 -> 110, all green).** arithmetic `*`/`+`/nesting-as-precedence/deep
nesting/single-leaf-root; multi-area wildcard binding (area A vs B distinct) + override-wins-over-default; scalar-null NOT
area-bound (mixed scalar+area operand) + `bindRef` direct; amount-refs-amount (grand = supply + install, each a formula)
+ amount-operand-without-formula falls back to lookup; cycle A<->B / self / through-operator / broken-beats-not_yet;
fail-safe `+`-missing (NOT the partial addend) / `*`-missing / nested-missing / amount-operand-missing-propagates;
absent-vs-zero (real 0 -> ok value 0; missing -> not_yet; proven side-by-side); malformed-node / bad-op / empty-operands
-> broken; NaN lookup never throws; no-declared-formula -> stored lookup; `pickFormula` precedence + `evaluateAllColumns`/
`columnKey`. tsc 3178 (== baseline, 0 in the touched files). Vite build exit 0.

**F3 (builder UI) + F4 (grid wiring) hand-off -- MUST know.** (1) `EvalResult` shape + reason->flag (not_yet = "needs a
rate"; broken = "check formula"); (2) the injected `OperandLookup` contract (concrete ref -> number|undefined, real-0 is
a value, mirror resolveDescriptorValue) -- F4 satisfies this by reading the PricedRow; (3) the area-bind signal (F4 passes
the concrete column with its area as value_key; F2 binds wildcard operands itself -- F4 does NOT pre-bind); (4) the entry
`evaluateAmountColumn(col, columnFormulas, lookup)` is called per amount cell, with `columnFormulas` from
`get_priced_rows.column_formulas`; (5) F4 REPLACES the `findPairedRateDescriptor` seam (PricingGrid.tsx:1277-1300) with
this call; (6) a dangling-ref-to-broken upgrade, if wanted, is F4's pre-validation against its descriptor set.

