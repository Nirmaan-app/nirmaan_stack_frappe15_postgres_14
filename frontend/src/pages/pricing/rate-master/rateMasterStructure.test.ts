// RM-4b: tests for the structure pure helpers still in use -- the blank-step factory, the Data-tab scoping, the
// number suggestions and the attribute-type coercion. ADP-4b (owner D9, 2026-10-21): the Pipelines tab is removed, and
// with it the editor-only helpers and their tests (the preview gate evaluateGoldens / goldenDeltas, the reference
// guard mirror referencedAttrIds, cloneConfig, blankPipeline -- 9 tests, listed in the ADP-4b report).

import { describe, it, expect } from "vitest";
import type { AttributeDefinition, RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import { NONE_SENTINEL } from "./ratePipelineInterpreter";
import {
  STEP_VOCABULARY,
  coerceForMatch,
  isDropdownAttributeType,
  isNumericAttributeType,
  blankStep,
  categoryItemKinds,
  isCategoryDataScopeEmpty,
  distinctNumberValues,
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

// CP2 Phase A: `coerceForMatch` moved here from `pricingSheetHelper.ts` (the single point where an
// attribute value becomes a match key). These pins were written against the PRE-MOVE implementation
// and proven green there FIRST, then re-run against this shared export -- the move must change
// nothing. Item matching is strict identity, so the JS type produced here decides whether a catalog
// row is found at all.
describe("coerceForMatch -- every attribute type (CP2 Phase A move pins)", () => {
  const num = (over: Partial<AttributeDefinition> = {}): AttributeDefinition =>
    ({ id: "n", label: "N", type: "number", ...over }) as AttributeDefinition;
  const cho = (over: Partial<AttributeDefinition> = {}): AttributeDefinition =>
    ({ id: "c", label: "C", type: "choice", ...over }) as AttributeDefinition;

  it("number: a numeric string coerces to a NUMBER", () => {
    expect(coerceForMatch(num(), "1.5")).toBe(1.5);
    expect(coerceForMatch(num(), "3")).toBe(3);
    expect(coerceForMatch(num(), 3)).toBe(3);
    expect(coerceForMatch(num(), "0")).toBe(0);
  });
  it("number: a non-numeric value is an honest null, never NaN", () => {
    expect(coerceForMatch(num(), "abc")).toBeNull();
    expect(coerceForMatch(num(), "None")).toBeNull(); // no allow_none -> not the sentinel
  });
  it("choice: every value coerces to a STRING", () => {
    expect(coerceForMatch(cho(), "COPPER")).toBe("COPPER");
    expect(coerceForMatch(cho(), 3)).toBe("3");
    expect(coerceForMatch(cho(), 1.5)).toBe("1.5");
  });
  it("blank / null / undefined -> null on every type", () => {
    expect(coerceForMatch(num(), "")).toBeNull();
    expect(coerceForMatch(cho(), "")).toBeNull();
    expect(coerceForMatch(num(), null)).toBeNull();
    expect(coerceForMatch(cho(), null)).toBeNull();
    expect(coerceForMatch(num(), undefined as unknown as null)).toBeNull();
  });
  it("allow_none: the None sentinel is preserved VERBATIM on both types", () => {
    expect(coerceForMatch(num({ allow_none: true }), NONE_SENTINEL)).toBe(NONE_SENTINEL);
    expect(coerceForMatch(cho({ allow_none: true }), NONE_SENTINEL)).toBe(NONE_SENTINEL);
  });
  it("an unknown/absent type falls through to String", () => {
    expect(coerceForMatch({ id: "x", label: "X", type: "zzz" } as unknown as AttributeDefinition, 6)).toBe("6");
  });
});

// CP2 Phase B: the NUMERIC DROPDOWN type. A dropdown affordance with a NUMERIC match key -- the
// coercion is the whole reason the type exists, so it is pinned directly here, at the definition.
describe("coerceForMatch -- number_choice (CP2 Phase B)", () => {
  const nc = (over: Partial<AttributeDefinition> = {}): AttributeDefinition =>
    ({ id: "core", label: "Core", type: "number_choice", values_from: { kind: "cable", attr: "core" }, ...over }) as AttributeDefinition;

  it("coerces a picked option to a NUMBER (the point of the type)", () => {
    expect(coerceForMatch(nc(), "3")).toBe(3);
    expect(coerceForMatch(nc(), "1.5")).toBe(1.5);
    expect(coerceForMatch(nc(), 6)).toBe(6);
  });
  it("NEVER returns a string -- a plain choice would, and would then match nothing", () => {
    expect(typeof coerceForMatch(nc(), "3")).toBe("number");
    expect(coerceForMatch({ ...nc(), type: "choice" } as AttributeDefinition, "3")).toBe("3");
  });
  it("blank -> null and a non-numeric option -> null (honest, never NaN)", () => {
    expect(coerceForMatch(nc(), "")).toBeNull();
    expect(coerceForMatch(nc(), null)).toBeNull();
    expect(coerceForMatch(nc(), "abc")).toBeNull();
  });
  it("allow_none: the None sentinel survives, exactly as on the other two types", () => {
    expect(coerceForMatch(nc({ allow_none: true }), NONE_SENTINEL)).toBe(NONE_SENTINEL);
    expect(coerceForMatch(nc(), NONE_SENTINEL)).toBeNull(); // no allow_none -> not a number, not the sentinel
  });
});

// CP2 Phase B: the two type axes. `number_choice` is a dropdown (like choice) AND numeric (like
// number); an unknown/future type answers NO to both, so it degrades to a plain String input.
describe("isNumericAttributeType / isDropdownAttributeType (CP2 Phase B)", () => {
  it("number_choice is BOTH numeric and a dropdown", () => {
    expect(isNumericAttributeType("number_choice")).toBe(true);
    expect(isDropdownAttributeType("number_choice")).toBe(true);
  });
  it("the two existing types are unchanged", () => {
    expect(isNumericAttributeType("number")).toBe(true);
    expect(isDropdownAttributeType("number")).toBe(false);
    expect(isNumericAttributeType("choice")).toBe(false);
    expect(isDropdownAttributeType("choice")).toBe(true);
  });
  it("an unknown or absent type is neither", () => {
    expect(isNumericAttributeType("zzz")).toBe(false);
    expect(isDropdownAttributeType(undefined)).toBe(false);
  });
});
