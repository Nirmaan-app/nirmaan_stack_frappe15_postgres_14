// RM-3 real helper tests: compute over a fixed extraction fixture -> the standing goldens' values
// where the combo matches, a null-attribute partial, a low-confidence render, and version keying.
import { describe, it, expect } from "vitest";
import type { Pipeline, RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import {
  ATTR_NOTE_ORDER,
  attrDisplayValue,
  attrNoteText,
  isAttrBlank,
  isAttrDefaulted,
  isShowingDerived,
  isSuggestion,
  sortAttrNotes,
  upgradeWarningText,
} from "./rateHelperTypes";
// SLICE 2d: NOT_STATED_SENTINEL / toSelectValue / fromSelectValue are RETIRED with the 2c sentinel;
// derivedQtyAttrs + derivedAttrIds relocated to the leaf both screens may import.
import {
  blanksQtyAttr,
  coerceForMatch,
  derivedAttrIds,
  mapAttributeSources,
  derivedQtyAttrs,
} from "@/pages/pricing/rate-master/rateMasterStructure";
import { NONE_SENTINEL } from "@/pages/pricing/rate-master/ratePipelineInterpreter";
import { hasSessionEdits, overridesForRow } from "./RateHelperPanel";
import {
  applyDerivedDisplay,
  attributeOptions,
  buildExtractionByRow,
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
    expect(plate?.notes).toBeUndefined();               // 12M holds the contents -> no warning
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
    expect(plate?.notes).toEqual([
      { kind: "upgrade", stated: "1M & 2M", statedHolds: 2, occupied: 3, using: "3M" },
    ]);
    expect(attrNoteText(plate!.notes![0])).toBe(
      "1M & 2M holds 2 modules; contents occupy 3 — using 3M.",
    );
  });

  it("SLICE 2d RE-MINT: the field now shows WHAT WAS BOUGHT -- warned AND corrected", () => {
    // ⚠️ RE-MINTED BY OWNER RULING (x). This asserted `"1M & 2M"` -- the pricer's entry, kept on
    // screen. The PREMISE was the old flat contract "a stated value must never be overwritten on
    // screen", which slice 2d NARROWED: a stated value the pipeline USED is still never overwritten,
    // but a SUBSTITUTED one shows what was bought. Showing "1M & 2M" named a plate the row is not
    // being charged for, which is the opposite of the honesty the warning was added for.
    // The warning itself is UNCHANGED and still carries all three numbers -- see the test above.
    const plate = mfCompute({ plate_item: "1M & 2M" })("plate_item");
    expect(attrDisplayValue(plate!)).toBe("3M");
    expect(isShowingDerived(plate!)).toBe(true);
    expect(plate!.notes?.[0]).toMatchObject({ kind: "upgrade", stated: "1M & 2M", using: "3M" });
  });

  it("the singular reads correctly (a one-module rung)", () => {
    expect(upgradeWarningText({ stated: "1M", statedHolds: 1, occupied: 3, using: "3M" })).toBe(
      "1M holds 1 module; contents occupy 3 — using 3M.",
    );
  });

  it("NEGATIVE: an entry that FITS raises no warning", () => {
    expect(mfCompute({ plate_item: "6M" })("plate_item")?.notes).toBeUndefined();
  });

  // ---- THE NOTES-LIST MIGRATION IS INERT ---------------------------------------------------------
  // The upgrade warning is SHIPPED. Moving it from a bespoke `upgrade?` slot into the general notes
  // list must not move one byte of what a pricer reads. The pin above (the singular case) still calls
  // `upgradeWarningText` DIRECTLY and is UNCHANGED by this slice -- it is the byte-identity anchor.
  // This pair proves the panel's new call site produces exactly what the old one did.
  it("INERTNESS: attrNoteText delegates to upgradeWarningText -- byte-identical, both plural and singular", () => {
    const plural = { stated: "1M & 2M", statedHolds: 2, occupied: 3, using: "3M" } as const;
    const singular = { stated: "1M", statedHolds: 1, occupied: 3, using: "3M" } as const;
    expect(attrNoteText({ kind: "upgrade", ...plural })).toBe(upgradeWarningText(plural));
    expect(attrNoteText({ kind: "upgrade", ...singular })).toBe(upgradeWarningText(singular));
    // and the literal strings, so a change to BOTH functions at once still fails here
    expect(attrNoteText({ kind: "upgrade", ...plural })).toBe(
      "1M & 2M holds 2 modules; contents occupy 3 — using 3M.",
    );
    expect(attrNoteText({ kind: "upgrade", ...singular })).toBe(
      "1M holds 1 module; contents occupy 3 — using 3M.",
    );
  });

  it("ORDERING is declared, not incidental: an upgrade renders before a quantity note", () => {
    // Size before count -- an upgrade changes WHICH rung is bought, the quantity notes change how
    // many fillers go in it, so the rung has to be settled first for the count to read sensibly.
    const shuffled = sortAttrNotes([
      { kind: "uncovered", stated: 0, spare: 1, uncovered: 1 },
      { kind: "upgrade", stated: "1M", statedHolds: 1, occupied: 3, using: "3M" },
    ]);
    expect(shuffled.map((n) => n.kind)).toEqual(["upgrade", "uncovered"]);
    expect(ATTR_NOTE_ORDER).toEqual(["upgrade", "capped", "uncovered"]);
  });

  it("the two quantity notes are worded so neither can be mistaken for the other", () => {
    // capped = WE OVERRODE YOU; uncovered = WE USED YOUR NUMBER. An honoured value described as a
    // correction is the exact defect the notes list exists to prevent.
    expect(attrNoteText({ kind: "capped", stated: 2, spare: 1 })).toBe(
      "1 spare module on this plate; 2 will not fit — pricing 1.",
    );
    expect(attrNoteText({ kind: "capped", stated: 1, spare: 0 })).toBe(
      "No spare modules on this plate; 1 will not fit — pricing 0.",
    );
    expect(attrNoteText({ kind: "uncovered", stated: 0, spare: 1, uncovered: 1 })).toBe(
      "1 module will be left uncovered (1 spare, 0 blanked).",
    );
    expect(attrNoteText({ kind: "uncovered", stated: 1, spare: 3, uncovered: 2 })).toBe(
      "2 modules will be left uncovered (3 spare, 1 blanked).",
    );
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

// ---- THE ARBITRATED BLANKER QUANTITY: SEEDED, EDITABLE, AND IT WARNS BOTH WAYS -----------------
// R4 REVERSES the earlier read-only ruling, and the reason it was locked no longer holds: the field
// looked fully superseded (its component still takes `qty: {from_fit}`) but `module_fit` now READS
// it, weighs it against the plate's spare capacity, and an edit genuinely reaches the price.
//
// The state reused is the FACE PLATE's -- `derived` + a `derivedValue`, `readOnly` deliberately unset
// -- so a stated value keeps the screen and a blank one shows what the pipeline computed. Nothing new
// was invented for it.
function arbitratedConfig(): RateCategoryConfig {
  const base = moduleFitConfig() as unknown as {
    pipelines: Record<string, { steps: Array<Record<string, unknown>> }>;
  };
  const cloned = JSON.parse(JSON.stringify(base)) as typeof base;
  const mf = cloned.pipelines.probe_boq.steps[0] as {
    params: { blanks: Record<string, unknown> };
  };
  mf.params.blanks = {
    bind: "blank_count", from_ladder: "plate_item",
    qty_attr: "blank_qty", bind_item: "blank_fit_item", item_when_positive: "1M Blanker",
  };
  return cloned as unknown as RateCategoryConfig;
}
function arbCompute(over: Record<string, string | number | null> = {}) {
  const r = makePricingSheetHelper({
    configsByCategory: new Map([["mf_probe", arbitratedConfig()]]),
    items: PLATE_ITEMS,
    extractionByRow: buildExtractionByRow([{ excel_row: 1, attributes: mfAttrs(over) as never }]),
  }).compute(mfCtx(1));
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  return (id: string) => r.workings.attributes.find((a) => a.id === id);
}

describe("BLANKER QUANTITY -- R4: seeded and EDITABLE (the read-only ruling is reversed)", () => {
  it("POSITIVE (R4): it is EDITABLE -- readOnly is not set on the arbitrated quantity", () => {
    // 3 modules occupied on a 6M plate -> 3 spare. The field accepts an edit because module_fit
    // reads it; locking it would promise the pricer their entry cannot reach the price, which is
    // now false.
    const blank = arbCompute({ plate_item: "6M", blank_qty: null })("blank_qty");
    expect(blank?.readOnly).toBeUndefined();
    expect(blank?.derived).toBe(true);
  });

  it("POSITIVE (R4, SEEDING): a blank field shows the COMPUTED spare", () => {
    const blank = arbCompute({ plate_item: "6M", blank_qty: null })("blank_qty");
    expect(blank?.derivedValue).toBe("3");
    expect(attrDisplayValue(blank!)).toBe("3");
    expect(blank?.value).toBe("");            // `value` still means "what the row SUPPLIED"
  });

  it("POSITIVE: a seeded-but-blank field is NOT flagged missing -- no red border on a computed value", () => {
    expect(isAttrBlank(arbCompute({ plate_item: "6M", blank_qty: null })("blank_qty")!)).toBe(false);
  });

  it("POSITIVE: a STATED value keeps the screen -- warned, never overwritten", () => {
    const blank = arbCompute({ plate_item: "6M", blank_qty: 1 })("blank_qty");
    expect(blank?.value).toBe("1");
    expect(attrDisplayValue(blank!)).toBe("1");   // the entry survives on screen
    expect(blank?.derivedValue).toBe("1");        // and 1 is what prices (it is below the spare)
  });
});

describe("BLANKER QUANTITY -- R5/R6: the two warnings mean OPPOSITE things", () => {
  it("R5 (over-count CORRECTED): the note names the SPARE and what is priced instead", () => {
    const blank = arbCompute({ plate_item: "6M", blank_qty: 5 })("blank_qty");   // 3 spare, 5 asked
    expect(blank?.notes).toEqual([{ kind: "capped", stated: 5, spare: 3 }]);
    expect(attrNoteText(blank!.notes![0])).toBe(
      "3 spare modules on this plate; 5 will not fit — pricing 3.",
    );
    expect(blank?.derivedValue).toBe("3");        // the COMPUTED value won
    expect(attrDisplayValue(blank!)).toBe("5");   // and the entry is still shown, not erased
  });

  it("R6 (under-count HONOURED): the note names what is LEFT UNCOVERED, never an override", () => {
    const blank = arbCompute({ plate_item: "6M", blank_qty: 1 })("blank_qty");   // 3 spare, 1 asked
    expect(blank?.notes).toEqual([{ kind: "uncovered", stated: 1, spare: 3, uncovered: 2 }]);
    expect(attrNoteText(blank!.notes![0])).toBe(
      "2 modules will be left uncovered (3 spare, 1 blanked).",
    );
    expect(blank?.derivedValue).toBe("1");        // the USER'S value won
  });

  it("R6 must never read as a correction -- the honoured note borrows none of the override's verbs", () => {
    const honoured = attrNoteText({ kind: "uncovered", stated: 1, spare: 3, uncovered: 2 });
    for (const overrideWord of ["pricing", "will not fit", "using"]) {
      expect(honoured).not.toContain(overrideWord);
    }
  });

  it("R3 at the boundary: a stated ZERO is honoured, and it is the note that says so", () => {
    const blank = arbCompute({ plate_item: "6M", blank_qty: 0 })("blank_qty");
    expect(blank?.derivedValue).toBe("0");
    expect(blank?.notes).toEqual([{ kind: "uncovered", stated: 0, spare: 3, uncovered: 3 }]);
  });

  it("NEGATIVE: an entry EQUAL to the spare raises no note at all", () => {
    expect(arbCompute({ plate_item: "6M", blank_qty: 3 })("blank_qty")?.notes).toBeUndefined();
  });

  it("NEGATIVE: nothing stated raises no note -- a seed is not an override", () => {
    expect(arbCompute({ plate_item: "6M", blank_qty: null })("blank_qty")?.notes).toBeUndefined();
  });

  it("NEGATIVE: no plate to fill -> the field renders EMPTY, never 0, and says nothing", () => {
    // "No plate to fill" is a different statement from "zero needed" (owner-locked).
    const blank = arbCompute({ plate_item: "None", blank_qty: null })("blank_qty");
    expect(blank?.derived).toBe(true);
    expect(blank?.derivedValue).toBeUndefined();
    expect(attrDisplayValue(blank!)).toBe("");
    expect(blank?.notes).toBeUndefined();
  });
});

describe("BLANKER QUANTITY -- the config-read predicate, and the two-screens distinction", () => {
  it("POSITIVE: blanksQtyAttr reads the arbitrated attribute FROM CONFIG, never by id", () => {
    expect(blanksQtyAttr(arbitratedConfig())).toBe("blank_qty");
  });

  it("NEGATIVE: a config with no qty_attr reports none -- and its quantity stays READ-ONLY", () => {
    // The BACKWARDS-COMPAT half. A blanks block that does not arbitrate is byte-unaffected: its
    // `<name>_qty` is still fully superseded by the component's {from_fit}, so the field stays locked
    // exactly as it did before this slice.
    expect(blanksQtyAttr(moduleFitConfig())).toBeUndefined();
    const blank = mfCompute({ plate_item: "6M" })("blank_qty");
    expect(blank?.readOnly).toBe(true);
    expect(blank?.notes).toBeUndefined();
  });

  it("⚠️ THE TWO SCREENS STAY APART: Derivation still treats the quantity as superseded", () => {
    // The pricing panel asks "what did the assembly come to, and may I change it?"; the Rate Master
    // Derivation screen asks "what does this config compute?" and reads `derivedQtyAttrs` -- the
    // superseded-qty half ONLY. That predicate keys on the component's `{from_fit}` shape, which is
    // UNCHANGED by this slice, so Derivation's answer for blank_qty is the same before and after.
    // Collapsing the two predicates is what would freeze a field that is genuinely editable here.
    expect(derivedQtyAttrs(arbitratedConfig()).has("blank_qty")).toBe(true);
    expect(derivedQtyAttrs(moduleFitConfig()).has("blank_qty")).toBe(true);
    // and the panel's own predicate still reports it derived, so the missing-attribute gate is quiet
    expect(derivedAttrIds(arbitratedConfig()).has("blank_qty")).toBe(true);
  });

  it("the arbitrated quantity is never flagged as missing input, stated or blank", () => {
    expect(isAttrBlank(arbCompute({ plate_item: "6M", blank_qty: null })("blank_qty")!)).toBe(false);
    expect(isAttrBlank(arbCompute({ plate_item: "6M", blank_qty: 2 })("blank_qty")!)).toBe(false);
  });
});

// ── SLICE 2c: THE PANEL SHOWS WHAT PRICING USED ────────────────────────────────────────────────
// `catalog_fit` shipped in 2b computing the paired MCB correctly and showing NOTHING for it: the
// field read "— select —" beside a line the pipeline had priced. `derivedAttrIds` already marked the
// bind derived (so the missing-input gate was quiet -- the row priced), but no branch ever filled
// `derivedValue`, so `attrDisplayValue` rendered empty. This is the display half.
//
// It is the FOURTH mechanism to reach this display, and it behaves like the ladder bind and the
// derive_attribute target -- NOT like the blanker quantity: a stated value IS read and wins outright,
// so the field must stay EDITABLE and `readOnly` must never be set.

/** A two-rung MCB ladder at one pole/curve. 20 A is deliberately NOT carried. */
const CF_ITEMS: RateMasterItem[] = [
  { discipline: "Electrical", kind: "db_switchgear_item",
    attributes: { family: "Switchgear", device: "MCB", pole: "FP", curve: "C", item: "25A FP MCB C CURVE", amp_a: 25.0 },
    rates: { list_price: 1000 } },
  { discipline: "Electrical", kind: "db_switchgear_item",
    attributes: { family: "Switchgear", device: "MCB", pole: "FP", curve: "C", item: "63A FP MCB C CURVE", amp_a: 63.0 },
    rates: { list_price: 2000 } },
] as unknown as RateMasterItem[];

function catalogFitConfig(): RateCategoryConfig {
  return {
    discipline: "Electrical",
    category_id: "cf_probe",
    attribute_definitions: [
      { id: "mcb_present", label: "MCB present", type: "choice", values: ["Yes", "No"] },
      { id: "mcb_amp_a", label: "MCB amps", type: "number" },
      { id: "paired_mcb", label: "Paired MCB", type: "choice",
        values: ["25A FP MCB C CURVE", "63A FP MCB C CURVE"], allow_none: true },
    ],
    pipelines: {
      probe_boq: {
        output: ["supply"],
        steps: [
          { step: "catalog_fit",
            params: {
              bind: "paired_mcb", kind: "db_switchgear_item",
              where: { family: "Switchgear", device: "MCB", pole: "FP", curve: "C" },
              size_from: { attr: "amp_a" }, fit_from: { attr: "mcb_amp_a" }, direction: "up",
              prefer_attr: "paired_mcb", absent_when: { attr: "mcb_present", equals: "No" },
              on_miss: "none", on_missing_fact: "none",
            } },
          { step: "component_ref", name: "mcb",
            ref: { kind: "db_switchgear_item", family: "Switchgear", item: "@paired_mcb" },
            target: "list_price", qty: 1, none_skips: true },
          { step: "sum_components", result: "supply" },
        ],
      },
    },
  } as unknown as RateCategoryConfig;
}

const cfCtx = (excelRow: number): RateHelperRowContext => ({
  excelRow, description: "probe row", nodeType: "Line Item",
  category: "cf_probe", discipline: "Electrical",
  rateKinds: ["supply_rate"] as unknown as never,
});

/** Compute one row of the catalog_fit fixture and return an attribute lookup. */
function cfCompute(over: Record<string, string | number | null> = {}) {
  const merged: Record<string, string | number | null> = {
    mcb_present: "Yes", mcb_amp_a: 20, paired_mcb: null, ...over,
  };
  const r = makePricingSheetHelper({
    configsByCategory: new Map([["cf_probe", catalogFitConfig()]]),
    items: CF_ITEMS,
    extractionByRow: buildExtractionByRow([{
      excel_row: 1,
      attributes: Object.fromEntries(
        Object.entries(merged).map(([k, v]) => [k, { value: v, confidence: 0.9 }]),
      ) as never,
    }]),
  }).compute(cfCtx(1));
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  return (id: string) => r.workings.attributes.find((a) => a.id === id);
}

describe("SLICE 2c -- a catalog_fit bind DISPLAYS what the pipeline fitted", () => {
  it("POSITIVE (row 98's defect): a blank paired MCB shows the FITTED catalog item", () => {
    // 20 A is not carried; the ladder's next-higher rung is 25 A. Before 2c this field was empty.
    const mcb = cfCompute()("paired_mcb");
    expect(mcb?.derived).toBe(true);
    expect(mcb?.derivedValue).toBe("25A FP MCB C CURVE");
    expect(attrDisplayValue(mcb!)).toBe("25A FP MCB C CURVE");
  });

  it("POSITIVE: it is marked as SHOWING DERIVED, so the computed marker appears", () => {
    expect(isShowingDerived(cfCompute()("paired_mcb")!)).toBe(true);
  });

  it("POSITIVE: it is NOT blank -- no red border on a field the pipeline fitted", () => {
    expect(isAttrBlank(cfCompute()("paired_mcb")!)).toBe(false);
  });

  it("it stays EDITABLE -- `readOnly` is never set, because a stated value WINS outright", () => {
    // This is the whole difference from the blanker quantity. `catalog_fit`'s `prefer_attr` reads the
    // SAME attribute and defers to it, so an edit here is the one thing that always reaches the price
    // -- the mechanism that corrected two live rows by hand in slice 2. Locking it would be the lie
    // the read-only contract exists to prevent, pointing the other way.
    expect(cfCompute()("paired_mcb")!.readOnly).toBeUndefined();
  });

  it("`value` is NOT overwritten -- a fitted item stays distinguishable from a stated one", () => {
    const mcb = cfCompute()("paired_mcb");
    expect(mcb?.value).toBe("");             // the row supplied nothing
    expect(mcb?.derivedValue).toBe("25A FP MCB C CURVE");
  });

  it("NEGATIVE: a STATED item is shown AS STATED and never re-labelled as computed", () => {
    // Stated-wins bound nothing, so there IS no computed value; publishing one would claim the
    // pipeline chose what the pricer chose.
    const mcb = cfCompute({ paired_mcb: "63A FP MCB C CURVE" })("paired_mcb");
    expect(mcb?.derivedValue).toBeUndefined();
    expect(attrDisplayValue(mcb!)).toBe("63A FP MCB C CURVE");
    expect(isShowingDerived(mcb!)).toBe(false);
  });

  // ⚠️ 2c's TWO ABSENCE-REFUSAL TESTS WERE HERE AND ARE RE-MINTED BY RULING in the slice-2d block
  // at the end of this file ("the 2c absence refusal is REVERSED BY RULING"). They asserted that a
  // concluded absence renders EMPTY; 2d renders it "None (computed)", because a step that fired
  // `absent_when` reached a verdict rather than failing to reach one.

  it("THE THREE STATES ARE MUTUALLY EXCLUSIVE on every path this fixture can reach", () => {
    // blank / defaulted / showing-derived: at most one may be true at a time, or the field carries
    // two contradictory claims about the same value.
    const cases: Array<Record<string, string | number | null>> = [
      {}, { paired_mcb: "63A FP MCB C CURVE" }, { mcb_present: "No" }, { mcb_amp_a: null },
    ];
    for (const over of cases) {
      const a = cfCompute(over)("paired_mcb")!;
      const flags = [isAttrBlank(a), isAttrDefaulted(a), isShowingDerived(a)].filter(Boolean);
      expect(flags.length).toBeLessThanOrEqual(1);
    }
  });

  it("REGRESSION BAR: a config with NO catalog_fit is byte-identical -- plate_item unchanged", () => {
    // The 2c reader must be invisible to every pre-2c config. The module_fit face plate is the
    // sharpest case: it reaches the SAME `if (!ladder)` region the new branch was added to.
    const plate = mfCompute()("plate_item");
    expect(plate?.derived).toBe(true);
    expect(plate?.derivedValue).toBe("3M");
    expect(plate?.readOnly).toBeUndefined();
    expect(isShowingDerived(plate!)).toBe(true);
    expect(isAttrBlank(plate!)).toBe(false);
    // and the read-only blanker quantity, the other side of that region
    expect(mfCompute()("blank_qty")?.readOnly).toBe(true);
  });
});

// ── SLICE 2c: hasSessionEdits -- the Revert button's ONE condition ──────────────────────────────
// Revert exists because a panel edit is a SESSION experiment: the pricer overrides an attribute to
// see what it would cost, and until now had no way back except reloading the page. The predicate is
// pure so the button's disabled state is testable in the node env (the component is not).
describe("SLICE 2c -- hasSessionEdits (Revert is disabled until there is something to revert)", () => {
  const NO_ATTRS = { row: null, byHelper: {} as Record<string, Record<string, string>> };
  const NO_FINALS = { row: null, byHelper: {} as Record<string, string> };

  it("NEGATIVE: a clean panel has nothing to revert", () => {
    expect(hasSessionEdits(NO_ATTRS, NO_FINALS, 221)).toBe(false);
  });

  it("POSITIVE: one ATTRIBUTE override on this row counts", () => {
    const attrs = { row: 221, byHelper: { pricing_sheet: { paired_mcb: "63A FP MCB C CURVE" } } };
    expect(hasSessionEdits(attrs, NO_FINALS, 221)).toBe(true);
  });

  it("POSITIVE: one FINAL-VALUE override on this row counts, with no attribute edits at all", () => {
    const finals = { row: 221, byHelper: { pricing_sheet: "1234" } };
    expect(hasSessionEdits(NO_ATTRS, finals, 221)).toBe(true);
  });

  it("NEGATIVE: ANOTHER row's edits do not enable Revert -- it reuses `overridesForRow`", () => {
    // The row-scoping rule this panel state was rebuilt around: an override belongs to ONE row. A
    // Revert enabled by a different row's edits would claim there is something here to undo.
    const attrs = { row: 235, byHelper: { pricing_sheet: { paired_mcb: "63A FP MCB C CURVE" } } };
    expect(hasSessionEdits(attrs, NO_FINALS, 221)).toBe(false);
  });

  it("NEGATIVE: no row selected has nothing to revert", () => {
    const attrs = { row: 221, byHelper: { pricing_sheet: { paired_mcb: "x" } } };
    expect(hasSessionEdits(attrs, NO_FINALS, undefined)).toBe(false);
  });

  it("NEGATIVE: an EMPTY per-helper map is not an edit -- a cleared override re-disables Revert", () => {
    // `setAttr` writes a per-helper object; clearing the last key can leave `{}` behind. Counting the
    // container rather than its contents would leave Revert enabled with nothing to undo.
    expect(hasSessionEdits({ row: 221, byHelper: { pricing_sheet: {} } }, NO_FINALS, 221)).toBe(false);
  });
});

// ── SLICE 2d: ONE ANSWER PER FIELD ─────────────────────────────────────────────────────────────
// The facts behind an MCB (`mcb_present`, `mcb_amp_a`, `mcb_pole_stated`, `mcb_curve_stated`) leave
// the PANEL and stay in extraction and the pipeline. `paired_mcb` alone carries the answer, and
// option B says whether that answer was the row's or ours.
//
// ⚠️ THE ANTI-REGRESSION PAIR BELOW IS THE POINT OF THE WHOLE SLICE. The obvious implementation --
// filtering the definition walk -- strips the facts from `selected` too, so `absent_when` never
// fires and the ladder never runs, and every socket row is silently mispriced with the panel looking
// tidier than before.

function panelCfg(over: Partial<Record<string, unknown>> = {}): RateCategoryConfig {
  const cfg = catalogFitConfig() as unknown as { attribute_definitions: Array<Record<string, unknown>> };
  for (const d of cfg.attribute_definitions) {
    if (d.id === "mcb_present" || d.id === "mcb_amp_a") d.panel = false;
  }
  return Object.assign(cfg, over) as unknown as RateCategoryConfig;
}

/** Compute one row of the catalog_fit fixture with the two facts marked panel:false. */
function panelCompute(over: Record<string, string | number | null> = {}) {
  const merged: Record<string, string | number | null> = {
    mcb_present: "Yes", mcb_amp_a: 20, paired_mcb: null, ...over,
  };
  const r = makePricingSheetHelper({
    configsByCategory: new Map([["cf_probe", panelCfg()]]),
    items: CF_ITEMS,
    extractionByRow: buildExtractionByRow([{
      excel_row: 1,
      attributes: Object.fromEntries(
        Object.entries(merged).map(([k, v]) => [k, { value: v, confidence: 0.9 }]),
      ) as never,
    }]),
  }).compute(cfCtx(1));
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  return r;
}

describe("SLICE 2d -- panel:false hides the FIELD, never the FACT", () => {
  it("POSITIVE: a panel:false attribute is absent from the rendered attributes", () => {
    const ids = panelCompute().workings.attributes.map((a) => a.id);
    expect(ids).not.toContain("mcb_present");
    expect(ids).not.toContain("mcb_amp_a");
  });

  it("POSITIVE: the visible list still carries the ANSWER field and the ordinary inputs", () => {
    const ids = panelCompute().workings.attributes.map((a) => a.id);
    expect(ids).toContain("paired_mcb");
  });

  it("⚠️ THE ANTI-REGRESSION: the pipeline STILL RECEIVES the hidden facts and the row still prices", () => {
    // If `panel: false` had filtered the defs WALK instead of the push, `selected[mcb_amp_a]` would be
    // gone, `catalog_fit`'s fit_from would read nothing, and this row would price without its MCB --
    // silently, with a tidier-looking panel. The fitted item is the proof the facts got through.
    const r = panelCompute();
    const mcb = r.workings.attributes.find((a) => a.id === "paired_mcb")!;
    expect(mcb.derivedValue).toBe("25A FP MCB C CURVE");   // 20 A hopped to the 25 A rung
    expect(Object.keys(r.values).length).toBeGreaterThan(0);
  });

  it("⚠️ AND `absent_when` still fires on a hidden fact -- the concluded absence survives hiding", () => {
    const mcb = panelCompute({ mcb_present: "No" }).workings.attributes.find((a) => a.id === "paired_mcb")!;
    expect(mcb.derivedValue).toBe(NONE_SENTINEL);
  });

  it("POSITIVE: the missing-attribute gate EXEMPTS a hidden blank -- no invisible dead end", () => {
    // `mcb_present` is not derived and carries no default, so pre-2d a blank one set `missing` and
    // refused the row. Hidden without the exemption that becomes a refusal with no field to fill.
    const r = panelCompute({ mcb_present: null, mcb_amp_a: null });
    expect(r.basis).not.toMatch(/Complete the missing attributes/);
  });

  it("NEGATIVE: a VISIBLE blank input still blocks -- the exemption is narrow, not a softening", () => {
    // `enclosure` is an ordinary visible attribute of this fixture, so a blank one is still a genuine
    // missing input. The exemption covers ONLY what the pricer cannot see.
    const cfg = panelCfg() as unknown as { attribute_definitions: Array<Record<string, unknown>> };
    cfg.attribute_definitions.push({ id: "enclosure", label: "Enclosure", type: "choice", values: ["IP67"] });
    const r = makePricingSheetHelper({
      configsByCategory: new Map([["cf_probe", cfg as unknown as RateCategoryConfig]]),
      items: CF_ITEMS,
      extractionByRow: buildExtractionByRow([{
        excel_row: 1,
        attributes: { mcb_present: { value: "Yes", confidence: 0.9 }, mcb_amp_a: { value: 20, confidence: 0.9 },
                      enclosure: { value: null, confidence: 0.2 } } as never,
      }]),
    }).compute(cfCtx(1));
    if (!isSuggestion(r)) throw new Error("expected a suggestion");
    expect(r.basis).toMatch(/Complete the missing attributes|Fill the attributes/);
  });

  it("NEGATIVE: absent `panel` is byte-identical -- every pre-2d config renders every attribute", () => {
    const ids = cfCompute()("paired_mcb") ? undefined : undefined;
    void ids;
    const r = makePricingSheetHelper({
      configsByCategory: new Map([["cf_probe", catalogFitConfig()]]),
      items: CF_ITEMS,
      extractionByRow: buildExtractionByRow([{
        excel_row: 1,
        attributes: { mcb_present: { value: "Yes", confidence: 0.9 }, mcb_amp_a: { value: 20, confidence: 0.9 } } as never,
      }]),
    }).compute(cfCtx(1));
    if (!isSuggestion(r)) throw new Error("expected a suggestion");
    const shown = r.workings.attributes.map((a) => a.id);
    expect(shown).toContain("mcb_present");
    expect(shown).toContain("mcb_amp_a");
  });
});

// ── OPTION B: PLAIN vs "(computed)" ────────────────────────────────────────────────────────────
// R-C: PLAIN when the fitted item matches the stated facts with NOTHING substituted; "(computed)"
// when anything was substituted or inferred. The verdict composes TWO sources -- the fit's own hop
// and the map_attribute outcomes its `where` rests on -- because a fit can land exactly on a pole we
// inferred, and that is still a substitution.

/** A ladder over pole+curve so each substitution class can be isolated. */
const OB_ITEMS: RateMasterItem[] = [
  { discipline: "Electrical", kind: "db_switchgear_item",
    attributes: { family: "Switchgear", device: "MCB", pole: "FP", curve: "C", item: "25A FP MCB C CURVE", amp_a: 25.0 },
    rates: { list_price: 1000 } },
  { discipline: "Electrical", kind: "db_switchgear_item",
    attributes: { family: "Switchgear", device: "MCB", pole: "FP", curve: "D", item: "25A FP MCB D CURVE", amp_a: 25.0 },
    rates: { list_price: 1100 } },
  { discipline: "Electrical", kind: "db_switchgear_item",
    attributes: { family: "Switchgear", device: "MCB", pole: "FP", curve: "C", item: "63A FP MCB C CURVE", amp_a: 63.0 },
    rates: { list_price: 2000 } },
] as unknown as RateMasterItem[];

function obConfig(): RateCategoryConfig {
  return {
    discipline: "Electrical", category_id: "ob_probe",
    attribute_definitions: [
      // panel:false MATCHES THE SHIPPED SHAPE, and is load-bearing for these tests: a visible blank
      // input trips the missing-attribute gate, which returns BEFORE any pipeline runs -- so the
      // substitution cases below would assert against an empty results array rather than a fit.
      { id: "mcb_amp_a", label: "Amps", type: "number", panel: false },
      { id: "mcb_pole_stated", label: "Pole stated", type: "choice", values: ["FP"], allow_none: true, panel: false },
      { id: "mcb_curve_stated", label: "Curve stated", type: "choice", values: ["C", "D"], allow_none: true, panel: false },
      { id: "paired_mcb", label: "Paired MCB", type: "choice",
        values: ["25A FP MCB C CURVE", "25A FP MCB D CURVE", "63A FP MCB C CURVE"], allow_none: true },
    ],
    pipelines: {
      ob_boq: {
        output: ["supply"],
        steps: [
          { step: "map_attribute", params: { result_attr: "mcb_pole", prefer_attr: "mcb_pole_stated", default: "FP" } },
          { step: "map_attribute", params: { result_attr: "mcb_curve", prefer_attr: "mcb_curve_stated", default: "C" } },
          { step: "catalog_fit", params: {
              bind: "paired_mcb", kind: "db_switchgear_item",
              where: { family: "Switchgear", device: "MCB", pole: "@mcb_pole", curve: "@mcb_curve" },
              size_from: { attr: "amp_a" }, fit_from: { attr: "mcb_amp_a" }, direction: "up",
              prefer_attr: "paired_mcb", on_miss: "none", on_missing_fact: "none" } },
          { step: "component_ref", name: "mcb",
            ref: { kind: "db_switchgear_item", family: "Switchgear", item: "@paired_mcb" },
            target: "list_price", qty: 1, none_skips: true },
          { step: "sum_components", result: "supply" },
        ],
      },
    },
  } as unknown as RateCategoryConfig;
}

const obCtx = (excelRow: number): RateHelperRowContext => ({
  excelRow, description: "probe", nodeType: "Line Item",
  category: "ob_probe", discipline: "Electrical",
  rateKinds: ["supply_rate"] as unknown as never,
});

function ob(over: Record<string, string | number | null>) {
  const r = makePricingSheetHelper({
    configsByCategory: new Map([["ob_probe", obConfig()]]),
    items: OB_ITEMS,
    extractionByRow: buildExtractionByRow([{
      excel_row: 1,
      attributes: Object.fromEntries(
        Object.entries(over).map(([k, v]) => [k, { value: v, confidence: 0.9 }]),
      ) as never,
    }]),
  }).compute(obCtx(1));
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  return r.workings.attributes.find((a) => a.id === "paired_mcb")!;
}

describe("SLICE 2d -- OPTION B: the marker says whether anything was substituted", () => {
  it("POSITIVE: exact rung on STATED pole + STATED curve renders PLAIN -- nothing was substituted", () => {
    // The row said 25 A, FP, C; the catalog carries exactly that. We computed nothing it did not say,
    // so claiming "(computed)" would take credit for the row's own answer.
    const a = ob({ mcb_amp_a: 25, mcb_pole_stated: "FP", mcb_curve_stated: "C" });
    expect(a.derivedValue).toBe("25A FP MCB C CURVE");
    expect(a.substituted).toBe(false);
    expect(isShowingDerived(a)).toBe(false);          // no marker
    expect(attrDisplayValue(a)).toBe("25A FP MCB C CURVE");
  });

  it('SUBSTITUTION 1 -- AMP HOP: 20 A is not carried, so a different rung is priced -> "(computed)"', () => {
    const a = ob({ mcb_amp_a: 20, mcb_pole_stated: "FP", mcb_curve_stated: "C" });
    expect(a.derivedValue).toBe("25A FP MCB C CURVE");
    expect(a.substituted).toBe(true);
    expect(isShowingDerived(a)).toBe(true);
  });

  it('SUBSTITUTION 2 -- POLE INFERRED: the ladder hit exactly, but the pole came from a default', () => {
    // ⚠️ THE CASE THE STEP CANNOT ANSWER ALONE. `catalog_fit.exact` is TRUE here; only the
    // map_attribute outcome knows the pole was not stated. A verdict built on the fit alone would
    // call this plain and claim the row specified a pole it never mentioned.
    const a = ob({ mcb_amp_a: 25, mcb_pole_stated: null, mcb_curve_stated: "C" });
    expect(a.derivedValue).toBe("25A FP MCB C CURVE");
    expect(a.substituted).toBe(true);
  });

  it('SUBSTITUTION 3 -- CURVE DEFAULTED: same shape, the other fact', () => {
    const a = ob({ mcb_amp_a: 25, mcb_pole_stated: "FP", mcb_curve_stated: null });
    expect(a.substituted).toBe(true);
  });

  it('SUBSTITUTION 4 -- on_missing_fact: an unreadable amperage concludes "None (computed)"', () => {
    const a = ob({ mcb_amp_a: null, mcb_pole_stated: "FP", mcb_curve_stated: "C" });
    expect(a.derivedValue).toBe(NONE_SENTINEL);
    expect(a.substituted).toBe(true);
    expect(isShowingDerived(a)).toBe(true);
  });

  it('POSITIVE: a HUMAN-stated "None" renders PLAIN -- their decision, not ours', () => {
    const a = ob({ mcb_amp_a: 25, mcb_pole_stated: "FP", mcb_curve_stated: "C", paired_mcb: "None" });
    expect(a.value).toBe("None");
    expect(a.derivedValue).toBeUndefined();
    expect(isShowingDerived(a)).toBe(false);
    expect(attrDisplayValue(a)).toBe("None");
  });

  it("NEGATIVE: neither marker state is ever BLANK -- a derived field never draws the red border", () => {
    for (const over of [
      { mcb_amp_a: 25, mcb_pole_stated: "FP", mcb_curve_stated: "C" },
      { mcb_amp_a: 20, mcb_pole_stated: "FP", mcb_curve_stated: "C" },
      { mcb_amp_a: null, mcb_pole_stated: "FP", mcb_curve_stated: "C" },
    ] as Array<Record<string, string | number | null>>) {
      expect(isAttrBlank(ob(over))).toBe(false);
    }
  });
});

// ── THE 2c RE-MINTS ────────────────────────────────────────────────────────────────────────────
describe("SLICE 2d -- the 2c absence refusal is REVERSED BY RULING", () => {
  it('a CONCLUDED ABSENCE now renders "None (computed)" (was: renders EMPTY)', () => {
    // ⚠️ RE-MINTED FROM 2c's "NEGATIVE: POSITIVE ABSENCE renders EMPTY, never a fitted item".
    // 2c's PREMISE WAS THAT NOTHING WAS COMPUTED. That premise expired with slice 2d: a step that
    // fired `absent_when` DID conclude something -- that there is no such component -- and a
    // concluded absence is a verdict, not the lack of one. Rendering it empty was tolerable only
    // while the facts behind it were on screen to explain the blank; 2d takes them off the panel,
    // so the field has to speak for itself.
    const mcb = cfCompute({ mcb_present: "No" })("paired_mcb")!;
    expect(mcb.derivedValue).toBe(NONE_SENTINEL);
    expect(attrDisplayValue(mcb)).toBe("None");
    expect(isShowingDerived(mcb)).toBe(true);
    expect(isAttrBlank(mcb)).toBe(false);
  });

  it('an UNREADABLE FACT likewise renders "None (computed)" (was: renders EMPTY)', () => {
    // ⚠️ RE-MINTED FROM 2c's "an unreadable fact (on_missing_fact none) renders EMPTY". Same ruling.
    // ⚠️ USES THE panel:false FIXTURE DELIBERATELY. With `mcb_amp_a` VISIBLE, a null one trips the
    // missing-attribute gate and the helper returns before any pipeline runs -- which is why 2c's
    // version of this test passed while asserting almost nothing about the absence path. 2d hides the
    // fact, so the gate lets the row through and `on_missing_fact` genuinely fires.
    const mcb = panelCompute({ mcb_amp_a: null }).workings.attributes.find((a) => a.id === "paired_mcb")!;
    expect(mcb.derivedValue).toBe(NONE_SENTINEL);
    expect(attrDisplayValue(mcb)).toBe("None");
  });
});

// ── THE MODULE_FIT UPGRADE, UNDER RULING (x) ───────────────────────────────────────────────────
describe("SLICE 2d -- take-the-larger shows WHAT WAS BOUGHT (owner ruling x)", () => {
  it("POSITIVE: a stated plate too small shows the UPGRADED rung, marked", () => {
    // The row says 1M and the contents need 3. Pre-2d the field showed "1M" -- a size the row is not
    // being charged for. The upgrade NOTE is kept, so this is not a silent override.
    const plate = mfCompute({ plate_item: "1M & 2M", switch_qty: 3 })("plate_item")!;
    expect(plate.substituted).toBe(true);
    expect(attrDisplayValue(plate)).toBe("3M");
    expect(isShowingDerived(plate)).toBe(true);
    expect(plate.notes?.some((n) => n.kind === "upgrade")).toBe(true);
  });

  it("⚠️ NEGATIVE: a stated plate the pipeline USED is still never overwritten -- the narrowing is exact", () => {
    // This is the half of the old contract that STANDS. 6M holds 3 modules comfortably, so nothing
    // was substituted and the pricer's own entry is what shows.
    const plate = mfCompute({ plate_item: "6M", switch_qty: 3 })("plate_item")!;
    expect(plate.substituted).toBeUndefined();
    expect(attrDisplayValue(plate)).toBe("6M");
    expect(isShowingDerived(plate)).toBe(false);
  });

  it("REGRESSION BAR: a blank plate still shows the computed rung, marked, exactly as in 2c", () => {
    const plate = mfCompute()("plate_item")!;
    expect(attrDisplayValue(plate)).toBe("3M");
    expect(isShowingDerived(plate)).toBe(true);
    expect(isAttrBlank(plate)).toBe(false);
  });

  it("REGRESSION BAR: the read-only blanker quantity is untouched by option B", () => {
    expect(mfCompute()("blank_qty")?.readOnly).toBe(true);
  });
});

// ── Q4(i): THE DERIVATION TAB IS A PURE CALCULATOR ─────────────────────────────────────────────
describe("SLICE 2d -- Q4(i): derived binds leave the Derivation input selects", () => {
  it("POSITIVE: a catalog_fit bind and a module_fit ladder bind are both derived", () => {
    // The shared predicate is what the Derivation screen now filters on. It lives in the LEAF module
    // (`rateMasterStructure`), because the helper already imports FROM RateMasterDerivation -- so the
    // Derivation screen importing it back out of the helper would be a cycle.
    expect(derivedAttrIds(catalogFitConfig()).has("paired_mcb")).toBe(true);
    expect(derivedAttrIds(moduleFitConfig()).has("plate_item")).toBe(true);
  });

  it("NEGATIVE: a genuine INPUT is not derived, so the calculator keeps every control it needs", () => {
    const d = derivedAttrIds(catalogFitConfig());
    expect(d.has("mcb_present")).toBe(false);
    expect(d.has("mcb_amp_a")).toBe(false);
  });

  it("⚠️ THE TWO PREDICATES ARE NO LONGER KEPT APART -- the superseded invariant, pinned as superseded", () => {
    // `frontend/CLAUDE.md` used to require the Derivation screen to read `derivedQtyAttrs` ONLY. Owner
    // ruling Q4(i) supersedes that: it now reads `derivedAttrIds`, so `plate_item` leaves its selects.
    // The three bench capabilities that costs are pinned by tests instead -- the upgrade above,
    // stated-wins, and stated-"None" sticking (in the interpreter suite).
    const cfg = moduleFitConfig();
    expect(derivedQtyAttrs(cfg).has("plate_item")).toBe(false);  // not a superseded QUANTITY...
    expect(derivedAttrIds(cfg).has("plate_item")).toBe(true);    // ...but it IS a derived bind
  });
});

// ---- SLICE 3b: the CONDITIONAL exemption (owner rulings R8 + R9) ----
//
// A `map_attribute` is the first derivation mechanism that CANNOT always run: it fills its target
// from a SOURCE attribute, and on a row where that source is blank it fills nothing. Exempting its
// target from the missing-attribute gate WHOLESALE would replace "Complete the missing attributes
// to price" -- an instruction the pricer can act on -- with "no match for these attributes", which
// they cannot, on 35 of 79 live tray rows. The owner ruled the message is worth keeping, so the
// exemption is narrowed PER ROW to rows the pipeline can actually serve.
const TRAY3B_ITEMS_H: RateMasterItem[] = [
  { discipline: "Electrical", kind: "cable_tray",
    attributes: { tray_type: "Solid", material: "GI", thickness_mm: 2, width_mm: 100 },
    rates: { without_cover_list: 400, cover_only_list: 0, install_rate: 30 } },
  { discipline: "Electrical", kind: "cable_tray",
    attributes: { tray_type: "Solid", material: "GI", thickness_mm: 1.6, width_mm: 100 },
    rates: { without_cover_list: 200, cover_only_list: 0, install_rate: 30 } },
];

const TRAY3B_CONFIG: RateCategoryConfig = {
  discipline: "Electrical", category_id: "cabletray_raceway",
  attribute_definitions: [
    { id: "tray_type", label: "Type", type: "choice", values: ["Solid"] },
    { id: "material", label: "Material", type: "choice", values: ["GI"] },
    { id: "thickness_mm", label: "Thickness (mm)", type: "number_choice",
      values_from: { kind: "cable_tray", attr: "thickness_mm" } },
    // B1: the hidden gauge FACT -- selector on (the model reads it), panel:false (never on the panel).
    { id: "thickness_swg", label: "Thickness gauge (SWG)", type: "number", panel: false },
    { id: "width_mm", label: "Width (mm)", type: "number" },
  ],
  pipelines: {
    tray_boq_supply: {
      output: ["supply_per_rmt"],
      steps: [
        { step: "map_attribute", params: { result_attr: "thickness_mm", prefer_attr: "thickness_mm",
          from_attr: "thickness_swg", table: { "14": 2.0, "16": 1.6 } } },
        { step: "catalog_fit", params: { bind: "width_mm", fit_into: "width_mm", kind: "cable_tray",
          where: { tray_type: "@tray_type", material: "@material", thickness_mm: "@thickness_mm" },
          label_attr: "width_mm", size_from: { attr: "width_mm" }, fit_from: { attr: "width_mm" },
          direction: "up", on_miss: "no_compute" } },
        { step: "match_master_row", params: { kind: "cable_tray" } },
        { step: "component", name: "base", target: "without_cover_list", params: {}, formula: "base" },
        { step: "sum_components", result: "supply_per_rmt" },
      ],
    },
  },
} as unknown as RateCategoryConfig;

const trayCtx = (excelRow: number): RateHelperRowContext => ({
  excelRow, description: "cable tray", nodeType: "Line Item",
  category: "cabletray_raceway", discipline: "Electrical", rateKinds: ["supply_rate"],
});
const trayHelper = (attrs: Record<string, string | number | null>) =>
  makePricingSheetHelper({
    config: TRAY3B_CONFIG, items: TRAY3B_ITEMS_H,
    extractionByRow: buildExtractionByRow([{ excel_row: 7, description: "cable tray", attributes: ext(attrs) }]),
  }).compute(trayCtx(7));
const attrOf = (r: ReturnType<ReturnType<typeof makePricingSheetHelper>["compute"]>, id: string) =>
  (isSuggestion(r) ? r.workings?.attributes ?? [] : []).find((a) => a.id === id);

describe("SLICE 3b -- R8: the gate exemption is CONDITIONAL, not blanket", () => {
  it("POSITIVE: a gauge but NO millimetres is NOT gated -- the pipeline can fill it, so it does", () => {
    const r = trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100, thickness_swg: 14 });
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    // Not the gate's message, and it actually PRICES -- 14 SWG -> 2.0 -> the 400 row.
    expect(r.basis).not.toBe("Complete the missing attributes to price");
    expect(r.values.supply_rate).toBe(400);
  });

  it("NEGATIVE: NEITHER millimetres NOR a gauge -- still gated, with the ORIGINAL message", () => {
    // ⚠️ THE REGRESSION THE OWNER ASKED TO PRESERVE. A blanket exemption would have turned this into
    // "no match for these attributes" on 35 of 79 live rows. Pinned so it cannot be lost again.
    const r = trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100 });
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.basis).toBe("Complete the missing attributes to price");
  });

  it("R9: on that gated row the thickness field still LOOKS like it needs filling", () => {
    // Border and message must agree. Without the display narrowing the field would render as
    // derived -- no red border -- while the message still asked for it.
    const r = trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100 });
    expect(attrOf(r, "thickness_mm")?.derived).toBeFalsy();
    expect(attrOf(r, "thickness_mm")?.value).toBe("");
  });

  it("R9: on a gauge-bearing row the thickness field IS derived, and shows the mapped value", () => {
    const r = trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100, thickness_swg: 16 });
    expect(attrOf(r, "thickness_mm")?.derived).toBe(true);
  });

  it("R3: the gauge attribute NEVER reaches the helper panel", () => {
    // `panel: false` keeps it off the pricer's screen on every row -- gauge-bearing or not -- while
    // `selector` stays on so the model still reads it.
    const shapes: Record<string, string | number | null>[] = [
      { tray_type: "Solid", material: "GI", width_mm: 100, thickness_swg: 14 },
      { tray_type: "Solid", material: "GI", width_mm: 100 },
    ];
    for (const attrs of shapes) {
      expect(attrOf(trayHelper(attrs), "thickness_swg")).toBeUndefined();
    }
  });

  it("SCOPING: a config with NO map_attribute is byte-identical -- width is untouched", () => {
    // The narrowing can only ever remove a `map_attribute` target. A `catalog_fit` bind is
    // unconditionally derived on every path, which is what keeps slice 3a's width -- and
    // point_wiring, switches_sockets and industrial_sockets -- exactly as they were.
    const noMap = {
      ...TRAY3B_CONFIG,
      pipelines: { tray_boq_supply: {
        ...TRAY3B_CONFIG.pipelines!.tray_boq_supply,
        steps: TRAY3B_CONFIG.pipelines!.tray_boq_supply.steps.filter(
          (s) => (s as { step?: string }).step !== "map_attribute"),
      } },
    } as unknown as RateCategoryConfig;
    const r = makePricingSheetHelper({
      config: noMap, items: TRAY3B_ITEMS_H,
      extractionByRow: buildExtractionByRow([{ excel_row: 8, description: "t",
        attributes: ext({ tray_type: "Solid", material: "GI", width_mm: 100, thickness_mm: 2 }) }]),
    }).compute({ ...trayCtx(8), excelRow: 8 });
    expect(isSuggestion(r) && r.values.supply_rate).toBe(400);
    // width_mm is a catalog_fit bind -> derived on every path, narrowing or not
    expect(attrOf(r, "width_mm")?.derived).toBe(true);
  });
});

