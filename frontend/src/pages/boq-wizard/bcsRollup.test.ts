// Unit tests for bcsRollup (BCS-S5 -- BCS cost / Tendered / % Margin per BoQ section).
//
// ★ THE HEADLINE TEST IS T1, THE RATIO RULE. % Margin for a section is RECOMPUTED from the
// section's summed cost and summed tendered amount -- never the average of its lines' percentages,
// never their sum. T1 is built so that an average (46%) and a sum (92%) are BOTH far away from the
// weighted answer (~2.0%), so a future "simplification" to either one fails loudly instead of
// producing a plausible, meaningless number on a screen someone prices from.
//
// The rest cover: rolling cost up the same tree the amounts roll up, the absent-vs-zero
// distinction on both sides (a section with no costed lines must never read 0%), the inherited
// zero/negative/non-finite denominator guards, and the consistency rule -- tendered comes from the
// rollup's OWN per-node totals and grandTotals, never a second derivation.
import { describe, it, expect } from "vitest";
import { rollBcsSections, sectionMarginPercent, type BcsRollupNodeLike } from "./bcsRollup";

/** Minimal structural node. `totals` = rolled amounts (pricingRollup's own numbers);
 *  `ownAmounts` = this row's OWN amount per column (null = contributes nothing). */
function node(
  rowIndex: number,
  totals: Record<string, number>,
  ownAmounts: Record<string, number | null>,
  children: BcsRollupNodeLike[] = [],
): BcsRollupNodeLike {
  return { rowIndex, totals, ownAmounts, children };
}

/** Grand totals as pricingRollup computes them: the sum of the top-level rolled totals. */
function grandOf(roots: BcsRollupNodeLike[], cols: string[]): Record<string, number> {
  const g: Record<string, number> = {};
  for (const c of cols) g[c] = roots.reduce((s, r) => s + (r.totals[c] ?? 0), 0);
  return g;
}

/** A cost lookup from a plain {rowIndex: cost} map; absent = never costed (null). */
function costs(m: Record<number, number | null>) {
  return (rowIndex: number) => (rowIndex in m ? m[rowIndex] : null);
}

describe("sectionMarginPercent -- the ratio rule, in one function", () => {
  it("T0 recomputes (tendered - cost) / tendered, NOT cost/tendered and NOT a markup on cost", () => {
    // cost 80 against tendered 100 -> 20% profit.
    const cell = sectionMarginPercent(80, 100);
    expect(cell).toEqual({ kind: "value", value: 20 });
    // The two re-derivations this must never become: cost/amount (80%) and markup-on-cost (25%).
    // Both read HIGHER on exactly the sheets that need a warning -- the owner-settled direction.
    expect(cell.kind === "value" && cell.value).not.toBe(80);
    expect(cell.kind === "value" && cell.value).not.toBe(25);
  });

  it("T0b a section that has no cost at all is BLANK with a reason, never 0%", () => {
    expect(sectionMarginPercent(null, 1000)).toEqual({ kind: "blank", reason: "no_cost" });
  });

  it("T0c a section with no tendered amount is BLANK with a reason, never 0%", () => {
    expect(sectionMarginPercent(500, null)).toEqual({ kind: "blank", reason: "no_amount" });
  });

  it("T0d a ZERO cost is a real value, not an absence -- it is a 100% margin", () => {
    expect(sectionMarginPercent(0, 250)).toEqual({ kind: "value", value: 100 });
  });

  it("T0e zero / negative tendered inherit bcsMarginPercent's guards (no profit on a loss)", () => {
    expect(sectionMarginPercent(50, 0)).toEqual({ kind: "blank", reason: "zero_amount" });
    // -100 against cost 50 would compute +150% -- a loss displayed as profit. Refused.
    expect(sectionMarginPercent(50, -100)).toEqual({ kind: "blank", reason: "negative_amount" });
  });
});

