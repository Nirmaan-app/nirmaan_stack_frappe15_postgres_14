// Unit tests for the PURE amount-formula evaluator (BoQ Phase 5 Formula Builder F2).
//
// This is the RISK CORE: a wrong evaluator puts a wrong number on a tender document. The
// suite hammers arithmetic, area-binding (wildcard vs scalar null), amount-refs-amount
// dependency order, cycle detection, and -- the §0 fail-safe -- that ANY missing operand
// blanks the WHOLE formula (no partial sum, no zero-substitution) while a real 0 stays a
// real value. Plain value maps stand in for F4's injected lookup (F2 is pure -- no row, no
// DOM, no Frappe).
import { describe, it, expect } from "vitest";
import {
  evaluateAmountColumn,
  evaluateAllColumns,
  bindRef,
  pickFormula,
  columnKey,
  type OperandLookup,
} from "./amountFormula";
import type {
  AmountFormulaNode,
  AmountFormulaRef,
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
function leaf(r: AmountFormulaRef): AmountFormulaNode {
  return { ref: r };
}
function op(o: "+" | "*", ...operands: AmountFormulaNode[]): AmountFormulaNode {
  return { op: o, operands };
}
function cf(
  target_value_field: string,
  target_value_key: string | null,
  target_rate_subkey: string | null,
  formula: AmountFormulaNode | null,
  target_col: string | null = null,
): ColumnFormula {
  return { target_value_field, target_value_key, target_rate_subkey, target_col, formula };
}

// A lookup over a plain map keyed `${value_field}|${value_key}|${rate_subkey}` (null -> "null").
// Absent key -> undefined (the absent signal). The receiver is a CONCRETE ref (F2 already bound).
function mkLookup(values: Record<string, number>): OperandLookup {
  return (r) => values[`${r.value_field}|${r.value_key ?? "null"}|${r.rate_subkey ?? "null"}`];
}

// Common concrete target columns.
const SCALAR_AMOUNT_TOTAL: AmountFormulaRef = ref("amount_total", null, null);
const AREA_AMOUNT_TOTAL = (area: string): AmountFormulaRef => ref("amount_by_area", area, "total");

// ── arithmetic + nesting (precedence via tree) ────────────────────────────────
describe("arithmetic + nesting", () => {
  it("`*` is the product of operands", () => {
    const set = [cf("amount_total", null, null, op("*", leaf(ref("qty_total")), leaf(ref("rate_combined"))))];
    const lk = mkLookup({ "qty_total|null|null": 5, "rate_combined|null|null": 10 });
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toEqual({ ok: true, value: 50 });
  });

  it("`+` is the sum of operands", () => {
    const set = [cf("amount_total", null, null, op("+", leaf(ref("rate_supply")), leaf(ref("rate_install"))))];
    const lk = mkLookup({ "rate_supply|null|null": 3, "rate_install|null|null": 4 });
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toEqual({ ok: true, value: 7 });
  });

  it("nesting IS the precedence: qty x (supply + install)", () => {
    const set = [
      cf("amount_total", null, null,
        op("*", leaf(ref("qty_total")), op("+", leaf(ref("rate_supply")), leaf(ref("rate_install"))))),
    ];
    const lk = mkLookup({ "qty_total|null|null": 2, "rate_supply|null|null": 3, "rate_install|null|null": 4 });
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toEqual({ ok: true, value: 14 }); // 2*(3+4)
  });

  it("a deeply nested but valid tree evaluates correctly", () => {
    // ((a + b) * (c + d)) * e  ->  ((1+2)*(3+4))*5 = 105
    const set = [
      cf("amount_total", null, null,
        op("*",
          op("*",
            op("+", leaf(ref("rate_supply")), leaf(ref("rate_install"))),
            op("+", leaf(ref("rate_combined")), leaf(ref("qty_total")))),
          leaf(ref("unit_factor")))),
    ];
    const lk = mkLookup({
      "rate_supply|null|null": 1, "rate_install|null|null": 2,
      "rate_combined|null|null": 3, "qty_total|null|null": 4, "unit_factor|null|null": 5,
    });
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toEqual({ ok: true, value: 105 });
  });

  it("a single-leaf formula (root is a leaf) is valid", () => {
    const set = [cf("amount_total", null, null, leaf(ref("qty_total")))];
    const lk = mkLookup({ "qty_total|null|null": 9 });
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toEqual({ ok: true, value: 9 });
  });
});

// ── multi-area wildcard binding ───────────────────────────────────────────────
describe("area-binding (wildcard default)", () => {
  // ONE wildcard default: qty_by_area(*) x rate_by_area(*, combined). value_key=null on the
  // area-bound operands -> bind to the area being computed.
  const wildcardSet = [
    cf("amount_by_area", null, "total",
      op("*",
        leaf(ref("qty_by_area", null, null)),
        leaf(ref("rate_by_area", null, "combined_rate")))),
  ];

  it("binds the same formula to area A vs area B independently", () => {
    const lk = mkLookup({
      "qty_by_area|Phase 1|null": 10, "rate_by_area|Phase 1|combined_rate": 5,
      "qty_by_area|Phase 2|null": 2, "rate_by_area|Phase 2|combined_rate": 7,
    });
    expect(evaluateAmountColumn(AREA_AMOUNT_TOTAL("Phase 1"), wildcardSet, lk)).toEqual({ ok: true, value: 50 });
    expect(evaluateAmountColumn(AREA_AMOUNT_TOTAL("Phase 2"), wildcardSet, lk)).toEqual({ ok: true, value: 14 });
  });

  it("a per-area OVERRIDE wins over the wildcard default for its area", () => {
    const set = [
      ...wildcardSet,
      // override Phase 1 -> a flat amount via a single leaf (different math) to prove precedence
      cf("amount_by_area", "Phase 1", "total", leaf(ref("amount_by_area", "Phase 1", "total_override"))),
    ];
    const lk = mkLookup({
      "qty_by_area|Phase 1|null": 10, "rate_by_area|Phase 1|combined_rate": 5,
      "amount_by_area|Phase 1|total_override": 999,
      "qty_by_area|Phase 2|null": 2, "rate_by_area|Phase 2|combined_rate": 7,
    });
    // Phase 1 uses the override (999), Phase 2 falls through to the default (14).
    expect(evaluateAmountColumn(AREA_AMOUNT_TOTAL("Phase 1"), set, lk)).toEqual({ ok: true, value: 999 });
    expect(evaluateAmountColumn(AREA_AMOUNT_TOTAL("Phase 2"), set, lk)).toEqual({ ok: true, value: 14 });
  });
});

// ── scalar-null vs wildcard-null (not conflated) ──────────────────────────────
describe("scalar null value_key is NOT area-bound", () => {
  it("a scalar operand stays scalar while an area-bound operand binds to the area", () => {
    // DEFAULT amount_by_area formula mixing a SCALAR qty_total (must NOT bind) with an
    // area-bound rate_by_area (must bind to Phase 1).
    const set = [
      cf("amount_by_area", null, "total",
        op("*", leaf(ref("qty_total", null, null)), leaf(ref("rate_by_area", null, "combined_rate")))),
    ];
    // Provide ONLY the scalar qty_total (no qty_by_area|Phase 1) + the Phase 1 rate. If
    // qty_total wrongly bound to the area it would miss -> not_yet; correct binding -> 3*10=30.
    const lk = mkLookup({ "qty_total|null|null": 3, "rate_by_area|Phase 1|combined_rate": 10 });
    expect(evaluateAmountColumn(AREA_AMOUNT_TOTAL("Phase 1"), set, lk)).toEqual({ ok: true, value: 30 });
  });

  it("bindRef: wildcard area-bound null binds; scalar null + concrete value_key do not", () => {
    expect(bindRef(ref("rate_by_area", null, "combined_rate"), "Phase 1"))
      .toEqual({ value_field: "rate_by_area", value_key: "Phase 1", rate_subkey: "combined_rate" });
    expect(bindRef(ref("qty_total", null, null), "Phase 1"))
      .toEqual({ value_field: "qty_total", value_key: null, rate_subkey: null }); // scalar -> unbound
    expect(bindRef(ref("rate_by_area", "Phase 2", "combined_rate"), "Phase 1"))
      .toEqual({ value_field: "rate_by_area", value_key: "Phase 2", rate_subkey: "combined_rate" }); // concrete kept
    expect(bindRef(ref("rate_by_area", null, "combined_rate"), null))
      .toEqual({ value_field: "rate_by_area", value_key: null, rate_subkey: "combined_rate" }); // no area -> unbound
  });
});

// ── amount-refs-amount (dependency order) ─────────────────────────────────────
describe("amount-refs-amount", () => {
  it("grand total = supply amount + install amount, each itself a formula", () => {
    const set = [
      cf("amount_total", null, null, op("+", leaf(ref("amount_supply")), leaf(ref("amount_install")))),
      cf("amount_supply", null, null, op("*", leaf(ref("qty_total")), leaf(ref("rate_supply")))),
      cf("amount_install", null, null, op("*", leaf(ref("qty_total")), leaf(ref("rate_install")))),
    ];
    const lk = mkLookup({ "qty_total|null|null": 2, "rate_supply|null|null": 3, "rate_install|null|null": 4 });
    // amount_supply=6, amount_install=8, grand=14 -- resolved in dependency order.
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toEqual({ ok: true, value: 14 });
  });

  it("an amount operand with NO formula falls back to its stored lookup value", () => {
    const set = [
      cf("amount_total", null, null, op("+", leaf(ref("amount_supply")), leaf(ref("amount_install")))),
      cf("amount_supply", null, null, op("*", leaf(ref("qty_total")), leaf(ref("rate_supply")))),
      // amount_install: NO formula in the set -> use the stored value via lookup.
    ];
    const lk = mkLookup({
      "qty_total|null|null": 2, "rate_supply|null|null": 3,
      "amount_install|null|null": 100, // stored amount, no formula
    });
    // amount_supply=6, amount_install(stored)=100, grand=106.
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toEqual({ ok: true, value: 106 });
  });
});

// ── cycle detection ───────────────────────────────────────────────────────────
describe("cycle detection -> broken", () => {
  it("A refs B, B refs A -> both broken", () => {
    const set = [
      cf("amount_total", null, null, leaf(ref("amount_supply"))),
      cf("amount_supply", null, null, leaf(ref("amount_total"))),
    ];
    const lk = mkLookup({});
    expect(evaluateAmountColumn(ref("amount_total"), set, lk)).toMatchObject({ ok: false, reason: "broken" });
    expect(evaluateAmountColumn(ref("amount_supply"), set, lk)).toMatchObject({ ok: false, reason: "broken" });
  });

  it("a self-cycle (A refs A) -> broken", () => {
    const set = [cf("amount_total", null, null, leaf(ref("amount_total")))];
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, mkLookup({}))).toMatchObject({ ok: false, reason: "broken" });
  });

  it("a cycle through an operator node is detected", () => {
    const set = [
      cf("amount_total", null, null, op("+", leaf(ref("qty_total")), leaf(ref("amount_supply")))),
      cf("amount_supply", null, null, op("*", leaf(ref("rate_supply")), leaf(ref("amount_total")))),
    ];
    const lk = mkLookup({ "qty_total|null|null": 1, "rate_supply|null|null": 1 });
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toMatchObject({ ok: false, reason: "broken" });
  });

  it("'broken' wins over 'not_yet' when a sibling operand is also missing", () => {
    const set = [
      cf("amount_total", null, null, op("+", leaf(ref("amount_supply")), leaf(ref("rate_missing")))),
      cf("amount_supply", null, null, leaf(ref("amount_total"))), // cycle -> broken
    ];
    const lk = mkLookup({}); // rate_missing absent too (not_yet) -- broken must win
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toMatchObject({ ok: false, reason: "broken" });
  });
});