describe("SLICE 3b -- mapAttributeSources (the pure half of R8)", () => {
  it("reads result_attr + from_attr FROM CONFIG, never by hardcoded id", () => {
    const m = mapAttributeSources(TRAY3B_CONFIG);
    expect(m.get("thickness_mm")).toEqual({ fromAttr: "thickness_swg", hasDefault: false });
  });

  it("a step carrying a DEFAULT is unconditionally fillable and is never narrowed", () => {
    // industrial_sockets' curve-else-C shape: nothing to be absent, so nothing to narrow.
    const cfg = { pipelines: { p: { output: ["x"], steps: [
      { step: "map_attribute", params: { result_attr: "mcb_curve", prefer_attr: "mcb_curve_stated", default: "C" } },
    ] } } } as unknown as RateCategoryConfig;
    expect(mapAttributeSources(cfg).get("mcb_curve")).toEqual({ fromAttr: undefined, hasDefault: true });
  });

  it("EMPTY for a config with no map_attribute -- the no-op guarantee", () => {
    expect(mapAttributeSources(CONFIG).size).toBe(0);
  });

  it("derivedAttrIds now collects a map_attribute result_attr (the FIFTH mechanism)", () => {
    expect(derivedAttrIds(TRAY3B_CONFIG).has("thickness_mm")).toBe(true);
    // ...and still collects the catalog_fit bind beside it, unchanged.
    expect(derivedAttrIds(TRAY3B_CONFIG).has("width_mm")).toBe(true);
  });
});

