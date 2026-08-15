// RM-2 interpreter tests -- the FOUR RM-1 goldens as standing fixtures, plus a
// no-match case and an unknown-step case. Raw master rates are the real RM-1
// values (extracted 2026-07-28); the interpreter must reproduce the goldens EXACTLY.

import { describe, it, expect } from "vitest";
import type { Pipeline, RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import {
  NONE_SENTINEL,
  buildModuleLadder,
  catalogFitOutcomes,
  derivedAttrOutcomes,
  evalFormula,
  fitModuleLadder,
  matchMasterRow,
  moduleFitOutcome,
  moduleSizesFromLabel,
  roundUp,
  runAllPipelines,
  runPipeline,
  stepFactor,
} from "./ratePipelineInterpreter";
import { STEP_VOCABULARY, blankStep, coerceForMatch } from "./rateMasterStructure";
import { derivedQtyAttrs, derivedQtyValue } from "./RateMasterDerivation";

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
      // RULING 2 (2026-08-09): cable INSTALL steps in threes. This fixture claims to be the stored
      // config VERBATIM and the goldens run through it, so it MUST carry the divisor the shipped
      // asset carries -- a fixture that says "verbatim" and drifts is a quiet lie, and the next
      // reader would reasonably trust it to describe production. SUPPLY (line above) and both BCS
      // pipelines keep the LINEAR shape, which is equally the shipped truth.
      { step: "scale", target: "install_per_mtr", result: "install_per_mtr", params: { runs_from_attr: "runs", runs_step_divisor: 3 }, formula: "base*runs" },
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

  it("runs=3 multiplies SUPPLY and BCS by 3, and INSTALL by ceil(3/3) = 1 (RULING 2)", () => {
    const a = sel("COPPER", "UNARMOURED", 1.0, 6.0, 3);
    // The multiplier still attaches AFTER each roundup, so it scales a ROUNDED rate -- unchanged.
    // What changed is the FACTOR on install alone: three runs is three times the wire and three
    // times the BCS, but ONE unit of labour. 120*3 = 360 supply; install stays at its 1x rate of 20.
    // Before Ruling 2 this line read `install_per_mtr: 60` -- that 60 IS the excessive install rate.
    expect(runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, a).finals).toEqual({ supply_per_mtr: 360, install_per_mtr: 20 });
    expect(runPipeline("cable_bcs", PIPELINES.cable_bcs, ITEMS, a).finals).toEqual({ bcs_supply_per_mtr: 261 });
  });

  it("runs=4 crosses the first rung: supply x4, install x2 -- the shape live data cannot show", () => {
    // Live data tops out at 3 runs, so this is the ONLY place the ladder's SHAPE is visible at all.
    const a = sel("COPPER", "UNARMOURED", 1.0, 6.0, 4);
    expect(runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, a).finals).toEqual({ supply_per_mtr: 480, install_per_mtr: 40 });
    expect(runPipeline("cable_bcs", PIPELINES.cable_bcs, ITEMS, a).finals).toEqual({ bcs_supply_per_mtr: 348 });
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
const NONE_ABLE = new Set(["wire2", "switch", "socket", "blank", "plate", "back_box"]);
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

// ---- PW-FIX: THE ACCESSORY-FREE POINT (production row 198's shape) -------------------------------
// A light point wired straight to an MCB carries no switch, no socket, no plate and no blanker. That
// is a REAL and COMMON product, not a data error -- but the module_fit weighted sum is 0 for it, and
// the `occupied <= 0` guard bailed the WHOLE pipeline, discarding a circuit_fit that had already
// succeeded. Wire and conduit have nothing to do with module counts.
//
// These pins were written against the UNCHANGED interpreter and proven GREEN first, then updated in
// the same slice, so the diff shows exactly what the interpreter did before and after.
//
// The fixtures above (EA-4a) predate module_fit and key the back box off the PLATE label. This is the
// LIVE v23 shape: circuit_fit -> module_fit -> components, with the back box keyed on the module_fit
// BOX ladder (@box_item) -- the shorter ladder, which is why the label can never simply be copied.
const PW_MODULE_FIT = {
  step: "module_fit" as const,
  params: {
    terms: [
      { attr: "socket_qty", weight: 2, none_when: "socket_item" },
      { attr: "switch_qty", weight: 1, none_when: "switch_item" },
    ],
    ladders: [
      { kind: "switch_socket_item", where: { family: "Grid and Face Plates" }, bind: "plate_item", floor_from: "plate_item", on_none: "none" },
      { kind: "switch_socket_item", where: { family: "Back Box" }, bind: "box_item", floor_from: "plate_item", on_none: "computed" },
    ],
    blanks: { bind: "blank_count", from_ladder: "plate_item" },
  },
};
const PW_MF_SUPPLY: Pipeline = {
  output: ["supply"],
  steps: [
    PW_CIRCUIT_FIT,
    PW_MODULE_FIT,
    cref("wire1", wireRef("@wire1_core", "@wire1_thickness_sqmm"), "list_price_per_mtr", [{ mult: 0.602, round: "up0" }], { from_attr: "circuit_length_m" }),
    cref("wire2", wireRef("@wire2_core", "@wire2_thickness_sqmm"), "list_price_per_mtr", [{ mult: 0.602, round: "up0" }], { from_attr: "circuit_length_m" }),
    cref("conduit", conduitRef, "list_price_per_mtr", [{ mult: 0.7, round: "up0" }], { from_fit: "conduit_qty" }),
    cref("switch", ssRef("Switch", "@switch_item", "@colour"), "list_price", [{ mult: 0.3625, round: "up0" }], { from_attr: "switch_qty" }),
    cref("socket", ssRef("Socket", "@socket_item", "@colour"), "list_price", [{ mult: 0.3625, round: "up0" }], { from_attr: "socket_qty" }),
    cref("blank", ssRef("Switch", "@blank_item", "@colour"), "list_price", [{ mult: 0.3625, round: "up0" }], { from_fit: "blank_count" }),
    cref("plate", ssRef("Grid and Face Plates", "@plate_item", "@colour"), "list_price", [{ mult: 0.3625, round: "up0" }], { from_attr: "plate_qty" }),
    cref("back_box", ssRef("Back Box", "@box_item", "NA"), "list_price", [{ mult: 0.3625, round: "up0" }], { if_attr: { back_box: "Yes" }, then: 1, else: 0 }),
    { step: "sum_components", result: "supply" },
  ],
};
// The real catalog row for row 198's wire1 (COPPER/UNARMOURED 3C x 1.5): list 166, install base 12.
const PW198_ITEMS: RateMasterItem[] = [...PW_ITEMS, cbl(3, 1.5, 166, 12)];
// Production BOQ-26-00019 / '12 Internal Works ' row 198, VERBATIM as extracted -- every accessory
// positively absent ("None"), every qty a default the extraction filled in.
const PW_ROW198: Record<string, string | number> = {
  wire1_core: 3, wire1_runs: 1, wire1_thickness_sqmm: 1.5,
  wire2_core: 1, wire2_runs: 1, wire2_thickness_sqmm: 1.5,
  circuit_length_m: 15, conduit_type: "PVC",
  switch_item: "None", switch_qty: 1,
  socket_item: "None", socket_qty: 1,
  blank_item: "None", blank_qty: 1,
  plate_item: "None", plate_qty: 1,
  colour: "White", back_box: "Yes",
};
const mfTrace = (r: ReturnType<typeof runPipeline>) =>
  r.steps.find((s) => s.step === "module_fit")?.matchedCondition ?? "";
const lineOf = (r: ReturnType<typeof runPipeline>, name: string) =>
  r.steps.find((s) => s.produced?.key === name)?.produced?.value;

describe("PW-FIX: a ZERO module count yields no plate / no box / no blanks, and NEVER kills the pipeline", () => {
  it("row 198 PRICES: circuit_fit's result survives, wire + conduit price normally", () => {
    const r = runPipeline("pw_boq_supply", PW_MF_SUPPLY, PW198_ITEMS, PW_ROW198);
    expect(r.status).toBe("ok");
    // circuit_fit did its work and is NO LONGER discarded
    expect(r.steps[0].matchedCondition).toContain("25mm");
    expect(r.steps[0].matchedCondition).toContain("2 circuits");
    expect(r.steps[0].matchedCondition).toContain("conduit qty 8");
    // wire1 = ceil(166 x 0.602) = 100 x 15 = 1500; wire2 = ceil(50.45 x 0.602) = 31 x 15 = 465
    expect(lineOf(r, "wire1")).toBe(1500);
    expect(lineOf(r, "wire2")).toBe(465);
    // conduit = ceil(60 x 0.7) = 42 x 8 = 336
    expect(lineOf(r, "conduit")).toBe(336);
    expect(r.finals).toEqual({ supply: 2301 });
  });

  it("NO plate, NO box, NO blanks -- each an EXPLICIT ZERO line, never a manufactured plate", () => {
    const r = runPipeline("pw_boq_supply", PW_MF_SUPPLY, PW198_ITEMS, PW_ROW198);
    expect(lineOf(r, "plate")).toBe(0);
    expect(lineOf(r, "back_box")).toBe(0);
    expect(lineOf(r, "blank")).toBe(0);
    // the smallest plate/box in the catalog must NOT have been fitted
    expect(mfTrace(r)).not.toContain("3M");
    expect(mfTrace(r)).not.toContain("1M & 2M");
  });

  it("THE TRACE SAYS SO -- silence would be worse than the bail it replaced", () => {
    const r = runPipeline("pw_boq_supply", PW_MF_SUPPLY, PW198_ITEMS, PW_ROW198);
    expect(mfTrace(r)).toBe(
      "2 x socket_qty(None) + 1 x switch_qty(None) = 0 modules -> " +
        "no plate_item (nothing to fit), no box_item (nothing to fit); no plate -> 0 blanks",
    );
  });

  it("blank_count binds ZERO (not unbound) -- a from_fit blank line can never abort the row", () => {
    const r = runPipeline("m", { output: ["blank_count"], steps: [PW_MODULE_FIT] }, PW198_ITEMS, PW_ROW198);
    expect(r.status).toBe("ok");
    expect(r.finals).toEqual({ blank_count: 0 });
  });

  it("NEGATIVE is still refused -- a contradiction in the source data is not a product", () => {
    const r = runPipeline("m", { output: [], steps: [PW_MODULE_FIT] }, PW198_ITEMS, {
      ...PW_ROW198, socket_item: "6A 3-Pin Socket", socket_qty: -2,
    });
    expect(r.status).toBe("no_match");
    expect(r.steps[r.steps.length - 1].label).toContain("not a valid count");
  });

  it("a POSITIVE count is byte-unchanged -- pw1 still fits a 3M plate and a 3M box", () => {
    const r = runPipeline("pw_boq_supply", PW_MF_SUPPLY, PW198_ITEMS, { ...PW1, blank_item: "None" });
    expect(r.status).toBe("ok");
    expect(mfTrace(r)).toContain("= 3 modules");
    expect(mfTrace(r)).toContain("plate_item 3M");
    expect(mfTrace(r)).toContain("box_item 3M");
  });
});

// ---- RULING 1 (owner 2026-08-09): THE ZERO-MODULE BACK-BOX FALLBACK, **STATE A ONLY** -------------
// A light point on an MCB has no switch and no socket, so the module count is 0, so nothing fits any
// ladder and the box was suppressed with the plate. But a light point still needs a junction box.
//
// The three pins that matter are the two NEGATIVES either side of the positive: the fallback must not
// fire when the key is absent (additivity), and it must not fire on STATE B -- a "None" plate with a
// NON-ZERO count, which `on_none: "computed"` already boxes correctly and which the fallback would
// DOWNGRADE. The PW-FIX block above is itself the strongest additivity pin: it asserts the zero-module
// trace string VERBATIM against ladders carrying no `on_zero_modules`, and it must stay green.
const PW_MODULE_FIT_ZERO3 = {
  step: "module_fit" as const,
  params: {
    ...PW_MODULE_FIT.params,
    ladders: [
      // the PLATE ladder deliberately does NOT declare it: with nothing on it there is no plate
      PW_MODULE_FIT.params.ladders[0],
      { ...PW_MODULE_FIT.params.ladders[1], on_zero_modules: 3 },
    ],
  },
};
const pwZeroPipe = (mf: unknown): Pipeline => ({
  output: ["supply"],
  steps: PW_MF_SUPPLY.steps.map((s) => ((s as { step: string }).step === "module_fit" ? mf : s)) as Pipeline["steps"],
});

describe("RULING 1 -- a ZERO module count with a declared fallback fits a 3M back box (STATE A)", () => {
  it("row 198's shape now prices a 3M BOX -- and still no plate and no blanks", () => {
    const r = runPipeline("pw_boq_supply", pwZeroPipe(PW_MODULE_FIT_ZERO3), PW198_ITEMS, PW_ROW198);
    expect(r.status).toBe("ok");
    // ceil(158 x 0.3625) = ceil(57.275) = 58, qty 1 (back_box "Yes")
    expect(lineOf(r, "back_box")).toBe(58);
    expect(lineOf(r, "plate")).toBe(0);
    expect(lineOf(r, "blank")).toBe(0);
    // 2301 (the PW-FIX total) + the 58 box line
    expect(r.finals).toEqual({ supply: 2359 });
  });

  it("THE TRACE SAYS SO -- the default is named, not silently applied", () => {
    const r = runPipeline("pw_boq_supply", pwZeroPipe(PW_MODULE_FIT_ZERO3), PW198_ITEMS, PW_ROW198);
    expect(mfTrace(r)).toBe(
      "2 x socket_qty(None) + 1 x switch_qty(None) = 0 modules -> " +
        "no plate_item (nothing to fit), box_item 3M (nothing to fit -- default 3); no plate -> 0 blanks",
    );
  });

  it("NEGATIVE -- back_box 'No' still prices NO box (the component's own qty gate, not a second one)", () => {
    const r = runPipeline("pw_boq_supply", pwZeroPipe(PW_MODULE_FIT_ZERO3), PW198_ITEMS, { ...PW_ROW198, back_box: "No" });
    expect(r.status).toBe("ok");
    expect(lineOf(r, "back_box")).toBe(0);
    expect(r.finals).toEqual({ supply: 2301 });
  });

  it("NEGATIVE (additivity) -- the SAME row with no `on_zero_modules` is byte-identical to PW-FIX", () => {
    const withKey = runPipeline("pw_boq_supply", pwZeroPipe(PW_MODULE_FIT), PW198_ITEMS, PW_ROW198);
    expect(withKey.finals).toEqual({ supply: 2301 });
    expect(lineOf(withKey, "back_box")).toBe(0);
    expect(mfTrace(withKey)).toContain("no box_item (nothing to fit)");
  });

  it("NEGATIVE (STATE B) -- a 'None' plate with a NON-ZERO count is UNTOUCHED by the fallback", () => {
    // 1 socket (2) + 1 switch (1) = 3 modules, plate "None". `on_none: "computed"` fits the box on the
    // COMPUTED count. The fallback must not reach here -- if it did, a 7-module row would drop to 3M.
    const stateB = { ...PW1, plate_item: "None", plate_qty: 0, blank_item: "None" };
    const withFallback = runPipeline("pw_boq_supply", pwZeroPipe(PW_MODULE_FIT_ZERO3), PW198_ITEMS, stateB);
    const without = runPipeline("pw_boq_supply", pwZeroPipe(PW_MODULE_FIT), PW198_ITEMS, stateB);
    expect(withFallback.finals).toEqual(without.finals);
    expect(mfTrace(withFallback)).toBe(mfTrace(without));
    expect(mfTrace(withFallback)).toContain("= 3 modules");
    expect(mfTrace(withFallback)).not.toContain("nothing to fit -- default");
  });

  it("NEGATIVE (case a) -- a row WITH a plate is untouched in every respect", () => {
    const plated = { ...PW1, blank_item: "None" };
    const withFallback = runPipeline("pw_boq_supply", pwZeroPipe(PW_MODULE_FIT_ZERO3), PW198_ITEMS, plated);
    const without = runPipeline("pw_boq_supply", pwZeroPipe(PW_MODULE_FIT), PW198_ITEMS, plated);
    expect(withFallback.finals).toEqual(without.finals);
    expect(mfTrace(withFallback)).toBe(mfTrace(without));
  });

  it("the fallback COUNT resolves on the CATALOG ladder -- it is a count, never a label", () => {
    // The fixture catalog carries ONLY a 3M box. Asking for 2 must take the NEXT HIGHER rung (3M) and
    // SAY it did -- which is what proves config names a number and the catalog names the rung.
    const two = { ...PW_MODULE_FIT_ZERO3, params: { ...PW_MODULE_FIT_ZERO3.params,
      ladders: [PW_MODULE_FIT.params.ladders[0], { ...PW_MODULE_FIT.params.ladders[1], on_zero_modules: 2 }] } };
    const r = runPipeline("pw_boq_supply", pwZeroPipe(two), PW198_ITEMS, PW_ROW198);
    expect(r.status).toBe("ok");
    expect(mfTrace(r)).toContain("box_item 3M (nothing to fit -- default 2) (next higher)");
    expect(lineOf(r, "back_box")).toBe(58);
  });

  it("NEGATIVE -- a fallback ABOVE the ladder's top is an HONEST no-compute, never a clamp", () => {
    const huge = { ...PW_MODULE_FIT_ZERO3, params: { ...PW_MODULE_FIT_ZERO3.params,
      ladders: [PW_MODULE_FIT.params.ladders[0], { ...PW_MODULE_FIT.params.ladders[1], on_zero_modules: 99 }] } };
    const r = runPipeline("pw_boq_supply", pwZeroPipe(huge), PW198_ITEMS, PW_ROW198);
    expect(r.status).toBe("no_match");
    expect(r.steps[r.steps.length - 1].label).toContain("exceeds the largest 'box_item'");
  });
});

// ---- RULING 2 (owner 2026-08-09): WIRE INSTALL STEPS IN THREES ------------------------------------
// `ceil(runs / 3)`: 1-3 runs bill one unit of install, 4-6 two, 7-9 three. Three runs of wire is three
// times the WIRE but not three times the LABOUR -- so SUPPLY and BCS keep multiplying LINEARLY and only
// the install multiplier steps.
//
// `ceil(n/3)` was UNREACHABLE in the formula language: the tokenizer accepts `+ - * /` and there is no
// function-call syntax at all (an identifier followed by `(` throws). Hence a new capability rather
// than a config edit -- and hence the additivity pins below, which are what make it safe to ship.
describe("RULING 2 -- stepFactor, the ONE definition of the step function", () => {
  it("the divisor is CONFIG: absent / non-finite / <= 0 is the IDENTITY (this is the additivity)", () => {
    for (const raw of [1, 2, 3, 4, 7, 12.5]) {
      expect(stepFactor(raw)).toBe(raw);
      expect(stepFactor(raw, undefined)).toBe(raw);
      expect(stepFactor(raw, 0)).toBe(raw);
      expect(stepFactor(raw, -3)).toBe(raw);
      expect(stepFactor(raw, Number.NaN)).toBe(raw);
    }
  });

  it("divisor 3 -- 1-3 -> 1x, 4-6 -> 2x, 7-9 -> 3x (the owner's table, exhaustively)", () => {
    const expected = [1, 1, 1, 2, 2, 2, 3, 3, 3];
    for (let runs = 1; runs <= 9; runs++) expect(stepFactor(runs, 3)).toBe(expected[runs - 1]);
  });

  it("an EXACT multiple never tips to the next rung -- 6 runs is 2x, not 3x", () => {
    expect(stepFactor(6, 3)).toBe(2);
    expect(stepFactor(9, 3)).toBe(3);
    expect(stepFactor(3, 3)).toBe(1);
  });

  it("the divisor is PARAMETERISED -- 3 is this ruling's number, not the mechanism's", () => {
    expect(stepFactor(4, 2)).toBe(2);
    expect(stepFactor(4, 4)).toBe(1);
    expect(stepFactor(10, 5)).toBe(2);
  });

  it("NEVER A SILENT ZERO -- a positive factor can never round down to nothing", () => {
    expect(stepFactor(1, 1000)).toBe(1);
    expect(stepFactor(1e-9, 3)).toBe(1);
  });
});

describe("RULING 2 -- the step function on a rate stage (point_wiring wire install)", () => {
  // wire1 install base 10.0: the stage is `base x 2.0 x factor`, rounded up to units, x length 15.
  const installPipe = (extra: Record<string, unknown>): Pipeline => ({
    output: ["install"],
    steps: [
      PW_CIRCUIT_FIT,
      cref("wire1", wireRef("@wire1_core", "@wire1_thickness_sqmm"), "install_base_per_mtr",
           [{ mult: 2.0, round: "up0", mult_from_attr: "wire1_runs", ...extra } as never], { from_attr: "circuit_length_m" }),
      { step: "sum_components", result: "install" },
    ],
  });
  const line = (runs: number, extra: Record<string, unknown>) =>
    lineOf(runPipeline("p", installPipe(extra), PW_ITEMS, { ...PW1, wire1_runs: runs }), "wire1");

  it("LINEAR without the divisor: 3 runs bills 3x -- byte-identical to before the ruling", () => {
    expect(line(1, {})).toBe(300); // ceil(10 x 2 x 1) = 20, x 15
    expect(line(3, {})).toBe(900); // ceil(10 x 2 x 3) = 60, x 15
    expect(line(4, {})).toBe(1200);
  });

  it("STEPPED with `mult_step_divisor: 3` -- 3 runs bills 1x, 4 runs bills 2x", () => {
    expect(line(1, { mult_step_divisor: 3 })).toBe(300);
    expect(line(2, { mult_step_divisor: 3 })).toBe(300);
    expect(line(3, { mult_step_divisor: 3 })).toBe(300);
    expect(line(4, { mult_step_divisor: 3 })).toBe(600); // 2x, NOT 4x
    expect(line(6, { mult_step_divisor: 3 })).toBe(600);
    expect(line(7, { mult_step_divisor: 3 })).toBe(900); // 3x
  });

  it("ABSENT MEANS 1 still holds -- the point_wiring goldens depend on it", () => {
    const noRuns = runPipeline("p", installPipe({ mult_step_divisor: 3 }), PW_ITEMS, PW1); // no wire1_runs at all
    expect(noRuns.status).not.toBe("no_match");
    expect(lineOf(noRuns, "wire1")).toBe(300);
  });

  it("THE TRACE SHOWS THE WORKING -- a stepped multiplier must never be silent arithmetic", () => {
    const r = runPipeline("p", installPipe({ mult_step_divisor: 3 }), PW_ITEMS, { ...PW1, wire1_runs: 4 });
    const mc = r.steps.find((s) => s.produced?.key === "wire1")?.matchedCondition;
    expect(mc).toBe("rate 40 x qty 15 (wire1_runs 4 -> ceil(4/3) = 2x)");
  });

  it("NEGATIVE -- a stage with NO divisor emits NO note (the string is unchanged)", () => {
    const r = runPipeline("p", installPipe({}), PW_ITEMS, { ...PW1, wire1_runs: 4 });
    expect(r.steps.find((s) => s.produced?.key === "wire1")?.matchedCondition).toBe("rate 80 x qty 15");
  });
});

describe("RULING 2 -- the step function on a `scale` param (wiring_cabling cable install)", () => {
  const scalePipe = (params: Record<string, number | string>): Pipeline => ({
    output: ["install_per_mtr"],
    steps: [
      { step: "match_master_row", params: { kind: "cable" } },
      { step: "scale", target: "install_base_per_mtr", result: "install_per_mtr", params: { install_markup: 1.0 }, formula: "base*(1+install_markup)" },
      { step: "roundup", target: "install_per_mtr", params: { digits: 0 } },
      { step: "scale", target: "install_per_mtr", result: "install_per_mtr", params, formula: "base*runs" },
    ],
  });
  const LINEAR = { runs_from_attr: "runs" };
  const STEPPED = { runs_from_attr: "runs", runs_step_divisor: 3 };

  it("LINEAR without the divisor -- g1 install 20, x3 = 60 (byte-identical to ext-b)", () => {
    expect(runPipeline("p", scalePipe(LINEAR), ITEMS, sel("COPPER", "UNARMOURED", 1.0, 6.0, 3)).finals)
      .toEqual({ install_per_mtr: 60 });
  });

  it("STEPPED -- 3 runs bills 1x (20), 4 runs bills 2x (40), 7 runs bills 3x (60)", () => {
    const at = (runs: number) =>
      runPipeline("p", scalePipe(STEPPED), ITEMS, sel("COPPER", "UNARMOURED", 1.0, 6.0, runs)).finals.install_per_mtr;
    expect(at(1)).toBe(20);
    expect(at(3)).toBe(20);
    expect(at(4)).toBe(40);
    expect(at(6)).toBe(40);
    expect(at(7)).toBe(60);
  });

  it("the divisor is applied in a SECOND pass -- key ORDER cannot change the answer", () => {
    const reversed = { runs_step_divisor: 3, runs_from_attr: "runs" };
    expect(runPipeline("p", scalePipe(reversed), ITEMS, sel("COPPER", "UNARMOURED", 1.0, 6.0, 4)).finals)
      .toEqual({ install_per_mtr: 40 });
  });

  it("NEGATIVE -- `scale`'s HONEST NO-COMPUTE is NOT softened by the divisor", () => {
    // The divisor must never rescue a missing source attribute into a 1. scale hard-fails here (and
    // deliberately differs from a rate stage's absent-means-1); that divergence must survive.
    const noRuns = { material: "COPPER", insulation: "UNARMOURED", core: 1.0, thickness_sqmm: 6.0 };
    const r = runPipeline("p", scalePipe(STEPPED), ITEMS, noRuns);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });

  it("THE TRACE SHOWS THE WORKING on this site too, from the SAME formatter", () => {
    const r = runPipeline("p", scalePipe(STEPPED), ITEMS, sel("COPPER", "UNARMOURED", 1.0, 6.0, 4));
    const last = r.steps[r.steps.length - 1];
    expect(last.matchedCondition).toBe("runs 4 -> ceil(4/3) = 2x");
  });

  it("NEGATIVE -- no divisor param emits NO note", () => {
    const r = runPipeline("p", scalePipe(LINEAR), ITEMS, sel("COPPER", "UNARMOURED", 1.0, 6.0, 4));
    expect(r.steps[r.steps.length - 1].matchedCondition).toBeUndefined();
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

  // SLICE 1b: point_wiring gained a blanker. The line follows point_wiring's OWN per-component UNIT
  // rounding (never switches_sockets' tens -- the two are deliberately different and both
  // sheet-faithful). All three stored goldens set blank_item "None", so none of them may move.
  const PW_BLANK_LINE = {
    step: "component_ref" as const, name: "blank",
    ref: { kind: "switch_socket_item", family: "Switch", item: "@blank_item", colour: "@colour" },
    target: "list_price", rate_stages: [{ mult: 0.3625, round: "up0" as const }],
    qty: { from_attr: "blank_qty" }, none_skips: true,
  };
  const PW_SUPPLY_WITH_BLANK: Pipeline = {
    output: ["supply"],
    steps: (() => {
      const s = [...PW_PIPELINES.pw_boq_supply.steps];
      s.splice(s.findIndex((x: any) => x.name === "plate"), 0, PW_BLANK_LINE);
      return s;
    })(),
  };
  // the blanker row the catalog actually has -- 1M Blanker is filed under the SWITCH family
  const PW_ITEMS_WITH_BLANK = [...PW_ITEMS, ssItem("Switch", "1M Blanker", "Grey", 79)];

  it("blank_item=None leaves pw1 EXACTLY unmoved -- the line is an explicit zero, not a cost", () => {
    const sel = { ...PW1, blank_item: "None", blank_qty: 0 };
    const r = runPipeline("pw_boq_supply", PW_SUPPLY_WITH_BLANK, PW_ITEMS_WITH_BLANK, sel);
    expect(r.steps.find((x) => x.produced?.key === "blank")?.produced?.value).toBe(0);
    expect(r.finals).toEqual({ supply: 1869 });
  });

  it("a REAL blanker contributes: Grey 1M Blanker 79 x 2 -> ceil(79*0.3625)=29 x 2 = 58", () => {
    const sel = { ...PW1, blank_item: "1M Blanker", blank_qty: 2 };
    const r = runPipeline("pw_boq_supply", PW_SUPPLY_WITH_BLANK, PW_ITEMS_WITH_BLANK, sel);
    expect(r.steps.find((x) => x.produced?.key === "blank")?.produced?.value).toBe(58);
    expect(r.finals).toEqual({ supply: 1869 + 58 });
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

// ---- The SIX-LINE SWITCH/SOCKET ASSEMBLY + industrial_sockets (paired-MCB, interlocked/None) ----
//
// These six component lines were authored for `switches_point` (EA-4b) and are now shared: when
// `switches_sockets` was rebuilt as a per-component composite (SLICE 1a) it was rebuilt FROM THIS
// SHAPE, and its pipelines below spread this same array. `switches_point` itself was RETIRED
// (2026-08-08) -- it priced rows `switches_sockets` already covers -- so the constant is named for
// WHAT IT IS rather than for the category it came from.
//
// ⚠️ It is DELIBERATELY still shared rather than inlined into SS_BOQ / SS_BCS: two copies of six
// `component_ref` lines would be free to drift, and the sharing is the honest record of the rebuild.
const swRef = (name: string, family: string, itemAttr: string, qtyAttr: string, colour: string, ifBack = false) => ({
  step: "component_ref" as const, name, ref: { kind: "switch_socket_item", family, item: itemAttr, colour }, target: "list_price",
  rate_stages: [{ mult: 1 }], qty: ifBack ? { if_attr: { back_box: "Yes" }, then: 1, else: 0 } : { from_attr: qtyAttr }, none_skips: true,
});
const SWITCH_SOCKET_ASSEMBLY_LINES = [
  swRef("switch", "Switch", "@switch_item", "switch_qty", "@colour"),
  swRef("socket1", "Socket", "@socket1_item", "socket1_qty", "@colour"),
  swRef("socket2", "Socket", "@socket2_item", "socket2_qty", "@colour"),
  swRef("blank", "Switch", "@blank_item", "blank_qty", "@colour"),
  swRef("plate", "Grid and Face Plates", "@plate_item", "plate_qty", "@colour"),
  swRef("back_box", "Back Box", "@plate_item", "", "NA", true),
];

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

// RETIREMENT NOTE (2026-08-08): the `EA-4b switches_point` describe block stood here. Its three cases
// were the sp1 golden (2320/470/1600) and two None-sentinel cases, and it was removed with the
// category. NOTHING WAS LOST: the two None cases are covered VERBATIM under switches_sockets below --
// "socket2=None is an ABSENCE, not a zero-priced line" and "plate=None zeroes the back box too (it is
// keyed @plate_item)" -- which run the same six lines through SS_BOQ. The sp1 golden went with the
// category; the one thing worth keeping out of it, the guiding-sheet-vs-formula disagreement, is
// preserved detached in the module_fit T11 block (search MODULE_DISAGREEMENT_CASE).

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
const SS_BOQ: Pipeline = { output: ["supply", "install"], steps: [...SWITCH_SOCKET_ASSEMBLY_LINES,
  { step: "sum_components", result: "supply" },
  { step: "scale", target: "supply", result: "supply", params: { m: 0.3625 }, formula: "base*m" },
  { step: "roundup", target: "supply", params: { digits: -1 } },
  { step: "scale", target: "supply", result: "install", params: { m: 0.2 }, formula: "base*m" },
  { step: "roundup", target: "install", params: { digits: -1 } },
] };
const SS_BCS: Pipeline = { output: ["bcs_supply"], steps: [...SWITCH_SOCKET_ASSEMBLY_LINES,
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

// ---- SLICE 2 part 1: the STEP-VOCABULARY PIN (C5 -- written and proven green BEFORE the new step) ----
//
// The interpreter and the server validator (_KNOWN_STEP_TYPES in api/boq/rate_master.py) must agree on
// EXACTLY the same set of step types. A step the interpreter understands but the validator rejects is
// UNSAVABLE -- that pairing has bitten twice (the circuit_fit triple, the wire_specs length check), so
// the vocabulary is pinned on BOTH sides and the two lists are updated together, in one slice.
//
// The interpreter has no exported list (its vocabulary is the if/else chain), so it is pinned
// BEHAVIOURALLY: for every declared type the chain must RECOGNISE the step -- i.e. never emit the
// unknown-step trace -- and an undeclared type must still fall through to it.
describe("step vocabulary pin (interpreter <-> STEP_VOCABULARY <-> server _KNOWN_STEP_TYPES)", () => {
  const unknownTrace = (r: ReturnType<typeof runPipeline>, t: string) =>
    r.steps.some((s) => s.label === `unsupported step '${t}'`);

  it("STEP_VOCABULARY is exactly the declared list", () => {
    expect([...STEP_VOCABULARY]).toEqual([
      "match_master_row",
      "apply_effective_multiplier",
      "scale",
      "roundup",
      "component",
      "component_ref",
      "component_band",
      "sum_components",
      "install_as_ratio",
      "circuit_fit",
      "lookup_or_ratio",
      // SLICE 2. The pin above was proven green at 11 types against the unchanged
      // interpreter + validator, THEN both sides were extended together -- so this diff shows
      // exactly what the vocabulary was before and after.
      "module_fit",
      // SLICE 2b. Same discipline again: pinned green at 13 types against the unchanged interpreter
      // + validator, then BOTH sides extended together in one commit. `map_attribute` is the
      // CONVERSION primitive (pin count -> pole today, F-10's SWG -> mm next); `catalog_fit` is
      // `module_fit`'s ladder half generalised, so slice 3's tray width rides the same step.
      "map_attribute",
      "catalog_fit",
      // CIRCUIT LENGTH part 1. Same discipline: pinned green at 12 types against the
      // unchanged interpreter + validator, then BOTH sides extended together in one commit.
      "derive_attribute",
    ]);
  });

  it("the interpreter RECOGNISES every vocabulary member (none falls through to the unknown branch)", () => {
    for (const t of STEP_VOCABULARY) {
      const pl: Pipeline = { output: ["x"], steps: [blankStep(t)] };
      const r = runPipeline("probe", pl, [], {});
      expect(unknownTrace(r, t), `interpreter does not handle '${t}'`).toBe(false);
    }
  });

  it("NEGATIVE: a type OUTSIDE the vocabulary still yields the honest unsupported state", () => {
    const pl: Pipeline = { output: ["x"], steps: [{ step: "quantum_flux" }] };
    const r = runPipeline("probe", pl, [], {});
    expect(r.status).toBe("unsupported");
    expect(unknownTrace(r, "quantum_flux")).toBe(true);
    expect(r.finals).toEqual({});
  });
});

// ---- SLICE 2 part 1: module_fit -- the module-count step + catalog ladder resolution ----
//
// THE LADDERS ARE REAL, read from the live master 2026-08-06 (switch_socket_item, Electrical):
//   PLATE    (family "Grid and Face Plates"): 1M & 2M, 3M, 4M, 6M, 8M, 9M, 12M, 16M, 18M
//            -> covers 1,2,3,4,6,8,9,12,16,18; MISSING 5,7,10,11,13,14,15,17
//   BACK BOX (family "Back Box"):             1M & 2M, 3M, 4M, 6M, 8M, 12M, 18M
//            -> covers 1,2,3,4,6,8,12,18;      NO 9M, NO 16M -- the box ladder is SHORTER
// Both take the next higher size when the exact one is absent, INDEPENDENTLY of each other, which is
// why a 9M plate pairs with a 12M box and a 16M plate with an 18M box.
const plateRow = (item: string) => ssItem("Grid and Face Plates", item, "White", 1);
const boxRow = (item: string) => ssItem("Back Box", item, "NA", 1);
const LADDER_ITEMS: RateMasterItem[] = [
  ...["1M & 2M", "3M", "4M", "6M", "8M", "9M", "12M", "16M", "18M"].map(plateRow),
  ...["1M & 2M", "3M", "4M", "6M", "8M", "12M", "18M"].map(boxRow),
];
// The owner's formula: 2 x (sockets) + 1 x (switches). PARAMETERISED -- switches_sockets has TWO
// socket slots, point_wiring has one, so a hardcoded two-attribute formula would not be portable.
const SS_TERMS = [
  { attr: "socket1_qty", weight: 2, none_when: "socket1_item" },
  { attr: "socket2_qty", weight: 2, none_when: "socket2_item" },
  { attr: "switch_qty", weight: 1, none_when: "switch_item" },
];
const modFit = (over: Record<string, unknown> = {}) => ({
  step: "module_fit" as const,
  params: {
    terms: SS_TERMS,
    ladders: [
      { kind: "switch_socket_item", where: { family: "Grid and Face Plates" }, bind: "plate_size", bind_modules: "plate_modules" },
      { kind: "switch_socket_item", where: { family: "Back Box" }, bind: "box_size" },
    ],
    blanks: { bind: "blank_count", from_ladder: "plate_size" },
    ...over,
  },
});
const MF: Pipeline = { output: [], steps: [modFit()] };
// sockets/switches as the real configs express them (a slot with no item carries the None sentinel)
const mfSel = (socket1 = 0, socket2 = 0, switches = 0, over: Record<string, string | number> = {}) => ({
  socket1_item: socket1 ? "6A 3-Pin Socket" : "None", socket1_qty: socket1,
  socket2_item: socket2 ? "6A/16A 3-Pin Socket" : "None", socket2_qty: socket2,
  switch_item: switches ? "16A 1 WAY SWITCH" : "None", switch_qty: switches,
  colour: "White",
  ...over,
});
const fitTrace = (r: ReturnType<typeof runPipeline>) =>
  r.steps.find((s) => s.step === "module_fit")?.matchedCondition ?? "";

describe("SLICE 2 module_fit -- catalog ladders (the real plate + back-box rungs)", () => {
  it("the PLATE ladder read from the catalog is 1,2,3,4,6,8,9,12,16,18 (5/7/10/11/13/14/15/17 absent)", () => {
    const rungs = buildModuleLadder(LADDER_ITEMS, { kind: "switch_socket_item", where: { family: "Grid and Face Plates" } });
    expect(rungs.map((r) => r.size)).toEqual([1, 2, 3, 4, 6, 8, 9, 12, 16, 18]);
  });

  it("the BACK BOX ladder is SHORTER -- 1,2,3,4,6,8,12,18 (no 9, no 16)", () => {
    const rungs = buildModuleLadder(LADDER_ITEMS, { kind: "switch_socket_item", where: { family: "Back Box" } });
    expect(rungs.map((r) => r.size)).toEqual([1, 2, 3, 4, 6, 8, 12, 18]);
  });

  it("'1M & 2M' is ONE item covering TWO sizes -- represented by EXPANSION, both carrying that label", () => {
    expect(moduleSizesFromLabel("1M & 2M")).toEqual([1, 2]);
    expect(moduleSizesFromLabel("3M")).toEqual([3]);
    expect(moduleSizesFromLabel("18M")).toEqual([18]);
    expect(moduleSizesFromLabel("Back Box")).toEqual([]); // no integer -> not a rung
    const rungs = buildModuleLadder(LADDER_ITEMS, { kind: "switch_socket_item", where: { family: "Back Box" } });
    expect(rungs.slice(0, 2)).toEqual([{ size: 1, label: "1M & 2M" }, { size: 2, label: "1M & 2M" }]);
  });

  it("fitModuleLadder: EXACT when the catalog carries the size, else the NEXT HIGHER, never lower", () => {
    const plateRungs = buildModuleLadder(LADDER_ITEMS, { kind: "switch_socket_item", where: { family: "Grid and Face Plates" } });
    const boxRungs = buildModuleLadder(LADDER_ITEMS, { kind: "switch_socket_item", where: { family: "Back Box" } });
    // [count, plate, box] across every gap in both ladders
    const cases: [number, string, string][] = [
      [1, "1M & 2M", "1M & 2M"], [2, "1M & 2M", "1M & 2M"], [3, "3M", "3M"], [4, "4M", "4M"],
      [5, "6M", "6M"], [6, "6M", "6M"], [7, "8M", "8M"], [8, "8M", "8M"],
      [9, "9M", "12M"], [10, "12M", "12M"], [11, "12M", "12M"], [12, "12M", "12M"],
      [13, "16M", "18M"], [16, "16M", "18M"], [17, "18M", "18M"], [18, "18M", "18M"],
    ];
    for (const [count, wantPlate, wantBox] of cases) {
      expect(fitModuleLadder(plateRungs, count)?.label, `plate @ ${count}`).toBe(wantPlate);
      expect(fitModuleLadder(boxRungs, count)?.label, `box @ ${count}`).toBe(wantBox);
      // NEVER a lower size: the fitted module number always covers the count
      expect(fitModuleLadder(plateRungs, count)!.modules).toBeGreaterThanOrEqual(count);
      expect(fitModuleLadder(boxRungs, count)!.modules).toBeGreaterThanOrEqual(count);
    }
    expect(fitModuleLadder(plateRungs, 19)).toBeNull(); // above the top -> no fit, never a clamp
    expect(fitModuleLadder([], 3)).toBeNull();          // empty ladder -> no fit
  });

  it("the ladder comes from the CATALOG, not a params array -- dropping 9M moves a 9 on to 12M", () => {
    const r1 = runPipeline("m", MF, LADDER_ITEMS, mfSel(3, 0, 3)); // 2x3 + 1x3 = 9
    expect(fitTrace(r1)).toContain("plate_size 9M");
    const without9 = LADDER_ITEMS.filter(
      (i) => !(i.attributes.family === "Grid and Face Plates" && i.attributes.item === "9M"),
    );
    const r2 = runPipeline("m", MF, without9, mfSel(3, 0, 3));
    expect(fitTrace(r2)).toContain("plate_size 12M (next higher)");
  });
});

describe("SLICE 2 module_fit -- the owner's worked cases (T1-T7)", () => {
  it("T1: 1 socket + 1 switch -> 3 modules -> EXACT '3M' (pw1/pw2's real shape and stored plate)", () => {
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(1, 0, 1));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("= 3 modules");
    expect(fitTrace(r)).toContain("plate_size 3M");
    expect(fitTrace(r)).not.toContain("plate_size 3M (next higher)"); // exact, not a hop
    expect(fitTrace(r)).toContain("box_size 3M");
  });

  it("T2: 2 sockets + 3 switches -> 7 -> NO 7M exists -> 8M (the owner's worked example)", () => {
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(2, 0, 3));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("= 7 modules");
    expect(fitTrace(r)).toContain("plate_size 8M (next higher)");
    expect(fitTrace(r)).toContain("box_size 8M (next higher)");
  });

  it("T3: 0 sockets + 1 switch -> 1 -> matches the combined rung '1M & 2M' (pw3's shape)", () => {
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(0, 0, 1));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("= 1 modules");
    expect(fitTrace(r)).toContain("plate_size 1M & 2M");
    expect(fitTrace(r)).not.toContain("next higher"); // 1 is COVERED by the combined rung
  });

  it("T4: 1 socket + 0 switches -> 2 -> ALSO matches '1M & 2M' (the combined rung from the other side)", () => {
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(1, 0, 0));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("= 2 modules");
    expect(fitTrace(r)).toContain("plate_size 1M & 2M");
    expect(fitTrace(r)).not.toContain("next higher");
  });

  it("T5: a count of 9 -> plate 9M EXISTS, but the box has no 9M -> box resolves to 12M (two ladders)", () => {
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(3, 0, 3)); // 2x3 + 1x3 = 9
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("= 9 modules");
    expect(fitTrace(r)).toContain("plate_size 9M");
    expect(fitTrace(r)).not.toContain("plate_size 9M (next higher)"); // exact on the plate ladder
    expect(fitTrace(r)).toContain("box_size 12M (next higher)");      // hop on the shorter box ladder
  });

  it("T6: a count of 16 -> plate 16M (exact), box 18M (next higher)", () => {
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(8, 0, 0)); // 2x8 = 16
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("= 16 modules");
    expect(fitTrace(r)).toContain("plate_size 16M");
    expect(fitTrace(r)).not.toContain("plate_size 16M (next higher)");
    expect(fitTrace(r)).toContain("box_size 18M (next higher)");
  });

  it("T7: a count ABOVE the ladder top (>18) is an HONEST NO-COMPUTE -- never clamped to 18M", () => {
    // 2x10 = 20 modules. The catalog carries no such plate; clamping to 18M would under-price by two
    // modules AND show a plate that cannot hold the contents.
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(10, 0, 0));
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
    const label = r.steps[r.steps.length - 1].label;
    expect(label).toContain("20 modules exceeds the largest");
    expect(label).toContain("18M");
  });
});

describe("SLICE 2 module_fit -- bindings, the trace, and the parameterised sum", () => {
  it("binds the fitted LABEL for a later component_ref '@plate_size' -- the circuit_fit precedent", () => {
    const priced: Pipeline = {
      output: ["supply"],
      steps: [
        modFit(),
        { step: "component_ref", name: "plate", ref: { kind: "switch_socket_item", family: "Grid and Face Plates", item: "@plate_size", colour: "@colour" }, target: "list_price", rate_stages: [{ mult: 1 }], qty: 1 },
        { step: "component_ref", name: "back_box", ref: { kind: "switch_socket_item", family: "Back Box", item: "@box_size", colour: "NA" }, target: "list_price", rate_stages: [{ mult: 1 }], qty: 1 },
        { step: "sum_components", result: "supply" },
      ],
    };
    // real catalog list prices: plate 9M White 443, back box 12M 412
    const items = [
      ...LADDER_ITEMS.filter(
        (i) => !(i.attributes.family === "Grid and Face Plates" && i.attributes.item === "9M")
            && !(i.attributes.family === "Back Box" && i.attributes.item === "12M"),
      ),
      ssItem("Grid and Face Plates", "9M", "White", 443), ssItem("Back Box", "12M", "NA", 412),
    ];
    const r = runPipeline("p", priced, items, mfSel(3, 0, 3)); // 9 modules -> plate 9M, box 12M
    expect(r.status).toBe("ok");
    expect(r.steps.find((s) => s.produced?.key === "plate")?.produced?.value).toBe(443);
    expect(r.steps.find((s) => s.produced?.key === "back_box")?.produced?.value).toBe(412);
    expect(r.finals).toEqual({ supply: 855 });
  });

  it("binds the module NUMBER + blank count as NUMBERS, readable by a component_ref qty {from_fit}", () => {
    const r = runPipeline("m", { output: ["plate_modules", "blank_count"], steps: [modFit()] }, LADDER_ITEMS, mfSel(2, 0, 3));
    expect(r.finals).toEqual({ plate_modules: 8, blank_count: 1 });
  });

  it("THE TRACE SHOWS ITS WORKING: the arithmetic AND the ladder hop, on one line", () => {
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(2, 0, 3));
    expect(fitTrace(r)).toBe(
      "2 x socket1_qty(2) + 2 x socket2_qty(None) + 1 x switch_qty(3) = 7 modules -> " +
        "plate_size 8M (next higher), box_size 8M (next higher); 1 blank (plate_size 8 - 7)",
    );
  });

  it("THE SUM IS PARAMETERISED: point_wiring's ONE socket slot uses the SAME step, different terms", () => {
    // point_wiring has socket_qty (one slot), switches_sockets has socket1_qty + socket2_qty. A
    // hardcoded two-attribute formula could not serve both -- weights AND ids come from config.
    const pw: Pipeline = { output: [], steps: [{
      step: "module_fit",
      params: {
        terms: [{ attr: "socket_qty", weight: 2, none_when: "socket_item" }, { attr: "switch_qty", weight: 1, none_when: "switch_item" }],
        ladders: [{ kind: "switch_socket_item", where: { family: "Grid and Face Plates" }, bind: "plate_size" }],
      },
    }] };
    const r = runPipeline("m", pw, LADDER_ITEMS, { socket_item: "6A 3-Pin Socket", socket_qty: 1, switch_item: "16A 1 WAY SWITCH", switch_qty: 1 });
    expect(fitTrace(r)).toContain("= 3 modules");
    expect(fitTrace(r)).toContain("plate_size 3M");
  });

  it("BOTH socket slots feed ONE count -- socket1 1 + socket2 2 = 3 sockets, not two separate fits", () => {
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(1, 2, 2)); // 2x1 + 2x2 + 1x2 = 8
    expect(fitTrace(r)).toContain("= 8 modules");
    expect(fitTrace(r)).toContain("plate_size 8M");
  });
});

