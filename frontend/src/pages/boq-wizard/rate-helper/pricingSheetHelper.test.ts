// RM-3 real helper tests: compute over a fixed extraction fixture -> the standing goldens' values
// where the combo matches, a null-attribute partial, a low-confidence render, and version keying.
import { describe, it, expect } from "vitest";
import type { Pipeline, RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { buildExtractionByRow, isRunForVersion, makePricingSheetHelper } from "./pricingSheetHelper";

// cable_boq + termination_boq (verbatim shape from RM-1 config; BCS omitted -- not surfaced).
const PIPELINES: Record<string, Pipeline> = {
  cable_boq: {
    output: ["supply_per_mtr", "install_per_mtr"],
    steps: [
      { step: "match_master_row", params: { kind: "cable" } },
      {
        step: "apply_effective_multiplier", target: "list_price_per_mtr", result: "supply_per_mtr",
        conditions: [
          { when: { insulation: "ARMOURED" }, params: { discount: 0.75, markup: 0.35 } },
          { when: { insulation: "UNARMOURED" }, params: { discount: 0.57, markup: 0.4 } },
        ],
        formula: "(1-discount)*(1+markup)",
      },
      { step: "roundup", target: "supply_per_mtr", params: { digits: -1 } },
      { step: "scale", target: "install_base_per_mtr", result: "install_per_mtr", params: { install_markup: 1.0 }, formula: "base*(1+install_markup)" },
      { step: "roundup", target: "install_per_mtr", params: { digits: 0 } },
    ],
  },
  termination_boq: {
    output: ["supply_per_set", "install_per_set"],
    steps: [
      { step: "match_master_row", params: { kind: "termination" } },
      { step: "component", name: "lug", target: "lug_list", params: { discount: 0.4, markup: 0.55 }, formula: "lug_list*(1-discount)*(1+markup)" },
      {
        step: "component_band", name: "gland", band_on: "thickness_sqmm",
        bands: [{ when: "<35", target: "gland_band1_list" }, { when: ">=35", target: "gland_band2_list" }],
        params: { discount: 0.5, markup: 0.45 }, formula: "gland_list*(1-discount)*(1+markup)",
      },
      { step: "sum_components", result: "supply_per_set" },
      { step: "roundup", target: "supply_per_set", params: { digits: -1 } },
      { step: "install_as_ratio", params: { ratio: 0.25 }, result: "install_per_set" },
      { step: "roundup", target: "install_per_set", params: { digits: -1 } },
    ],
  },
};

const CONFIG: RateCategoryConfig = {
  discipline: "Electrical", category_id: "wiring_cabling",
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

// Real RM-1 raw rates for the golden combos.
const ITEMS: RateMasterItem[] = [
  cable("COPPER", "UNARMOURED", 1, 6, 192, 10),        // -> 120 / 20
  term("COPPER", "UNARMOURED", 1, 6, 11.46, 82.55, 361.18), // -> 80 / 20
  cable("COPPER", "ARMOURED", 3, 2.5, 570, 14),        // -> 200 / 28
  cable("COPPER", "UNARMOURED", 3, 10, 1037, 20),      // -> 630 / 40 (RM-2b fill)
];

function ext(attrs: Record<string, string | number | null>, conf = 0.9): ExtractionRow["attributes"] {
  const out: ExtractionRow["attributes"] = {};
  for (const [k, v] of Object.entries(attrs)) out[k] = { value: v, confidence: conf, corroborated: true };
  return out;
}
function ctx(excelRow: number, description: string): RateHelperRowContext {
  return { excelRow, description, nodeType: "Line Item", category: "wiring_cabling", discipline: "Electrical", rateKinds: ["supply_rate", "install_rate"] };
}

describe("makePricingSheetHelper -- goldens via the RM-2 interpreter", () => {
  it("COPPER/UNARMOURED/1C/6.0 cable row -> supply 120 / install 20 + paired termination 80/20", () => {
    const map = buildExtractionByRow([
      { excel_row: 2, description: "3C x 2.5 cable", attributes: ext({ material: "COPPER", insulation: "UNARMOURED", core: 1, thickness_sqmm: 6 }) },
    ]);
    const helper = makePricingSheetHelper({ config: CONFIG, items: ITEMS, extractionByRow: map });
    const r = helper.compute(ctx(2, "XLPE armoured cable 1C x 6 sqmm"));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.values.supply_rate).toBe(120);
    expect(r.values.install_rate).toBe(20);
    expect(r.values.combined_rate).toBe(140); // combined-rate column = supply + install
    // RM-3a: the paired termination now renders as its OWN labelled group, not a flat derivation line.
    expect(r.workings.sections?.map((s) => s.label)).toEqual(["Cable — per Mtr", "Termination — per Set"]);
    expect(r.workings.sections?.[1].finals.supply_per_set).toBe(80);
  });

  it("COPPER/ARMOURED/3C/2.5 -> 200 / 28", () => {
    const map = buildExtractionByRow([{ excel_row: 3, attributes: ext({ material: "COPPER", insulation: "ARMOURED", core: 3, thickness_sqmm: 2.5 }) }]);
    const helper = makePricingSheetHelper({ config: CONFIG, items: ITEMS, extractionByRow: map });
    const r = helper.compute(ctx(3, "cable 3C x 2.5"));
    expect(isSuggestion(r) && r.values.supply_rate).toBe(200);
    expect(isSuggestion(r) && r.values.install_rate).toBe(28);
  });

  it("COPPER/UNARMOURED/3C/10.0 (RM-2b fill) -> 630 / 40", () => {
    const map = buildExtractionByRow([{ excel_row: 4, attributes: ext({ material: "COPPER", insulation: "UNARMOURED", core: 3, thickness_sqmm: 10 }) }]);
    const helper = makePricingSheetHelper({ config: CONFIG, items: ITEMS, extractionByRow: map });
    const r = helper.compute(ctx(4, "cable 3C x 10"));
    expect(isSuggestion(r) && r.values.supply_rate).toBe(630);
    expect(isSuggestion(r) && r.values.install_rate).toBe(40);
  });

  it("a TERMINATION row prices termination alone (no cable, no paired line)", () => {
    const map = buildExtractionByRow([{ excel_row: 5, attributes: ext({ material: "COPPER", insulation: "UNARMOURED", core: 1, thickness_sqmm: 6 }) }]);
    const helper = makePricingSheetHelper({ config: CONFIG, items: ITEMS, extractionByRow: map });
    const r = helper.compute(ctx(5, "Cable end termination gland + lug 1C x 6"));
    expect(isSuggestion(r) && r.values.supply_rate).toBe(80);
    expect(isSuggestion(r) && r.values.install_rate).toBe(20);
    expect(isSuggestion(r) && r.workings.derivation.some((d) => d.includes("Paired termination"))).toBe(false);
  });

  it("null attribute -> honest partial: editable attributes, EMPTY value, no computed rate", () => {
    const map = buildExtractionByRow([{ excel_row: 6, attributes: ext({ material: null, insulation: "ARMOURED", core: 3, thickness_sqmm: 2.5 }) }]);
    const helper = makePricingSheetHelper({ config: CONFIG, items: ITEMS, extractionByRow: map });
    const r = helper.compute(ctx(6, "cable 3C x 2.5"));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.values.supply_rate).toBeUndefined();
    const mat = r.workings.attributes.find((a) => a.id === "material")!;
    expect(mat.value).toBe(""); // empty for the pricer to complete
    // completing it via overrides recomputes live -> a value appears
    const r2 = helper.compute(ctx(6, "cable 3C x 2.5"), { material: "COPPER" });
    expect(isSuggestion(r2) && r2.values.supply_rate).toBe(200);
  });

  it("low confidence + corroborated flags surface per attribute (display only)", () => {
    const attrs = ext({ material: "COPPER", insulation: "ARMOURED", core: 3, thickness_sqmm: 2.5 }, 0.2);
    attrs.material.corroborated = false;
    const map = buildExtractionByRow([{ excel_row: 3, attributes: attrs }]);
    const helper = makePricingSheetHelper({ config: CONFIG, items: ITEMS, extractionByRow: map });
    const r = helper.compute(ctx(3, "cable 3C x 2.5"));
    if (!isSuggestion(r)) throw new Error("expected suggestion");
    const mat = r.workings.attributes.find((a) => a.id === "material")!;
    expect(mat.confidence).toBe(0.2);
    expect(mat.corroborated).toBe(false);
    // the low confidence does NOT gate the value -- it still computes.
    expect(r.values.supply_rate).toBe(200);
  });

  it("a row NOT in the run offers a blank manual-fill suggestion that mints NO badge", () => {
    const helper = makePricingSheetHelper({ config: CONFIG, items: ITEMS, extractionByRow: new Map() });
    const r = helper.compute(ctx(99, "cable"));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    // no computed value AND no producibleKinds -> suggestionCountForKind stays 0 (badge-less);
    // reachable only via the always-on opener.
    expect(r.values.supply_rate).toBeUndefined();
    expect(r.producibleKinds).toBeUndefined();
    // every attribute renders blank + editable for the pricer to complete.
    expect(r.workings.attributes.every((a) => a.value === "")).toBe(true);
    // completing them via overrides recomputes live -> a real rate appears.
    const r2 = helper.compute(ctx(99, "cable"), {
      material: "COPPER", insulation: "ARMOURED", core: "3", thickness_sqmm: "2.5",
    });
    expect(isSuggestion(r2) && r2.values.supply_rate).toBe(200);
  });

  it("a not-in-run row of ANOTHER category shows coming-soon, no attribute fields", () => {
    const helper = makePricingSheetHelper({ config: CONFIG, items: ITEMS, extractionByRow: new Map() });
    const r = helper.compute({ ...ctx(99, "20mm conduit"), category: "electrical_conduit" });
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.reason.toLowerCase()).toContain("coming soon");
  });

  it("a not-in-run row with NO category shows coming-soon (attributes are category-scoped)", () => {
    const helper = makePricingSheetHelper({ config: CONFIG, items: ITEMS, extractionByRow: new Map() });
    const r = helper.compute({ ...ctx(99, "misc"), category: null });
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.reason.toLowerCase()).toContain("coming soon");
  });
});