// ---- SLICE 3b FINISH: the map_attribute DISPLAY branch ----
//
// THE DEFECT THIS CLOSES, caught by the owner during the 3b cert: row 513 priced at 1068 off a
// thickness of 1.6 converted from a stated "16SWG", while the Thickness field rendered an empty
// "-- select --". `derivedAttrIds` marked the attribute derived (correctly exempting it from the
// missing-input gate) but `applyDerivedDisplay` had no `map_attribute` branch, so nothing filled its
// `derivedValue`. Same shape as the row-98 defect slice 2c fixed for `catalog_fit`, and the same
// rule: THE PANEL SHOWS WHAT PRICING USED.
describe("SLICE 3b FINISH -- a mapped thickness is SHOWN, and a stated one stays plain", () => {
  it("POSITIVE: a gauge-derived thickness renders the resolved MILLIMETRE value, tagged (computed)", () => {
    const r = trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100, thickness_swg: 16 });
    const t = attrOf(r, "thickness_mm");
    expect(t?.derived).toBe(true);
    expect(t?.derivedValue).toBe("1.6");        // the mapped mm value, not the gauge
    expect(t?.substituted).toBe(true);          // -> the "(computed)" tag
  });

  it("POSITIVE: 14 SWG shows 2, the other live gauge", () => {
    const t = attrOf(trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100, thickness_swg: 14 }), "thickness_mm");
    expect(t?.derivedValue).toBe("2");
    expect(t?.substituted).toBe(true);
  });

  it("B3 NEGATIVE: a STATED millimetre thickness renders PLAIN -- no marker, no derivedValue", () => {
    // The row supplied it and the mapping never ran, so nothing was substituted. Tagging it would
    // credit the pipeline with the pricer's own entry -- the option-B rule, and the reason the
    // stated branch publishes no display value at all.
    const t = attrOf(trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100, thickness_mm: 1.6 }), "thickness_mm");
    expect(t?.substituted).toBeFalsy();
    expect(t?.derivedValue).toBeUndefined();
    expect(t?.value).toBe("1.6");               // the row's own entry is what shows
  });

  it("B3 NEGATIVE: millimetres AND a gauge -- the stated value shows, still PLAIN", () => {
    // R6: stated wins. 1.6 is shown; the 14 SWG that would have mapped to 2 is not, and no marker.
    const t = attrOf(trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100, thickness_mm: 1.6, thickness_swg: 14 }), "thickness_mm");
    expect(t?.substituted).toBeFalsy();
    expect(t?.derivedValue).toBeUndefined();
  });

  it("UNREGRESSED (R8/R9): neither millimetres nor a gauge -- blank, and still gated", () => {
    // The narrowing must survive this branch: with nothing to map, the field renders as a genuine
    // missing input (no `derived`) and the ORIGINAL message stands.
    const r = trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100 });
    expect(isSuggestion(r) && r.basis).toBe("Complete the missing attributes to price");
    const t = attrOf(r, "thickness_mm");
    expect(t?.derived).toBeFalsy();
    expect(t?.derivedValue).toBeUndefined();
  });

  it("NO PRICED VALUE MOVES: the display branch is display-only", () => {
    // The whole slice moves no numbers. A gauge row and a stated-mm row both price exactly as they
    // did before this branch existed -- 14 SWG -> 2.0 -> the 400 row, 1.6 stated -> the 200 row.
    const gauge = trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100, thickness_swg: 14 });
    expect(isSuggestion(gauge)).toBe(true);
    if (isSuggestion(gauge)) expect(gauge.values.supply_rate).toBe(400);

    const statedMm = trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100, thickness_mm: 1.6 });
    expect(isSuggestion(statedMm)).toBe(true);
    if (isSuggestion(statedMm)) expect(statedMm.values.supply_rate).toBe(200);
  });

  it("SCOPING: width still renders through the catalog_fit branch, NOT this one", () => {
    // width_mm is a `catalog_fit` bind, not a map target, so branch 4 keeps owning it and its
    // fitted label is unchanged. The new branch cannot reach it.
    const t = attrOf(trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100, thickness_swg: 16 }), "width_mm");
    expect(t?.derived).toBe(true);
    expect(t?.derivedValue).toBe("100");        // 3a's fitted label, unchanged
  });

  it("width INHERITS the substitution when its ladder rests on an inferred thickness", () => {
    // ⚠️ NOT a change from this branch -- it is the slice-2d option-B rule, already live in 3b and
    // visible in that cert (row 513 showed "Width (mm) (computed) 600" at an EXACT catalog width).
    // The tray `catalog_fit` filters its ladder on `@thickness_mm`, so `whereRefs` joins into the
    // map outcomes: an exact width fit that rests on a gauge-inferred thickness is still a value we
    // worked out, and the panel says so. A fit can be exact and still rest on an inferred fact.
    const inferred = attrOf(trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100, thickness_swg: 16 }), "width_mm");
    expect(inferred?.substituted).toBe(true);

    // THE CONTRAST: with the thickness STATED, nothing behind the fit was substituted -> PLAIN.
    const stated = attrOf(trayHelper({ tray_type: "Solid", material: "GI", width_mm: 100, thickness_mm: 1.6 }), "width_mm");
    expect(stated?.substituted).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 4 (F-1 / F-8) -- conduit size + wiring core/thickness become CATALOGUE-FED pick-lists
