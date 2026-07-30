// RM-4b: tests for the structure-editor pure helpers -- the preview gate (goldens computed against a
// draft), the reference guard mirror, the blank-step factory. The interpreter is exercised through
// evaluateGoldens (same pure compute the tab uses).

import { describe, it, expect } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import {
  STEP_VOCABULARY,
  blankPipeline,
  blankStep,
  categoryItemKinds,
  isCategoryDataScopeEmpty,
  cloneConfig,
  distinctNumberValues,
  evaluateGoldens,
  goldenDeltas,
  referencedAttrIds,
} from "./rateMasterStructure";

// A minimal config: one cable_boq pipeline (match -> effective multiplier -> roundup) + two goldens.
function makeConfig(): RateCategoryConfig {
  return {
    discipline: "Electrical",
    category_id: "wiring_cabling",
    attribute_definitions: [
      { id: "material", label: "Material", type: "choice", values: ["COPPER"] },
      { id: "insulation", label: "Insulation", type: "choice", values: ["ARMOURED", "UNARMOURED"] },
      { id: "core", label: "Core", type: "number" },
      { id: "thickness_sqmm", label: "Thickness (sqmm)", type: "number" },
    ],
    pipelines: {
      cable_boq: {
        output: ["supply_per_mtr"],
        steps: [
          { step: "match_master_row", params: { kind: "cable" } },
          {
            step: "apply_effective_multiplier",
            target: "list_price_per_mtr",
            result: "supply_per_mtr",
            formula: "(1-discount)*(1+markup)",
            conditions: [
              { when: { insulation: "ARMOURED" }, params: { discount: 0.75, markup: 0.35 } },
              { when: { insulation: "UNARMOURED" }, params: { discount: 0.57, markup: 0.4 } },
            ],
          },
          { step: "roundup", target: "supply_per_mtr", params: { digits: -1 } },
        ],
      },
    },
    goldens: [
      { attrs: { material: "COPPER", insulation: "ARMOURED", core: 3, thickness_sqmm: 2.5 }, expect: { cable_boq: { supply_per_mtr: 200 } } },
      { attrs: { material: "COPPER", insulation: "UNARMOURED", core: 1, thickness_sqmm: 6 }, expect: { cable_boq: { supply_per_mtr: 120 } } },
    ],
  } as RateCategoryConfig;
}

const ITEMS: RateMasterItem[] = [
  { discipline: "Electrical", kind: "cable", attributes: { material: "COPPER", insulation: "ARMOURED", core: 3, thickness_sqmm: 2.5 }, rates: { list_price_per_mtr: 570 } }, // 570*0.25*1.35=192.375 -> roundup tens = 200
  { discipline: "Electrical", kind: "cable", attributes: { material: "COPPER", insulation: "UNARMOURED", core: 1, thickness_sqmm: 6 }, rates: { list_price_per_mtr: 192 } }, // 192*0.43*1.4=115.58 -> 120
];

