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
      { step: "scale", target: "supply_per_mtr", result: "supply_per_mtr", params: { runs_from_attr: "runs" }, formula: "base*runs" },
      {
        step: "scale",
        target: "install_base_per_mtr",
        result: "install_per_mtr",
        params: { install_markup: 1.0 },
        formula: "base*(1+install_markup)",
      },
      { step: "roundup", target: "install_per_mtr", params: { digits: 0 } },
      { step: "scale", target: "install_per_mtr", result: "install_per_mtr", params: { runs_from_attr: "runs" }, formula: "base*runs" },
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
      { step: "scale", target: "supply_per_set", result: "supply_per_set", params: { runs_from_attr: "runs" }, formula: "base*runs" },
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
      { step: "scale", target: "bcs_supply_per_mtr", result: "bcs_supply_per_mtr", params: { runs_from_attr: "runs" }, formula: "base*runs" },
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
  // ext-b: the g5 combo, previously unpinned here (real RM-1 rates, read from the live master)
  cable("COPPER", "UNARMOURED", 3.0, 10.0, 1037.0, 20.0),
  term("COPPER", "UNARMOURED", 3.0, 10.0, 12.85, 91.81, 388.97),
];

const sel = (material: string, insulation: string, core: number, th: number, runs = 1) => ({ material, insulation, core, thickness_sqmm: th, runs });

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
  // ext-b PIN: g5 was the ONE stored golden this file never pinned. Added so the five-golden
  // invariance proof has all five here, not four.
  it("COPPER/UNARMOURED/3C/10.0 -> cable 630/40, BCS 469 (g5)", () => {
    const a = sel("COPPER", "UNARMOURED", 3.0, 10.0);
    expect(runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, a).finals).toEqual({ supply_per_mtr: 630, install_per_mtr: 40 });
    expect(runPipeline("cable_bcs", PIPELINES.cable_bcs, ITEMS, a).finals).toEqual({ bcs_supply_per_mtr: 469 });
  });
});

// ext-b: the cable-runs multiplier. These are MECHANISM tests, NOT stored goldens -- the guiding
// sheet has no runs concept (recon D7 measured 0 hits against a working control), so a multi-run
// value has no sheet basis and multi-run GOLDENS are owed from the owner.
describe("ext-b runs multiplier", () => {
  it("runs defaults to 1 and every golden is byte-identical (the C2 invariance proof)", () => {
    // g1 with runs omitted entirely vs runs explicitly 1 -- and both equal to the stored golden
    const omitted = { material: "COPPER", insulation: "UNARMOURED", core: 1.0, thickness_sqmm: 6.0, runs: 1 };
    expect(runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, omitted).finals).toEqual({ supply_per_mtr: 120, install_per_mtr: 20 });
    expect(runPipeline("termination_boq", PIPELINES.termination_boq, ITEMS, omitted).finals).toEqual({ supply_per_set: 80, install_per_set: 20 });
    expect(runPipeline("cable_bcs", PIPELINES.cable_bcs, ITEMS, omitted).finals).toEqual({ bcs_supply_per_mtr: 87 });
  });

  it("runs=3 multiplies each cable output exactly 3x", () => {
    const a = sel("COPPER", "UNARMOURED", 1.0, 6.0, 3);
    // 120*3 and 20*3 -- the multiplier attaches AFTER each roundup, so it scales a rounded rate
    expect(runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, a).finals).toEqual({ supply_per_mtr: 360, install_per_mtr: 60 });
    expect(runPipeline("cable_bcs", PIPELINES.cable_bcs, ITEMS, a).finals).toEqual({ bcs_supply_per_mtr: 261 });
  });

  it("termination install INHERITS runs and is never squared (owner ruling 2026-08-05)", () => {
    const a = sel("COPPER", "UNARMOURED", 1.0, 6.0, 3);
    const r = runPipeline("termination_boq", PIPELINES.termination_boq, ITEMS, a);
    // supply 80*3 = 240; install_as_ratio then takes 25% of the ALREADY-multiplied supply -> 60.
    // There is deliberately NO second multiplier on install: 20*3*3 = 180 would be the R^2 bug.
    expect(r.finals).toEqual({ supply_per_set: 240, install_per_set: 60 });
    expect(r.finals.install_per_set).not.toBe(180);
  });

  it("a MISSING runs attribute is an HONEST no-compute, never a zero default", () => {
    const noRuns = { material: "COPPER", insulation: "UNARMOURED", core: 1.0, thickness_sqmm: 6.0 };
    const r = runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, noRuns);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
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

// EA-DIFF Option C: runPipeline's "never throws on data shape" contract is ENFORCED. The exact defect
// that crashed the db_switchgear Derivation tab + the pricing helper -- a `scale` step carrying
// `conditions` (a shape `scale` does not bind, only `component` does), so its formula references an
// unbound identifier -- must degrade to the honest `unsupported` status, NEVER throw to the error
// boundary. A well-formed pipeline is unaffected.
describe("EA-DIFF Option C: a data-shape formula error degrades to unsupported, never throws", () => {
  it("a scale carrying conditions (unbound identifier) -> unsupported, no throw", () => {
    const pl: Pipeline = {
      output: ["install"],
      steps: [
        { step: "match_master_row", params: { kind: "cable" } },
        // `effective_multiplier` / `install_ratio` live inside conditions[].params -- the `scale`
        // handler binds ONLY top-level params, so the formula references unbound identifiers.
        {
          step: "scale",
          target: "list_price_per_mtr",
          result: "install",
          formula: "base*effective_multiplier*install_ratio",
          conditions: [{ when: { material: "COPPER" }, params: { effective_multiplier: 0.5, install_ratio: 0.15 } }],
        } as unknown as Pipeline["steps"][number],
      ],
    };
    let r: ReturnType<typeof runPipeline> | undefined;
    expect(() => { r = runPipeline("db_like", pl, ITEMS, sel("COPPER", "UNARMOURED", 1.0, 6.0)); }).not.toThrow();
    expect(r!.status).toBe("unsupported");
    expect(r!.finals).toEqual({});
    expect(r!.steps.some((s) => s.unsupported && /could not be evaluated/i.test(s.label))).toBe(true);
  });

  it("a well-formed pipeline is unaffected (still computes ok)", () => {
    const r = runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, sel("COPPER", "UNARMOURED", 1.0, 6.0));
    expect(r.status).toBe("ok");
    expect(r.finals).toEqual({ supply_per_mtr: 120, install_per_mtr: 20 });
  });
});

// ── EA-1: the four bounded vocabulary additions (each with an HONEST failure mode) ──────────────────
// The FIVE wiring goldens above are the regression pins for all four; these fixtures are the real
// E-ALL config shapes (eall_import_electrical_v2.json) reduced to the row(s) each golden needs.