//
// Configuration only: the shipped config flips three defs from `number` to `number_choice` +
// `values_from`. No interpreter or panel code changed. What these pin is the BEHAVIOUR the owner
// ruled for, on the side of the wire the pricer actually sees.
//
// ⚠️ THE R1 TESTS PIN A DELIBERATE LOSS OF INFORMATION, AND THAT IS THE POINT. A value the
// catalogue does not carry stops being visible. The owner ruled STRICT on 2026-08-19 -- "this is ok,
// this gives the true picture to the user" -- because such a value is not a usable value: the row
// could never have priced on it. These are not describing a side effect to be tidied away later;
// they are the change. Deleting them would let a future "helpfully show the stored value anyway"
// patch through without anyone noticing it reverses a ruling.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// The shipped shape, mirrored: number_choice + values_from, and NO `where` (R3 -- global lists).
const S4_CONDUIT_SIZE = {
  id: "size_mm", label: "Size (mm)", type: "number_choice" as const,
  values_from: { kind: "conduit", attr: "size_mm" },
};
const S4_CORE = {
  id: "core", label: "Core", type: "number_choice" as const,
  values_from: { kind: "cable", attr: "core" },
};
const S4_THICKNESS = {
  id: "thickness_sqmm", label: "Thickness (sqmm)", type: "number_choice" as const,
  values_from: { kind: "cable", attr: "thickness_sqmm" },
};

