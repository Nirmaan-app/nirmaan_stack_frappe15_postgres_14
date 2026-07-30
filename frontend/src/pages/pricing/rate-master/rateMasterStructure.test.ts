// RM-4b: tests for the structure-editor pure helpers -- the preview gate (goldens computed against a
// draft), the reference guard mirror, the blank-step factory. The interpreter is exercised through
// evaluateGoldens (same pure compute the tab uses).

import { describe, it, expect } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import {
  STEP_VOCABULARY,
  blankStep,
  cloneConfig,
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