describe("SLICE 2 module_fit -- the blanker count (T10) and its negative guard (T9)", () => {
  it("T10a: T1's shape (3 modules, 1 socket + 1 switch = 3 occupied) -> 0 blanks", () => {
    const r = runPipeline("m", { output: ["blank_count"], steps: [modFit()] }, LADDER_ITEMS, mfSel(1, 0, 1));
    expect(r.finals).toEqual({ blank_count: 0 });
    expect(fitTrace(r)).toContain("0 blanks");
  });

  it("T10b: T2's shape (8 modules, 2 sockets + 3 switches = 7 occupied) -> 1 blank", () => {
    const r = runPipeline("m", { output: ["blank_count"], steps: [modFit()] }, LADDER_ITEMS, mfSel(2, 0, 3));
    expect(r.finals).toEqual({ blank_count: 1 });
    expect(fitTrace(r)).toContain("1 blank (plate_size 8 - 7)");
  });

  it("the blank count uses the SAME module number the plate RESOLVED to, not the raw count", () => {
    // 2x2 + 1x1 = 5 -> no 5M -> plate 6M -> blanks 6 - 5 = 1 (NOT 5 - 5 = 0)
    const r = runPipeline("m", { output: ["blank_count"], steps: [modFit()] }, LADDER_ITEMS, mfSel(2, 0, 1));
    expect(fitTrace(r)).toContain("= 5 modules");
    expect(fitTrace(r)).toContain("plate_size 6M (next higher)");
    expect(r.finals).toEqual({ blank_count: 1 });
  });

  it("on the RESOLVED path the blank count can never go negative (fit >= occupied by construction)", () => {
    for (let sockets = 0; sockets <= 8; sockets++) {
      for (let switches = 0; switches <= 2; switches++) {
        if (sockets === 0 && switches === 0) continue; // 0 modules -> no-compute, covered below
        const r = runPipeline("m", { output: ["blank_count"], steps: [modFit()] }, LADDER_ITEMS, mfSel(sockets, 0, switches));
        if (r.status === "ok") expect(r.finals.blank_count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("T9 (REVISED by the take-the-larger ruling): a negative blank count CLAMPS TO ZERO, never refuses", () => {
    // ⚠️ PIN UPDATED IN THIS SLICE. Part 1 refused here, which was correct under stated-wins: a 6M
    // plate carrying 7 modules was a contradiction. Take-the-larger UPGRADES such a plate instead,
    // so on the PRIMARY path (a ladder with floor_from) this is structurally unreachable -- see the
    // sweep above and the dedicated pin below. This path has NO floor_from, so it still reaches the
    // subtraction, and the owner's ruling is CLAMP TO ZERO: a BoQ typo must not kill a row.
    const withStated: Pipeline = { output: ["blank_count"], steps: [modFit({ blanks: { bind: "blank_count", from_ladder: "plate_size", stated_attr: "plate_item" } })] };
    const r = runPipeline("m", withStated, LADDER_ITEMS, mfSel(1, 2, 1, { plate_item: "6M" }));
    expect(r.status).toBe("ok");
    expect(r.finals).toEqual({ blank_count: 0 });
    // THE CLAMP IS NOT SILENT -- the trace says the plate was over-full
    expect(fitTrace(r)).toContain("over-full, clamped");
  });

  it("T9 POSITIVE control: the SAME row with a stated 8M computes 1 blank", () => {
    const withStated: Pipeline = { output: ["blank_count"], steps: [modFit({ blanks: { bind: "blank_count", from_ladder: "plate_size", stated_attr: "plate_item" } })] };
    const r = runPipeline("m", withStated, LADDER_ITEMS, mfSel(1, 2, 1, { plate_item: "8M" }));
    expect(r.status).toBe("ok");
    expect(r.finals).toEqual({ blank_count: 1 });
  });

  it("a stated plate that is blank or None falls back to the RESOLVED ladder (absent = not stated)", () => {
    const withStated: Pipeline = { output: ["blank_count"], steps: [modFit({ blanks: { bind: "blank_count", from_ladder: "plate_size", stated_attr: "plate_item" } })] };
    for (const stated of ["", "None"]) {
      const r = runPipeline("m", withStated, LADDER_ITEMS, mfSel(1, 2, 1, { plate_item: stated }));
      expect(r.status).toBe("ok");
      expect(r.finals).toEqual({ blank_count: 1 }); // resolved 8M - 7
    }
  });
});

describe("SLICE 2 module_fit -- HONEST no-compute negatives (T8)", () => {
  it("T8: a MISSING quantity is UNKNOWN -> no-compute naming the attribute, never a zero", () => {
    const r = runPipeline("m", MF, LADDER_ITEMS, { ...mfSel(1, 0, 1), switch_qty: undefined as unknown as number });
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
    expect(r.steps[r.steps.length - 1].label).toBe("attribute 'switch_qty' missing or non-numeric -- no module count computed");
  });

  it("T8: a NON-NUMERIC quantity is likewise an honest no-compute", () => {
    for (const bad of ["", "two", NaN]) {
      const r = runPipeline("m", MF, LADDER_ITEMS, { ...mfSel(1, 0, 1), socket1_qty: bad as unknown as number });
      expect(r.status).toBe("no_match");
      expect(r.finals).toEqual({});
    }
  });

  it("a 'None' quantity/slot is POSITIVE ABSENCE -> contributes 0, and the row still computes", () => {
    // both directions: the qty itself None, and the controlling ITEM None with a blank qty
    const a = runPipeline("m", MF, LADDER_ITEMS, { ...mfSel(1, 0, 1), socket2_qty: "None" });
    expect(a.status).toBe("ok");
    expect(fitTrace(a)).toContain("= 3 modules");
    const b = runPipeline("m", MF, LADDER_ITEMS, { ...mfSel(1, 0, 1), socket2_item: "None", socket2_qty: "" });
    expect(b.status).toBe("ok");
    expect(fitTrace(b)).toContain("= 3 modules");
  });

  it("an EMPTY ladder (no catalog rows for that family) -> honest no-compute naming the ladder", () => {
    const r = runPipeline("m", MF, LADDER_ITEMS.filter((i) => i.attributes.family !== "Back Box"), mfSel(1, 0, 1));
    expect(r.status).toBe("no_match");
    expect(r.steps[r.steps.length - 1].label).toContain("ladder 'box_size'");
    expect(r.steps[r.steps.length - 1].label).toContain("no catalog rows");
  });

  it("a count of ZERO fits NO plate -- and, since PW-FIX, no longer refuses the row either", () => {
    // UPDATED BY PW-FIX. This pin previously asserted `no_match` for the whole pipeline. The
    // "NOT the smallest plate" half is the part that was always right and is unchanged; the refusal
    // half was too wide and killed components that have nothing to do with module counts.
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(0, 0, 0));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("no plate_size (nothing to fit)");
    expect(fitTrace(r)).toContain("no box_size (nothing to fit)");
    expect(fitTrace(r)).not.toContain("1M & 2M"); // the smallest rung was NOT manufactured
  });

  it("OPTION C: a MALFORMED module_fit (no params at all) NEVER throws -- honest degrade", () => {
    const broken: Pipeline = { output: ["x"], steps: [{ step: "module_fit" }] };
    expect(() => runPipeline("m", broken, LADDER_ITEMS, mfSel(1, 0, 1))).not.toThrow();
    expect(runPipeline("m", broken, LADDER_ITEMS, mfSel(1, 0, 1)).status).toBe("no_match");
  });
});

// T11: THE GUIDING-SHEET-VS-FORMULA DISAGREEMENT. PRESERVED DETACHED FROM ITS ORIGINAL CATEGORY.
//
// This case arrived as the `sp1` golden of `switches_point`: a real assembly of 2 switches + 3 sockets
// whose guiding-sheet plate was stated as 6M, where the module formula computes EIGHT and fits 8M. The
// owner ruled the FORMULA wins.
//
// ⚠️ The category was RETIRED (2026-08-08) and its golden went with it, but the DISAGREEMENT IS NOT
// ABOUT THAT CATEGORY -- it is the only pinned case anywhere of a guiding-sheet value contradicting a
// computed one, and `module_fit` (with take-the-larger) is LIVE on `switches_sockets` and
// `point_wiring`, whose plate ladders resolve this shape identically. So the fixture is inlined here,
// named for what it demonstrates rather than for the golden it came from, and no longer depends on any
// category's stored attrs.
const MODULE_DISAGREEMENT_CASE = {
  /** what the guiding sheet stated for this assembly */
  statedPlate: "6M",
  /** the assembly the sheet described: 2 switches + (1 + 2) sockets */
  switch_qty: 2,
  socket1_qty: 1,
  socket2_qty: 2,
};

describe("SLICE 2 module_fit -- T11: the guiding-sheet-vs-formula disagreement (preserved)", () => {
  it("the case's real shape (2 switches + 3 sockets) gives EIGHT modules by the formula", () => {
    // switch_qty 2, socket1_qty 1, socket2_qty 2 -> sockets 3, switches 2 -> 2 x 3 + 1 x 2 = 8
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(1, 2, 2));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("= 8 modules");
    expect(fitTrace(r)).toContain("plate_size 8M");
  });

  it("the sheet STATED 6M -- the formula and the guiding sheet DISAGREE; the owner ruled the formula wins", () => {
    const c = MODULE_DISAGREEMENT_CASE;
    expect(c.statedPlate).toBe("6M");
    const formulaModules = 2 * (c.socket1_qty + c.socket2_qty) + 1 * c.switch_qty;
    expect(formulaModules).toBe(8);
    expect(moduleSizesFromLabel(c.statedPlate)).toEqual([6]);
    expect(moduleSizesFromLabel(c.statedPlate)).not.toContain(formulaModules); // the disagreement
  });
});

// ---- SLICE 2 part 2 / CP0: floor_from + on_none -- TAKE-THE-LARGER (stated is a FLOOR) ----
//
// Part 1 shipped the binding resolution as `fitLabels` BEFORE the selection, so a stated plate was
// simply ignored. `floor_from` is what makes the stated value count, per ladder. BOTH keys are
// OPTIONAL: absent means the computed count always, byte-identical to part 1 (pinned below).
//
// THE RULE IS TAKE-THE-LARGER: the count fitted is max(stated, computed). A stated plate too small
// for its contents is UPGRADED, never refused (and the upgrade is VISIBLE in the trace); a stated
// plate bigger than needed is what gets bought. The stated plate is a FLOOR, never a ceiling.
//
// The resolved COUNT is RE-FIT on each ladder -- it is NEVER copied across as a label. On the plate
// ladder that is usually the identity; on the SHORTER back-box ladder it is the hop. Copying the
// label is what made a stated 9M or 16M plate unpriceable, a LIVE defect before this slice.
const floorFit = (over: Record<string, unknown> = {}) => ({
  step: "module_fit" as const,
  params: {
    terms: SS_TERMS,
    ladders: [
      { kind: "switch_socket_item", where: { family: "Grid and Face Plates" }, bind: "plate_item", floor_from: "plate_item", on_none: "none" },
      { kind: "switch_socket_item", where: { family: "Back Box" }, bind: "box_item", floor_from: "plate_item", on_none: "computed" },
    ],
    blanks: { bind: "blank_count", from_ladder: "plate_item" },
    ...over,
  },
});
const FLOOR: Pipeline = { output: [], steps: [floorFit()] };

describe("SLICE 2 part 2 -- floor_from: TAKE-THE-LARGER (the stated plate is a FLOOR, never a ceiling)", () => {
  it("SILENCE: no stated plate -> the COMPUTED size fills it (7 -> 8M plate, 8M box)", () => {
    const r = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(2, 0, 3));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("= 7 modules");
    expect(fitTrace(r)).toContain("plate_item 8M (next higher)");
    expect(fitTrace(r)).toContain("box_item 8M (next higher)");
  });

  it("STATED LARGER (the V3b shape): a stated 12M on the SAME selection prices 12M, NOT the computed 8M", () => {
    const r = runPipeline("m", { output: ["blank_count"], steps: [floorFit()] }, LADDER_ITEMS, mfSel(2, 0, 3, { plate_item: "12M" }));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("= 7 modules");          // the count is still computed + shown
    expect(fitTrace(r)).toContain("plate_item 12M (stated 12M)");
    expect(fitTrace(r)).not.toContain("plate_item 8M");    // the computed size does NOT override
    expect(r.finals).toEqual({ blank_count: 5 });          // 12 - 7, from the plate ACTUALLY selected
  });

  it("UPGRADE (the V3 shape): a stated 6M too small for 7 modules is UPGRADED to 8M, never refused", () => {
    // Under the superseded stated-wins rule this row REFUSED outright -- a BoQ typo killed it.
    const r = runPipeline("m", { output: ["blank_count"], steps: [floorFit()] }, LADDER_ITEMS, mfSel(2, 0, 3, { plate_item: "6M" }));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("plate_item 8M");
    expect(fitTrace(r)).not.toContain("plate_item 6M");
    expect(r.finals).toEqual({ blank_count: 1 });          // 8 - 7, from the SELECTED plate
  });

  it("THE UPGRADE IS NEVER SILENT: the trace names the stated size, its capacity and the contents", () => {
    // The BoQ said 6M and we price 8M. That is the right call, and it must be impossible to miss.
    const r = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(2, 0, 3, { plate_item: "6M" }));
    expect(fitTrace(r)).toContain("plate_item 8M (stated 6M holds 6, contents occupy 7 -- UPGRADED)");
    // the BOX follows the plate ACTUALLY selected, and says so too
    expect(fitTrace(r)).toContain("box_item 8M (stated 6M holds 6, contents occupy 7 -- UPGRADED)");
  });

  it("a stated plate EQUAL to the contents is NOT an upgrade (the boundary, max(n,n) = n)", () => {
    const r = runPipeline("m", { output: ["blank_count"], steps: [floorFit()] }, LADDER_ITEMS, mfSel(3, 0, 2, { plate_item: "8M" }));
    expect(fitTrace(r)).toContain("= 8 modules");
    expect(fitTrace(r)).toContain("plate_item 8M (stated 8M)");
    expect(fitTrace(r)).not.toContain("UPGRADED");
    expect(r.finals).toEqual({ blank_count: 0 });
  });

  it("THE 9M/16M FIX: a stated plate hands the BOX its module COUNT, re-fit on the SHORTER box ladder", () => {
    // Copying the label asks for a 9M/16M back box, and neither exists -> the row could not price
    // at all. Re-fitting the COUNT gives 9 -> 12M and 16 -> 18M.
    const r9 = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(3, 0, 3, { plate_item: "9M" }));
    expect(r9.status).toBe("ok");
    expect(fitTrace(r9)).toContain("plate_item 9M (stated 9M)");
    expect(fitTrace(r9)).toContain("box_item 12M (stated 9M) (next higher)");

    const r16 = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(8, 0, 0, { plate_item: "16M" }));
    expect(r16.status).toBe("ok");
    expect(fitTrace(r16)).toContain("plate_item 16M (stated 16M)");
    expect(fitTrace(r16)).toContain("box_item 18M (stated 16M) (next higher)");
  });

  it("THE 9M/16M FIX prices end-to-end: a 9M plate + a 12M box both resolve to REAL catalog rows", () => {
    const priced: Pipeline = {
      output: ["supply"],
      steps: [
        floorFit(),
        { step: "component_ref", name: "plate", ref: { kind: "switch_socket_item", family: "Grid and Face Plates", item: "@plate_item", colour: "@colour" }, target: "list_price", rate_stages: [{ mult: 1 }], qty: 1, none_skips: true },
        { step: "component_ref", name: "back_box", ref: { kind: "switch_socket_item", family: "Back Box", item: "@box_item", colour: "NA" }, target: "list_price", rate_stages: [{ mult: 1 }], qty: 1, none_skips: true },
        { step: "sum_components", result: "supply" },
      ],
    };
    // real catalog list prices: plate 9M White 443, back box 12M 412
    const items = [
      ...LADDER_ITEMS.filter(
        (i) => !(i.attributes.family === "Grid and Face Plates" && i.attributes.item === "9M")
            && !(i.attributes.family === "Back Box" && i.attributes.item === "12M"),
      ),
      ssItem("Grid and Face Plates", "9M", "White", 443), ssItem("Back Box", "12M", "NA", 412),
    ];
    const r = runPipeline("p", priced, items, mfSel(3, 0, 3, { plate_item: "9M" }));
    expect(r.status).toBe("ok");
    expect(r.finals).toEqual({ supply: 855 }); // 443 + 412
  });

  it("NEGATIVE (the bug being fixed): binding the box to the PLATE'S LABEL cannot price a 9M row", () => {
    // This is the shape that is live TODAY -- the back box ref binds @plate_item verbatim.
    const legacy: Pipeline = {
      output: ["supply"],
      steps: [
        { step: "component_ref", name: "back_box", ref: { kind: "switch_socket_item", family: "Back Box", item: "@plate_item", colour: "NA" }, target: "list_price", rate_stages: [{ mult: 1 }], qty: 1, none_skips: true },
        { step: "sum_components", result: "supply" },
      ],
    };
    for (const plate of ["9M", "16M"]) {
      const r = runPipeline("p", legacy, LADDER_ITEMS, mfSel(3, 0, 3, { plate_item: plate }));
      expect(r.status, `${plate} should not resolve a back box`).toBe("no_match");
    }
  });
});

