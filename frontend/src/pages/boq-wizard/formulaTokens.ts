/**
 * formulaTokens -- the PURE token-list <-> tree bridge for the amount-formula builder
 * (BoQ Phase 5 Formula Builder F3).
 *
 * The builder edits a FLAT, ordered token list (what the user clicks: column chips,
 * operators, brackets) for easy insert / backspace / live preview. On SAVE the token list is
 * PARSED into the F1 token TREE (the AmountFormulaNode {op,operands}/{ref} shape) -- this is
 * the ONE place a parse happens, over a tiny unambiguous grammar (operands are pre-tokenized
 * descriptors; operators are + x ( ) ), NOT free text. NO numeric literals exist anywhere
 * (there is no number token), so literals are barred by construction.
 *
 * Pure -- no React/DOM. The parser is the one risk spot in F3 and is unit-tested
 * (formulaTokens.test.ts). The cycle check (`wouldCreateCycle`) REUSES F2's evaluator (it
 * does NOT reimplement cycle logic).
 */
import { evaluateAmountColumn } from "./amountFormula";
import type {
  AmountFormulaNode,
  AmountFormulaRef,
  ColumnDescriptor,
  ColumnFormula,
} from "./boqTypes";

// The per-area (area-bound) value_fields: a DEFAULT (wildcard) formula's operand on one of
// these is stored value_key=null ("bind to the current area" at eval). Mirrors F2's
// AREA_BOUND_VALUE_FIELDS + PricingGrid's PER_AREA_* consts (kept in sync; small + stable).
const AREA_BOUND_VALUE_FIELDS = new Set(["qty_by_area", "rate_by_area", "amount_by_area"]);

// The value_fields a formula OPERAND may reference: qty / rate / amount columns (NOT the fixed
// sl_no/description anchors, NOT notes/ignore). Drives the operand palette.
export const OPERAND_VALUE_FIELDS = new Set([
  "qty_total", "qty_by_area",
  "rate_supply", "rate_install", "rate_combined", "rate_by_area",
  "amount_total", "amount_supply", "amount_install", "amount_by_area",
]);

// ── token model ───────────────────────────────────────────────────────────────

/** A column operand the user inserted -- carries the EXACT descriptor ref + a display label. */
export interface ColumnToken {
  kind: "column";
  ref: AmountFormulaRef;
  label: string;
}
/** An operator: "+" (sum) or "*" (product; shown as x). */
export interface OpToken {
  kind: "op";
  op: "+" | "*";
}
export interface LParenToken { kind: "lparen"; }
export interface RParenToken { kind: "rparen"; }

export type FormulaToken = ColumnToken | OpToken | LParenToken | RParenToken;

/** parse() result: a tree, or a human-readable structural error. */
export type ParseResult =
  | { ok: true; tree: AmountFormulaNode }
  | { ok: false; error: string };

// Stable inline-error messages the builder surfaces verbatim.
export const ERR_EMPTY = "Add at least one column.";
export const ERR_UNBALANCED = "Unbalanced brackets.";
export const ERR_DANGLING = "An operator needs a column on each side.";

// ── the parser (recursive descent; x binds tighter than +; brackets override) ──
//
// Grammar:
//   expr   = term   ( "+" term )*
//   term   = factor ( "*" factor )*
//   factor = column | "(" expr ")"
// A single column -> a bare leaf. A "+" / "*" with >1 operand -> an n-ary operator node
// (F2 folds n-ary operands). A dangling operator / empty group / unbalanced bracket -> error.

class Cursor {
  i = 0;
  constructor(readonly toks: FormulaToken[]) {}
  peek(): FormulaToken | undefined { return this.toks[this.i]; }
  next(): FormulaToken | undefined { return this.toks[this.i++]; }
  atEnd(): boolean { return this.i >= this.toks.length; }
}

class ParseError extends Error {}

function parseFactor(c: Cursor): AmountFormulaNode {
  const t = c.peek();
  if (t === undefined) throw new ParseError(ERR_DANGLING);
  if (t.kind === "column") {
    c.next();
    return { ref: t.ref };
  }
  if (t.kind === "lparen") {
    c.next();
    const inner = parseExpr(c);
    const close = c.peek();
    if (!close || close.kind !== "rparen") throw new ParseError(ERR_UNBALANCED);
    c.next();
    return inner;
  }
  // an operator or a stray ")" where a factor (column / "(") was expected.
  if (t.kind === "rparen") throw new ParseError(ERR_UNBALANCED);
  throw new ParseError(ERR_DANGLING);
}

function parseTerm(c: Cursor): AmountFormulaNode {
  const first = parseFactor(c);
  const operands = [first];
  while (c.peek()?.kind === "op" && (c.peek() as OpToken).op === "*") {
    c.next();
    operands.push(parseFactor(c));
  }
  return operands.length === 1 ? first : { op: "*", operands };
}

function parseExpr(c: Cursor): AmountFormulaNode {
  const first = parseTerm(c);
  const operands = [first];
  while (c.peek()?.kind === "op" && (c.peek() as OpToken).op === "+") {
    c.next();
    operands.push(parseTerm(c));
  }
  return operands.length === 1 ? first : { op: "+", operands };
}

