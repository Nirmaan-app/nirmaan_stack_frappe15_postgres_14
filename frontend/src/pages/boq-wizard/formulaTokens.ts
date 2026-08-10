/**
 * formulaTokens -- the PURE token-list <-> tree bridge for the amount-formula builder
 * (BoQ Phase 5 Formula Builder F3).
 *
 * The builder edits a FLAT, ordered token list (what the user clicks: column chips,
 * operators, brackets) for easy insert / backspace / live preview. On SAVE the token list is
 * PARSED into the F1 token TREE (the AmountFormulaNode {op,operands}/{ref} shape) -- this is
 * the ONE place a parse happens, over a tiny unambiguous grammar (operands are pre-tokenized
 * descriptors; operators are + - x / ( ) ), NOT free text. NO numeric literals exist anywhere
 * (there is no number token), so literals are barred by construction -- which is also why
 * there is no unary minus: `-A` would need a `0` to subtract from.
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
/** An operator: "+" (sum), "*" (product; shown as x), "-" (difference) or "/" (quotient). */
export interface OpToken {
  kind: "op";
  op: "+" | "*" | "-" | "/";
}

/** The ADDITIVE tier (loosest binding) and the MULTIPLICATIVE tier (tighter). */
const ADDITIVE_OPS = new Set(["+", "-"]);
const MULTIPLICATIVE_OPS = new Set(["*", "/"]);
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

// ── the parser (recursive descent; x / binds tighter than + -; brackets override) ──
//
// Grammar:
//   expr   = term   ( ("+"|"-") term )*
//   term   = factor ( ("*"|"/") factor )*
//   factor = column | "(" expr ")"
// A single column -> a bare leaf. A dangling operator / empty group / unbalanced bracket ->
// error.
//
// ⚠️ WHY A CHAIN IS NOT ALWAYS ONE N-ARY NODE (F5). Before `-` and `/` existed, a tier held
// exactly one operator, so a whole chain folded into ONE n-ary node and nothing was lost --
// `+` and `*` are associative, so `{op:"+", operands:[a,b,c]}` has only one reading. A MIXED
// tier does not: `a - b + c` is `(a-b)+c` and emphatically not `a-(b+c)`, so it must become a
// LEFT-ASSOCIATIVE chain of binary nodes. `foldChain` below does exactly one thing beyond
// that: it keeps folding into the SAME n-ary node while the operator does not change, which is
// what makes a pure `+` (or pure `*`) run produce the byte-identical tree it produced before
// F5 -- no stored formula changes shape, no committed sheet's amounts move. That preservation
// is pinned by test, not assumed.
//
// A same-op run of `-` / `/` is n-ary too, and correctly so: F2 folds `operands` left to right
// from `operands[0]`, so `{op:"-", operands:[a,b,c]}` IS `((a-b)-c)`.

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

/**
 * Fold one already-parsed operator chain -- `first`, then the (op, operand) pairs in source
 * order -- into a tree, LEFT-ASSOCIATIVELY.
 *
 * A run of ONE operator collects into a single n-ary node; the operator CHANGING closes that
 * node and makes it the left operand of the next one. `acc` is only ever extended in place
 * when this function built it in this call (`accOp` is null until then), so a subtree handed
 * up by parseFactor -- a bracketed group, say -- is never mutated.
 */
function foldChain(
  first: AmountFormulaNode,
  rest: ReadonlyArray<{ op: OpToken["op"]; operand: AmountFormulaNode }>,
): AmountFormulaNode {
  let acc = first;
  let accOp: OpToken["op"] | null = null;
  for (const { op, operand } of rest) {
    if (accOp === op) {
      (acc as { op: OpToken["op"]; operands: AmountFormulaNode[] }).operands.push(operand);
      continue;
    }
    acc = { op, operands: [acc, operand] };
    accOp = op;
  }
  return acc;
}

/** One precedence tier of the grammar, parameterised by its operator set + the tighter tier. */
function parseTier(
  c: Cursor,
  ops: ReadonlySet<string>,
  next: (c: Cursor) => AmountFormulaNode,
): AmountFormulaNode {
  const first = next(c);
  const rest: Array<{ op: OpToken["op"]; operand: AmountFormulaNode }> = [];
  for (;;) {
    const t = c.peek();
    if (t?.kind !== "op" || !ops.has(t.op)) break;
    c.next();
    rest.push({ op: t.op, operand: next(c) });
  }
  return rest.length === 0 ? first : foldChain(first, rest);
}

function parseTerm(c: Cursor): AmountFormulaNode {
  return parseTier(c, MULTIPLICATIVE_OPS, parseFactor);
}

function parseExpr(c: Cursor): AmountFormulaNode {
  return parseTier(c, ADDITIVE_OPS, parseTerm);
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

/** Binding strength: a bare column binds tightest, then x /, then + -. */
const ATOM_PREC = 3;
const OP_PREC: Record<OpToken["op"], number> = { "*": 2, "/": 2, "+": 1, "-": 1 };
/** Operators for which a RIGHT operand of equal strength must be bracketed: `a - (b - c)` is
 *  not `a - b - c`, and `a / (b / c)` is not `a / b / c`. `+` / `*` have no such hazard. */
const RIGHT_ASSOC_HAZARD_OPS = new Set(["-", "/"]);

/**
 * Flatten a stored tree back into a token list (so re-opening the builder shows the existing
 * formula). Inserts the MINIMAL brackets that preserve the tree's own reading. `labelFor`
 * resolves a ref to its display label. Pure -- round-trip tested.
 *
 * The rule, per operand of a node whose operator is O:
 *   - the FIRST operand is bracketed only when it binds LOOSER than O (`(a + b) x c`);
 *   - a LATER operand is bracketed when it binds looser, when its operator DIFFERS at the same
 *     strength (`a + (b - c)`), or when O is `-` / `/`, where even the same operator changes
 *     the answer (`a - (b - c)`).
 *
 * ⚠️ THE FIRST-OPERAND ASYMMETRY IS DELIBERATE (F5) and is what keeps the output MINIMAL: a
 * left operand of equal strength needs no brackets precisely because the parser re-reads the
 * chain left-associatively, so `a + b - c` parses back to the `(a+b)-c` it was printed from.
 * Round-tripping is EXACT here, not merely semantic -- parse(treeToTokens(t)) reproduces `t`
 * node for node, on the new operators as well as the old two.
 */
export function treeToTokens(
  tree: AmountFormulaNode,
  labelFor: (ref: AmountFormulaRef) => string,
): FormulaToken[] {
  const build = (n: AmountFormulaNode): { toks: FormulaToken[]; prec: number } => {
    if ("ref" in n) {
      return { toks: [{ kind: "column", ref: n.ref, label: labelFor(n.ref) }], prec: ATOM_PREC };
    }
    const prec = OP_PREC[n.op];
    const toks: FormulaToken[] = [];
    n.operands.forEach((o, i) => {
      if (i) toks.push({ kind: "op", op: n.op });
      const b = build(o);
      const sameStrengthHazard =
        b.prec === prec && (!("op" in o) || o.op !== n.op || RIGHT_ASSOC_HAZARD_OPS.has(n.op));
      const needsParens = b.prec < prec || (i > 0 && sameStrengthHazard);
      if (needsParens) toks.push({ kind: "lparen" }, ...b.toks, { kind: "rparen" });
      else toks.push(...b.toks);
    });
    return { toks, prec };
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