// ── DERIVED DISPLAY: the fitted label as STRUCTURED DATA ────────────────────────────
// module_fit knew the fitted plate all along, but published it only inside its prose
// `matchedCondition`, and `runningValues` is numbers-only so a LABEL could not live there. A panel
// that must RENDER the plate therefore had two bad options -- regex the prose (a reword silently
// breaks the panel) or re-derive the fit (a fifth copy of the module rule). Neither is acceptable,
// so the step publishes what it decided. These pin the carrier; the arithmetic is untouched, which
// the goldens above continue to enforce.
describe("DERIVED DISPLAY -- module_fit publishes its outcome as data (no prose parsing)", () => {
  it("POSITIVE: the fitted LABEL and module count travel per ladder, with the occupied count", () => {
    const r = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(2, 0, 3));
    const mf = moduleFitOutcome([r]);
    expect(mf?.occupied).toBe(7);
    expect(mf?.ladders).toEqual([
      { bind: "plate_item", floorFrom: "plate_item", label: "8M", modules: 8, absent: false },
      { bind: "box_item", floorFrom: "plate_item", label: "8M", modules: 8, absent: false },
    ]);
  });

  it("the DATA and the PROSE can never disagree -- both are written at the same point", () => {
    const r = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(2, 0, 3));
    const plate = moduleFitOutcome([r])?.ladders.find((l) => l.bind === "plate_item");
    expect(fitTrace(r)).toContain(`plate_item ${plate?.label}`);
  });

  it("POSITIVE: an UPGRADE carries BOTH numbers, so a surface can name them without re-deriving", () => {
    const r = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(2, 0, 3, { plate_item: "6M" }));
    const plate = moduleFitOutcome([r])?.ladders.find((l) => l.bind === "plate_item");
    expect(plate?.label).toBe("8M");
    expect(plate?.upgraded).toEqual({ stated: "6M", statedHolds: 6, occupied: 7 });
  });

  it("NEGATIVE: a stated plate that FITS is not an upgrade -- the key is absent, not false", () => {
    const r = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(2, 0, 3, { plate_item: "12M" }));
    const plate = moduleFitOutcome([r])?.ladders.find((l) => l.bind === "plate_item");
    expect(plate?.label).toBe("12M");
    expect(plate?.upgraded).toBeUndefined();
  });

  it("POSITIVE: a None plate is ABSENT with a null label -- never a fabricated size", () => {
    const r = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(2, 0, 3, { plate_item: "None" }));
    const mf = moduleFitOutcome([r]);
    expect(mf?.ladders.find((l) => l.bind === "plate_item")).toMatchObject({ absent: true, label: null });
    // the box still fits (on_none "computed") -- a back box can exist with no face plate
    expect(mf?.ladders.find((l) => l.bind === "box_item")).toMatchObject({ absent: false, label: "8M" });
  });

  it("POSITIVE: a ZERO module count marks EVERY ladder absent (nothing to fit)", () => {
    const r = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(0, 0, 0, { socket1_item: "None", switch_item: "None" }));
    const mf = moduleFitOutcome([r]);
    expect(mf?.occupied).toBe(0);
    expect(mf?.ladders.every((l) => l.absent && l.label === null)).toBe(true);
  });

  it("NEGATIVE: a pipeline with NO module_fit publishes nothing (every legacy pipeline)", () => {
    const r = runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, {
      material: "COPPER", insulation: "UNARMOURED", core: 1, thickness_sqmm: 6.0, runs: 1,
    });
    expect(r.status).toBe("ok");
    expect(moduleFitOutcome([r])).toBeUndefined();
    expect(r.steps.every((s) => s.moduleFit === undefined)).toBe(true);
  });

  it("NEGATIVE: a BAILED module_fit publishes nothing -- nothing was fitted, so nothing is claimed", () => {
    // a blank quantity is UNKNOWN, not zero -> the step bails before any ladder resolves
    const r = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(2, 0, 3, { switch_qty: "" }));
    expect(r.status).toBe("no_match");
    expect(moduleFitOutcome([r])).toBeUndefined();
  });

  it("scans SEVERAL results -- a category may split supply/install across pipelines", () => {
    const noFit = runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, {
      material: "COPPER", insulation: "UNARMOURED", core: 1, thickness_sqmm: 6.0, runs: 1,
    });
    const withFit = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(2, 0, 3));
    expect(moduleFitOutcome([noFit, withFit])?.occupied).toBe(7);
  });
});

