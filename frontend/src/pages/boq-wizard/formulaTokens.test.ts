// Unit tests for the amount-formula token parser + helpers (BoQ Phase 5 Formula Builder F3).
//
// The parser is the one risk spot in F3 (token list -> the F1 tree). The suite proves
// precedence (x over +), bracket override, n-ary flattening, the error cases (empty / dangling
// / unbalanced), the single-leaf case, the DEFAULT-as-template ref transform, the tree->tokens
// round-trip (builder hydration), and the F2-reusing cycle check.
import { describe, it, expect } from "vitest";
import {
  parseTokens,
  tokenRefForMode,
  treeToTokens,
  wouldCreateCycle,
  refKey,
  ERR_EMPTY,
  ERR_DANGLING,
  ERR_UNBALANCED,
  type FormulaToken,
} from "./formulaTokens";
import type {
  AmountFormulaNode,
  AmountFormulaRef,
  ColumnDescriptor,
  ColumnFormula,
} from "./boqTypes";

// ── builders ────────────────────────────────────────────────────────────────
function ref(
  value_field: string,
  value_key: string | null = null,
  rate_subkey: string | null = null,
): AmountFormulaRef {
  return { value_field, value_key, rate_subkey };
}
function col(r: AmountFormulaRef, label = "col"): FormulaToken {
  return { kind: "column", ref: r, label };
}
const PLUS: FormulaToken = { kind: "op", op: "+" };
const TIMES: FormulaToken = { kind: "op", op: "*" };
const LP: FormulaToken = { kind: "lparen" };
const RP: FormulaToken = { kind: "rparen" };

function leaf(r: AmountFormulaRef): AmountFormulaNode {
  return { ref: r };
}
function desc(
  value_field: string,
  value_key: string | null = null,
  rate_subkey: string | null = null,
): ColumnDescriptor {
  return { col: "X", role: "r", area: value_key, value_field, value_key, rate_subkey };
}

const QTY = ref("qty_total");
const SUP = ref("rate_supply");
const INS = ref("rate_install");
const CMB = ref("rate_combined");

// ── parser: arithmetic + precedence + brackets ────────────────────────────────
describe("parseTokens -- structure", () => {
  it("a single column -> a bare leaf", () => {
    expect(parseTokens([col(QTY)])).toEqual({ ok: true, tree: leaf(QTY) });
  });

  it("a + b -> a sum node", () => {
    expect(parseTokens([col(SUP), PLUS, col(INS)])).toEqual({
      ok: true,
      tree: { op: "+", operands: [leaf(SUP), leaf(INS)] },
    });
  });

  it("a * b -> a product node", () => {
    expect(parseTokens([col(QTY), TIMES, col(CMB)])).toEqual({
      ok: true,
      tree: { op: "*", operands: [leaf(QTY), leaf(CMB)] },
    });
  });

  it("x binds tighter than +: a + b * c -> a + (b*c)", () => {
    const r = parseTokens([col(QTY), PLUS, col(SUP), TIMES, col(INS)]);
    expect(r).toEqual({
      ok: true,
      tree: { op: "+", operands: [leaf(QTY), { op: "*", operands: [leaf(SUP), leaf(INS)] }] },
    });
  });

  it("brackets override precedence: (a + b) * c", () => {
    const r = parseTokens([LP, col(SUP), PLUS, col(INS), RP, TIMES, col(QTY)]);
    expect(r).toEqual({
      ok: true,
      tree: { op: "*", operands: [{ op: "+", operands: [leaf(SUP), leaf(INS)] }, leaf(QTY)] },
    });
  });

  it("a realistic formula: qty * (supply + install)", () => {
    const r = parseTokens([col(QTY), TIMES, LP, col(SUP), PLUS, col(INS), RP]);
    expect(r).toEqual({
      ok: true,
      tree: { op: "*", operands: [leaf(QTY), { op: "+", operands: [leaf(SUP), leaf(INS)] }] },
    });
  });

  it("n-ary flatten: a + b + c -> one sum with 3 operands", () => {
    const r = parseTokens([col(QTY), PLUS, col(SUP), PLUS, col(INS)]);
    expect(r).toEqual({ ok: true, tree: { op: "+", operands: [leaf(QTY), leaf(SUP), leaf(INS)] } });
  });

  it("n-ary flatten: a * b * c -> one product with 3 operands", () => {
    const r = parseTokens([col(QTY), TIMES, col(SUP), TIMES, col(INS)]);
    expect(r).toEqual({ ok: true, tree: { op: "*", operands: [leaf(QTY), leaf(SUP), leaf(INS)] } });
  });
});

