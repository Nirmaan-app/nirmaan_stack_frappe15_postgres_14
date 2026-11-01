/**
 * ELR-4c -- the display rulings, through the panel's entry point (`makePricingSheetHelper(...).compute`) on the live v70 asset
 * and on the calculator's construction. Display only: every case asserts the price is the one it was.
 *
 *   (c)      owner R-ELR2 (c), 2026-10-29 "one line per input used"; P6 "Q1 b" (2026-10-30): a point wiring row shows one
 *            "<input name> = <value> <unit> (Pricing Input)" line per assembly input its pricing USED -- a 1-point formula row
 *            the first-point length only.
 *   R-FLOAT  owner 2026-10-30 "ok"; P6 "Q3 a": money to 2 decimals on screen; the price itself is not rounded.
 *   TS-15    P6 "Q5 a": the calculator no longer stars "Circuit wiring stretch" while "Circuit wiring included" is blank.
 *   Q4 a     the tray thickness "*" says "this, or a thickness the BoQ gives another way" -- no gauge named (R-SWG).
 *   (h)      P6 "Q2 a": a negative value on a ranged Pricing Input gets the range sentence on the page.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculatorCtx } from "@/pages/pricing/PricingCalculator";
import { calculatorHelper, runParity } from "@/pages/pricing/calculatorPanelParity.harness";
import {
  ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, ELECTRICAL_RULE_CASES, panelResult, parityCaseOf, type ElectricalRuleCase,
} from "@/pages/pricing/electricalRuleCases";
import { pricingInputRangeRefusal } from "@/pages/pricing/rate-master/pricingInputImpact";
import { USED_INPUT_MARK, moneyValue } from "./attributeWorkingLines";
import { eitherWordsFor, type ShownAttribute } from "./pricingSheetHelper";
import { isSuggestion, type HelperResult } from "./rateHelperTypes";

const CASE = (id: string): ElectricalRuleCase => ELECTRICAL_RULE_CASES.find((c) => c.id === id)!;
const withSet = (id: string, set: Record<string, string | number | null>): ElectricalRuleCase => ({ ...CASE(id), id: `${id}*`, set: { ...(CASE(id).set ?? {}), ...set } });
const bill = (r: HelperResult, block: number): string[] => (isSuggestion(r) ? r.workings.sections?.[block]?.matchedRows ?? [] : []);
const used = (r: HelperResult): string[] => [...new Set([0, 1].flatMap((i) => bill(r, i)).filter((l) => l.endsWith(` ${USED_INPUT_MARK}`)))];

const FIRST = "Point wiring - circuit length of the first point = 15 m (Pricing Input)";
const FURTHER = "Point wiring - circuit length per further point = 5 m (Pricing Input)";
const STRETCH = "Point wiring - circuit wiring stretch, DB to the first point = 30 m (Pricing Input)";
const FILL_PVC25 = "Conduit fill - PVC 25 mm = 0.55 fraction of the bore (Pricing Input)";

describe("(c) one working line per Pricing Input the row used (owner R-ELR2 (c); P6 Q1 b)", () => {
  it("AC0 / AC3: BOQ-26-00174 r251 (1 point, worked out) -- the first-point length and its fill, in both blocks; figures unchanged", () => {
    const r = panelResult(CASE("PW1+"));
    expect(isSuggestion(r) && r.values).toEqual({ supply_rate: 1775, install_rate: 358, combined_rate: 2133 });
    for (const block of [0, 1]) {
      expect(bill(r, block)).toContain(FIRST);
      expect(bill(r, block)).toContain(FILL_PVC25);
    }
    // Q1 b: on a 1-point formula row the further length is x 0 -- not shown
    expect(used(r)).toEqual([FIRST, FILL_PVC25]);
  });

  it("a 3-point formula row uses both lengths (15 + (3 - 1) x 5)", () => {
    expect(used(panelResult(CASE("PW3-")))).toEqual([FIRST, FURTHER, FILL_PVC25]);
  });

  it("a secondary-only row uses the further length only; a primary-only row the first only", () => {
    expect(used(panelResult(CASE("PW7s")))).toEqual([FURTHER, FILL_PVC25]);
    expect(used(panelResult(CASE("PW7p")))).toEqual([FIRST, FILL_PVC25]);
  });

  it("circuit wiring included and no stretch typed: the stretch line; included No: none", () => {
    expect(used(panelResult(CASE("PW10+")))).toEqual([FIRST, STRETCH, FILL_PVC25]);
    expect(used(panelResult(CASE("PW10-")))).not.toContain(STRETCH);
  });

  it("NEGATIVE: a stated length uses no length input; no conduit uses no fill; a refused row shows none", () => {
    expect(used(panelResult(CASE("PW7-")))).toEqual([FILL_PVC25]);
    expect(used(panelResult(CASE("PW8+")))).toEqual([FIRST]);
    expect(used(panelResult(CASE("PW11-")))).toEqual([]);
    expect(used(panelResult(withSet("PW7+", { circuit_wire_length_m: 12, circuit_wire_included: "Yes", circuit_wire1_thickness_sqmm: 1.5, circuit_wire1_core: 1, circuit_wire1_runs: 1 })))).not.toContain(STRETCH);
  });

  it("the fill is the one of the size the conduit was fitted to (MS 32 on a row that needs it)", () => {
    expect(used(panelResult(CASE("PW11+")))).toContain("Conduit fill - MS 32 mm = 0.45 fraction of the bore (Pricing Input)");
  });

  it("calculator = panel: the calculator shows the same used-input lines for the same answers", () => {
    for (const id of ["PW1+", "PW3-", "PW7s", "PW10+", "PW11+"]) {
      const run = runParity(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, parityCaseOf(CASE(id)), "full");
      expect([id, used(run.calculator)]).toEqual([id, used(run.panel)]);
    }
  });

  it("NEGATIVE: no other Electrical category gains a used-input line", () => {
    const others = ELECTRICAL_RULE_CASES.filter((c) => c.cat !== "point_wiring");
    expect(others.filter((c) => used(panelResult(c)).length > 0).map((c) => c.id)).toEqual([]);
  });
});

describe("R-FLOAT -- money to 2 decimals on screen; the price itself unrounded (P6 Q3 a)", () => {
  it("moneyValue", () => {
    expect(moneyValue(216.04999999999998)).toBe(216.05);
    expect(moneyValue(245.04999999999998)).toBe(245.05);
    expect(moneyValue(59.49999999999999)).toBe(59.5);
    expect(moneyValue(8409.999999999998)).toBe(8410);
    expect(moneyValue(4690.75)).toBe(4690.75);
    expect(moneyValue(5930)).toBe(5930);
    // NEGATIVE: what is not a finite number passes through, so its line reads as before
    expect(moneyValue(undefined as unknown as number)).toBeUndefined();
    expect(Number.isNaN(moneyValue(NaN))).toBe(true);
  });

  it("earthing BOQ-26-00183 r88: the lines read 216.05 / 245.05, the price stays 216.04999999999998", () => {
    const r = panelResult(CASE("EA1+"));
    if (!isSuggestion(r)) throw new Error("expected a suggestion");
    expect(r.values.supply_rate).toBe(216.04999999999998);
    expect(r.values.combined_rate).toBe(245.04999999999998);
    expect(r.workings.derivation).toContain("Supply = 216.05");
    expect(r.workings.derivation).toContain("Combined = supply + install = 245.05");
    expect(r.workings.sections![0].derivation).toContain("Supply = 216.05");
    expect([...r.workings.derivation, ...r.workings.sections![0].derivation].join("\n")).not.toMatch(/\d\.\d{3,}/);
  });

  it("conduit: 59.49999999999999 reads 59.5; NEGATIVE: an exact figure's line is byte-identical", () => {
    const r = panelResult(CASE("CP1+"));
    expect(isSuggestion(r) && r.values.supply_rate).toBe(59.49999999999999);
    expect(isSuggestion(r) && r.workings.derivation).toContain("Supply = 59.5");
    const d = panelResult(CASE("DB1+"));
    expect(isSuggestion(d) && d.workings.derivation.slice(0, 2)).toEqual(["Supply = 5930", "Combined = supply + install = 7120"]);
  });
});

describe("TS-15 -- the calculator does not star the stretch while 'Circuit wiring included' is blank (P6 Q5 a)", () => {
  const calc = () => calculatorHelper(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS).compute(calculatorCtx("Electrical", "point_wiring"), {});
  const attr = (r: HelperResult, id: string) => (isSuggestion(r) ? r.workings.attributes.find((a) => a.id === id) : undefined);
  it("fresh calculator: 'Circuit wiring included' starred, 'Circuit wiring stretch (m)' not", () => {
    const r = calc();
    expect(attr(r, "circuit_wire_included")?.required).toBe(true);
    expect(attr(r, "circuit_wire_length_m")?.required).toBeUndefined();
  });
  // ELR-4d (owner R-TS15, "1 ... ok") INVERTED: WAS the sentence names both, matched /^Fill to price: .*Circuit wiring included.*Circuit wiring stretch \(m\)/
  it("NEGATIVE: the gate is unchanged -- the fresh calculator still refuses, naming 'included' and no longer the stretch", () => {
    const r = calc();
    expect(isSuggestion(r) && r.workings.derivation[0]).toMatch(/^Fill to price: .*Circuit wiring included/);
    expect(isSuggestion(r) && r.workings.derivation[0]).not.toContain("Circuit wiring stretch");
    expect(isSuggestion(r) && Object.keys(r.values)).toEqual([]);
  });
  it("NEGATIVE: a blank source the panel does NOT show keeps the target's star (tray thickness with no gauge)", () => {
    const r = panelResult(withSet("CT1+", { thickness_mm: null, thickness_swg: null }));
    expect(isSuggestion(r) && r.workings.attributes.find((a) => a.id === "thickness_mm")?.required).toBe(true);
  });
});

describe("Q4 a -- the tray thickness '*' says it can be given another way, never naming the gauge (R-SWG)", () => {
  it("eitherWordsFor", () => {
    expect(eitherWordsFor("Thickness (mm)")).toBe("this, or a thickness the BoQ gives another way");
  });
  it("a tray row: only 'Thickness (mm)' carries the words, and no gauge is named anywhere on the fields", () => {
    const r = panelResult(CASE("CT1+"));
    if (!isSuggestion(r)) throw new Error("expected a suggestion");
    const withWords = (r.workings.attributes as ShownAttribute[]).filter((a) => a.eitherWords);
    expect(withWords.map((a) => [a.id, a.eitherWords])).toEqual([["thickness_mm", "this, or a thickness the BoQ gives another way"]]);
    expect(JSON.stringify(r.workings.attributes.map((a) => [a.label, (a as ShownAttribute).eitherWords ?? ""]))).not.toMatch(/SWG|gauge/i);
  });
  it("NEGATIVE: a field with no hidden way to fill it carries no words (every other Electrical case)", () => {
    const words = ELECTRICAL_RULE_CASES.flatMap((c) => {
      const r = panelResult(c);
      return isSuggestion(r) ? (r.workings.attributes as ShownAttribute[]).filter((a) => a.eitherWords).map((a) => `${c.cat}.${a.id}`) : [];
    });
    expect([...new Set(words)]).toEqual(["cabletray_raceway.thickness_mm"]);
  });
});

describe("(h) -- the range is checked first on the page too (P6 Q2 a)", () => {
  it("a negative fill or length gets the range sentence, the server's own words", () => {
    expect(pricingInputRangeRefusal("fill", "Conduit fill - PVC 25 mm", "factor", -0.1))
      .toBe("Conduit fill - PVC 25 mm (factor): a conduit fill must be more than 0 and at most 1 (got -0.1).");
    expect(pricingInputRangeRefusal("length", "Point wiring - circuit length of the first point", "factor", -5))
      .toBe("Point wiring - circuit length of the first point (factor): a length must be more than 0 (got -5).");
  });
  it("NEGATIVE: an input with no range still gets nothing here (the server's 'cannot be negative' stands)", () => {
    expect(pricingInputRangeRefusal(undefined, "Cable tray discount", "discount", -0.2)).toBeNull();
  });
  it("(source) out of range, the impact panel lists no worked example and says the range sentence once", () => {
    const src = readFileSync(new URL("../../pricing/rate-master/PricingInputImpactPanel.tsx", import.meta.url), "utf-8");
    expect(src).toContain("const shownExamples = rangeRefusal ? [] : examples;");
    expect(src).toContain("{shownExamples.length ? <ExampleList examples={shownExamples} changed={impact.changed} /> : null}");
    expect(src).toContain("assemblyOnlySentence((reach?.readByCategories ?? []).map(categoryLabel), shownExamples.length > 0)");
    // NEGATIVE: the unfiltered list no longer reaches the screen, and the range sentence renders in ONE place
    expect(src).not.toContain("<ExampleList examples={examples}");
    expect(src.match(/data-testid="impact-range-refusal"/g) ?? []).toHaveLength(1);
  });
});