describe("SLICE 2 part 2 -- on_none: a None plate keeps the PLATE absent, the BOX computed", () => {
  it("plate None -> the plate ladder is POSITIVELY ABSENT; the box takes the COMPUTED count", () => {
    const r = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(2, 0, 3, { plate_item: "None" }));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("plate_item None");
    expect(fitTrace(r)).toContain("box_item 8M (next higher)"); // computed, no defer note
  });

  it("a None plate does NOT refuse the row -- blanks are absent, not a failure (the s1 shape)", () => {
    // s1 is a lone socket with plate None. Blanks fill a plate; with no plate there are none. That
    // is an ABSENCE, not a contradiction, so the row must still price.
    const r = runPipeline("m", { output: [], steps: [floorFit()] }, LADDER_ITEMS, mfSel(1, 0, 0, { plate_item: "None" }));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("no plate_item -> no blanks");
  });

  it("on_none defaults to 'none' -- an omitted on_none keeps the ladder positively absent", () => {
    const noKey: Pipeline = { output: [], steps: [{
      step: "module_fit",
      params: {
        terms: SS_TERMS,
        ladders: [{ kind: "switch_socket_item", where: { family: "Grid and Face Plates" }, bind: "plate_item", floor_from: "plate_item" }],
      },
    }] };
    const r = runPipeline("m", noKey, LADDER_ITEMS, mfSel(1, 0, 1, { plate_item: "None" }));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("plate_item None");
  });

  it("the box's on_none 'computed' is what lets a back box exist with NO face plate", () => {
    const priced: Pipeline = {
      output: ["supply"],
      steps: [
        floorFit(),
        { step: "component_ref", name: "plate", ref: { kind: "switch_socket_item", family: "Grid and Face Plates", item: "@plate_item", colour: "@colour" }, target: "list_price", rate_stages: [{ mult: 1 }], qty: 1, none_skips: true },
        { step: "component_ref", name: "back_box", ref: { kind: "switch_socket_item", family: "Back Box", item: "@box_item", colour: "NA" }, target: "list_price", rate_stages: [{ mult: 1 }], qty: 1, none_skips: true },
        { step: "sum_components", result: "supply" },
      ],
    };
    const items = [
      ...LADDER_ITEMS.filter((i) => !(i.attributes.family === "Back Box" && i.attributes.item === "3M")),
      ssItem("Back Box", "3M", "NA", 158), // real catalog list price
    ];
    const r = runPipeline("p", priced, items, mfSel(1, 0, 1, { plate_item: "None" }));
    expect(r.status).toBe("ok");
    // the plate line is a positive ZERO (None), the box prices at the computed 3M
    expect(r.steps.find((s) => s.produced?.key === "plate")?.produced?.value).toBe(0);
    expect(r.steps.find((s) => s.produced?.key === "back_box")?.produced?.value).toBe(158);
    expect(r.finals).toEqual({ supply: 158 });
  });
});

describe("SLICE 2 part 2 -- floor_from / on_none are OPTIONAL (absent == part 1, byte-identical)", () => {
  it("a ladder with NO floor_from still uses the computed count even when a plate IS stated", () => {
    // MF is the part-1 fixture: same ladders, no floor_from. A stated 12M must be IGNORED by it.
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(2, 0, 3, { plate_item: "12M" }));
    expect(fitTrace(r)).toContain("plate_size 8M (next higher)");
    expect(fitTrace(r)).not.toContain("stated");
  });

  it("the part-1 trace is byte-identical when neither key is present", () => {
    const r = runPipeline("m", MF, LADDER_ITEMS, mfSel(2, 0, 3));
    expect(fitTrace(r)).toBe(
      "2 x socket1_qty(2) + 2 x socket2_qty(None) + 1 x switch_qty(3) = 7 modules -> " +
        "plate_size 8M (next higher), box_size 8M (next higher); 1 blank (plate_size 8 - 7)",
    );
  });

  it("NEGATIVE: a stated value carrying no module size is an honest no-compute", () => {
    const r = runPipeline("m", FLOOR, LADDER_ITEMS, mfSel(1, 0, 1, { plate_item: "Frame Plate" }));
    expect(r.status).toBe("no_match");
    expect(r.steps[r.steps.length - 1].label).toContain("carries no module size");
  });
});


// ---- SLICE 2 part 2 / CP2: the WIRED switches_sockets pipeline + the re-minted ss1 golden ----
//
// Mirrors the v23 config shape: module_fit first, then the six component lines, with the blank
// component's qty taken from the COMPUTED blank count and the back box binding @box_item.
const SS_MODULE_FIT = {
  step: "module_fit" as const,
  params: {
    terms: [
      { attr: "socket1_qty", weight: 2, none_when: "socket1_item" },
      { attr: "socket2_qty", weight: 2, none_when: "socket2_item" },
      { attr: "switch_qty", weight: 1, none_when: "switch_item" },
    ],
    ladders: [
      { kind: "switch_socket_item", where: { family: "Grid and Face Plates" }, bind: "plate_item", floor_from: "plate_item", on_none: "none" },
      { kind: "switch_socket_item", where: { family: "Back Box" }, bind: "box_item", floor_from: "plate_item", on_none: "computed" },
    ],
    blanks: { bind: "blank_count", from_ladder: "plate_item" },
  },
};
const ss2Ref = (name: string, family: string, itemAttr: string, colour: string, qty: unknown) => ({
  step: "component_ref" as const, name,
  ref: { kind: "switch_socket_item", family, item: itemAttr, colour },
  target: "list_price", rate_stages: [{ mult: 1 }], qty, none_skips: true,
});
const SS2_LINES = [
  SS_MODULE_FIT,
  ss2Ref("switch", "Switch", "@switch_item", "@colour", { from_attr: "switch_qty" }),
  ss2Ref("socket1", "Socket", "@socket1_item", "@colour", { from_attr: "socket1_qty" }),
  ss2Ref("socket2", "Socket", "@socket2_item", "@colour", { from_attr: "socket2_qty" }),
  ss2Ref("blank", "Switch", "@blank_item", "@colour", { from_fit: "blank_count" }),
  ss2Ref("plate", "Grid and Face Plates", "@plate_item", "@colour", { from_attr: "plate_qty" }),
  ss2Ref("back_box", "Back Box", "@box_item", "NA", { if_attr: { back_box: "Yes" }, then: 1, else: 0 }),
];
const SS2_BOQ: Pipeline = { output: ["supply", "install"], steps: [...SS2_LINES,
  { step: "sum_components", result: "supply" },
  { step: "scale", target: "supply", result: "supply", params: { m: 0.3625 }, formula: "base*m" },
  { step: "roundup", target: "supply", params: { digits: -1 } },
  { step: "scale", target: "supply", result: "install", params: { m: 0.2 }, formula: "base*m" },
  { step: "roundup", target: "install", params: { digits: -1 } },
] };
const SS2_BCS: Pipeline = { output: ["bcs_supply"], steps: [...SS2_LINES,
  { step: "sum_components", result: "bcs_supply" },
  { step: "scale", target: "bcs_supply", result: "bcs_supply", params: { m: 0.25 }, formula: "base*m" },
  { step: "roundup", target: "bcs_supply", params: { digits: -1 } },
] };
// REAL catalog list prices (live master, 2026-08-06) + the full ladders so module_fit can resolve
const SS2_ITEMS: RateMasterItem[] = [
  ssItem("Switch", "16A 1 WAY SWITCH", "White", 258), ssItem("Socket", "6A/16A 3-Pin Socket", "White", 425),
  ssItem("Socket", "6A 3-Pin Socket", "White", 282), ssItem("Switch", "1M Blanker", "White", 61),
  ...([["1M & 2M", 162], ["3M", 204], ["4M", 236], ["6M", 302], ["8M", 396], ["9M", 443], ["12M", 579], ["16M", 689], ["18M", 849]] as [string, number][])
    .map(([it, pr]) => ssItem("Grid and Face Plates", it, "White", pr)),
  ...([["1M & 2M", 119], ["3M", 158], ["4M", 182], ["6M", 247], ["8M", 320], ["12M", 412], ["18M", 488]] as [string, number][])
    .map(([it, pr]) => ssItem("Back Box", it, "NA", pr)),
];
// the RE-MINTED ss1: an 8M plate, 7 modules occupied, 1 blank -- COHERENT
const SS1_V23 = { switch_item: "16A 1 WAY SWITCH", switch_qty: 1, socket1_item: "6A/16A 3-Pin Socket", socket1_qty: 1,
  socket2_item: "6A 3-Pin Socket", socket2_qty: 2, blank_item: "1M Blanker",
  plate_item: "8M", plate_qty: 1, colour: "White", back_box: "Yes" };
const S1_V23 = { switch_item: "None", switch_qty: 0, socket1_item: "6A 3-Pin Socket", socket1_qty: 1,
  socket2_item: "None", socket2_qty: 0, blank_item: "None",
  plate_item: "None", plate_qty: 0, colour: "White", back_box: "No" };

describe("SLICE 2 part 2 / CP2 -- the re-minted ss1 golden (was INCOHERENT)", () => {
  it("ss1 RE-MINTED -> supply 740 / install 150 / BCS 510, derived from catalog list prices", () => {
    // The 1a golden stated 7 modules of content on a 6M plate (holds 6) with blank_qty 2 that fits
    // at no plate size. It priced only because nothing checked module coherence.
    // 258x1 + 425x1 + 282x2 + 61x1(computed blank) + 396(8M plate) + 320(8M box) = 2024 raw
    // 2024 x0.3625 = 733.70 -> tens 740 ; 740 x0.2 = 148 -> tens 150 ; 2024 x0.25 = 506 -> tens 510
    expect(runPipeline("swsock_boq", SS2_BOQ, SS2_ITEMS, SS1_V23).finals).toEqual({ supply: 740, install: 150 });
    expect(runPipeline("swsock_bcs", SS2_BCS, SS2_ITEMS, SS1_V23).finals).toEqual({ bcs_supply: 510 });
  });

  it("ss1 is COHERENT: 7 occupied on an 8M plate leaves exactly 1 blank, and the blank COSTS 61", () => {
    const r = runPipeline("swsock_boq", SS2_BOQ, SS2_ITEMS, SS1_V23);
    expect(fitTrace(r)).toContain("= 7 modules");
    expect(fitTrace(r)).toContain("plate_item 8M (stated 8M)");
    expect(fitTrace(r)).toContain("box_item 8M (stated 8M)");
    expect(fitTrace(r)).toContain("1 blank");
    // C6: a REAL blanker at a NON-ZERO computed quantity, so the blank line is pinned, not merely correct
    expect(r.steps.find((s) => s.produced?.key === "blank")?.produced?.value).toBe(61);
  });

  it("s1 is UNMOVED -> 110 / 30 / 80 (a lone socket, plate None, prices exactly as before)", () => {
    // the None plate keeps the PLATE line at zero and leaves the blanks ABSENT -- not a refusal
    expect(runPipeline("swsock_boq", SS2_BOQ, SS2_ITEMS, S1_V23).finals).toEqual({ supply: 110, install: 30 });
    expect(runPipeline("swsock_bcs", SS2_BCS, SS2_ITEMS, S1_V23).finals).toEqual({ bcs_supply: 80 });
    const r = runPipeline("swsock_boq", SS2_BOQ, SS2_ITEMS, S1_V23);
    expect(fitTrace(r)).toContain("plate_item None");
    expect(fitTrace(r)).toContain("no plate_item -> no blanks");
  });

  it("SILENCE IS FILLED: the same ss1 row with NO stated plate computes 8M and still prices 740", () => {
    const silent = { ...SS1_V23, plate_item: "" };
    const r = runPipeline("swsock_boq", SS2_BOQ, SS2_ITEMS, silent);
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("plate_item 8M (next higher)");
    expect(r.finals).toEqual({ supply: 740, install: 150 });   // 7 -> 8M is the same plate ss1 states
  });

  it("THE 9M/16M FIX end-to-end on the REAL pipeline: a stated 9M plate prices with a 12M box", () => {
    // Before this slice the box bound @plate_item verbatim, so this row could not price AT ALL.
    // 258 + 425 + 564 + 61x2(blanks 9-7) + 443(9M plate) + 412(12M box) = 2224 raw
    // 2224 x0.3625 = 806.20 -> tens 810 ; 810 x0.2 = 162 -> tens 170
    const r = runPipeline("swsock_boq", SS2_BOQ, SS2_ITEMS, { ...SS1_V23, plate_item: "9M" });
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("box_item 12M (stated 9M) (next higher)");
    expect(r.steps.find((s) => s.produced?.key === "back_box")?.produced?.value).toBe(412);
    expect(r.finals).toEqual({ supply: 810, install: 170 });
  });
});

