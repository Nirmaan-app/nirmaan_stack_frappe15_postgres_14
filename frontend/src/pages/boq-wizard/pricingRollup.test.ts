// Unit tests for rollupByParent (BoQ Phase 5 -- Summary panel parent-tree amount rollups).
//
// Anti-anchoring coverage: the FIVE real committed amount-column shapes seen across the
// corpus (symmetric per-area, asymmetric per-area, scalar single-total, full per-area +
// scalar split, priced-preamble) prove the column-by-column rollup mirrors ANY amount
// structure; two negatives (cycle, blank/un-priced) prove it is safe + correct on edge
// data. Totals are keyed by the amount descriptor's Excel col letter (RollupNode.totals).
import { describe, it, expect } from "vitest";
import { rollupByParent, minPreambleDepth, defaultCollapsedSet } from "./pricingRollup";
import type {
  AmountFormulaNode,
  AmountFormulaRef,
  ColumnDescriptor,
  ColumnFormula,
  PricedRow,
} from "./boqTypes";

function desc(
  col: string,
  role: string,
  value_field: string,
  value_key: string | null = null,
  rate_subkey: string | null = null,
): ColumnDescriptor {
  return { col, role, area: value_key, value_field, value_key, rate_subkey };
}

// Narrow row factory -- rollupByParent reads only these fields; cast the rest.
function prow(p: Partial<PricedRow>): PricedRow {
  return p as unknown as PricedRow;
}

// Find a root node by its row_index.
function root(result: ReturnType<typeof rollupByParent>, rowIndex: number) {
  return result.roots.find((n) => n.rowIndex === rowIndex);
}

