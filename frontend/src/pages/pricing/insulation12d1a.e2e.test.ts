/**
 * SLICE 12d-1a -- E2E-1, OFFLINE, THROUGH THE REAL PANEL PATH (the 12c-P harness), BOTH PATHS.
 *
 * Thirteen REAL Insulation payloads, built by the product's own payload builder (`_ai_item`) on
 * 2026-10-07 from the live corpus, each with a HAND-WRITTEN model answer in the exact response shape
 * -- no AI call anywhere. Every figure, amber mark and refusal below was STATED IN ADVANCE: the prices
 * were computed by hand from the v27 asset's stored parts (the sheet rule) before this file ran.
 *
 * The PANEL path is `makePricingSheetHelper` with the synthesized extraction (`panelHelper`, admitting
 * the `calculator_only` category exactly as 12c-P does); the CALCULATOR path is `PricingCalculator`'s
 * construction fed what the panel SHOWS (`runParity`). A divergence between the two is a failure, by
 * the standing owner ruling P1.
 *
 * ⚠️ A big fixture is READ at runtime, never `import`ed (the tsc rule in frontend/CLAUDE.md).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import HVAC_V27 from "../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v27.json";
import type { RateCategoryConfig, RateMasterItem } from "./rate-master/rateMasterTypes";
import { isSuggestion } from "../boq-wizard/rate-helper/rateHelperTypes";
import type { ItemListSuggestion } from "../boq-wizard/rate-helper/pricingSheetHelper";
import { runParity, type ParityCase, type ParityRun } from "./calculatorPanelParity.harness";
import { isEligibleConfig } from "../boq-wizard/rate-helper/pricingSheetHelper";

interface FixtureRow {
  id: string;
  boq: string;
  sheet: string;
  excel_row: number;
  unit: string | null;
  description: string;
  headings: string[];
  payload: { id: number; description: string; ancestor_chain: unknown[]; notes?: unknown };
  answer: { items: Array<{ attributes: Record<string, { value: string; confidence: number }> }> };
}

const ROWS = JSON.parse(
  readFileSync(new URL("./__fixtures__/insulation12d1aRows.json", import.meta.url), "utf-8"),
) as FixtureRow[];
const ASSET = HVAC_V27 as unknown as { items: RateMasterItem[]; category_configs: RateCategoryConfig[] };
const CAT = "hvac_insulation";
const CFG = ASSET.category_configs.find((c) => c.category_id === CAT)!;
const CONFIGS = new Map([[CAT, CFG]]);
const NR = "Nitrile Rubber Insulation";
const TN = "Thermal Nitrile Insulation";
const AN = "Acoustic Nitrile Insulation";
const FG = " Fiberglass Rigid Board Insulation, Density 48Kg/m3";

const byId = new Map(ROWS.map((r) => [r.id, r]));
function caseOf(id: string): ParityCase {
  const r = byId.get(id);
  if (!r) throw new Error(`no fixture row ${id}`);
  return {
    cat: CAT,
    unit: r.unit ?? "",
    desc: r.description,
    attrs: {},
    items: r.answer.items.map((it) => Object.fromEntries(Object.entries(it.attributes).map(([k, v]) => [k, v.value]))),
    headings: r.headings,
  };
}
function run(id: string): ParityRun {
  return runParity(CONFIGS, ASSET.items, caseOf(id), "full");
}
function view(run: ParityRun) {
  const p = run.panel;
  if (!isSuggestion(p)) throw new Error(`panel declined: ${JSON.stringify(p)}`);
  return (p as ItemListSuggestion).itemList!;
}
function headline(run: ParityRun): Record<string, number | undefined> {
  const v = view(run);
  return { supply: v.totals?.supply_rate, install: v.totals?.install_rate };
}
function noDivergence(run: ParityRun) {
  expect(run.divergences.map((d) => `${d.what}: ${d.panel} vs ${d.calculator}`)).toEqual([]);
}

describe("E2E-1 -- the fixture is REAL: payloads built by the product, answers in the response shape", () => {
  it("every case carries a real payload (id = the Excel row, the row's own description, the sheet as the outermost ancestor)", () => {
    expect(ROWS.length).toBe(13);
    for (const r of ROWS) {
      expect(r.payload.id).toBe(r.excel_row);
      expect(r.payload.description).toBe(r.description);
      expect((r.payload.ancestor_chain[0] as { relation: string }).relation).toBe("sheet");
      expect(r.answer.items.length).toBe(1);
    }
  });
  it("the asset under test is the FROZEN v27 (it still carries the key 12d-2 retired); its pricing block is eligible by the generic predicate", () => {
    // INVERTED by 12d-2 (owner S1): v27 is a historical file and is never edited, so the retired key is
    // still in it; the suite prices through `isEligibleConfig` with no admission flag (the harness has none).
    expect((CFG as { calculator_only?: boolean }).calculator_only).toBe(true);
    expect(Object.keys(CFG.pipelines ?? {})).toEqual([]);
    expect(isEligibleConfig(CFG)).toBe(true);
  });
});

describe("E2E-1 (a)-(h) -- each rule produces the outcome stated in advance, on both paths", () => {
  it("(a) material named -> its family; Acoustic Nitrile 15 mm, cladding silent -> No (amber): 1371 / 154", () => {
    const r = run("a_material_named");
    const v = view(r);
    expect(v.items[0].family).toBe(AN);
    expect(v.items[0].familyDefaulted).toBeUndefined();
    const clad = v.items[0].fields.find((f) => f.id === "cladding")!;
    expect(clad.value).toBe("No");
    expect(clad.defaulted).toBe(true);
    expect(headline(r)).toEqual({ supply: 1371, install: 154 });
    noDivergence(r);
  });

  it("(b) no material, per metre -> Nitrile Rubber (amber); 25 mm dia -> 28.58, 19 mm, no cladding: 286 / 14", () => {
    const r = run("b_no_material_per_metre");
    const v = view(r);
    expect(v.items[0].family).toBe(NR);
    expect(v.items[0].familyDefaulted?.value).toBe(NR);
    expect(headline(r)).toEqual({ supply: 286, install: 14 });
    noDivergence(r);
  });

  it("(c) no material, per sq.m -> Thermal Nitrile (amber); 9 mm, no cladding: 383 / 154", () => {
    const r = run("c_no_material_per_sqm");
    const v = view(r);
    expect(v.items[0].family).toBe(TN);
    expect(v.items[0].familyDefaulted?.value).toBe(TN);
    expect(headline(r)).toEqual({ supply: 383, install: 154 });
    noDivergence(r);
  });

  it("(d) no material, sq.m + 'ACOUSTIC INSULATION' heading -> Acoustic Nitrile (amber); 15 mm: 1371 / 154", () => {
    const r = run("d_no_material_sqm_acoustic_heading");
    const v = view(r);
    expect(byId.get("d_no_material_sqm_acoustic_heading")!.headings).toEqual(["ACOUSTIC INSULATION"]);
    expect(v.items[0].family).toBe(AN);
    expect(v.items[0].familyDefaulted?.value).toBe(AN);
    expect(headline(r)).toEqual({ supply: 1371, install: 154 });
    noDivergence(r);
  });

  it("(e) cladding silent -> No (amber), priced: Thermal Nitrile 13 mm: 464 / 154", () => {
    const r = run("e_cladding_silent");
    const v = view(r);
    const clad = v.items[0].fields.find((f) => f.id === "cladding")!;
    expect(clad.value).toBe("No");
    expect(clad.defaulted).toBe(true);
    expect(clad.rule).toMatch(/R1/);
    expect(headline(r)).toEqual({ supply: 464, install: 154 });
    noDivergence(r);
  });

  it("(f) cladding 'UV coating' -> the model leaves it OUT -> blank, NOT priced: 'could not tell cladding'", () => {
    const r = run("f_cladding_uv_coating");
    const v = view(r);
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe("could not tell cladding");
    const clad = v.items[0].fields.find((f) => f.id === "cladding")!;
    expect(clad.value).toBe("");
    expect(clad.defaulted).toBe(false);
    // the field is empty and the ROW carries the refusal; the red outline (`blank`) is a 12c-S rule that
    // keys on the number readers' names, which a choice attribute has none of -- pre-existing, not this slice's
    expect(clad.typedValue).toBe("");
  });

  it("(g) foil on a PIPE -> 26G Aluminium, priced, the panel SHOWING 26G: Nitrile Rubber 25 mm at 32 NB -> 34.93: 545 / 224", () => {
    const r = run("g_foil_on_pipe");
    const v = view(r);
    expect(v.items[0].family).toBe(NR);
    const clad = v.items[0].fields.find((f) => f.id === "cladding")!;
    expect(clad.value).toBe("26G Aluminium");
    expect(v.items[0].working.some((w) => /R4/.test(w))).toBe(true);
    expect(headline(r)).toEqual({ supply: 545, install: 224 });
    noDivergence(r);
  });

  it("(h) foil on an ACOUSTIC row -> refuses with its reason", () => {
    const r = run("h_foil_on_acoustic");
    const v = view(r);
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toMatch(/foil on an acoustic row/);
    expect(v.reason).toMatch(/R4/);
  });
});

describe("E2E-1 -- the five single cases", () => {
  it("open / closed cell: a CLOSED-cell duct row names Thermal Nitrile; 13 mm, no cladding: 464 / 154", () => {
    const r = run("open_closed_cell");
    expect(view(r).items[0].family).toBe(TN);
    expect(headline(r)).toEqual({ supply: 464, install: 154 });
    noDivergence(r);
  });

  it("an UNSTOCKED material (XLPE) -> 'none of these' -> refuses legibly, the user decides", () => {
    const r = run("unstocked_xlpe");
    const v = view(r);
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe("no SKU in the catalogue for 'none of these' -- the user decides (R18)");
  });

  it("a 22G GI frame -> GI Framework with perforated Al sheet on Fiberglass 50 mm: 1757 / 518", () => {
    const r = run("gi22_frame");
    const v = view(r);
    expect(v.items[0].family).toBe(FG);
    expect(v.items[0].fields.find((f) => f.id === "cladding")!.value).toBe("GI Framework with perforated Al sheet");
    expect(headline(r)).toEqual({ supply: 1757, install: 518 });
    noDivergence(r);
  });

  it("a BRAND is stored and shown read-only, never matched: Thermal Nitrile 9 mm, no cladding: 383 / 154", () => {
    const r = run("brand");
    const v = view(r);
    expect(v.items[0].readOnly).toEqual([{ id: "brand", label: "Brand", value: "K-flex / Insulflex / Arma-flex /Superlon / thermo break" }]);
    expect(v.items[0].fields.some((f) => f.id === "brand")).toBe(false);
    expect(headline(r)).toEqual({ supply: 383, install: 154 });
    noDivergence(r);
  });

  it("R9: a 150 mm nitrile pipe row REFUSES above the largest stocked size (53.98)", () => {
    const r = run("r9_pipe_above_rung");
    const v = view(r);
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe("pipe size 150 is above the largest size on the sheet (53.98)");
  });
});
