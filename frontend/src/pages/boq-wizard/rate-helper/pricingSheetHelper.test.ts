// RM-3 real helper tests: compute over a fixed extraction fixture -> the standing goldens' values
// where the combo matches, a null-attribute partial, a low-confidence render, and version keying.
import { describe, it, expect } from "vitest";
import type { Pipeline, RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import {
  attrDisplayValue,
  isAttrBlank,
  isAttrDefaulted,
  isShowingDerived,
  isSuggestion,
  upgradeWarningText,
} from "./rateHelperTypes";
import { derivedQtyAttrs } from "@/pages/pricing/rate-master/RateMasterDerivation";
import { overridesForRow } from "./RateHelperPanel";
import {
  applyDerivedDisplay,
  attributeOptions,
  buildExtractionByRow,
  derivedAttrIds,
  isRunForVersion,
  makePricingSheetHelper,
  nonBcsPipelines,
  pipelineLabel,
  prettifyPipelineId,
} from "./pricingSheetHelper";

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
  // EA-2: the group labels are CONFIG DATA now (the audited wiring pipeline_labels edit).
  pipeline_labels: { cable_boq: "Cable — per Mtr", termination_boq: "Termination — per Set" },
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

// EA-2: N-category. A configsByCategory map resolves the config from the ROW's category; a generic
// (non-wiring) category renders ONE group per NON-BCS pipeline with config/prettified labels; an
// empty-pipelines (LMS) category declines "coming soon".
describe("EA-2 N-category compute gate + BCS exclusion + labels", () => {
  const DB_CONFIG: RateCategoryConfig = {
    discipline: "Electrical", category_id: "db_switchgear",
    attribute_definitions: [{ id: "item", label: "Item", type: "choice", values: ["40A FP MCCB"] }],
    pipelines: {
      db_boq: {
        output: ["supply_per_no", "install_per_no"],
        steps: [
          { step: "match_master_row", params: { kind: "db_item" } },
          { step: "scale", target: "supply_base", result: "supply_per_no", params: { markup: 0 }, formula: "base*(1+markup)" },
          { step: "scale", target: "install_base", result: "install_per_no", params: { markup: 0 }, formula: "base*(1+markup)" },
        ],
      },
      db_bcs: {  // a BCS pipeline -- must NEVER render as a helper group
        output: ["bcs_per_no"],
        steps: [
          { step: "match_master_row", params: { kind: "db_item" } },
          { step: "scale", target: "supply_base", result: "bcs_per_no", params: { markup: 0 }, formula: "base*(1+markup)" },
        ],
      },
    },
    pipeline_labels: { db_boq: "DB — per No" },
  };
  const DB_ITEMS: RateMasterItem[] = [
    { discipline: "Electrical", kind: "db_item", attributes: { item: "40A FP MCCB" }, rates: { supply_base: 500, install_base: 50 } },
  ];
  const LMS_CONFIG: RateCategoryConfig = {
    discipline: "Electrical", category_id: "lighting_mgmt_system",
    attribute_definitions: [{ id: "description", label: "Description", type: "choice", values: ["X"] }],
    pipelines: {},  // DATA-ONLY -> not eligible -> coming soon
  };
  const byCat = new Map<string, RateCategoryConfig>([
    ["db_switchgear", DB_CONFIG],
    ["lighting_mgmt_system", LMS_CONFIG],
  ]);

  it("a DB-item in-run row computes via db_boq -- ONE non-BCS group, config label; db_bcs is never a group", () => {
    const map = buildExtractionByRow([{ excel_row: 10, attributes: ext({ item: "40A FP MCCB" }) }]);
    const helper = makePricingSheetHelper({ configsByCategory: byCat, items: DB_ITEMS, extractionByRow: map });
    const r = helper.compute({ excelRow: 10, description: "40A FP MCCB", nodeType: "Line Item", category: "db_switchgear", discipline: "Electrical", rateKinds: ["supply_rate", "install_rate"] });
    if (!isSuggestion(r)) throw new Error("expected suggestion");
    expect(r.values.supply_rate).toBe(500);
    expect(r.values.install_rate).toBe(50);
    expect(r.values.combined_rate).toBe(550);
    // exactly ONE group (db_boq); the BCS pipeline is filtered out entirely.
    expect(r.workings.sections).toHaveLength(1);
    expect(r.workings.sections![0].label).toBe("DB — per No");
    // no group derived from a bcs pipeline (its output key never appears in any group finals)
    expect(r.workings.sections!.some((s) => "bcs_per_no" in s.finals)).toBe(false);
  });

  it("an empty-pipelines (LMS) category declines coming-soon", () => {
    const helper = makePricingSheetHelper({ configsByCategory: byCat, items: DB_ITEMS, extractionByRow: new Map() });
    const r = helper.compute({ excelRow: 11, description: "occupancy sensor", nodeType: "Line Item", category: "lighting_mgmt_system", discipline: "Electrical", rateKinds: [] });
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.reason.toLowerCase()).toContain("coming soon");
  });

  it("a category with no config at all declines coming-soon", () => {
    const helper = makePricingSheetHelper({ configsByCategory: byCat, items: DB_ITEMS, extractionByRow: new Map() });
    const r = helper.compute({ excelRow: 12, description: "x", nodeType: "Line Item", category: "point_wiring", discipline: "Electrical", rateKinds: [] });
    expect(r.kind).toBe("none");
  });

  it("pipeline labels: config data wins, else a prettified id; BCS ids are excluded from the surfaced set", () => {
    expect(pipelineLabel(DB_CONFIG, "db_boq")).toBe("DB — per No");
    expect(pipelineLabel(DB_CONFIG, "db_install")).toBe("Db Install"); // prettified fallback
    expect(prettifyPipelineId("conduit_boq")).toBe("Conduit Boq");
    expect(nonBcsPipelines(DB_CONFIG).map(([id]) => id)).toEqual(["db_boq"]); // db_bcs excluded
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

// ---- EA-4a: the assembly helper prices a point_wiring row (per-component workings render) ----
const PW_CF = {
  step: "circuit_fit" as const,
  params: {
    sizes: [25, 32, 50], usable: { PVC: [0.55, 0.55, 0.55], MS: [0.45, 0.45, 0.47] },
    wire_specs: [["wire1_core", "wire1_thickness_sqmm"], ["wire2_core", "wire2_thickness_sqmm"]] as [string, string][],
    length_attr: "circuit_length_m", conduit_type_attr: "conduit_type",
  },
  binds: ["fitted_size", "circuits", "conduit_qty"],
};
function pwcref(name: string, ref: Record<string, string | number>, target: string, rate_stages: Array<{ mult: number; round?: "up0" | "up-1" }>, qty: unknown) {
  return { step: "component_ref" as const, name, ref, target, rate_stages, qty };
}
const wRef = (c: string, t: string) => ({ kind: "cable", material: "COPPER", insulation: "UNARMOURED", core: c, thickness_sqmm: t });
const cdRef = { kind: "conduit", conduit_type: "@conduit_type", size_mm: "@fitted_size" };
const sRef = (f: string, i: string, c: string) => ({ kind: "switch_socket_item", family: f, item: i, colour: c });
function pwPipe(output: string, wireMult: number, wireTarget: string, condStages: Array<{ mult: number; round?: "up0" }>, ssStages: (n: string) => Array<{ mult: number; round?: "up0" }>, result: string): Pipeline {
  return {
    output: [output],
    steps: [
      PW_CF,
      pwcref("wire1", wRef("@wire1_core", "@wire1_thickness_sqmm"), wireTarget, [{ mult: wireMult, round: "up0" }], { from_attr: "circuit_length_m" }),
      pwcref("wire2", wRef("@wire2_core", "@wire2_thickness_sqmm"), wireTarget, [{ mult: wireMult, round: "up0" }], { from_attr: "circuit_length_m" }),
      pwcref("conduit", cdRef, "list_price_per_mtr", condStages, { from_fit: "conduit_qty" }),
      pwcref("switch", sRef("Switch", "@switch_item", "@colour"), "list_price", ssStages("switch"), { from_attr: "switch_qty" }),
      pwcref("socket", sRef("Socket", "@socket_item", "@colour"), "list_price", ssStages("socket"), { from_attr: "socket_qty" }),
      pwcref("plate", sRef("Grid and Face Plates", "@plate_item", "@colour"), "list_price", ssStages("plate"), { from_attr: "plate_qty" }),
      pwcref("back_box", sRef("Back Box", "@plate_item", "NA"), "list_price", ssStages("back_box"), { if_attr: { back_box: "Yes" }, then: 1, else: 0 }),
      { step: "sum_components", result },
    ],
  };
}
const PW_CONFIG: RateCategoryConfig = {
  discipline: "Electrical", category_id: "point_wiring", item_kinds: [],
  attribute_definitions: [
    { id: "wire1_core", label: "Wire1 core", type: "number" }, { id: "wire1_thickness_sqmm", label: "Wire1 sqmm", type: "number" },
    { id: "wire2_core", label: "Wire2 core", type: "number" }, { id: "wire2_thickness_sqmm", label: "Wire2 sqmm", type: "number" },
    { id: "circuit_length_m", label: "Length", type: "number" }, { id: "switch_qty", label: "Switch qty", type: "number" },
    { id: "socket_qty", label: "Socket qty", type: "number" }, { id: "plate_qty", label: "Plate qty", type: "number" },
    { id: "conduit_type", label: "Conduit", type: "choice", values: ["PVC", "MS"] },
    { id: "switch_item", label: "Switch", type: "choice", values_from: { kind: "switch_socket_item", attr: "item", where: { family: "Switch" } } },
    { id: "socket_item", label: "Socket", type: "choice", values_from: { kind: "switch_socket_item", attr: "item", where: { family: "Socket" } } },
    { id: "plate_item", label: "Plate", type: "choice", values_from: { kind: "switch_socket_item", attr: "item", where: { family: "Grid and Face Plates" } } },
    { id: "colour", label: "Colour", type: "choice", values: ["White", "Grey"] }, { id: "back_box", label: "Back box", type: "choice", values: ["Yes", "No"] },
  ],
  pipelines: {
    pw_boq_supply: pwPipe("supply", 0.602, "list_price_per_mtr", [{ mult: 0.7, round: "up0" }], () => [{ mult: 0.3625, round: "up0" }], "supply"),
    pw_boq_install: {
      output: ["install"],
      steps: [
        PW_CF,
        pwcref("wire1", wRef("@wire1_core", "@wire1_thickness_sqmm"), "install_base_per_mtr", [{ mult: 2.0, round: "up0" }], { from_attr: "circuit_length_m" }),
        pwcref("wire2", wRef("@wire2_core", "@wire2_thickness_sqmm"), "install_base_per_mtr", [{ mult: 2.0, round: "up0" }], { from_attr: "circuit_length_m" }),
        pwcref("conduit", cdRef, "list_price_per_mtr", [{ mult: 0.7 }, { mult: 0.2, round: "up0" }], { from_fit: "conduit_qty" }),
        pwcref("switch", sRef("Switch", "@switch_item", "@colour"), "list_price", [{ mult: 0.3625, round: "up0" }, { mult: 0.2 }], { from_attr: "switch_qty" }),
        pwcref("socket", sRef("Socket", "@socket_item", "@colour"), "list_price", [{ mult: 0.0725, round: "up0" }], { from_attr: "socket_qty" }),
        pwcref("plate", sRef("Grid and Face Plates", "@plate_item", "@colour"), "list_price", [{ mult: 0.0725, round: "up0" }], { from_attr: "plate_qty" }),
        pwcref("back_box", sRef("Back Box", "@plate_item", "NA"), "list_price", [{ mult: 0.0725, round: "up0" }], { if_attr: { back_box: "Yes" }, then: 1, else: 0 }),
        { step: "sum_components", result: "install" },
      ],
    },
    pw_bcs: pwPipe("bcs_supply", 0.4515, "list_price_per_mtr", [{ mult: 0.5, round: "up0" }], () => [{ mult: 0.25, round: "up0" }], "bcs_supply"),
  },
};
function pcbl(core: number, th: number, list: number, install: number): RateMasterItem {
  return { discipline: "Electrical", kind: "cable", attributes: { material: "COPPER", insulation: "UNARMOURED", core, thickness_sqmm: th }, rates: { list_price_per_mtr: list, install_base_per_mtr: install } };
}
const PW_HELPER_ITEMS: RateMasterItem[] = [
  pcbl(1, 2.5, 82.95, 10), pcbl(1, 1.5, 50.45, 10),
  { discipline: "Electrical", kind: "conduit", attributes: { conduit_type: "PVC", size_mm: 25 }, rates: { list_price_per_mtr: 60 } },
  { discipline: "Electrical", kind: "switch_socket_item", attributes: { family: "Switch", item: "16A 1 WAY SWITCH- With Indicator", colour: "Grey" }, rates: { list_price: 427 } },
  { discipline: "Electrical", kind: "switch_socket_item", attributes: { family: "Socket", item: "6A/16A 3-Pin Socket", colour: "Grey" }, rates: { list_price: 514 } },
  { discipline: "Electrical", kind: "switch_socket_item", attributes: { family: "Grid and Face Plates", item: "3M", colour: "Grey" }, rates: { list_price: 235 } },
  { discipline: "Electrical", kind: "switch_socket_item", attributes: { family: "Back Box", item: "3M", colour: "NA" }, rates: { list_price: 158 } },
];
const PW_EXT = {
  wire1_core: { value: 1, confidence: 0.9 }, wire1_thickness_sqmm: { value: 2.5, confidence: 0.9 },
  wire2_core: { value: 1, confidence: 0.9 }, wire2_thickness_sqmm: { value: 1.5, confidence: 0.9 },
  circuit_length_m: { value: 15, confidence: 0.9, defaulted: true }, switch_qty: { value: 1, confidence: 0.9, defaulted: true },
  socket_qty: { value: 1, confidence: 0.9 }, plate_qty: { value: 1, confidence: 0.9 },
  conduit_type: { value: "PVC", confidence: 0.9 }, switch_item: { value: "16A 1 WAY SWITCH- With Indicator", confidence: 0.9 },
  socket_item: { value: "6A/16A 3-Pin Socket", confidence: 0.9 }, plate_item: { value: "3M", confidence: 0.9 },
  colour: { value: "Grey", confidence: 0.9 }, back_box: { value: "Yes", confidence: 0.9, defaulted: true },
};

describe("makePricingSheetHelper -- EA-4a point_wiring assembly", () => {
  it("prices the pw1 golden row: supply 1869, install 735, combined 2604 (+ per-component workings)", () => {
    const map = buildExtractionByRow([{ excel_row: 40, attributes: PW_EXT as never }]);
    const helper = makePricingSheetHelper({ configsByCategory: new Map([["point_wiring", PW_CONFIG]]), items: PW_HELPER_ITEMS, extractionByRow: map });
    const r = helper.compute({ ...ctx(40, "Point wiring for a light point"), category: "point_wiring" });
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.values.supply_rate).toBe(1869);
    expect(r.values.install_rate).toBe(735);
    expect(r.values.combined_rate).toBe(2604);
    // per-component build-up surfaced (the bill), not just the total
    const supplySection = r.workings.sections?.find((s) => s.label.toLowerCase().includes("supply"));
    expect((supplySection?.matchedRows ?? []).some((m) => m.includes("wire1") && m.includes("750"))).toBe(true);
    // defaulted attrs surfaced
    expect(r.workings.derivation.some((d) => d.includes("defaulted"))).toBe(true);
  });
  it("a PW row missing a wire size is honest-partial (fill to price), never a guess", () => {
    const partial = { ...PW_EXT, wire1_thickness_sqmm: { value: null, confidence: 0.2 } };
    const map = buildExtractionByRow([{ excel_row: 41, attributes: partial as never }]);
    const helper = makePricingSheetHelper({ configsByCategory: new Map([["point_wiring", PW_CONFIG]]), items: PW_HELPER_ITEMS, extractionByRow: map });
    const r = helper.compute({ ...ctx(41, "Point wiring"), category: "point_wiring" });
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.values.combined_rate).toBeUndefined();
  });

  // EA-4a values_from: a switch/socket/plate def has NO static `values` -- its options must resolve
  // FROM the live master (the SAME read the Derivation screen + the backend prompt use). Pre-fix the
  // panel dropdowns were EMPTY, so an AI-extracted item could not display and a partial row could not
  // be completed.
  const SWITCH_DEF = PW_CONFIG.attribute_definitions.find((d) => d.id === "switch_item")!;
  // a second switch so the resolved catalog carries >1 option (mirrors the real 10A/16A shape)
  const PW_ITEMS_2SW: RateMasterItem[] = [
    ...PW_HELPER_ITEMS,
    { discipline: "Electrical", kind: "switch_socket_item", attributes: { family: "Switch", item: "10A 1 WAY SWITCH", colour: "Grey" }, rates: { list_price: 142 } },
  ];

  it("attributeOptions resolves a values_from choice from the live master (by kind + where), distinct", () => {
    expect(SWITCH_DEF.values).toBeUndefined(); // no static list -- pre-fix this yielded []
    expect(attributeOptions(SWITCH_DEF, PW_ITEMS_2SW)).toEqual([
      "16A 1 WAY SWITCH- With Indicator",
      "10A 1 WAY SWITCH",
    ]);
    // a static-`values` choice is unchanged (conduit_type -> PVC/MS)
    const conduit = PW_CONFIG.attribute_definitions.find((d) => d.id === "conduit_type")!;
    expect(attributeOptions(conduit, PW_ITEMS_2SW)).toEqual(["PVC", "MS"]);
  });

  it("an AI-extracted item NOT in the def's `values` but IN the resolved catalog DISPLAYS in the panel", () => {
    // the AI read a switch the def has no static option for; only values_from resolution can show it
    const extWithCatalogSwitch = { ...PW_EXT, switch_item: { value: "10A 1 WAY SWITCH", confidence: 0.9 } };
    const map = buildExtractionByRow([{ excel_row: 42, attributes: extWithCatalogSwitch as never }]);
    const helper = makePricingSheetHelper({ configsByCategory: new Map([["point_wiring", PW_CONFIG]]), items: PW_ITEMS_2SW, extractionByRow: map });
    const r = helper.compute({ ...ctx(42, "Point wiring for a light point"), category: "point_wiring" });
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    const sw = r.workings.attributes.find((a) => a.id === "switch_item")!;
    expect(sw.options).toEqual(expect.arrayContaining(["16A 1 WAY SWITCH- With Indicator", "10A 1 WAY SWITCH"]));
    // the extracted value is AMONG the options -> the <select> can render it selected (it DISPLAYS)
    expect(sw.value).toBe("10A 1 WAY SWITCH");
    expect(sw.options).toContain(sw.value);
  });
});

// ---- EA-4a-r: the None mechanism in the editor helper (options + disable/clear) ----
describe("makePricingSheetHelper -- EA-4a-r None (positive absence)", () => {
  it("attributeOptions prepends 'None' for an allow_none def; a plain choice is unchanged", () => {
    const socketDef = { id: "socket_item", label: "Socket", type: "choice" as const, allow_none: true, values_from: { kind: "switch_socket_item", attr: "item", where: { family: "Socket" } } };
    const opts = attributeOptions(socketDef, PW_HELPER_ITEMS);
    expect(opts[0]).toBe("None");
    expect(opts).toContain("6A/16A 3-Pin Socket");
    const plain = { id: "colour", label: "Colour", type: "choice" as const, values: ["White", "Grey"] };
    expect(attributeOptions(plain, PW_HELPER_ITEMS)).toEqual(["White", "Grey"]);
  });

  it("extraction socket_item='None' -> socket_qty is greyed (disabled) + cleared; None is preserved as the value", () => {
    const cfg: RateCategoryConfig = {
      discipline: "Electrical", category_id: "point_wiring", item_kinds: [],
      attribute_definitions: [
        { id: "socket_item", label: "Socket", type: "choice", allow_none: true, disables_when_none: ["socket_qty"], values_from: { kind: "switch_socket_item", attr: "item", where: { family: "Socket" } } },
        { id: "socket_qty", label: "Socket qty", type: "number" },
      ],
      pipelines: { p: { output: ["x"], steps: [
        { step: "component_ref", name: "socket", ref: { kind: "switch_socket_item", family: "Socket", item: "@socket_item", colour: "Grey" }, target: "list_price", rate_stages: [{ mult: 1 }], qty: { from_attr: "socket_qty" }, none_skips: true },
        { step: "sum_components", result: "x" },
      ] } },
    };
    const map = buildExtractionByRow([{ excel_row: 50, attributes: { socket_item: { value: "None", confidence: 0.9 }, socket_qty: { value: 1, confidence: 0.9 } } as never }]);
    const helper = makePricingSheetHelper({ configsByCategory: new Map([["point_wiring", cfg]]), items: PW_HELPER_ITEMS, extractionByRow: map });
    const r = helper.compute({ ...ctx(50, "light point controlled by one switch"), category: "point_wiring" });
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    const socketItem = r.workings.attributes.find((a) => a.id === "socket_item")!;
    expect(socketItem.options?.[0]).toBe("None");
    expect(socketItem.value).toBe("None"); // preserved, not coerced away
    const socketQty = r.workings.attributes.find((a) => a.id === "socket_qty")!;
    expect(socketQty.disabled).toBe(true);
    expect(socketQty.value).toBe(""); // cleared
  });
});

// ---- EA-4a-r: the number-typed allow_none affordance (the "None" checkbox analogue) ----
describe("makePricingSheetHelper -- EA-4a-r allow_none NUMBER def (None checkbox affordance)", () => {
  const cfg: RateCategoryConfig = {
    discipline: "Electrical", category_id: "point_wiring", item_kinds: [],
    attribute_definitions: [
      { id: "wire2_thickness_sqmm", label: "Wire2 sqmm", type: "number", allow_none: true, disables_when_none: ["wire2_core"] },
      { id: "wire2_core", label: "Wire2 core", type: "number" },
    ],
    pipelines: { p: { output: ["x"], steps: [{ step: "sum_components", result: "x" }] } },
  };
  it("a normal numeric value carries the allowNone flag (panel renders the checkbox) + the number", () => {
    const m = buildExtractionByRow([{ excel_row: 60, attributes: { wire2_thickness_sqmm: { value: 1.5, confidence: 0.9 }, wire2_core: { value: 1, confidence: 0.9 } } as never }]);
    const h = makePricingSheetHelper({ configsByCategory: new Map([["point_wiring", cfg]]), items: PW_HELPER_ITEMS, extractionByRow: m });
    const r = h.compute({ ...ctx(60, "point"), category: "point_wiring" });
    expect(isSuggestion(r)).toBe(true); if (!isSuggestion(r)) return;
    const w = r.workings.attributes.find((a) => a.id === "wire2_thickness_sqmm")!;
    expect(w.allowNone).toBe(true);
    expect(w.options).toBeUndefined(); // a NUMBER def -> no select options; the checkbox is the affordance
    expect(w.value).toBe("1.5");
  });
  it("setting the number def to 'None' yields the sentinel + disables/clears its dependent (wire2_core)", () => {
    const m = buildExtractionByRow([{ excel_row: 61, attributes: { wire2_thickness_sqmm: { value: "None", confidence: 0.9 }, wire2_core: { value: 1, confidence: 0.9 } } as never }]);
    const h = makePricingSheetHelper({ configsByCategory: new Map([["point_wiring", cfg]]), items: PW_HELPER_ITEMS, extractionByRow: m });
    const r = h.compute({ ...ctx(61, "point"), category: "point_wiring" });
    expect(isSuggestion(r)).toBe(true); if (!isSuggestion(r)) return;
    const w = r.workings.attributes.find((a) => a.id === "wire2_thickness_sqmm")!;
    expect(w.allowNone).toBe(true);
    expect(w.value).toBe("None"); // sentinel preserved -> the checkbox renders checked
    const core = r.workings.attributes.find((a) => a.id === "wire2_core")!;
    expect(core.disabled).toBe(true);
    expect(core.value).toBe("");
  });
});

// ---------------------------------------------------------------------------------------------
// UI SLICE (U2) PINS -- these assert the PRE-CHANGE truth and are proven GREEN against the
// UNCHANGED helper. The marked pin below is UPDATED (not deleted) once U2 lands, so the diff
// shows exactly what the contract carried before and after.
//
// Pre-change truth: the `defaulted` flag arrives per attribute from the server and the helper READS
// it (through an undeclared cast at pricingSheetHelper.ts:242), but only to flatten it into ONE
// PROSE derivation line. It never reaches the per-attribute contract the panel renders.
// ---------------------------------------------------------------------------------------------
describe("U2 pins -- how `defaulted` is carried today", () => {
  // NOTE: attrOverrides is compute's SECOND POSITIONAL argument, not a ctx property.
  const pwCompute = (overrides?: Record<string, string>) => {
    const map = buildExtractionByRow([{ excel_row: 40, attributes: PW_EXT as never }]);
    const helper = makePricingSheetHelper({
      configsByCategory: new Map([["point_wiring", PW_CONFIG]]),
      items: PW_HELPER_ITEMS,
      extractionByRow: map,
    });
    return helper.compute(
      { ...ctx(40, "Point wiring for a light point"), category: "point_wiring" },
      overrides,
    );
  };

  // STAYS GREEN THROUGH U2 (U2e: the prose trace is a different surface and must NOT be removed).
  it("surfaces the defaulted attributes as ONE prose derivation line that NAMES them", () => {
    const r = pwCompute();
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    const line = r.workings.derivation.find((d) => d.includes("defaulted"));
    expect(line).toBeDefined();
    expect(line).toContain("no positive text identification");
    expect(line).toContain("Length=15");
  });

  // >>> THE PIN U2 UPDATED <<<  Pre-change this asserted `toBeUndefined()` (the flag existed on the
  // wire but never reached the per-attribute contract, so the panel could not highlight it). U2 makes
  // it structural; the cast at pricingSheetHelper.ts:242 is gone.
  it("carries `defaulted` on the per-attribute contract", () => {
    const r = pwCompute();
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    // circuit_length_m / switch_qty / back_box carry defaulted:true in PW_EXT
    expect(r.workings.attributes.find((a) => a.id === "circuit_length_m")!.defaulted).toBe(true);
    expect(r.workings.attributes.find((a) => a.id === "switch_qty")!.defaulted).toBe(true);
    expect(r.workings.attributes.find((a) => a.id === "back_box")!.defaulted).toBe(true);
  });

  it("(negative) a POSITIVELY-READ attribute is NOT marked defaulted", () => {
    const r = pwCompute();
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    // socket_qty / plate_qty / colour carry NO defaulted flag in PW_EXT
    expect(r.workings.attributes.find((a) => a.id === "socket_qty")!.defaulted).toBeUndefined();
    expect(r.workings.attributes.find((a) => a.id === "plate_qty")!.defaulted).toBeUndefined();
    expect(r.workings.attributes.find((a) => a.id === "colour")!.defaulted).toBeUndefined();
  });

  it("(U2d) a human OVERRIDE clears the STRUCTURAL flag too -- both surfaces agree", () => {
    const r = pwCompute({ circuit_length_m: "20" });
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    const len = r.workings.attributes.find((a) => a.id === "circuit_length_m")!;
    expect(len.value).toBe("20");
    expect(len.defaulted).toBeUndefined();
    // ...and the attribute is gone from the prose line as well (the ONE condition drives both)
    expect(r.workings.derivation.find((d) => d.includes("defaulted"))).not.toContain("Length=");
  });

  // The U2d rule ALREADY exists, expressed through the prose line: a human override drops the
  // attribute from it. U2 must carry this same rule onto the structural flag, not contradict it.
  it("(negative) a human OVERRIDE drops that attribute from the defaulted line", () => {
    const r = pwCompute({ circuit_length_m: "20" });
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    const line = r.workings.derivation.find((d) => d.includes("defaulted"));
    expect(line).toBeDefined();
    expect(line).not.toContain("Length=");
    expect(r.workings.attributes.find((a) => a.id === "circuit_length_m")!.value).toBe("20");
  });

  // A blank attribute is `value: ""`; a POSITIVELY-ABSENT one is the "None" sentinel or `disabled`.
  // U2 must highlight the first and NEITHER of the last two -- pinned here on the pre-change shape.
  it("distinguishes blank ('') from positively-absent (disabled) on the contract", () => {
    const partial = { ...PW_EXT, wire1_thickness_sqmm: { value: null, confidence: 0.2 } };
    const map = buildExtractionByRow([{ excel_row: 41, attributes: partial as never }]);
    const helper = makePricingSheetHelper({
      configsByCategory: new Map([["point_wiring", PW_CONFIG]]),
      items: PW_HELPER_ITEMS,
      extractionByRow: map,
    });
    const r = helper.compute({ ...ctx(41, "Point wiring"), category: "point_wiring" });
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    const blank = r.workings.attributes.find((a) => a.id === "wire1_thickness_sqmm")!;
    expect(blank.value).toBe("");
    expect(blank.disabled).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// U2 -- the two pure HIGHLIGHT predicates. The panel's render is structurally untestable here (node
// env, no jsdom by deliberate config), so the RULE is pinned instead of the pixels.
// ---------------------------------------------------------------------------------------------
describe("U2 -- isAttrBlank / isAttrDefaulted (the three-way state)", () => {
  it("BLANK: an empty value with no positive-absence marker", () => {
    expect(isAttrBlank({ value: "", disabled: undefined })).toBe(true);
    expect(isAttrBlank({ value: "2.5", disabled: undefined })).toBe(false);
  });

  it("DEFAULTED: the flag, and only when the attribute is live", () => {
    expect(isAttrDefaulted({ defaulted: true, disabled: undefined })).toBe(true);
    expect(isAttrDefaulted({ defaulted: undefined, disabled: undefined })).toBe(false);
    expect(isAttrDefaulted({ defaulted: false, disabled: undefined })).toBe(false);
  });

  it('(negative) POSITIVE ABSENCE gets NEITHER highlight -- "None" is a decision, not a gap', () => {
    // the NONE sentinel carries a value, so it is not blank
    expect(isAttrBlank({ value: "None", disabled: undefined })).toBe(false);
    expect(isAttrDefaulted({ value: "None", disabled: undefined, defaulted: undefined } as never)).toBe(false);
  });

  it("(negative) a DISABLED attribute (its controller is None) gets NEITHER highlight", () => {
    // disabled attrs carry value "" -- without the disabled guard they would read as blank
    expect(isAttrBlank({ value: "", disabled: true })).toBe(false);
    expect(isAttrDefaulted({ defaulted: true, disabled: true })).toBe(false);
  });
});

// ── DERIVED-ATTRIBUTE GATE ──────────────────────────────────────────────────────────
// An attribute the pipeline DERIVES is never "missing user input". `module_fit`'s ladders BIND
// `plate_item`, and the helper's gate counted it as required -- refusing 26 rows across
// switches_sockets and point_wiring that the pipeline prices perfectly well.
//
// ⚠️ `bind` IS NOT `floor_from`, and `plate_item` is BOTH on its own ladder. Being a bind WINS: the
// pipeline can always compute the value, so blank means "no floor stated". A `floor_from` that is
// NOT a bind stays a genuine input. Both directions are pinned below.

/** A module_fit config in the shape the live switches_sockets / point_wiring configs carry. */
function moduleFitConfig(): RateCategoryConfig {
  return {
    discipline: "Electrical",
    category_id: "mf_probe",
    attribute_definitions: [
      { id: "switch_item", label: "Switch", type: "choice", values: ["10A 1 WAY SWITCH"] },
      { id: "switch_qty", label: "Switch qty", type: "number" },
      { id: "plate_item", label: "Plate", type: "choice", values: ["3M", "6M"] },
      { id: "plate_qty", label: "Plate qty", type: "number" },
      { id: "blank_qty", label: "Blank qty", type: "number" },
    ],
    pipelines: {
      probe_boq: {
        output: ["supply"],
        steps: [
          {
            step: "module_fit",
            params: {
              terms: [{ attr: "switch_qty", weight: 1 }],
              ladders: [
                { kind: "switch_socket_item", bind: "plate_item", floor_from: "plate_item" },
                { kind: "switch_socket_item", bind: "box_item", floor_from: "plate_item" },
              ],
              blanks: { bind: "blank_count", from_ladder: "plate_item" },
            },
          },
          {
            step: "component_ref", name: "blank", ref: { kind: "switch_socket_item" },
            target: "list_price", qty: { from_fit: "blank_count" },
          },
          { step: "sum_components", result: "supply" },
        ],
      },
    },
  } as unknown as RateCategoryConfig;
}

describe("derivedAttrIds -- ladder binds are derived (the 26-dead-rows fix)", () => {
  it("POSITIVE: a module_fit ladder BIND is derived", () => {
    const d = derivedAttrIds(moduleFitConfig());
    expect(d.has("plate_item")).toBe(true);
    expect(d.has("box_item")).toBe(true);
  });

  it("POSITIVE: it still reports the `<name>_qty` half -- the two mechanisms compose", () => {
    // blank_qty is superseded by the component taking qty:{from_fit} -- derivedQtyAttrs' job,
    // REUSED here rather than re-implemented (one definition per half).
    expect(derivedAttrIds(moduleFitConfig()).has("blank_qty")).toBe(true);
  });

  it("NEGATIVE: a genuine INPUT is not derived", () => {
    const d = derivedAttrIds(moduleFitConfig());
    expect(d.has("switch_item")).toBe(false);
    expect(d.has("switch_qty")).toBe(false);
  });

  it("bind vs floor_from, BOTH WAYS: a floor_from that is NOT a bind stays an input", () => {
    const cfg = moduleFitConfig();
    const mf = (cfg.pipelines.probe_boq.steps as unknown as Array<Record<string, any>>)[0];
    mf.params.ladders = [{ kind: "switch_socket_item", bind: "box_item", floor_from: "plate_item" }];
    const d = derivedAttrIds(cfg);
    expect(d.has("box_item")).toBe(true);      // the bind IS derived
    expect(d.has("plate_item")).toBe(false);   // a floor_from alone is NOT
  });

  it("bind WINS when one attribute is both -- the shape v24 actually ships", () => {
    expect(derivedAttrIds(moduleFitConfig()).has("plate_item")).toBe(true);
  });

  it("NEGATIVE: a config with no module_fit is byte-unaffected", () => {
    const cfg = moduleFitConfig();
    (cfg.pipelines.probe_boq.steps as unknown as Array<unknown>).shift();
    const d = derivedAttrIds(cfg);
    expect(d.has("plate_item")).toBe(false);
    expect(d.has("box_item")).toBe(false);
    expect(d.has("blank_qty")).toBe(true);     // the qty half still applies
  });

  it("READ FROM CONFIG, never hardcoded: a ladder binding an arbitrary id is derived too", () => {
    const cfg = moduleFitConfig();
    const mf = (cfg.pipelines.probe_boq.steps as unknown as Array<Record<string, any>>)[0];
    mf.params.ladders = [{ kind: "k", bind: "some_future_attr" }];
    const d = derivedAttrIds(cfg);
    expect(d.has("some_future_attr")).toBe(true);
    expect(d.has("plate_item")).toBe(false);
  });
});

describe("the missing-attribute gate NARROWS, but still blocks", () => {
  const ITEMS_MF: RateMasterItem[] = [
    {
      discipline: "Electrical", kind: "switch_socket_item",
      attributes: { item: "3M", family: "Grid and Face Plates" }, rates: { list_price: 100 },
    },
  ];
  const ctxFor = (excelRow: number): RateHelperRowContext => ({
    excelRow, description: "probe row", nodeType: "Line Item",
    category: "mf_probe", discipline: "Electrical",
    rateKinds: ["supply_rate", "install_rate", "combined_rate"] as unknown as never,
  });
  const helperWith = (attrs: Record<string, { value: string | number | null; confidence: number }>) =>
    makePricingSheetHelper({
      configsByCategory: new Map([["mf_probe", moduleFitConfig()]]),
      items: ITEMS_MF,
      extractionByRow: buildExtractionByRow([{ excel_row: 1, attributes: attrs }]),
    });

  it("POSITIVE: a blank DERIVED attribute no longer blocks the row", () => {
    const r = helperWith({
      switch_item: { value: "10A 1 WAY SWITCH", confidence: 0.9 },
      switch_qty: { value: 1, confidence: 0.9 },
      plate_item: { value: null, confidence: 0.3 },   // DERIVED -- blank means "no floor stated"
      plate_qty: { value: 1, confidence: 0.9 },
      blank_qty: { value: null, confidence: 0.5 },    // DERIVED (from_fit)
    }).compute(ctxFor(1));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    // BEFORE the fix this read "Complete the missing attributes to price"
    expect(r.basis).not.toMatch(/Complete the missing attributes/);
  });

  it("NEGATIVE: a blank GENUINE input still blocks -- narrowing, not removing", () => {
    const r = helperWith({
      switch_item: { value: null, confidence: 0.2 },  // a REAL missing input
      switch_qty: { value: 1, confidence: 0.9 },
      plate_item: { value: null, confidence: 0.3 },
      plate_qty: { value: 1, confidence: 0.9 },
      blank_qty: { value: null, confidence: 0.5 },
    }).compute(ctxFor(1));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.basis).toMatch(/Complete the missing attributes/);
    expect(Object.keys(r.values)).toHaveLength(0);
  });

  it("a STATED derived value is still passed through -- the ladder reads it as its FLOOR", () => {
    const r = helperWith({
      switch_item: { value: "10A 1 WAY SWITCH", confidence: 0.9 },
      switch_qty: { value: 1, confidence: 0.9 },
      plate_item: { value: "6M", confidence: 0.9 },   // stated -> the floor
      plate_qty: { value: 1, confidence: 0.9 },
      blank_qty: { value: null, confidence: 0.5 },
    }).compute(ctxFor(1));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    const plate = r.workings?.attributes?.find((a) => a.id === "plate_item");
    expect(plate?.value).toBe("6M");
  });
});

// ── DERIVED DISPLAY ─────────────────────────────────────────────────────────────────
// The gate above stopped derived attributes REFUSING a row. It did not make them show anything --
// so on the owner's row 239 `Frame/Face plate` still read "— select —" in a RED BORDER while the
// pipeline priced a 3M plate, and `Blank plate qty` still read the extraction's stated 1 where the
// bill charges 0. THE SCREEN IS THE AUTHORITY: "the arithmetic underneath is correct" is not a
// defence of either field. These pin the display half.
//
// Three owner rulings are pinned here, and they are NOT the same rule:
//   R1 the face plate DISPLAYS its computed value and STAYS EDITABLE (a stated value is the floor)
//   R2 a TOO-SMALL entry WARNS, naming both numbers -- it must never look like the field ignored you
//   R3 the blanker quantity is the NAMED EXCEPTION: computed always wins, and it is READ-ONLY

/** The plate ladder, as real rungs -- the smallest is the COMBINED "1M & 2M" rung (capacity 2). */
const PLATE_ITEMS: RateMasterItem[] = ["1M & 2M", "3M", "6M", "12M"].map((item) => ({
  discipline: "Electrical",
  kind: "switch_socket_item",
  attributes: { item, family: "Grid and Face Plates" },
  rates: { list_price: 100 },
})) as unknown as RateMasterItem[];

const mfCtx = (excelRow: number): RateHelperRowContext => ({
  excelRow, description: "probe row", nodeType: "Line Item",
  category: "mf_probe", discipline: "Electrical",
  rateKinds: ["supply_rate", "install_rate", "combined_rate"] as unknown as never,
});

/** Compute one row of the module_fit fixture. `switch_qty` drives the module count 1:1. */
function mfAttrs(over: Record<string, string | number | null> = {}) {
  const base: Record<string, string | number | null> = {
    switch_item: "10A 1 WAY SWITCH", switch_qty: 3,
    plate_item: null, plate_qty: 1, blank_qty: 1,
  };
  const merged = { ...base, ...over };
  return Object.fromEntries(
    Object.entries(merged).map(([k, v]) => [k, { value: v, confidence: 0.9 }]),
  );
}
function mfCompute(over: Record<string, string | number | null> = {}) {
  const r = makePricingSheetHelper({
    configsByCategory: new Map([["mf_probe", moduleFitConfig()]]),
    items: PLATE_ITEMS,
    extractionByRow: buildExtractionByRow([{ excel_row: 1, attributes: mfAttrs(over) as never }]),
  }).compute(mfCtx(1));
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  return (id: string) => r.workings.attributes.find((a) => a.id === id);
}

describe("DERIVED DISPLAY -- R1: the computed face plate is SHOWN and is not flagged missing", () => {
  it("POSITIVE (the owner's row 239): a blank plate displays the COMPUTED rung", () => {
    const plate = mfCompute()("plate_item");           // 3 modules -> the 3M rung
    expect(plate?.derived).toBe(true);
    expect(plate?.derivedValue).toBe("3M");
    expect(attrDisplayValue(plate!)).toBe("3M");
  });

  it("POSITIVE: and it is NOT blank -- no red border on a field the pipeline computed", () => {
    // This is the exact field that read "— select —" in red on the owner's screenshot.
    expect(isAttrBlank(mfCompute()("plate_item")!)).toBe(false);
  });

  it("⚠️ `value` is NOT overwritten -- a computed value must stay distinguishable from a stated one", () => {
    // The display comes from `derivedValue`; `value` still means "what the row SUPPLIED". Collapsing
    // the two is what makes every later reader treat a computed number as a stated one.
    const plate = mfCompute()("plate_item");
    expect(plate?.value).toBe("");
    expect(plate?.derivedValue).toBe("3M");
  });

  it("POSITIVE (R1, editable): a STATED plate keeps the screen and feeds the pipeline as the floor", () => {
    const plate = mfCompute({ plate_item: "12M" })("plate_item");
    expect(plate?.value).toBe("12M");
    expect(attrDisplayValue(plate!)).toBe("12M");       // the entry is never overwritten on screen
    expect(plate?.readOnly).toBeUndefined();            // and it stays editable
    expect(plate?.upgrade).toBeUndefined();             // 12M holds the contents -> no warning
  });

  it("POSITIVE: a None plate renders EMPTY, never a fabricated size", () => {
    const plate = mfCompute({ plate_item: "None" })("plate_item");
    expect(plate?.derivedValue).toBeUndefined();
    expect(attrDisplayValue(plate!)).toBe("None");      // the row's own positive absence still shows
  });
});

describe("DERIVED DISPLAY -- R2: a too-small entry WARNS, it is never silently lost", () => {
  it("POSITIVE: the warning names BOTH numbers and the size actually priced", () => {
    // "1M & 2M" holds 2; the contents occupy 3. Take-the-larger prices 3M.
    const plate = mfCompute({ plate_item: "1M & 2M" })("plate_item");
    expect(plate?.upgrade).toEqual({ stated: "1M & 2M", statedHolds: 2, occupied: 3, using: "3M" });
    expect(upgradeWarningText(plate!.upgrade!)).toBe(
      "1M & 2M holds 2 modules; contents occupy 3 — using 3M.",
    );
  });

  it("POSITIVE: the field still shows the pricer's entry -- warned, not overwritten", () => {
    const plate = mfCompute({ plate_item: "1M & 2M" })("plate_item");
    expect(attrDisplayValue(plate!)).toBe("1M & 2M");
  });

  it("the singular reads correctly (a one-module rung)", () => {
    expect(upgradeWarningText({ stated: "1M", statedHolds: 1, occupied: 3, using: "3M" })).toBe(
      "1M holds 1 module; contents occupy 3 — using 3M.",
    );
  });

  it("NEGATIVE: an entry that FITS raises no warning", () => {
    expect(mfCompute({ plate_item: "6M" })("plate_item")?.upgrade).toBeUndefined();
  });
});

describe("DERIVED DISPLAY -- R3: the blanker quantity is computed-only and READ-ONLY", () => {
  it("POSITIVE: it shows the COMPUTED count, not the extraction's stated one", () => {
    // The row states 1; a 3M plate holding 3 modules of contents needs 0 blanks. The bill charges 0.
    const blank = mfCompute()("blank_qty");
    expect(blank?.value).toBe("1");                    // what the row supplied
    expect(blank?.derivedValue).toBe("0");             // what the pipeline computed
    expect(attrDisplayValue(blank!)).toBe("0");        // and the computed one is what is SHOWN
  });

  it("POSITIVE: it is read-only -- the pipeline never reads it, so an edit could not reach the price", () => {
    expect(mfCompute()("blank_qty")?.readOnly).toBe(true);
  });

  it("POSITIVE: a plate with room shows the real count (6M over 3 modules -> 3 blanks)", () => {
    expect(attrDisplayValue(mfCompute({ plate_item: "6M" })("blank_qty")!)).toBe("3");
  });

  it("NEGATIVE: with NO plate there are no blanks to count -- EMPTY, never 0", () => {
    // 0 would claim "zero needed"; the truth is "no plate to fill".
    const blank = mfCompute({ plate_item: "None" })("blank_qty");
    expect(blank?.derivedValue).toBeUndefined();
    expect(attrDisplayValue(blank!)).toBe("");
  });
});

describe("DERIVED DISPLAY -- what it must NOT touch", () => {
  it("NEGATIVE: a genuine INPUT gets no derived marks at all", () => {
    const sw = mfCompute()("switch_item");
    expect(sw?.derived).toBeUndefined();
    expect(sw?.derivedValue).toBeUndefined();
    expect(sw?.readOnly).toBeUndefined();
  });

  it("NEGATIVE: a genuine missing input still blocks AND still shows red -- narrowing, not removing", () => {
    const at = mfCompute({ switch_item: null })("switch_item");
    expect(isAttrBlank(at!)).toBe(true);
  });

  it("NEGATIVE: a config with NO module_fit is byte-unaffected", () => {
    const cfg = moduleFitConfig();
    (cfg.pipelines.probe_boq.steps as unknown as Array<unknown>).shift();
    const out = applyDerivedDisplay(
      [{ id: "plate_item", label: "Plate", value: "" }],
      cfg,
      [],
    );
    expect(out[0]).toEqual({ id: "plate_item", label: "Plate", value: "" });
  });

  it("⚠️ TWO SCREENS, ONE FIELD: the Rate Master Derivation screen reads a DIFFERENT predicate", () => {
    // There `plate_item` is the stated FLOOR a user sets -- a different question from this panel's
    // "what did the assembly come to?" -- so it must stay editable there. The screens are kept apart
    // by construction: Derivation reads `derivedQtyAttrs` (the superseded-qty half ONLY), the panel
    // reads `derivedAttrIds` (both halves). Collapsing them would freeze the Derivation field.
    const cfg = moduleFitConfig();
    expect(derivedQtyAttrs(cfg).has("plate_item")).toBe(false);  // Derivation: still an input
    expect(derivedAttrIds(cfg).has("plate_item")).toBe(true);    // panel: derived
    expect(derivedQtyAttrs(cfg).has("blank_qty")).toBe(true);    // the ONE field both compute
  });
});

describe("DERIVED DISPLAY -- the pure display rules (what the panel renders)", () => {
  it("readOnly shows the computed value ALWAYS, even over a stated one", () => {
    expect(attrDisplayValue({ value: "1", derived: true, derivedValue: "0", readOnly: true })).toBe("0");
  });
  it("a stated value on an EDITABLE derived attribute wins the screen", () => {
    expect(attrDisplayValue({ value: "12M", derived: true, derivedValue: "3M" })).toBe("12M");
  });
  it("a blank derived attribute shows the computed value", () => {
    expect(attrDisplayValue({ value: "", derived: true, derivedValue: "3M" })).toBe("3M");
  });
  it("NEGATIVE: a NON-derived blank stays blank -- nothing is invented for a genuine input", () => {
    expect(attrDisplayValue({ value: "", derivedValue: "3M" })).toBe("");
  });
  it("the (computed) marker appears only when the PIPELINE's value is on screen", () => {
    expect(isShowingDerived({ value: "", derived: true, derivedValue: "3M" })).toBe(true);
    expect(isShowingDerived({ value: "1", derived: true, derivedValue: "0", readOnly: true })).toBe(true);
    // a derived attribute the row STATES is showing the pricer's own entry -- not computed
    expect(isShowingDerived({ value: "12M", derived: true, derivedValue: "3M" })).toBe(false);
    expect(isShowingDerived({ value: "", derived: true })).toBe(false);
    expect(isShowingDerived({ value: "" })).toBe(false);
  });
  it("isAttrBlank exempts a derived attribute, BOTH ways", () => {
    expect(isAttrBlank({ value: "", disabled: undefined, derived: true })).toBe(false);
    expect(isAttrBlank({ value: "", disabled: undefined, derived: undefined })).toBe(true);
  });
});

// ── PANEL OVERRIDES ARE ROW-SCOPED (the cross-row leak) ─────────────────────────────
// The panel is ONE mounted component that swaps `excelRow`. Its edit maps were keyed by HELPER ID
// alone, and one helper (`pricing_sheet`) serves EVERY category -- so an override typed on one row
// was re-applied to whatever row was opened next, and to any category declaring an attribute of the
// same id. Typing plate_item="18M" on point_wiring 221 moved point_wiring 235 AND switches_sockets
// 241 and 269. It dates to bf3690b7 (the first panel slice); the derived-gate slice made it
// REACHABLE by making 42 rows price, it did not introduce it.
//
// THE HAZARD: "Use this value" writes a rate permanently via applyRate, so a stale override could
// bank a number computed from another row's attributes.
//
// There is no DOM test environment here (vitest runs `environment: "node"` by deliberate choice), so
// the component itself cannot be mounted. The row-scoping DECISION is therefore a pure exported
// function, pinned directly, and the leak's consequence is pinned at the helper.

describe("overridesForRow -- panel edits belong to ONE ROW", () => {
  const EMPTY: Record<string, Record<string, string>> = {};
  const typed = { row: 221, byHelper: { pricing_sheet: { plate_item: "18M" } } };

  it("POSITIVE: the row it was typed on sees its own edits", () => {
    expect(overridesForRow(typed, 221, EMPTY)).toEqual({ pricing_sheet: { plate_item: "18M" } });
  });

  it("NEGATIVE: ANOTHER row sees nothing -- the leak, pinned shut", () => {
    expect(overridesForRow(typed, 235, EMPTY)).toBe(EMPTY);
    expect(overridesForRow(typed, 241, EMPTY)).toBe(EMPTY);
  });

  it("NEGATIVE: no row selected sees nothing", () => {
    expect(overridesForRow(typed, undefined, EMPTY)).toBe(EMPTY);
  });

  it("a state with no edits yet yields the empty map for any row", () => {
    expect(overridesForRow({ row: null, byHelper: EMPTY }, 221, EMPTY)).toBe(EMPTY);
  });

  it("returns the caller's EMPTY reference, so the evaluations memo does not churn", () => {
    // a fresh {} each call would recompute every helper on every render
    expect(overridesForRow(typed, 999, EMPTY)).toBe(overridesForRow(typed, 998, EMPTY));
  });
});

describe("the leak's consequence, at the helper (cross-row and CROSS-CATEGORY)", () => {
  const PLATE_ITEMS: RateMasterItem[] = [
    { discipline: "Electrical", kind: "switch_socket_item",
      attributes: { item: "3M", family: "Grid and Face Plates", colour: "White" }, rates: { list_price: 100 } },
    { discipline: "Electrical", kind: "switch_socket_item",
      attributes: { item: "18M", family: "Grid and Face Plates", colour: "White" }, rates: { list_price: 900 } },
    { discipline: "Electrical", kind: "switch_socket_item",
      attributes: { item: "10A 1 WAY SWITCH", family: "Switch", colour: "White" }, rates: { list_price: 100 } },
  ];
  const cfg = (categoryId: string): RateCategoryConfig => ({
    discipline: "Electrical",
    category_id: categoryId,
    attribute_definitions: [
      { id: "switch_item", label: "Switch", type: "choice", values: ["10A 1 WAY SWITCH"] },
      { id: "switch_qty", label: "Switch qty", type: "number" },
      { id: "plate_item", label: "Plate", type: "choice", values: ["3M", "18M"] },
      { id: "colour", label: "Colour", type: "choice", values: ["White"] },
    ],
    pipelines: {
      p_boq: {
        output: ["supply"],
        steps: [
          { step: "component_ref", name: "plate",
            ref: { kind: "switch_socket_item", item: "@plate_item", family: "Grid and Face Plates", colour: "@colour" },
            target: "list_price", rate_stages: [{ mult: 1 }], qty: 1 },
          { step: "sum_components", result: "supply" },
        ],
      },
    },
  } as unknown as RateCategoryConfig);

  const ATTRS = {
    switch_item: { value: "10A 1 WAY SWITCH", confidence: 0.9 },
    switch_qty: { value: 1, confidence: 0.9 },
    plate_item: { value: "3M", confidence: 0.9 },
    colour: { value: "White", confidence: 0.9 },
  };
  const helper = makePricingSheetHelper({
    configsByCategory: new Map([["cat_a", cfg("cat_a")], ["cat_b", cfg("cat_b")]]),
    items: PLATE_ITEMS,
    extractionByRow: buildExtractionByRow([
      { excel_row: 221, attributes: ATTRS },
      { excel_row: 235, attributes: ATTRS },
      { excel_row: 241, attributes: ATTRS },
    ]),
  });
  const ctxFor = (excelRow: number, category: string): RateHelperRowContext => ({
    excelRow, description: "", nodeType: "Line Item", category, discipline: "Electrical",
    rateKinds: ["supply_rate", "install_rate"] as unknown as never,
  });
  const supplyOf = (r: ReturnType<typeof helper.compute>) =>
    (isSuggestion(r) ? r.values.supply_rate : undefined);

  it("baseline: every row prices from its OWN stated plate", () => {
    expect(supplyOf(helper.compute(ctxFor(221, "cat_a")))).toBe(100);
    expect(supplyOf(helper.compute(ctxFor(235, "cat_a")))).toBe(100);
    expect(supplyOf(helper.compute(ctxFor(241, "cat_b")))).toBe(100);
  });

  it("an override alters ONLY the row it is passed with", () => {
    const edited = helper.compute(ctxFor(221, "cat_a"), { plate_item: "18M" });
    expect(supplyOf(edited)).toBe(900);                                   // the edited row moves
    expect(supplyOf(helper.compute(ctxFor(235, "cat_a")))).toBe(100);     // a sibling does NOT
  });

  it("CROSS-CATEGORY: an override from one category must not reach another", () => {
    // The sharpest symptom, and the one a per-category fix would miss: both configs declare
    // `plate_item`, so a helper-keyed map reached across. Row-scoping is what stops it.
    helper.compute(ctxFor(221, "cat_a"), { plate_item: "18M" });
    expect(supplyOf(helper.compute(ctxFor(241, "cat_b")))).toBe(100);
  });

  it("the panel's read is what enforces it end to end", () => {
    // What the panel now passes for a DIFFERENT row is the empty map -> the untouched value.
    const state = { row: 221, byHelper: { pricing_sheet: { plate_item: "18M" } } };
    const forOther = overridesForRow(state, 241, {} as Record<string, Record<string, string>>);
    expect(supplyOf(helper.compute(ctxFor(241, "cat_b"), forOther.pricing_sheet))).toBe(100);
  });
});

// ---- CIRCUIT LENGTH part 2: the THIRD derivation mechanism (`derive_attribute`) -----------------
//
// point_wiring's `circuit_length_m` used to arrive pre-filled by an `extraction_defaults` entry of 15.
// That default had to go -- an injected value is a STATED value, and under stated-wins it would have
// won on every row forever, leaving the whole derivation inert. Removing it leaves the field BLANK on
// every future row, so unless `derivedAttrIds` knows the third mechanism the missing-attribute gate
// fires and the row prices NOTHING while the pipeline can compute the length perfectly well.
//
// The gate must NARROW, NOT OPEN: a computed target stops blocking, a genuinely absent input still
// blocks -- including `points` itself, which is EXTRACTED, not derived.
const daConfig = (): RateCategoryConfig => ({
  discipline: "Electrical",
  category_id: "da_probe",
  attribute_definitions: [
    { id: "points", label: "Points covered", type: "number" },
    { id: "circuit_length_m", label: "Circuit length (m)", type: "number" },
    { id: "item", label: "Item", type: "choice", values: ["WIRE"] },
  ],
  pipelines: {
    da_supply: {
      output: ["supply"],
      steps: [
        {
          step: "derive_attribute",
          params: {
            result_attr: "circuit_length_m",
            terms: [{ ident: "points", attr: "points" }],
            constants: { base: 15, per_extra: 5 },
            formula: "base + (points - 1) * per_extra",
            unit: "m",
          },
        },
        {
          step: "component_ref",
          name: "wire",
          ref: { kind: "cable", item: "@item" },
          target: "list_price_per_mtr",
          rate_stages: [{ mult: 1 }],
          qty: { from_attr: "circuit_length_m" },
        },
        { step: "sum_components", result: "supply" },
      ],
    },
  },
}) as unknown as RateCategoryConfig;

const DA_ITEMS: RateMasterItem[] = [
  { discipline: "Electrical", kind: "cable", attributes: { item: "WIRE" }, rates: { list_price_per_mtr: 10 } },
];

describe("derive_attribute -- the gate NARROWS for a computed target, and still blocks a real gap", () => {
  const ctxDa = (excelRow: number): RateHelperRowContext => ({
    excelRow, description: "probe row", nodeType: "Line Item",
    category: "da_probe", discipline: "Electrical",
    rateKinds: ["supply_rate", "install_rate", "combined_rate"] as unknown as never,
  });
  const helperWith = (attrs: Record<string, { value: string | number | null; confidence: number }>) =>
    makePricingSheetHelper({
      configsByCategory: new Map([["da_probe", daConfig()]]),
      items: DA_ITEMS,
      extractionByRow: buildExtractionByRow([{ excel_row: 1, attributes: attrs }]),
    });

  it("derivedAttrIds collects a derive_attribute's result_attr (READ FROM CONFIG, never by id)", () => {
    const d = derivedAttrIds(daConfig());
    expect(d.has("circuit_length_m")).toBe(true);
    // NEGATIVE: the SOURCE attribute is EXTRACTED, not derived -- it is a genuine input.
    expect(d.has("points")).toBe(false);
    expect(d.has("item")).toBe(false);
  });

  it("POSITIVE: a blank COMPUTED length no longer blocks -- the row prices from the point count", () => {
    const r = helperWith({
      points: { value: 7, confidence: 0.9 },
      circuit_length_m: { value: null, confidence: 0.3 },   // DERIVED -- blank means "not stated"
      item: { value: "WIRE", confidence: 0.9 },
    }).compute(ctxDa(1));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    // BEFORE this fix: "Complete the missing attributes to price", and NO value at all.
    expect(r.basis).not.toMatch(/Complete the missing attributes/);
    expect(r.values.supply_rate).toBe(450); // 10/mtr x (15 + 6x5) = 10 x 45
  });

  it("NEGATIVE: a blank GENUINE input still blocks -- narrowing, not removing", () => {
    const r = helperWith({
      points: { value: 7, confidence: 0.9 },
      circuit_length_m: { value: null, confidence: 0.3 },
      item: { value: null, confidence: 0.2 },              // a REAL missing input
    }).compute(ctxDa(1));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.basis).toMatch(/Complete the missing attributes/);
    expect(r.values).toEqual({});
  });

  it("NEGATIVE: the SOURCE attribute still blocks -- `points` is extracted, not computed", () => {
    // The gate must not exempt the whole chain. Without a point count there is nothing to derive
    // FROM, and inventing one would be exactly the silent guess the no-compute rule forbids.
    const r = helperWith({
      points: { value: null, confidence: 0.2 },
      circuit_length_m: { value: null, confidence: 0.3 },
      item: { value: "WIRE", confidence: 0.9 },
    }).compute(ctxDa(1));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.basis).toMatch(/Complete the missing attributes/);
  });

  it("DISPLAY: the computed length is SHOWN, and the field stays EDITABLE", () => {
    const r = helperWith({
      points: { value: 7, confidence: 0.9 },
      circuit_length_m: { value: null, confidence: 0.3 },
      item: { value: "WIRE", confidence: 0.9 },
    }).compute(ctxDa(1));
    if (!isSuggestion(r)) throw new Error("expected a suggestion");
    const len = r.workings.attributes.find((a) => a.id === "circuit_length_m")!;
    expect(len.derived).toBe(true);
    expect(len.derivedValue).toBe("45");
    expect(attrDisplayValue(len)).toBe("45");
    expect(isShowingDerived(len)).toBe(true);
    // ⚠️ EDITABLE. A stated value wins outright here, so a read-only field would promise the pricer
    // an effect their edit cannot have -- when in fact their edit is the one thing that always wins.
    // This is the LADDER-BIND case, not the read-only blanker quantity.
    expect(len.readOnly).toBeUndefined();
    expect(isAttrBlank(len)).toBe(false);
  });

  it("DISPLAY: a STATED length keeps the screen and publishes no computed value", () => {
    const r = helperWith({
      points: { value: 7, confidence: 0.9 },
      circuit_length_m: { value: 60, confidence: 0.9 },     // the pricer knows the run is long
      item: { value: "WIRE", confidence: 0.9 },
    }).compute(ctxDa(1));
    if (!isSuggestion(r)) throw new Error("expected a suggestion");
    const len = r.workings.attributes.find((a) => a.id === "circuit_length_m")!;
    expect(len.value).toBe("60");
    expect(len.derivedValue).toBeUndefined();      // nothing was computed -- saying otherwise is a lie
    expect(attrDisplayValue(len)).toBe("60");
    expect(isShowingDerived(len)).toBe(false);     // the pricer's own entry is not "computed"
    expect(r.values.supply_rate).toBe(600);        // 10 x 60, NOT 10 x 45 -- stated wins
  });

  it("BACKWARD COMPAT: a config with no derive_attribute is unaffected", () => {
    const d = derivedAttrIds(moduleFitConfig());
    expect(d.has("circuit_length_m")).toBe(false);
    expect(d.has("plate_item")).toBe(true);   // the ladder-bind mechanism is untouched
    expect(d.has("blank_qty")).toBe(true);    // the superseded-qty mechanism is untouched
  });
});