describe("SLICE 2 part 2 -- take-the-larger: the blanks invariant, pinned BOTH ways", () => {
  // The owner's instruction: pin that the PRIMARY path never goes negative, AND that the clamp
  // works if something ever does reach the subtraction with a smaller base.
  it("PRIMARY PATH: with floor_from set, blanks can NEVER go negative -- exhaustive over the ladder", () => {
    const pl: Pipeline = { output: ["blank_count"], steps: [floorFit()] };
    const plates = ["", "1M & 2M", "3M", "4M", "6M", "8M", "9M", "12M", "16M", "18M"];
    let sawUpgrade = false;
    for (const plate of plates) {
      for (let sockets = 0; sockets <= 8; sockets++) {
        for (let switches = 0; switches <= 2; switches++) {
          if (sockets === 0 && switches === 0) continue; // 0 modules -> honest no-compute
          const r = runPipeline("m", pl, LADDER_ITEMS, mfSel(sockets, 0, switches, { plate_item: plate }));
          if (r.status !== "ok") continue;               // above the ladder top -> honest no-compute
          expect(r.finals.blank_count, `plate=${plate} s=${sockets} w=${switches}`).toBeGreaterThanOrEqual(0);
          const trace = fitTrace(r);
          expect(trace).not.toContain("over-full, clamped");  // the clamp is never REACHED here
          if (trace.includes("UPGRADED")) sawUpgrade = true;
        }
      }
    }
    expect(sawUpgrade).toBe(true);                       // the sweep really did exercise upgrades
  });

  it("THE CLAMP: a base smaller than the contents yields 0 blanks, visibly, and still prices", () => {
    // reached only off the primary path (a blanks.stated_attr config, which floors no ladder)
    const pl: Pipeline = { output: ["blank_count"], steps: [modFit({ blanks: { bind: "blank_count", from_ladder: "plate_size", stated_attr: "plate_item" } })] };
    const r = runPipeline("m", pl, LADDER_ITEMS, mfSel(3, 0, 3, { plate_item: "3M" })); // 9 occupied, 3M base
    expect(r.status).toBe("ok");
    expect(r.finals).toEqual({ blank_count: 0 });
    expect(fitTrace(r)).toContain("holds 3, contents occupy 9 -- over-full, clamped");
  });

  it("A BoQ TYPO NO LONGER KILLS THE ROW: every stated plate from 1M to 18M prices at 7 modules", () => {
    // the whole point of replacing stated-wins: under the old rule, any stated plate below 8M
    // refused outright. Now each one either upgrades to 8M or is bought as stated.
    const pl: Pipeline = { output: ["blank_count"], steps: [floorFit()] };
    for (const plate of ["1M & 2M", "3M", "4M", "6M", "8M", "9M", "12M", "16M", "18M"]) {
      const r = runPipeline("m", pl, LADDER_ITEMS, mfSel(2, 0, 3, { plate_item: plate }));
      expect(r.status, `stated ${plate}`).toBe("ok");
      expect(r.finals.blank_count).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---- BLANKER SLICE / item 2: THE BLANKER'S COLOUR FOLLOWS THE ASSEMBLY (a GUARD, not a build) ----
//
// This behaviour ALREADY WORKED before this slice -- the blank component binds `colour: "@colour"`
// exactly like every other component -- but NOTHING pinned it. It was proven only indirectly, off
// pw3's green preview gate: pw3 is a GREY assembly carrying 2 blankers whose supply of 1740 is
// reachable only at the Grey list price of 79 (White, 61, would give 1728). These pins make that
// structural, so a future edit that hardcodes a colour on the blank ref fails loudly.
//
// ⚠️ THE ASSERTION IS THE PRICE PATH, NOT THE COLOUR STRING. Asserting `colour === "Grey"` would
// pass even if the ref resolved the wrong catalog ROW; asserting the resolved LINE VALUE is what
// proves the right row was priced. Real catalog list prices, live master 2026-08-06.
const BLANKER_WHITE = 61;
const BLANKER_GREY = 79;
const blankerItems: RateMasterItem[] = [
  // both blanker colours -- the pair the ref must choose between
  ssItem("Switch", "1M Blanker", "White", BLANKER_WHITE),
  ssItem("Switch", "1M Blanker", "Grey", BLANKER_GREY),
  // a switch + socket in BOTH colours, so the assembly itself can be either
  ssItem("Switch", "16A 1 WAY SWITCH", "White", 258), ssItem("Switch", "16A 1 WAY SWITCH", "Grey", 317),
  ssItem("Socket", "6A 3-Pin Socket", "White", 282), ssItem("Socket", "6A 3-Pin Socket", "Grey", 347),
  // the ladders (plate in both colours, box is colour NA)
  ...([["1M & 2M", 162, 200], ["3M", 204, 235], ["4M", 236, 292], ["6M", 302, 383], ["8M", 396, 480],
       ["9M", 443, 604], ["12M", 579, 679], ["16M", 689, 823], ["18M", 849, 1018]] as [string, number, number][])
    .flatMap(([it, w, g]) => [ssItem("Grid and Face Plates", it, "White", w), ssItem("Grid and Face Plates", it, "Grey", g)]),
  ...([["1M & 2M", 119], ["3M", 158], ["4M", 182], ["6M", 247], ["8M", 320], ["12M", 412], ["18M", 488]] as [string, number][])
    .map(([it, pr]) => ssItem("Back Box", it, "NA", pr)),
];
// 2 sockets + 3 switches = 7 modules -> an 8M plate -> 1 blank. One blank keeps the arithmetic
// readable: the blank LINE value IS the blanker's list price.
const blankerSel = (colour: string) => ({
  switch_item: "16A 1 WAY SWITCH", switch_qty: 3,
  socket1_item: "6A 3-Pin Socket", socket1_qty: 2,
  socket2_item: "None", socket2_qty: 0,
  blank_item: "1M Blanker",
  plate_item: "8M", plate_qty: 1,
  colour, back_box: "Yes",
});
const blankLineOf = (r: ReturnType<typeof runPipeline>) =>
  r.steps.find((s) => s.produced?.key === "blank")?.produced?.value;

describe("BLANKER SLICE -- the blanker's COLOUR follows the assembly (regression guard)", () => {
  it("P1: a GREY assembly resolves the GREY blanker row -- the LINE prices at 79, not 61", () => {
    const r = runPipeline("swsock_boq", SS2_BOQ, blankerItems, blankerSel("Grey"));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("1 blank");
    expect(blankLineOf(r)).toBe(BLANKER_GREY);          // 79 x 1 -- the PRICE PATH, not the string
    expect(blankLineOf(r)).not.toBe(BLANKER_WHITE);
    // and the trace names the row that was actually priced
    expect(r.steps.find((s) => s.produced?.key === "blank")?.refItem).toContain("Grey");
  });

  it("P2: a WHITE assembly resolves the WHITE blanker row -- the LINE prices at 61, not 79", () => {
    const r = runPipeline("swsock_boq", SS2_BOQ, blankerItems, blankerSel("White"));
    expect(r.status).toBe("ok");
    expect(fitTrace(r)).toContain("1 blank");
    expect(blankLineOf(r)).toBe(BLANKER_WHITE);          // 61 x 1
    expect(blankLineOf(r)).not.toBe(BLANKER_GREY);
    expect(r.steps.find((s) => s.produced?.key === "blank")?.refItem).toContain("White");
  });

  it("the colour is the ONLY thing that moves the blank line -- same row, two colours, two prices", () => {
    // the sharpest form of the guard: one selection, one attribute changed, the line must follow
    const grey = blankLineOf(runPipeline("swsock_boq", SS2_BOQ, blankerItems, blankerSel("Grey")));
    const white = blankLineOf(runPipeline("swsock_boq", SS2_BOQ, blankerItems, blankerSel("White")));
    expect(grey).not.toBe(white);
    expect(grey! - white!).toBe(BLANKER_GREY - BLANKER_WHITE);   // 18, the real catalog gap
  });

  it("NEGATIVE: a hardcoded colour on the blank ref would break the assembly link -- proven", () => {
    // This is what the P3 config pin (backend) prevents. Here we PROVE the harm: a blank ref that
    // hardcodes "White" prices a GREY assembly at the White blanker -- silently, with no error.
    const hardcoded: Pipeline = {
      ...SS2_BOQ,
      steps: SS2_BOQ.steps.map((s) =>
        (s as { name?: string }).name === "blank"
          ? { ...(s as object), ref: { kind: "switch_socket_item", family: "Switch", item: "@blank_item", colour: "White" } }
          : s
      ) as Pipeline["steps"],
    };
    const r = runPipeline("swsock_boq", hardcoded, blankerItems, blankerSel("Grey"));
    expect(r.status).toBe("ok");                      // it does NOT fail -- that is the danger
    expect(blankLineOf(r)).toBe(BLANKER_WHITE);       // the WRONG row, on a Grey assembly
    // the shipped config must never look like this; the backend pin asserts the ref binds @colour
  });

  it("pw3's shape is the production proof: a Grey assembly with TWO blankers costs 2 x 79", () => {
    // pw3 (point_wiring) is Grey with a computed blank count of 2. Its 1740 is only reachable at the
    // Grey price -- this reproduces that arithmetic on the switches_sockets pipeline shape.
    const twoBlanks = { ...blankerSel("Grey"), switch_qty: 3, socket1_qty: 2, plate_item: "9M" };
    const r = runPipeline("swsock_boq", SS2_BOQ, blankerItems, twoBlanks);   // 7 occupied on a 9M plate
    expect(fitTrace(r)).toContain("2 blanks");
    expect(blankLineOf(r)).toBe(BLANKER_GREY * 2);    // 158
  });
});

// ---- BLANKER SLICE / item 3: `blank_qty` is DERIVED and READ-ONLY ----
//
// ⚠️ WHY THESE PIN THE RULE AND NOT THE RENDER: this repo has NO DOM test environment (a deliberate
// choice recorded in frontend/CLAUDE.md), so a React render is STRUCTURALLY untestable here. The
// decision that can be WRONG -- which attributes are derived, and what value they show -- is
// extracted as two pure functions and pinned below; the render itself is verified in the browser
// cert. Following the repo's own rule: pages stay thin over pure logic (ADR-0010 F4).
//
// The derived-ness is READ FROM THE EXISTING CONFIG, not from a new key and not from a hardcoded
// attribute id: a component taking `qty: {from_fit: ...}` has SUPERSEDED its `<name>_qty`
// attribute, while one taking `qty: {from_attr: ...}` still reads it as a genuine input.
const cfgWith = (pipelines: Record<string, Pipeline>, defIds: string[]): RateCategoryConfig =>
  ({
    discipline: "Electrical",
    category_id: "probe",
    attribute_definitions: defIds.map((id) => ({ id, label: id, type: "number" as const })),
    pipelines,
  }) as RateCategoryConfig;
const qtyStep = (name: string, qty: unknown) => ({
  step: "component_ref" as const, name,
  ref: { kind: "switch_socket_item", family: "Switch", item: `@${name}_item`, colour: "@colour" },
  target: "list_price", rate_stages: [{ mult: 1 }], qty, none_skips: true,
});

describe("BLANKER SLICE -- derivedQtyAttrs: which attributes the config COMPUTES rather than accepts", () => {
  it("a component taking {from_fit} SUPERSEDES its <name>_qty attribute -> derived", () => {
    const cfg = cfgWith(
      { p: { output: ["supply"], steps: [qtyStep("blank", { from_fit: "blank_count" })] } },
      ["blank_qty", "switch_qty"],
    );
    const d = derivedQtyAttrs(cfg);
    expect([...d.keys()]).toEqual(["blank_qty"]);
    expect(d.get("blank_qty")).toEqual({ attrId: "blank_qty", ctxKey: "blank_count" });
  });

  it("BEFORE-STATE PIN: a component taking {from_attr} keeps its attribute an INPUT -> NOT derived", () => {
    // This is switches_point's live shape, and this pin is what keeps this slice from freezing a
    // field that is still genuinely editable there. It asserts the behaviour as it is TODAY.
    const cfg = cfgWith(
      { p: { output: ["supply"], steps: [qtyStep("blank", { from_attr: "blank_qty" })] } },
      ["blank_qty"],
    );
    expect(derivedQtyAttrs(cfg).size).toBe(0);
  });

  it("an attribute read as an input ANYWHERE is never derived, even if another step computes it", () => {
    const cfg = cfgWith(
      { a: { output: ["x"], steps: [qtyStep("blank", { from_fit: "blank_count" })] },
        b: { output: ["y"], steps: [qtyStep("blank", { from_attr: "blank_qty" })] } },
      ["blank_qty"],
    );
    expect(derivedQtyAttrs(cfg).size).toBe(0);   // the user stays in control
  });

  it("a {from_fit} with NO matching attribute definition marks nothing (point_wiring's conduit)", () => {
    // point_wiring's conduit line is qty {from_fit: "conduit_qty"} but there is no conduit_qty
    // ATTRIBUTE -- the rule must simply find nothing rather than inventing a field.
    const cfg = cfgWith(
      { p: { output: ["supply"], steps: [qtyStep("conduit", { from_fit: "conduit_qty" })] } },
      ["blank_qty"],
    );
    expect(derivedQtyAttrs(cfg).size).toBe(0);
  });

  it("BACKWARD COMPAT: a config with no qty objects at all derives nothing", () => {
    const cfg = cfgWith({ p: { output: ["supply"], steps: [qtyStep("blank", 1)] } }, ["blank_qty"]);
    expect(derivedQtyAttrs(cfg).size).toBe(0);
    expect(derivedQtyAttrs(cfgWith({}, ["blank_qty"])).size).toBe(0);
  });

  it("THE REAL SHAPES: both live categories derive blank_qty; the switches_point shape does not", () => {
    // switches_sockets / point_wiring (post slice 2p2) vs switches_point (still on from_attr)
    const migrated = cfgWith(
      { boq: { output: ["supply"], steps: [
        qtyStep("switch", { from_attr: "switch_qty" }),
        qtyStep("socket1", { from_attr: "socket1_qty" }),
        qtyStep("blank", { from_fit: "blank_count" }),
        qtyStep("plate", { from_attr: "plate_qty" }),
      ] } },
      ["switch_qty", "socket1_qty", "blank_qty", "plate_qty"],
    );
    expect([...derivedQtyAttrs(migrated).keys()]).toEqual(["blank_qty"]);  // ONLY blank_qty
    const legacy = cfgWith(
      { boq: { output: ["supply"], steps: [
        qtyStep("switch", { from_attr: "switch_qty" }),
        qtyStep("blank", { from_attr: "blank_qty" }),
      ] } },
      ["switch_qty", "blank_qty"],
    );
    expect(derivedQtyAttrs(legacy).size).toBe(0);
  });
});

describe("BLANKER SLICE -- derivedQtyValue: the computed value the display shows", () => {
  const run = (sel: Record<string, string | number>) =>
    [runPipeline("swsock_boq", SS2_BOQ, SS2_ITEMS, sel)];

  it("reads the computed blank count out of the pipeline trace", () => {
    // 2 sockets + 3 switches = 7 modules -> 8M plate -> 1 blank
    const results = run({ ...SS1_V23, switch_qty: 3, socket1_qty: 2, socket2_item: "None", socket2_qty: 0 });
    expect(derivedQtyValue(results, "blank_count")).toBe(1);
  });

  it("follows the assembly LIVE -- more sockets, a bigger plate, a different blank count", () => {
    // this is what makes the on-screen display update without a reload: the same pure read over a
    // freshly recomputed result set (the screen recomputes on every attribute change).
    const one = run({ ...SS1_V23, switch_qty: 3, socket1_qty: 2, socket2_item: "None", socket2_qty: 0 });
    const other = run({ ...SS1_V23, switch_qty: 1, socket1_qty: 1, socket2_item: "None", socket2_qty: 0, plate_item: "8M" });
    expect(derivedQtyValue(one, "blank_count")).toBe(1);      // 8M holds 8, 7 occupied
    expect(derivedQtyValue(other, "blank_count")).toBe(5);    // 8M holds 8, 3 occupied
  });

  it("a NONE plate computes NO blank count -> undefined, so the display stays EMPTY not 0", () => {
    // blanks fill a plate; with no plate there are none. A 0 would read as "zero needed", which is a
    // different claim from "not applicable". The known edge, rendered honestly.
    const results = run({ ...SS1_V23, plate_item: "None", plate_qty: 0, blank_item: "None" });
    expect(derivedQtyValue(results, "blank_count")).toBeUndefined();
  });

  it("an unknown ctx key is undefined, never a fabricated 0", () => {
    expect(derivedQtyValue(run(SS1_V23), "no_such_key")).toBeUndefined();
    expect(derivedQtyValue([], "blank_count")).toBeUndefined();
  });

  it("THE DEFECT THIS FIXES: the computed count and the priced line agree", () => {
    // Before this slice the form showed blank_qty 0 while the blank line priced at 1. The displayed
    // value and the priced quantity are now the SAME number, by construction.
    const sel = { ...SS1_V23, switch_qty: 3, socket1_qty: 2, socket2_item: "None", socket2_qty: 0 };
    const r = runPipeline("swsock_boq", SS2_BOQ, SS2_ITEMS, sel);
    const shown = derivedQtyValue([r], "blank_count");
    const blankLine = r.steps.find((s) => s.produced?.key === "blank")?.produced?.value;
    expect(shown).toBe(1);
    expect(blankLine).toBe(61 * shown!);      // White 1M Blanker list 61 x the SHOWN count
  });
});

// CP2 Phase B: WHY the numeric dropdown type exists, proven at the matcher.
//
// `matchMasterRow` compares with `===` on the keys the row carries. A dropdown option is a STRING,
// so a numeric catalog column reached through a plain `choice` produces "3" and matches nothing --
// silently, with no error and no golden able to see it (the goldens hand `runPipeline` numbers
// directly and never touch the coercion). `number_choice` is what makes the picked option a number.
describe("CP2 -- strict identity matching is why number_choice exists", () => {
  const items: RateMasterItem[] = [
    {
      discipline: "Electrical",
      kind: "cable",
      attributes: { material: "COPPER", insulation: "UNARMOURED", core: 3, thickness_sqmm: 1.5 },
      rates: { list_rate: 100 },
    },
  ];
  const base = { material: "COPPER", insulation: "UNARMOURED", thickness_sqmm: 1.5 };

  it("a NUMBER core matches the catalog row", () => {
    expect(matchMasterRow(items, "cable", { ...base, core: 3 })).toBeDefined();
  });
  it("the SAME core as a STRING matches nothing -- the CP2 defect, pinned", () => {
    expect(matchMasterRow(items, "cable", { ...base, core: "3" })).toBeUndefined();
  });
  it("a coerced number_choice value goes in as a number, a choice value as a string", () => {
    const def = { id: "core", label: "Core", type: "number_choice" as const, values_from: { kind: "cable", attr: "core" } };
    const asNum = coerceForMatch(def, "3");
    const asStr = coerceForMatch({ ...def, type: "choice" as const }, "3");
    expect(matchMasterRow(items, "cable", { ...base, core: asNum as number })).toBeDefined();
    expect(matchMasterRow(items, "cable", { ...base, core: asStr as string })).toBeUndefined();
  });
});

// ---- CIRCUIT LENGTH part 1: THE WALL, pinned BEFORE the capability existed ------------------------
// Every value a step computes lands in `ctx`. But the two readers a derived attribute must reach read
// the SELECTION and never consult `ctx`:
//     circuit_fit   -> Number(selected[p.length_attr])
//     resolveQty    -> Number(selected[qty.from_attr])
// and nothing anywhere writes into the selection. These pins state that wall as an executable fact, so
// the capability that crosses it cannot be built by quietly widening a reader instead: a `ctx` entry of
// the SAME NAME must remain invisible to both, before AND after. They are written to be green on the
// pre-capability code and to STAY green after it -- a red here means a reader's semantics moved.
const LEN_CTX_ITEMS: RateMasterItem[] = [
  ...PW_ITEMS,
  // A matched row whose RATES carry the very key the readers want. match_master_row copies every rate
  // into ctx, so after this step ctx.circuit_length_m === 45 -- and both readers must still see nothing.
  { discipline: "Electrical", kind: "lenrow", attributes: { tag: "L" }, rates: { circuit_length_m: 45, list_price: 100 } },
];
// The selection DELIBERATELY omits circuit_length_m. Only ctx will carry it.
const { circuit_length_m: _pw1Len, ...PW1_NO_LENGTH } = PW1;

describe("the wall -- a computed value in ctx is invisible to the selection readers", () => {
  it("circuit_fit reads the SELECTION: a ctx entry named circuit_length_m does NOT satisfy length_attr", () => {
    const pl: Pipeline = {
      output: ["supply"],
      steps: [
        { step: "match_master_row", params: { kind: "lenrow" } },
        PW_CIRCUIT_FIT,
        { step: "sum_components", result: "supply" },
      ],
    };
    const r = runPipeline("wall_fit", pl, LEN_CTX_ITEMS, PW1_NO_LENGTH);
    // ctx really does carry it -- so this is a pin on the READER, not on an empty ctx.
    expect(r.steps[0].runningValues.circuit_length_m).toBe(45);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
    expect(r.steps[1].label).toContain("circuit_length_m");
  });

  it("resolveQty's from_attr reads the SELECTION: a ctx entry of the same name does NOT supply the qty", () => {
    const pl: Pipeline = {
      output: ["supply"],
      steps: [
        { step: "match_master_row", params: { kind: "lenrow" } },
        cref("wire1", wireRef("@wire1_core", "@wire1_thickness_sqmm"), "list_price_per_mtr", [{ mult: 1 }], {
          from_attr: "circuit_length_m",
        }),
        { step: "sum_components", result: "supply" },
      ],
    };
    const r = runPipeline("wall_qty", pl, LEN_CTX_ITEMS, PW1_NO_LENGTH);
    expect(r.steps[0].runningValues.circuit_length_m).toBe(45);
    expect(r.status).toBe("no_match");
    expect(r.steps[1].matchedCondition).toContain("quantity not provided");
  });

  it("runPipeline NEVER mutates the caller's selection object", () => {
    // The form's state means "what the user or extraction supplied". Whatever mechanism lets a computed
    // value reach the readers, it must not write back into the caller's object -- a computed value would
    // then be indistinguishable from a stated one to every later reader.
    const before = { ...PW1 };
    runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, PW1);
    expect(PW1).toEqual(before);
  });
});

// ---- CIRCUIT LENGTH part 1: THE CAPABILITY (code only -- NO config, nothing live) ----------------
//
// The rule this exists for: circuit length = 15 + (N - 1) x 5, N = the number of points. 15 is right
// only for N=1, so every multi-point row was under-priced at the flat default. The arithmetic was
// expressible already; what was missing was any way for a COMPUTED value to reach the readers, which
// look in the selection and not in `ctx` (see "the wall" above). NOTHING here is config -- the
// formula, the source attribute and the target attribute are all supplied by the test exactly as a
// category config would supply them, which is the point of the step being parameterised.
const POINTS_ATTR = "point_count";
const LEN_ATTR = "circuit_length_m";
/** The owner's rule, expressed the way config expresses it: identifiers bound from attributes plus
 * named constants, with the arithmetic itself read from the `formula` string. */
const DERIVE_LEN = {
  step: "derive_attribute" as const,
  params: {
    result_attr: LEN_ATTR,
    terms: [{ ident: "n", attr: POINTS_ATTR }],
    constants: { base: 15, per_extra: 5 },
    formula: "base + (n - 1) * per_extra",
    unit: "m",
  },
  explain: "circuit length grows with the number of points",
};
/** pw1's attributes with the length REMOVED and a point count stated instead. */
const derivedLenAttrs = (points: number | string | undefined) => {
  const a: Record<string, string | number> = { ...PW1_NO_LENGTH };
  if (points !== undefined) a[POINTS_ATTR] = points;
  return a;
};
/** pw_boq_supply with the derivation prepended -- the shape a wired category would carry. */
const withDerivedLen = (pl: Pipeline): Pipeline => ({ ...pl, steps: [DERIVE_LEN, ...pl.steps] });

describe("derive_attribute -- a computed value REACHES the selection readers", () => {
  it("circuit_fit's length_attr sees the computed value: 7 points -> 45 m", () => {
    const pl = withDerivedLen(PW_PIPELINES.pw_boq_supply);
    const r = runPipeline("pw_boq_supply", pl, PW_ITEMS, derivedLenAttrs(7));
    expect(r.status).toBe("ok");
    // The SAME row priced with a hand-stated 45 must give the SAME number -- the derivation is a way
    // of supplying the input, not a second pricing rule.
    const stated45 = runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, { ...PW1, [LEN_ATTR]: 45 });
    expect(r.finals).toEqual(stated45.finals);
    // ...and it must NOT equal the flat-15 price, or the capability would be doing nothing.
    expect(r.finals.supply).not.toBe(1869);
  });

  it("a component's {from_attr} quantity sees it too -- BOTH readers, not just circuit_fit", () => {
    // wire1/wire2 take qty {from_attr: circuit_length_m}; conduit takes {from_fit}. If only
    // circuit_fit could see the derived value the wire lines would refuse and the row would not price.
    const r = runPipeline("pw_boq_supply", withDerivedLen(PW_PIPELINES.pw_boq_supply), PW_ITEMS, derivedLenAttrs(7));
    const line = (name: string) => r.steps.find((s) => s.produced?.key === name)?.produced?.value;
    expect(line("wire1")).toBe(50 * 45); // ceil(82.95*0.602)=50, x 45 m
    expect(line("wire2")).toBe(31 * 45); // ceil(50.45*0.602)=31, x 45 m
  });

  it("N=1 reproduces the flat 15 -- the old default was right for a single point", () => {
    const r = runPipeline("pw_boq_supply", withDerivedLen(PW_PIPELINES.pw_boq_supply), PW_ITEMS, derivedLenAttrs(1));
    expect(r.finals).toEqual({ supply: 1869 }); // the banked pw1 oracle
  });

  it("the trace SHOWS THE WORKING, formula substituted with its own numbers", () => {
    const r = runPipeline("pw_boq_supply", withDerivedLen(PW_PIPELINES.pw_boq_supply), PW_ITEMS, derivedLenAttrs(7));
    expect(r.steps[0].matchedCondition).toBe(
      "point_count 7 -> circuit_length_m = 15 + (7 - 1) * 5 = 45 m",
    );
  });

  it("publishes the outcome as STRUCTURED DATA, read by the ONE reader (never by parsing the prose)", () => {
    const r = runPipeline("pw_boq_supply", withDerivedLen(PW_PIPELINES.pw_boq_supply), PW_ITEMS, derivedLenAttrs(7));
    expect(r.steps[0].derivedAttr).toEqual({ attr: LEN_ATTR, value: 45, stated: false, unit: "m" });
    const found = derivedAttrOutcomes([r]);
    expect(found.get(LEN_ATTR)).toEqual({ attr: LEN_ATTR, value: 45, stated: false, unit: "m" });
  });

  it("the caller's selection is STILL never mutated -- the computed value lives in the overlay", () => {
    const attrs = derivedLenAttrs(7);
    const before = { ...attrs };
    runPipeline("pw_boq_supply", withDerivedLen(PW_PIPELINES.pw_boq_supply), PW_ITEMS, attrs);
    expect(attrs).toEqual(before);
    expect(LEN_ATTR in attrs).toBe(false);
  });
});

describe("derive_attribute -- A STATED VALUE WINS (no floor, no warning)", () => {
  it("a stated length is kept VERBATIM and the computation does not run", () => {
    // 7 points would derive 45. The row says 60 -- a pricer who knows the run is long -- and 60 is
    // simply right. Unlike the plate there is no floor: the larger of the two does NOT win, the
    // STATED one does, and nothing warns.
    const attrs = { ...derivedLenAttrs(7), [LEN_ATTR]: 60 };
    const r = runPipeline("pw_boq_supply", withDerivedLen(PW_PIPELINES.pw_boq_supply), PW_ITEMS, attrs);
    const stated60 = runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, { ...PW1, [LEN_ATTR]: 60 });
    expect(r.finals).toEqual(stated60.finals);
    expect(r.steps[0].derivedAttr).toEqual({ attr: LEN_ATTR, value: null, stated: true, statedValue: 60, unit: "m" });
    expect(r.steps[0].matchedCondition).toContain("kept (a stated value wins)");
  });

  it("THE OTHER DIRECTION: a stated value SMALLER than the computed one is kept too (no floor)", () => {
    // The take-the-larger rule would upgrade 20 to 45 here and say so. This attribute must NOT: a
    // short run is a real answer. Pinning both directions is what stops the plate rule leaking over.
    const attrs = { ...derivedLenAttrs(7), [LEN_ATTR]: 20 };
    const r = runPipeline("pw_boq_supply", withDerivedLen(PW_PIPELINES.pw_boq_supply), PW_ITEMS, attrs);
    const stated20 = runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, { ...PW1, [LEN_ATTR]: 20 });
    expect(r.finals).toEqual(stated20.finals);
    expect(r.steps[0].derivedAttr?.stated).toBe(true);
    // NEGATIVE: no upgrade note anywhere -- that vocabulary belongs to the plate, not here.
    expect(JSON.stringify(r.steps[0])).not.toContain("UPGRADED");
  });

  it("a stated value prices even when the SOURCE attribute is unreadable", () => {
    // Stated-wins is checked BEFORE the terms are read, so a row that states its length is immune to
    // an unreadable point count. A stated value that only worked when the derivation could also have
    // run would not really be authoritative.
    const attrs = { ...PW1_NO_LENGTH, [POINTS_ATTR]: "seven", [LEN_ATTR]: 45 };
    const r = runPipeline("pw_boq_supply", withDerivedLen(PW_PIPELINES.pw_boq_supply), PW_ITEMS, attrs);
    expect(r.status).toBe("ok");
    expect(r.steps[0].derivedAttr?.stated).toBe(true);
  });
});

describe("derive_attribute -- HONEST NO-COMPUTE (never a silent zero, never a guess)", () => {
  const refuses = (attrs: Record<string, string | number>, needle: string) => {
    const r = runPipeline("pw_boq_supply", withDerivedLen(PW_PIPELINES.pw_boq_supply), PW_ITEMS, attrs);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
    expect(r.steps[0].label).toContain(needle);
    // NEGATIVE: nothing was published as an outcome, so no surface can show an invented value.
    expect(r.steps[0].derivedAttr).toBeUndefined();
    expect(derivedAttrOutcomes([r]).size).toBe(0);
  };

  it("MISSING source attribute -> refuses, naming it (not 15, not 0)", () => {
    refuses(derivedLenAttrs(undefined), POINTS_ATTR);
  });
  it("NON-NUMERIC source attribute -> refuses", () => {
    refuses(derivedLenAttrs("seven"), POINTS_ATTR);
  });
  it("BLANK source attribute -> refuses", () => {
    refuses(derivedLenAttrs(""), POINTS_ATTR);
  });
  it("the 'None' sentinel is not a number here -> refuses", () => {
    refuses(derivedLenAttrs(NONE_SENTINEL), POINTS_ATTR);
  });

  it("a MALFORMED step declares nothing -- its own refusal, distinct from an unreadable input", () => {
    // "declared no target" is not the same statement as "the input could not be read", so collapsing
    // them would let a broken config look like a data gap (the module_fit precedent).
    const pl: Pipeline = { output: ["supply"], steps: [blankStep("derive_attribute"), ...PW_PIPELINES.pw_boq_supply.steps] };
    const r = runPipeline("pw_boq_supply", pl, PW_ITEMS, derivedLenAttrs(7));
    expect(r.status).toBe("no_match");
    expect(r.steps[0].label).toContain("declares no result_attr");
  });

  it("OPTION C: an unbound identifier in the formula degrades to `unsupported`, never throws", () => {
    const pl: Pipeline = {
      output: ["supply"],
      steps: [
        { ...DERIVE_LEN, params: { ...DERIVE_LEN.params, formula: "base + mystery" } },
        ...PW_PIPELINES.pw_boq_supply.steps,
      ],
    };
    expect(() => runPipeline("pw_boq_supply", pl, PW_ITEMS, derivedLenAttrs(7))).not.toThrow();
    expect(runPipeline("pw_boq_supply", pl, PW_ITEMS, derivedLenAttrs(7)).status).toBe("unsupported");
  });
});

describe("derive_attribute -- BACKWARD COMPATIBILITY (the shared readers are untouched)", () => {
  it("a pipeline with NO derive_attribute step is unaffected, traces included", () => {
    // The selection overlay is the only change on that path, and a copy of a primitive-valued map is
    // the map. Every category shares this interpreter, so this is the invariant that matters most.
    for (const [pid, pl] of Object.entries(PW_PIPELINES)) {
      for (const attrs of [PW1, PW2, PW3, PW_SINGLE_WIRE]) {
        const r = runPipeline(pid, pl, PW_ITEMS, attrs);
        expect(r.steps.every((s) => s.derivedAttr === undefined)).toBe(true);
      }
    }
    expect(runPipeline("pw_boq_supply", PW_PIPELINES.pw_boq_supply, PW_ITEMS, PW1).finals).toEqual({ supply: 1869 });
  });

  it("the derived value is scoped to ONE run -- it never leaks into the next pipeline's inputs", () => {
    const attrs = derivedLenAttrs(7);
    runPipeline("pw_boq_supply", withDerivedLen(PW_PIPELINES.pw_boq_supply), PW_ITEMS, attrs);
    // A second pipeline WITHOUT the derivation must still see no length and refuse honestly.
    const plain = runPipeline("pw_boq_install", PW_PIPELINES.pw_boq_install, PW_ITEMS, attrs);
    expect(plain.status).toBe("no_match");
  });
});

// ---- BLANKER ITEM BIND + THE EFFECTIVE-COUNT ARBITRATION ---------------------------------------
// The blanker is no longer SELECTED by extraction. `module_fit` publishes the blanker's ITEM through
// the same `fitLabels` scope a ladder publishes its fitted rung into, so the blank component's ref
// stays an ordinary "@"-reference and NOTHING SHARED CHANGES.
//
// The trap these tests fence off: putting the LITERAL "None" in the ref instead. The `none_skips`
// short-circuit tests the "@" prefix FIRST, so a literal never reaches it, is taken as a CATALOG
// MATCH KEY, matches no row, and returns a WHOLE-PIPELINE no_match -- the entire row unpriceable,
// wire and conduit included. The last test pins that failure so the "obvious" implementation can
// never quietly come back.
const BLANK_ITEM = "1M Blanker";
const blankerFit = (over: Record<string, unknown> = {}) => ({
  step: "module_fit" as const,
  params: {
    terms: SS_TERMS,
    ladders: [
      { kind: "switch_socket_item", where: { family: "Grid and Face Plates" }, bind: "plate_item", floor_from: "plate_item", on_none: "none" },
      { kind: "switch_socket_item", where: { family: "Back Box" }, bind: "box_item", floor_from: "plate_item", on_none: "computed" },
    ],
    blanks: {
      bind: "blank_count", from_ladder: "plate_item",
      qty_attr: "blank_qty", bind_item: "blank_fit_item", item_when_positive: BLANK_ITEM,
    },
    ...over,
  },
});
/** The blank line as the shipped configs express it -- the ref reads the BOUND item, never `blank_item`. */
const BLANK_LINE = {
  step: "component_ref" as const, name: "blank",
  ref: { kind: "switch_socket_item", family: "Switch", item: "@blank_fit_item", colour: "@colour" },
  target: "list_price", rate_stages: [{ mult: 1 }], qty: { from_fit: "blank_count" },
  none_skips: true,
};
const BLANKER_ITEMS: RateMasterItem[] = [
  ...LADDER_ITEMS,
  ssItem("Switch", BLANK_ITEM, "White", 61), ssItem("Switch", BLANK_ITEM, "Grey", 79),
];
/** module_fit alone -- for reading the bind and the outcome. */
const runFit = (sel: Record<string, string | number>, over: Record<string, unknown> = {}) =>
  runPipeline("m", { output: [], steps: [blankerFit(over)] }, BLANKER_ITEMS, sel);
/** module_fit + the blank line + a sum -- for reading what the row actually PRICES. */
const runPriced = (sel: Record<string, string | number>, over: Record<string, unknown> = {}) =>
  runPipeline(
    "m",
    { output: ["supply"], steps: [blankerFit(over), BLANK_LINE, { step: "sum_components", result: "supply" }] },
    BLANKER_ITEMS,
    sel,
  );
const fitOutcome = (r: ReturnType<typeof runPipeline>) =>
  r.steps.find((s) => s.step === "module_fit")?.moduleFit;
const blankRefStep = (r: ReturnType<typeof runPipeline>) =>
  r.steps.find((s) => s.produced?.key === "blank");
const blankRefValue = (r: ReturnType<typeof runPipeline>) => blankRefStep(r)?.produced?.value;

describe("BLANKER -- the item bind follows the EFFECTIVE count", () => {
  it("POSITIVE (R1): a positive count binds the blanker and PRICES it, in the assembly's colour", () => {
    const r = runPriced(mfSel(2, 1, 1, { blank_qty: 1 }));   // 2x2 + 2x1 + 1x1 = 7 -> 8M plate, 1 spare
    expect(r.status).toBe("ok");
    expect(fitOutcome(r)?.blanks).toEqual({ spare: 1, effective: 1, stated: 1, capped: false, uncovered: 0 });
    expect(blankRefValue(r)).toBe(61);                          // White 1M Blanker x 1
    expect(r.finals.supply).toBe(61);
  });

  it("POSITIVE (R1): the colour follows the ASSEMBLY -- a Grey row prices the Grey blanker", () => {
    expect(blankRefValue(runPriced(mfSel(2, 1, 1, { blank_qty: 1, colour: "Grey" })))).toBe(79);
  });

  it("POSITIVE (R1): extraction's own `blank_item` is IGNORED -- 'None' no longer suppresses the line", () => {
    // THE WHOLE POINT. Before the bind, this row priced 0 because the model answered "None".
    expect(blankRefValue(runPriced(mfSel(2, 1, 1, { blank_qty: 1, blank_item: "None" })))).toBe(61);
  });

  it("POSITIVE (R2): a ZERO spare binds the SENTINEL -- the line reads absent, not a blanker x 0", () => {
    const r = runPriced(mfSel(1, 0, 1, {}));                 // 2x1 + 1x1 = 3 -> a 3M plate, 0 spare
    expect(fitOutcome(r)?.blanks).toEqual({ spare: 0, effective: 0, capped: false, uncovered: 0 });
    expect(blankRefValue(r)).toBe(0);
    expect(blankRefStep(r)?.matchedCondition).toBe("None -> 0");
  });

  // ---- R3: THE BOUNDARY FOLLOWS THE EFFECTIVE COUNT, NOT THE COMPUTED ONE ----------------------
  it("R3: editing the quantity to ZERO on a row that COMPUTED one reverts the item to None", () => {
    const computed = runPriced(mfSel(2, 1, 1, {}));          // nothing stated -> the computed spare of 1
    expect(blankRefStep(computed)?.matchedCondition).toBe("rate 61 x qty 1");

    const edited = runPriced(mfSel(2, 1, 1, { blank_qty: 0 }));
    expect(fitOutcome(edited)?.blanks).toEqual({ spare: 1, effective: 0, stated: 0, capped: false, uncovered: 1 });
    // the ITEM reverted -- the line is positively absent, NOT a blanker bought zero times
    expect(blankRefStep(edited)?.matchedCondition).toBe("None -> 0");
    expect(blankRefValue(edited)).toBe(0);
  });

  it("R3: the effective count is what flips the bind, at every step from the spare down to zero", () => {
    expect(fitOutcome(runFit(mfSel(2, 1, 1, { blank_qty: 1 })))?.blanks?.effective).toBe(1);
    expect(fitOutcome(runFit(mfSel(2, 1, 1, { blank_qty: 0 })))?.blanks?.effective).toBe(0);
    expect(blankRefStep(runPriced(mfSel(2, 1, 1, { blank_qty: 1 })))?.matchedCondition).toBe("rate 61 x qty 1");
    expect(blankRefStep(runPriced(mfSel(2, 1, 1, { blank_qty: 0 })))?.matchedCondition).toBe("None -> 0");
  });

  // ---- R5 / R6: THE ASYMMETRY ------------------------------------------------------------------
  it("R5 (over-count is CORRECTED): stated 2 against ONE spare prices 1 and reports capped", () => {
    const r = runPriced(mfSel(2, 1, 1, { blank_qty: 2 }));
    expect(fitOutcome(r)?.blanks).toEqual({ spare: 1, effective: 1, stated: 2, capped: true, uncovered: 0 });
    expect(blankRefValue(r)).toBe(61);                          // ONE blanker, not two
    expect(fitTrace(r)).toContain("(stated 2 exceeds the spare -- pricing 1)");
  });

  it("R5: the ceiling is the SPARE, never the plate's TOTAL -- an 8M plate holding 7 caps at 1", () => {
    expect(fitOutcome(runFit(mfSel(2, 1, 1, { blank_qty: 8 })))?.blanks?.effective).toBe(1);
  });

  it("R6 (under-count is HONOURED): stated 1 against THREE spare prices 1 and says 2 stay uncovered", () => {
    const r = runPriced(mfSel(1, 0, 1, { plate_item: "6M", blank_qty: 1 })); // 3 occupied on 6M -> 3 spare
    expect(fitOutcome(r)?.blanks).toEqual({ spare: 3, effective: 1, stated: 1, capped: false, uncovered: 2 });
    expect(blankRefValue(r)).toBe(61);                          // the USER'S number, NOT the computed 3
    expect(fitTrace(r)).toContain("(stated 1 -- pricing 1, 2 left uncovered)");
  });

  it("NEGATIVE (R6 must never invert): the user's lower value is never raised to the spare", () => {
    const cases: [number, string, number][] = [[0, "4M", 1], [1, "6M", 3], [2, "8M", 5]];
    for (const [stated, plate, spare] of cases) {
      const r = runFit(mfSel(1, 0, 1, { plate_item: plate, blank_qty: stated }));
      expect(fitOutcome(r)?.blanks?.spare).toBe(spare);
      expect(fitOutcome(r)?.blanks?.effective).toBe(stated);
      expect(fitOutcome(r)?.blanks?.capped).toBe(false);
    }
  });

  it("R4 (SEEDING): nothing stated -> the computed spare prices, and no arbitration is reported", () => {
    const r = runPriced(mfSel(2, 1, 1, {}));
    expect(fitOutcome(r)?.blanks).toEqual({ spare: 1, effective: 1, capped: false, uncovered: 0 });
    expect(fitOutcome(r)?.blanks?.stated).toBeUndefined();
    expect(fitTrace(r)).not.toContain("stated");
  });

  it("a BLANK / non-numeric / NEGATIVE / None entry is not a statement -- it defers to the spare", () => {
    for (const bad of ["", "abc", -1, "None"] as const) {
      const r = runFit(mfSel(2, 1, 1, { blank_qty: bad }));
      expect(fitOutcome(r)?.blanks?.effective).toBe(1);
      expect(fitOutcome(r)?.blanks?.stated).toBeUndefined();
    }
  });

  // ---- THE TWO ABSENT PATHS MUST STILL BIND -----------------------------------------------------
  it("a ZERO module count binds the sentinel -- and the row still PRICES (never a bindMiss)", () => {
    const r = runPriced(mfSel(0, 0, 0, {}));                 // nothing on the plate at all
    expect(r.status).toBe("ok");
    expect(blankRefValue(r)).toBe(0);
    expect(fitTrace(r)).toContain("no plate -> 0 blanks");
  });

  it("a None PLATE binds the sentinel -- the s1 shape still prices (this is the regression)", () => {
    // s1: a lone socket with plate None. The count binds NOTHING here (an uncomputed blank count must
    // render empty, not 0), so ONLY the item bind stands between this row and a whole-pipeline refusal.
    const r = runPriced(mfSel(1, 0, 0, { plate_item: "None" }));
    expect(r.status).toBe("ok");
    expect(blankRefValue(r)).toBe(0);
    expect(fitTrace(r)).toContain("no plate_item -> no blanks");
    expect(fitOutcome(r)?.blanks).toBeUndefined();          // nothing counted -> nothing claimed
  });

  // ---- BACKWARDS COMPATIBILITY ------------------------------------------------------------------
  it("NEGATIVE: a blanks block with NO bind_item / qty_attr is byte-identical to before", () => {
    const legacy = { blanks: { bind: "blank_count", from_ladder: "plate_item" } };
    const r = runFit(mfSel(2, 1, 1, { blank_qty: 99 }), legacy);
    expect(fitOutcome(r)?.blanks).toEqual({ spare: 1, effective: 1, capped: false, uncovered: 0 });
    expect(fitTrace(r)).toBe(
      "2 x socket1_qty(2) + 2 x socket2_qty(1) + 1 x switch_qty(1) = 7 modules -> " +
      "plate_item 8M (next higher), box_item 8M (next higher); 1 blank (plate_item 8 - 7)",
    );
  });

  it("NEGATIVE: the base trace sentence is UNCHANGED when nothing was stated", () => {
    expect(fitTrace(runFit(mfSel(2, 1, 1, {})))).toContain("; 1 blank (plate_item 8 - 7)");
  });

  it("MALFORMED: bind_item with no item_when_positive REFUSES rather than silently pricing zero", () => {
    const broken = { blanks: { bind: "blank_count", from_ladder: "plate_item", bind_item: "blank_fit_item" } };
    const r = runFit(mfSel(2, 1, 1, {}), broken);
    expect(r.status).toBe("no_match");
    // a bail() carries its cause on `label`, not `matchedCondition` (which fitTrace reads)
    expect(r.steps.find((s) => s.step === "module_fit")?.label)
      .toContain("bind_item with no item_when_positive");
  });

  // ---- THE LITERAL TRAP, PINNED SO IT CANNOT RETURN ----------------------------------------------
  it("a LITERAL None in the ref does NOT short-circuit -- it kills the WHOLE pipeline", () => {
    // The obvious implementation, and it is wrong: `none_skips` tests the "@" prefix first, so the
    // literal is taken as a catalog match key, matches nothing, and refuses the entire row -- wire and
    // conduit included, not merely the blank line. This is why the item is bound through fitLabels.
    const literalLine = { ...BLANK_LINE, ref: { ...BLANK_LINE.ref, item: "None" } };
    const r = runPipeline(
      "m",
      { output: ["supply"], steps: [blankerFit(), literalLine, { step: "sum_components", result: "supply" }] },
      BLANKER_ITEMS,
      mfSel(1, 0, 1, {}),
    );
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
    expect(r.steps.find((s) => s.step === "component_ref")?.matchedCondition)
      .toContain("no matching row(s)");
  });
});

// =======================================================================================================
// F-18 -- NO NON-FINITE NUMBER IS EVER LABELLED "ok".
//
// The recon found FIVE entry points, not one. Each bound or computed a value that could be absent and
// let the result reach `finals` under `status: "ok"`:
//   E1 component                  -- `ctx[target]` undefined; the evaluator's `in` guard tests KEY
//                                    PRESENCE, so `{ base: undefined }` passed and returned NaN
//   E2 component_band             -- the same, planted under THREE identifiers at once
//   E3 apply_effective_multiplier -- the multiply is OUTSIDE the formula, so no guard was even on the path
//   E4 roundup                    -- roundUp(undefined, d) = NaN, written back into ctx
//   E5 install_as_ratio           -- did not FAIL into NaN, it ASSIGNED one (`: NaN`)
// plus THE CHAIN: `scale`'s honest partial creates the hole that the next unguarded step converts to NaN
// (why the same missing key gave an honest partial in conduit_bcs and a NaN in conduit_boq), and THE
// BACKSTOP for anything none of the five cover.
//
// The contract these pin: a missing rate on a row we DID match REFUSES; an output that could not be
// computed is ABSENT, never zero and never NaN; and `status: "ok"` now makes a claim about the numbers.
//
// WARNING: every assertion uses `Number.isNaN` / `status` / `toBeUndefined`, NEVER `JSON.stringify` --
// NaN serialises to `null`, so a stringified assertion would pass against a genuine null.
// =======================================================================================================
describe("F-18 -- a non-finite number is never labelled ok", () => {
  // ONE fixture: the row carries `list_price` and DELIBERATELY NOT `install_base`. That single absence
  // drives every entry point below, which is the point -- it is one defect wearing five costumes.
  const F18_ITEMS: RateMasterItem[] = [
    { discipline: "Electrical", kind: "f18_kind", attributes: { size: "10" }, rates: { list_price: 100 } },
  ];
  const SEL = { size: "10" };
  const MATCH = { step: "match_master_row", params: { kind: "f18_kind" } };
  const run = (steps: unknown[], output: string[]) =>
    runPipeline("f18", { output, steps } as unknown as Pipeline, F18_ITEMS, SEL);
  const stepNamed = (r: ReturnType<typeof runPipeline>, name: string) =>
    r.steps.find((s) => s.step === name);

  // ---- E1 component -----------------------------------------------------------------------------
  it("E1 POSITIVE: a `component` whose target is not on the matched row REFUSES (never a NaN sum)", () => {
    const r = run([
      MATCH,
      { step: "component", name: "good", target: "list_price", formula: "base*f", params: { f: 1 } },
      { step: "component", name: "missing", target: "install_base", formula: "base*f", params: { f: 1 } },
      { step: "sum_components", result: "supply" },
    ], ["supply"]);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
    expect(Number.isNaN(r.finals.supply)).toBe(false);
    expect(r.steps[r.steps.length - 1].matchedCondition)
      .toBe("install_base not on the matched row -- not computed");
  });

  it("E1 POSITIVE: the bare `base` formula (no operator) refuses too -- it returned `undefined`, not NaN", () => {
    // The subtler half of the same hole: with no arithmetic the evaluator handed back `undefined`
    // itself, which only became NaN once sum_components reduced over it.
    const r = run([
      MATCH,
      { step: "component", name: "missing", target: "install_base", formula: "base" },
      { step: "sum_components", result: "supply" },
    ], ["supply"]);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
  });

  it("E1 NEGATIVE: a component whose target IS on the row is byte-unchanged", () => {
    const r = run([
      MATCH,
      { step: "component", name: "good", target: "list_price", formula: "base*f", params: { f: 2 } },
      { step: "sum_components", result: "supply" },
    ], ["supply"]);
    expect(r.status).toBe("ok");
    expect(r.finals).toEqual({ supply: 200 });
  });

  it("E1 NEGATIVE: a param-only component (NO target at all) still prices -- the guard is inside the target branch", () => {
    // The tray ceiling-accessories shape: a conditional component carrying no `target`. The F-18 guard
    // must not touch it, or every fixed-scalar adder in the catalog stops computing.
    const r = run([
      MATCH,
      { step: "component", name: "fixed", formula: "amount", params: { amount: 106 } },
      { step: "sum_components", result: "supply" },
    ], ["supply"]);
    expect(r.status).toBe("ok");
    expect(r.finals).toEqual({ supply: 106 });
  });

  // ---- E2 component_band ------------------------------------------------------------------------
  it("E2 POSITIVE: a `component_band` whose CHOSEN column is not on the matched row REFUSES", () => {
    const r = run([
      MATCH,
      { step: "component_band", name: "b", band_on: "size", formula: "base*f", params: { f: 1 },
        bands: [{ when: "10", target: "install_base" }] },
      { step: "sum_components", result: "supply" },
    ], ["supply"]);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
    const st = stepNamed(r, "component_band");
    expect(st?.matchedCondition).toBe("install_base not on the matched row -- not computed");
    // the band it CHOSE is still reported -- refusing must not hide which column was asked for
    expect(st?.bandChosen).toBe("size 10 -> install_base");
  });

  it("E2 NEGATIVE: a band landing on a column the row DOES carry is byte-unchanged", () => {
    const r = run([
      MATCH,
      { step: "component_band", name: "b", band_on: "size", formula: "base*f", params: { f: 3 },
        bands: [{ when: "10", target: "list_price" }] },
      { step: "sum_components", result: "supply" },
    ], ["supply"]);
    expect(r.status).toBe("ok");
    expect(r.finals).toEqual({ supply: 300 });
  });

  // ---- E3 apply_effective_multiplier -------------------------------------------------------------
  it("E3 POSITIVE: `apply_effective_multiplier` on a missing rate REFUSES -- the multiply is OUTSIDE the formula", () => {
    const r = run([
      MATCH,
      { step: "apply_effective_multiplier", target: "install_base", result: "eff", formula: "(1-d)*(1+m)",
        conditions: [{ when: { size: "10" }, params: { d: 0.1, m: 0.2 } }] },
    ], ["eff"]);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
    expect(Number.isNaN(r.finals.eff)).toBe(false);
    expect(stepNamed(r, "apply_effective_multiplier")?.matchedCondition)
      .toBe("install_base not on the matched row -- not computed");
  });

  it("E3 NEGATIVE: the effective multiplier over a present rate is byte-unchanged", () => {
    const r = run([
      MATCH,
      { step: "apply_effective_multiplier", target: "list_price", result: "eff", formula: "(1-d)*(1+m)",
        conditions: [{ when: { size: "10" }, params: { d: 0.5, m: 0.0 } }] },
    ], ["eff"]);
    expect(r.status).toBe("ok");
    expect(r.finals.eff).toBe(50);
  });

  // ---- E4 roundup -- HONEST PARTIAL, NOT A REFUSAL ------------------------------------------------
  it("E4 POSITIVE: `roundup` on a target the row does not carry stays ok with the output ABSENT", () => {
    const r = run([MATCH, { step: "roundup", target: "install_base", params: { digits: -1 } }], ["install_base"]);
    expect(r.status).toBe("ok");                                  // partial, NOT no_match (the PW-FIX lesson)
    expect(r.finals.install_base).toBeUndefined();
    expect(Number.isNaN(r.finals.install_base as unknown as number)).toBe(false);
    expect(stepNamed(r, "roundup")?.label)
      .toBe("install_base not available to round -- install_base not computed");
  });

  it("E4 NEGATIVE: roundup over a present value is byte-unchanged", () => {
    const r = run([MATCH, { step: "roundup", target: "list_price", params: { digits: -1 } }], ["list_price"]);
    expect(r.status).toBe("ok");
    expect(r.finals.list_price).toBe(100);
  });

  // ---- E5 install_as_ratio -- the literal NaN ----------------------------------------------------
  it("E5 POSITIVE: `install_as_ratio` with no supply_* in ctx REFUSES and NAMES the gap", () => {
    const r = run([MATCH, { step: "install_as_ratio", result: "install", params: { ratio: 0.2 } }], ["install"]);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
    expect(Number.isNaN(r.finals.install)).toBe(false);
    expect(stepNamed(r, "install_as_ratio")?.matchedCondition)
      .toBe("no supply_* value computed -- install not computed");
  });

  it("E5 NEGATIVE: install_as_ratio over a real supply_* value is byte-unchanged", () => {
    const r = run([
      MATCH,
      { step: "scale", target: "list_price", result: "supply_per_set", params: { m: 1 }, formula: "base*m" },
      { step: "install_as_ratio", result: "install", params: { ratio: 0.2 } },
    ], ["install"]);
    expect(r.status).toBe("ok");
    expect(r.finals.install).toBe(20);
  });

  // ---- THE CHAIN -- the conduit_boq shape --------------------------------------------------------
  it("THE CHAIN POSITIVE: an honest `scale` skip then a `roundup` on its unwritten key -- absent, ok, no NaN", () => {
    // This is conduit_boq / jb_boq / cable_boq. Pre-F-18 the scale declined honestly and the NEXT step
    // turned that honesty into a NaN -- which is why the SAME missing key gave an honest partial in
    // conduit_bcs (no downstream roundup) and a NaN in conduit_boq. The sibling output must survive:
    // refusing the pipeline would discard a supply figure that computed perfectly well.
    const r = run([
      MATCH,
      { step: "scale", target: "list_price", result: "supply", params: { m: 2 }, formula: "base*m" },
      { step: "roundup", target: "supply", params: { digits: -1 } },
      { step: "scale", target: "install_base", result: "install", params: { m: 2 }, formula: "base*m" },
      { step: "roundup", target: "install", params: { digits: -1 } },
    ], ["supply", "install"]);
    expect(r.status).toBe("ok");
    expect(r.finals.supply).toBe(200);                        // THE SIBLING STILL PRICES
    expect(r.finals.install).toBeUndefined();                 // absent, never NaN
    expect(Number.isNaN(r.finals.install as unknown as number)).toBe(false);
  });

  // ---- THE BACKSTOP ------------------------------------------------------------------------------
  it("THE BACKSTOP POSITIVE: a non-finite `rate_stages.mult` is DROPPED, never ok-NaN", () => {
    // The loader-does-not-validate fixture: `_validate_config` requires a finite `mult`, but it has
    // exactly ONE caller (update_rate_config) and `_load_multi` validates nothing -- so an imported
    // asset can carry this. No per-step guard above covers it; the tail does.
    const r = run([
      { step: "component_ref", name: "r", target: "list_price",
        ref: { kind: "f18_kind", size: "10" }, rate_stages: [{ mult: Number.NaN }], qty: 1 },
      { step: "sum_components", result: "supply" },
    ], ["supply"]);
    expect(r.status).toBe("ok");
    expect(r.finals.supply).toBeUndefined();
    expect(Number.isNaN(r.finals.supply as unknown as number)).toBe(false);
    expect(stepNamed(r, "(finalize)")?.label)
      .toBe("supply computed to a non-finite value -- dropped, not priced");
  });

  it("THE BACKSTOP NEGATIVE: a clean pipeline pushes NO finalize note (every existing trace is unmoved)", () => {
    const r = run([
      MATCH,
      { step: "component", name: "good", target: "list_price", formula: "base" },
      { step: "sum_components", result: "supply" },
    ], ["supply"]);
    expect(r.status).toBe("ok");
    expect(stepNamed(r, "(finalize)")).toBeUndefined();
  });

  // ---- THE ONE LIVE BEHAVIOUR THIS SLICE MUST NOT MOVE -------------------------------------------
  it("NEGATIVE PIN: `ok` with an UNDEFINED final passes through UNTOUCHED (the CEIG / AS Built contract)", () => {
    // R3's predicate is `typeof v === "number" && !Number.isFinite(v)` -- A NUMBER THAT IS NOT FINITE,
    // never a MISSING value. `status: "ok"` with an absent output is the SHIPPED EA-1b honest-partial
    // contract, live today on the `miscellaneous` CEIG / AS Built rows (4 combinations across misc_boq
    // and misc_bcs, measured against the live catalog). A backstop written as "no non-value may pass
    // with ok" would break those four while fixing nothing that was ever broken -- absent means "this
    // row has no such rate", NaN means "we computed nonsense", and they must not be collapsed.
    // See also the EA-1b describe above, which pins the same rows from the honest-partial side.
    const partialItems: RateMasterItem[] = [
      { discipline: "Electrical", kind: "f18_misc", attributes: { description: "CEIG" },
        rates: { boq_supply: null as unknown as number, boq_install: 225000 } },
    ];
    const r = runPipeline("misc_boq", { output: ["supply", "install"], steps: [
      { step: "match_master_row", params: { kind: "f18_misc" } },
      { step: "scale", target: "boq_supply", result: "supply", params: { f: 1 }, formula: "base*f" },
      { step: "scale", target: "boq_install", result: "install", params: { f: 1 }, formula: "base*f" },
    ] } as unknown as Pipeline, partialItems, { description: "CEIG" });
    expect(r.status).toBe("ok");
    expect(r.finals.install).toBe(225000);
    expect(r.finals.supply).toBeUndefined();
    expect(stepNamed(r, "(finalize)")).toBeUndefined();      // nothing dropped -- nothing was non-finite
  });

  // ---- THE TEMPLATE THE FIVE GUARDS COPY ---------------------------------------------------------
  it("CONTROL: `component_ref`'s own guard -- the idiom these copy -- is byte-unchanged", () => {
    const r = run([
      { step: "component_ref", name: "r", target: "install_base",
        ref: { kind: "f18_kind", size: "10" }, rate_stages: [{ mult: 1 }], qty: 1 },
      { step: "sum_components", result: "supply" },
    ], ["supply"]);
    expect(r.status).toBe("no_match");
    expect(r.finals).toEqual({});
    // "referenced row" here vs "matched row" in the new guards -- the idiom is copied, the WORDING
    // stays honest about WHICH row was short. Both are pinned so neither drifts into the other.
    expect(stepNamed(r, "component_ref")?.matchedCondition)
      .toBe("install_base not on the referenced row -- not computed");
  });

  // ---- NO FUTURE STEP MAY JOIN THE CLASS SILENTLY -------------------------------------------------
  it("NEGATIVE: every step reading a possibly-absent number is accounted for, so a new step forces a choice", () => {
    // The two lists must PARTITION the vocabulary. Adding a step type breaks this test, which is the
    // point: whoever adds it has to say which side it falls on rather than inheriting F-18 by default.
    const READS_A_POSSIBLY_ABSENT_NUMBER = [
      // a rate key off a matched or referenced row, or a ctx value another step may not have written
      "apply_effective_multiplier", "scale", "roundup", "component", "component_ref",
      "component_band", "install_as_ratio", "lookup_or_ratio",
    ];
    const READS_NO_POSSIBLY_ABSENT_NUMBER = [
      // these read the row itself, the component bag, or ATTRIBUTES (already honest no-computes)
      "match_master_row", "sum_components", "circuit_fit", "module_fit", "derive_attribute",
      // SLICE 2b -- THE CHOICE THIS TEST EXISTS TO FORCE, stated rather than inherited.
      // `map_attribute` reads a STRING attribute and writes a string; there is no number on its path
      // at all. `catalog_fit` reads ONE numeric ATTRIBUTE (`fit_from`) and refuses by name when it is
      // missing or non-numeric, and derives rung sizes from catalog attributes, skipping any row whose
      // size attribute is unreadable. NEITHER reads a rate key off a matched row, and neither reads a
      // `ctx` value some other step may not have written -- which is what puts them on this side.
      "map_attribute", "catalog_fit",
    ];
    for (const s of READS_A_POSSIBLY_ABSENT_NUMBER) expect(STEP_VOCABULARY).toContain(s);
    expect([...READS_A_POSSIBLY_ABSENT_NUMBER, ...READS_NO_POSSIBLY_ABSENT_NUMBER].sort())
      .toEqual([...STEP_VOCABULARY].sort());
  });

  // ---- THE RIDER (R4) ----------------------------------------------------------------------------
  it("R4 POSITIVE: evalFormula rejects a present-but-undefined binding exactly like an unbound one", () => {
    expect(() => evalFormula("base * 2", { base: undefined as unknown as number }))
      .toThrow(/Unknown identifier 'base'/);
    expect(() => evalFormula("base * 2", {})).toThrow(/Unknown identifier 'base'/);
  });

  it("R4 NEGATIVE: a legitimately bound 0 still evaluates -- falsy is not absent", () => {
    expect(evalFormula("base * 2", { base: 0 })).toBe(0);
    expect(evalFormula("base + 1", { base: 0 })).toBe(1);
  });
});

// ---- SLICE 2b: catalog_fit + map_attribute -- the deterministic MCB ladder ----
//
// THE CATALOG IS REAL, mirroring the v36 mint (db_switchgear_item, family Switchgear, the four new
// stored attributes device / pole / amp_a / curve). The FP MCB grid carries 25/32/40/63 at curve C
// and NOTHING below 25 -- which is exactly why the model kept inventing "20A FP MCB C CURVE" and why
// the ladder has to hop. `80 FP MCB` is the ONE grammar exception: an MCB with no curve, above the
// C grid, reachable only through the value-list `where`.
const mcbRow = (
  item: string, device: string, pole: string, amp: number, curve: string, list: number
): RateMasterItem => ({
  discipline: "Electrical",
  kind: "db_switchgear_item",
  attributes: { family: "Switchgear", item, device, pole, amp_a: amp, curve },
  rates: { list_price: list },
});
const sockRow = (
  item: string, enclosure: string, rating: string, pole: string, list: number
): RateMasterItem => ({
  discipline: "Electrical",
  kind: "industrial_socket",
  attributes: { item, enclosure, rating, pole },
  rates: { list_price: list },
});

const CF_ITEMS: RateMasterItem[] = [
  mcbRow("25A FP MCB C CURVE", "MCB", "FP", 25, "C", 2820),
  mcbRow("32A FP MCB C CURVE", "MCB", "FP", 32, "C", 2820),
  mcbRow("40A FP MCB C CURVE", "MCB", "FP", 40, "C", 4012),
  mcbRow("63A FP MCB C CURVE", "MCB", "FP", 63, "C", 4012),
  mcbRow("25A FP MCB D CURVE", "MCB", "FP", 25, "D", 2820),
  mcbRow("80 FP MCB", "MCB", "FP", 80, "NA", 7650),
  mcbRow("20A SP MCB C CURVE", "MCB", "SP", 20, "C", 390),
  mcbRow("25A SP MCB C CURVE", "MCB", "SP", 25, "C", 449),
  mcbRow("25A DP MCB C CURVE", "MCB", "DP", 25, "C", 1472),
  // DECOYS. A 16A device DOES exist at FP -- as an RCBO, which is what the v35 model reached for on
  // row 87. `device: "MCB"` in the where is the only thing keeping it out of the ladder.
  mcbRow("16A RCBO 30mA (FP)", "RCBO", "FP", 16, "NA", 3852),
  mcbRow("20A RCBO 30mA (FP)", "RCBO", "FP", 20, "NA", 3852),
  sockRow("Industrial Socket with MCB", "IP67 - Water Proof", "16/20A", "5 Pin / 3P+N+E", 9410),
  sockRow("Plug + Socket in Enclosure Box", "IP44/54 - Splash Proof", "16/20A", "3 Pin / 2P+E", 2240),
];

const MCB_WHERE = {
  family: "Switchgear",
  device: "MCB",
  pole: "@mcb_pole",
  curve: ["@mcb_curve", "NA"],
};
const catFit = (over: Record<string, unknown> = {}) => ({
  step: "catalog_fit" as const,
  params: {
    bind: "paired_mcb",
    kind: "db_switchgear_item",
    where: MCB_WHERE,
    size_from: { attr: "amp_a" },
    fit_from: { attr: "mcb_amp_a" },
    direction: "up",
    prefer_attr: "paired_mcb",
    absent_when: { attr: "mcb_present", equals: "No" },
    on_miss: "none",
    ...over,
  },
});
const POLE_MAP = {
  step: "map_attribute" as const,
  params: {
    result_attr: "mcb_pole",
    prefer_attr: "mcb_pole_stated",
    from_attr: "pole",
    table: { "3 Pin / 2P+E": "SP", "5 Pin / 3P+N+E": "FP" },
  },
};
const CURVE_MAP = {
  step: "map_attribute" as const,
  params: { result_attr: "mcb_curve", prefer_attr: "mcb_curve_stated", default: "C" },
};
const SOCKET_REF = {
  step: "component_ref" as const,
  name: "socket",
  ref: { kind: "industrial_socket", item: "@item", enclosure: "@enclosure", rating: "@rating", pole: "@pole" },
  target: "list_price",
  rate_stages: [{ mult: 0.98, round: "up0" }],
  qty: 1,
};
const MCB_REF = {
  step: "component_ref" as const,
  name: "paired_mcb",
  ref: { kind: "db_switchgear_item", family: "Switchgear", item: "@paired_mcb" },
  target: "list_price",
  rate_stages: [{ mult: 0.495, round: "up0" }],
  qty: { if_attr: { item: "Industrial Socket with Socket Outlet Interlocked" }, then: 0, else: 1 },
  none_skips: true,
};
const indsockSupply = (over: Record<string, unknown> = {}): Pipeline =>
  ({
    output: ["supply"],
    steps: [POLE_MAP, CURVE_MAP, catFit(over), SOCKET_REF, MCB_REF, { step: "sum_components", result: "supply" }],
  } as unknown as Pipeline);
const indsockInstall = (): Pipeline =>
  ({
    output: ["install"],
    steps: [
      POLE_MAP, CURVE_MAP, catFit(), SOCKET_REF, MCB_REF,
      { step: "sum_components", result: "supply" },
      { step: "scale", target: "supply", result: "install", params: { m: 0.35 }, formula: "base*m" },
      { step: "roundup", target: "install", params: { digits: -1 } },
    ],
  } as unknown as Pipeline);
/** Row 98's real attribute set: a 5-pin IP67 socket whose text says "with MCB" at 16/20 A. */
const ROW98 = {
  item: "Industrial Socket with MCB",
  enclosure: "IP67 - Water Proof",
  rating: "16/20A",
  pole: "5 Pin / 3P+N+E",
  mcb_present: "Yes",
  mcb_amp_a: 20,
  mcb_pole_stated: NONE_SENTINEL,
  mcb_curve_stated: NONE_SENTINEL,
};
const cfTrace = (r: ReturnType<typeof runPipeline>) => r.steps.find((s) => s.step === "catalog_fit");

describe("SLICE 2b -- the ladder helpers, generalised", () => {
  it("buildModuleLadder: size_from an ATTRIBUTE builds numeric rungs (POSITIVE, the new source)", () => {
    const rungs = buildModuleLadder(CF_ITEMS, {
      kind: "db_switchgear_item",
      where: { family: "Switchgear", device: "MCB", pole: "FP", curve: "C" },
      size_from: { attr: "amp_a" },
    });
    expect(rungs.map((r) => r.size)).toEqual([25, 32, 40, 63]);
    expect(rungs[0].label).toBe("25A FP MCB C CURVE");
  });

  it("buildModuleLadder: a LIST where matches ANY member -- the merged C+NA ladder reaches 80", () => {
    const rungs = buildModuleLadder(CF_ITEMS, {
      kind: "db_switchgear_item",
      where: { family: "Switchgear", device: "MCB", pole: "FP", curve: ["C", "NA"] },
      size_from: { attr: "amp_a" },
    });
    expect(rungs.map((r) => r.size)).toEqual([25, 32, 40, 63, 80]);
    expect(rungs[4].label).toBe("80 FP MCB");
  });

  it("buildModuleLadder: LIST ORDER is preference -- an earlier member wins a same-size tie", () => {
    // Both curves carry 25 at FP. ["C","NA"] must pick C; ["D","C"] must pick D.
    const cFirst = buildModuleLadder(CF_ITEMS, {
      kind: "db_switchgear_item",
      where: { family: "Switchgear", device: "MCB", pole: "FP", curve: ["C", "D"] },
      size_from: { attr: "amp_a" },
    });
    const dFirst = buildModuleLadder(CF_ITEMS, {
      kind: "db_switchgear_item",
      where: { family: "Switchgear", device: "MCB", pole: "FP", curve: ["D", "C"] },
      size_from: { attr: "amp_a" },
    });
    expect(cFirst.find((r) => r.size === 25)!.label).toBe("25A FP MCB C CURVE");
    expect(dFirst.find((r) => r.size === 25)!.label).toBe("25A FP MCB D CURVE");
  });

  it("buildModuleLadder REGRESSION: with NO size_from it still parses the LABEL (module_fit's path)", () => {
    const rungs = buildModuleLadder(LADDER_ITEMS, { kind: "switch_socket_item", where: { family: "Back Box" } });
    expect(rungs.map((r) => r.size)).toEqual([1, 2, 3, 4, 6, 8, 12, 18]);
  });

  it("fitModuleLadder: direction 'down' takes the next LOWER; 'up' stays the default", () => {
    const rungs = [
      { size: 25, label: "a" }, { size: 32, label: "b" }, { size: 63, label: "c" },
    ];
    expect(fitModuleLadder(rungs, 40)!.modules).toBe(63);            // default = up
    expect(fitModuleLadder(rungs, 40, "up")!.modules).toBe(63);
    expect(fitModuleLadder(rungs, 40, "down")!.modules).toBe(32);
    expect(fitModuleLadder(rungs, 32, "down")!.modules).toBe(32);    // exact still wins
    expect(fitModuleLadder(rungs, 10, "down")).toBeNull();           // nothing below
  });
});

describe("SLICE 2b -- map_attribute (the CONVERSION, in code)", () => {
  it("POSITIVE: the pin count converts to a pole through the config table", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, ROW98);
    const t = r.steps.find((s) => s.step === "map_attribute")!;
    expect(t.matchedCondition).toContain("5 Pin / 3P+N+E -> FP");
  });

  it("POSITIVE: a STATED pole WINS over the pin-count mapping -- row 470 is 3-pin and states DP", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, {
      ...ROW98,
      pole: "3 Pin / 2P+E",              // pin count would map to SP...
      mcb_pole_stated: "DP",             // ...but the BoQ says DP, and the BoQ wins
      mcb_amp_a: 20,
    });
    // 20A is absent at DP too, so the ladder hops to 25 -- at DP, not SP.
    expect(cfTrace(r)!.catalogFit!.fitted).toBe("25A DP MCB C CURVE");
  });

  it("POSITIVE: curve defaults to C when nothing is stated, and a stated curve wins", () => {
    const dflt = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, ROW98);
    expect(dflt.steps[1].matchedCondition).toContain("nothing stated -> C (default)");
    const stated = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, { ...ROW98, mcb_curve_stated: "D", mcb_amp_a: 25 });
    expect(cfTrace(stated)!.catalogFit!.fitted).toBe("25A FP MCB D CURVE");
  });

  it("NEGATIVE: an unmapped source with NO default is an honest no-compute NAMING the attribute", () => {
    const pl = { output: ["supply"], steps: [
      { step: "map_attribute", params: { result_attr: "mcb_pole", from_attr: "pole", table: { "3 Pin / 2P+E": "SP" } } },
    ] } as unknown as Pipeline;
    const r = runPipeline("t", pl, CF_ITEMS, { pole: "9 Pin / nonsense" });
    expect(r.status).toBe("no_match");
    expect(r.steps[0].label).toContain("pole");
    expect(r.steps[0].label).toContain("no mcb_pole");
  });

  it("NEGATIVE: a malformed step declaring no result_attr refuses on its own terms", () => {
    const pl = { output: ["supply"], steps: [{ step: "map_attribute", params: {} }] } as unknown as Pipeline;
    const r = runPipeline("t", pl, CF_ITEMS, {});
    expect(r.status).toBe("no_match");
    expect(r.steps[0].label).toContain("declares no result_attr");
  });
});