describe("rollupByParent", () => {
  // ── T1: HVAC-like -- per-area single combined (total), SYMMETRIC across 2 areas ──
  it("T1 per-area symmetric (total both areas): each area's total rolls up independently", () => {
    const cds = [
      desc("A", "sl_no", "sl_no_value"),
      desc("B", "description", "description"),
      desc("D", "qty", "qty_by_area", "Phase 1"),
      desc("E", "rate_combined_by_area", "rate_by_area", "Phase 1", "combined_rate"),
      desc("F", "amount_total_by_area", "amount_by_area", "Phase 1", "total"),
      desc("G", "qty", "qty_by_area", "Phase 2"),
      desc("H", "rate_combined_by_area", "rate_by_area", "Phase 2", "combined_rate"),
      desc("I", "amount_total_by_area", "amount_by_area", "Phase 2", "total"),
    ];
    const rows = [
      prow({ row_index: 0, effective_parent_index: null, effective_classification: "preamble", description: "P" }),
      prow({
        row_index: 1, effective_parent_index: 0, effective_classification: "line_item", description: "i1",
        qty_by_area: { "Phase 1": 10, "Phase 2": 2 },
        rate_by_area: { "Phase 1": { combined_rate: 5 }, "Phase 2": { combined_rate: 3 } } as never,
      }),
      prow({
        row_index: 2, effective_parent_index: 0, effective_classification: "line_item", description: "i2",
        qty_by_area: { "Phase 1": 4, "Phase 2": 1 },
        rate_by_area: { "Phase 1": { combined_rate: 5 }, "Phase 2": { combined_rate: 10 } } as never,
      }),
    ];
    const result = rollupByParent(rows, cds);
    expect(result.columns.map((c) => c.col)).toEqual(["F", "I"]); // only amount cols
    const p = root(result, 0)!;
    expect(p.totals["F"]).toBe(70); // 10*5 + 4*5
    expect(p.totals["I"]).toBe(16); // 2*3 + 1*10
    // independent: the two areas do not bleed into each other
    expect(p.totals["F"]).not.toBe(p.totals["I"]);
  });

  // ── T2: Electrical-like -- ASYMMETRIC per-area (area1 total / area2 install) ──
  it("T2 asymmetric per-area (total / install): columns keep their OWN kinds, not normalized", () => {
    const cds = [
      desc("D", "qty", "qty_by_area", "Phase 1"),
      desc("E", "rate_combined_by_area", "rate_by_area", "Phase 1", "combined_rate"),
      desc("F", "amount_total_by_area", "amount_by_area", "Phase 1", "total"),
      desc("G", "qty", "qty_by_area", "Phase 2"),
      desc("H", "rate_install_by_area", "rate_by_area", "Phase 2", "install_rate"),
      desc("I", "amount_install_by_area", "amount_by_area", "Phase 2", "install"),
    ];
    const rows = [
      prow({ row_index: 0, effective_parent_index: null, effective_classification: "preamble", description: "P" }),
      prow({
        row_index: 1, effective_parent_index: 0, effective_classification: "line_item", description: "i1",
        qty_by_area: { "Phase 1": 10, "Phase 2": 4 },
        rate_by_area: { "Phase 1": { combined_rate: 5 }, "Phase 2": { install_rate: 7 } } as never,
      }),
    ];
    const result = rollupByParent(rows, cds);
    const p = root(result, 0)!;
    expect(p.totals["F"]).toBe(50); // Phase1 total = 10 * combined_rate 5
    expect(p.totals["I"]).toBe(28); // Phase2 install = 4 * install_rate 7
  });

  // ── T3: low side-like -- SCALAR single total (post-fix clean: rate_combined present) ──
  it("T3 scalar single total: one scalar amount_total column rolls up", () => {
    const cds = [
      desc("D", "qty_total", "qty_total"),
      desc("E", "rate_combined", "rate_combined"),
      desc("G", "amount_total", "amount_total"),
    ];
    const rows = [
      prow({ row_index: 0, effective_parent_index: null, effective_classification: "preamble", description: "P" }),
      prow({ row_index: 1, effective_parent_index: 0, effective_classification: "line_item", description: "i1", qty_total: 40, rate_combined: 1120 }),
      prow({ row_index: 2, effective_parent_index: 0, effective_classification: "line_item", description: "i2", qty_total: 2, rate_combined: 100 }),
    ];
    const result = rollupByParent(rows, cds);
    expect(result.columns.map((c) => c.col)).toEqual(["G"]);
    expect(root(result, 0)!.totals["G"]).toBe(45000); // 40*1120 + 2*100
  });

  // ── T4: VRF-like -- FULL per-area + scalar supply/install/total split (maximal) ──
  it("T4 maximal split: all 9 amount columns roll up INDEPENDENTLY, no surface-merge", () => {
    const cds = [
      desc("E", "qty", "qty_by_area", "L1"),
      desc("F", "qty", "qty_by_area", "L2"),
      desc("G", "qty_total", "qty_total"),
      desc("H", "rate_supply_by_area", "rate_by_area", "L1", "supply_rate"),
      desc("I", "rate_install_by_area", "rate_by_area", "L1", "install_rate"),
      desc("J", "rate_combined_by_area", "rate_by_area", "L1", "combined_rate"),
      desc("K", "rate_supply_by_area", "rate_by_area", "L2", "supply_rate"),
      desc("L", "rate_install_by_area", "rate_by_area", "L2", "install_rate"),
      desc("M", "rate_combined_by_area", "rate_by_area", "L2", "combined_rate"),
      desc("N", "rate_supply", "rate_supply"),
      desc("O", "rate_install", "rate_install"),
      desc("P", "rate_combined", "rate_combined"),
      desc("Q", "amount_supply_by_area", "amount_by_area", "L1", "supply"),
      desc("R", "amount_install_by_area", "amount_by_area", "L1", "install"),
      desc("S", "amount_total_by_area", "amount_by_area", "L1", "total"),
      desc("T", "amount_supply_by_area", "amount_by_area", "L2", "supply"),
      desc("U", "amount_install_by_area", "amount_by_area", "L2", "install"),
      desc("V", "amount_total_by_area", "amount_by_area", "L2", "total"),
      desc("W", "amount_supply", "amount_supply"),
      desc("X", "amount_install", "amount_install"),
      desc("Y", "amount_total", "amount_total"),
    ];
    const rows = [
      prow({ row_index: 0, effective_parent_index: null, effective_classification: "preamble", description: "P" }),
      prow({
        row_index: 1, effective_parent_index: 0, effective_classification: "line_item", description: "i1",
        qty_by_area: { L1: 2, L2: 3 }, qty_total: 5,
        rate_by_area: {
          L1: { supply_rate: 10, install_rate: 1, combined_rate: 11 },
          L2: { supply_rate: 20, install_rate: 2, combined_rate: 22 },
        } as never,
        rate_supply: 100, rate_install: 5, rate_combined: 105,
      }),
    ];
    const result = rollupByParent(rows, cds);
    expect(result.columns).toHaveLength(9); // Q R S T U V W X Y
    const p = root(result, 0)!;
    expect(p.totals["Q"]).toBe(20);  // L1 supply  = 2 * 10
    expect(p.totals["R"]).toBe(2);   // L1 install = 2 * 1
    expect(p.totals["S"]).toBe(22);  // L1 total   = 2 * 11
    expect(p.totals["T"]).toBe(60);  // L2 supply  = 3 * 20
    expect(p.totals["U"]).toBe(6);   // L2 install = 3 * 2
    expect(p.totals["V"]).toBe(66);  // L2 total   = 3 * 22
    expect(p.totals["W"]).toBe(500); // scalar supply  = 5 * 100
    expect(p.totals["X"]).toBe(25);  // scalar install = 5 * 5
    expect(p.totals["Y"]).toBe(525); // scalar total   = 5 * 105
    // independence: per-area and scalar surfaces are distinct, never merged
    expect(p.totals["Q"]).not.toBe(p.totals["W"]);
    expect(p.totals["S"]).not.toBe(p.totals["Y"]);
  });

  // ── T5: PRICED PREAMBLE -- own amount counted ONCE, not doubled with children ──
  it("T5 priced preamble: parent total = preamble's own + children's (no double-count)", () => {
    const cds = [
      desc("D", "qty_total", "qty_total"),
      desc("E", "rate_combined", "rate_combined"),
      desc("G", "amount_total", "amount_total"),
    ];
    const rows = [
      prow({ row_index: 0, effective_parent_index: null, effective_classification: "preamble", description: "priced preamble", qty_total: 2, rate_combined: 100 }),
      prow({ row_index: 1, effective_parent_index: 0, effective_classification: "line_item", description: "c1", qty_total: 5, rate_combined: 10 }),
      prow({ row_index: 2, effective_parent_index: 0, effective_classification: "line_item", description: "c2", qty_total: 3, rate_combined: 10 }),
    ];
    const result = rollupByParent(rows, cds);
    const p = root(result, 0)!;
    expect(p.ownAmounts["G"]).toBe(200);  // the preamble's OWN amount (2 * 100)
    expect(p.totals["G"]).toBe(280);      // 200 own + 50 + 30 -- own counted ONCE
    expect(p.children).toHaveLength(2);
  });

  // ── T6 (negative): cycle guard -- malformed parent cycle terminates, no hang ──
  it("T6 cycle guard: a malformed effective_parent_index cycle does not hang", () => {
    const cds = [
      desc("D", "qty_total", "qty_total"),
      desc("E", "rate_combined", "rate_combined"),
      desc("G", "amount_total", "amount_total"),
    ];
    const rows = [
      // 2-node mutual cycle (neither is a root -> excluded from the forest)
      prow({ row_index: 0, effective_parent_index: 1, effective_classification: "line_item", description: "A", qty_total: 1, rate_combined: 9 }),
      prow({ row_index: 1, effective_parent_index: 0, effective_classification: "line_item", description: "B", qty_total: 1, rate_combined: 9 }),
      // a healthy root + child
      prow({ row_index: 2, effective_parent_index: null, effective_classification: "preamble", description: "R", qty_total: 1, rate_combined: 100 }),
      prow({ row_index: 3, effective_parent_index: 2, effective_classification: "line_item", description: "rc", qty_total: 2, rate_combined: 10 }),
      // self-parent -> treated as a root leaf, no self-loop
      prow({ row_index: 4, effective_parent_index: 4, effective_classification: "line_item", description: "self", qty_total: 1, rate_combined: 5 }),
    ];
    const result = rollupByParent(rows, cds); // must RETURN (not hang)
    expect(root(result, 2)!.totals["G"]).toBe(120); // 100 own + 2*10 child -- healthy branch correct
    expect(root(result, 4)!.totals["G"]).toBe(5);   // self-parent root leaf = its own amount
    expect(root(result, 0)).toBeUndefined();        // cycle members are not roots
  });

  // ── T7 (negative): blank / un-priced rows contribute ZERO to the rollup ──
  it("T7 blank/un-priced: zero rate -> 0, no rate -> null, both contribute nothing", () => {
    const cds = [
      desc("D", "qty_total", "qty_total"),
      desc("E", "rate_combined", "rate_combined"),
      desc("G", "amount_total", "amount_total"),
    ];
    const rows = [
      prow({ row_index: 0, effective_parent_index: null, effective_classification: "preamble", description: "P" }),
      prow({ row_index: 1, effective_parent_index: 0, effective_classification: "line_item", description: "zero-rate", qty_total: 10, rate_combined: 0 }),
      prow({ row_index: 2, effective_parent_index: 0, effective_classification: "line_item", description: "no-rate", qty_total: 5 }),
      prow({ row_index: 3, effective_parent_index: 0, effective_classification: "note", description: "note row" }),
    ];
    const result = rollupByParent(rows, cds);
    const p = root(result, 0)!;
    expect(p.totals["G"]).toBe(0);                 // 0 + (null->0) + (null->0)
    expect(root(result, 1)).toBeUndefined();       // children are not roots
    // verify the per-row own values via the tree
    const zero = p.children.find((c) => c.rowIndex === 1)!;
    const norate = p.children.find((c) => c.rowIndex === 2)!;
    expect(zero.ownAmounts["G"]).toBe(0);          // computeAmount(10, 0) === 0
    expect(norate.ownAmounts["G"]).toBeNull();     // computeAmount(5, null) === null
  });
});