describe("rollBcsSections", () => {
  // ── ★ T1: THE RATIO RULE ──────────────────────────────────────────────────────
  it("★ T1 recomputes % Margin from SUMMED cost / SUMMED tendered -- never an average of the lines", () => {
    // One tiny line at 90% margin beside one huge line at 2%. An average weights them equally.
    //   A: cost 1        tendered 10          -> 90%
    //   B: cost 980,000  tendered 1,000,000   -> 2%
    // section: cost 980,001 / tendered 1,000,010 -> (1000010-980001)/1000010*100 = 2.00088...%
    const a = node(1, { G: 10 }, { G: 10 });
    const b = node(2, { G: 1_000_000 }, { G: 1_000_000 });
    const section = node(0, { G: 1_000_010 }, { G: null }, [a, b]);
    const roots = [section];

    const res = rollBcsSections(
      roots,
      costs({ 1: 1, 2: 980_000 }),
      ["G"],
      grandOf(roots, ["G"]),
    );

    const s = res.byRowIndex.get(0)!;
    expect(s.cost).toBe(980_001);
    expect(s.tendered).toBe(1_000_010);
    expect(s.margin.kind).toBe("value");
    const pct = s.margin.kind === "value" ? s.margin.value : NaN;

    // The weighted answer -- dominated by the big line, which is the whole point.
    expect(pct).toBeCloseTo(2.00088, 4);

    // ⚠️ THE REGRESSION GUARDS. If anyone ever replaces the recomputation with an average of the
    // per-line percentages (46%) or their sum (92%), these fail. Both alternatives look entirely
    // plausible on screen, which is exactly why they are pinned here rather than left to review.
    expect(pct).not.toBeCloseTo(46, 0); // mean of 90 and 2
    expect(pct).not.toBeCloseTo(92, 0); // sum of 90 and 2
    expect(pct).toBeLessThan(3); // nowhere near either
  });

  it("T1b the ratio rule holds at the GRAND row too, over sections of wildly different size", () => {
    // Section X: cost 1 / tendered 10 (90%). Section Y: cost 980,000 / tendered 1,000,000 (2%).
    const x = node(0, { G: 10 }, { G: 10 });
    const y = node(1, { G: 1_000_000 }, { G: 1_000_000 });
    const roots = [x, y];
    const res = rollBcsSections(roots, costs({ 0: 1, 1: 980_000 }), ["G"], grandOf(roots, ["G"]));

    expect(res.grand.cost).toBe(980_001);
    expect(res.grand.tendered).toBe(1_000_010);
    const pct = res.grand.margin.kind === "value" ? res.grand.margin.value : NaN;
    expect(pct).toBeCloseTo(2.00088, 4);
    expect(pct).not.toBeCloseTo(46, 0);
  });

  // ── Rolling up the same tree the amounts roll up ──────────────────────────────
  it("T2 a section's cost = its OWN cost plus every descendant's, counted exactly once", () => {
    // A priced preamble carries a cost for its own row only -- never a sum of its children,
    // mirroring how pricingRollup treats a priced preamble's own amount.
    const leaf1 = node(2, { G: 100 }, { G: 100 });
    const leaf2 = node(3, { G: 200 }, { G: 200 });
    const mid = node(1, { G: 350 }, { G: 50 }, [leaf1, leaf2]); // own 50 + 100 + 200
    const roots = [mid];
    const res = rollBcsSections(
      roots,
      costs({ 1: 5, 2: 10, 3: 20 }),
      ["G"],
      grandOf(roots, ["G"]),
    );
    expect(res.byRowIndex.get(1)!.cost).toBe(35); // 5 + 10 + 20, the preamble's own once
    expect(res.byRowIndex.get(2)!.cost).toBe(10);
    expect(res.byRowIndex.get(3)!.cost).toBe(20);
    expect(res.grand.cost).toBe(35);
  });

  it("T3 tendered is read FROM the node's rolled totals -- the rollup's own number, not a re-sum", () => {
    // `totals` deliberately disagrees with the children's ownAmounts. The rollup's number wins:
    // this is the consistency rule -- the summary and the grid must not derive it separately.
    const leaf = node(1, { G: 7 }, { G: 7 });
    const parent = node(0, { G: 999 }, { G: null }, [leaf]);
    const roots = [parent];
    const res = rollBcsSections(roots, costs({ 1: 1 }), ["G"], grandOf(roots, ["G"]));
    expect(res.byRowIndex.get(0)!.tendered).toBe(999);
  });

  it("T4 several tendered columns are summed across the confirmed set", () => {
    const leaf = node(1, { G: 10, H: 5 }, { G: 10, H: 5 });
    const parent = node(0, { G: 10, H: 5 }, { G: null, H: null }, [leaf]);
    const roots = [parent];
    const res = rollBcsSections(roots, costs({ 1: 3 }), ["G", "H"], grandOf(roots, ["G", "H"]));
    expect(res.byRowIndex.get(0)!.tendered).toBe(15);
  });

  it("T4b a column mapped TWICE is counted once -- a duplicate confirmation cannot double the denominator", () => {
    const leaf = node(1, { G: 10 }, { G: 10 });
    const parent = node(0, { G: 10 }, { G: null }, [leaf]);
    const roots = [parent];
    const res = rollBcsSections(roots, costs({ 1: 3 }), ["G", "G"], grandOf(roots, ["G"]));
    expect(res.byRowIndex.get(0)!.tendered).toBe(10);
  });

  it("T4c a confirmed column this sheet no longer carries contributes nothing and cannot fake presence", () => {
    // A re-commit that moved columns can strand a stored confirmation. An unknown col must not
    // read as a zero-amount section (which would show a real 0 and a zero_amount margin).
    const leaf = node(1, {}, {});
    const parent = node(0, {}, {}, [leaf]);
    const roots = [parent];
    const res = rollBcsSections(roots, costs({ 1: 3 }), ["Z"], grandOf(roots, ["Z"]));
    expect(res.byRowIndex.get(0)!.tendered).toBeNull();
    expect(res.byRowIndex.get(0)!.margin).toEqual({ kind: "blank", reason: "no_amount" });
  });

  // ── ABSENT vs ZERO, on both sides ─────────────────────────────────────────────
  it("T5 a section with NO costed line has cost null and a blank margin -- it cannot read as 0%", () => {
    const leaf = node(1, { G: 500 }, { G: 500 });
    const parent = node(0, { G: 500 }, { G: null }, [leaf]);
    const roots = [parent];
    const res = rollBcsSections(roots, costs({}), ["G"], grandOf(roots, ["G"]));
    const s = res.byRowIndex.get(0)!;
    expect(s.cost).toBeNull(); // NOT 0 -- "nobody costed this" is not "this costs nothing"
    expect(s.tendered).toBe(500);
    expect(s.margin).toEqual({ kind: "blank", reason: "no_cost" });
  });

  it("T5b ONE costed line among uncosted ones makes the section costed -- the rest contribute 0", () => {
    const l1 = node(1, { G: 100 }, { G: 100 });
    const l2 = node(2, { G: 100 }, { G: 100 });
    const parent = node(0, { G: 200 }, { G: null }, [l1, l2]);
    const roots = [parent];
    const res = rollBcsSections(roots, costs({ 2: 60 }), ["G"], grandOf(roots, ["G"]));
    const s = res.byRowIndex.get(0)!;
    expect(s.cost).toBe(60);
    expect(s.margin.kind === "value" && s.margin.value).toBeCloseTo(70, 6); // (200-60)/200
  });

  it("T5c a section costed at ZERO is costed -- 0 and absent are different facts", () => {
    const leaf = node(1, { G: 400 }, { G: 400 });
    const parent = node(0, { G: 400 }, { G: null }, [leaf]);
    const roots = [parent];
    const res = rollBcsSections(roots, costs({ 1: 0 }), ["G"], grandOf(roots, ["G"]));
    const s = res.byRowIndex.get(0)!;
    expect(s.cost).toBe(0); // NOT null
    expect(s.margin).toEqual({ kind: "value", value: 100 });
  });

  it("T5d a section with no AMOUNT anywhere has tendered null, not 0 -- a heading-only branch", () => {
    // ownAmounts null everywhere: nothing on this branch charges anything.
    const leaf = node(1, { G: 0 }, { G: null });
    const parent = node(0, { G: 0 }, { G: null }, [leaf]);
    const roots = [parent];
    const res = rollBcsSections(roots, costs({ 1: 25 }), ["G"], grandOf(roots, ["G"]));
    const s = res.byRowIndex.get(0)!;
    expect(s.tendered).toBeNull();
    expect(s.margin).toEqual({ kind: "blank", reason: "no_amount" });
  });

  it("T5e an amount genuinely PRESENT and zero is zero_amount, not no_amount", () => {
    const leaf = node(1, { G: 0 }, { G: 0 }); // present, and it is 0
    const parent = node(0, { G: 0 }, { G: null }, [leaf]);
    const roots = [parent];
    const res = rollBcsSections(roots, costs({ 1: 25 }), ["G"], grandOf(roots, ["G"]));
    const s = res.byRowIndex.get(0)!;
    expect(s.tendered).toBe(0);
    expect(s.margin).toEqual({ kind: "blank", reason: "zero_amount" });
  });

  // ── Structure ─────────────────────────────────────────────────────────────────
  it("T6 every node in the forest gets an entry, at every depth", () => {
    const deep = node(3, { G: 5 }, { G: 5 });
    const mid = node(2, { G: 5 }, { G: null }, [deep]);
    const top = node(1, { G: 5 }, { G: null }, [mid]);
    const roots = [top];
    const res = rollBcsSections(roots, costs({ 3: 2 }), ["G"], grandOf(roots, ["G"]));
    expect([...res.byRowIndex.keys()].sort((x, y) => x - y)).toEqual([1, 2, 3]);
    expect(res.byRowIndex.get(1)!.cost).toBe(2);
    expect(res.byRowIndex.get(2)!.cost).toBe(2);
    expect(res.byRowIndex.get(3)!.cost).toBe(2);
  });

  it("T6b the GRAND tendered comes from grandTotals and equals the sum of the roots", () => {
    const r1 = node(0, { G: 30 }, { G: 30 });
    const r2 = node(1, { G: 70 }, { G: 70 });
    const roots = [r1, r2];
    const grand = grandOf(roots, ["G"]);
    const res = rollBcsSections(roots, costs({ 0: 10, 1: 20 }), ["G"], grand);
    expect(grand["G"]).toBe(100);
    expect(res.grand.tendered).toBe(100);
    expect(res.grand.cost).toBe(30);
  });

  it("T7 an empty forest yields no rows and an all-absent grand -- never 0%", () => {
    const res = rollBcsSections([], costs({}), ["G"], {});
    expect(res.byRowIndex.size).toBe(0);
    expect(res.grand.cost).toBeNull();
    expect(res.grand.tendered).toBeNull();
    expect(res.grand.margin).toEqual({ kind: "blank", reason: "no_cost" });
  });

  it("T8 no confirmed amount columns at all -> tendered absent everywhere, margin blank", () => {
    const leaf = node(1, { G: 10 }, { G: 10 });
    const roots = [node(0, { G: 10 }, { G: null }, [leaf])];
    const res = rollBcsSections(roots, costs({ 1: 4 }), [], {});
    expect(res.byRowIndex.get(0)!.tendered).toBeNull();
    expect(res.byRowIndex.get(0)!.margin).toEqual({ kind: "blank", reason: "no_amount" });
  });

  it("T9 a cycle in the forest terminates and never double-counts a node's cost", () => {
    // Defensive: pricingRollup's own DFS path-guard makes this unreachable, but a rolled sum that
    // re-entered would hang the tab rather than misprice a row -- the worse of the two failures.
    const child: BcsRollupNodeLike = node(1, { G: 10 }, { G: 10 });
    const parent: BcsRollupNodeLike = node(0, { G: 10 }, { G: null }, [child]);
    child.children.push(parent); // cycle
    const res = rollBcsSections([parent], costs({ 0: 3, 1: 7 }), ["G"], { G: 10 });
    expect(res.byRowIndex.get(0)!.cost).toBe(10); // 3 + 7, each once
    expect(res.grand.cost).toBe(10);
  });

  it("T10 a non-finite cost is not a number -- it must not poison the section", () => {
    const leaf = node(1, { G: 100 }, { G: 100 });
    const roots = [node(0, { G: 100 }, { G: null }, [leaf])];
    const res = rollBcsSections(roots, () => Number.NaN, ["G"], grandOf(roots, ["G"]));
    const s = res.byRowIndex.get(0)!;
    expect(s.cost).toBeNull();
    expect(s.margin).toEqual({ kind: "blank", reason: "no_cost" });
  });
});
