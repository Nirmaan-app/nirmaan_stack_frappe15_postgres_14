/**
 * DEV2-B4 S1: THE PRICE-DRIVING RULE in `measureDrivingFields` (owner 2026-11-03 01:56 "this rule needs to be updated
 * for sure"; 10:59 "ok" to "count a reading as price-driving if it changes the price in at least 10% of the rows
 * tested, with at least 5 such rows" = DEV2-B3 F2b rule (iii)), measured on EVERY stored row (no 400-row sample).
 *
 * Fixtures only: the pricer is replaced by a scripted one (vi.mock of ./pricingSheetHelper) whose result for a row
 * depends only on which fields are blank, per a per-row effect table -- so each count is exact:
 *   both sides of 10 %   5 of 50 changed (10 %) -> kept  /  9 of 100 (9 %) -> not kept
 *   both sides of 5 rows 5 of 20 withheld (25 %) -> kept  /  4 of 20 (20 %, but 4 rows) -> not kept
 *   changed values count 6 withheld + 4 priced at other values = 10 of 100 -> kept (the 50 % rule counted only 6)
 *   the pair path        a pair withholding together on 5 of 30 rows -> "either-or"  /  on 3 of 30 -> not kept
 *   no sample            every priced row of a category is tested (sampled = pricedRows), whatever the count
 */
import { describe, expect, it, vi } from "vitest";
import { DRIVING_MIN_ROWS, DRIVING_MIN_SHARE, measureDrivingFields, meetsDrivingRule } from "./serverPricingStep";

type Effect = "withhold" | "change";
// effects[excelRow][field] = what blanking that field ALONE does on that row; PAIRS[excelRow] = fields that withhold
// only when blanked TOGETHER.
const EFFECTS = new Map<number, Partial<Record<string, Effect>>>();
const PAIRS = new Map<number, string[][]>();

vi.mock("./pricingSheetHelper", () => ({
  nonBcsPipelines: () => [],
  makePricingSheetHelper: ({ extractionByRow }: { extractionByRow: Map<number, { attributes: Record<string, { value: unknown }> }> }) => ({
    compute: (ctx: { excelRow: number }) => {
      const ext = extractionByRow.get(ctx.excelRow)!;
      const blank = Object.entries(ext.attributes).filter(([, c]) => c.value === null).map(([id]) => id);
      const eff = EFFECTS.get(ctx.excelRow) ?? {};
      if (blank.some((id) => eff[id] === "withhold")) return { kind: "none", values: null };
      for (const pair of PAIRS.get(ctx.excelRow) ?? []) {
        if (pair.every((id) => blank.includes(id))) return { kind: "none", values: null };
      }
      const changed = blank.filter((id) => eff[id] === "change").length;
      return { kind: "suggestion", values: { supply_rate: 100 + changed } };
    },
  }),
}));

let NEXT_ROW = 1;
/** `n` rows of category `cat`, every one reading every field in `fields`; `effect(i)` sets row i's effects. */
function rows(cat: string, n: number, fields: string[], effect: (i: number) => Partial<Record<string, Effect>>, pairs?: (i: number) => string[][]) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const er = NEXT_ROW++;
    EFFECTS.set(er, effect(i));
    if (pairs) PAIRS.set(er, pairs(i));
    out.push({ boq: "B", sheet_name: "S", excel_row: er, resolved_category: cat, description: "row",
      attributes: Object.fromEntries(fields.map((f) => [f, { value: 1 }])) });
  }
  return out;
}

function measure(rs: ReturnType<typeof rows>) {
  return measureDrivingFields({ configs: {}, itemsByDiscipline: {}, rows: rs }).categories;
}
const cls = (cat: { fields: Array<{ id: string; cls: string }> }, id: string) => cat.fields.find((f) => f.id === id)?.cls;

describe("DEV2-B4 rule (iii): changed price >= 10 % of tested rows AND >= 5 rows, on every stored row", () => {
  it("the constants are the owner's: 10 % and 5 rows", () => {
    expect(DRIVING_MIN_SHARE).toBe(0.10);
    expect(DRIVING_MIN_ROWS).toBe(5);
  });

  it("meetsDrivingRule: both sides of 10 % and of 5 rows", () => {
    expect(meetsDrivingRule(5, 50)).toBe(true);      // 10 %, 5 rows
    expect(meetsDrivingRule(9, 100)).toBe(false);    // 9 %
    expect(meetsDrivingRule(10, 100)).toBe(true);    // 10 %
    expect(meetsDrivingRule(4, 20)).toBe(false);     // 20 % but 4 rows
    expect(meetsDrivingRule(5, 20)).toBe(true);
    expect(meetsDrivingRule(0, 0)).toBe(false);
  });

  it("10 %: 5 of 50 rows changed is kept; 9 of 100 is not", () => {
    const a = measure(rows("cat_a", 50, ["x5", "x0"], (i) => (i < 5 ? { x5: "change" } : {})));
    expect(cls(a.cat_a, "x5")).toBe("needed");
    expect(a.cat_a.driving).toEqual(["x5"]);
    const b = measure(rows("cat_b", 100, ["y9"], (i) => (i < 9 ? { y9: "change" } : {})));
    expect(cls(b.cat_b, "y9")).toBe("not needed");
    expect(b.cat_b.driving).toEqual([]);
  });

  it("5 rows: 5 of 20 withheld is kept; 4 of 20 (20 %) is not", () => {
    const c = measure(rows("cat_c", 20, ["z4", "z5"], (i) => ({ ...(i < 4 ? { z4: "withhold" as Effect } : {}), ...(i < 5 ? { z5: "withhold" as Effect } : {}) })));
    expect(cls(c.cat_c, "z5")).toBe("needed");
    expect(cls(c.cat_c, "z4")).toBe("not needed");
  });

  it("changed values are counted with withheld: 6 + 4 of 100 is kept (6 alone would not be)", () => {
    const m = measure(rows("cat_m", 100, ["mix", "only6"], (i) => ({
      ...(i < 6 ? { mix: "withhold" as Effect, only6: "withhold" as Effect } : i < 10 ? { mix: "change" as Effect } : {}),
    })));
    const mix = m.cat_m.fields.find((f) => f.id === "mix")!;
    expect([mix.withhold, mix.changes, mix.withValue]).toEqual([6, 4, 100]);
    expect(mix.cls).toBe("needed");
    expect(cls(m.cat_m, "only6")).toBe("not needed");
  });

  it("the pair path: a pair withholding together on 5 of 30 rows is either-or; on 3 of 30 it is not", () => {
    const d = measure(rows("cat_d", 30, ["p", "q", "r", "s"], () => ({}), (i) => [
      ...(i < 3 ? [["p", "q"]] : []), ...(i < 5 ? [["r", "s"]] : [])]));
    expect(cls(d.cat_d, "r")).toBe("either-or");
    expect(cls(d.cat_d, "s")).toBe("either-or");
    expect(cls(d.cat_d, "p")).toBe("not needed");
    expect(d.cat_d.driving).toEqual(["r", "s"]);
  });

  it("no sample: every priced row is tested, however many (a 450-row category: sampled 450)", () => {
    const e = measure(rows("cat_e", 450, ["w"], (i) => (i < 45 ? { w: "change" } : {})));
    expect(e.cat_e.pricedRows).toBe(450);
    expect(e.cat_e.sampled).toBe(450);
    expect(e.cat_e.fields[0].withValue).toBe(450);
    expect(cls(e.cat_e, "w")).toBe("needed");     // 45 of 450 = 10 %: kept only because every row was tested
  });
});