// RM-3a: grouped workings -- a cable row splits into TWO labelled groups (Cable / Termination), each
// with its own final values; a termination row stays a SINGLE flat block (no `sections`, backward-shaped).
describe("RM-3a grouped workings (cable = two groups; termination = one, backward-shaped)", () => {
  it("a cable row emits TWO labelled groups, each with its OWN finals; shared attributes render once above", () => {
    const map = buildExtractionByRow([
      { excel_row: 2, attributes: ext({ material: "COPPER", insulation: "UNARMOURED", core: 1, thickness_sqmm: 6 }) },
    ]);
    const helper = makePricingSheetHelper({ config: CONFIG, items: ITEMS, extractionByRow: map });
    const r = helper.compute(ctx(2, "XLPE cable 1C x 6 sqmm"));
    if (!isSuggestion(r)) throw new Error("expected suggestion");
    const sections = r.workings.sections!;
    expect(sections).toHaveLength(2);
    expect(sections[0].label).toBe("Cable — per Mtr");
    expect(sections[1].label).toBe("Termination — per Set");
    // each group carries its OWN final values -- cable per-Mtr, termination per-Set (distinct blocks).
    expect(sections[0].finals.supply_per_mtr).toBe(120);
    expect(sections[0].finals.install_per_mtr).toBe(20);
    expect(sections[1].finals.supply_per_set).toBe(80);
    expect(sections[1].finals.install_per_set).toBe(20);
    // the SHARED extracted attributes live ONCE on top-level workings, not duplicated per group.
    expect(r.workings.attributes.map((a) => a.id)).toContain("material");
    expect(sections[0].attributes).toBeUndefined();
  });

  it("a termination row is a SINGLE flat group -- no `sections` (renders exactly as today)", () => {
    const map = buildExtractionByRow([
      { excel_row: 5, attributes: ext({ material: "COPPER", insulation: "UNARMOURED", core: 1, thickness_sqmm: 6 }) },
    ]);
    const helper = makePricingSheetHelper({ config: CONFIG, items: ITEMS, extractionByRow: map });
    const r = helper.compute(ctx(5, "Cable end termination gland + lug 1C x 6"));
    if (!isSuggestion(r)) throw new Error("expected suggestion");
    // no grouped sections -> the panel renders the flat matchedRows/derivation exactly as before.
    expect(r.workings.sections).toBeUndefined();
    expect(r.workings.derivation.length).toBeGreaterThan(0);
    expect(r.values.supply_rate).toBe(80);
  });
});

describe("version keying (no-show on mismatch)", () => {
  it("isRunForVersion is true only on an exact match", () => {
    expect(isRunForVersion(1, 1)).toBe(true);
    expect(isRunForVersion(1, 2)).toBe(false); // re-commit -> stored run no longer shows
    expect(isRunForVersion(null, 1)).toBe(false);
    expect(isRunForVersion(1, null)).toBe(false);
  });
});
