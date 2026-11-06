/**
 * ELR-5 (owner "Q1 a, Q2 c, Q3 b, Q4 a", 2026-10-31; R-SS0) -- Electrical v72, the live asset, through the panel's entry point and
 * the calculator's construction: EXACTLY the 12 declared Switches & Sockets rows refuse in the approved words instead of
 * pricing at Rs 0. The rows are real (`__fixtures__/elr5ZeroRows.json`, verbatim from the 2026-10-31 replay dump).
 * A row that names a part, or keeps its back box, keeps its figure.
 */
import { describe, expect, it } from "vitest";
import { readJsonFixture, runParity } from "@/pages/pricing/calculatorPanelParity.harness";
import { calculatorCtx } from "@/pages/pricing/PricingCalculator";
import { ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, figuresOf, panelResult, type ElectricalRuleCase, type StoredRow } from "@/pages/pricing/electricalRuleCases";
import { makePricingSheetHelper } from "./pricingSheetHelper";
import { isSuggestion, type HelperResult } from "./rateHelperTypes";

const REFUSAL = "No part of this row matched the catalogue - price it by hand.";
const ROWS = readJsonFixture<Record<string, StoredRow>>(new URL("../../pricing/__fixtures__/elr5ZeroRows.json", import.meta.url));
const ROW_NO = 1;

const panelOf = (r: StoredRow): HelperResult => makePricingSheetHelper({
  configsByCategory: ELECTRICAL_CONFIGS, items: ELECTRICAL_ITEMS,
  extractionByRow: new Map([[ROW_NO, { excelRow: ROW_NO, description: r.desc, attributes: r.cells }]]),
}).compute({ excelRow: ROW_NO, description: r.desc, nodeType: "Line Item", category: r.cat, discipline: "Electrical", rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: r.headings, ownNotes: [], headingNotes: [], unit: r.unit } as never);

const typed = (r: StoredRow): Record<string, string> => Object.fromEntries(
  Object.entries(r.cells).filter(([, c]) => c?.value !== null && c?.value !== undefined && c?.value !== "").map(([k, c]) => [k, String(c!.value)]));
const calculatorOf = (r: StoredRow): HelperResult => makePricingSheetHelper({ configsByCategory: ELECTRICAL_CONFIGS, items: ELECTRICAL_ITEMS, extractionByRow: new Map() })
  .compute(calculatorCtx("Electrical", r.cat), typed(r));

const stored = (row: string, set: ElectricalRuleCase["set"] = {}): ElectricalRuleCase =>
  ({ id: "x", cat: "switches_sockets", line: "", kind: "pos", how: "stored", row, set, fig: null, re: [] });

describe("the declared set", () => {
  it("is the 12 rows the owner approved, none other in the fixture", () => {
    expect(Object.keys(ROWS).sort()).toEqual([
      "BOQ-26-00102|Electrical|112",
      "BOQ-26-00298|ELECTRICAL BOQ |603", "BOQ-26-00298|ELECTRICAL BOQ |605", "BOQ-26-00298|ELECTRICAL BOQ |607", "BOQ-26-00298|ELECTRICAL BOQ |609", "BOQ-26-00298|ELECTRICAL BOQ |611",
      "BOQ-26-00305|Cost Sheet|75",
      "BOQ-26-00306|EXTERNAL ELECTRICAL WORKS|414", "BOQ-26-00306|EXTERNAL ELECTRICAL WORKS|415", "BOQ-26-00306|EXTERNAL ELECTRICAL WORKS|416",
      "BOQ-26-00328|BOQ|177",
      "BOQ-26-00364|Internal Electrical Works|212",
    ]);
  });

  for (const [key, r] of Object.entries(ROWS)) {
    it(`POSITIVE ${key}: refuses on the panel in the approved words, once, with no figure`, () => {
      const res = panelOf(r);
      expect(figuresOf(res)).toBeNull();
      expect(isSuggestion(res) && res.basis).toBe(REFUSAL);
      expect(isSuggestion(res) && res.workings.derivation[0]).toBe(REFUSAL);
      const sections = isSuggestion(res) ? res.workings.sections ?? [] : [];
      expect(sections.flatMap((s) => s.derivation).filter((l) => l === REFUSAL)).toHaveLength(1);
      expect(sections.flatMap((s) => Object.keys(s.figures ?? {}))).toEqual([]);
    });

    it(`${key}: the calculator with the same answers refuses in the same words`, () => {
      const res = calculatorOf(r);
      expect(figuresOf(res)).toBeNull();
      expect(isSuggestion(res) && res.basis).toBe(REFUSAL);
    });
  }

  it("panel = calculator on the harness's own compare, on every declared row", () => {
    for (const [key, r] of Object.entries(ROWS)) {
      const attrs = Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, c?.value ?? null]));
      const run = runParity(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, { cat: r.cat, unit: r.unit, desc: r.desc, attrs, headings: r.headings }, "full");
      expect(run.divergences, key).toEqual([]);
      expect(figuresOf(run.calculator), key).toBeNull();
    }
  });
});

