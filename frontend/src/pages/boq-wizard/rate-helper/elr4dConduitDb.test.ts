/**
 * ELR-4d -- the two changes that live in Electrical v71's pipeline steps, through the panel's entry point
 * (`makePricingSheetHelper(...).compute`) and the calculator's construction, on the live asset.
 *
 *   R-W6         (2026-10-29 "3 fix") wiring's conduit at the next stocked size, the way the Conduit category fits it.
 *   R-DB-MANUAL  (2026-07-31; ELR-4b Q3 a) a DB row with no part matched refuses instead of pricing at Rs 0.
 */
import { describe, expect, it } from "vitest";
import { calculatorCtx } from "@/pages/pricing/PricingCalculator";
import { calculatorHelper, runParity } from "@/pages/pricing/calculatorPanelParity.harness";
import {
  ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, figuresOf, panelResult, parityCaseOf, type ElectricalRuleCase,
} from "@/pages/pricing/electricalRuleCases";
import { attributeRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import { noneRefusalOf, runPipeline } from "@/pages/pricing/rate-master/ratePipelineInterpreter";
import { selfFitBinds, varyingAttrLine } from "./pricingSheetHelper";
import { attrDisplayValue, attrNoteText, isShowingDerived, isSuggestion, type HelperResult } from "./rateHelperTypes";

const WIRING_ROW = "BOQ-26-00183|Electrical Works|19";
const DB_NONE_ROW = "BOQ-26-00174|Electrical |104";
const DB_ROW = "BOQ-26-00183|Electrical Works|68";
const REFUSAL = "No part of this DB matched the catalogue - price it by hand.";

const row = (key: string, cat: string, set: ElectricalRuleCase["set"] = {}): ElectricalRuleCase =>
  ({ id: "x", cat, line: "", kind: "pos", how: "stored", row: key, set, fig: null, re: [] });
const wiring = (set: ElectricalRuleCase["set"] = {}) => row(WIRING_ROW, "wiring_cabling", { conduit_included: "Yes", conduit_type: "PVC", ...set });
const attr = (r: HelperResult, id: string) => (isSuggestion(r) ? r.workings.attributes.find((a) => a.id === id) : undefined);
const notes = (r: HelperResult, id: string) => (attr(r, id)?.notes ?? []).map(attrNoteText);
const figures = (r: HelperResult) => (isSuggestion(r) ? [r.values.supply_rate, r.values.install_rate] : null);
const priced = (r: HelperResult) => isSuggestion(r) && Object.keys(r.values).length > 0;
const onPanel = (c: ElectricalRuleCase) => panelResult(c);

describe("R-W6: wiring's conduit is fitted the way the Conduit category fits it", () => {
  it("POSITIVE: 40 is not stocked -> 50, marked (computed), with the Conduit category's note", () => {
    const r = onPanel(wiring({ size_mm: 40 }));
    expect(figures(r)).toEqual([calcFig50[0], calcFig50[1]]);
    const a = attr(r, "size_mm")!;
    expect(attrDisplayValue(a)).toBe("50");
    expect(isShowingDerived(a)).toBe(true);
    const conduitCat = onPanel(row("BOQ-26-00183|Electrical Works|98", "conduit_piping", { conduit_type: "PVC", size_mm: 40 }));
    expect(notes(r, "size_mm")).toEqual(notes(conduitCat, "size_mm"));
    expect(notes(r, "size_mm")).toEqual(["The row states 40 — using 50, the next size stocked."]);
  });

  it("the hop prices the size it lands on: 40 = a stated 50, on both conduit types", () => {
    for (const conduit_type of ["PVC", "MS"]) {
      expect(figures(onPanel(wiring({ conduit_type, size_mm: 40 }))), conduit_type).toEqual(figures(onPanel(wiring({ conduit_type, size_mm: 50 }))));
    }
  });

  it("calculator = panel on a hop", () => {
    const run = runParity(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS, parityCaseOf(wiring({ size_mm: 40 })), "full");
    expect(run.divergences).toEqual([]);
    expect(figures(run.calculator)).toEqual(figures(onPanel(wiring({ size_mm: 40 }))));
  });

  it("NEGATIVE: above the largest stocked size the row does not price, in the words it had", () => {
    const r = onPanel(wiring({ size_mm: 63 }));
    expect(priced(r)).toBe(false);
    expect(isSuggestion(r) && r.workings.derivation.join(" ")).toContain("No cable rate row matches");
  });

  it("NEGATIVE: a stocked size stays as it was: plain, no note of the fit, the same figures", () => {
    const r = onPanel(wiring({ size_mm: 25 }));
    expect(figures(r)).toEqual([162, 34]);
    expect(isShowingDerived(attr(r, "size_mm")!)).toBe(false);
    expect(notes(r, "size_mm").join(" ")).not.toContain("next size stocked");
    const steps = runPipeline("cable_boq", ELECTRICAL_CONFIGS.get("wiring_cabling")!.pipelines!.cable_boq as never, ELECTRICAL_ITEMS, { material: "COPPER", insulation: "UNARMOURED", core: 1, runs: 1, thickness_sqmm: 1.5, conduit_included: "Yes", conduit_type: "PVC", size_mm: 25 }).steps;
    expect(steps.filter((s) => s.step === "catalog_fit")).toEqual([]);
  });

  it("NEGATIVE: no conduit at all (None, or none stated) leaves no trace and prices the cable alone", () => {
    const base = figures(onPanel(row(WIRING_ROW, "wiring_cabling")));
    expect(base).toEqual([120, 24]);
    for (const set of [{ conduit_type: "None", size_mm: "None" }, { conduit_type: "None", size_mm: 25 }]) {
      expect(figures(onPanel(wiring(set))), JSON.stringify(set)).toEqual(base);
    }
  });

  it("a blank size is no needed input: the fit does not make it one, and no no-match sentence gains the conduit's facts", () => {
    const cfg = ELECTRICAL_CONFIGS.get("wiring_cabling")!;
    expect(selfFitBinds(cfg).has("size_mm")).toBe(false);
    expect(selfFitBinds(ELECTRICAL_CONFIGS.get("conduit_piping")!).has("size_mm")).toBe(true);
    const r = onPanel(row(WIRING_ROW, "wiring_cabling", { thickness_sqmm: 999 }));
    const sentence = isSuggestion(r) ? r.workings.derivation.join(" ") : "";
    expect(sentence).toContain("No cable rate row matches");
    expect(sentence).not.toContain("Conduit");
    expect(varyingAttrLine([{ id: "size_mm", label: "Conduit size (mm)", value: "25" } as never], ELECTRICAL_ITEMS, cfg.pipelines!.cable_boq as never)).toBe("");
  });
});

describe("R-DB-MANUAL: a DB row with no part matched refuses", () => {
  it("POSITIVE: 00174 r104, every part None, refuses in the approved words, once, with no figure", () => {
    const r = onPanel(row(DB_NONE_ROW, "db_switchgear"));
    expect(priced(r)).toBe(false);
    expect(isSuggestion(r) && r.basis).toBe(REFUSAL);
    expect(isSuggestion(r) && r.workings.derivation[0]).toBe(REFUSAL);
    const sections = isSuggestion(r) ? r.workings.sections ?? [] : [];
    expect(sections.flatMap((s) => s.derivation).filter((l) => l === REFUSAL)).toHaveLength(1);
    expect(sections.flatMap((s) => Object.keys(s.figures ?? {}))).toEqual([]);
  });

  it("NEGATIVE: a partly matched row prices as before (00183 r68: 5,930 / 1,190)", () => {
    expect(figures(onPanel(row(DB_ROW, "db_switchgear")))).toEqual([5930, 1190]);
  });

  it("NEGATIVE: a part named at quantity 0 is named, so the row is not refused for having no part", () => {
    const r = onPanel(row(DB_ROW, "db_switchgear", { db_shell_item: "None", mcb2_item: "None", mcb3_item: "None", mcb4_item: "None", mcb5_item: "None", enclosure_item: "None", mcb1_qty: 0 }));
    expect(isSuggestion(r) && r.basis).not.toBe(REFUSAL);
    expect(figuresOf(r)).toEqual([0, 0]);
  });

  it("NEGATIVE: a blank part still asks for the part, it does not take the refusal", () => {
    const r = onPanel(row(DB_NONE_ROW, "db_switchgear", { mcb3_item: null }));
    expect(isSuggestion(r) && r.workings.derivation[0]).toContain("Missing to price: MCB 3");
  });

  it("calculator = panel: every part None refuses on the calculator in the same words", () => {
    const ov = Object.fromEntries(["db_shell_item", "mcb1_item", "mcb2_item", "mcb3_item", "mcb4_item", "mcb5_item", "enclosure_item"].map((k) => [k, "None"]));
    const r = calculatorHelper(ELECTRICAL_CONFIGS, ELECTRICAL_ITEMS).compute(calculatorCtx("Electrical", "db_switchgear"), ov);
    expect(isSuggestion(r) && r.basis).toBe(REFUSAL);
    expect(priced(r)).toBe(false);
  });

  it("only a pipeline that declares the sentence refuses: the BCS pipeline and a declaration-less copy still sum to 0", () => {
    const cfg = ELECTRICAL_CONFIGS.get("db_switchgear")!;
    const none = Object.fromEntries(["db_shell_item", "mcb1_item", "mcb2_item", "mcb3_item", "mcb4_item", "mcb5_item", "enclosure_item"].map((k) => [k, "None"]));
    const pl = cfg.pipelines!;
    expect(noneRefusalOf(runPipeline("db_buildup_supply", pl.db_buildup_supply as never, ELECTRICAL_ITEMS, none))).toBe(REFUSAL);
    expect(noneRefusalOf(runPipeline("db_buildup_bcs", pl.db_buildup_bcs as never, ELECTRICAL_ITEMS, none))).toBeUndefined();
    const stripped = structuredClone(pl.db_buildup_supply) as unknown as { steps: Array<{ none_refusal?: string }> };
    for (const s of stripped.steps) delete s.none_refusal;
    const res = runPipeline("db_buildup_supply", stripped as never, ELECTRICAL_ITEMS, none);
    expect(res.status).toBe("ok");
    expect(noneRefusalOf(res)).toBeUndefined();
  });
});

describe("the Derivation lines follow the config (owner P6 'Q4 a')", () => {
  const detail = (cat: string, title: string | RegExp) => attributeRuleOrder(ELECTRICAL_CONFIGS.get(cat), ELECTRICAL_ITEMS).find((l) => (typeof title === "string" ? l.title === title : title.test(l.title)))!.detail ?? "";
  it("WC-f says the fit; WAS 'at the size the BoQ states (it is not moved ...) -- a size not stocked for that type does not price'", () => {
    const d = detail("wiring_cabling", /^The conduit is priced at its catalogue rate/);
    expect(d).toContain("at the stated size, else the next larger size stocked for that type, with a note on the field, as the Conduit category does; above the largest stocked size the row does not price");
    expect(d).not.toContain("at the size the BoQ states");
  });
  it("DB7 says the refusal; WAS 'A row where no part is matched at all prices at 0 today'", () => {
    const d = detail("db_switchgear", "Quantities and missing parts");
    expect(d).toContain(`A row where no part is matched at all does not price; it says: '${REFUSAL}'`);
    expect(d).not.toContain("prices at 0 today");
  });
});

// the figures of a stated 50 mm PVC conduit on WIRING_ROW's cable, read once from the case the fit must equal
const calcFig50 = figures(panelResult(row(WIRING_ROW, "wiring_cabling", { conduit_included: "Yes", conduit_type: "PVC", size_mm: 50 }))) as number[];