/** Parse a token list into an AmountFormulaNode tree, or a structural error. */
export function parseTokens(tokens: FormulaToken[]): ParseResult {
  if (tokens.length === 0) return { ok: false, error: ERR_EMPTY };
  const c = new Cursor(tokens);
  try {
    const tree = parseExpr(c);
    if (!c.atEnd()) {
      // leftover tokens -> a stray ")" (unbalanced) or otherwise malformed sequence.
      const rest = c.peek();
      return { ok: false, error: rest?.kind === "rparen" ? ERR_UNBALANCED : ERR_DANGLING };
    }
    return { ok: true, tree };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message };
    throw e; // genuinely unexpected -- never swallow
  }
}

// ── descriptor -> operand ref (the DEFAULT-as-template transform) ──────────────

/**
 * The ref a palette chip inserts for a clicked descriptor, given the builder mode:
 *   - DEFAULT mode + an area-bound descriptor -> a WILDCARD leaf (value_key = null) so F2
 *     binds it to the area being computed (the default is a TEMPLATE applied per area).
 *   - OVERRIDE mode (or a scalar descriptor) -> the CONCRETE ref as-is (value_key kept).
 * Pure -- unit-tested.
 */
export function tokenRefForMode(d: ColumnDescriptor, mode: "default" | "override"): AmountFormulaRef {
  if (mode === "default" && AREA_BOUND_VALUE_FIELDS.has(d.value_field)) {
    return { value_field: d.value_field, value_key: null, rate_subkey: d.rate_subkey };
  }
  return { value_field: d.value_field, value_key: d.value_key, rate_subkey: d.rate_subkey };
}

/** The identity key for one column ref (value_field|value_key|rate_subkey). Pure. */
export function refKey(ref: AmountFormulaRef): string {
  return [ref.value_field, ref.value_key ?? "null", ref.rate_subkey ?? "null"].join("|");
}

// ── tree -> tokens (hydrate the builder from an existing stored formula) ───────

/**
 * Flatten a stored tree back into a token list (so re-opening the builder shows the existing
 * formula). Inserts the MINIMAL brackets that preserve precedence: a "+" sub-node nested
 * inside a "*" is wrapped in parens; everything else is bare. `labelFor` resolves a ref to its
 * display label. Pure -- round-trip tested (parse(treeToTokens(t)) is semantically t).
 */
export function treeToTokens(
  tree: AmountFormulaNode,
  labelFor: (ref: AmountFormulaRef) => string,
): FormulaToken[] {
  const build = (n: AmountFormulaNode): { toks: FormulaToken[]; isSum: boolean } => {
    if ("ref" in n) {
      return { toks: [{ kind: "column", ref: n.ref, label: labelFor(n.ref) }], isSum: false };
    }
    if (n.op === "+") {
      const toks: FormulaToken[] = [];
      n.operands.forEach((o, i) => {
        if (i) toks.push({ kind: "op", op: "+" });
        toks.push(...build(o).toks);
      });
      return { toks, isSum: true };
    }
    // "*": wrap any sum operand in parens.
    const toks: FormulaToken[] = [];
    n.operands.forEach((o, i) => {
      if (i) toks.push({ kind: "op", op: "*" });
      const b = build(o);
      if (b.isSum) toks.push({ kind: "lparen" }, ...b.toks, { kind: "rparen" });
      else toks.push(...b.toks);
    });
    return { toks, isSum: false };
  };
  return build(tree).toks;
}

// ── cycle check (REUSES F2 -- does NOT reimplement cycle logic) ────────────────

/**
 * Would saving `tree` for the target column (identity = `target`) create a CYCLE among the
 * amount-column formulas? Builds the PROSPECTIVE formula set (existing minus any entry of the
 * SAME identity, plus the new one) and runs F2's evaluator on the target with a dummy lookup
 * (every operand resolves to 1, so only a CYCLE -- never a missing operand -- can make F2
 * report "broken"; the tree is already well-formed by the parser). Returns true iff F2 reports
 * broken. Pure (deterministic) -- unit-tested. The amount-target value_key is the SAVE target
 * (null for a default, the concrete area for an override).
 */
export function wouldCreateCycle(
  target: AmountFormulaRef,
  tree: AmountFormulaNode,
  existing: ColumnFormula[],
): boolean {
  const targetK = refKey(target);
  const prospective: ColumnFormula[] = existing
    .filter(
      (f) =>
        refKey({
          value_field: f.target_value_field,
          value_key: f.target_value_key,
          rate_subkey: f.target_rate_subkey,
        }) !== targetK,
    )
    .concat([
      {
        target_value_field: target.value_field,
        target_value_key: target.value_key,
        target_rate_subkey: target.rate_subkey,
        target_col: null,
        formula: tree,
      },
    ]);
  const r = evaluateAmountColumn(target, prospective, () => 1);
  return !r.ok && r.reason === "broken";
}