// ── parser: error cases ───────────────────────────────────────────────────────
describe("parseTokens -- errors", () => {
  it("empty token list -> empty error", () => {
    expect(parseTokens([])).toEqual({ ok: false, error: ERR_EMPTY });
  });
  it("trailing dangling operator a + -> dangling error", () => {
    expect(parseTokens([col(QTY), PLUS])).toEqual({ ok: false, error: ERR_DANGLING });
  });
  it("leading operator + a -> dangling error", () => {
    expect(parseTokens([PLUS, col(QTY)])).toEqual({ ok: false, error: ERR_DANGLING });
  });
  it("two operators in a row a + + b -> dangling error", () => {
    expect(parseTokens([col(QTY), PLUS, PLUS, col(SUP)])).toEqual({ ok: false, error: ERR_DANGLING });
  });
  it("unbalanced open ( a + b -> unbalanced error", () => {
    expect(parseTokens([LP, col(SUP), PLUS, col(INS)])).toEqual({ ok: false, error: ERR_UNBALANCED });
  });
  it("extra close a + b ) -> unbalanced error", () => {
    expect(parseTokens([col(SUP), PLUS, col(INS), RP])).toEqual({ ok: false, error: ERR_UNBALANCED });
  });
  it("empty group ( ) -> error (never a silent pass)", () => {
    const r = parseTokens([LP, RP]);
    expect(r.ok).toBe(false);
  });
});

// ── tokenRefForMode: the DEFAULT-as-template transform ────────────────────────
describe("tokenRefForMode", () => {
  it("DEFAULT mode + area-bound descriptor -> WILDCARD ref (value_key null)", () => {
    const d = desc("rate_by_area", "Phase 1", "combined_rate");
    expect(tokenRefForMode(d, "default")).toEqual(ref("rate_by_area", null, "combined_rate"));
  });
  it("OVERRIDE mode + area-bound -> CONCRETE ref (value_key kept)", () => {
    const d = desc("rate_by_area", "Phase 1", "combined_rate");
    expect(tokenRefForMode(d, "override")).toEqual(ref("rate_by_area", "Phase 1", "combined_rate"));
  });
  it("a scalar descriptor is concrete in both modes (null value_key stays null)", () => {
    const d = desc("rate_combined", null, null);
    expect(tokenRefForMode(d, "default")).toEqual(ref("rate_combined", null, null));
    expect(tokenRefForMode(d, "override")).toEqual(ref("rate_combined", null, null));
  });
});

// ── treeToTokens: builder hydration (round-trips through the parser) ──────────
describe("treeToTokens round-trips through parseTokens", () => {
  const labelFor = (r: AmountFormulaRef) => r.value_field;

  it("qty * (supply + install) -> tokens -> the same tree", () => {
    const tree: AmountFormulaNode = {
      op: "*",
      operands: [leaf(QTY), { op: "+", operands: [leaf(SUP), leaf(INS)] }],
    };
    const toks = treeToTokens(tree, labelFor);
    expect(parseTokens(toks)).toEqual({ ok: true, tree });
  });

  it("(a + b) * (c + d) round-trips (sum operands get parens inside a product)", () => {
    const A = ref("qty_total"), B = ref("qty_by_area", "Z"), C = ref("rate_supply"), D = ref("rate_install");
    const tree: AmountFormulaNode = {
      op: "*",
      operands: [
        { op: "+", operands: [leaf(A), leaf(B)] },
        { op: "+", operands: [leaf(C), leaf(D)] },
      ],
    };
    expect(parseTokens(treeToTokens(tree, labelFor))).toEqual({ ok: true, tree });
  });

  it("a bare leaf round-trips", () => {
    const tree = leaf(QTY);
    expect(parseTokens(treeToTokens(tree, labelFor))).toEqual({ ok: true, tree });
  });
});

// ── wouldCreateCycle: reuses F2; refuses circular definitions at save ─────────
describe("wouldCreateCycle (reuses F2)", () => {
  const amtTotal = ref("amount_total");
  const amtSupply = ref("amount_supply");

  it("a clean tree (qty * rate) is NOT a cycle", () => {
    const tree: AmountFormulaNode = { op: "*", operands: [leaf(QTY), leaf(CMB)] };
    expect(wouldCreateCycle(amtTotal, tree, [])).toBe(false);
  });

  it("a self-reference (amount_total uses amount_total) IS a cycle", () => {
    const tree = leaf(amtTotal);
    expect(wouldCreateCycle(amtTotal, tree, [])).toBe(true);
  });

  it("a mutual cycle via an existing formula IS detected", () => {
    // existing: amount_supply = amount_total. new: amount_total = amount_supply -> cycle.
    const existing: ColumnFormula[] = [
      {
        target_value_field: "amount_supply",
        target_value_key: null,
        target_rate_subkey: null,
        target_col: null,
        formula: leaf(amtTotal),
      },
    ];
    expect(wouldCreateCycle(amtTotal, leaf(amtSupply), existing)).toBe(true);
  });

  it("referencing a DIFFERENT amount column with no back-edge is fine (amount-refs-other-amount)", () => {
    const existing: ColumnFormula[] = [
      {
        target_value_field: "amount_supply",
        target_value_key: null,
        target_rate_subkey: null,
        target_col: null,
        formula: { op: "*", operands: [leaf(QTY), leaf(SUP)] },
      },
    ];
    expect(wouldCreateCycle(amtTotal, leaf(amtSupply), existing)).toBe(false);
  });

  it("refKey is stable for an identity", () => {
    expect(refKey(ref("amount_by_area", "Phase 1", "total"))).toBe("amount_by_area|Phase 1|total");
    expect(refKey(ref("amount_total", null, null))).toBe("amount_total|null|null");
  });
});
