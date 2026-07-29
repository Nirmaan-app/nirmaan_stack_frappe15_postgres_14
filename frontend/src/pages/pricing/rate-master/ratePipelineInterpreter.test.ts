// RM-2 interpreter tests -- the FOUR RM-1 goldens as standing fixtures, plus a
// no-match case and an unknown-step case. Raw master rates are the real RM-1
// values (extracted 2026-07-28); the interpreter must reproduce the goldens EXACTLY.

import { describe, it, expect } from "vitest";
import type { Pipeline, RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import { evalFormula, roundUp, runPipeline, runAllPipelines } from "./ratePipelineInterpreter";

// ---- the four stored pipelines (verbatim shape from RM-1 config) ----
const PIPELINES: Record<string, Pipeline> = {
  cable_boq: {
    output: ["supply_per_mtr", "install_per_mtr"],
    steps: [
      { step: "match_master_row", params: { kind: "cable" }, explain: "find the cable row" },
      {
        step: "apply_effective_multiplier",
        target: "list_price_per_mtr",
        result: "supply_per_mtr",
        conditions: [
          { when: { insulation: "ARMOURED" }, params: { discount: 0.75, markup: 0.35 } },
          { when: { insulation: "UNARMOURED" }, params: { discount: 0.57, markup: 0.4 } },
        ],
        formula: "(1-discount)*(1+markup)",
        explain: "supplier discount off list, then company markup",
      },
      { step: "roundup", target: "supply_per_mtr", params: { digits: -1 } },
      {
        step: "scale",
        target: "install_base_per_mtr",
        result: "install_per_mtr",
        params: { install_markup: 1.0 },
        formula: "base*(1+install_markup)",
      },
      { step: "roundup", target: "install_per_mtr", params: { digits: 0 } },
    ],
  },
  termination_boq: {
    output: ["supply_per_set", "install_per_set"],
    steps: [
      { step: "match_master_row", params: { kind: "termination" } },
      { step: "component", name: "lug", target: "lug_list", params: { discount: 0.4, markup: 0.55 }, formula: "lug_list*(1-discount)*(1+markup)" },
      {
        step: "component_band",
        name: "gland",
        band_on: "thickness_sqmm",
        bands: [
          { when: "<35", target: "gland_band1_list" },
          { when: ">=35", target: "gland_band2_list" },
        ],
        params: { discount: 0.5, markup: 0.45 },
        formula: "gland_list*(1-discount)*(1+markup)",
      },
      { step: "sum_components", result: "supply_per_set" },
      { step: "roundup", target: "supply_per_set", params: { digits: -1 } },
      { step: "install_as_ratio", params: { ratio: 0.25 }, result: "install_per_set" },
      { step: "roundup", target: "install_per_set", params: { digits: -1 } },
    ],
  },
  cable_bcs: {
    output: ["bcs_supply_per_mtr"],
    steps: [
      { step: "match_master_row", params: { kind: "cable" } },
      {
        step: "apply_effective_multiplier",
        target: "list_price_per_mtr",
        result: "bcs_supply_per_mtr",
        conditions: [
          { when: { insulation: "ARMOURED" }, params: { discount: 0.75, wastage: 0.05 } },
          { when: { insulation: "UNARMOURED" }, params: { discount: 0.57, wastage: 0.05 } },
        ],
        formula: "(1-discount)*(1+wastage)",
      },
      { step: "roundup", target: "bcs_supply_per_mtr", params: { digits: 0 } },
    ],
  },
};

const CONFIG: RateCategoryConfig = {
  discipline: "Electrical",
  category_id: "wiring_cabling",
  attribute_definitions: [
    { id: "material", label: "Material", type: "choice", values: ["ALUMINIUM", "COPPER"] },
    { id: "insulation", label: "Insulation", type: "choice", values: ["ARMOURED", "UNARMOURED"] },
    { id: "core", label: "Core", type: "number" },
    { id: "thickness_sqmm", label: "Thickness (sqmm)", type: "number" },
    { id: "brand", label: "Brand", type: "choice", values: ["Polycab"], selector: false },
  ],
  pipelines: PIPELINES,
};

function cable(material: string, insulation: string, core: number, th: number, list: number, install: number): RateMasterItem {
  return { discipline: "Electrical", kind: "cable", brand: "Polycab", unit: "Mtr", attributes: { material, insulation, core, thickness_sqmm: th }, rates: { list_price_per_mtr: list, install_base_per_mtr: install } };
}
function term(material: string, insulation: string, core: number, th: number, lug: number, b1: number, b2: number): RateMasterItem {
  return { discipline: "Electrical", kind: "termination", brand: "Polycab", unit: "Set", attributes: { material, insulation, core, thickness_sqmm: th }, rates: { lug_list: lug, gland_band1_list: b1, gland_band2_list: b2 } };
}

// real RM-1 raw rates for the golden combos
const ITEMS: RateMasterItem[] = [
  cable("COPPER", "UNARMOURED", 1.0, 6.0, 192.0, 10.0),
  term("COPPER", "UNARMOURED", 1.0, 6.0, 11.46, 82.55, 361.18),
  cable("COPPER", "ARMOURED", 3.0, 2.5, 570.0, 14.0),
  term("COPPER", "ARMOURED", 3.0, 2.5, 6.47, 82.55, 388.97),
  cable("ALUMINIUM", "ARMOURED", 4.0, 16.0, 606.0, 22.0),
  term("ALUMINIUM", "ARMOURED", 4.0, 16.0, 4.73, 164.39, 905.27),
  term("COPPER", "ARMOURED", 3.0, 50.0, 151.66, 203.75, 1091.65),
];

const sel = (material: string, insulation: string, core: number, th: number) => ({ material, insulation, core, thickness_sqmm: th });

describe("evalFormula + roundUp (safe primitives)", () => {
  it("evaluates arithmetic with bound identifiers, no eval()", () => {
    expect(evalFormula("(1-discount)*(1+markup)", { discount: 0.75, markup: 0.35 })).toBeCloseTo(0.3375, 10);
    expect(evalFormula("base*(1+install_markup)", { base: 14, install_markup: 1.0 })).toBe(28);
  });
  it("ROUNDUP is away-from-zero at digits (-1 => tens, 0 => units)", () => {
    expect(roundUp(115.584, -1)).toBe(120);
    expect(roundUp(120, -1)).toBe(120);
    expect(roundUp(86.688, 0)).toBe(87);
    expect(roundUp(235, -1)).toBe(240);
  });
  it("throws on an unknown identifier (surfaces config problems)", () => {
    expect(() => evalFormula("a*b", { a: 1 })).toThrow();
  });
});

describe("RM-1 goldens via the stored-config interpreter", () => {
  it("COPPER/UNARMOURED/1C/6.0 -> cable 120/20, termination 80/20, BCS 87", () => {
    const a = sel("COPPER", "UNARMOURED", 1.0, 6.0);
    expect(runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, a).finals).toEqual({ supply_per_mtr: 120, install_per_mtr: 20 });
    expect(runPipeline("termination_boq", PIPELINES.termination_boq, ITEMS, a).finals).toEqual({ supply_per_set: 80, install_per_set: 20 });
    expect(runPipeline("cable_bcs", PIPELINES.cable_bcs, ITEMS, a).finals).toEqual({ bcs_supply_per_mtr: 87 });
  });
  it("COPPER/ARMOURED/3C/2.5 -> cable 200/28, termination 70/20, BCS 150", () => {
    const a = sel("COPPER", "ARMOURED", 3.0, 2.5);
    expect(runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, a).finals).toEqual({ supply_per_mtr: 200, install_per_mtr: 28 });
    expect(runPipeline("termination_boq", PIPELINES.termination_boq, ITEMS, a).finals).toEqual({ supply_per_set: 70, install_per_set: 20 });
    expect(runPipeline("cable_bcs", PIPELINES.cable_bcs, ITEMS, a).finals).toEqual({ bcs_supply_per_mtr: 150 });
  });
  it("ALUMINIUM/ARMOURED/4C/16.0 -> cable 210/44, termination 130/40, BCS 160", () => {
    const a = sel("ALUMINIUM", "ARMOURED", 4.0, 16.0);
    expect(runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, a).finals).toEqual({ supply_per_mtr: 210, install_per_mtr: 44 });
    expect(runPipeline("termination_boq", PIPELINES.termination_boq, ITEMS, a).finals).toEqual({ supply_per_set: 130, install_per_set: 40 });
    expect(runPipeline("cable_bcs", PIPELINES.cable_bcs, ITEMS, a).finals).toEqual({ bcs_supply_per_mtr: 160 });
  });
  it("COPPER/ARMOURED/3C/50.0 -> termination 940/240 (>=35 gland band)", () => {
    const a = sel("COPPER", "ARMOURED", 3.0, 50.0);
    const r = runPipeline("termination_boq", PIPELINES.termination_boq, ITEMS, a);
    expect(r.finals).toEqual({ supply_per_set: 940, install_per_set: 240 });
    const bandStep = r.steps.find((s) => s.step === "component_band");
    expect(bandStep?.bandChosen).toContain("gland_band2_list");
  });
});