// ── fail-safe: any missing operand blanks the WHOLE formula ───────────────────
describe("fail-safe (missing operand -> whole formula null)", () => {
  it("`+` with one missing operand -> not_yet, NOT the present addend", () => {
    const set = [cf("amount_total", null, null, op("+", leaf(ref("rate_supply")), leaf(ref("rate_install"))))];
    const lk = mkLookup({ "rate_supply|null|null": 3 }); // rate_install ABSENT
    const r = evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk);
    expect(r).toEqual({ ok: false, reason: "not_yet" });
    expect(r).not.toMatchObject({ ok: true }); // never the partial sum (3)
  });

  it("`*` with one missing operand -> not_yet (never zero-substituted)", () => {
    const set = [cf("amount_total", null, null, op("*", leaf(ref("qty_total")), leaf(ref("rate_combined"))))];
    const lk = mkLookup({ "qty_total|null|null": 5 }); // rate_combined ABSENT
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toEqual({ ok: false, reason: "not_yet" });
  });

  it("a missing operand deep in a nested tree blanks the whole formula", () => {
    const set = [
      cf("amount_total", null, null,
        op("*", leaf(ref("qty_total")), op("+", leaf(ref("rate_supply")), leaf(ref("rate_install"))))),
    ];
    const lk = mkLookup({ "qty_total|null|null": 2, "rate_supply|null|null": 3 }); // rate_install absent
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toEqual({ ok: false, reason: "not_yet" });
  });

  it("a missing amount-operand propagates not_yet up through the dependency chain", () => {
    const set = [
      cf("amount_total", null, null, op("+", leaf(ref("amount_supply")), leaf(ref("amount_install")))),
      cf("amount_supply", null, null, op("*", leaf(ref("qty_total")), leaf(ref("rate_supply")))),
      cf("amount_install", null, null, op("*", leaf(ref("qty_total")), leaf(ref("rate_install")))),
    ];
    const lk = mkLookup({ "qty_total|null|null": 2, "rate_supply|null|null": 3 }); // rate_install absent
    // amount_install -> not_yet -> grand -> not_yet (no partial = amount_supply only).
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toEqual({ ok: false, reason: "not_yet" });
  });
});

