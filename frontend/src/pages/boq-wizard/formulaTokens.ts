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

// ── the operand palette (which columns a target may be built from) ────────────

/** One operand chip: the ref it inserts, its display name, its palette group. */
export interface OperandChip {
  ref: AmountFormulaRef;
  label: string;
  group: string;
}

/** The palette heading a value_field belongs under. Qty / rate / everything-else-is-amount. */
export function operandGroup(valueField: string): string {
  return valueField.startsWith("qty")
    ? "Quantity"
    : valueField.startsWith("rate")
      ? "Rate"
      : "Amount";
}

/**
 * Does this target column carry an AREA when it is evaluated -- i.e. is there anything for a
 * WILDCARD operand to bind to? True only for an area-bound target holding a concrete area.
 *
 * A scalar amount column (`amount_total`, say) is evaluated with `bindArea = null`, and
 * `bindRef(ref, null)` binds NOTHING -- so a wildcard operand stays `{qty_by_area, null}` and
 * PricingGrid's dangling-ref gate blanks the cell as "broken".
 */
export function targetBindsArea(target: ColumnDescriptor): boolean {
  return AREA_BOUND_VALUE_FIELDS.has(target.value_field) && target.value_key != null;
}

/**
 * The operand palette for one formula target: ONE CHIP PER ADDRESSABLE COLUMN, in the
 * descriptors' own (Excel) order, minus the trivial self-reference.
 *
 * ★ A WILDCARD CHIP IS ONLY OFFERED WHEN THE TARGET HAS AN AREA TO BIND IT TO, and that is the
 * whole point of this function existing. The palette used to run `tokenRefForMode(d, mode)`
 * with the BUILDER's mode, which is "default" for every scalar amount column -- so on a sheet
 * whose quantities are per-area (E = Quantity · 7f, F = Quantity · office cfm) but whose amount
 * column is a plain `amount_total`, both quantity columns collapsed into ONE wildcard chip
 * reading "Quantity". Clicking it built `qty_by_area[null] x rate`, which has no area to
 * resolve against, so every amount cell rendered blank. TWO failures at once: the second
 * quantity column was unreachable, and the only reachable one could not compute. A scalar
 * target therefore always takes CONCRETE refs -- `mode` is honoured only when the target can
 * actually bind an area.
 *
 * `labelFor` names a REF (not a descriptor) on purpose: a chip and a token hydrated from a
 * stored formula then read identically, because they go through the same resolver.
 *
 * ⚠️ EVERY OPERAND COLUMN THE SHEET HAS IS OFFERED, INCLUDING OTHER AREAS' (owner ruling
 * 2026-09-04, REVERSING a narrower cut that hid them). A per-area amount column may therefore be
 * built from another area's quantity, rate or amount -- a shared item apportioned across floors is
 * the case that needs it, and the evidence for narrowing (6 of 6 stored formulas use only their own
 * area) said what people HAD done, never what they were allowed to do. The only operand still
 * withheld is the TRIVIAL SELF-REFERENCE; anything else that would not compute is caught downstream
 * by the cycle check and the dangling-ref gate, which are the real boundaries.
 */
export function buildOperandPalette(
  target: ColumnDescriptor,
  descriptors: ColumnDescriptor[],
  labelFor: (ref: AmountFormulaRef) => string,
): OperandChip[] {
  // ⚠️ ALWAYS THE CONCRETE REF -- there is no mode. This took a `"default" | "override"` argument
  // until the tier stopped being a choice: `effectiveMode` is "override" for a per-area target and
  // "default" for a scalar one, and a scalar target does not bind an area, so the resolved mode was
  // "override" on EVERY call from the app. The wildcard-collapse branch was unreachable in the
  // product while three tests exercised it and passed -- coverage over dead code, which is worse
  // than no coverage because it reads as proof. Do not reintroduce the parameter to re-enable
  // wildcards: the area-following operand was removed by owner ruling (see the palette note above).
  const selfKey = refKey(tokenRefForMode(target, "override"));
  const seen = new Set<string>();
  const out: OperandChip[] = [];
  for (const d of descriptors) {
    if (!OPERAND_VALUE_FIELDS.has(d.value_field)) continue;
    const ref = tokenRefForMode(d, "override");
    const k = refKey(ref);
    if (k === selfKey) continue; // block the trivial self-reference
    if (seen.has(k)) continue; // dedupe (wildcards collapse areas in default mode)
    seen.add(k);
    out.push({ ref, label: labelFor(ref), group: operandGroup(d.value_field) });
  }
  return out;
}

