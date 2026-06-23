/**
 * amountFormula -- the PURE amount-formula evaluator (BoQ Phase 5 Formula Builder F2).
 *
 * Evaluates an amount-formula token tree (the shape F1 stores; see boqTypes
 * AmountFormulaNode) against ONE row's already-resolved operand values, and returns a
 * DISCRIMINATED result: a real number, or a typed blank reason. This is the engine F4 will
 * call per amount cell per row. It is the RISK CORE of the formula feature -- a wrong
 * evaluator puts a wrong number on a tender document -- so it is built headless and hammered
 * with unit tests (amountFormula.test.ts) BEFORE any UI (F3) or grid wiring (F4).
 *
 * PURITY (the locked boundary): this module imports NO React / DOM / Frappe, does NOT read a
 * ReviewRow / PricedRow, and does NOT import resolveDescriptorValue. The CALLER (F4) resolves
 * an operand ref to a value for THIS row/area and injects it via the `lookup` function. F2
 * only does: tree-walk, +/* arithmetic, area-binding of wildcard refs, amount-refs-amount
 * dependency resolution, cycle detection, and the fail-safe. Deterministic + side-effect-free.
 *
 * FAIL-SAFE (the section-0 core): ANY operand anywhere in a formula's tree that resolves to
 * missing (undefined/null) makes the WHOLE formula blank -- NO partial sums, NO
 * zero-substitution (a missing operand is NEVER treated as 0; a real 0 IS a real value). A
 * cycle / malformed tree / a ref to a non-existent column is "broken." The evaluator NEVER
 * throws on bad data -- a missing/odd operand is a fail-safe result, so the grid never crashes
 * on one bad cell.
 */
import type {
  AmountFormulaNode,
  AmountFormulaRef,
  ColumnFormula,
} from "./boqTypes";

// The per-area (area-bound) value_fields: a leaf ref with value_key === null on one of these
// is a WILDCARD that binds to the area being computed. Every other value_field is SCALAR --
// a null value_key there means "scalar," NOT "wildcard," and is NEVER area-bound. Mirrors
// PricingGrid's PER_AREA_* consts (kept in sync; not imported -- F2 stays free of PricingGrid).
const AREA_BOUND_VALUE_FIELDS = new Set(["qty_by_area", "rate_by_area", "amount_by_area"]);

/**
 * The discriminated evaluation result. F4 maps `reason` to a cell flag:
 *   - "not_yet": a needed operand is legitimately absent (an un-priced rate, a value not yet
 *     entered) -> the normal "needs a rate / not computable yet" state (the 4b flag covers it).
 *   - "broken":  a cycle, a malformed tree, or a ref to a column that cannot be resolved ->
 *     "check formula." A structural problem, distinct from "just not priced yet."
 */
export type EvalResult =
  | { ok: true; value: number }
  | { ok: false; reason: "not_yet" | "broken"; detail?: string };

/**
 * The injected operand lookup F4 satisfies: resolve ONE concrete operand ref (value_key is the
 * concrete area, or null for a scalar field -- F2 has already bound any wildcard) to its value
 * for the current row. Return a number for a real value (including 0), or null/undefined when
 * the value is ABSENT (a missing key). MUST mirror resolveDescriptorValue's absent-vs-zero
 * rule: a missing key -> undefined; a real 0 -> 0. F2 calls this only for columns WITHOUT a
 * formula (every qty/rate operand, and any amount operand that is a plain stored value).
 */
export type OperandLookup = (ref: AmountFormulaRef) => number | null | undefined;

/** A concrete column identity (value_key is a concrete area, or null for scalar). */
type Column = AmountFormulaRef;

/** The cycle / memo key for one concrete column identity (pipe-joined; fields are a fixed
 *  vocab and areas never contain a pipe, so this is collision-free). */
function columnKey(col: Column): string {
  return [col.value_field, col.value_key ?? "null", col.rate_subkey ?? "null"].join("|");
}

/**
 * Bind a leaf ref to a concrete column: a WILDCARD leaf (value_key === null on an area-bound
 * value_field) binds to `bindArea`; a leaf already carrying a concrete value_key is used as-is;
 * a SCALAR leaf (null value_key on a scalar value_field) is NEVER bound (stays scalar). When
 * `bindArea` is null/undefined (a scalar target has no area) nothing binds.
 */
export function bindRef(ref: AmountFormulaRef, bindArea: string | null | undefined): Column {
  if (
    ref.value_key === null &&
    bindArea !== null &&
    bindArea !== undefined &&
    AREA_BOUND_VALUE_FIELDS.has(ref.value_field)
  ) {
    return { value_field: ref.value_field, value_key: bindArea, rate_subkey: ref.rate_subkey };
  }
  return ref;
}

/**
 * Pick the formula that applies to one CONCRETE column, with OVERRIDE > DEFAULT precedence:
 *   - a per-area column (value_key is a concrete area): an override whose target_value_key ===
 *     that area wins; else the area-wildcard default (target_value_key === null).
 *   - a scalar column (value_key === null): the lone target_value_key === null formula.
 * Matched on (target_value_field, target_rate_subkey) too. Returns null when no formula applies
 * (every qty/rate column, and any amount column with no declared formula -> a plain lookup).
 */
export function pickFormula(col: Column, formulaSet: ColumnFormula[]): ColumnFormula | null {
  const sameAxis = (f: ColumnFormula) =>
    f.target_value_field === col.value_field && f.target_rate_subkey === col.rate_subkey;
  if (col.value_key !== null) {
    const override = formulaSet.find((f) => sameAxis(f) && f.target_value_key === col.value_key);
    if (override) return override;
  }
  return formulaSet.find((f) => sameAxis(f) && f.target_value_key === null) ?? null;
}