describe("evaluateGoldens / goldenDeltas (the preview gate)", () => {
  it("an UNTOUCHED config computes every golden green -- zero deltas", () => {
    const cfg = makeConfig();
    const checks = evaluateGoldens(cfg, ITEMS);
    expect(checks).toHaveLength(2);
    expect(checks.every((c) => c.pass)).toBe(true);
    expect(goldenDeltas(cfg, ITEMS)).toHaveLength(0);
  });

  it("a DRAFT that moves one pipeline surfaces exactly that golden's delta", () => {
    const draft = cloneConfig(makeConfig());
    // change the ARMOURED discount 0.75 -> 0.70 -> supply rises 200 -> 240
    (draft.pipelines.cable_boq.steps[1] as unknown as { conditions: { params: { discount: number } }[] }).conditions[0].params.discount = 0.7;
    const deltas = goldenDeltas(draft, ITEMS);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].pipelineId).toBe("cable_boq");
    expect(deltas[0].key).toBe("supply_per_mtr");
    expect(deltas[0].expected).toBe(200);
    expect(deltas[0].got).toBe(240);
    // the UNARMOURED golden is untouched -> still green
    expect(evaluateGoldens(draft, ITEMS).filter((c) => c.pass)).toHaveLength(1);
  });

  it("a golden whose pipeline no longer produces the key reports got=null (not a silent pass)", () => {
    const draft = cloneConfig(makeConfig());
    draft.pipelines.cable_boq.output = ["something_else"]; // supply_per_mtr no longer an output
    const deltas = goldenDeltas(draft, ITEMS);
    expect(deltas).toHaveLength(2);
    expect(deltas.every((d) => d.got === null)).toBe(true);
  });

  it("a transiently invalid draft (param renamed before formula) does NOT throw -- got=null", () => {
    const draft = cloneConfig(makeConfig());
    // rename `discount` -> `disc` but leave the formula referencing `discount` -> evalFormula throws
    const cond = (draft.pipelines.cable_boq.steps[1] as unknown as { conditions: { when: Record<string, string | number>; params: Record<string, number> }[] }).conditions[0];
    cond.params = { disc: 0.75, markup: 0.35 };
    expect(() => evaluateGoldens(draft, ITEMS)).not.toThrow();
    const deltas = goldenDeltas(draft, ITEMS);
    expect(deltas.some((d) => d.pipelineId === "cable_boq" && d.got === null)).toBe(true);
  });
});

describe("referencedAttrIds (client mirror of the server reference guard)", () => {
  it("collects attribute ids used by pipeline conditions", () => {
    const refs = referencedAttrIds(makeConfig());
    expect(refs.has("insulation")).toBe(true);
    expect(refs.has("material")).toBe(false); // material is not referenced by any condition here
  });
  it("collects a component_band band_on attribute", () => {
    const cfg = makeConfig();
    cfg.pipelines.term = {
      output: ["s"],
      steps: [
        { step: "match_master_row", params: { kind: "termination" } },
        { step: "component_band", name: "gland", band_on: "thickness_sqmm", bands: [{ when: "<35", target: "g1" }], params: { discount: 0.5 } },
      ],
    };
    expect(referencedAttrIds(cfg).has("thickness_sqmm")).toBe(true);
  });
});

describe("blankStep factory", () => {
  it("returns a skeleton carrying the requested step type for every vocabulary member", () => {
    for (const t of STEP_VOCABULARY) {
      const s = blankStep(t) as { step: string };
      expect(s.step).toBe(t);
    }
  });
  it("apply_effective_multiplier skeleton has an empty conditions list + a formula", () => {
    const s = blankStep("apply_effective_multiplier") as { conditions: unknown[]; formula: string };
    expect(s.conditions).toEqual([]);
    expect(typeof s.formula).toBe("string");
  });
});

describe("cloneConfig", () => {
  it("produces an independent deep copy", () => {
    const cfg = makeConfig();
    const clone = cloneConfig(cfg);
    (clone.pipelines.cable_boq.steps[0] as { params: { kind: string } }).params.kind = "MUTATED";
    expect((cfg.pipelines.cable_boq.steps[0] as { params: { kind: string } }).params.kind).toBe("cable");
  });
});

describe("EA-1c categoryItemKinds (Data-tab scoping)", () => {
  it("returns declared item_kinds when present", () => {
    const cfg = makeConfig();
    (cfg as { item_kinds?: string[] }).item_kinds = ["lms_item"];
    expect(categoryItemKinds(cfg)).toEqual(["lms_item"]);
  });
  it("returns MULTIPLE declared item_kinds verbatim", () => {
    const cfg = makeConfig();
    (cfg as { item_kinds?: string[] }).item_kinds = ["popup_box_module", "extra_kind"];
    expect(categoryItemKinds(cfg)).toEqual(["popup_box_module", "extra_kind"]);
  });
  it("falls back to pipeline match_master_row kinds when item_kinds is absent (legacy wiring)", () => {
    const cfg = makeConfig(); // has cable_boq matching kind 'cable'
    cfg.pipelines.termination_boq = {
      output: ["s"],
      steps: [{ step: "match_master_row", params: { kind: "termination" } }],
    };
    expect(new Set(categoryItemKinds(cfg))).toEqual(new Set(["cable", "termination"]));
  });
  it("ignores an empty item_kinds and derives from pipelines instead", () => {
    const cfg = makeConfig();
    (cfg as { item_kinds?: string[] }).item_kinds = [];
    expect(categoryItemKinds(cfg)).toEqual(["cable"]);
  });
  it("returns [] for a config with neither item_kinds nor a matching pipeline", () => {
    const cfg = makeConfig();
    (cfg as { item_kinds?: string[] }).item_kinds = undefined;
    cfg.pipelines = {};
    expect(categoryItemKinds(cfg)).toEqual([]);
  });
});