describe("SLICE 2b -- catalog_fit (the ladder)", () => {
  it("POSITIVE -- THE WHOLE POINT: 20A is not carried at FP, so the ladder HOPS to 25A FP MCB C CURVE", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, ROW98);
    const t = cfTrace(r)!;
    expect(t.catalogFit).toEqual({
      bind: "paired_mcb", fitted: "25A FP MCB C CURVE", size: 25, requested: 20, exact: false, absent: false,
    });
    expect(t.matchedCondition).toContain("not carried");
    expect(t.matchedCondition).toContain("next higher");
    // row 98's real numbers: socket 9222 + mcb 1396
    expect(r.finals.supply).toBe(10618);
  });

  it("POSITIVE: it holds the DEVICE CLASS -- a 16A RCBO exists at FP and must NOT be chosen (row 87)", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, { ...ROW98, mcb_amp_a: 16 });
    expect(cfTrace(r)!.catalogFit!.fitted).toBe("25A FP MCB C CURVE");
    expect(r.finals.supply).toBe(10618);
  });

  it("POSITIVE: an EXACT rung does not hop, and the trace says so", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, { ...ROW98, mcb_amp_a: 32 });
    const t = cfTrace(r)!;
    expect(t.catalogFit!.exact).toBe(true);
    expect(t.matchedCondition).not.toContain("next higher");
  });

  it("POSITIVE: 80A reaches the curve-less exception through the value list (row 103)", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, { ...ROW98, mcb_amp_a: 80 });
    expect(cfTrace(r)!.catalogFit!.fitted).toBe("80 FP MCB");
  });

  it("POSITIVE: golden i4 -- the full install pipeline lands on 3720", () => {
    const r = runPipeline("indsock_install", indsockInstall(), CF_ITEMS, ROW98);
    expect(r.finals.install).toBe(3720);
  });

  it("POSITIVE: golden i5 -- mcb_present No binds the sentinel and the socket prices ALONE", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, {
      item: "Plug + Socket in Enclosure Box",
      enclosure: "IP44/54 - Splash Proof",
      rating: "16/20A",
      pole: "3 Pin / 2P+E",
      mcb_present: "No",
    });
    const t = cfTrace(r)!;
    expect(t.catalogFit!.absent).toBe(true);
    expect(t.catalogFit!.fitted).toBeNull();
    expect(r.finals.supply).toBe(2196); // socket alone -- i1's answer, by a different route
  });

  it("POSITIVE: STATED-WINS -- a stated paired_mcb is kept and the ladder does not fire", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, { ...ROW98, paired_mcb: "63A FP MCB C CURVE" });
    const t = cfTrace(r)!;
    expect(t.catalogFit!.stated).toBe("63A FP MCB C CURVE");
    expect(t.catalogFit!.fitted).toBeNull();
    expect(t.matchedCondition).toContain("a stated value wins");
    // 9222 + ceil(4012 * 0.495) = 9222 + 1986
    expect(r.finals.supply).toBe(11208);
  });

  it("STATED 'None' STICKS -- the sentinel is a DECISION, and catalog_fit defers to it (owner-locked)", () => {
    // ⚠️ THE PREDICATE ASYMMETRY IS DELIBERATE. `map_attribute`'s isStated EXCLUDES the sentinel
    // (a "None" pole is not a pole, so the mapping should still run); `catalog_fit`'s INCLUDES it,
    // because "None" here is the pricer saying "this row has no MCB" -- a DECISION to defer to, not
    // a gap to fill. The two layers differ on purpose: `mcb_present = "No"` corrects a FACT, while
    // `paired_mcb = "None"` overrides the DECISION.
    //
    // The alternative -- letting the ladder overwrite a stated "None" -- would make a valid panel
    // selection silently do nothing, which is the trapdoor this codebase's own conventions
    // disqualify ("a control that accepts edits and discards their effect is worse than an absent
    // one"). Pinned so no later reader "harmonises" the two predicates.
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, {
      ...ROW98, paired_mcb: NONE_SENTINEL,   // the pricer's override, on a row whose facts WOULD fit 25A FP
    });
    const t = cfTrace(r)!;
    expect(t.catalogFit!.stated).toBe(NONE_SENTINEL); // stated-wins fired
    expect(t.catalogFit!.absent).toBe(true);
    expect(t.catalogFit!.fitted).toBeNull();          // the step bound NOTHING...
    expect(r.status).toBe("ok");
    expect(r.finals.supply).toBe(9222);               // ...so the selection's sentinel reached none_skips
  });

  it("POSITIVE: extra stored attributes on a referenced row are IGNORED by component_ref", () => {
    // The mint adds device/pole/amp_a/curve to every switchgear row; the MCB ref matches only
    // {kind, family, item}. If extra attributes narrowed a ref, every db_switchgear slot would break.
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, ROW98);
    expect(r.status).toBe("ok");
  });

  it("NEGATIVE: a missing fit value is an honest no-compute NAMING the attribute", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, { ...ROW98, mcb_amp_a: "" });
    expect(r.status).toBe("no_match");
    expect(r.steps.at(-1)!.label).toContain("mcb_amp_a");
    expect(r.steps.at(-1)!.label).toContain("missing or non-numeric");
  });

  it("OPT-IN (ruling A-ii): on_missing_fact 'none' -- a blank fact binds None and the socket STILL PRICES", () => {
    // Row 78's shape: the text names an MCB but states no current OF ITS OWN. Refusing discarded a
    // socket that priced perfectly well; with the opt-in the MCB line is honestly unpriced instead.
    const r = runPipeline("indsock_boq", indsockSupply({ on_missing_fact: "none" }), CF_ITEMS, {
      ...ROW98, mcb_amp_a: "",
    });
    const t = cfTrace(r)!;
    expect(t.catalogFit!.absent).toBe(true);
    expect(t.catalogFit!.fitted).toBeNull();
    expect(t.matchedCondition).toContain("not stated");
    expect(r.status).toBe("ok");
    expect(r.finals.supply).toBe(9222); // socket alone -- the MCB line zeroed by none_skips
  });

  it("NEGATIVE twin: WITHOUT the opt-in the same blank fact still REFUSES -- the default is unchanged", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, { ...ROW98, mcb_amp_a: "" });
    expect(r.status).toBe("no_match");
    expect(r.steps.at(-1)!.label).toContain("mcb_amp_a");
  });

  it("NEGATIVE: nothing fits -> the None sentinel, NOT a refusal -- the socket still prices", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, { ...ROW98, mcb_amp_a: 500 });
    const t = cfTrace(r)!;
    expect(t.catalogFit!.absent).toBe(true);
    expect(t.matchedCondition).toContain("nothing in the catalog fits");
    expect(r.status).toBe("ok");
    expect(r.finals.supply).toBe(9222); // socket alone
  });

  it("NEGATIVE: on_miss no_compute refuses instead, naming the top rung (the module_fit choice)", () => {
    const r = runPipeline("indsock_boq", indsockSupply({ on_miss: "no_compute" }), CF_ITEMS, { ...ROW98, mcb_amp_a: 500 });
    expect(r.status).toBe("no_match");
    expect(r.steps.at(-1)!.label).toContain("80 FP MCB");
  });

  it("NEGATIVE: an unresolvable @-ref in `where` bails cleanly, NAMING the key", () => {
    const r = runPipeline(
      "indsock_boq",
      indsockSupply({ where: { family: "Switchgear", device: "MCB", pole: "@nonexistent_attr" } }),
      CF_ITEMS,
      ROW98
    );
    expect(r.status).toBe("no_match");
    expect(r.steps.at(-1)!.label).toContain("'pole' not provided");
  });

  it("NEGATIVE: a `where` matching no catalog row bails naming the kind", () => {
    const r = runPipeline("indsock_boq", indsockSupply({ kind: "no_such_kind" }), CF_ITEMS, ROW98);
    expect(r.status).toBe("no_match");
    expect(r.steps.at(-1)!.label).toContain("no_such_kind");
  });

  it("NEGATIVE: a malformed step declaring no bind/kind/fit_from refuses on its own terms", () => {
    const pl = { output: ["supply"], steps: [{ step: "catalog_fit", params: { bind: "x" } }] } as unknown as Pipeline;
    const r = runPipeline("t", pl, CF_ITEMS, {});
    expect(r.status).toBe("no_match");
    expect(r.steps[0].label).toContain("declares no bind / kind / fit_from");
  });

  it("THE RENDER CAVEAT: the catalog_fit trace carries NO `params`, so its detail line is displayed", () => {
    // RateMasterDerivation renders param CHIPS whenever the TRACE carries params and only falls
    // through to the detail line when it does not. A step that publishes params computes its working
    // and never shows it -- which would defeat the entire purpose of this slice.
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, ROW98);
    for (const s of r.steps.filter((x) => x.step === "catalog_fit" || x.step === "map_attribute")) {
      expect(s.params).toBeUndefined();
    }
  });
});