// ── Summary-panel default-view helpers (display support; math unchanged) ──────────
// minPreambleDepth + defaultCollapsedSet pin the "open expanded to the shallowest
// preamble tier" default across level-1, level-0, and single-tier shapes. Built via
// rollupByParent (descriptors irrelevant -> []) so depth is the real computed depth.
describe("minPreambleDepth + defaultCollapsedSet", () => {
  const node = (
    row_index: number,
    effective_parent_index: number | null,
    cls: string,
  ): PricedRow =>
    ({ row_index, effective_parent_index, effective_classification: cls } as unknown as PricedRow);

  it("D1 level-1 shallowest: preamble under a depth-0 root -> min depth 1, that tier collapsed", () => {
    const rows = [
      node(0, null, "line_item"), // depth 0 (a root parent)
      node(1, 0, "preamble"),     // depth 1 -- shallowest preamble
      node(2, 1, "line_item"),    // depth 2
    ];
    const { roots } = rollupByParent(rows, []);
    expect(minPreambleDepth(roots)).toBe(1);
    expect([...defaultCollapsedSet(roots)]).toEqual([1]); // depth-1 parent collapsed
  });

  it("D2 level-0/level-less: top preamble at depth 0 -> min depth 0, root collapsed", () => {
    const rows = [
      node(0, null, "preamble"), // depth 0 -- shallowest preamble
      node(1, 0, "line_item"),   // depth 1
    ];
    const { roots } = rollupByParent(rows, []);
    expect(minPreambleDepth(roots)).toBe(0);
    expect([...defaultCollapsedSet(roots)]).toEqual([0]);
  });

  it("D3 multiple preambles at one tier: both depth-0 preambles collapsed", () => {
    const rows = [
      node(0, null, "preamble"), node(1, 0, "line_item"),
      node(2, null, "preamble"), node(3, 2, "line_item"),
    ];
    const { roots } = rollupByParent(rows, []);
    expect(minPreambleDepth(roots)).toBe(0);
    expect([...defaultCollapsedSet(roots)].sort((a, b) => a - b)).toEqual([0, 2]);
  });

  it("D4 no preamble: min depth null -> empty collapsed (panel opens fully expanded)", () => {
    const rows = [node(0, null, "line_item"), node(1, 0, "line_item")];
    const { roots } = rollupByParent(rows, []);
    expect(minPreambleDepth(roots)).toBeNull();
    expect(defaultCollapsedSet(roots).size).toBe(0);
  });
});