// EA-2b: the CORRECTED cable-tray config (v7). The old single `tray_boq` pipeline (golden 280/60,
// install = supply x0.2, cover via component_band) was WRONG and is DELETED. The real config is FOUR
// pipelines (supply / install / bcs / bcs_install) using conditional `component` adders (cover /
// ceiling-accessories 106 / refill 180 / cutting 200) + a width-table install match (kind
// tray_install_rate, x4). These are the oracle-backed goldens t1/t2/t3 (t1 = the guiding block's
// displayed state), pinned independently of the config-data goldens.
describe("EA-2b corrected cable-tray config (4 pipelines, oracle goldens t1/t2/t3)", () => {
  const cond = (attr: string, yes: Record<string, number>, no: Record<string, number>, vy = "Yes", vn = "No") => [
    { when: { [attr]: vy }, params: yes },
    { when: { [attr]: vn }, params: no },
  ];
  const PIPELINES: Record<string, Pipeline> = {
    tray_boq_supply: {
      output: ["supply_per_rmt"],
      steps: [
        { step: "match_master_row", params: { kind: "cable_tray" } },
        { step: "component", name: "base", target: "without_cover_list", params: {}, formula: "base" },
        { step: "component", name: "cover", target: "cover_only_list", conditions: cond("cover", { factor: 1.0 }, { factor: 0.0 }), formula: "base*factor" },
        { step: "component", name: "ceiling_accessories", conditions: cond("installation_type", { accessories_per_mtr: 106.0 }, { accessories_per_mtr: 0.0 }, "Ceiling", "Floor"), formula: "accessories_per_mtr" },
        { step: "component", name: "floor_refilling", conditions: cond("floor_refilling", { refill_rate: 180.0 }, { refill_rate: 0.0 }), formula: "refill_rate" },
        { step: "sum_components", result: "supply_per_rmt" },
        { step: "scale", target: "supply_per_rmt", result: "supply_per_rmt", params: { markup: 0.45 }, formula: "base*(1+markup)" },
        { step: "roundup", target: "supply_per_rmt", params: { digits: 0 } },
      ],
    },
    tray_boq_install: {
      output: ["install_per_rmt"],
      steps: [
        { step: "match_master_row", params: { kind: "tray_install_rate" } },
        { step: "component", name: "width_install", target: "install_rate", params: { per_run_factor: 4.0 }, formula: "base*per_run_factor" },
        { step: "component", name: "floor_cutting", conditions: cond("floor_cutting", { cutting_rate: 200.0, markup: 0.45 }, { cutting_rate: 0.0, markup: 0.45 }), formula: "cutting_rate*(1+markup)" },
        { step: "sum_components", result: "install_per_rmt" },
      ],
    },
    tray_bcs: {
      output: ["bcs_supply"],
      steps: [
        { step: "match_master_row", params: { kind: "cable_tray" } },
        { step: "component", name: "base", target: "without_cover_list", params: {}, formula: "base" },
        { step: "component", name: "cover", target: "cover_only_list", conditions: cond("cover", { factor: 1.0 }, { factor: 0.0 }), formula: "base*factor" },
        { step: "component", name: "ceiling_accessories", conditions: cond("installation_type", { accessories_per_mtr: 106.0 }, { accessories_per_mtr: 0.0 }, "Ceiling", "Floor"), formula: "accessories_per_mtr" },
        { step: "component", name: "floor_refilling", conditions: cond("floor_refilling", { refill_rate: 180.0 }, { refill_rate: 0.0 }), formula: "refill_rate" },
        { step: "sum_components", result: "bcs_supply" },
      ],
    },
    tray_bcs_install: {
      output: ["bcs_install"],
      steps: [
        { step: "match_master_row", params: { kind: "cable_tray" } },
        { step: "component", name: "bcs_cutting", conditions: cond("floor_cutting", { cutting_rate: 200.0 }, { cutting_rate: 0.0 }), formula: "cutting_rate" },
        { step: "sum_components", result: "bcs_install" },
      ],
    },
  };
  const TRAY_ROW: RateMasterItem = { discipline: "Electrical", kind: "cable_tray", attributes: { tray_type: "Perforated", material: "GI", thickness_mm: 1.6, width_mm: 100 }, rates: { without_cover_list: 180, cover_only_list: 117, with_cover_list: 297 } };
  const INSTALL_ROW: RateMasterItem = { discipline: "Electrical", kind: "tray_install_rate", attributes: { width_mm: 100 }, rates: { install_rate: 30 } };
  const ITEMS = [TRAY_ROW, INSTALL_ROW];
  const sel = (o: Record<string, string | number> = {}) => ({
    tray_type: "Perforated", material: "GI", thickness_mm: 1.6, width_mm: 100,
    cover: "Yes", installation_type: "Floor", floor_cutting: "No", floor_refilling: "No", ...o,
  });

  it("t1 (cover Yes / Floor / no cut / no refill) -> supply 431, install 120, bcs 297, bcs_install 0", () => {
    const s = sel();
    expect(runPipeline("tray_boq_supply", PIPELINES.tray_boq_supply, ITEMS, s).finals).toEqual({ supply_per_rmt: 431 });
    expect(runPipeline("tray_boq_install", PIPELINES.tray_boq_install, ITEMS, s).finals).toEqual({ install_per_rmt: 120 });
    expect(runPipeline("tray_bcs", PIPELINES.tray_bcs, ITEMS, s).finals).toEqual({ bcs_supply: 297 });
    expect(runPipeline("tray_bcs_install", PIPELINES.tray_bcs_install, ITEMS, s).finals).toEqual({ bcs_install: 0 });
  });
  it("t2 (cover No / Ceiling) -> supply 415, install 120, bcs 286", () => {
    const s = sel({ cover: "No", installation_type: "Ceiling" });
    expect(runPipeline("tray_boq_supply", PIPELINES.tray_boq_supply, ITEMS, s).finals).toEqual({ supply_per_rmt: 415 });
    expect(runPipeline("tray_boq_install", PIPELINES.tray_boq_install, ITEMS, s).finals).toEqual({ install_per_rmt: 120 });
    expect(runPipeline("tray_bcs", PIPELINES.tray_bcs, ITEMS, s).finals).toEqual({ bcs_supply: 286 });
  });
  it("t3 (cover Yes / Floor / cutting Yes) -> install 410, bcs_install 200", () => {
    const s = sel({ floor_cutting: "Yes" });
    expect(runPipeline("tray_boq_install", PIPELINES.tray_boq_install, ITEMS, s).finals).toEqual({ install_per_rmt: 410 });
    expect(runPipeline("tray_bcs_install", PIPELINES.tray_bcs_install, ITEMS, s).finals).toEqual({ bcs_install: 200 });
  });
  it("a width with no tray_install_rate row -> honest no_match on install (never a zero default)", () => {
    const r = runPipeline("tray_boq_install", PIPELINES.tray_boq_install, ITEMS, sel({ width_mm: 999 }));
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
});

// string-equality component_band is still a supported interpreter feature (no shipped config uses it
// after EA-2b -- the tray moved to conditional `component`); a minimal synthetic pin keeps it covered.
describe("component_band string-equality bands (synthetic, feature pin)", () => {
  const P: Pipeline = {
    output: ["v"],
    steps: [
      { step: "match_master_row", params: { kind: "cable_tray" } },
      { step: "component_band", name: "b", band_on: "cover", bands: [
        { when: "Yes", target: "cover_only_list" },
        { when: "No", target: "without_cover_list" },
      ], params: {}, formula: "base" },
      { step: "sum_components", result: "v" },
    ],
  };
  const ITEM: RateMasterItem = { discipline: "Electrical", kind: "cable_tray", attributes: { tray_type: "Perforated", material: "GI", thickness_mm: 1.6, width_mm: 100 }, rates: { without_cover_list: 180, cover_only_list: 117 } };
  const s = (cover: string) => ({ tray_type: "Perforated", material: "GI", thickness_mm: 1.6, width_mm: 100, cover });
  it("selects the band whose `when` matches the selection exactly", () => {
    expect(runPipeline("x", P, [ITEM], s("Yes")).finals).toEqual({ v: 117 });
    expect(runPipeline("x", P, [ITEM], s("No")).finals).toEqual({ v: 180 });
  });
  it("an unknown band value -> honest no_match, zero finals", () => {
    const r = runPipeline("x", P, [ITEM], s("GOLD_PLATED"));
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

// ── EA-1b: popup_boxes (reuses attr-multiply), self-contained misc, and the HONEST-PARTIAL guard ────

describe("EA-1b popup_boxes (per-module, reuses the value-from-attribute shape)", () => {
  const POPUP: Pipeline = {
    output: ["supply", "install"],
    steps: [
      { step: "match_master_row", params: { kind: "popup_box_module" } },
      { step: "scale", target: "supply_per_module", result: "supply", params: { module_count_from_attr: "module_count" }, formula: "base*module_count" },
      { step: "scale", target: "install_per_module", result: "install", params: { module_count_from_attr: "module_count" }, formula: "base*module_count" },
    ],
  };
  const ITEM: RateMasterItem = { discipline: "Electrical", kind: "popup_box_module", attributes: { pricing_mode: "PER_MODULE" }, rates: { supply_per_module: 900, install_per_module: 100 } };
  it("module_count=12 -> 900*12 / 100*12 = golden 10800 / 1200", () => {
    expect(runPipeline("popup_boq", POPUP, [ITEM], { module_count: 12 }).finals).toEqual({ supply: 10800, install: 1200 });
  });
});

describe("EA-1b self-contained miscellaneous (boq direct; bcs = boq*0.8, install 0) + HONEST PARTIAL", () => {
  const MISC_BOQ: Pipeline = { output: ["supply", "install"], steps: [
    { step: "match_master_row", params: { kind: "misc_item" } },
    { step: "scale", target: "boq_supply", result: "supply", params: { factor: 1.0 }, formula: "base*factor" },
    { step: "scale", target: "boq_install", result: "install", params: { factor: 1.0 }, formula: "base*factor" },
  ] };
  const MISC_BCS: Pipeline = { output: ["bcs_supply", "bcs_install"], steps: [
    { step: "match_master_row", params: { kind: "misc_item" } },
    { step: "scale", target: "boq_supply", result: "bcs_supply", params: { bcs_factor: 0.8 }, formula: "base*bcs_factor" },
    { step: "scale", target: "boq_install", result: "bcs_install", params: { zero: 0.0 }, formula: "base*zero" },
  ] };
  const ITEMS_M: RateMasterItem[] = [
    { discipline: "Electrical", kind: "misc_item", attributes: { description: "Spray Painting" }, rates: { boq_supply: 234, boq_install: 104 } },
    { discipline: "Electrical", kind: "misc_item", attributes: { description: "Glass Box" }, rates: { boq_supply: 2000, boq_install: 500 } },
    { discipline: "Electrical", kind: "misc_item", attributes: { description: "CEIG" }, rates: { boq_supply: null as unknown as number, boq_install: 225000 } },
    { discipline: "Electrical", kind: "misc_item", attributes: { description: "AS Built" }, rates: { boq_supply: 24500, boq_install: null as unknown as number } },
  ];
  const sel = (description: string) => ({ description });

  it("Spray Painting -> BoQ 234/104 AND BCS 187.2/0 (no old x1.3 background-sheet rule)", () => {
    expect(runPipeline("misc_boq", MISC_BOQ, ITEMS_M, sel("Spray Painting")).finals).toEqual({ supply: 234, install: 104 });
    const bcs = runPipeline("misc_bcs", MISC_BCS, ITEMS_M, sel("Spray Painting")).finals;
    expect(bcs.bcs_supply).toBeCloseTo(187.2, 10);
    expect(bcs.bcs_install).toBe(0);
  });
  it("Glass Box -> BoQ 2000/500, BCS 1600/0", () => {
    expect(runPipeline("misc_boq", MISC_BOQ, ITEMS_M, sel("Glass Box")).finals).toEqual({ supply: 2000, install: 500 });
    expect(runPipeline("misc_bcs", MISC_BCS, ITEMS_M, sel("Glass Box")).finals).toEqual({ bcs_supply: 1600, bcs_install: 0 });
  });
  it("CEIG (no supply) computes ONLY install -- supply is ABSENT, never invented 0", () => {
    const r = runPipeline("misc_boq", MISC_BOQ, ITEMS_M, sel("CEIG"));
    expect(r.finals).toEqual({ install: 225000 });      // supply key absent
    expect(r.finals.supply).toBeUndefined();
    expect(r.status).toBe("ok");                          // honest partial, not a crash / no_match
  });
  it("AS Built (no install) computes ONLY supply -- install is ABSENT, never invented 0", () => {
    const r = runPipeline("misc_boq", MISC_BOQ, ITEMS_M, sel("AS Built"));
    expect(r.finals).toEqual({ supply: 24500 });          // install key absent
    expect(r.finals.install).toBeUndefined();
  });
});

// EA-2c (revised): component_ref -- a component whose base comes from a QUALIFIED referenced master
// row (kind + attributes). The busbar adder references the EXISTING "Bus bar" earthing_item row (ONE
// ROW, TWO ROLES: a selectable item AND this adder). Resolution must be UNIQUE (zero OR multiple ->
// honest no-compute). Supersedes the (dead) earth-chamber ruling.
describe("EA-2c component_ref (Bus bar as a qualified referenced row)", () => {
  const BUSBAR_REF = {
    step: "component_ref" as const, name: "busbar",
    ref: { kind: "earthing_item", attributes: { type: "Bus bar" } }, target: "supply_base",
    conditions: [
      { when: { with_busbar: "With" }, params: { factor: 1.0 } },
      { when: { with_busbar: "Without" }, params: { factor: 0.0 } },
    ],
    formula: "base*factor",
  };
  const EARTHING_BOQ: Pipeline = {
    output: ["supply", "install"],
    steps: [
      { step: "match_master_row", params: { kind: "earthing_item" } },
      { step: "component", name: "base_supply", target: "supply_base", params: {}, formula: "base" },
      BUSBAR_REF,
      { step: "sum_components", result: "supply" },
      { step: "scale", target: "supply", result: "supply", params: { markup: 0.45 }, formula: "base*(1+markup)" },
      { step: "scale", target: "install_base", result: "install", params: { markup: 0.45 }, formula: "base*(1+markup)" },
    ],
  };
  const EARTHING_BCS: Pipeline = {
    output: ["bcs_supply"],
    steps: [
      { step: "match_master_row", params: { kind: "earthing_item" } },
      { step: "component", name: "base_supply", target: "supply_base", params: {}, formula: "base" },
      BUSBAR_REF,
      { step: "sum_components", result: "bcs_supply" },
    ],
  };
  const STRIP: RateMasterItem = { discipline: "Electrical", kind: "earthing_item", attributes: { material: "GI", type: "50 x 6 MM Earth Strip" }, rates: { supply_base: 235, install_base: 55 } };
  const BUSBAR: RateMasterItem = { discipline: "Electrical", kind: "earthing_item", attributes: { material: "BUS BAR", type: "Bus bar" }, rates: { supply_base: 3000, install_base: 20 } };
  const ITEMS = [STRIP, BUSBAR];
  const sel = (o: Record<string, string> = {}) => ({ material: "GI", type: "50 x 6 MM Earth Strip", with_busbar: "With", ...o });

  it("e2 (With Bus bar) -> supply 4690.75 / install 79.75 / bcs 3235; the trace NAMES 'Bus bar'", () => {
    const r = runPipeline("earthing_boq", EARTHING_BOQ, ITEMS, sel());
    expect(r.finals).toEqual({ supply: 4690.75, install: 79.75 });
    const refStep = r.steps.find((s) => s.step === "component_ref");
    expect(refStep?.refItem).toBe("Bus bar");
    expect(runPipeline("earthing_bcs", EARTHING_BCS, ITEMS, sel()).finals).toEqual({ bcs_supply: 3235 });
  });
  it("e1 (Without Bus bar) -> supply 340.75 / install 79.75 / bcs 235 (adder 0)", () => {
    expect(runPipeline("earthing_boq", EARTHING_BOQ, ITEMS, sel({ with_busbar: "Without" })).finals).toEqual({ supply: 340.75, install: 79.75 });
    expect(runPipeline("earthing_bcs", EARTHING_BCS, ITEMS, sel({ with_busbar: "Without" })).finals).toEqual({ bcs_supply: 235 });
  });
  it("ONE ROW TWO ROLES: the Bus bar row selected AS the item prices normally (3000*1.45=4350 / 20*1.45=29)", () => {
    const r = runPipeline("earthing_boq", EARTHING_BOQ, ITEMS, { material: "BUS BAR", type: "Bus bar", with_busbar: "Without" });
    expect(r.finals).toEqual({ supply: 4350, install: 29 });
  });
  it("EDIT FLOWS EVERYWHERE: a new Bus bar rate flows into BOTH roles (5415.75 as adder, 5075 as item)", () => {
    const items2 = [STRIP, { ...BUSBAR, rates: { supply_base: 3500, install_base: 20 } }];
    expect(runPipeline("earthing_boq", EARTHING_BOQ, items2, sel()).finals.supply).toBe((235 + 3500) * 1.45); // 5415.75
    expect(runPipeline("earthing_boq", EARTHING_BOQ, items2, { material: "BUS BAR", type: "Bus bar", with_busbar: "Without" }).finals.supply).toBe(3500 * 1.45); // 5075
  });
  it("MISSING ref -> honest no_match (no Bus bar row; never a zero default)", () => {
    const r = runPipeline("earthing_boq", EARTHING_BOQ, [STRIP], sel());
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
  it("AMBIGUOUS ref -> honest no_match (two Bus bar rows; never pick-first)", () => {
    const r = runPipeline("earthing_boq", EARTHING_BOQ, [STRIP, BUSBAR, { ...BUSBAR, rates: { supply_base: 9999, install_base: 20 } }], sel());
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
});

// ---- EA-4a: the ASSEMBLY ENGINE (circuit_fit + component_ref rate_stages x qty) -- point_wiring live ----
// Fixture rates mirror the live v13 masters (cable/conduit from the wiring batch, switch_socket from E-ALL,
// verified 2026-07-30). The interpreter must reproduce the banked oracle pw1 (1869/735/1370) AND the
// mirror-computed pw2 (1823/722.2/1342 -- MS -> 3 circuits; the FRACTIONAL install 722.2 is the regression
// that proves per-STAGE rounding: switch install rounds the supply rate THEN x0.2 unrounded).

const PW_CIRCUIT_FIT = {
  step: "circuit_fit" as const,
  params: {
    sizes: [25, 32, 50],
    usable: { PVC: [0.55, 0.55, 0.55], MS: [0.45, 0.45, 0.47] },
    wire_specs: [["wire1_core", "wire1_thickness_sqmm"], ["wire2_core", "wire2_thickness_sqmm"]] as [string, string][],
    length_attr: "circuit_length_m",
    conduit_type_attr: "conduit_type",
    optional_wire_when_none: "wire2_thickness_sqmm", // EA-4a-r: wire2 may be positively absent
  },
  binds: ["fitted_size", "circuits", "conduit_qty"],
};
type Stage = { mult: number; round?: "up0" | "up-1" };
type Qty = number | { from_attr: string } | { from_fit: string } | { if_attr: Record<string, string | number>; then: number; else: number };
// EA-4a-r: these components are None-able (their ref binds an allow_none attr) -- match the v14 config.
const NONE_ABLE = new Set(["wire2", "switch", "socket", "plate", "back_box"]);
function cref(name: string, ref: Record<string, string | number>, target: string, rate_stages: Stage[], qty: Qty) {
  return { step: "component_ref" as const, name, ref, target, rate_stages, qty, ...(NONE_ABLE.has(name) ? { none_skips: true } : {}) };
}
const wireRef = (core: string, th: string) => ({ kind: "cable", material: "COPPER", insulation: "UNARMOURED", core, thickness_sqmm: th });
const conduitRef = { kind: "conduit", conduit_type: "@conduit_type", size_mm: "@fitted_size" };
const ssRef = (family: string, item: string, colour: string) => ({ kind: "switch_socket_item", family, item, colour });

const PW_PIPELINES: Record<string, Pipeline> = {
  pw_boq_supply: {
    output: ["supply"],
    steps: [
      PW_CIRCUIT_FIT,
      cref("wire1", wireRef("@wire1_core", "@wire1_thickness_sqmm"), "list_price_per_mtr", [{ mult: 0.602, round: "up0" }], { from_attr: "circuit_length_m" }),
      cref("wire2", wireRef("@wire2_core", "@wire2_thickness_sqmm"), "list_price_per_mtr", [{ mult: 0.602, round: "up0" }], { from_attr: "circuit_length_m" }),
      cref("conduit", conduitRef, "list_price_per_mtr", [{ mult: 0.7, round: "up0" }], { from_fit: "conduit_qty" }),
      cref("switch", ssRef("Switch", "@switch_item", "@colour"), "list_price", [{ mult: 0.3625, round: "up0" }], { from_attr: "switch_qty" }),
      cref("socket", ssRef("Socket", "@socket_item", "@colour"), "list_price", [{ mult: 0.3625, round: "up0" }], { from_attr: "socket_qty" }),
      cref("plate", ssRef("Grid and Face Plates", "@plate_item", "@colour"), "list_price", [{ mult: 0.3625, round: "up0" }], { from_attr: "plate_qty" }),
      cref("back_box", ssRef("Back Box", "@plate_item", "NA"), "list_price", [{ mult: 0.3625, round: "up0" }], { if_attr: { back_box: "Yes" }, then: 1, else: 0 }),
      { step: "sum_components", result: "supply" },
    ],
  },
  pw_boq_install: {
    output: ["install"],
    steps: [
      PW_CIRCUIT_FIT,
      cref("wire1", wireRef("@wire1_core", "@wire1_thickness_sqmm"), "install_base_per_mtr", [{ mult: 2.0, round: "up0" }], { from_attr: "circuit_length_m" }),
      cref("wire2", wireRef("@wire2_core", "@wire2_thickness_sqmm"), "install_base_per_mtr", [{ mult: 2.0, round: "up0" }], { from_attr: "circuit_length_m" }),
      cref("conduit", conduitRef, "list_price_per_mtr", [{ mult: 0.7 }, { mult: 0.2, round: "up0" }], { from_fit: "conduit_qty" }),
      cref("switch", ssRef("Switch", "@switch_item", "@colour"), "list_price", [{ mult: 0.3625, round: "up0" }, { mult: 0.2 }], { from_attr: "switch_qty" }),
      cref("socket", ssRef("Socket", "@socket_item", "@colour"), "list_price", [{ mult: 0.0725, round: "up0" }], { from_attr: "socket_qty" }),
      cref("plate", ssRef("Grid and Face Plates", "@plate_item", "@colour"), "list_price", [{ mult: 0.0725, round: "up0" }], { from_attr: "plate_qty" }),
      cref("back_box", ssRef("Back Box", "@plate_item", "NA"), "list_price", [{ mult: 0.0725, round: "up0" }], { if_attr: { back_box: "Yes" }, then: 1, else: 0 }),
      { step: "sum_components", result: "install" },
    ],
  },
  pw_bcs: {
    output: ["bcs_supply"],
    steps: [
      PW_CIRCUIT_FIT,
      cref("wire1", wireRef("@wire1_core", "@wire1_thickness_sqmm"), "list_price_per_mtr", [{ mult: 0.4515, round: "up0" }], { from_attr: "circuit_length_m" }),
      cref("wire2", wireRef("@wire2_core", "@wire2_thickness_sqmm"), "list_price_per_mtr", [{ mult: 0.4515, round: "up0" }], { from_attr: "circuit_length_m" }),
      cref("conduit", conduitRef, "list_price_per_mtr", [{ mult: 0.5, round: "up0" }], { from_fit: "conduit_qty" }),
      cref("switch", ssRef("Switch", "@switch_item", "@colour"), "list_price", [{ mult: 0.25, round: "up0" }], { from_attr: "switch_qty" }),
      cref("socket", ssRef("Socket", "@socket_item", "@colour"), "list_price", [{ mult: 0.25, round: "up0" }], { from_attr: "socket_qty" }),
      cref("plate", ssRef("Grid and Face Plates", "@plate_item", "@colour"), "list_price", [{ mult: 0.25, round: "up0" }], { from_attr: "plate_qty" }),
      cref("back_box", ssRef("Back Box", "@plate_item", "NA"), "list_price", [{ mult: 0.25, round: "up0" }], { if_attr: { back_box: "Yes" }, then: 1, else: 0 }),
      { step: "sum_components", result: "bcs_supply" },
    ],
  },
};

function cbl(core: number, th: number, list: number, install: number): RateMasterItem {
  return { discipline: "Electrical", kind: "cable", attributes: { material: "COPPER", insulation: "UNARMOURED", core, thickness_sqmm: th }, rates: { list_price_per_mtr: list, install_base_per_mtr: install } };
}
function cdt(ct: string, size: number, list: number): RateMasterItem {
  return { discipline: "Electrical", kind: "conduit", attributes: { conduit_type: ct, size_mm: size }, rates: { list_price_per_mtr: list } };
}
function ssItem(family: string, item: string, colour: string, list: number): RateMasterItem {
  return { discipline: "Electrical", kind: "switch_socket_item", attributes: { family, item, colour }, rates: { list_price: list } };
}
const PW_ITEMS: RateMasterItem[] = [
  cbl(1, 2.5, 82.95, 10), cbl(1, 1.5, 50.45, 10),
  cdt("PVC", 25, 60), cdt("MS", 25, 85), cdt("MS", 32, 120), cdt("MS", 50, 240),
  ssItem("Switch", "16A 1 WAY SWITCH- With Indicator", "Grey", 427), ssItem("Switch", "16A 1 WAY SWITCH- With Indicator", "White", 360),
  ssItem("Socket", "6A/16A 3-Pin Socket", "Grey", 514), ssItem("Socket", "6A 3-Pin Socket", "White", 282),
  ssItem("Grid and Face Plates", "3M", "Grey", 235), ssItem("Grid and Face Plates", "3M", "White", 204),
  ssItem("Back Box", "3M", "NA", 158),
];
const PW1: Record<string, string | number> = {
  wire1_core: 1, wire1_thickness_sqmm: 2.5, wire2_core: 1, wire2_thickness_sqmm: 1.5, circuit_length_m: 15,
  conduit_type: "PVC", switch_item: "16A 1 WAY SWITCH- With Indicator", switch_qty: 1, socket_item: "6A/16A 3-Pin Socket",
  socket_qty: 1, plate_item: "3M", plate_qty: 1, colour: "Grey", back_box: "Yes",
};
const PW2: Record<string, string | number> = { ...PW1, conduit_type: "MS", socket_item: "6A 3-Pin Socket", colour: "White", back_box: "No" };
// EA-4a-r: pw3 -- a switch-only light point (socket POSITIVELY ABSENT). socket line -> 0; supply = pw1 - 187.
const PW3: Record<string, string | number> = { ...PW1, socket_item: "None", socket_qty: 0 };
// EA-4a-r: a single-wire point (wire2 positively absent). circuit_fit omits wire2 -> larger circuit count.
const PW_SINGLE_WIRE: Record<string, string | number> = { ...PW1, wire2_thickness_sqmm: "None", wire2_core: "" };

describe("EA-4a assembly engine -- point_wiring goldens", () => {
  it("pw1 (PVC, banked oracle) -> supply 1869 / install 735 / BCS 1370", () => {
    expect(runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, PW1).finals).toEqual({ supply: 1869 });
    expect(runPipeline("pw_boq_install", PW_PIPELINES.pw_boq_install, PW_ITEMS, PW1).finals).toEqual({ install: 735 });
    expect(runPipeline("pw_bcs", PW_PIPELINES.pw_bcs, PW_ITEMS, PW1).finals).toEqual({ bcs_supply: 1370 });
  });
  it("pw2 (MS -> 3 circuits, no back box) -> supply 1823 / install 722.2 / BCS 1342 (fractional install)", () => {
    expect(runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, PW2).finals).toEqual({ supply: 1823 });
    // 722.2 = per-STAGE rounding: switch install = ceil(360*0.3625)=131, then *0.2 UNROUNDED = 26.2
    expect(runPipeline("pw_boq_install", PW_PIPELINES.pw_boq_install, PW_ITEMS, PW2).finals.install).toBeCloseTo(722.2, 6);
    expect(runPipeline("pw_bcs", PW_PIPELINES.pw_bcs, PW_ITEMS, PW2).finals).toEqual({ bcs_supply: 1342 });
  });
  it("per-component supply trace matches the banked oracle line values", () => {
    const r = runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, PW1);
    const line = (name: string) => r.steps.find((s) => s.produced?.key === name)?.produced?.value;
    expect(line("wire1")).toBe(750);
    expect(line("wire2")).toBe(465);
    expect(line("conduit")).toBe(168); // 42 x 4
    expect(line("switch")).toBe(155);
    expect(line("socket")).toBe(187);
    expect(line("plate")).toBe(86);
    expect(line("back_box")).toBe(58);
  });
  it("circuit_fit binds fitted_size / circuits / conduit_qty (PVC -> 25mm, 4 circuits, qty 4; MS -> 3, qty 5)", () => {
    const fit = (attrs: Record<string, string | number>) =>
      runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, attrs).steps[0].matchedCondition ?? "";
    expect(fit(PW1)).toContain("25mm");
    expect(fit(PW1)).toContain("4 circuits");
    expect(fit(PW1)).toContain("conduit qty 4");
    expect(fit(PW2)).toContain("3 circuits");
    expect(fit(PW2)).toContain("conduit qty 5");
  });
});

// ---- point_wiring RUNS: the tripwire pins. Written against the UNCHANGED interpreter and proven
// GREEN first, then updated in the same slice so the diff shows exactly what circuit_fit did before.
describe("point_wiring runs -- circuit_fit wire_specs arity", () => {
  const withRuns = (specs: unknown) => ({
    ...PW_CIRCUIT_FIT,
    params: { ...PW_CIRCUIT_FIT.params, wire_specs: specs as [string, string][] },
  });
  const pipeWith = (specs: unknown) => ({
    output: ["supply"],
    steps: [withRuns(specs), ...PW_PIPELINES.pw_boq_supply.steps.slice(1)],
  }) as Pipeline;

  const TRIPLE = [["wire1_core", "wire1_thickness_sqmm", "wire1_runs"], ["wire2_core", "wire2_thickness_sqmm", "wire2_runs"]];

  it("AFTER: the THIRD wire_specs element drives the conduit geometry (runs x cores)", () => {
    // BEFORE this slice the third element was SILENTLY DISCARDED and this fit was identical to runs=1.
    const one = runPipeline("pw_boq_supply", pipeWith(TRIPLE), PW_ITEMS, { ...PW1, wire1_runs: 1, wire2_runs: 1 });
    const three = runPipeline("pw_boq_supply", pipeWith(TRIPLE), PW_ITEMS, { ...PW1, wire1_runs: 3, wire2_runs: 1 });
    expect(one.steps[0].matchedCondition).not.toBe(three.steps[0].matchedCondition);
    // runs=1: dia = sqrt(2.5/PI)*2 + sqrt(1.5/PI)*2 = 3.166 -> 25mm (usable 13.75), 4 circuits, qty 4.
    expect(one.steps[0].matchedCondition).toContain("25mm");
    expect(one.steps[0].matchedCondition).toContain("4 circuits");
    expect(one.steps[0].matchedCondition).toContain("conduit qty 4");
    // wire1 at 3 runs TRIPLES its strand contribution: dia = 1.784*3 + 1.382 = 6.734. Still inside a
    // 25mm conduit (13.75 usable), but only 2 circuits fit -> the conduit QUANTITY doubles to 8.
    // The size does NOT have to change for runs to bite; circuits/qty are the load-bearing outputs.
    expect(three.steps[0].matchedCondition).toContain("dia 6.734");
    expect(three.steps[0].matchedCondition).toContain("2 circuits");
    expect(three.steps[0].matchedCondition).toContain("conduit qty 8");
  });

  it("ABSENT MEANS 1 -- a 2-tuple is byte-identical to a 3-tuple whose runs attr is 1", () => {
    // This is what keeps every shipped config (all 2-tuples) unchanged. Backward compatibility.
    const pair = runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, PW1);
    const triple = runPipeline("pw_boq_supply", pipeWith(TRIPLE), PW_ITEMS, { ...PW1, wire1_runs: 1, wire2_runs: 1 });
    expect(triple.steps[0].matchedCondition).toBe(pair.steps[0].matchedCondition);
    expect(triple.finals).toEqual(pair.finals);
  });

  it("ABSENT MEANS 1 -- a 3-tuple whose runs attr is MISSING entirely still computes pw1", () => {
    // The runs attribute is simply not on the selection. It must resolve to 1, NOT no-compute.
    const r = runPipeline("pw_boq_supply", pipeWith(TRIPLE), PW_ITEMS, PW1);
    expect(r.status).not.toBe("no_match");
    expect(r.finals).toEqual({ supply: 1869 });
  });

  it("a 2-tuple wire_specs computes pw1 (the shape every shipped config uses)", () => {
    const r = runPipeline("pw_boq_supply", pipeWith(PW_CIRCUIT_FIT.params.wire_specs), PW_ITEMS, PW1);
    expect(r.finals).toEqual({ supply: 1869 });
  });
});

describe("point_wiring runs -- rate stage mult_from_attr", () => {
  const stageWith = (extra: Record<string, unknown>) => ({
    output: ["supply"],
    steps: [
      PW_CIRCUIT_FIT,
      cref("wire1", wireRef("@wire1_core", "@wire1_thickness_sqmm"), "list_price_per_mtr",
           [{ mult: 0.602, round: "up0", ...extra } as never], { from_attr: "circuit_length_m" }),
      { step: "sum_components", result: "supply" },
    ],
  }) as Pipeline;

  it("x runs happens BEFORE the stage rounding (owner ruling), on the EXISTING stage", () => {
    // wire1 list 82.95: base*0.602 = 49.93 -> ceil 50 -> x15 = 750 at runs 1.
    // At runs 3 the ruling is ceil(82.95*0.602*3) = ceil(149.81) = 150 -> x15 = 2250.
    // Rounding FIRST would give 50*3 = 150 too here, so the case is deliberately checked at a
    // fractional boundary below where the two orders DIVERGE.
    const one = runPipeline("p", stageWith({ mult_from_attr: "wire1_runs" }), PW_ITEMS, { ...PW1, wire1_runs: 1 });
    expect(one.steps.find((s) => s.produced?.key === "wire1")?.produced?.value).toBe(750);
    const three = runPipeline("p", stageWith({ mult_from_attr: "wire1_runs" }), PW_ITEMS, { ...PW1, wire1_runs: 3 });
    expect(three.steps.find((s) => s.produced?.key === "wire1")?.produced?.value).toBe(2250);
  });

  it("multiply-then-round DIFFERS from round-then-multiply, and we do multiply-then-round", () => {
    // wire2 list 50.45 at 0.602 = 30.37. ceil = 31; x2 = 62.  Multiply first: ceil(30.37*2)=ceil(60.74)=61.
    // 61 != 62, so this case actually discriminates the two orders.
    const p = {
      output: ["supply"],
      steps: [
        PW_CIRCUIT_FIT,
        cref("wire2", wireRef("@wire2_core", "@wire2_thickness_sqmm"), "list_price_per_mtr",
             [{ mult: 0.602, round: "up0", mult_from_attr: "wire2_runs" } as never], 1),
        { step: "sum_components", result: "supply" },
      ],
    } as Pipeline;
    const r = runPipeline("p", p, PW_ITEMS, { ...PW1, wire2_runs: 2 });
    expect(r.steps.find((s) => s.produced?.key === "wire2")?.produced?.value).toBe(61); // NOT 62
  });

  it("ABSENT MEANS 1 -- a stage with no mult_from_attr, and one whose attr is missing, both unchanged", () => {
    const plain = runPipeline("p", stageWith({}), PW_ITEMS, PW1);
    const bound = runPipeline("p", stageWith({ mult_from_attr: "wire1_runs" }), PW_ITEMS, PW1); // attr absent
    expect(bound.finals).toEqual(plain.finals);
    expect(bound.status).not.toBe("no_match");
  });
});

describe("EA-4a-r None mechanism -- positive absence (None) vs blank (unknown)", () => {
  it("pw3 switch-only light point (socket=None) -> supply 1682; the socket line is an explicit 'None -> 0'", () => {
    const r = runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, PW3);
    expect(r.finals).toEqual({ supply: 1682 }); // pw1 1869 - the 187 socket line
    const socket = r.steps.find((s) => s.produced?.key === "socket");
    expect(socket?.produced?.value).toBe(0);
    expect(socket?.matchedCondition).toBe("None -> 0");
    // the real components are untouched (switch/plate/back_box still priced)
    const line = (name: string) => r.steps.find((s) => s.produced?.key === name)?.produced?.value;
    expect(line("switch")).toBe(155);
    expect(line("plate")).toBe(86);
    expect(line("back_box")).toBe(58);
  });

  it("pw1 is UNCHANGED by the None flags (they never trigger when every component is real) -- regression", () => {
    expect(runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, PW1).finals).toEqual({ supply: 1869 });
    expect(runPipeline("pw_boq_install", PW_PIPELINES.pw_boq_install, PW_ITEMS, PW1).finals).toEqual({ install: 735 });
    expect(runPipeline("pw_bcs", PW_PIPELINES.pw_bcs, PW_ITEMS, PW1).finals).toEqual({ bcs_supply: 1370 });
  });

  it("a single-wire point (wire2=None) fits on wire1 ALONE -> more circuits, wire2 line 0, supply 1362", () => {
    const r = runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, PW_SINGLE_WIRE);
    // circuit_fit drops wire2 from the dia: overall_dia ~1.784 (vs pw1's 3.166) -> 7 circuits, conduit qty 3
    expect(r.steps[0].matchedCondition).toContain("7 circuits");
    expect(r.steps[0].matchedCondition).toContain("conduit qty 3");
    const line = (name: string) => r.steps.find((s) => s.produced?.key === name)?.produced?.value;
    expect(line("wire2")).toBe(0);
    expect(line("wire1")).toBe(750); // 50 x 15
    expect(line("conduit")).toBe(126); // 42 x 3
    // wire1 750 + wire2 0 + conduit 126 + switch 155 + socket 187 + plate 86 + back_box 58
    expect(r.finals).toEqual({ supply: 1362 });
  });

  it("plate=None zeroes BOTH plate AND back_box (back_box binds @plate_item) -- the keyed dependency", () => {
    const attrs = { ...PW1, plate_item: "None", plate_qty: 0 };
    const r = runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, attrs);
    const line = (name: string) => r.steps.find((s) => s.produced?.key === name)?.produced?.value;
    expect(line("plate")).toBe(0);
    expect(line("back_box")).toBe(0);
    expect(r.finals).toEqual({ supply: 1869 - 86 - 58 }); // 1725
  });

  it("a None on a NON-none_skips component stays an HONEST no-compute (positive absence needs the flag)", () => {
    // a one-step pipeline whose component_ref has NO none_skips; feeding its identity "None" must NOT zero --
    // there is no master row for item "None", so it is an honest no_match (never a silent 0).
    const plainRef = { step: "component_ref" as const, name: "adder", ref: ssRef("Switch", "@switch_item", "@colour"), target: "list_price", rate_stages: [{ mult: 1 }], qty: 1 };
    const pipe: Pipeline = { output: ["x"], steps: [plainRef, { step: "sum_components", result: "x" }] };
    const r = runPipeline("plain", pipe, PW_ITEMS, { ...PW1, switch_item: "None" });
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
});

describe("EA-4a assembly engine -- HONEST no-compute negatives", () => {
  it("MISSING referenced row (no MS conduit) -> honest no_match, zero finals", () => {
    const items = PW_ITEMS.filter((it) => !(it.kind === "conduit" && it.attributes.conduit_type === "MS"));
    const r = runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, items, PW2);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
  it("null @attr (socket_item cleared) -> honest missing-attr no_match, never a guess", () => {
    const attrs = { ...PW1, socket_item: null as unknown as string };
    const r = runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, attrs);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
  it("unknown conduit_type -> circuit_fit honest no_match", () => {
    const r = runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, { ...PW1, conduit_type: "XLPE" });
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
  it("missing wire attr -> circuit_fit honest no_match (never a zero-diameter default)", () => {
    const r = runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, { ...PW1, wire1_thickness_sqmm: 0 });
    expect(r.status).toBe("no_match");
  });
  it("MALFORMED circuit_fit (usable missing every conduit_type) -> Option-C never-throws (no_match, no crash)", () => {
    const broken: Pipeline = {
      output: ["supply"],
      steps: [{ ...PW_CIRCUIT_FIT, params: { ...PW_CIRCUIT_FIT.params, usable: {} } }, { step: "sum_components", result: "supply" }],
    };
    expect(() => runPipeline("pw_boq_supply", broken, PW_ITEMS, PW1)).not.toThrow();
    expect(runPipeline("pw_boq_supply", broken, PW_ITEMS, PW1).status).toBe("no_match");
  });
});

// ---- EA-4b: switches_point (6-line assembly) + industrial_sockets (paired-MCB, interlocked/None) ----
const swRef = (name: string, family: string, itemAttr: string, qtyAttr: string, colour: string, ifBack = false) => ({
  step: "component_ref" as const, name, ref: { kind: "switch_socket_item", family, item: itemAttr, colour }, target: "list_price",
  rate_stages: [{ mult: 1 }], qty: ifBack ? { if_attr: { back_box: "Yes" }, then: 1, else: 0 } : { from_attr: qtyAttr }, none_skips: true,
});
const SWPT_LINES = [
  swRef("switch", "Switch", "@switch_item", "switch_qty", "@colour"),
  swRef("socket1", "Socket", "@socket1_item", "socket1_qty", "@colour"),
  swRef("socket2", "Socket", "@socket2_item", "socket2_qty", "@colour"),
  swRef("blank", "Switch", "@blank_item", "blank_qty", "@colour"),
  swRef("plate", "Grid and Face Plates", "@plate_item", "plate_qty", "@colour"),
  swRef("back_box", "Back Box", "@plate_item", "", "NA", true),
];
const SWPT_SUPPLY: Pipeline = { output: ["supply"], steps: [...SWPT_LINES, { step: "sum_components", result: "supply" }, { step: "scale", target: "supply", result: "supply", params: { m: 0.3625 }, formula: "base*m" }, { step: "roundup", target: "supply", params: { digits: -1 } }] };
const SWPT_INSTALL: Pipeline = { output: ["install"], steps: [...SWPT_LINES, { step: "sum_components", result: "supply" }, { step: "scale", target: "supply", result: "supply", params: { m: 0.3625 }, formula: "base*m" }, { step: "roundup", target: "supply", params: { digits: -1 } }, { step: "scale", target: "supply", result: "install", params: { m: 0.2 }, formula: "base*m" }, { step: "roundup", target: "install", params: { digits: -1 } }] };
const SWPT_BCS: Pipeline = { output: ["bcs_supply"], steps: [...SWPT_LINES, { step: "sum_components", result: "bcs_supply" }, { step: "scale", target: "bcs_supply", result: "bcs_supply", params: { m: 0.25 }, formula: "base*m" }, { step: "roundup", target: "bcs_supply", params: { digits: -1 } }] };
const SWI: RateMasterItem[] = [
  ssItem("Switch", "16A 1 WAY SWITCH- With Indicator", "White", 360), ssItem("Socket", "6A/16A 3-Pin Socket", "White", 425),
  ssItem("Socket", "USB Charger - C+C Type", "White", 2283), ssItem("Switch", "1M Blanker", "White", 61),
  ssItem("Grid and Face Plates", "6M", "White", 302), ssItem("Back Box", "6M", "NA", 247),
];
const SP1 = { switch_item: "16A 1 WAY SWITCH- With Indicator", switch_qty: 2, socket1_item: "6A/16A 3-Pin Socket", socket1_qty: 1, socket2_item: "USB Charger - C+C Type", socket2_qty: 2, blank_item: "1M Blanker", blank_qty: 2, plate_item: "6M", plate_qty: 1, colour: "White", back_box: "Yes" };

const INDSOCK_BOQ: Pipeline = { output: ["supply"], steps: [
  { step: "component_ref", name: "socket", ref: { kind: "industrial_socket", item: "@item", enclosure: "@enclosure", rating: "@rating", pole: "@pole" }, target: "list_price", rate_stages: [{ mult: 0.98, round: "up0" }], qty: 1 },
  { step: "component_ref", name: "paired_mcb", ref: { kind: "db_switchgear_item", family: "Switchgear", item: "@paired_mcb" }, target: "list_price", rate_stages: [{ mult: 0.495, round: "up0" }], qty: { if_attr: { item: "Industrial Socket with Socket Outlet Interlocked" }, then: 0, else: 1 }, none_skips: true },
  { step: "sum_components", result: "supply" },
] };
const INDSOCK_INSTALL: Pipeline = { output: ["install"], steps: [...INDSOCK_BOQ.steps, { step: "scale", target: "supply", result: "install", params: { m: 0.35 }, formula: "base*m" }, { step: "roundup", target: "install", params: { digits: -1 } }] };
const II: RateMasterItem[] = [
  { discipline: "Electrical", kind: "industrial_socket", attributes: { item: "Plug + Socket in Enclosure Box", enclosure: "IP44/54 - Splash Proof", rating: "16/20A", pole: "3 Pin / 2P+E" }, rates: { list_price: 2240 } },
  { discipline: "Electrical", kind: "industrial_socket", attributes: { item: "Industrial Socket with Socket Outlet Interlocked", enclosure: "IP44/54 - Splash Proof", rating: "16/20A", pole: "3 Pin / 2P+E" }, rates: { list_price: 10520 } },
  { discipline: "Electrical", kind: "db_switchgear_item", attributes: { family: "Switchgear", item: "6A SP MCB C CURVE" }, rates: { list_price: 449 } },
];
const IBASE = { enclosure: "IP44/54 - Splash Proof", rating: "16/20A", pole: "3 Pin / 2P+E" };

describe("EA-4b switches_point (6-line assembly)", () => {
  it("sp1 (White items) -> supply 2320 / install 470 / BCS 1600", () => {
    expect(runPipeline("s", SWPT_SUPPLY, SWI, SP1).finals).toEqual({ supply: 2320 });
    expect(runPipeline("i", SWPT_INSTALL, SWI, SP1).finals).toEqual({ install: 470 });
    expect(runPipeline("b", SWPT_BCS, SWI, SP1).finals).toEqual({ bcs_supply: 1600 });
  });
  it("socket2=None -> its line 0 (a switch-only-ish point still prices)", () => {
    const r = runPipeline("s", SWPT_SUPPLY, SWI, { ...SP1, socket2_item: "None", socket2_qty: 0 });
    expect(r.status).toBe("ok");
    expect(r.steps.find((x) => x.produced?.key === "socket2")?.produced?.value).toBe(0);
    // supply drops by the socket2 line (USB 2283x2=4566 raw): (6382-4566)*0.3625=658.3 -> 660
    expect(r.finals).toEqual({ supply: 660 });
  });
  it("plate=None greys+zeroes plate AND back_box (keyed @plate_item)", () => {
    const r = runPipeline("s", SWPT_SUPPLY, SWI, { ...SP1, plate_item: "None", plate_qty: 0 });
    expect(r.steps.find((x) => x.produced?.key === "plate")?.produced?.value).toBe(0);
    expect(r.steps.find((x) => x.produced?.key === "back_box")?.produced?.value).toBe(0);
  });
});

// ---- SLICE 1a: switches_sockets rebuilt as a per-component composite ----
//
// It was `matching_mode: "item_identity"`, which routed it to the identity prompt whose
// composite-refusal clause made the model return null for every assembly row (48/48 blank at
// confidence 0.9). It now carries the SAME six-line shape as the switches_point template, under the
// switches_sockets id. ROUNDING is the pre-existing switches_sockets convention and is owner-ruled:
// sum the RAW component lines, multiply ONCE, roundup to TENS -- NOT point_wiring's per-component UNIT
// rounding, which its own notes record as "INTENTIONAL, per the sheet". The two are deliberately
// different; adopting units here would silently reprice every live row.
//
// The one structural difference from SWPT: `swsock_boq` emits supply AND install from ONE pipeline
// (switches_point splits them), which is what keeps the pre-rebuild golden `s1`'s expect-shape intact.
const SS_BOQ: Pipeline = { output: ["supply", "install"], steps: [...SWPT_LINES,
  { step: "sum_components", result: "supply" },
  { step: "scale", target: "supply", result: "supply", params: { m: 0.3625 }, formula: "base*m" },
  { step: "roundup", target: "supply", params: { digits: -1 } },
  { step: "scale", target: "supply", result: "install", params: { m: 0.2 }, formula: "base*m" },
  { step: "roundup", target: "install", params: { digits: -1 } },
] };
const SS_BCS: Pipeline = { output: ["bcs_supply"], steps: [...SWPT_LINES,
  { step: "sum_components", result: "bcs_supply" },
  { step: "scale", target: "bcs_supply", result: "bcs_supply", params: { m: 0.25 }, formula: "base*m" },
  { step: "roundup", target: "bcs_supply", params: { digits: -1 } },
] };
// the six REAL catalog rows these goldens price (list prices read from the live master, 2026-08-06)
const SS_ITEMS: RateMasterItem[] = [
  ssItem("Switch", "16A 1 WAY SWITCH", "White", 258), ssItem("Socket", "6A/16A 3-Pin Socket", "White", 425),
  ssItem("Socket", "6A 3-Pin Socket", "White", 282), ssItem("Switch", "1M Blanker", "White", 61),
  ssItem("Grid and Face Plates", "6M", "White", 302), ssItem("Back Box", "6M", "NA", 247),
];
const SS1 = { switch_item: "16A 1 WAY SWITCH", switch_qty: 1, socket1_item: "6A/16A 3-Pin Socket", socket1_qty: 1,
  socket2_item: "6A 3-Pin Socket", socket2_qty: 2, blank_item: "1M Blanker", blank_qty: 2,
  plate_item: "6M", plate_qty: 1, colour: "White", back_box: "Yes" };
// s1 re-stated: ONE socket, every other component POSITIVELY ABSENT ("None", not blank)
const S1 = { switch_item: "None", switch_qty: 0, socket1_item: "6A 3-Pin Socket", socket1_qty: 1,
  socket2_item: "None", socket2_qty: 0, blank_item: "None", blank_qty: 0,
  plate_item: "None", plate_qty: 0, colour: "White", back_box: "No" };

describe("SLICE 1a switches_sockets composite (tens rounding, two socket slots)", () => {
  it("ss1 composite -> supply 700 / install 140 / BCS 480 (raw 1918, derived from catalog prices)", () => {
    // 258x1 + 425x1 + 282x2 + 61x2 + 302x1 + 247x1 = 1918
    // 1918 x0.3625 = 695.275 -> tens 700 ; 700 x0.2 = 140 -> tens 140 ; 1918 x0.25 = 479.5 -> tens 480
    expect(runPipeline("swsock_boq", SS_BOQ, SS_ITEMS, SS1).finals).toEqual({ supply: 700, install: 140 });
    expect(runPipeline("swsock_bcs", SS_BCS, SS_ITEMS, SS1).finals).toEqual({ bcs_supply: 480 });
  });

  it("BOTH socket slots contribute -- a row naming two distinct socket types is expressible", () => {
    const r = runPipeline("swsock_boq", SS_BOQ, SS_ITEMS, SS1);
    expect(r.steps.find((x) => x.produced?.key === "socket1")?.produced?.value).toBe(425);
    expect(r.steps.find((x) => x.produced?.key === "socket2")?.produced?.value).toBe(564); // 282 x 2
  });

  it("s1 re-stated as a lone socket is UNMOVED -> 110 / 30 / 80 (the backwards-compat pin)", () => {
    // raw 282 x0.3625 = 102.225 -> tens 110 ; 110 x0.2 = 22 -> tens 30 ; 282 x0.25 = 70.5 -> tens 80
    expect(runPipeline("swsock_boq", SS_BOQ, SS_ITEMS, S1).finals).toEqual({ supply: 110, install: 30 });
    expect(runPipeline("swsock_bcs", SS_BCS, SS_ITEMS, S1).finals).toEqual({ bcs_supply: 80 });
  });

  it("NEGATIVE: socket2=None is an ABSENCE, not a zero-priced line -- the row still prices", () => {
    const r = runPipeline("swsock_boq", SS_BOQ, SS_ITEMS, { ...SS1, socket2_item: "None", socket2_qty: 0 });
    expect(r.status).toBe("ok");
    expect(r.steps.find((x) => x.produced?.key === "socket2")?.produced?.value).toBe(0);
    // (1918 - 564) x 0.3625 = 490.825 -> tens 500
    expect(r.finals).toEqual({ supply: 500, install: 100 });
  });

  it("NEGATIVE: plate=None zeroes the back box too (it is keyed @plate_item)", () => {
    const r = runPipeline("swsock_boq", SS_BOQ, SS_ITEMS, { ...SS1, plate_item: "None", plate_qty: 0 });
    expect(r.steps.find((x) => x.produced?.key === "plate")?.produced?.value).toBe(0);
    expect(r.steps.find((x) => x.produced?.key === "back_box")?.produced?.value).toBe(0);
  });

  it("NEGATIVE (F2): a stated-but-unmatchable item is an honest no-compute, never a silent zero", () => {
    // rows 243/249/251 name a "6A SP Switch"; no 6A switch exists in the catalog. A null/unknown
    // @attr is NOT the "None" sentinel -- None means positively absent, this means unresolved.
    const r = runPipeline("swsock_boq", SS_BOQ, SS_ITEMS, { ...SS1, switch_item: "6A SP SWITCH" });
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
});

describe("EA-4b industrial_sockets paired-MCB (None default / interlocked)", () => {
  it("socket-only (paired_mcb='None' -- the extraction default) -> MCB line 0 -> supply 2196 / install 770", () => {
    const attrs = { ...IBASE, item: "Plug + Socket in Enclosure Box", paired_mcb: "None" };
    expect(runPipeline("i", INDSOCK_BOQ, II, attrs).finals).toEqual({ supply: 2196 });
    expect(runPipeline("j", INDSOCK_INSTALL, II, attrs).finals.install).toBe(770);
    const r = runPipeline("i", INDSOCK_BOQ, II, attrs);
    expect(r.steps.find((x) => x.produced?.key === "paired_mcb")?.produced?.value).toBe(0);
  });
  it("non-interlocked WITH a paired MCB -> socket 2196 + MCB 223 = 2419", () => {
    const r = runPipeline("i", INDSOCK_BOQ, II, { ...IBASE, item: "Plug + Socket in Enclosure Box", paired_mcb: "6A SP MCB C CURVE" });
    expect(r.finals).toEqual({ supply: 2419 });
    expect(r.steps.find((x) => x.produced?.key === "paired_mcb")?.produced?.value).toBe(223);
  });
  it("INTERLOCKED socket -> MCB line 0 via the if_attr gate (even with a paired MCB set)", () => {
    const r = runPipeline("i", INDSOCK_BOQ, II, { ...IBASE, item: "Industrial Socket with Socket Outlet Interlocked", paired_mcb: "6A SP MCB C CURVE" });
    expect(r.steps.find((x) => x.produced?.key === "paired_mcb")?.produced?.value).toBe(0);
    expect(r.finals).toEqual({ supply: 10310 }); // 10520*0.98=10309.6 -> ceil 10310
  });
  it("absent paired_mcb (no default) stays an HONEST no_match -- absent=unknown, not None", () => {
    const r = runPipeline("i", INDSOCK_BOQ, II, { ...IBASE, item: "Plug + Socket in Enclosure Box" });
    expect(r.status).toBe("no_match");
  });
});

// ---- EA-4c: the DB build-up + lookup_or_ratio (the sheet's exact IFERROR three-way install) ----
// Shell is a None-able slot too (MCB-only is a REAL product -- the sheet's IF(J9=0) branch), so ALL
// seven component_refs carry none_skips. Supply/BCS are existing vocabulary; the install ends in ONE
// lookup_or_ratio step: shell absent -> supply x0.15; shell in the install table -> table x1.5; shell
// present but not in the table -> supply x0.15 fallback (the IFERROR).
const dbcRef = (name: string, kind: string, itemAttr: string, target: string, qtyAttr: string, family?: string) => ({
  step: "component_ref" as const, name, ref: family ? { kind, item: itemAttr, family } : { kind, item: itemAttr },
  target, rate_stages: [{ mult: 1 }], qty: { from_attr: qtyAttr }, none_skips: true,
});
const DBC_LINES = [
  dbcRef("db_shell", "db_shell", "@db_shell_item", "shell_rate", "db_shell_qty"),
  dbcRef("mcb1", "db_switchgear_item", "@mcb1_item", "list_price", "mcb1_qty", "Switchgear"),
  dbcRef("mcb2", "db_switchgear_item", "@mcb2_item", "list_price", "mcb2_qty", "Switchgear"),
  dbcRef("mcb3", "db_switchgear_item", "@mcb3_item", "list_price", "mcb3_qty", "Switchgear"),
  dbcRef("mcb4", "db_switchgear_item", "@mcb4_item", "list_price", "mcb4_qty", "Switchgear"),
  dbcRef("mcb5", "db_switchgear_item", "@mcb5_item", "list_price", "mcb5_qty", "Switchgear"),
  dbcRef("enclosure", "db_switchgear_item", "@enclosure_item", "list_price", "enclosure_qty", "Enclosure Box"),
];
const LOR = { // the lookup_or_ratio install step (verbatim shape from the v16c asset)
  step: "lookup_or_ratio" as const, result: "install",
  lookup: { kind: "db_install_rate", item: "@db_shell_item", target: "install_rate", mult: 1.5 },
  ratio: { of: "supply", mult: 0.15 },
  when_shell_absent: { attr: "db_shell_item", equals: "None", use: "ratio" as const }, round: -1,
};
const DBC_SUPPLY: Pipeline = { output: ["supply"], steps: [...DBC_LINES, { step: "sum_components", result: "supply" }, { step: "scale", target: "supply", result: "supply", params: { m: 0.495 }, formula: "base*m" }, { step: "roundup", target: "supply", params: { digits: -1 } }] };
const DBC_INSTALL: Pipeline = { output: ["install"], steps: [...DBC_SUPPLY.steps, LOR] };
const DBC_BCS: Pipeline = { output: ["bcs_supply"], steps: [...DBC_LINES, { step: "sum_components", result: "bcs_supply" }, { step: "scale", target: "bcs_supply", result: "bcs_supply", params: { m: 0.3 }, formula: "base*m" }, { step: "roundup", target: "bcs_supply", params: { digits: -1 } }] };
const DBC_ITEMS: RateMasterItem[] = [
  { discipline: "Electrical", kind: "db_shell", attributes: { item: "VTPN DB 6WAY WITH MCB INCOMER" }, rates: { shell_rate: 19215 } }, // NOT in the install table -> fallback
  { discipline: "Electrical", kind: "db_shell", attributes: { item: "TPN DB 8WAY (DOUBLE DOOR IP 43)" }, rates: { shell_rate: 10593 } },
  { discipline: "Electrical", kind: "db_install_rate", attributes: { item: "TPN DB 8WAY (DOUBLE DOOR IP 43)" }, rates: { install_rate: 1000 } }, // the SPN/TPN install table
  { discipline: "Electrical", kind: "db_shell", attributes: { item: "TPN DB 6WAY (DOUBLE DOOR IP 43)" }, rates: { shell_rate: 8841 } }, // EA-4d dbu4
  { discipline: "Electrical", kind: "db_install_rate", attributes: { item: "TPN DB 6WAY (DOUBLE DOOR IP 43)" }, rates: { install_rate: 850 } }, // 850*1.5=1275 (NOT a multiple of 10 -> exposes the rounding)
  { discipline: "Electrical", kind: "db_switchgear_item", attributes: { family: "Switchgear", item: "63A FP MCB D CURVE" }, rates: { list_price: 4010 } },
  { discipline: "Electrical", kind: "db_switchgear_item", attributes: { family: "Switchgear", item: "100A FP MCCB" }, rates: { list_price: 17950 } },
  { discipline: "Electrical", kind: "db_switchgear_item", attributes: { family: "Switchgear", item: "63A FP MCB C CURVE" }, rates: { list_price: 4012 } },
];
const DBU1_C = { db_shell_item: "VTPN DB 6WAY WITH MCB INCOMER", db_shell_qty: 1, mcb1_item: "63A FP MCB D CURVE", mcb1_qty: 1, mcb2_item: "100A FP MCCB", mcb2_qty: 1, mcb3_item: "63A FP MCB C CURVE", mcb3_qty: 2, mcb4_item: "None", mcb5_item: "None", enclosure_item: "None" };
const DBU2_C = { db_shell_item: "TPN DB 8WAY (DOUBLE DOOR IP 43)", db_shell_qty: 1, mcb1_item: "63A FP MCB C CURVE", mcb1_qty: 4, mcb2_item: "None", mcb3_item: "None", mcb4_item: "None", mcb5_item: "None", enclosure_item: "None" };
const DBU3_C = { db_shell_item: "None", mcb1_item: "63A FP MCB C CURVE", mcb1_qty: 12, mcb2_item: "None", mcb3_item: "None", mcb4_item: "None", mcb5_item: "None", enclosure_item: "None" };
const instTrace = (r: ReturnType<typeof runPipeline>) => r.steps.find((x) => x.step === "lookup_or_ratio")?.matchedCondition ?? "";

describe("EA-4c DB build-up + lookup_or_ratio (the sheet's IFERROR three-way install)", () => {
  it("dbu1 VTPN FALLBACK -> 24360 / 3660 / 14760 (shell present, NOT in table -> supply x0.15)", () => {
    expect(runPipeline("s", DBC_SUPPLY, DBC_ITEMS, DBU1_C).finals).toEqual({ supply: 24360 });
    const ri = runPipeline("i", DBC_INSTALL, DBC_ITEMS, DBU1_C);
    expect(ri.finals).toEqual({ install: 3660 }); // 24360*0.15=3654 -> 3660
    expect(instTrace(ri)).toContain("fallback"); // VTPN not in the install table
    expect(runPipeline("b", DBC_BCS, DBC_ITEMS, DBU1_C).finals).toEqual({ bcs_supply: 14760 });
  });
  it("dbu2 TABLE-HIT -> supply 13190 / install 1500 / bcs 8000 (TPN 8WAY in the install table x1.5)", () => {
    expect(runPipeline("s", DBC_SUPPLY, DBC_ITEMS, DBU2_C).finals).toEqual({ supply: 13190 }); // (10593+4012*4)*0.495=13187.3 -> 13190
    const ri = runPipeline("i", DBC_INSTALL, DBC_ITEMS, DBU2_C);
    expect(ri.finals).toEqual({ install: 1500 }); // install_rate 1000 x1.5 = 1500
    expect(instTrace(ri)).toContain("table-hit");
    expect(runPipeline("b", DBC_BCS, DBC_ITEMS, DBU2_C).finals).toEqual({ bcs_supply: 8000 });
  });
  it("dbu3 MCB-ONLY (shell None) -> supply 23840 / install 3580 / bcs 14450 (the IF(J9=0) absent branch)", () => {
    expect(runPipeline("s", DBC_SUPPLY, DBC_ITEMS, DBU3_C).finals).toEqual({ supply: 23840 }); // 4012*12*0.495=23831.28 -> 23840
    const ri = runPipeline("i", DBC_INSTALL, DBC_ITEMS, DBU3_C);
    expect(ri.finals).toEqual({ install: 3580 }); // shell absent -> 23840*0.15=3576 -> 3580
    expect(instTrace(ri)).toContain("shell absent");
    expect(runPipeline("b", DBC_BCS, DBC_ITEMS, DBU3_C).finals).toEqual({ bcs_supply: 14450 });
  });
  it("mcb3=None drops its line (five-slot None), supply recomputes", () => {
    const r = runPipeline("s", DBC_SUPPLY, DBC_ITEMS, { ...DBU1_C, mcb3_item: "None", mcb3_qty: 0 });
    expect(r.steps.find((x) => x.produced?.key === "mcb3")?.produced?.value).toBe(0);
    expect(r.finals).toEqual({ supply: 20390 }); // (49199-8024)*0.495=20381.6 -> 20390
  });
  it("NEGATIVE: lookup_or_ratio whose ratio.of source is not computed -> HONEST no_match", () => {
    // an install-only pipeline (no supply steps) in the shell-absent branch -> ctx.supply is undefined
    const INSTALL_ONLY: Pipeline = { output: ["install"], steps: [LOR] };
    const r = runPipeline("i", INSTALL_ONLY, DBC_ITEMS, DBU3_C);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });
  it("NEGATIVE (Option C): a MALFORMED lookup_or_ratio (no ratio) NEVER throws -> unsupported", () => {
    const BAD: Pipeline = { output: ["install"], steps: [{ step: "lookup_or_ratio", result: "install", when_shell_absent: { attr: "db_shell_item", equals: "None" } } as unknown as import("./rateMasterTypes").PipelineStep] };
    let r: ReturnType<typeof runPipeline> | undefined;
    expect(() => { r = runPipeline("i", BAD, DBC_ITEMS, DBU3_C); }).not.toThrow();
    expect(r!.status).toBe("unsupported");
  });
});

// ---- EA-4d: the round_lookup / round_ratio SPLIT (raw-cell fidelity fix) ----------------------------
// The sheet's install three-way rounds the table-hit and the ratio branches DIFFERENTLY: the install-table
// hit is UNROUNDED (`VLOOKUP*1.5`), while the shell-absent + IFERROR-fallback ratio branches ROUNDUP tens.
// The v17 step carries round_lookup: null (table-hit unrounded) + round_ratio: -1 (ratio branches tens),
// replacing the old single round: -1 that OVER-ROUNDED the table-hit (TPN-6WAY 1275 -> 1280, the drift).
const LOR_V17 = {
  step: "lookup_or_ratio" as const, result: "install",
  lookup: { kind: "db_install_rate", item: "@db_shell_item", target: "install_rate", mult: 1.5 },
  ratio: { of: "supply", mult: 0.15 },
  when_shell_absent: { attr: "db_shell_item", equals: "None", use: "ratio" as const },
  round_lookup: null, round_ratio: -1,
};
const DBC_INSTALL_V17: Pipeline = { output: ["install"], steps: [...DBC_SUPPLY.steps, LOR_V17] };
const DBU4_C = { db_shell_item: "TPN DB 6WAY (DOUBLE DOOR IP 43)", db_shell_qty: 1, mcb1_item: "63A FP MCB C CURVE", mcb1_qty: 2, mcb2_item: "None", mcb3_item: "None", mcb4_item: "None", mcb5_item: "None", enclosure_item: "None" };

describe("EA-4d lookup_or_ratio round split (table-hit UNROUNDED, ratio branches tens)", () => {
  it("dbu4 TPN-6WAY table-hit -> install 1275 UNROUNDED (round_lookup: null; the sheet-fidelity fix)", () => {
    const ri = runPipeline("i", DBC_INSTALL_V17, DBC_ITEMS, DBU4_C);
    expect(ri.finals).toEqual({ install: 1275 }); // 850*1.5=1275, NOT rounded to 1280
    expect(instTrace(ri)).toContain("table-hit");
    expect(instTrace(ri)).toContain("no roundup");
  });
  it("dbu2 TPN-8WAY table-hit -> 1500 (lands on a ten; unrounded == rounded here)", () => {
    expect(runPipeline("i", DBC_INSTALL_V17, DBC_ITEMS, DBU2_C).finals).toEqual({ install: 1500 });
  });
  it("dbu1 VTPN fallback -> 3660 (round_ratio: -1 still rounds the ratio branch to tens)", () => {
    const ri = runPipeline("i", DBC_INSTALL_V17, DBC_ITEMS, DBU1_C);
    expect(ri.finals).toEqual({ install: 3660 }); // 24360*0.15=3654 -> 3660
    expect(instTrace(ri)).toContain("fallback");
  });
  it("dbu3 shell-None -> 3580 (round_ratio: -1 rounds the shell-absent branch to tens)", () => {
    const ri = runPipeline("i", DBC_INSTALL_V17, DBC_ITEMS, DBU3_C);
    expect(ri.finals).toEqual({ install: 3580 }); // 23840*0.15=3576 -> 3580
    expect(instTrace(ri)).toContain("shell absent");
  });
  it("BACKWARDS-COMPAT: the legacy single round: -1 STILL rounds the table-hit (1275 -> 1280, the old drift)", () => {
    // DBC_INSTALL uses the legacy LOR (round: -1); it over-rounds the table-hit, proving the old path is intact.
    expect(runPipeline("i", DBC_INSTALL, DBC_ITEMS, DBU4_C).finals).toEqual({ install: 1280 });
  });
});
