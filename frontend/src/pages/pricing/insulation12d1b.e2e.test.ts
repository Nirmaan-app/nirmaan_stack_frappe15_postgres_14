/**
 * SLICE 12d-1b -- E2E-1, OFFLINE, THROUGH THE REAL PANEL PATH (the 12d-1a harness), BOTH PATHS.
 *
 * Thirteen REAL Insulation payloads, built by the product's own payload builder (`_ai_item`) on 2026-10-07 from the
 * live corpus, each with a HAND-WRITTEN model answer in the exact response shape -- no AI call. Every figure,
 * amber mark and refusal was STATED IN ADVANCE from the v28 stored parts (the sheet rule). The PANEL path is
 * `makePricingSheetHelper` with the synthesized extraction; the CALCULATOR path is `PricingCalculator`'s
 * construction fed what the panel shows (`runParity`). A divergence between the two is a failure (owner P1).
 *
 * ⚠️ Where a case's answer is not what the payload literally says, the fixture's `answer_note` says so -- the
 * corpus has no per-metre row silent on thickness and no slash-list heading without a schedule (the 12d-1 recon,
 * re-measured today), so those cases are the model's answer on a real payload SHAPE, disclosed.
 *
 * ⚠️ A big fixture is READ at runtime, never `import`ed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import HVAC_V28 from "../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v28.json";
import type { RateCategoryConfig, RateMasterItem } from "./rate-master/rateMasterTypes";
import { isSuggestion } from "../boq-wizard/rate-helper/rateHelperTypes";
import { isEligibleConfig, type ItemListSuggestion } from "../boq-wizard/rate-helper/pricingSheetHelper";
import { runParity, type ParityCase, type ParityRun } from "./calculatorPanelParity.harness";

interface FixtureRow {
  id: string; boq: string; sheet: string; excel_row: number; unit: string | null; description: string; headings: string[];
  payload: { id: number; description: string; ancestor_chain: unknown[] };
  answer: { items: Array<{ attributes: Record<string, { value: string; confidence: number }> }> };
  answer_note: string;
}

const ROWS = JSON.parse(readFileSync(new URL("./__fixtures__/insulation12d1bRows.json", import.meta.url), "utf-8")) as FixtureRow[];
const ASSET = HVAC_V28 as unknown as { items: RateMasterItem[]; category_configs: RateCategoryConfig[] };
const CAT = "hvac_insulation";
const CFG = ASSET.category_configs.find((c) => c.category_id === CAT)!;
const CONFIGS = new Map([[CAT, CFG]]);
const NR = "Nitrile Rubber Insulation";
const TN = "Thermal Nitrile Insulation";
const FG = " Fiberglass Rigid Board Insulation, Density 48Kg/m3";
const PUF = "Tubular Puf Insulation";

const byId = new Map(ROWS.map((r) => [r.id, r]));
function caseOf(id: string): ParityCase {
  const r = byId.get(id);
  if (!r) throw new Error(`no fixture row ${id}`);
  return {
    cat: CAT, unit: r.unit ?? "", desc: r.description, attrs: {}, headings: r.headings,
    items: r.answer.items.map((it) => Object.fromEntries(Object.entries(it.attributes).map(([k, v]) => [k, v.value]))),
  };
}
const run = (id: string): ParityRun => runParity(CONFIGS, ASSET.items, caseOf(id), "full");
function view(r: ParityRun) {
  if (!isSuggestion(r.panel)) throw new Error(`panel declined: ${JSON.stringify(r.panel)}`);
  return (r.panel as ItemListSuggestion).itemList!;
}
const headline = (r: ParityRun) => ({ supply: view(r).totals?.supply_rate, install: view(r).totals?.install_rate });
const noDivergence = (r: ParityRun) => expect(r.divergences.map((d) => `${d.what}: ${d.panel} vs ${d.calculator}`)).toEqual([]);
const thickness = (r: ParityRun, i = 0) => view(r).items[i].fields.find((f) => f.id === "thickness_mm")!;

describe("E2E-1 -- the fixture is REAL; v28 is a FROZEN file that still carries the key 12d-2 retired", () => {
  it("every case carries a real payload; the asset under test is v28; its pricing block is eligible by the generic predicate (12d-2)", () => {
    expect(ROWS.length).toBe(13);
    for (const r of ROWS) {
      expect(r.payload.id).toBe(r.excel_row);
      expect(r.payload.description).toBe(r.description);
      expect((r.payload.ancestor_chain[0] as { relation: string }).relation).toBe("sheet");
    }
    // INVERTED by 12d-2 (owner S1): a historical asset is never edited, so the retired key stays in the
    // file; the suite prices through `isEligibleConfig` with no admission flag (the harness has none).
    expect((CFG as { calculator_only?: boolean }).calculator_only).toBe(true);
    expect(Object.keys(CFG.pipelines ?? {})).toEqual([]);
    expect(isEligibleConfig(CFG)).toBe(true);
  });
});

describe("E2E-1 (a) -- thickness not mentioned -> 9 mm then the ladder, amber, on every family", () => {
  it("Nitrile Rubber at 25 mm dia -> 28.58, 9 -> 13: 238 / 14", () => {
    const r = run("a_nr_no_thickness");
    const v = view(r);
    expect(v.items[0].family).toBe(NR);
    const t = thickness(r);
    expect(t.value).toBe("13");
    expect(t.defaulted).toBe(true);
    expect(t.rule).toMatch(/T1/);
    expect(headline(r)).toEqual({ supply: 238, install: 14 });
    noDivergence(r);
  });
  it("Thermal Nitrile 9: 383 / 154", () => {
    const r = run("a_tn_no_thickness");
    expect(view(r).items[0].family).toBe(TN);
    expect(thickness(r).value).toBe("9"); expect(thickness(r).defaulted).toBe(true);
    expect(headline(r)).toEqual({ supply: 383, install: 154 });
    noDivergence(r);
  });
  // ⚠️ STATED-FIGURE CORRECTION, recorded: before the run I stated 310 / 154, computed for cladding "No"; the
  // real row (BOQ-26-00174 r122) carries a 22G GI frame and the hand-written answer says so. The sheet rule
  // for Fiberglass 12 mm WITH the GI Framework gives 1126 / 385 (verified independently before this line changed).
  it("Fiberglass 9 -> 12 (GI Framework): 1126 / 385", () => {
    const r = run("a_fg_no_thickness");
    expect(view(r).items[0].family).toBe(FG);
    expect(thickness(r).value).toBe("12"); expect(thickness(r).defaulted).toBe(true);
    expect(headline(r)).toEqual({ supply: 1126, install: 385 });
    noDivergence(r);
  });
  // ⚠️ STATED-FIGURE CORRECTION, recorded: before the run I stated 210 / 14, computed for cladding "No"; the
  // heading says 26 G aluminium cladding and the hand-written answer says so. The sheet rule for PUF 50 mm at
  // pipe 50 WITH 26G gives 600 / 224 (verified independently before this line changed).
  it("Tubular PUF at 50 NB -> its pipe's stocked 50 (26G): 600 / 224", () => {
    const r = run("a_puf_no_thickness");
    expect(view(r).items[0].family).toBe(PUF);
    expect(thickness(r).value).toBe("50"); expect(thickness(r).defaulted).toBe(true);
    expect(headline(r)).toEqual({ supply: 600, install: 224 });
    noDivergence(r);
  });
});

describe("E2E-1 (b) (c) -- several thicknesses and the size schedule", () => {
  it("(b) '19/ 25 / 32 mm' copied as written on a Nitrile pipe at 32NB -> 32 -> composed 13 (No) + 19 (26G): 250/14 + 493/224 = 743 / 238", () => {
    const r = run("b_list_no_schedule");
    const v = view(r);
    expect(v.rowPriced).toBe(true);
    expect(v.items.length).toBe(1);                       // ONE block ...
    expect(v.items[0].working[0]).toMatch(/^You typed 32 mm -> priced as 13 \+ 19 mm/);   // ... priced as two layers
    expect(headline(r)).toEqual({ supply: 743, install: 238 });
    noDivergence(r);
  });
  it("(c) the BOQ-26-00017 schedule heading: 50NB -> the model reads 19 -> a single 19 mm layer with 26G: 615 / 224", () => {
    const r = run("c_schedule_50nb");
    const v = view(r);
    expect(v.items[0].fields.find((f) => f.id === "thickness_mm")!.value).toBe("19");
    expect(v.items[0].working.some((w) => /You typed|layers/.test(w))).toBe(false);
    expect(headline(r)).toEqual({ supply: 615, install: 224 });
    noDivergence(r);
  });
  it("(c) the same heading, an 80NB row -> the model reads 'Double layer of 19 mm' -> REFUSES: pipe size 80 is above the largest size on the sheet (53.98) (T7)", () => {
    const r = run("c_schedule_80nb");
    const v = view(r);
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toMatch(/pipe size 80 is above the largest size on the sheet \(53\.98\)/);
  });
});

describe("E2E-1 (d) -- double layers", () => {
  it("an explicit '13 + 13' on a real small-pipe row (25 mm dia -> 28.58): two 13 mm layers, cladding on the outer only (both No here): 238 + 238 = 476 / 28", () => {
    const r = run("d_13_plus_13");
    const v = view(r);
    expect(v.rowPriced).toBe(true);
    expect(v.items[0].working[0]).toBe("BoQ says 13 + 13 -> priced as two layers, 13 + 13 mm (26 mm); cladding on the outer layer only");
    expect(headline(r)).toEqual({ supply: 476, install: 28 });
    // ⚠️ AN INPUT-SURFACE DIFFERENCE BY RULING, counted and NAMED, never denied: the calculator is fed what the
    // panel shows, and a TYPED "13 + 13" must refuse (owner T6, "let it be for now") while the panel prices
    // the MODEL's layers (T4). The permanent parity corpus carries no layer row, so this is the one place the
    // two surfaces differ, and this is where it is recorded.
    expect(r.divergences.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.calculator)).toMatch(/several values stated for thickness/);
  });
  it("the BOQ-26-00020 rows 525-527 ('100 / 80 / 65 mm + 32 mm') -> two layers each, every one REFUSING for no pipe size", () => {
    for (const id of ["d_65_plus_32", "d_80_plus_32", "d_100_plus_32"]) {
      const r = run(id);
      const v = view(r);
      expect(v.rowPriced, id).toBe(false);
      expect(v.reason, id).toBe("item 1 (Nitrile Rubber Insulation): no pipe size stated");
    }
  });
});

describe("E2E-1 (e) (f) -- an unreadable thickness and the named 'none of these'", () => {
  it("(e) 'as specified in the tender specs.' as the thickness -> refuses with its reason, NOT 9", () => {
    const r = run("e_as_per_spec");
    const v = view(r);
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe("no number in 'as specified in the tender specs.' for thickness");
    expect(thickness(r).defaulted).toBe(false);
  });
  it("(f) 'none of these' with XLPE -> 'No SKU in the catalogue for XLPE - price this row by hand'", () => {
    const r = run("f_xlpe_named");
    const v = view(r);
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe("No SKU in the catalogue for XLPE - price this row by hand");
  });
});