// ── SLICE 2c: catalogFitOutcomes -- the ONE reader ──────────────────────────────────────────────
// `catalog_fit`'s answer was computed and then thrown away: the fitted label lives in `fitLabels`,
// which is FUNCTION-LOCAL to `runPipeline` (28 inline return sites -- adding a result field would
// have meant editing every one), and the trace's `matchedRows` push is gated on `st.refItem`, which
// a `catalog_fit` step does not carry. So the panel showed a blank field beside a priced MCB.
//
// This reader is the `moduleFitOutcome` / `derivedAttrOutcomes` shape, third instance: READ THE
// STRUCTURED DATA, never the prose (`matchedCondition` is a human sentence that gets reworded, and
// making it a parsing contract fails SILENTLY) and never re-derive the fit (that would be a second
// copy of the catalog-resolved ladder rule).
describe("SLICE 2c -- catalogFitOutcomes (the ONE reader over StepTrace.catalogFit)", () => {
  it("POSITIVE: it is KEYED BY BIND, not by step order -- a consumer looks up by attribute id", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, ROW98);
    const out = catalogFitOutcomes([r]);
    expect(out.get("paired_mcb")!.fitted).toBe("25A FP MCB C CURVE");
    expect(out.get("paired_mcb")!.bind).toBe("paired_mcb");
  });

  it("POSITIVE: FIRST WINS across pipelines -- supply and install fit identically, so either is the answer", () => {
    // Both `indsock_boq` and `indsock_install` carry the SAME catalog_fit step, so the panel would
    // otherwise have to pick one arbitrarily. First-wins makes the choice explicit and stable; if the
    // two ever disagreed, showing the first is still better than showing whichever ran last.
    const supply = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, ROW98);
    const install = runPipeline("indsock_install", indsockInstall(), CF_ITEMS, ROW98);
    expect(catalogFitOutcomes([supply, install]).get("paired_mcb")!.fitted).toBe("25A FP MCB C CURVE");
    expect(catalogFitOutcomes([install, supply]).get("paired_mcb")!.fitted).toBe("25A FP MCB C CURVE");
  });

  it("POSITIVE: an outcome is present on the ABSENT path too -- absence is an ANSWER, not silence", () => {
    // mcb_present "No" -> the step binds the sentinel and reports absent. The panel must be able to
    // tell "we decided there is no MCB" from "this step never ran"; a reader that only reported fits
    // would collapse the two.
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS, { ...ROW98, mcb_present: "No" });
    const o = catalogFitOutcomes([r]).get("paired_mcb")!;
    expect(o.absent).toBe(true);
    expect(o.fitted).toBeNull();
  });

  it("POSITIVE: an outcome is present on the STATED path too, carrying `stated` and NO fit", () => {
    const r = runPipeline("indsock_boq", indsockSupply(), CF_ITEMS,
      { ...ROW98, paired_mcb: "63A FP MCB C CURVE" });
    const o = catalogFitOutcomes([r]).get("paired_mcb")!;
    expect(o.stated).toBe("63A FP MCB C CURVE");
    expect(o.fitted).toBeNull();   // stated-wins bound nothing -- there is no computed value to show
  });

  it("NEGATIVE: EMPTY when no catalog_fit ran -- a config without the step is byte-identical", () => {
    // The regression bar for this slice: every pre-2c config must be untouched by the reader.
    const r = runPipeline("cable_boq", PIPELINES.cable_boq, ITEMS, sel("COPPER", "UNARMOURED", 1.0, 6.0));
    expect(r.finals).toEqual({ supply_per_mtr: 120, install_per_mtr: 20 });  // g1, still exactly itself
    expect(catalogFitOutcomes([r]).size).toBe(0);
  });

  it("NEGATIVE: EMPTY on a BAILED catalog_fit -- a refusal claims nothing (the module_fit precedent)", () => {
    // `bail` pushes a plain trace with no `catalogFit`, exactly as a module_fit that bailed publishes
    // no outcome. A reader inventing an entry here would report a fit the step explicitly refused.
    const r = runPipeline("indsock_boq", indsockSupply({ kind: "no_such_kind" }), CF_ITEMS, ROW98);
    expect(r.status).toBe("no_match");
    expect(catalogFitOutcomes([r]).size).toBe(0);
  });

  it("NEGATIVE: a step with no steps array at all does not throw", () => {
    expect(catalogFitOutcomes([{ steps: undefined as never }]).size).toBe(0);
  });
});