function conduitItem(conduit_type: string, size_mm: number, list: number): RateMasterItem {
  return { discipline: "Electrical", kind: "conduit", brand: "Polycab", unit: "Mtr",
           attributes: { conduit_type, size_mm }, rates: { list_price_per_mtr: list } };
}
// Mirrors the live catalogue's shape: every size in BOTH types, floats throughout (F-3).
const S4_CONDUIT_ITEMS: RateMasterItem[] = [
  conduitItem("PVC", 20, 40), conduitItem("MS", 20, 55),
  conduitItem("PVC", 25, 60), conduitItem("MS", 25, 80),
  conduitItem("PVC", 32, 90), conduitItem("MS", 32, 120),
  conduitItem("PVC", 50, 150), conduitItem("MS", 50, 190),
];

// A wiring catalogue whose CABLE side carries values TERMINATION does not -- the R2 discriminators.
const S4_WIRING_ITEMS: RateMasterItem[] = [
  ...ITEMS,
  cable("COPPER", "ARMOURED", 8, 2.5, 400, 12),        // core 8   -> cable only
  cable("COPPER", "UNARMOURED", 1, 0.75, 60, 8),       // th 0.75  -> cable only
  term("COPPER", "ARMOURED", 3, 2.5, 6.47, 82.55, 361.18),
];