/** Is this node a well-formed operator node? (Defensive -- F1 structurally validates at save.) */
function isOperatorNode(
  node: AmountFormulaNode,
): node is { op: "+" | "*"; operands: AmountFormulaNode[] } {
  const n = node as { op?: unknown; operands?: unknown };
  return (
    (n.op === "+" || n.op === "*") &&
    Array.isArray(n.operands) &&
    n.operands.length > 0
  );
}

/** Is this node a well-formed leaf ref node? */
function isLeafNode(node: AmountFormulaNode): node is { ref: AmountFormulaRef } {
  const n = node as { ref?: unknown };
  return !!n.ref && typeof n.ref === "object";
}

/**
 * Evaluate one CONCRETE amount column for the current row. If the column has a declared
 * formula (override > default), evaluate its tree (recursively resolving amount-operand refs
 * through their own formulas, in dependency order, with cycle detection); otherwise look the
 * column's stored value up (the F4-injected lookup). `visiting` carries the in-progress column
 * keys for cycle detection (a fresh Set per top-level call).
 */
function evalColumn(
  col: Column,
  formulaSet: ColumnFormula[],
  lookup: OperandLookup,
  visiting: Set<string>,
): EvalResult {
  const formula = pickFormula(col, formulaSet);

  // No declared formula -> a plain stored value (qty / rate / un-computed amount).
  if (!formula || !formula.formula) {
    const v = lookup(col);
    if (v === null || v === undefined) return { ok: false, reason: "not_yet" };
    if (typeof v !== "number" || Number.isNaN(v)) {
      // A non-numeric lookup is bad data, not a value -- fail safe, never throw.
      return { ok: false, reason: "not_yet" };
    }
    return { ok: true, value: v };
  }

  // A formula applies -> cycle guard, then evaluate its tree bound to this column's area.
  const key = columnKey(col);
  if (visiting.has(key)) {
    return { ok: false, reason: "broken", detail: "cycle" };
  }
  const nextVisiting = new Set(visiting);
  nextVisiting.add(key);
  return evalNode(formula.formula, formulaSet, lookup, nextVisiting, col.value_key);
}

/**
 * Evaluate one token-tree node. An operator folds its operands (`*` product, `+` sum); a leaf
 * binds its ref to `bindArea` and recurses through evalColumn. FAIL-SAFE: if ANY operand is
 * not ok, the whole node is not ok -- "broken" wins over "not_yet" (a structural problem is
 * surfaced ahead of a merely-unpriced one), with NO partial sum and NO zero-substitution. A
 * malformed node (neither a valid operator nor a valid leaf) is "broken" (never thrown).
 */
function evalNode(
  node: AmountFormulaNode,
  formulaSet: ColumnFormula[],
  lookup: OperandLookup,
  visiting: Set<string>,
  bindArea: string | null,
): EvalResult {
  if (isLeafNode(node)) {
    const col = bindRef(node.ref, bindArea);
    return evalColumn(col, formulaSet, lookup, visiting);
  }
  if (isOperatorNode(node)) {
    let acc = node.op === "*" ? 1 : 0;
    let sawNotYet = false;
    let sawBroken = false;
    for (const operand of node.operands) {
      const r = evalNode(operand, formulaSet, lookup, visiting, bindArea);
      if (!r.ok) {
        if (r.reason === "broken") sawBroken = true;
        else sawNotYet = true;
        continue; // keep scanning so "broken" can win the reason; arithmetic is abandoned
      }
      acc = node.op === "*" ? acc * r.value : acc + r.value;
    }
    if (sawBroken) return { ok: false, reason: "broken" };
    if (sawNotYet) return { ok: false, reason: "not_yet" };
    return { ok: true, value: acc };
  }
  // Neither a valid operator nor a valid leaf -> malformed (slipped past F1) -> broken.
  return { ok: false, reason: "broken", detail: "malformed-node" };
}

/**
 * THE ENTRY POINT (F4 calls this per amount cell). Evaluate ONE concrete amount column for the
 * current row: pick its formula (override > default), evaluate, fail-safe. `col` is the concrete
 * target column ({value_field, value_key: concrete area | null for scalar, rate_subkey}). A
 * column with no declared formula returns its plain stored value via `lookup` (so F4 may call
 * this uniformly, though in practice F4 only needs F2 for columns that HAVE a formula).
 */
export function evaluateAmountColumn(
  col: Column,
  formulaSet: ColumnFormula[],
  lookup: OperandLookup,
): EvalResult {
  return evalColumn(col, formulaSet, lookup, new Set<string>());
}

/**
 * Convenience: evaluate EVERY declared column formula in the set for the current row, returning
 * a map keyed by columnKey(targetColumn) -> EvalResult. Each is an independent top-level
 * evaluation (its own cycle-visiting set). Useful for a one-shot per-row pass; F4 may instead
 * call evaluateAmountColumn per cell.
 */
export function evaluateAllColumns(
  formulaSet: ColumnFormula[],
  lookup: OperandLookup,
): Map<string, EvalResult> {
  const out = new Map<string, EvalResult>();
  for (const f of formulaSet) {
    const col: Column = {
      value_field: f.target_value_field,
      value_key: f.target_value_key,
      rate_subkey: f.target_rate_subkey,
    };
    out.set(columnKey(col), evaluateAmountColumn(col, formulaSet, lookup));
  }
  return out;
}

// Exported for unit tests (the column-identity key the cycle guard + evaluateAllColumns use).
export { columnKey };