// ── absent-vs-zero (the resolveDescriptorValue contract) ──────────────────────
describe("absent vs zero are NOT conflated", () => {
  it("a real 0 operand yields a real computed value (0 x rate = 0, ok:true)", () => {
    const set = [cf("amount_total", null, null, op("*", leaf(ref("qty_total")), leaf(ref("rate_combined"))))];
    const lk = mkLookup({ "qty_total|null|null": 0, "rate_combined|null|null": 5 });
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toEqual({ ok: true, value: 0 });
  });

  it("a real 0 in a sum is added (0 is a value), not treated as missing", () => {
    const set = [cf("amount_total", null, null, op("+", leaf(ref("rate_supply")), leaf(ref("rate_install"))))];
    const lk = mkLookup({ "rate_supply|null|null": 0, "rate_install|null|null": 7 });
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toEqual({ ok: true, value: 7 });
  });

  it("the SAME formula: 0 -> ok value 0; absent -> not_yet (proven side by side)", () => {
    const set = [cf("amount_total", null, null, op("*", leaf(ref("qty_total")), leaf(ref("rate_combined"))))];
    const zero = mkLookup({ "qty_total|null|null": 0, "rate_combined|null|null": 5 });
    const absent = mkLookup({ "rate_combined|null|null": 5 }); // qty_total missing
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, zero)).toEqual({ ok: true, value: 0 });
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, absent)).toEqual({ ok: false, reason: "not_yet" });
  });
});