// The wiring config with the two slice-4 defs swapped in, exactly as shipped.
const S4_WIRING_CONFIG: RateCategoryConfig = {
  ...CONFIG,
  attribute_definitions: [
    ...CONFIG.attribute_definitions.filter((d) => d.id !== "core" && d.id !== "thickness_sqmm"),
    S4_CORE, S4_THICKNESS,
  ],
};

describe("SLICE 4 -- the three catalogue-fed pick-lists", () => {
  it("each of the three attributes resolves its list FROM THE LIVE CATALOGUE", () => {
    // POSITIVE: the list is built at all. Pre-slice these were free number inputs with `options`
    // undefined, so the panel rendered an <Input> and any number at all could be typed.
    expect(attributeOptions(S4_CONDUIT_SIZE, S4_CONDUIT_ITEMS)).toEqual(["20", "25", "32", "50"]);
    expect(attributeOptions(S4_CORE, S4_WIRING_ITEMS)).toEqual(
      expect.arrayContaining(["1", "3", "8"]));
    expect(attributeOptions(S4_THICKNESS, S4_WIRING_ITEMS)).toEqual(
      expect.arrayContaining(["0.75", "2.5", "6", "10"]));
  });

  it("R2 -- wiring's lists come from CABLE, not termination", () => {
    // Pinned by the DISCRIMINATORS, because the two kinds overlap heavily and a list built from the
    // wrong kind still looks plausible. core 8 and thickness 0.75 exist in cable and NOT in
    // termination; repoint either values_from at "termination" and exactly these go red.
    expect(attributeOptions(S4_CORE, S4_WIRING_ITEMS)).toContain("8");
    expect(attributeOptions(S4_THICKNESS, S4_WIRING_ITEMS)).toContain("0.75");
    // NEGATIVE: the same read against `termination` offers neither -- which is what makes them
    // discriminators rather than merely two values that happen to be present.
    const fromTermCore = attributeOptions(
      { ...S4_CORE, values_from: { kind: "termination", attr: "core" } }, S4_WIRING_ITEMS);
    const fromTermTh = attributeOptions(
      { ...S4_THICKNESS, values_from: { kind: "termination", attr: "thickness_sqmm" } }, S4_WIRING_ITEMS);
    expect(fromTermCore).not.toContain("8");
    expect(fromTermTh).not.toContain("0.75");
  });

  it("R3 -- the lists are GLOBAL, unfiltered by the row's other attributes", () => {
    // A global list is the union across every material/insulation combination. `core 8` is
    // COPPER/ARMOURED-only here and `thickness 0.75` COPPER/UNARMOURED-only, so their SIMULTANEOUS
    // presence proves nothing is filtering. This is also why the 3.5-core/150 COMBINATION gap stays
    // invisible to this slice -- a separate finding, explicitly not this slice's job.
    const cores = attributeOptions(S4_CORE, S4_WIRING_ITEMS);
    const ths = attributeOptions(S4_THICKNESS, S4_WIRING_ITEMS);
    expect(cores).toContain("8");      // COPPER/ARMOURED only
    expect(ths).toContain("0.75");     // COPPER/UNARMOURED only
    expect(ths).toContain("10");       // a different combination again
    // NEGATIVE: adding a `where` DOES narrow it -- so the absence of `where` is load-bearing, not
    // decorative. If this ever stops narrowing, `where` has quietly become a no-op.
    const filtered = attributeOptions(
      { ...S4_CORE, values_from: { kind: "cable", attr: "core", where: { insulation: "UNARMOURED" } } },
      S4_WIRING_ITEMS);
    expect(filtered).not.toContain("8");
    expect(cores.length).toBeGreaterThan(filtered.length);
  });

  it("a value IN the catalogue prices UNCHANGED, and the dropdown can display it", () => {
    // The regression half: for every good row, slice 4 changes the CONTROL and nothing else.
    const map = buildExtractionByRow([{ excel_row: 900, attributes: ext({
      material: "COPPER", insulation: "UNARMOURED", core: 1, thickness_sqmm: 6 }) as never }]);
    const helper = makePricingSheetHelper({ config: S4_WIRING_CONFIG, items: S4_WIRING_ITEMS, extractionByRow: map });
    const r = helper.compute(ctx(900, "1C x 6 sqmm copper unarmoured cable"));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    // the standing golden values, untouched by the type flip
    expect(r.values.supply_rate).toBe(120);
    expect(r.values.install_rate).toBe(20);
    const core = r.workings.attributes.find((a) => a.id === "core")!;
    expect(core.value).toBe("1");
    expect(core.options).toContain("1");   // the <select> can render it SELECTED -> it displays
  });

  it("R1 -- a stored value NOT in the catalogue is ABSENT from the options, so the field renders BLANK", () => {
    // THE CHANGE, half one: an existing run keeps its out-of-catalogue value in `selected` (so it
    // still drives matching, and still fails), but the <select> carries no <option> for it, so the
    // browser shows nothing selected. The pricer reads the BoQ's own description in the grid's
    // frozen Description column instead -- that is P4's premise, certified live at cert step 3.
    const map = buildExtractionByRow([{ excel_row: 901, attributes: ext({
      material: "COPPER", insulation: "UNARMOURED", core: 3.5, thickness_sqmm: 180 }) as never }]);
    const helper = makePricingSheetHelper({ config: S4_WIRING_CONFIG, items: S4_WIRING_ITEMS, extractionByRow: map });
    const r = helper.compute(ctx(901, "3.5Cx180 sq.mm (XLPE)"));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    const th = r.workings.attributes.find((a) => a.id === "thickness_sqmm")!;
    // the value is still THERE (it is what the row supplied)...
    expect(th.value).toBe("180");
    // ...but it is NOT offered, so the control cannot show it. THIS is the blank.
    expect(th.options).not.toContain("180");
    // and the row does not price -- as it did not before the slice either
    expect(r.values.supply_rate).toBeUndefined();
    expect(r.basis).toBe("no match for these attributes");
  });

  it("R1 -- a FRESH extraction nulls the out-of-catalogue value, and the row is gated INCOMPLETE", () => {
    // THE CHANGE, half two. Server-side `_coerce_value_ex` now rejects a `number_choice` value
    // outside its domain (COERCE_OUTSIDE_DOMAIN) and stores null, so a re-run row arrives BLANK.
    // The gate then fires and the message changes from "no match for these attributes" to
    // "Complete the missing attributes to price". Same row, same non-price, different explanation --
    // approved as #57 item 5, and this is where that promise is kept.
    const map = buildExtractionByRow([{ excel_row: 902, attributes: ext({
      material: "COPPER", insulation: "UNARMOURED", core: 3.5, thickness_sqmm: null }) as never }]);
    const helper = makePricingSheetHelper({ config: S4_WIRING_CONFIG, items: S4_WIRING_ITEMS, extractionByRow: map });
    const r = helper.compute(ctx(902, "3.5Cx180 sq.mm (XLPE)"));
    expect(isSuggestion(r)).toBe(true);
    if (!isSuggestion(r)) return;
    expect(r.basis).toBe("Complete the missing attributes to price");
    const th = r.workings.attributes.find((a) => a.id === "thickness_sqmm")!;
    expect(th.value).toBe("");
    expect(isAttrBlank(th)).toBe(true);     // the red incomplete border
    expect(th.options).toEqual(expect.arrayContaining(["2.5", "6"]));  // still a pick-list
  });

  it("conduit -- an in-catalogue size prices, an out-of-catalogue size does not and is not offered", () => {
    // The same two halves on the OTHER category, because conduit_piping has its own config and its
    // own (tiny, 4-value) domain -- the one most likely to surprise a pricer.
    const conduitCfg: RateCategoryConfig = {
      discipline: "Electrical", category_id: "conduit_piping",
      attribute_definitions: [
        { id: "conduit_type", label: "Conduit Type", type: "choice", values: ["PVC", "MS"] },
        S4_CONDUIT_SIZE,
      ],
      pipelines: { conduit_boq: { output: ["supply_per_mtr", "install_per_mtr"], steps: [
        { step: "match_master_row", params: { kind: "conduit" } },
        { step: "scale", target: "list_price_per_mtr", result: "supply_per_mtr",
          params: { boq_multiplier: 0.7 }, formula: "base*boq_multiplier" },
        { step: "scale", target: "supply_per_mtr", result: "install_per_mtr",
          params: { install_ratio: 0.2 }, formula: "base*install_ratio" },
        { step: "roundup", target: "install_per_mtr", params: { digits: -1 } },
      ] } },
    };
    const cctx = (excelRow: number, description: string): RateHelperRowContext => ({
      excelRow, description, nodeType: "Line Item", category: "conduit_piping",
      discipline: "Electrical", rateKinds: ["supply_rate", "install_rate"],
    });
    // POSITIVE: 25 mm PVC -> 60 x 0.7 = 42 supply, roundup(42 x 0.2, -1) = 10 install
    const good = makePricingSheetHelper({
      configsByCategory: new Map([["conduit_piping", conduitCfg]]), items: S4_CONDUIT_ITEMS,
      extractionByRow: buildExtractionByRow([{ excel_row: 910, attributes: ext({ conduit_type: "PVC", size_mm: 25 }) as never }]),
    }).compute(cctx(910, "25 mm dia PVC conduit"));
    expect(isSuggestion(good)).toBe(true);
    if (!isSuggestion(good)) return;
    expect(good.values.supply_rate).toBe(42);
    expect(good.values.install_rate).toBe(10);
    const sz = good.workings.attributes.find((a) => a.id === "size_mm")!;
    expect(sz.options).toEqual(["20", "25", "32", "50"]);
    expect(sz.options).toContain(sz.value);

    // NEGATIVE / R1: 80 mm is a real BoQ ask the catalogue does not stock. It never priced; now it
    // is also not offered, so the field is blank and the true picture is "we do not stock this".
    const bad = makePricingSheetHelper({
      configsByCategory: new Map([["conduit_piping", conduitCfg]]), items: S4_CONDUIT_ITEMS,
      extractionByRow: buildExtractionByRow([{ excel_row: 911, attributes: ext({ conduit_type: "PVC", size_mm: 80 }) as never }]),
    }).compute(cctx(911, "80 mm outer dia"));
    expect(isSuggestion(bad)).toBe(true);
    if (!isSuggestion(bad)) return;
    expect(bad.values.supply_rate).toBeUndefined();
    const badSz = bad.workings.attributes.find((a) => a.id === "size_mm")!;
    expect(badSz.value).toBe("80");
    expect(badSz.options).not.toContain("80");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R9 (owner ruling, 2026-08-19) -- THE PLACEHOLDER IS ALWAYS SELECTABLE
//
// ⚠️ READ THIS BEFORE ADDING A TEST HERE, BECAUSE THE THING R9 FIXES IS NOT TESTABLE IN THIS SUITE.
//
// R9 removes `disabled` from the `— select —` option in RateHelperPanel. What that fixes is a
// REACT/DOM SEMANTIC: a controlled <select> whose `value` matches no option does NOT go blank --
// React sets `option.selected = (option.value === props.value)` per option rather than assigning
// `.value`, so when nothing matches every option ends unselected and the browser falls back to the
// first SELECTABLE option. A disabled placeholder is skipped, so the field displayed the first real
// catalog value instead of blank.
//
// vitest runs with `environment: "node"` and there is NO DOM environment (frontend/CLAUDE.md
// records this as deliberate). So NOTHING here can observe `select.selectedIndex`, and a test
// asserting `attr.options` does not contain the stored value -- which the slice-4 tests above do,
// correctly -- passes happily while the rendered control shows the wrong number. That is exactly
// what happened: those tests were green while row 87 displayed "20" for a stored 40.
//
// THE HONEST INSTRUMENT FOR R9 IS THE BROWSER CERT, and it is what caught it.
// DO NOT add a test here that appears to cover the rendering. It would be worse than no test.
//
// What IS testable, and is pinned below, is the CONSEQUENCE the ruling asks for: clearing a field
// by hand must land the row in the same state as never having filled it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("SLICE 4 / R9 -- clearing a field equals never having filled it", () => {
  const cleared = (overrides: Record<string, string>) =>
    makePricingSheetHelper({
      config: S4_WIRING_CONFIG, items: S4_WIRING_ITEMS,
      extractionByRow: buildExtractionByRow([{ excel_row: 920, attributes: ext({
        material: "COPPER", insulation: "UNARMOURED", core: 3, thickness_sqmm: 10 }) as never }]),
    }).compute(ctx(920, "3 core x 10 sq.mm copper unarmoured cable"), overrides);

  const neverFilled = () =>
    makePricingSheetHelper({
      config: S4_WIRING_CONFIG, items: S4_WIRING_ITEMS,
      extractionByRow: buildExtractionByRow([{ excel_row: 921, attributes: ext({
        material: "COPPER", insulation: "UNARMOURED", core: 3, thickness_sqmm: null }) as never }]),
    }).compute(ctx(921, "3 core x 10 sq.mm copper unarmoured cable"));

  it("a hand-cleared attribute and a never-filled one reach the SAME state: blank + gated incomplete", () => {
    const a = cleared({ thickness_sqmm: "" });   // the pricer selected the placeholder
    const b = neverFilled();                     // extraction returned null
    expect(isSuggestion(a)).toBe(true);
    expect(isSuggestion(b)).toBe(true);
    if (!isSuggestion(a) || !isSuggestion(b)) return;

    // both gated incomplete, with the SAME message -- there is one blank, not two kinds of blank
    expect(a.basis).toBe("Complete the missing attributes to price");
    expect(b.basis).toBe(a.basis);
    // neither prices
    expect(a.values.supply_rate).toBeUndefined();
    expect(b.values.supply_rate).toBeUndefined();

    const attrA = a.workings.attributes.find((x) => x.id === "thickness_sqmm")!;
    const attrB = b.workings.attributes.find((x) => x.id === "thickness_sqmm")!;
    // both render blank, and both carry the red incomplete border
    expect(attrA.value).toBe("");
    expect(attrB.value).toBe("");
    expect(isAttrBlank(attrA)).toBe(true);
    expect(isAttrBlank(attrB)).toBe(true);
    // and the pick-list is still offered on both, so the pricer can fill it back in
    expect(attrA.options).toEqual(attrB.options);
    expect(attrA.options).toEqual(expect.arrayContaining(["2.5", "10"]));
  });

  it("clearing is NOT the same as the 'None' sentinel -- an empty string is absence, not a decision", () => {
    // ⚠️ Load-bearing distinction, and the reason R9 could not simply reuse the None mechanism.
    // `coerceForMatch` returns null for "" BEFORE it checks allow_none, so a cleared field is
    // ABSENT (gated incomplete). "None" is a positive decision that a component is deliberately
    // not there. Before R9 an unmatched value on an allow_none def fell back to the "None" option
    // -- the browser presenting a decision the row never made.
    const noneDef = { id: "socket_item", label: "Socket", type: "choice" as const, allow_none: true,
      values_from: { kind: "switch_socket_item", attr: "item", where: { family: "Socket" } } };
    expect(coerceForMatch(noneDef, "")).toBeNull();               // cleared -> ABSENT
    expect(coerceForMatch(noneDef, NONE_SENTINEL)).toBe(NONE_SENTINEL);  // None -> preserved verbatim
    // and the sentinel is offered at the TOP of the list, distinct from the blank placeholder
    expect(attributeOptions(noneDef, PW_HELPER_ITEMS)[0]).toBe(NONE_SENTINEL);
  });

  it("clearing an attribute the row DOES price un-prices it -- the pricer's clear genuinely reaches the price", () => {
    // The positive control for the test above: if a cleared field did NOT reach the pipeline, the
    // first test would pass for the wrong reason (both blank because nothing was ever read).
    const priced = cleared({});                       // nothing cleared -> prices normally
    expect(isSuggestion(priced)).toBe(true);
    if (!isSuggestion(priced)) return;
    expect(priced.values.supply_rate).toBeGreaterThan(0);
    expect(priced.basis).not.toBe("Complete the missing attributes to price");
  });
});

// ---- SLICE 5 (B1, R-A): the blanker ITEM is DISPLAYED on its declared field ----
//
// The blanker is inferred from the effective count and NEVER selected by extraction (owner-locked),
// so `blank_item` was a required input that nothing read: three live rows showed "Complete the
// missing attributes to price" for a value the pipeline had already decided.
//
// ⚠️ `display_attr` IS NOT `bind_item`, AND THE SPLIT IS THE POINT. `bind_item` stays
// `blank_fit_item` -- a key that is deliberately NOT a declared attribute, so the component ref is
// STRUCTURALLY unable to resolve to the row's own extracted value. `display_attr` names the field
// the computed item is SHOWN on. Pointing `bind_item` at `blank_item` instead would have collapsed
// that structural guarantee into a behavioural one resting on resolution order.
function displayConfig(withDisplayAttr: boolean): RateCategoryConfig {
  const cloned = JSON.parse(JSON.stringify(arbitratedConfig())) as unknown as {
    attribute_definitions: Array<Record<string, unknown>>;
    pipelines: Record<string, { steps: Array<Record<string, unknown>> }>;
  };
  // The DECLARED field the computed blanker is shown on. The base fixture predates it, because
  // before this slice nothing displayed the item at all.
  cloned.attribute_definitions.push({
    id: "blank_item", label: "Blank plate", type: "choice",
    values: ["1M Blanker"], allow_none: true,
  });
  const mf = cloned.pipelines.probe_boq.steps[0] as { params: { blanks: Record<string, unknown> } };
  if (withDisplayAttr) mf.params.blanks.display_attr = "blank_item";
  return cloned as unknown as RateCategoryConfig;
}
function dispCompute(withDisplayAttr: boolean, over: Record<string, string | number | null> = {}) {
  const r = makePricingSheetHelper({
    configsByCategory: new Map([["mf_probe", displayConfig(withDisplayAttr)]]),
    items: PLATE_ITEMS,
    extractionByRow: buildExtractionByRow([{ excel_row: 1, attributes: mfAttrs(over) as never }]),
  }).compute(mfCtx(1));
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  return (id: string) => r.workings.attributes.find((a) => a.id === id);
}

describe("DERIVED DISPLAY -- the blanker ITEM (slice 5, B1 / R-A)", () => {
  it("POSITIVE: a POSITIVE count displays the blanker on the declared field", () => {
    // 3 modules occupied on a 6M plate -> 3 spare -> a blanker is priced, so the field must say so.
    const item = dispCompute(true, { plate_item: "6M", blank_qty: null })("blank_item");
    expect(item?.derived).toBe(true);
    expect(item?.derivedValue).toBe("1M Blanker");
    expect(attrDisplayValue(item!)).toBe("1M Blanker");
  });

  it("POSITIVE: it is NOT flagged missing -- no red border on a value the pipeline decided", () => {
    // This is the defect: three live rows refused to price over a field nothing ever read.
    expect(isAttrBlank(dispCompute(true, { plate_item: "6M", blank_qty: null })("blank_item")!)).toBe(false);
  });

  it("POSITIVE: it stays EDITABLE -- readOnly is never set, like the plate and unlike the qty", () => {
    const item = dispCompute(true, { plate_item: "6M", blank_qty: null })("blank_item");
    expect(item?.readOnly).toBeUndefined();
  });

  it("POSITIVE: a ZERO effective count displays the None sentinel, not a blanker", () => {
    // Editing the quantity to zero reverts the item to None -- the line reads as deliberately
    // absent rather than as a blanker bought zero times.
    const item = dispCompute(true, { plate_item: "6M", blank_qty: 0 })("blank_item");
    expect(item?.derivedValue).toBe("None");
  });

  it("POSITIVE: `value` is NOT overwritten -- a computed item stays distinguishable from a stated one", () => {
    const item = dispCompute(true, { plate_item: "6M", blank_qty: null })("blank_item");
    expect(item?.value).toBe("");
  });

  it("NEGATIVE (the vacuity control): WITHOUT `display_attr` nothing is published", () => {
    // Disabling the mechanism must restore the pre-slice-5 rendering exactly -- an empty field.
    // This is what makes the positives above evidence of the branch rather than of the fixture.
    const item = dispCompute(false, { plate_item: "6M", blank_qty: null })("blank_item");
    expect(item?.derivedValue).toBeUndefined();
  });

  it("NEGATIVE: with NO plate there are no blanks, so the field publishes nothing", () => {
    // An uncomputed value renders EMPTY, never a fabricated blanker -- the plate's rule exactly.
    const item = dispCompute(true, { plate_item: "None", blank_qty: null })("blank_item");
    expect(item?.derivedValue).toBeUndefined();
  });
});

// ---- SLICE 5 (B1 follow-on): a STATED blank_item beside a POSITIVE spare ----
//
// ⚠️ THE CASE THE FIRST SEVEN TESTS MISSED, AND WHY. They all left `blank_item` absent, so the
// display branch was only ever exercised on the blank path -- where `attrDisplayValue` has nothing to
// prefer. Live row BOQ-26-00174/188 supplied `blank_item: "None"` with NINE spare modules, and the
// panel showed "None" while the price it displayed included nine blankers. A green suite proved
// nothing about the one shape that mattered.
function statedBlankCompute(statedBlankItem: string | null, over: Record<string, string | number | null> = {}) {
  const r = makePricingSheetHelper({
    configsByCategory: new Map([["mf_probe", displayConfig(true)]]),
    items: PLATE_ITEMS,
    extractionByRow: buildExtractionByRow([
      { excel_row: 1, attributes: mfAttrs({ plate_item: "6M", blank_qty: null, blank_item: statedBlankItem, ...over }) as never },
    ]),
  }).compute(mfCtx(1));
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  return (id: string) => r.workings.attributes.find((a) => a.id === id);
}

describe("DERIVED DISPLAY -- a STATED blank_item against a POSITIVE spare (slice 5 follow-on)", () => {
  it("POSITIVE (the live 188 shape): a stated \"None\" is OVERRIDDEN by the computed blanker and MARKED", () => {
    // 3 occupied on a 6M plate -> 3 spare -> blankers ARE priced. The field must not keep saying None.
    const item = statedBlankCompute("None")("blank_item");
    expect(item?.derivedValue).toBe("1M Blanker");
    expect(attrDisplayValue(item!)).toBe("1M Blanker");
    expect(item?.substituted).toBe(true);
  });

  it("POSITIVE: a stated REAL value that disagrees is also overridden and marked", () => {
    // The pipeline's blanker is inferred from the count, so any disagreeing entry loses -- visibly.
    const item = statedBlankCompute("10A 1 WAY SWITCH")("blank_item");
    expect(attrDisplayValue(item!)).toBe("1M Blanker");
    expect(item?.substituted).toBe(true);
  });

  it("NEGATIVE: a stated value that AGREES is not marked -- the pipeline takes no credit for it", () => {
    const item = statedBlankCompute("1M Blanker")("blank_item");
    expect(attrDisplayValue(item!)).toBe("1M Blanker");
    expect(item?.substituted).toBeUndefined();
  });

  it("POSITIVE: a ZERO effective count overrides a stated blanker back to None, and marks it", () => {
    // Editing the quantity to zero reverts the item to None -- the boundary follows the EFFECTIVE
    // count, so a row still claiming a blanker must be corrected on screen too.
    const item = statedBlankCompute("1M Blanker", { blank_qty: 0 })("blank_item");
    expect(attrDisplayValue(item!)).toBe("None");
    expect(item?.substituted).toBe(true);
  });

  it("R9 UNTOUCHED: the quantity the pricer edits still wins and is still not read-only", () => {
    // The blanker ITEM is inferred; the blanker QUANTITY is the pricer's lever, and `module_fit`
    // genuinely reads it. This fix must not have quietly locked it.
    const qty = statedBlankCompute("None", { blank_qty: 2 })("blank_qty");
    expect(qty?.readOnly).toBeUndefined();
    expect(attrDisplayValue(qty!)).toBe("2");   // 2 <= 3 spare -> HONOURED
  });

  it("NEGATIVE (the vacuity control): WITHOUT display_attr nothing is published even when stated", () => {
    const r = makePricingSheetHelper({
      configsByCategory: new Map([["mf_probe", displayConfig(false)]]),
      items: PLATE_ITEMS,
      extractionByRow: buildExtractionByRow([
        { excel_row: 1, attributes: mfAttrs({ plate_item: "6M", blank_qty: null, blank_item: "None" }) as never },
      ]),
    }).compute(mfCtx(1));
    if (!isSuggestion(r)) throw new Error("expected a suggestion");
    const item = r.workings.attributes.find((a) => a.id === "blank_item");
    expect(item?.derivedValue).toBeUndefined();
    expect(item?.substituted).toBeUndefined();
  });
});