// EA-DIFF: the empty-scope sentinel -- a category owning no data rows of its own (point_wiring) must
// resolve TRUE so the Data tab renders an honest empty state, NEVER the discipline-wide all-items list.
describe("EA-DIFF isCategoryDataScopeEmpty (Data-tab empty-scope sentinel)", () => {
  it("is TRUE for a kind-less category: empty item_kinds AND empty pipelines (point_wiring)", () => {
    const cfg = makeConfig();
    (cfg as { item_kinds?: string[] }).item_kinds = [];
    cfg.pipelines = {};
    expect(isCategoryDataScopeEmpty(cfg)).toBe(true);
    expect(categoryItemKinds(cfg)).toEqual([]); // the sentinel keys on the empty resolved set
  });
  it("is FALSE for LMS: declared item_kinds ['lms_item'] with empty pipelines (still owns its rows)", () => {
    const cfg = makeConfig();
    (cfg as { item_kinds?: string[] }).item_kinds = ["lms_item"];
    cfg.pipelines = {};
    expect(isCategoryDataScopeEmpty(cfg)).toBe(false);
  });
  it("is FALSE for a normal category deriving a kind from its pipelines (wiring/conduit)", () => {
    const cfg = makeConfig(); // cable_boq matches kind 'cable'
    (cfg as { item_kinds?: string[] }).item_kinds = undefined;
    expect(isCategoryDataScopeEmpty(cfg)).toBe(false);
  });
});

// EA-2 rider 1: the Add-pipeline builder produces a validator-shaped pipeline (output list + a
// non-empty steps list whose single step is a known type with a non-empty params.kind).
describe("blankPipeline (EA-2 add-pipeline builder)", () => {
  it("produces a validator-minimal pipeline the server accepts", () => {
    const p = blankPipeline(["supply_per_no", "install_per_no"], "db_item");
    expect(p.output).toEqual(["supply_per_no", "install_per_no"]);
    expect(p.steps).toHaveLength(1);
    const s = p.steps[0] as { step: string; params: { kind: string } };
    expect(STEP_VOCABULARY).toContain(s.step);           // a KNOWN step type
    expect(s.step).toBe("match_master_row");
    expect(typeof s.params.kind).toBe("string");
    expect(s.params.kind.length).toBeGreaterThan(0);     // non-empty kind (validator requirement)
  });

  it("filters blank output keys and defaults the kind to 'item' when unknown", () => {
    const p = blankPipeline(["rate", "", "  "]);
    expect(p.output).toEqual(["rate"]);
    expect((p.steps[0] as { params: { kind: string } }).params.kind).toBe("item");
  });
});

// EA-2 rider 2: the number-input suggestion list = the distinct numeric values present in the items.
describe("distinctNumberValues (EA-2 number-input suggestions)", () => {
  const items: RateMasterItem[] = [
    { discipline: "Electrical", kind: "popup_box_module", attributes: { module_count: 12 }, rates: {} },
    { discipline: "Electrical", kind: "popup_box_module", attributes: { module_count: 6 }, rates: {} },
    { discipline: "Electrical", kind: "popup_box_module", attributes: { module_count: 12 }, rates: {} },
    { discipline: "Electrical", kind: "popup_box_module", attributes: { note: "x" }, rates: {} },
  ];
  it("returns distinct numeric values ascending", () => {
    expect(distinctNumberValues(items, "module_count")).toEqual([6, 12]);
  });
  it("is empty for an attribute with no numeric data (the module_count-with-no-data case)", () => {
    expect(distinctNumberValues(items, "kva")).toEqual([]);
  });
});