describe("what does not move", () => {
  const ORDINARY = "BOQ-26-00183|Electrical Works|12";
  const BARE_BOX = "BOQ-26-00174|Electrical |240";

  it("NEGATIVE: the ordinary row, 00183 r12, keeps 170 / 40", () => {
    expect(figuresOf(panelResult(stored(ORDINARY)))).toEqual([170, 40]);
  });

  it("NEGATIVE: a bare-box row, every part None and Back box Yes, keeps 70 / 20", () => {
    expect(figuresOf(panelResult(stored(BARE_BOX)))).toEqual([70, 20]);
  });

  it("NEGATIVE: the box switched on makes a declared row a bare-box row again, not a refusal", () => {
    const r = ROWS["BOQ-26-00298|ELECTRICAL BOQ |603"];
    const res = panelOf({ ...r, cells: { ...r.cells, back_box: { value: "Yes", confidence: 0.9 } } });
    expect(figuresOf(res)).toEqual([70, 20]);
    expect(isSuggestion(res) && res.basis).not.toBe(REFUSAL);
  });

  it("NEGATIVE: a blank plate with no quantity still asks for 'Plate qty' (R-V1), it does not take the refusal", () => {
    const res = panelResult(stored(ORDINARY, { switch_item: "None", plate_item: null, plate_qty: null }));
    expect(isSuggestion(res) && res.workings.derivation[0]).toContain("Plate qty");
    expect(isSuggestion(res) && res.basis).not.toBe(REFUSAL);
  });

  it("NEGATIVE: the 'assumed 3M' note stays on a refused row (owner: logged, not fixed)", () => {
    const res = panelOf(ROWS["BOQ-26-00298|ELECTRICAL BOQ |603"]);
    const box = isSuggestion(res) ? res.workings.attributes.find((a) => a.id === "box_item") : undefined;
    expect(box?.derivedValue).toBe("3M");
  });

  it("only swsock_boq declares the sentence; swsock_bcs does not (owner: deferred to the BCS build)", () => {
    const pl = ELECTRICAL_CONFIGS.get("switches_sockets")!.pipelines as unknown as Record<string, { steps: Array<{ step?: string; none_refusal?: string }> }>;
    const sum = (id: string) => pl[id].steps.find((s) => s.step === "sum_components")!;
    expect(sum("swsock_boq").none_refusal).toBe(REFUSAL);
    expect(sum("swsock_bcs").none_refusal).toBeUndefined();
  });

  it("no other category gained a sentence: the DB's two pipelines keep their own, and nothing else declares one", () => {
    const declared: string[] = [];
    for (const [cat, cfg] of ELECTRICAL_CONFIGS) {
      for (const [pid, pl] of Object.entries(cfg.pipelines as unknown as Record<string, { steps: Array<{ step?: string; none_refusal?: string }> }>)) {
        if (pl.steps.some((s) => s.step === "sum_components" && s.none_refusal)) declared.push(`${cat}/${pid}`);
      }
    }
    expect(declared.sort()).toEqual(["db_switchgear/db_buildup_install", "db_switchgear/db_buildup_supply", "switches_sockets/swsock_boq"]);
  });
});