// ── Summary fix: formula-aware rollup + grand total + reconciliation ──────────────
//
// The zero-fix: a formula-only amount column (no paired rate) contributes its FORMULA value
// to the rollup (previously it paired to null -> 0 while the grid cell showed the right
// number). The grand-total row (Option 1) + the Option-1-vs-Option-2 reconciliation guard.
function fref(value_field: string, value_key: string | null = null, rate_subkey: string | null = null): AmountFormulaRef {
  return { value_field, value_key, rate_subkey };
}
function fleaf(r: AmountFormulaRef): AmountFormulaNode {
  return { ref: r };
}
function fop(o: "+" | "*", ...operands: AmountFormulaNode[]): AmountFormulaNode {
  return { op: o, operands };
}
function cf(
  target_value_field: string,
  target_value_key: string | null,
  target_rate_subkey: string | null,
  formula: AmountFormulaNode | null,
): ColumnFormula {
  return { target_value_field, target_value_key, target_rate_subkey, target_col: null, formula };
}

describe("rollupByParent -- formula-aware (the zero-fix)", () => {
  // A 2-area sheet: Phase 1 has a COMBINED rate (the amount pairs, no formula needed); Phase 2
  // is SPLIT supply+install with a single total -> the OLD pairing returns null (combined rate
  // absent) -> 0. A per-area OVERRIDE formula on Phase 2's total fixes it. Phase 1 stays on the
  // unchanged pairing path.
  const cds = [
    desc("D", "qty", "qty_by_area", "Phase 1"),
    desc("E", "rate_combined_by_area", "rate_by_area", "Phase 1", "combined_rate"),
    desc("F", "amount_total_by_area", "amount_by_area", "Phase 1", "total"),
    desc("G", "qty", "qty_by_area", "Phase 2"),
    desc("H", "rate_supply_by_area", "rate_by_area", "Phase 2", "supply_rate"),
    desc("I", "rate_install_by_area", "rate_by_area", "Phase 2", "install_rate"),
    desc("J", "amount_total_by_area", "amount_by_area", "Phase 2", "total"),
  ];
  // Phase 2 total = qty x (supply + install) -- a per-area override.
  const phase2Formula = cf(
    "amount_by_area", "Phase 2", "total",
    fop("*", fleaf(fref("qty_by_area", "Phase 2")),
      fop("+", fleaf(fref("rate_by_area", "Phase 2", "supply_rate")), fleaf(fref("rate_by_area", "Phase 2", "install_rate")))),
  );
  const li = prow({
    row_index: 1,
    effective_parent_index: null,
    effective_classification: "line_item",
    qty_by_area: { "Phase 1": 10, "Phase 2": 5 } as Record<string, number>,
    rate_by_area: {
      "Phase 1": { combined_rate: 8 },
      "Phase 2": { supply_rate: 3, install_rate: 4 },
    } as unknown as PricedRow["rate_by_area"],
    priced_by_area: {
      "Phase 1": { combined_rate: true },
      "Phase 2": { supply_rate: true, install_rate: true },
    } as unknown as PricedRow["priced_by_area"],
  });

  it("WITHOUT the formula, Phase 2's split-rate total rolls up ZERO (the bug)", () => {
    const r = root(rollupByParent([li], cds, []), 1)!;
    expect(r.totals["F"]).toBe(80); // Phase 1 pairs to combined: 10 x 8
    expect(r.totals["J"]).toBe(0); // Phase 2 total has no paired combined rate -> 0
  });

  it("WITH the formula, Phase 2 contributes (10 x 8 = 80; 5 x (3+4) = 35); Phase 1 UNCHANGED", () => {
    const r = root(rollupByParent([li], cds, [phase2Formula]), 1)!;
    expect(r.totals["F"]).toBe(80); // Phase 1 unchanged (no formula -> pairing)
    expect(r.totals["J"]).toBe(35); // Phase 2 now formula-driven: 5 x (3+4)
  });

  it("REGRESSION (D-2): Phase 1's no-formula number is identical with or without columnFormulas", () => {
    const noArg = root(rollupByParent([li], cds), 1)!;
    const withFormula = root(rollupByParent([li], cds, [phase2Formula]), 1)!;
    expect(noArg.totals["F"]).toBe(80);
    expect(withFormula.totals["F"]).toBe(80); // the formula on J never touches F
  });

  it("treat-as-0: a formula whose rate operand is an UNFILLED 0.0 (no marker) folds to 0 (not_yet)", () => {
    // Prepopulated-rate fix: a NON-ZERO committed rate (no marker) is now USABLE, so the
    // genuine-unfilled case is a committed 0.0 -> not_yet -> 0 (the §0 "needs a rate" signal).
    const unfilled = prow({
      row_index: 1, effective_parent_index: null, effective_classification: "line_item",
      qty_by_area: { "Phase 2": 5 } as Record<string, number>,
      rate_by_area: { "Phase 2": { supply_rate: 0, install_rate: 0 } } as unknown as PricedRow["rate_by_area"],
      // 0.0 committed rates, NO priced markers -> the saved-only lookup returns undefined -> not_yet.
    });
    const r = root(rollupByParent([unfilled], cds, [phase2Formula]), 1)!;
    expect(r.totals["J"]).toBe(0);
  });

  it("PREPOPULATED-RATE FIX flows to the SUMMARY: non-zero committed rates (no marker) roll up", () => {
    // The same shared lookupOperandValue (drafts={}) now reads a non-zero committed rate ->
    // the summary totals it (previously it folded to 0 alongside the grid cell).
    const prepopulated = prow({
      row_index: 1, effective_parent_index: null, effective_classification: "line_item",
      qty_by_area: { "Phase 2": 5 } as Record<string, number>,
      rate_by_area: { "Phase 2": { supply_rate: 3, install_rate: 4 } } as unknown as PricedRow["rate_by_area"],
      // NON-ZERO committed rates, NO priced markers (the 150/166 case).
    });
    const r = root(rollupByParent([prepopulated], cds, [phase2Formula]), 1)!;
    expect(r.totals["J"]).toBe(35); // 5 * (3 + 4)
  });

  it("treat-as-0: a CYCLE/broken formula folds to 0", () => {
    const scalarCds = [desc("C", "qty_total", "qty_total"), desc("G", "amount_total", "amount_total")];
    const selfCycle = cf("amount_total", null, null, fleaf(fref("amount_total"))); // self-ref -> broken
    const row = prow({ row_index: 1, effective_parent_index: null, effective_classification: "line_item", qty_total: 5 });
    const r = root(rollupByParent([row], scalarCds, [selfCycle]), 1)!;
    expect(r.totals["G"]).toBe(0);
  });
});