// ── malformed trees + never-throws ────────────────────────────────────────────
describe("malformed tree -> broken; never throws on bad data", () => {
  it("a node that is neither operator nor leaf -> broken", () => {
    const set = [cf("amount_total", null, null, {} as unknown as AmountFormulaNode)];
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, mkLookup({}))).toMatchObject({ ok: false, reason: "broken" });
  });

  it("a bad operator (not + or *) -> broken", () => {
    const set = [cf("amount_total", null, null,
      { op: "-", operands: [leaf(ref("qty_total"))] } as unknown as AmountFormulaNode)];
    const lk = mkLookup({ "qty_total|null|null": 5 });
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, lk)).toMatchObject({ ok: false, reason: "broken" });
  });

  it("an operator with empty operands -> broken", () => {
    const set = [cf("amount_total", null, null, { op: "+", operands: [] } as AmountFormulaNode)];
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, mkLookup({}))).toMatchObject({ ok: false, reason: "broken" });
  });

  it("never throws on bad data (a lookup returning NaN -> a fail-safe result, not an exception)", () => {
    const set = [cf("amount_total", null, null, leaf(ref("qty_total")))];
    const nanLk: OperandLookup = () => NaN;
    let r: ReturnType<typeof evaluateAmountColumn>;
    expect(() => { r = evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, nanLk); }).not.toThrow();
    expect(r!).toMatchObject({ ok: false }); // NaN is not a real value -> fail-safe
  });

  it("a column with no declared formula returns its stored value (or not_yet when absent)", () => {
    const set: ColumnFormula[] = []; // no formulas at all
    const present = mkLookup({ "amount_total|null|null": 42 });
    const absent = mkLookup({});
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, present)).toEqual({ ok: true, value: 42 });
    expect(evaluateAmountColumn(SCALAR_AMOUNT_TOTAL, set, absent)).toEqual({ ok: false, reason: "not_yet" });
  });
});

// ── pickFormula precedence + evaluateAllColumns + columnKey ───────────────────
describe("helpers", () => {
  it("pickFormula: override (concrete area) wins over the wildcard default", () => {
    const def = cf("amount_by_area", null, "total", leaf(ref("qty_total")));
    const ovr = cf("amount_by_area", "Phase 1", "total", leaf(ref("rate_combined")));
    const set = [def, ovr];
    expect(pickFormula(ref("amount_by_area", "Phase 1", "total"), set)).toBe(ovr);
    expect(pickFormula(ref("amount_by_area", "Phase 2", "total"), set)).toBe(def); // no override -> default
    expect(pickFormula(ref("amount_by_area", "Phase 1", "supply"), set)).toBeNull(); // axis mismatch
    expect(pickFormula(ref("rate_by_area", "Phase 1", "combined_rate"), set)).toBeNull(); // not an amount target
  });

  it("evaluateAllColumns returns a result per declared column, keyed by columnKey", () => {
    const set = [
      cf("amount_by_area", null, "total",
        op("*", leaf(ref("qty_by_area", null, null)), leaf(ref("rate_by_area", null, "combined_rate")))),
    ];
    const lk = mkLookup({ "qty_by_area|null|null": 0 }); // a default (value_key null) target rarely evaluated directly
    const out = evaluateAllColumns(set, lk);
    expect(out.has(columnKey(ref("amount_by_area", null, "total")))).toBe(true);
  });
});
