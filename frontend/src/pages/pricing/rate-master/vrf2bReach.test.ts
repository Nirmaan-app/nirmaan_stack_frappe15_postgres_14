/**
 * VRF-2b K2 (owner R-INPUTS / R-CONV; U6 A, 2026-11-03 22:44) -- THE TWO VRF PRICING INPUTS ARE READ BY VRF, AND THEIR
 * PANEL SHOWS WORKED EXAMPLES.
 *
 * FIXTURE ONLY: v56's configs with VRF's capacity reader + two worked examples per input added in this file (the v57 mint
 * adds the same; test_vrf_v57 pins the asset). A factor edit is made on the fixture's items, never on live data.
 *   - the reach: both inputs READ by hvac_vrf, no SKU column (the ELR-3a assembly shape) -> the panel's assembly_only;
 *   - the used-by: hvac_vrf, 10 uses each (one per family whose rule needs the capacity) -- the same numbers the Python
 *     twin gives on the same fixture (test_rate_master v2b_09);
 *   - the worked examples: item-list shape, priced by the product's compute as the calculator does, each with its read
 *     and SKU ("16 TR x 1.25 = 20 HP -> IVRFB-20TC / TCN"); an edit moves exactly the converted cases;
 *   - NEGATIVE: without `units` neither input is read; Electrical's point-wiring examples keep their row shape.
 */
