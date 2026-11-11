/**
 * VRF-4 K2 (owner BORROWED 2026-11-05 22:18 "option a" / "any field which is borrowd from other categories als gets their
 * respective rules"; DEFAULTS 2026-11-06 09:50 "the defaults remain the same as we ddeclared and are not overwriiten by the
 * defaults of the parent settings") -- A BORROWED FIELD IS PRICED BY ITS SOURCE'S OWN RULES: copper by Piping (a typed entry /
 * the BoQ's words through Piping's reader and ladder), insulation by ONE Insulation call on the copper size AS READ (mirrored),
 * the cable by Electrical's own match and its own sentence. VRF's declared defaults always win; "closest" is gone from the pricer.
 *
 * Every expectation is the SOURCE pricing the same value on its own row (`ownRow`) -- VRF-R4 R5 (d)'s cases as pins -- or the
 * per-metre figures VRF-3b measured for the defaults (P0 (a2), unchanged). FIXTURE: v59 + E72 + vrf4Model.json, calculator_only out.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { pricingInputRates, splitAsWrittenPair, type ExtrasFromModel } from "./itemListPricing";
import {
  EXTRAS_INCLUDES_KEY, ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, buildExtractionByRow, makePricingSheetHelper,
  type ExtraLineView, type ItemListSuggestion, type ItemListView,
} from "./pricingSheetHelper";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h59 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v59.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
const FX = readJsonFixture<{ extras_from_model: ExtrasFromModel; extras_words: Record<string, string> }>(new URL("../../pricing/__fixtures__/vrf4Model.json", import.meta.url));
const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS: RateMasterItem[] = [...toItems(h59), ...toItems(e72)];
const VRF = "hvac_vrf";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const vrf4 = (): RateCategoryConfig => {
  const c = structuredClone(h59.category_configs.find((x) => x.category_id === VRF)) as Record<string, any>;
  delete c.calculator_only;
  c.list_spec.pricing.extras.from_model = structuredClone(FX.extras_from_model);
  c.list_spec.pricing.extras.lines.boq_note = FX.extras_words.boq_note;
  return c as RateCategoryConfig;
};
const configsOf = (over: Record<string, RateCategoryConfig> = {}) => new Map<string, RateCategoryConfig>([
  ...h59.category_configs.map((c) => [c.category_id, over[c.category_id] ?? (c.category_id === VRF ? vrf4() : c)] as [string, RateCategoryConfig]),
  ...e72.category_configs.map((c) => [c.category_id, over[c.category_id] ?? c] as [string, RateCategoryConfig]),
]);
const A = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, confidence: 1 }]));

/** a VRF BoQ row whose model item states the extras (VRF-4's path) */
const boqRow = (item: Record<string, string>, over: Record<string, RateCategoryConfig> = {}): ItemListView => {
  const ext = buildExtractionByRow([{ excel_row: 7, description: "VRF unit", category_id: VRF, attributes: {}, items: [{ attributes: A(item) }] }] as never);
  const h = makePricingSheetHelper({ configsByCategory: configsOf(over), items: ITEMS, extractionByRow: ext });
  return (h.compute({ excelRow: 7, description: "VRF unit", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: KINDS, unit: "Nos", quantity: 1 } as never) as unknown as ItemListSuggestion).itemList!;
};
/** the SOURCE pricing the value on ITS OWN row, as the model read it there */
const ownRow = (cat: string, item: Record<string, string>, unit: string) => {
  const ext = buildExtractionByRow([{ excel_row: 8, description: "own row", category_id: cat, attributes: {}, items: [{ attributes: A(item) }] }] as never);
  const h = makePricingSheetHelper({ configsByCategory: configsOf(), items: ITEMS, extractionByRow: ext });
  const v = (h.compute({ excelRow: 8, description: "own row", nodeType: "Line Item", category: cat, discipline: "HVAC", rateKinds: KINDS, unit, quantity: 1 } as never) as unknown as ItemListSuggestion).itemList!;
  return { priced: v.rowPriced, per: v.rowPriced ? { supply: v.totals!.supply_rate!, install: v.totals!.install_rate! } : undefined, reason: v.reason ?? v.items[0]?.reason, item: v.items[0] };
};
/** Electrical pricing a cable spec on its own (the same compute VRF's cable line calls) */
const cableOwn = (attrs: Record<string, string>) => {
  const h = makePricingSheetHelper({ configsByCategory: configsOf(), items: ITEMS, extractionByRow: new Map() });
  const r = h.compute({ excelRow: -1, description: "", nodeType: "", category: "wiring_cabling", discipline: "Electrical", rateKinds: KINDS, unit: "Mtr" } as never, attrs) as any;
  return r.kind === "suggestion" && typeof r.values.supply_rate === "number" ? { supply: r.values.supply_rate, install: r.values.install_rate } : { reason: r.kind === "none" ? r.reason : (r.basis || "no cable rate row matches") };
};
const ODU = { item: "Outdoor Unit", brand: "Blue Star", capacity: "10 HP" };
const line = (v: ItemListView, id: string, b = 0): ExtraLineView => (v.items[b].extras?.lines ?? []).find((l) => l.id === id)!;
const val = (l: ExtraLineView, f: string) => l.fields.find((x) => x.id === f)?.value;
const note = (l: ExtraLineView, f: string) => l.fields.find((x) => x.id === f)?.note;

