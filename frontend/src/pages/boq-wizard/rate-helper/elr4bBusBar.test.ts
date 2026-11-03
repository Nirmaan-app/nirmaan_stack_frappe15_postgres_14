// ELR-4b AC4 (owner R-ELR2 (g), 2026-10-29 "4 to 9 ok"; the P6 answer): the earthing working line says "Bus bar: not
// included" when Without, "Bus bar = <rate>" when With -- on the BoQ panel and the calculator -- display only, no figure
// moves; the rows whose Type reads "Bus bar" (Material CU / GI) still refuse (R-EARTH: handled by hand).
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig } from "@/pages/pricing/rate-master/rateMasterTypes";
import { attributeWorkingLine } from "./attributeWorkingLines";
import { isSuggestion, type HelperResult } from "./rateHelperTypes";
import { ITEMS, LIVE, boqResult, calcResult } from "./elr4aBlankPlate.harness";

const earthing = LIVE.get("earthing")!;
const working = (r: HelperResult): string[] => (isSuggestion(r) ? (r.workings.sections ?? []).flatMap((s) => s.matchedRows ?? []) : []);
const values = (r: HelperResult) => (isSuggestion(r) ? r.values : null);
// BOQ-26-00183 "Electrical Works" r88 (Without, 216.05 / 29) and BOQ-26-00174 "Electrical " r470 (With, 4,690.75 / 79.75)
const WITHOUT = { material: "CU", type: "8 SWG Wire", with_busbar: "Without" };
const WITH = { material: "GI", type: "50 x 6 MM Earth Strip", with_busbar: "With" };

describe("ELR-4b (g): the Bus bar line, both ways, panel and calculator", () => {
  it("NOW Without: 'Bus bar: not included'; NEGATIVE half kept: 'Bus bar = 0' is gone (WAS: 'Bus bar = 0')", () => {
    for (const r of [boqResult(LIVE, "earthing", WITHOUT), calcResult(LIVE, "earthing", WITHOUT)]) {
      expect(working(r)).toContain("Bus bar: not included");
      expect(working(r)).not.toContain("Bus bar = 0");
      expect(values(r)).toEqual({ supply_rate: 216.04999999999998, install_rate: 29, combined_rate: 245.04999999999998 });
    }
  });

  it("With: unchanged, 'Bus bar = <the Bus bar item's rate>'", () => {
    for (const r of [boqResult(LIVE, "earthing", WITH), calcResult(LIVE, "earthing", WITH)]) {
      expect(working(r)).toContain("Bus bar = 3,000");
      expect(working(r).join("\n")).not.toContain("not included");
      expect(values(r)).toEqual({ supply_rate: 4690.75, install_rate: 79.75, combined_rate: 4770.5 });
    }
  });

  it("the words follow the PRICED condition (the step's params), never a second reading: a factor-0 With prints 'not included'", () => {
    const c = structuredClone(earthing) as RateCategoryConfig;
    for (const pl of Object.values(c.pipelines ?? {})) for (const s of (pl.steps ?? []) as Array<{ conditions?: Array<{ when: Record<string, unknown>; params: Record<string, number> }> }>) {
      for (const cond of s.conditions ?? []) if (cond.when.with_busbar === "With") cond.params.factor = 0;
    }
    const r = boqResult(new Map([...LIVE, ["earthing", c]]), "earthing", WITH);
    expect(working(r)).toContain("Bus bar: not included");
  });

  it("the line builder itself: factor 0 -> 'not included'; factor 1, or no condition, -> the amount", () => {
    const pl = { steps: [{ step: "component_ref", name: "busbar", ref: { kind: "earthing_item", attributes: { type: "Bus bar" } }, formula: "base*factor" }] };
    const st = (params?: Record<string, number>, value = 0) => ({ step: "component_ref", label: "x", runningValues: {}, refItem: "Bus bar", ...(params ? { params } : {}), produced: { key: "busbar", value } });
    expect(attributeWorkingLine(st({ factor: 0 }), pl as never, earthing, ITEMS, () => undefined)).toBe("Bus bar: not included");
    expect(attributeWorkingLine(st({ factor: 1 }, 3000), pl as never, earthing, ITEMS, () => undefined)).toBe("Bus bar = 3,000");
    expect(attributeWorkingLine(st(undefined, 0), pl as never, earthing, ITEMS, () => undefined)).toBe("Bus bar = 0");
    // a component with a quantity is never this shape (its label and quantity are written, as before)
    expect(attributeWorkingLine({ ...st({ factor: 0 }), qty: 1 }, { steps: [{ ...pl.steps[0], qty: 1 }] } as never, earthing, ITEMS, () => undefined)).not.toContain("not included");
  });

  it("UNCHANGED: a 'Bus bar'-type row at Material CU still refuses (manual by ruling, R-EARTH)", () => {
    const r = boqResult(LIVE, "earthing", { material: "CU", type: "Bus bar", with_busbar: "With" });
    expect(values(r) ?? {}).toEqual({});
    expect(working(r).join("\n")).not.toContain("Bus bar:");
  });
});
