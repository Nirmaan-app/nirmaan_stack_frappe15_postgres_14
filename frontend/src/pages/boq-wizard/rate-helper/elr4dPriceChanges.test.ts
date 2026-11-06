/**
 * ELR-4d -- the price changes the owner ruled, through the panel's entry point (`makePricingSheetHelper(...).compute`) and the
 * calculator's construction, on the live asset.
 *
 *   R-3C-CALC    (2026-10-29 "1 option ii") the shared floor over the effective values; the raised field "(computed)" + the note.
 *   hop_only / none_refusal  the two interpreter mechanisms, on local pipelines (the live configs: elr4dConduitDb.test.ts).
 *   R-TS15       (2026-10-30 "1 ... ok") the fresh calculator's refusal stops naming the stretch while "included" is blank.
 */
import { describe, expect, it } from "vitest";
import { calculatorCtx } from "@/pages/pricing/PricingCalculator";
import { calculatorHelper, runParity } from "@/pages/pricing/calculatorPanelParity.harness";
import {
  ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, ELECTRICAL_RULE_CASES, ELECTRICAL_RULE_ROWS, panelResult, parityCaseOf, type ElectricalRuleCase,
} from "@/pages/pricing/electricalRuleCases";
import { attributeRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import { noneRefusalOf, runPipeline } from "@/pages/pricing/rate-master/ratePipelineInterpreter";
import { CONDUCTOR_FLOOR_NOTE } from "./conductorFloor";
import { selfFitBinds } from "./pricingSheetHelper";
import { attrDisplayValue, attrNoteText, isShowingDerived, isSuggestion, type HelperResult } from "./rateHelperTypes";

const PW_ROW = "BOQ-26-00174|Electrical |251";
const WIRING_ROW = "BOQ-26-00183|Electrical Works|19";

const row = (key: string, cat: string, set: ElectricalRuleCase["set"] = {}): ElectricalRuleCase =>
  ({ id: "x", cat, line: "", kind: "pos", how: "stored", row: key, set, fig: null, re: [] });
const pw = (set: ElectricalRuleCase["set"] = {}) => row(PW_ROW, "point_wiring", set);
const attr = (r: HelperResult, id: string) => (isSuggestion(r) ? r.workings.attributes.find((a) => a.id === id) : undefined);
const notes = (r: HelperResult, id: string) => (attr(r, id)?.notes ?? []).map(attrNoteText);
const figures = (r: HelperResult) => (isSuggestion(r) ? [r.values.supply_rate, r.values.install_rate] : null);
const priced = (r: HelperResult) => isSuggestion(r) && Object.keys(r.values).length > 0;
const onPanel = (c: ElectricalRuleCase) => panelResult(c);

describe("R-3C-CALC: the floor on the panel and the calculator", () => {
  it("POSITIVE: 1 run of a 1-core wire typed -> 3 runs, marked (computed), with the note, at the floored figure (00174 r251: 990 -> 2,133)", () => {
    const r = onPanel(pw({ wire1_runs: 1 }));
    expect(figures(r)).toEqual([1775, 358]);
    const a = attr(r, "wire1_runs")!;
    expect(attrDisplayValue(a)).toBe("3");
    expect(isShowingDerived(a)).toBe(true);
    expect(notes(r, "wire1_runs")).toEqual([CONDUCTOR_FLOOR_NOTE]);
    expect(CONDUCTOR_FLOOR_NOTE).toBe("Raised to three conductors.");
  });

  it("calculator = panel on the same answers, whichever figure", () => {
    const sets: Array<Record<string, string | number>> = [{ wire1_runs: 1 }, { wire1_runs: 2 }, { wire1_runs: 4 }, { wire1_core: 2, wire1_runs: 1, wire2_thickness_sqmm: "None" }];
    for (const set of sets) {
      const run = runParity(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, parityCaseOf(pw(set)), "full");
      expect(run.divergences, JSON.stringify(set)).toEqual([]);
      expect(figures(run.calculator), JSON.stringify(set)).toEqual(figures(onPanel(pw(set))));
    }
  });

  it("POSITIVE: a 2-core wire takes a 1-core wire of the same size, each field (computed) with the note (1,827 -> 2,688)", () => {
    const r = onPanel(pw({ wire1_core: 2, wire1_runs: 1, wire2_thickness_sqmm: "None" }));
    expect(figures(r)).toEqual([1970, 718]);
    for (const [id, v] of [["wire2_thickness_sqmm", "1.5"], ["wire2_core", "1"], ["wire2_runs", "1"]]) {
      expect(attrDisplayValue(attr(r, id)!), id).toBe(v);
      expect(isShowingDerived(attr(r, id)!), id).toBe(true);
      expect(notes(r, id), id).toEqual([CONDUCTOR_FLOOR_NOTE]);
      expect(attr(r, id)!.disabled, id).toBeFalsy();
    }
  });

  it("NEGATIVE: a value stating three or more stands, plain, with no note", () => {
    for (const [runs, fig] of [[3, [1775, 358]], [4, [2396, 685]]] as const) {
      const r = onPanel(pw({ wire1_runs: runs }));
      expect(figures(r)).toEqual(fig);
      expect(attrDisplayValue(attr(r, "wire1_runs")!)).toBe(String(runs));
      expect(isShowingDerived(attr(r, "wire1_runs")!)).toBe(false);
      expect(notes(r, "wire1_runs")).toEqual([]);
    }
  });

  it("the stored row itself is unchanged: raised on the AI's read already, so nothing shows", () => {
    const r = onPanel(pw());
    expect(figures(r)).toEqual([1775, 358]);
    expect(notes(r, "wire1_runs")).toEqual([]);
    expect(attr(r, "wire1_runs")!.confidence).toBe(ELECTRICAL_RULE_ROWS[PW_ROW].cells.wire1_runs.confidence);
  });

  it("a raised field claims no reading: no confidence and no default mark", () => {
    const a = attr(onPanel(pw({ wire1_runs: 1 })), "wire1_runs")!;
    expect(a.confidence).toBeUndefined();
    expect(a.defaulted).toBeFalsy();
  });

  it("circuit wires, the second group, are raised the same way and independently", () => {
    const r = onPanel(pw({ circuit_wire_included: "Yes", circuit_wire1_thickness_sqmm: 6, circuit_wire1_core: 1, circuit_wire1_runs: 1, circuit_wire2_thickness_sqmm: "None" }));
    expect(attrDisplayValue(attr(r, "circuit_wire1_runs")!)).toBe("3");
    expect(notes(r, "circuit_wire1_runs")).toEqual([CONDUCTOR_FLOOR_NOTE]);
    expect(notes(r, "wire1_runs")).toEqual([]);
  });

  it("on a fresh calculator: the three wire answers alone show the raise, and the row still asks for the other needed fields", () => {
    const r = calculatorHelper(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS).compute(calculatorCtx("Electrical", "point_wiring"), { wire1_core: "1", wire1_thickness_sqmm: "1.5", wire1_runs: "1" });
    expect(attrDisplayValue(attr(r, "wire1_runs")!)).toBe("3");
    expect(notes(r, "wire1_runs")).toEqual([CONDUCTOR_FLOOR_NOTE]);
    expect(priced(r)).toBe(false);
  });

  it("NEGATIVE: a blank thickness is no wire: nothing raised, and its runs are still asked for", () => {
    const r = calculatorHelper(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS).compute(calculatorCtx("Electrical", "point_wiring"), { wire1_core: "1", wire1_runs: "1" });
    expect(attrDisplayValue(attr(r, "wire1_runs")!)).toBe("1");
    expect(notes(r, "wire1_runs")).toEqual([]);
  });

  it("NEGATIVE: wiring's own Runs field declares no floor: 1 run stays 1", () => {
    const r = onPanel(row(WIRING_ROW, "wiring_cabling", { runs: 1 }));
    expect(attrDisplayValue(attr(r, "runs")!)).toBe("1");
    expect(notes(r, "runs")).toEqual([]);
  });
});

describe("R-TS15: the fresh calculator's refusal wording", () => {
  const fresh = (cat: string, ov: Record<string, string> = {}) => calculatorHelper(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS).compute(calculatorCtx("Electrical", cat), ov);
  const sentence = (r: HelperResult) => (isSuggestion(r) ? r.workings.derivation[0] : "");

  it("POSITIVE: no stretch named while 'Circuit wiring included' is blank; that field is named, and the row still refuses", () => {
    const r = fresh("point_wiring");
    expect(sentence(r)).toContain("Circuit wiring included");
    expect(sentence(r)).not.toContain("Circuit wiring stretch");
    expect(priced(r)).toBe(false);
  });

  it("NEGATIVE: nothing else leaves the sentence (every other needed field of the fresh point wiring calculator)", () => {
    for (const label of ["Wire 1 - cores", "Wire 1 - runs", "Wire 1 - thickness (sqmm)", "Points covered", "Switch", "Socket", "Plate qty", "Colour", "Back box"]) {
      expect(sentence(fresh("point_wiring")), label).toContain(label);
    }
  });

  it("NEGATIVE: with 'included' answered the sentence does not bring the stretch back", () => {
    expect(sentence(fresh("point_wiring", { circuit_wire_included: "Yes" }))).not.toContain("Circuit wiring stretch");
    expect(sentence(fresh("point_wiring", { circuit_wire_included: "No" }))).not.toContain("Circuit wiring stretch");
  });

  it("NEGATIVE: another category's sentence keeps its fields (tray: its thickness has a hidden source, not a blank shown one)", () => {
    expect(sentence(fresh("cabletray_raceway"))).toContain("Thickness (mm)");
  });
});

describe("the two interpreter mechanisms, on local pipelines", () => {
  const CONDUITS = [20, 25, 50].map((size_mm) => ({ kind: "conduit", discipline: "Electrical", attributes: { conduit_type: "PVC", size_mm }, rates: { list: size_mm } })) as never[];
  const FIT = { step: "catalog_fit", params: { bind: "size_mm", fit_into: "size_mm", kind: "conduit", where: { conduit_type: "@conduit_type" }, label_attr: "size_mm", size_from: { attr: "size_mm" }, fit_from: { attr: "size_mm" }, direction: "up", on_miss: "no_compute", hop_only: true } };
  const REF = { step: "component_ref", name: "c", ref: { kind: "conduit", conduit_type: "@conduit_type", size_mm: "@size_mm" }, target: "list", rate_stages: [{ mult: 1 }], qty: { if_attr: { inc: "Yes" }, then: 1, else: 0 }, none_skips: true };
  const SUM = { step: "sum_components", result: "total" };
  const pipeline = { output: ["total"], steps: [FIT, REF, SUM] } as never;
  const total = (sel: Record<string, string | number>) => runPipeline("p", pipeline, CONDUITS, sel);

  it("hop_only: a size not stocked moves up, and publishes its outcome", () => {
    const r = total({ inc: "Yes", conduit_type: "PVC", size_mm: 40 });
    expect(r.finals).toEqual({ total: 50 });
    expect(r.steps.filter((s) => s.step === "catalog_fit").map((s) => s.catalogFit?.fitted)).toEqual(["50"]);
  });
  it("hop_only NEGATIVE: stocked, None and blank leave no trace; above the largest refuses", () => {
    for (const sel of [{ size_mm: 25 }, { size_mm: "None" }, {}, { conduit_type: "None", size_mm: 25 }] as Array<Record<string, string | number>>) {
      const r = total({ inc: "Yes", conduit_type: "PVC", ...sel });
      expect(r.steps.filter((s) => s.step === "catalog_fit"), JSON.stringify(sel)).toEqual([]);
    }
    expect(total({ inc: "Yes", conduit_type: "PVC", size_mm: 25 }).finals).toEqual({ total: 25 });
    expect(total({ inc: "Yes", conduit_type: "PVC", size_mm: 63 }).status).toBe("no_match");
  });
  it("hop_only is not a needed input; a plain self-fit stays one", () => {
    expect(selfFitBinds({ pipelines: { p: pipeline } } as never).size).toBe(0);
    const plain = { output: [], steps: [{ ...FIT, params: { ...FIT.params, hop_only: undefined } }] };
    expect([...selfFitBinds({ pipelines: { p: plain } } as never)]).toEqual(["size_mm"]);
  });

  const ALL_NONE = { step: "component_ref", name: "a", ref: { kind: "conduit", conduit_type: "@t" }, target: "list", rate_stages: [{ mult: 1 }], qty: { from_attr: "q" }, none_skips: true };
  const declared = { output: ["total"], steps: [ALL_NONE, { ...SUM, none_refusal: "Say this." }] } as never;
  it("none_refusal: every component positively absent refuses in the declared words", () => {
    const r = runPipeline("p", declared, CONDUITS, { t: "None" });
    expect(r.status).toBe("no_match");
    expect(noneRefusalOf(r)).toBe("Say this.");
  });
  it("none_refusal NEGATIVE: not declared -> Rs 0 as ever; a real component -> sums; another no_match has no sentence", () => {
    const undeclared = { output: ["total"], steps: [ALL_NONE, SUM] } as never;
    const r = runPipeline("p", undeclared, CONDUITS, { t: "None" });
    expect(r.finals).toEqual({ total: 0 });
    expect(noneRefusalOf(r)).toBeUndefined();
    expect(noneRefusalOf(runPipeline("p", declared, CONDUITS, { t: "PVC", q: 0 }))).toBeUndefined();
    const REAL = { step: "component_ref", name: "b", ref: { kind: "conduit", conduit_type: "PVC", size_mm: 25 }, target: "list", rate_stages: [{ mult: 1 }], qty: { from_attr: "q" }, none_skips: true };
    const partly = { output: ["total"], steps: [ALL_NONE, REAL, { ...SUM, none_refusal: "Say this." }] } as never;
    // one part named: priced, and a named part at quantity 0 is a 0, not the refusal
    expect(runPipeline("p", partly, CONDUITS, { t: "None", q: 2 }).finals).toEqual({ total: 50 });
    expect(runPipeline("p", partly, CONDUITS, { t: "None", q: 0 }).finals).toEqual({ total: 0 });
    expect(noneRefusalOf(runPipeline("p", partly, CONDUITS, { t: "None", q: 0 }))).toBeUndefined();
  });
});

describe("PW2's last sentence (owner P6 'Q4 a')", () => {
  it("says the floor, word for word; the old sentence is gone", () => {
    const line = attributeRuleOrder(ELECTRICAL_CONFIGS.get("point_wiring"), ELECTRICAL_ITEMS).find((l) => l.title === "Three conductors")!;
    expect(line.detail).toContain("A value you type on the panel or the calculator is raised the same way, shown '(computed)' with the note 'Raised to three conductors.'; a typed value stating three or more stands.");
    // WAS: "A value you type on the panel or the calculator is priced as typed."
    expect(line.detail).not.toContain("priced as typed");
  });
});

describe("the row table these tests stand on", () => {
  it("the stored rows are in the fixture", () => {
    for (const key of [PW_ROW, WIRING_ROW]) expect(ELECTRICAL_RULE_ROWS[key], key).toBeDefined();
    expect(ELECTRICAL_RULE_CASES.length).toBeGreaterThan(0);
  });
});