describe("VRF-4 B2 copper -> Piping's own reader and ladder (R5 (d) cases): the VRF line = Piping on its own row", () => {
  const CASES = ["1.125 inch", "12 mm", "15.8 mm", "14 mm", "15 mm", "7/8\"", "1-1/4\"", "54 mm", "1", "40/50", "28.6", "41.3 mm OD"];
  for (const s of CASES) {
    it(`'${s}' from the BoQ`, () => {
      const v = boqRow({ ...ODU, includes_copper: "Yes", extra_copper_size_as_written: s });
      // the line prices the value it RECEIVED: a pair ("40/50") is supply / return (B1), each its own Piping call
      const parts = splitAsWrittenPair(s);
      for (const [id, part] of [["copper_supply", parts[0]], ["copper_return", parts[1] ?? parts[0]]] as Array<[string, string]>) {
      const l = line(v, id);
      const own = ownRow("hvac_piping", { pipe_type: "Copper", size_mm: part }, "Rmt");
      if (own.priced) {
        expect(l.state).toBe("priced");
        expect(l.perMetre).toEqual(own.per);
        expect(val(l, "size")).toBe(own.item.fields.find((f) => f.id === "size_mm")?.value);
      } else {
        expect(l.state).toBe("blank");
        expect(l.reason).toBe(own.reason);
        expect(v.rowPriced).toBe(false);
      }
      }
    });
  }
  it("the cases R5 (d) found divergent now read as Piping reads them: 14 -> 15.9, 54 refused, a bare 1 refused, 1-1/4\" -> 31.7, 41.3 mm OD -> 41.3", () => {
    const at = (s: string) => line(boqRow({ ...ODU, includes_copper: "Yes", extra_copper_size_as_written: s }), "copper_supply");
    expect([val(at("14 mm"), "size"), at("14 mm").perMetre]).toEqual(["15.9", { supply: 1298, install: 220 }]);
    expect(note(at("14 mm"), "size")).toMatch(/^BoQ says 14 mm -> .*15\.9/);
    expect(at("54 mm").reason).toMatch(/above the largest size on the sheet \(47\.6\)/);
    expect(at("1").reason).toMatch(/no unit/);
    expect(val(at("1-1/4\""), "size")).toBe("31.7");
    expect(val(at("41.3 mm OD"), "size")).toBe("41.3");
    // the pair: supply / return each through Piping
    const pair = boqRow({ ...ODU, includes_copper: "Yes", extra_copper_size_as_written: "14 mm / 54 mm" });
    expect(val(line(pair, "copper_supply"), "size")).toBe("15.9");
    expect(line(pair, "copper_return").state).toBe("blank");
  });
  it("C5 (calculator): a typed '14 mm' prices 15.9 with Piping's own note; '54 mm' Piping's refusal; NEGATIVE: no 'closest' note anywhere", () => {
    const calc = makePricingSheetHelper({ configsByCategory: configsOf(), items: ITEMS, extractionByRow: new Map() });
    const typed = (size: string) => (calc.compute(calculatorCtx("HVAC", VRF), {
      [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Outdoor Unit", attrs: { brand: "Blue Star", capacity: "10" }, extras: { set: { copper_supply: { size } } } }] }),
      [ROW_UNIT_OVERRIDE_KEY]: "Nos", [EXTRAS_INCLUDES_KEY]: "copper" }) as unknown as ItemListSuggestion).itemList!;
    const t14 = line(typed("14 mm"), "copper_supply");
    expect(val(t14, "size")).toBe("15.9");
    expect(note(t14, "size")).toMatch(/^You typed 14 mm -> .*15\.9/);
    expect(note(t14, "size")).not.toMatch(/closest/);
    const t54 = line(typed("54 mm"), "copper_supply");
    expect(t54.reason).toMatch(/above the largest size on the sheet \(47\.6\)/);
  });
});

describe("VRF-4 B2 insulation -> ONE Insulation call on the copper size AS READ (mirrored), thickness raw", () => {
  for (const cu of ["25.4", "31.7", "38.1", "47.6"]) {
    it(`on copper ${cu}: the pipe size Insulation itself picks (next size up), = Insulation on its own row`, () => {
      const v = boqRow({ ...ODU, includes_copper: "Yes", includes_insulation: "Yes", extra_copper_size_as_written: cu });
      const l = line(v, "ins_supply");
      const own = ownRow("hvac_insulation", { item: "Nitrile Rubber Insulation", pipe_size_mm: cu, thickness_mm: "19", cladding: "No" }, "Rmt");
      expect(l.perMetre).toEqual(own.per);
      expect(val(l, "size")).toBe(own.item.fields.find((f) => f.id === "pipe_size_mm")?.value);
    });
  }
  it("47.6 now reaches 53.98 (GAP 1 closed); thickness 20 on 22.2 -> 25 (next size up); '32' -> layers; '19 mm' -> 19", () => {
    const ins = (cu: string, th?: string) => line(boqRow({ ...ODU, includes_copper: "Yes", includes_insulation: "Yes", extra_copper_size_as_written: cu,
      ...(th ? { extra_insulation_thickness_as_written: th } : {}) }), "ins_supply");
    expect(val(ins("47.6"), "size")).toBe("53.98");
    expect(val(ins("22.2", "20"), "thickness")).toBe("25");
    expect(ins("22.2", "20").perMetre).toEqual(ownRow("hvac_insulation", { item: "Nitrile Rubber Insulation", pipe_size_mm: "22.2", thickness_mm: "20", cladding: "No" }, "Rmt").per);
    expect(ins("22.2", "32").perMetre).toEqual(ownRow("hvac_insulation", { item: "Nitrile Rubber Insulation", pipe_size_mm: "22.2", thickness_mm: "32", cladding: "No" }, "Rmt").per);
    expect(val(ins("22.2", "32"), "thickness")).toMatch(/\+/);
    expect(val(ins("22.2", "19 mm"), "thickness")).toBe("19");
  });
  it("NEGATIVE: copper refused on its size ('1' - no unit) -> the insulation has no size ('its copper line has no size yet')", () => {
    const l = line(boqRow({ ...ODU, includes_copper: "Yes", includes_insulation: "Yes", extra_copper_size_as_written: "1" }), "ins_supply");
    expect(l.state).toBe("blank");
    expect(l.reason).toBe("Size needed. Its copper line has no size yet. Pick a size, or fill the table.");
  });
});

describe("VRF-4 B2 cable -> Electrical's own match and its own sentence (no VRF pre-check)", () => {
  it("'4 core x 10 sqmm' (BoQ words) -> 4C x 10 priced by Electrical; '2C x 1.5 Sqmm' -> 80 / 24 per metre", () => {
    const p = line(boqRow({ ...ODU, includes_power: "Yes", extra_cable_spec_as_written: "4 core x 10 sqmm" }), "power");
    expect([val(p, "spec"), p.perMetre]).toEqual(["4C x 10", { supply: 950, install: 40 }]);
    const q = line(boqRow({ ...ODU, includes_power: "Yes", extra_cable_spec_as_written: "2C x 1.5 Sqmm" }), "power");
    expect(q.perMetre).toEqual({ supply: 80, install: 24 });
  });
  it("C6: an unstocked spec (4C x 400, 3.5C x 50) shows ELECTRICAL's own sentence, word for word", () => {
    for (const [cores, sq] of [["4", "400"], ["3.5", "50"]]) {
      const l = line(boqRow({ ...ODU, includes_power: "Yes", extra_cable_spec_as_written: `${cores}C x ${sq}` }), "power");
      const own = cableOwn({ material: "COPPER", insulation: "UNARMOURED", runs: "1", core: cores, thickness_sqmm: sq });
      expect("reason" in own).toBe(true);
      expect(l.reason).toBe((own as { reason: string }).reason);
      expect(l.reason).not.toMatch(/is not stocked - pick a spec/);
    }
  });
  it("NEGATIVE: words with no size ('3 core flexible copper cable') ask for a spec, naming the words", () => {
    const l = line(boqRow({ ...ODU, includes_power: "Yes", extra_cable_spec_as_written: "3 core flexible copper cable" }), "power");
    expect(l.reason).toBe("Size needed. \"3 core flexible copper cable\" is not a size. Pick a size, or fill the table.");
  });
});

describe("VRF-4 B2 DEFAULTS -- VRF's declared defaults win; no default figure moves (owner 09:50)", () => {
  // VRF-3b P0 (a2): the per-metre figures of every default size, measured then by the product's pricer (unchanged)
  const COPPER: Record<string, [number, number]> = { "6.4": [390, 220], "9.5": [429, 220], "12.7": [936, 220], "15.9": [1298, 220], "19.1": [1590, 220], "22.2": [1814, 220], "28.6": [2438, 220], "34.9": [3573, 220] };
  const INSUL: Record<string, [string, number, number]> = { "6.4": ["6.35", 212, 14], "9.5": ["9.52", 222, 14], "12.7": ["12.7", 238, 14], "15.9": ["15.88", 248, 14], "19.1": ["19.05", 255, 14], "22.2": ["22.23", 265, 14], "28.6": ["28.58", 286, 14], "34.9": ["34.93", 304, 14] };
  const bandUnits: Array<[string, string]> = [["Outdoor Unit", "8 HP"], ["Outdoor Unit", "16 HP"], ["Outdoor Unit", "24 HP"], ["Hi-Wall", "1.5 TR"], ["Ductable", "6 TR"]];
  it("every band's default copper and insulation size prices exactly as VRF-3b measured (the pricer, every band)", () => {
    let checked = 0;
    for (const [fam, cap] of bandUnits) {
      const v = boqRow({ item: fam, brand: "Blue Star", capacity: cap, includes_copper: "Yes", includes_insulation: "Yes" });
      for (const side of ["supply", "return"]) {
        const cu = line(v, `copper_${side}`);
        const sz = String(val(cu, "size"));
        expect(COPPER[sz], `${fam} ${cap} ${side} ${sz}`).toBeDefined();
        expect([cu.perMetre?.supply, cu.perMetre?.install]).toEqual(COPPER[sz]);
        const ins = line(v, `ins_${side}`);
        expect([val(ins, "size"), ins.perMetre?.supply, ins.perMetre?.install]).toEqual(INSUL[sz]);
        expect([val(ins, "thickness"), val(ins, "cladding"), val(ins, "family")]).toEqual(["19", "No", "Nitrile Rubber Insulation"]);
        checked++;
      }
    }
    expect(checked).toBe(10);
    // and every size the Pricing Inputs table holds is one of them (a default can never fall between)
    const cells = ITEMS.filter((it) => String((it.attributes as Record<string, unknown>)?.item ?? "").startsWith("vrf_extra_pipe_"));
    for (const it of cells) {
      const f = Number((it.rates as Record<string, unknown>).factor);
      if (String((it.attributes as Record<string, unknown>).item).endsWith("_mm") && !String((it.attributes as Record<string, unknown>).item).endsWith("insulation_mm")) {
        expect(Object.keys(COPPER).map(Number)).toContain(f);
      }
    }
    expect(pricingInputRates(ITEMS, "vrf_extra_pipe_outdoor_upto_12hp")).not.toBeNull();
  });
  it("a SOURCE default change never moves a VRF line (scratch copies of Insulation and Piping with other defaults)", () => {
    const before = boqRow({ ...ODU, includes_copper: "Yes", includes_insulation: "Yes" });
    const ins = structuredClone(h59.category_configs.find((c) => c.category_id === "hvac_insulation")) as Record<string, any>;
    const pip = structuredClone(h59.category_configs.find((c) => c.category_id === "hvac_piping")) as Record<string, any>;
    const d = ins.list_spec.pricing.defaults ?? (ins.list_spec.pricing.defaults = {});
    d.cladding = { ...(d.cladding ?? {}), value: "26G Al", absent_as_none: true, rule: "scratch" };
    d.thickness_mm = { value: 25, absent_as_none: true, rule: "scratch" };
    const pd = pip.list_spec.pricing.defaults ?? (pip.list_spec.pricing.defaults = {});
    pd.pipe_type = { value: "MS", absent_as_none: true, rule: "scratch" };
    const after = boqRow({ ...ODU, includes_copper: "Yes", includes_insulation: "Yes" }, { hvac_insulation: ins as RateCategoryConfig, hvac_piping: pip as RateCategoryConfig });
    for (const id of ["copper_supply", "copper_return", "ins_supply", "ins_return"]) {
      expect(line(after, id).figures).toEqual(line(before, id).figures);
      expect(line(after, id).fields.map((f) => f.value)).toEqual(line(before, id).fields.map((f) => f.value));
    }
  });
});

describe("VRF-4 U8 (owner 2026-11-06) -- the removal banner names the insulation its copper line took", () => {
  it("removing the copper supply on a row with insulation: '(and its insulation)'; without insulation: the line alone", () => {
    const calc = makePricingSheetHelper({ configsByCategory: configsOf(), items: ITEMS, extractionByRow: new Map() });
    const run = (inc: string) => (calc.compute(calculatorCtx("HVAC", VRF), {
      [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: "Outdoor Unit", attrs: { brand: "Blue Star", capacity: "10" }, extras: { removed: ["copper_supply"] } }] }),
      [ROW_UNIT_OVERRIDE_KEY]: "Nos", [EXTRAS_INCLUDES_KEY]: inc }) as unknown as ItemListSuggestion).itemList!;
    expect(run("copper,insulation").items[0].extras?.removed).toEqual([{ id: "copper_supply", label: "Copper pipe - supply line (and its insulation)" }]);
    expect(run("copper").items[0].extras?.removed).toEqual([{ id: "copper_supply", label: "Copper pipe - supply line" }]);
  });
});

describe("VRF-4 U8 (owner 2026-11-06) -- the Pricing Input panel: the where-used count in the title, 'was' not 'today'", () => {
  it("the panel source titles an assembly-only input by its where-used count and labels the stored value 'was' (seen live in C10)", () => {
    const src = readFileSync(new URL("../../pricing/rate-master/PricingInputImpactPanel.tsx", import.meta.url), "utf8");
    expect(src).toContain("const titleCount = total > 0 ? total : (reach?.assemblySkus ?? []).length;");
    expect(src).toContain("`${titleCount} item${titleCount === 1 ? \"\" : \"s\"} · ");
    expect(src).toMatch(/\n\s+was \{isPercentField\(k\)/);
    expect(src).not.toMatch(/\n\s+today \{isPercentField\(k\)/);
  });
});