describe("rollupByParent -- grand total (Option 1) + reconciliation", () => {
  // Scalar amount sheet: pairing path (no formulas). amount_total pairs to rate_combined.
  const cds = [
    desc("C", "qty_total", "qty_total"),
    desc("D", "rate_combined", "rate_combined"),
    desc("G", "amount_total", "amount_total"),
  ];
  const li = (idx: number, parent: number | null, qty: number, rate: number, cls = "line_item") =>
    prow({
      row_index: idx, effective_parent_index: parent, effective_classification: cls,
      qty_total: qty, rate_combined: rate,
    });

  it("grand total = sum of top-level rolled totals incl. a root orphan; each item counted once", () => {
    // root preamble (own 0) -> child line item (50); a SEPARATE root orphan line item (30).
    const rows = [
      prow({ row_index: 0, effective_parent_index: null, effective_classification: "preamble" }),
      li(1, 0, 10, 5), // child of the preamble -> 50, inside root 0's rolled total
      li(2, null, 6, 5), // root-level ORPHAN line item -> 30
    ];
    const res = rollupByParent(rows, cds);
    // Option 1: rolled(0)=0+50=50, rolled(2)=30 -> grand total 80 (each item once).
    expect(res.grandTotals["G"]).toBe(80);
    expect(res.integrityErrors).toEqual([]); // a well-formed tree reconciles
  });

  it("a well-formed tree with fractional amounts reconciles (epsilon does not false-fire)", () => {
    const rows = [li(0, null, 1, 0.1), li(1, 0, 1, 0.2), li(2, 0, 1, 0.3)];
    const res = rollupByParent(rows, cds);
    expect(res.integrityErrors).toEqual([]);
    expect(res.grandTotals["G"]).toBeCloseTo(0.6, 9);
  });

  it("a CORRUPTED tree (a 2-cycle with no root) -> the integrity check FIRES", () => {
    // A.parent=B, B.parent=A -> neither is a root -> Option 1 = 0; Option 2 = 50 + 30 = 80.
    const rows = [li(1, 2, 10, 5), li(2, 1, 6, 5)];
    const res = rollupByParent(rows, cds);
    expect(res.grandTotals["G"]).toBe(0); // no roots -> tree total 0
    expect(res.integrityErrors.length).toBe(1);
    expect(res.integrityErrors[0].col).toBe("G");
    expect(res.integrityErrors[0].option1).toBe(0);
    expect(res.integrityErrors[0].option2).toBe(80); // the flat line-item sum still finds it
  });
});