import { describe, expect, it } from "vitest";
import { readJsonFixture } from "../calculatorPanelParity.harness";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import { computePricingInputReach, unitsConvertUses } from "./pricingInputReach";
import { panelShapeOf } from "./pricingInputImpact";
import { pricingInputUsedBy } from "./rateMasterSpec";
import { computeExampleImpacts, examplesForInput, impactExamplesOf } from "./pricingInputExamples";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const read = (n: string) => readJsonFixture<Asset>(new URL(`../../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
const v56 = read("rate_master_hvac_all_v56.json");
const ITEMS: RateMasterItem[] = v56.items.map((it) => ({ ...it, discipline: v56.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const UNITS = {
  unit_attr: "capacity_unit",
  words: { HP: ["hp", "h.p."], TR: ["tr", "ton", "tons"], kW: ["kw"] },
  base: "TR",
  convert: { HP: { input: "vrf_hp_per_tr", label: "HP per TR" }, kW: { input: "vrf_kw_per_tr", label: "kW per TR" } },
  refuse_words: ["cfm", "cmh", "m3/h"],
  refuse: "capacity is stated only as an airflow ({said}) - an airflow is not converted to HP / TR - price this row by hand",
};
const EXAMPLES = [
  { id: "VRF-1", name: "Outdoor Unit, Blue Star, 16 TR", inputs: ["vrf_hp_per_tr"], unit: "Nos", items: [{ item: "Outdoor Unit", brand: "Blue Star", capacity: "16 TR" }] },
  { id: "VRF-2", name: "Cassette, Blue Star, 4 HP", inputs: ["vrf_hp_per_tr"], unit: "Nos", items: [{ item: "Cassette", brand: "Blue Star", capacity: "4 HP" }] },
  { id: "VRF-3", name: "Hi-Wall, Blue Star, 5 kW", inputs: ["vrf_kw_per_tr"], unit: "Nos", items: [{ item: "Hi-Wall", brand: "Blue Star", capacity: "5 kW" }] },
  { id: "VRF-4", name: "Outdoor Unit, Blue Star, 45 kW", inputs: ["vrf_kw_per_tr"], unit: "Nos", items: [{ item: "Outdoor Unit", brand: "Blue Star", capacity: "45 kW" }] },
];
function configs(withUnits = true, withExamples = true): Record<string, RateCategoryConfig> {
  const out: Record<string, RateCategoryConfig> = {};
  for (const c0 of v56.category_configs) {
    const c = structuredClone(c0) as Record<string, any>;
    c.discipline = "HVAC";
    if (c.category_id === "hvac_vrf") {
      if (withUnits) c.list_spec.pricing.numbers.capacity.units = structuredClone(UNITS);
      if (withExamples) c.impact_examples = structuredClone(EXAMPLES);
    }
    out[c.category_id] = c as RateCategoryConfig;
  }
  return out;
}
const CFGS = configs();
const reach = computePricingInputReach(CFGS, ITEMS);
const rates = (id: string) => ITEMS.find((it) => it.attributes?.item === id)!.rates as Record<string, number>;

describe("VRF-2b K2 -- the reach and the used-by of the two VRF inputs", () => {
  it("both inputs are READ by hvac_vrf, move no SKU's own rate, and take the assembly-only shape", () => {
    for (const id of ["vrf_hp_per_tr", "vrf_kw_per_tr"]) {
      expect(reach[id]?.readByCategories).toEqual(["hvac_vrf"]);
      expect(reach[id]?.distinctSkus).toEqual([]);
      expect(reach[id]?.candidateSkus ?? []).toEqual([]);
      expect(panelShapeOf(rates(id), reach[id])).toBe("assembly_only");
    }
  });

  it("the convert uses: one per family whose rule needs the capacity -- 10 families, both inputs", () => {
    const uses = unitsConvertUses(CFGS.hvac_vrf);
    expect(uses.filter((u) => u.input === "vrf_hp_per_tr").map((u) => u.family)).toHaveLength(10);
    expect(uses.filter((u) => u.input === "vrf_kw_per_tr").map((u) => u.family)).toHaveLength(10);
    expect(uses.map((u) => u.family)).not.toContain("Refnet/Y-Joint");
  });

  it("the used-by twin: hvac_vrf, 10 uses each (= csv_exporter on the same fixture, test_rate_master v2b_09); every other input unchanged", () => {
    const before = pricingInputUsedBy(Object.values(configs(false, false)) as never);
    const after = pricingInputUsedBy(Object.values(CFGS) as never);
    expect(after.vrf_hp_per_tr).toEqual({ sites: 10, categories: ["hvac_vrf"] });
    expect(after.vrf_kw_per_tr).toEqual({ sites: 10, categories: ["hvac_vrf"] });
    expect(before.vrf_hp_per_tr).toBeUndefined();
    const others = (m: Record<string, unknown>) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith("vrf_")));
    expect(others(after)).toEqual(others(before));
  });

  it("NEGATIVE (BEFORE): without the capacity reader neither input is read by anything (the '0 items' of VRF-R2 C3)", () => {
    const r0 = computePricingInputReach(configs(false, false), ITEMS);
    expect(r0.vrf_hp_per_tr).toBeUndefined();
    expect(r0.vrf_kw_per_tr).toBeUndefined();
    // every other input's reach is unchanged by the key
    const strip = (r: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("vrf_"))));
    expect(strip(reach)).toBe(strip(r0));
  });
});

describe("VRF-2b K2 -- the worked examples (U6 A)", () => {
  it("each input shows ITS two examples (the `inputs` filter); the item-list shape is accepted", () => {
    expect(impactExamplesOf(CFGS.hvac_vrf as never).map((e) => e.id)).toEqual(["VRF-1", "VRF-2", "VRF-3", "VRF-4"]);
    expect(examplesForInput(reach.vrf_hp_per_tr, CFGS as never, "vrf_hp_per_tr").map((x) => x.example.id)).toEqual(["VRF-1", "VRF-2"]);
    expect(examplesForInput(reach.vrf_kw_per_tr, CFGS as never, "vrf_kw_per_tr").map((x) => x.example.id)).toEqual(["VRF-3", "VRF-4"]);
  });

  it("before any edit: each example priced by the product's compute, with its read and SKU (the cert's figures)", () => {
    const hp = computeExampleImpacts("vrf_hp_per_tr", {}, reach.vrf_hp_per_tr, CFGS as never, ITEMS);
    const kw = computeExampleImpacts("vrf_kw_per_tr", {}, reach.vrf_kw_per_tr, CFGS as never, ITEMS);
    const show = (e: (typeof hp)[number]) => (e.before.ok ? [e.example.id, e.before.values.supply_rate, e.before.values.install_rate, e.before.line] : [e.example.id, e.before.reason]);
    expect(hp.map(show)).toEqual([
      ["VRF-1", 476040, 20000, "16 TR x 1.25 = 20 HP -> IVRFB-20TC / TCN"],
      ["VRF-2", 43680, 3500, "4 HP / 1.25 = 3.2 TR -> VLC-38"],
    ]);
    expect(kw.map(show)).toEqual([
      ["VRF-3", 20760, 1800, "5 kW / 3.517 = 1.42 TR -> VHW-18A"],
      ["VRF-4", 436920, 16000, "45 kW / 3.517 x 1.25 = 15.99 HP -> IVRFB-16TC"],
    ]);
    expect([...hp, ...kw].every((e) => !e.moved)).toBe(true);
  });

  it("A FACTOR EDIT ON THE FIXTURE moves every converted example to the size the new factor reaches", () => {
    const hp = computeExampleImpacts("vrf_hp_per_tr", { factor: 1.3 }, reach.vrf_hp_per_tr, CFGS as never, ITEMS);
    // 16 TR x 1.3 = 20.8 HP -> the next size up, 22 HP: a new SKU and new figures; 4 HP / 1.3 = 3.08 TR -> still the
    // 3.2 TR cassette: the read changes, the SKU and the figures do not (shown as "No change")
    expect(hp.map((e) => [e.example.id, e.moved, e.after.ok ? e.after.line : e.after.reason])).toEqual([
      ["VRF-1", true, "16 TR x 1.3 = 20.8 HP -> IVRFB-22TC / TCN"],
      ["VRF-2", false, "4 HP / 1.3 = 3.08 TR -> VLC-38"],
    ]);
    const kw = computeExampleImpacts("vrf_kw_per_tr", { factor: 3.0 }, reach.vrf_kw_per_tr, CFGS as never, ITEMS);
    expect(kw.find((e) => e.example.id === "VRF-3")!.after).toMatchObject({ ok: true, line: "5 kW / 3 = 1.67 TR -> VHW-20A" });
  });

  it("NEGATIVE: Electrical's point-wiring examples keep their row shape -- attrs, no items, no line", () => {
    const ev = read("rate_master_electrical_all_v72.json");
    const pw = ev.category_configs.find((c) => c.category_id === "point_wiring") as never;
    const ex = impactExamplesOf(pw);
    expect(ex.length).toBeGreaterThan(0);
    for (const e of ex) {
      expect(e.attrs && typeof e.attrs === "object").toBe(true);
      expect(e.items).toBeUndefined();
      expect(e.inputs).toBeUndefined();
    }
  });
});