describe("condition + band traces are readable", () => {
  it("apply_effective_multiplier surfaces the matched condition string", () => {
    const r = runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, sel("COPPER", "ARMOURED", 3.0, 2.5));
    const mult = r.steps.find((s) => s.step === "apply_effective_multiplier");
    expect(mult?.matchedCondition).toBe("insulation = ARMOURED -> discount 0.75, markup 0.35");
  });
  it("switching insulation switches the matched condition", () => {
    const r = runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, sel("COPPER", "UNARMOURED", 1.0, 6.0));
    const mult = r.steps.find((s) => s.step === "apply_effective_multiplier");
    expect(mult?.matchedCondition).toBe("insulation = UNARMOURED -> discount 0.57, markup 0.4");
  });
});

describe("honest no-match", () => {
  it("a combination with no master row yields status no_match and zero finals", () => {
    const a = sel("COPPER", "UNARMOURED", 99.0, 999.0);
    const results = runAllPipelines(CONFIG, ITEMS, a);
    for (const r of results) {
      expect(r.status).toBe("no_match");
      expect(r.finals).toEqual({});
    }
  });
});

describe("forward-compat: unknown step type", () => {
  it("renders an explicit unsupported state, never a silent skip", () => {
    const pl: Pipeline = {
      output: ["x"],
      steps: [
        { step: "match_master_row", params: { kind: "cable" } },
        { step: "quantum_flux", target: "x" } as unknown as Pipeline["steps"][number],
      ],
    };
    const r = runPipeline("weird", pl, ITEMS, sel("COPPER", "UNARMOURED", 1.0, 6.0));
    expect(r.status).toBe("unsupported");
    expect(r.steps.some((s) => s.unsupported && s.step === "quantum_flux")).toBe(true);
    expect(r.finals).toEqual({});
  });
});