/**
 * The stored DEFAULT (area-wildcard) formula on this target's axis, or null.
 *
 * ★ A LEFTOVER, NOT A TIER THE USER PICKS. On a sheet WITH areas every amount column names one
 * area, so its formula is per-area work and the Default tier has no job -- the builder no longer
 * offers it. But a default saved before that (or on another column) is still STORED, still
 * shadowed by the overrides, and would silently take over the moment one was removed. This finds
 * it so the builder can say so and offer to clear it.
 *
 * ⚠️ `target_col` IS NOT PART OF THE IDENTITY (pricing.save_amount_formula: identity is boq /
 * sheet / version / value_field / target_value_key / rate_subkey; target_col is a stored GUARD).
 * So one axis has exactly ONE default record shared by EVERY per-area column on it -- saving a
 * "default" from column I overwrites the one saved from column H. A per-column override tier over
 * a single shared default is precisely why the tab did not belong on an area sheet.
 *
 * ★ SHADOWED, OR IT IS NOT A LEFTOVER -- THIS COLUMN MUST HAVE ITS OWN OVERRIDE. A null-key
 * record is DEAD only because an override outranks it (pickFormula: override, else default). With
 * NO override the very same record is the LIVE formula computing this column, and reporting it as
 * an unused leftover invites the user to delete the thing their sheet runs on -- across EVERY area
 * on the axis at once, since there is only the one shared record. That also drops the sheet below
 * `_sheet_formulas_complete`, which blocks rate editing.
 *
 * ⚠️ THE UNSHADOWED CASE IS THE COMMON ONE, NOT AN EDGE. The old toggle OPENED on "Default (all
 * areas)", so "built one formula, never touched the tab" -- the normal history of every sheet
 * predating this change -- lands exactly there. The builder promotes that formula into the
 * column's own override instead (see AmountFormulaBuilder's `inheritedDefault`).
 *
 * Self-gating on per-area: for a SCALAR column a null `target_value_key` is not a leftover, it is
 * that column's own formula.
 */
export function storedDefaultFormula(
  target: ColumnDescriptor,
  columnFormulas: ColumnFormula[],
): ColumnFormula | null {
  if (!targetBindsArea(target)) return null;
  const sameAxis = (f: ColumnFormula) =>
    f.target_value_field === target.value_field && f.target_rate_subkey === target.rate_subkey;
  const shadowedBy = columnFormulas.find(
    (f) => sameAxis(f) && f.target_value_key === target.value_key && f.formula != null,
  );
  if (!shadowedBy) return null;
  return (
    columnFormulas.find(
      (f) => sameAxis(f) && f.target_value_key === null && f.formula != null,
    ) ?? null
  );
}

/**
 * The column tokens in `tokens` that this target can NEVER resolve -- a WILDCARD operand on a
 * target with no area to bind it to, and no null-key column of its own to fall back on.
 *
 * This is the builder-side twin of PricingGrid's `validateFormulaRefs` gate at `bindArea = null`:
 * exactly the refs that gate would call dangling, and nothing else. It exists because such a
 * formula SAVES cleanly and then renders every cell blank, with the builder still reporting
 * "Well-formed." -- the failure the palette fix above stops NEW formulas creating, caught here
 * for the ones already stored.
 *
 * Deliberately silent for an area-bound target: there a wildcard is the correct, intended
 * spelling of "the current area", so there is nothing to warn about.
 */
export function unbindableOperands(
  target: ColumnDescriptor,
  descriptors: ColumnDescriptor[],
  tokens: FormulaToken[],
): ColumnToken[] {
  if (targetBindsArea(target)) return [];
  return tokens.filter((t): t is ColumnToken => {
    if (t.kind !== "column") return false;
    if (t.ref.value_key !== null) return false;
    if (!AREA_BOUND_VALUE_FIELDS.has(t.ref.value_field)) return false;
    // A sheet may legitimately map an area-bound role with NO area (value_key null); there the
    // wildcard IS a concrete column and resolves fine.
    return !descriptors.some(
      (d) =>
        d.value_field === t.ref.value_field &&
        d.rate_subkey === t.ref.rate_subkey &&
        d.value_key === null,
    );
  });
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