// ── EA-1: the four bounded vocabulary additions (each with an HONEST failure mode) ──────────────────
// The FIVE wiring goldens above are the regression pins for all four; these fixtures are the real
// E-ALL config shapes (eall_import_electrical_v2.json) reduced to the row(s) each golden needs.

describe("EA-1 (1) component_band string-equality bands (tray cover selector)", () => {
  const TRAY: Pipeline = {
    output: ["supply_per_rmt", "install_per_rmt"],
    steps: [
      { step: "match_master_row", params: { kind: "cable_tray" } },
      { step: "component_band", name: "base", band_on: "cover", bands: [
        { when: "WITHOUT", target: "without_cover_list" },
        { when: "COVER_ONLY", target: "cover_only_list" },
        { when: "WITH", target: "with_cover_list" },
      ], params: {}, formula: "base" },
      { step: "sum_components", result: "supply_per_rmt" },
      { step: "scale", target: "supply_per_rmt", result: "supply_per_rmt", params: { markup: 0.45 }, formula: "base*(1+markup)" },
      { step: "roundup", target: "supply_per_rmt", params: { digits: -1 } },
      { step: "scale", target: "supply_per_rmt", result: "install_per_rmt", params: { install_ratio: 0.2 }, formula: "base*install_ratio" },
      { step: "roundup", target: "install_per_rmt", params: { digits: -1 } },
    ],
  };
  const ITEM: RateMasterItem = { discipline: "Electrical", kind: "cable_tray", attributes: { tray_type: "Solid", material: "GI", thickness_mm: 1, width_mm: 100 }, rates: { without_cover_list: 116, cover_only_list: 72, with_cover_list: 188 } };
  const s = (cover: string) => ({ tray_type: "Solid", material: "GI", thickness_mm: 1, width_mm: 100, cover });

  it("cover=WITH selects with_cover_list (188) -> golden 280 / 60", () => {
    expect(runPipeline("tray_boq", TRAY, [ITEM], s("WITH")).finals).toEqual({ supply_per_rmt: 280, install_per_rmt: 60 });
  });
  it("cover=WITHOUT selects without_cover_list (116) -> 170 / 40 (a different band)", () => {
    expect(runPipeline("tray_boq", TRAY, [ITEM], s("WITHOUT")).finals).toEqual({ supply_per_rmt: 170, install_per_rmt: 40 });
  });
  it("an unknown cover value matches no band -> honest no_match, zero finals", () => {
    const r = runPipeline("tray_boq", TRAY, [ITEM], s("GOLD_PLATED"));
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
});

describe("EA-1 (2) value-from-attribute multiply (UPS per-kVA)", () => {
  const UPS: Pipeline = {
    output: ["supply", "install"],
    steps: [
      { step: "match_master_row", params: { kind: "ups_per_kva" } },
      { step: "scale", target: "supply_per_kva", result: "supply", params: { kva_from_attr: "kva" }, formula: "base*kva" },
      { step: "scale", target: "install_per_kva", result: "install", params: { kva_from_attr: "kva" }, formula: "base*kva" },
    ],
  };
  const ITEM: RateMasterItem = { discipline: "Electrical", kind: "ups_per_kva", attributes: { pricing_mode: "PER_KVA" }, rates: { supply_per_kva: 900, install_per_kva: 100 } };

  it("kva=12 -> 900*12 / 100*12 = golden 10800 / 1200", () => {
    expect(runPipeline("ups_boq", UPS, [ITEM], { kva: 12 }).finals).toEqual({ supply: 10800, install: 1200 });
  });
  it("a MISSING kva attribute is an HONEST no-compute (no_match), never zero", () => {
    const r = runPipeline("ups_boq", UPS, [ITEM], {});
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
  it("a NON-NUMERIC kva attribute is an HONEST no-compute", () => {
    const r = runPipeline("ups_boq", UPS, [ITEM], { kva: "twelve" });
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
});

describe("EA-1 (3) match_master_row on the stored-vs-selected intersection", () => {
  const PL: Pipeline = { output: ["supply"], steps: [
    { step: "match_master_row", params: { kind: "ups_per_kva" } },
    { step: "scale", target: "supply_per_kva", result: "supply", params: { kva_from_attr: "kva" }, formula: "base*kva" },
  ] };
  const ITEM: RateMasterItem = { discipline: "Electrical", kind: "ups_per_kva", attributes: { pricing_mode: "PER_KVA" }, rates: { supply_per_kva: 900, install_per_kva: 100 } };

  it("a row carrying only pricing_mode matches a kva-only selection (key not on the row is ignored)", () => {
    expect(runPipeline("ups_boq", PL, [ITEM], { kva: 5 }).finals).toEqual({ supply: 4500 });
  });
  it("an OVERLAPPING key that conflicts blocks the match (exact match where keys overlap)", () => {
    const r = runPipeline("ups_boq", PL, [ITEM], { kva: 5, pricing_mode: "PER_UNIT" });
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
});

describe("EA-1 (4) conditional component (earthing chamber adder)", () => {
  const EARTH: Pipeline = {
    output: ["supply", "install"],
    steps: [
      { step: "match_master_row", params: { kind: "earthing_item" } },
      { step: "component", name: "base_supply", target: "supply_base", formula: "base" },
      { step: "component", name: "chamber", conditions: [
        { when: { with_chamber: "With" }, params: { adder: 3000 } },
        { when: { with_chamber: "Without" }, params: { adder: 0 } },
      ], formula: "adder" },
      { step: "sum_components", result: "supply" },
      { step: "scale", target: "supply", result: "supply", params: { markup: 0.45 }, formula: "base*(1+markup)" },
      { step: "scale", target: "install_base", result: "install", params: { markup: 0.45 }, formula: "base*(1+markup)" },
    ],
  };
  const ITEM: RateMasterItem = { discipline: "Electrical", kind: "earthing_item", attributes: { material: "GI", type: "50 x 6 MM Earth Strip" }, rates: { supply_base: 235, install_base: 55 } };
  const s = (chamber: string) => ({ material: "GI", type: "50 x 6 MM Earth Strip", with_chamber: chamber });

  it("with_chamber=Without -> (235+0)*1.45 = golden 340.75 / 79.75", () => {
    expect(runPipeline("earthing_boq", EARTH, [ITEM], s("Without")).finals).toEqual({ supply: 340.75, install: 79.75 });
  });
  it("with_chamber=With -> (235+3000)*1.45 = golden 4690.75 / 79.75", () => {
    expect(runPipeline("earthing_boq", EARTH, [ITEM], s("With")).finals).toEqual({ supply: 4690.75, install: 79.75 });
  });
  it("an unmatched with_chamber is an HONEST no-compute (no_match) -- NEVER a zero-adder default", () => {
    const r = runPipeline("earthing_boq", EARTH, [ITEM], s("Maybe"));
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
});
