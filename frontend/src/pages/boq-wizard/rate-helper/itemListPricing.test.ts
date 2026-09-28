// SLICE 5 (2026-09-24) -- ADP pricing: items, defaults, ladders, conversions, refusals. Owner rulings R1-R21.
//
// Every test below names the ruling it protects, positive AND negative. The figures are the owner's sheet figures
// (HVAC_BOQ_BCS PRICING, tab ADP, columns H / I) reproduced through the interpreter: ROUNDUP(cost x (1 + markup), 0)
// with the per-SKU markups 0.45 / 0.60 (R15). The model contributes only the facts; every default, ladder and
// conversion here is code over config, and the `defaulted` list is what slice 6 will render amber.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import HVAC_V7 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v7.json";
import HVAC_V6 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v6.json";
import ELECTRICAL_V63 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v63.json";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { runPipeline } from "../../pricing/rate-master/ratePipelineInterpreter";
import { isEligibleConfig } from "./pricingSheetHelper";
import {
  itemListPricingSpec,
  priceItemList,
  projectUnitClass,
  readNumber,
  splitSizePhrase,
  unitClassOf,
  unitFactorOf,
  type ExtractedListItem,
  type ItemListPricingSpec,
  type NumberReader,
} from "./itemListPricing";
import HVAC_V8 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v8.json";
import HVAC_V9 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v9.json";
import HVAC_V10 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v10.json";
import HVAC_V11 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v11.json";
import HVAC_V12 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v12.json";
import HVAC_V13 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v13.json";
import { familyChoices, itemFieldDefs, listSpecDefs } from "./itemListPricing";

type Asset = { discipline: string; items: RateMasterItem[]; category_configs: RateCategoryConfig[] };
const asset = HVAC_V7 as unknown as Asset;
const items: RateMasterItem[] = asset.items.map((i) => ({ ...i, discipline: "HVAC" }));
const adp = asset.category_configs.find((c) => c.category_id === "hvac_adp")!;
const spec = itemListPricingSpec(adp)!;

/** An extracted item as the run stores it: every value a string (the model writes text), null = could not tell. */
function ext(attrs: Record<string, string | null>): ExtractedListItem {
  const out: ExtractedListItem = { attributes: {} };
  for (const [k, v] of Object.entries(attrs)) out.attributes[k] = { value: v, confidence: 0.9 };
  return out;
}
const price = (unit: string, ...its: ExtractedListItem[]) => priceItemList(spec, items, unit, its);
const one = (unit: string, attrs: Record<string, string | null>) => price(unit, ext(attrs));
const figures = (r: ReturnType<typeof price>) => [r.priced, r.supply, r.install] as const;
const skuOf = (r: ReturnType<typeof price>, i = 0) => `${r.items[i].sku?.item_name} / ${r.items[i].sku?.item_detail}`;

describe("slice 5 / the block is read off the config and ADP stays NOT eligible (P8)", () => {
  it("v7 carries list_spec.pricing for 25 families, and neither eligibility predicate sees it", () => {
    expect(spec).not.toBeNull();
    expect(Object.keys(spec.families).length).toBe(25);
    expect(spec.kind).toBe("hvac_adp_item");
    // NEGATIVE (P8): pipelines still {}; the frontend eligibility predicate still says no
    expect(adp.pipelines).toEqual({});
    expect(isEligibleConfig(adp)).toBe(false);
    // NEGATIVE: a config without the block reads null; v6's ADP config has no block
    const adp6 = (HVAC_V6 as unknown as Asset).category_configs.find((c) => c.category_id === "hvac_adp")!;
    expect(itemListPricingSpec(adp6)).toBeNull();
    expect(itemListPricingSpec(null)).toBeNull();
  });
  it("SLICE 6 (T7, INVERTING the slice-5 P8 pin): the helper and the calculator import this module; the grid, the page and the plumbing still do not", () => {
    const dir = __dirname;
    // slice 5 pinned NO importer at all (ADP not eligible). Slice 6 wires the helper (the list path) and the
    // calculator (no placeholder blocks for a list-mode category) -- the two surfaces the owner asked for.
    expect(readFileSync(join(dir, "pricingSheetHelper.ts"), "utf8")).toMatch(/from "\.\/itemListPricing"/);
    expect(readFileSync(join(dir, "../../pricing/PricingCalculator.tsx"), "utf8")).toMatch(/itemListPricingSpec/);
    // NEGATIVE (kept): the arithmetic reaches the panel ONLY through the helper's suggestion -- the panel, the
    // grid, the page and the plumbing never call the module themselves
    for (const f of [join(dir, "RateHelperPanel.tsx"), join(dir, "rateHelperPlumbing.tsx"), join(dir, "../SheetPricingPage.tsx"), join(dir, "../PricingGrid.tsx")]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/from "\.\/itemListPricing"|from "@\/pages\/boq-wizard\/rate-helper\/itemListPricing"/);
    }
  });
  it("v7 = v6 + the block: items and the six other configs byte-identical, the ADP config equal once the block is set aside", () => {
    const v6 = HVAC_V6 as unknown as Asset;
    expect(asset.items).toEqual(v6.items);
    expect(asset.category_configs.slice(1)).toEqual(v6.category_configs.slice(1));
    const a7 = { ...adp } as Record<string, unknown>, a6 = { ...v6.category_configs[0] } as Record<string, unknown>;
    const ls7 = { ...(a7.list_spec as Record<string, unknown>) }, ls6 = { ...(a6.list_spec as Record<string, unknown>) };
    delete ls7.pricing;
    expect(ls7).toEqual(ls6);
    expect(String(a7.notes).startsWith(String(a6.notes))).toBe(true);
    delete a7.list_spec; delete a6.list_spec; delete a7.notes; delete a6.notes;
    expect(a7).toEqual(a6);
  });
});

describe("slice 5 / the projection is read-time and never writes back", () => {
  it("projects the unit CLASS into a COPY; the caller's items are untouched", () => {
    const before = JSON.stringify(items);
    const p = projectUnitClass(spec, items);
    expect(JSON.stringify(items)).toBe(before);
    const sqm = p.find((i) => i.unit === "SQM")!, nos = p.find((i) => i.unit === "Nos")!, rmt = p.find((i) => i.unit === "RMT")!;
    expect([sqm.attributes.unit_class, nos.attributes.unit_class, rmt.attributes.unit_class]).toEqual(["area", "count", "length"]);
    expect(items.every((i) => !("unit_class" in i.attributes))).toBe(true);
  });
});

describe("slice 5 / R12 -- the row's unit decides the unit class; no unit = refuse with the reason", () => {
  it("POSITIVE: the spellings seen on real BoQs classify", () => {
    for (const [u, c] of [["Nos", "count"], ["No.", "count"], ["No's", "count"], ["EA", "count"], ["Sqm", "area"], ["Sq.m", "area"], ["SqM", "area"], ["Sqmt", "area"], ["M2", "area"], ["m²", "area"], ["Rmt", "length"], ["RM", "length"], ["Metre", "length"], ["M", "length"]]) {
      expect(unitClassOf(spec, u)).toBe(c);
    }
  });
  it("NEGATIVE: no unit refuses the ROW naming R12; an unknown unit refuses naming the unit", () => {
    const r = one("", { family: "spigot", dia_mm: "100" });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("no unit on this row (R12)");
    expect(r.items).toEqual([]);
    expect(one("Lot", { family: "spigot", dia_mm: "100" }).reason).toBe("unit 'Lot' is not a count, area or length unit (R12)");
    expect(one("Cum", { family: "spigot", dia_mm: "100" }).reason).toContain("Cum");
  });
});

describe("slice 5 / R1 -- damper not mentioned = WITHOUT (collar, GI, hit-and-miss)", () => {
  it("POSITIVE: 'None' on damper prices the without-damper SKU and is MARKED defaulted with the rule", () => {
    const r = one("Nos", { family: "round diffuser", damper: "None", dia_mm: "200 mm" });
    expect(figures(r)).toEqual([true, 986, 400]);
    expect(skuOf(r)).toBe("Round Diffuser Without GI Damper / 200 MM DIA");
    expect(r.items[0].defaulted).toEqual([{ attr: "damper", value: "without", rule: "R1 damper not mentioned = without" }]);
    // the same rule on a hit-and-miss slot diffuser and a collar-damper square diffuser
    expect(figures(one("Rmt", { family: "slot diffuser", damper: "None", slot_count: "3 slot" }))).toEqual([true, 1682, 352]);
    expect(figures(one("Nos", { family: "square diffuser", damper: "None", neck_mm: "375 x 375" }))).toEqual([true, 1668, 400]);
  });
  it("NEGATIVE (R2): an ABSENT damper (could not tell) is NOT defaulted -- blank, with the reason", () => {
    const r = one("Nos", { family: "round diffuser", damper: null, dia_mm: "200 mm" });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("could not tell whether it is with or without a damper");
    expect(r.items[0].defaulted).toEqual([]);
  });
  it("NEGATIVE: a STATED damper is used as stated, never defaulted", () => {
    const r = one("Nos", { family: "round diffuser", damper: "with", dia_mm: "200 mm" });
    expect(figures(r)).toEqual([true, 1276, 400]);
    expect(r.items[0].defaulted).toEqual([]);
  });
});

describe("slice 5 / R2 -- the three states: stated / 'None' (not mentioned) / absent (could not tell)", () => {
  it("'None' takes the ruled default; absent prices nothing; stated is used as stated (UL on an actuator)", () => {
    expect(figures(one("Nos", { family: "actuator", ul: "None", torque: "8 NM" }))).toEqual([true, 9570, 800]);
    const absent = one("Nos", { family: "actuator", ul: null, torque: "8 NM" });
    expect(absent.priced).toBe(false);
    expect(absent.reason).toBe("could not tell whether it is UL listed");
    expect(figures(one("Nos", { family: "actuator", ul: "yes", torque: "8 NM" }))).toEqual([true, 23925, 800]);
  });
  it("NEGATIVE: an attribute the family is not keyed on never blocks, whatever its state (a stray null insulated on a spigot)", () => {
    expect(figures(one("Nos", { family: "spigot", dia_mm: "150", insulated: null, damper: null, ul: null }))).toEqual([true, 211, 64]);
  });
});

describe("slice 5 / R3 -- a grille whose type cannot be told prices as a LINEAR grille", () => {
  it("POSITIVE: 'grille, type not stated' prices the linear grille SKU and says so in the working", () => {
    const r = one("Sqm", { family: "grille, type not stated", damper: "None" });
    expect(figures(r)).toEqual([true, 4829, 880]);
    expect(r.items[0].family).toBe("linear grille");
    expect(r.items[0].familyRaw).toBe("grille, type not stated");
    expect(r.items[0].working).toContain("'grille, type not stated' prices as linear grille (R3)");
  });
  it("NEGATIVE: a stated grille type keeps its own family (curved stays curved, floor stays floor)", () => {
    expect(figures(one("Sqm", { family: "curved grille", damper: "None" }))).toEqual([true, 5510, 880]);
    expect(figures(one("Sqm", { family: "floor grille", damper: "with" }))).toEqual([true, 18343, 1920]);
  });
});

describe("slice 5 / R4 -- a per-metre grille: sq.m rate x height in metres; no height = blank", () => {
  it("POSITIVE: a linear grille per Rmt with a 300 mm height prices the per-sq.m SKU x 0.3, supply and install", () => {
    const r = one("Rmt", { family: "linear grille", damper: "None", face_h_mm: "300 mm" });
    // supply 3330 x 0.3 = 999 -> x1.45 = 1448.55 -> 1449; install 550 x 0.3 = 165 -> x1.6 = 264
    expect(figures(r)).toEqual([true, 1449, 264]);
    expect(r.items[0].conversion).toEqual({ rule: "R4 per-metre grille: per-sq.m rate x height in metres", to: "area" });
    expect(r.items[0].skuUnitClass).toBe("area");
  });
  it("NEGATIVE: no height = blank with the reason; a non-grille family per metre has no SKU and no conversion", () => {
    const r = one("Rmt", { family: "linear grille", damper: "None" });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("per-metre row: no height stated to convert the per-sq.m rate");
    const s = one("Rmt", { family: "sound attenuator", face_h_mm: "300" });
    expect(s.reason).toBe("no SKU per metre for sound attenuator");
  });
});

describe("slice 5 / R5 -- flexible duct not mentioned = INSULATED; unclear = blank", () => {
  it("POSITIVE: 'None' -> insulated, marked; stated 'without' -> un-insulated", () => {
    const r = one("Rmt", { family: "flexible duct", insulated: "None", dia_mm: "150 mm" });
    expect(figures(r)).toEqual([true, 450, 0]);
    expect(skuOf(r)).toBe("Insulated Flexible Duct / 150 MM DIA");
    expect(r.items[0].defaulted[0]).toMatchObject({ attr: "insulated", value: "with" });
    expect(figures(one("Rmt", { family: "flexible duct", insulated: "without", dia_mm: "150 mm" }))).toEqual([true, 174, 0]);
  });
  it("NEGATIVE: could-not-tell insulation = blank", () => {
    const r = one("Rmt", { family: "flexible duct", insulated: null, dia_mm: "150 mm" });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("could not tell whether it is insulated");
  });
});

describe("slice 5 / R6 -- ladders: next size up; above the largest = refuse; a range = its top; several = blank; neck not outer", () => {
  it("POSITIVE: an off-ladder diameter takes the NEXT size up and the hop is recorded", () => {
    const r = one("Nos", { family: "butterfly damper", dia_mm: "180 mm" });
    expect(figures(r)).toEqual([true, 1015, 0]);
    expect(skuOf(r)).toBe("Butterfly Damper With SPIGOT / 200 MM DIA");
    expect(r.items[0].ladderHops).toEqual([{ attr: "dia_mm", name: "diameter", requested: 180, fitted: 200, exact: false }]);
    expect(r.items[0].working).toContain("diameter 180 is not on the sheet -> 200 (next size up, R6)");
    // an exact hit records no hop wording
    const e = one("Nos", { family: "butterfly damper", dia_mm: "200 mm" });
    expect(e.items[0].ladderHops[0].exact).toBe(true);
    expect(e.items[0].working.some((w) => w.includes("next size up"))).toBe(false);
  });
  it("NEGATIVE: above the largest size on the sheet = refuse, naming the largest -- never the largest SKU", () => {
    const r = one("Nos", { family: "spigot", dia_mm: "400 mm" });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("diameter 400 is above the largest size on the sheet (350)");
    const n = one("Nos", { family: "square diffuser", damper: "with", neck_mm: "525x 525" });
    expect(n.reason).toBe("neck size 525 is above the largest size on the sheet (450)");
  });
  it("POSITIVE: a RANGE uses its top value, then the ladder", () => {
    const r = one("Nos", { family: "actuator", ul: "None", torque: "10-12 NM" });
    // top 12 -> non-UL ladder 6 / 8 / 10 / 20 -> 20
    expect(figures(r)).toEqual([true, 15660, 800]);
    expect(r.items[0].ladderHops).toEqual([{ attr: "torque_nm", name: "torque", requested: 12, fitted: 20, exact: false }]);
    expect(r.items[0].working.some((w) => w.includes("range '10-12 NM' -> its top value 12 (R6)"))).toBe(true);
    expect(figures(one("Nos", { family: "actuator", ul: "None", torque: "8 to 10 Nm" }))).toEqual([true, 13050, 800]);
  });
  it("NEGATIVE: SEVERAL values = blank (a list is not a range) -- the '9/10 NM' half INVERTED by slice 11", () => {
    for (const t of ["4, 8, 10 N-M", "3.5, 7.9 & 15.9 NM"]) {
      const r = one("Nos", { family: "actuator", ul: "None", torque: t });
      expect(r.priced).toBe(false);
      expect(r.reason).toBe(`several values stated for torque ('${t}')`);
    }
    // SLICE 11 (owner "take the higher value"): a SLASH PAIR is an ALTERNATIVE, not a list. "9/10 NM" was
    // pinned here as priced === false with "several values stated for torque ('9/10 NM')"; it now reads 10.
    // The two COMMA lists above keep the negative half -- a list is still not a pair and still refuses.
    const pair = one("Nos", { family: "actuator", ul: "None", torque: "9/10 NM" });
    expect([pair.priced, pair.supply]).toEqual([true, 13050]);
  });
  it("POSITIVE: a diffuser matches on its NECK; the stated OUTER size never enters the match", () => {
    const r = one("Nos", { family: "square diffuser", damper: "with", neck_mm: "300 x 300", face_w_mm: "600", face_h_mm: "600" });
    expect(figures(r)).toEqual([true, 1972, 576]);
    expect(skuOf(r)).toBe("Diffuser With Al Collar Damper / NECK:300X300/OUTER: 595X595");
    expect(r.items[0].selection).toEqual({ family: "square diffuser", unit_class: "count", damper: "with", neck_mm: 300 });
    // an off-ladder neck steps up
    expect(figures(one("Nos", { family: "square diffuser", damper: "with", neck_mm: "325 x 325" }))).toEqual([true, 2248, 576]);
  });
  it("NEGATIVE: an outer size alone is NOT a neck -- blank (R8), never matched on the outer size", () => {
    const r = one("Nos", { family: "square diffuser", damper: "with", face_w_mm: "595", face_h_mm: "595" });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("no neck size stated");
    const rect = one("Nos", { family: "square diffuser", damper: "with", neck_mm: "300 x 450" });
    expect(rect.reason).toBe("neck size '300 x 450' is not a single square size");
  });
});

describe("slice 5 / R7 -- torque not mentioned = blank, no default", () => {
  it("POSITIVE: a stated torque prices; NEGATIVE: none stated = blank naming torque", () => {
    expect(figures(one("Nos", { family: "actuator", ul: "yes", torque: "3.5 NM" }))).toEqual([true, 21460, 800]);
    const r = one("Nos", { family: "actuator", ul: "yes", torque: null });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("no torque stated");
    expect(one("Nos", { family: "actuator", ul: "yes", torque: "None" }).reason).toBe("no torque stated");
  });
});

describe("slice 5 / R8 -- panel ratio, diameter, neck, slot count missing = blank; no ADP kind = blank", () => {
  it("each missing key names itself; a missing family is 'no ADP kind'", () => {
    expect(one("Nos", { family: "control panel" }).reason).toBe("no panel ratio stated");
    expect(one("Nos", { family: "round diffuser", damper: "with" }).reason).toBe("no diameter stated");
    expect(one("Nos", { family: "square diffuser", damper: "with" }).reason).toBe("no neck size stated");
    expect(one("Rmt", { family: "slot diffuser", damper: "with" }).reason).toBe("no slot count stated");
    expect(one("Nos", { family: null, dia_mm: "200" }).reason).toBe("no ADP kind could be told for this item");
  });
  it("NEGATIVE: with the key present each prices (the same rows, keyed)", () => {
    expect(one("Nos", { family: "control panel", panel_ratio: "1:4" }).priced).toBe(true);
    expect(one("Nos", { family: "round diffuser", damper: "with", dia_mm: "250" }).priced).toBe(true);
    expect(one("Rmt", { family: "slot diffuser", damper: "with", slot_count: "2 slot" }).priced).toBe(true);
  });
});

describe("slice 5 / R9 -- a plenum with no thickness = blank", () => {
  it("POSITIVE: the insulation thickness keys the double-skin plenum ladder (25 / 50); a range takes its top then steps up", () => {
    expect(figures(one("Sqm", { family: "double-skin plenum", insulation_thickness_mm: "25mm" }))).toEqual([true, 4785, 640]);
    expect(figures(one("Sqm", { family: "double-skin plenum", insulation_thickness_mm: "40-45mm" }))).toEqual([true, 5655, 640]);
    expect(figures(one("Sqm", { family: "double-skin plenum", thickness_mm: "50 mm thick" }))).toEqual([true, 5655, 640]);
  });
  it("NEGATIVE: no thickness = blank; a sheet GAUGE is not a thickness (token or a sub-5 mm figure)", () => {
    expect(one("Sqm", { family: "double-skin plenum" }).reason).toBe("no plenum thickness stated");
    expect(one("Sqm", { family: "double-skin plenum", thickness_mm: "26 GI" }).reason).toBe("plenum thickness stated as '26 GI' -- a gauge, not a thickness");
    expect(one("Sqm", { family: "double-skin plenum", thickness_mm: "20G" }).reason).toContain("a gauge, not a thickness");
    expect(one("Sqm", { family: "double-skin plenum", thickness_mm: "0.8mm" }).reason).toContain("below 5 mm");
  });
});

describe("slice 5 / R10 -- a damper with no type = blank (VCD / fire damper variant could not be told)", () => {
  it("NEGATIVE: an absent variant is blank; POSITIVE: a stated variant prices", () => {
    expect(one("Sqm", { family: "VCD", variant: null }).reason).toBe("could not tell the damper type");
    expect(one("Sqm", { family: "fire damper", variant: null, ul: "no" }).reason).toBe("could not tell the damper type");
    expect(figures(one("Sqm", { family: "VCD", variant: "GI oval" }))).toEqual([true, 10005, 1920]);
    expect(figures(one("Sqm", { family: "VCD", variant: "motorised" }))).toEqual([true, 12325, 1920]);
  });
});

describe("slice 5 / R11 -- a per-number row with W x H: sq.m rate x area, supply AND install; no size = blank", () => {
  it("POSITIVE: a VCD per Nos at 600 x 600 prices the per-sq.m SKU x 0.36 on both sides, conversion recorded", () => {
    const r = one("Nos", { family: "VCD", variant: "None", face_w_mm: "600", face_h_mm: "600 mm" });
    // supply 5400 x 0.36 = 1944 -> x1.45 = 2818.8 -> 2819; install 1200 x 0.36 = 432 -> x1.6 = 691.2 -> 692
    expect(figures(r)).toEqual([true, 2819, 692]);
    expect(r.items[0].conversion).toEqual({ rule: "R11 per-number row: per-sq.m rate x W x H", to: "area" });
    expect(r.items[0].working.some((w) => w.includes("W x H"))).toBe(true);
    // a width written in metres is read into mm
    const m = one("Nos", { family: "VCD", variant: "None", face_w_mm: "1.2m (L)", face_h_mm: "300" });
    expect(m.items[0].selection.face_w_mm).toBe(1200);
    expect(m.items[0].working).toContain("width: 1.2 m read as 1200 mm");
  });
  it("NEGATIVE: no size = blank with the reason; a family with its own per-number rows never converts", () => {
    const r = one("Nos", { family: "VCD", variant: "None" });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("per-number row: no width and height, or area stated to convert the per-sq.m rate");
    const sq = one("Nos", { family: "square diffuser", damper: "with", neck_mm: "450x450" });
    expect(sq.items[0].conversion).toBeNull();
    expect(figures(sq)).toEqual([true, 2523, 576]);
  });
});

describe("slice 5 / R13 -- 'supply air' = with damper on LINEAR and PLAIN grilles only; an explicit damper word wins", () => {
  it("POSITIVE: a linear grille, damper not mentioned, supply air -> with damper, marked with the R13 rule", () => {
    const r = one("Sqm", { family: "linear grille", damper: "None", air: "supply" });
    expect(figures(r)).toEqual([true, 9628, 2800]);
    expect(r.items[0].defaulted).toEqual([{ attr: "damper", value: "with", rule: "R13 supply-air linear / plain grille = with damper" }]);
    // the untyped grille prices as linear (R3), so R13 reaches it too
    expect(figures(one("Sqm", { family: "grille, type not stated", damper: "None", air: "supply" }))).toEqual([true, 9628, 2800]);
  });
  it("NEGATIVE: an explicit 'without' beats supply air; a curved grille ignores it; return air stays without", () => {
    expect(figures(one("Sqm", { family: "linear grille", damper: "without", air: "supply" }))).toEqual([true, 4829, 880]);
    expect(figures(one("Sqm", { family: "curved grille", damper: "None", air: "supply" }))).toEqual([true, 5510, 880]);
    expect(figures(one("Sqm", { family: "linear grille", damper: "None", air: "return" }))).toEqual([true, 4829, 880]);
    expect(figures(one("Sqm", { family: "linear grille", damper: "None", air: null }))).toEqual([true, 4829, 880]);
  });
});

describe("slice 5 / R14 -- the four silent defaults: VCD GI rectangular; fire damper without sleeve; UL = non-UL; mixing box with insulation", () => {
  it("each 'None' takes its default and is marked; a stated value wins", () => {
    const vcd = one("Sqm", { family: "VCD", variant: "None" });
    expect(figures(vcd)).toEqual([true, 7830, 1920]);
    expect(vcd.items[0].defaulted).toEqual([{ attr: "variant", value: "GI rectangular", rule: "R14 VCD = GI rectangular; fire damper = without sleeve" }]);
    const fd = one("Sqm", { family: "fire damper", variant: "None", ul: "None" });
    expect(figures(fd)).toEqual([true, 14138, 1920]);
    expect(fd.items[0].defaulted.map((d) => `${d.attr}=${d.value}`).sort()).toEqual(["ul=no", "variant=without sleeve"]);
    const act = one("Nos", { family: "actuator", ul: "None", torque: "20 NM" });
    expect(figures(act)).toEqual([true, 15660, 800]);
    expect(act.items[0].defaulted).toEqual([{ attr: "ul", value: "no", rule: "R14 UL not mentioned = non-UL" }]);
    const mb = one("Sqm", { family: "mixing box / LP plenum", insulated: "None" });
    expect(figures(mb)).toEqual([true, 1784, 0]);
    expect(mb.items[0].defaulted[0]).toMatchObject({ attr: "insulated", value: "with" });
    // NEGATIVE: stated wins on each
    expect(figures(one("Sqm", { family: "fire damper", variant: "UL", ul: "yes" }))).toEqual([true, 21750, 1920]);
    expect(figures(one("Sqm", { family: "fire damper", variant: "with sleeve", ul: "no" }))).toEqual([true, 20880, 1920]);
    expect(figures(one("Nos", { family: "actuator", ul: "yes", torque: "20 NM" }))).toEqual([true, 26100, 800]);
    expect(figures(one("Sqm", { family: "mixing box / LP plenum", insulated: "without" }))).toEqual([true, 1276, 0]);
  });
});

describe("slice 5 / R15 -- price = ROUNDUP(cost x (1 + that item's markup), 0), supply and install separately", () => {
  it("exact rupee figures, including the ROUNDUP on a .5 (950 x 1.45 = 1377.5 -> 1378)", () => {
    expect(figures(one("Nos", { family: "round diffuser", damper: "with", dia_mm: "250" }))).toEqual([true, 1378, 400]);
    expect(figures(one("Sqm", { family: "VCD", variant: "GI oval" }))).toEqual([true, 10005, 1920]);
    expect(figures(one("Nos", { family: "disc valve", dia_mm: "100MM DIA" }))).toEqual([true, 551, 176]);
    // the markups come off the SKU (m_from_ctx), not a constant: change one and the figure follows
    const bumped = items.map((i) => (i.attributes.item_detail === "100MM DIA" && i.attributes.family === "disc valve" ? { ...i, rates: { ...i.rates, supply_markup: 0.5 } } : i));
    const r = priceItemList(spec, bumped, "Nos", [ext({ family: "disc valve", dia_mm: "100" })]);
    expect(figures(r)).toEqual([true, 570, 176]);
  });
});

describe("slice 5 / R16 -- an area band: per-sq.m rate x the band's MAXIMUM area", () => {
  it("POSITIVE: 'up to 0.5 sqm' -> 0.5; '1.1 to 2.0 sqm' -> 2.0; a stated W x H is preferred when both are given", () => {
    const r = one("Nos", { family: "VCD", variant: "None", area_band: "Up to 0.5 Sqmt" });
    expect(figures(r)).toEqual([true, 3915, 960]);
    expect(r.items[0].conversion?.rule).toBe("R16 area band: per-sq.m rate x the band's maximum area");
    expect(figures(one("Nos", { family: "fire damper", variant: "None", ul: "None", area_band: "1.1 to 2.0 sqm" }))).toEqual([true, 28275, 3840]);
    const both = one("Nos", { family: "VCD", variant: "None", face_w_mm: "600", face_h_mm: "600", area_band: "up to 1 sqm" });
    expect(both.items[0].conversion?.rule).toContain("R11");
  });
  it("NEGATIVE: a band in square feet is not an area the sheet prices; no band and no size = blank", () => {
    expect(one("Nos", { family: "VCD", variant: "None", area_band: "up to 5 sq.ft" }).reason).toBe("area stated in square feet ('up to 5 sq.ft')");
    expect(one("Nos", { family: "VCD", variant: "None", area_band: null }).priced).toBe(false);
  });
});

describe("slice 5 / R17 -- 'maximum 6 outgoing feeders' maps to the 1:6 panel", () => {
  it("POSITIVE: a feeder count is the ratio; '1:N' reads the same; an off-ladder count steps up", () => {
    expect(figures(one("Nos", { family: "control panel", panel_ratio: "maximum 6 outgoing feeders" }))).toEqual([true, 16791, 800]);
    expect(figures(one("Nos", { family: "control panel", panel_ratio: "1:6" }))).toEqual([true, 16791, 800]);
    expect(figures(one("Nos", { family: "control panel", panel_ratio: "1:4" }))).toEqual([true, 12905, 800]);
    const up = one("Nos", { family: "control panel", panel_ratio: "8 actuators/panel" });
    expect(figures(up)).toEqual([true, 20300, 800]);
    expect(up.items[0].ladderHops[0]).toMatchObject({ requested: 8, fitted: 12 });
    expect(figures(one("Nos", { family: "control panel", panel_ratio: "8-10 actuators/panel" }))).toEqual([true, 20300, 800]);
  });
  it("NEGATIVE: several stated ratios = blank; above the largest = refuse -- the '10/12 Module' half INVERTED by slice 11", () => {
    // SLICE 11: this line read .reason).toBe("several values stated for panel ratio ('10/12 Module')").
    // A slash pair is an alternative and takes the higher, so the row now prices on the 1:12 panel.
    const pair = one("Nos", { family: "control panel", panel_ratio: "10/12 Module" });
    expect([pair.priced, pair.supply]).toEqual([true, 20300]);
    expect(one("Nos", { family: "control panel", panel_ratio: "1:16" }).reason).toBe("panel ratio 16 is above the largest size on the sheet (12)");
    // NEGATIVE kept: FOUR values are not a pair, and still refuse by name
    expect(one("Nos", { family: "control panel", panel_ratio: "4 / 8 / 10/ 12" }).reason).toContain("several values stated for panel ratio");
  });
});

describe("slice 5 / R18 -- no SKU in the catalogue = blank; two closed-list values with no SKU for the pair = blank", () => {
  it("'none of these' is blank for the user to decide; a pair the sheet does not stock is blank naming the pair", () => {
    const r = one("Nos", { family: "none of these", dia_mm: "200" });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("no SKU in the catalogue for 'none of these' -- the user decides (R18)");
    const pair = one("Sqm", { family: "fire damper", variant: "with sleeve", ul: "yes" });
    expect(pair.priced).toBe(false);
    expect(pair.reason).toBe("no SKU for this combination (fire damper: variant with sleeve, ul yes)");
    const slots = one("Rmt", { family: "slot diffuser", damper: "without", slot_count: "4 slot" });
    expect(slots.reason).toBe("no SKU for this combination (slot diffuser: damper without, slot count 4)");
  });
  it("NEGATIVE: the stocked pair prices", () => {
    expect(figures(one("Sqm", { family: "fire damper", variant: "UL", ul: "yes" }))).toEqual([true, 21750, 1920]);
  });
});

describe("slice 5 / R19 + R21 -- a composite row prices each item on its own and sums; one blank item blanks the ROW", () => {
  it("POSITIVE (R19): actuator + control panel on one row = two SKUs, summed", () => {
    const r = price("Nos", ext({ family: "actuator", ul: "None", torque: "8 NM" }), ext({ family: "control panel", panel_ratio: "1:6" }));
    expect(figures(r)).toEqual([true, 9570 + 16791, 800 + 800]);
    expect(r.items.map((i) => i.state)).toEqual(["priced", "priced"]);
    expect(r.items.map((i) => i.finals.supply)).toEqual([9570, 16791]);
  });
  it("NEGATIVE (R21): the second item cannot price -> the row shows no price, but item 1 still reports its own figures", () => {
    const r = price("Nos", ext({ family: "actuator", ul: "None", torque: "8 NM" }), ext({ family: "control panel", panel_ratio: null }));
    expect(r.priced).toBe(false);
    expect(r.supply).toBeUndefined();
    expect(r.reason).toBe("item 2 (control panel): no panel ratio stated");
    expect(r.items[0]).toMatchObject({ state: "priced", finals: { supply: 9570, install: 800 } });
    expect(r.items[1]).toMatchObject({ state: "blank", reason: "no panel ratio stated" });
    // a single-item row's reason carries no item prefix
    expect(one("Nos", { family: "control panel", panel_ratio: null }).reason).toBe("no panel ratio stated");
    // NEGATIVE: an empty list is its own honest state
    expect(price("Nos").reason).toBe("no items were read on this row");
  });
});

describe("slice 5 / R20 -- derived items keep their formulas and follow a CSV edit to the base row", () => {
  it("POSITIVE: the six cross-talk sizes and the two 750x150x350 mixing boxes reproduce the sheet", () => {
    for (const [w, h, s, i] of [[200, 200, 557, 192], [250, 250, 696, 240], [300, 300, 836, 288], [350, 350, 975, 336], [650, 250, 1253, 432], [500, 250, 1044, 360]]) {
      expect(figures(one("Nos", { family: "cross-talk", face_w_mm: `${w} mm`, face_h_mm: `${h} mm` }))).toEqual([true, s, i]);
    }
    const mb = one("Nos", { family: "mixing box / LP plenum", insulated: "without", face_w_mm: "750", face_h_mm: "150", depth_mm: "350" });
    expect(figures(mb)).toEqual([true, 1310, 0]);
    expect(mb.items[0].working.some((w) => w.includes("sheet formula"))).toBe(true);
    // insulation not mentioned = WITH (R14), so 'None' lands on the insulated derived box
    expect(figures(one("Nos", { family: "mixing box / LP plenum", insulated: "None", face_w_mm: "750", face_h_mm: "150", depth_mm: "350" }))).toEqual([true, 1743, 0]);
  });
  it("POSITIVE: change the base row's cost and the derived price FOLLOWS (a CSV edit flows through)", () => {
    const edited = items.map((i) => {
      const fam = i.attributes.family;
      if (fam === "cross-talk" && i.unit === "SQM") return { ...i, rates: { ...i.rates, cost_supply: 2000 } };
      if (fam === "mixing box / LP plenum" && i.unit === "SQM" && i.attributes.insulated === "without") return { ...i, rates: { ...i.rates, cost_supply: 1000 } };
      return i;
    });
    // 2 x (200 + 200) x 300 / 10^6 x 2000 = 480 -> x1.45 = 696; install unchanged (base install 500 untouched)
    expect(figures(priceItemList(spec, edited, "Nos", [ext({ family: "cross-talk", face_w_mm: "200", face_h_mm: "200" })]))).toEqual([true, 696, 192]);
    // 1000 x 0.855 + 150 = 1005 -> x1.45 = 1457.25 -> 1458
    expect(figures(priceItemList(spec, edited, "Nos", [ext({ family: "mixing box / LP plenum", insulated: "without", face_w_mm: "750", face_h_mm: "150", depth_mm: "350" })]))).toEqual([true, 1458, 0]);
  });
  it("NEGATIVE: a size the sheet does not derive is blank (never a geometry guess); the base row itself prices per sq.m", () => {
    const r = one("Nos", { family: "cross-talk", face_w_mm: "400", face_h_mm: "300" });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("no SKU for this combination (cross-talk: width 400, height 300)");
    expect(figures(one("Sqm", { family: "cross-talk" }))).toEqual([true, 2320, 800]);
  });
});

describe("slice 5 / the number reader (R6 / R16 / R17 in code, never in the prompt)", () => {
  const mm = spec.numbers.dia_mm, torque = spec.numbers.torque_nm, ratio = spec.numbers.panel_ratio, area = spec.numbers.area_sqm;
  it("reads the real corpus spellings", () => {
    expect(readNumber("200mm", mm)).toEqual({ value: 200 });
    expect(readNumber("150 mm dia", mm)).toEqual({ value: 150 });
    expect(readNumber("Dia 110", mm)).toEqual({ value: 110 });
    expect(readNumber("10NM (up to 1.6 sqm)", torque)).toEqual({ value: 10 });
    expect(readNumber("1100(W)", mm)).toEqual({ value: 1100 });
    expect(readNumber("up to 3.2sqm", area)).toEqual({ value: 3.2 });
    expect(readNumber("up to 5 Nos of dampers", ratio)).toEqual({ value: 5 });
    expect(readNumber("3 Slot", spec.numbers.slot_count)).toEqual({ value: 3 });
    expect(readNumber(300, mm)).toEqual({ value: 300 });
  });
  it("NEGATIVE: not stated is null; the unusable forms carry their reason", () => {
    expect(readNumber(null, mm)).toBeNull();
    expect(readNumber("", mm)).toBeNull();
    expect(readNumber("None", mm)).toBeNull();
    expect(readNumber("as per drawing", mm)).toEqual({ blank: "no number in 'as per drawing' for diameter" });
    expect(readNumber("300 x 300 x 450 mm Height", spec.numbers.neck_mm)).toEqual({ blank: "neck size '300 x 300 x 450 mm Height' is not a single square size" });
    expect(readNumber("100, 150, 200 mm", mm)).toEqual({ blank: "several values stated for diameter ('100, 150, 200 mm')" });
    // SLICE 11: this line pinned { blank: "several values stated for height ('350/400')" }. A slash pair is
    // an alternative; the higher is taken and the note says so. The comma list above keeps the negative.
    expect(readNumber("350/400", spec.numbers.face_h_mm)).toEqual({ value: 400, note: "'350/400' states two values -- the higher, 400, is taken" });
    expect(readNumber("8 inch", mm)).toEqual({ blank: "diameter stated in inches ('8 inch')" });
    expect(readNumber("upto 4(For Small critical room) / 8 / 10/ 12", ratio)).toEqual({ blank: "several values stated for panel ratio ('upto 4(For Small critical room) / 8 / 10/ 12')" });
  });
});

describe("slice 5 / the 95 catalogue SKUs each price to the sheet's own BoQ figure through the interpreter (the slice 1b check)", () => {
  // tab ADP, columns H / I as read on 2026-09-23; rows 34 / 38 / 94 carry the owner's R-e costs (slice 1b), row 9's
  // install cell holds the text 'would' on the sheet and is pinned as ROUNDUP(500 x 1.6) exactly as test_h02 does.
  const SHEET: Array<[number, string, number, number]> = [
    [2, "SQM", 7830, 1920], [3, "SQM", 10005, 1920], [4, "SQM", 12325, 1920], [5, "SQM", 20880, 1920], [6, "SQM", 14138, 1920],
    [7, "SQM", 12470, 1920], [8, "SQM", 21750, 1920], [9, "Nos", 26100, 800], [10, "Nos", 23925, 800], [11, "Nos", 21460, 800],
    [12, "Nos", 15660, 800], [13, "Nos", 13050, 800], [14, "Nos", 9570, 800], [15, "Nos", 8410, 800], [16, "Nos", 20300, 800],
    [17, "Nos", 16791, 800], [18, "Nos", 12905, 800], [19, "SQM", 4829, 880], [20, "SQM", 9628, 2800], [21, "SQM", 10730, 2800],
    [22, "SQM", 5510, 880], [23, "SQM", 7250, 2800], [24, "SQM", 8918, 2800], [25, "Rmt", 1465, 352], [26, "Rmt", 1160, 352],
    [27, "Rmt", 2204, 352], [28, "Rmt", 1682, 352], [29, "SQM", 12992, 2864], [30, "Nos", 1972, 576], [31, "Nos", 2248, 576],
    [32, "Nos", 2523, 576], [33, "Nos", 2755, 576], [34, "SQM", 7685, 1600], [35, "Nos", 1532, 400], [36, "Nos", 1668, 400],
    [37, "Nos", 1813, 400], [38, "SQM", 5075, 1120], [39, "Nos", 1603, 400], [40, "Nos", 1450, 400], [41, "Nos", 1378, 400],
    [42, "Nos", 1276, 400], [43, "Nos", 1059, 400], [44, "Nos", 1044, 400], [45, "Nos", 1015, 400], [46, "Nos", 986, 400],
    [47, "Nos", 334, 0], [48, "Nos", 725, 0], [49, "Nos", 1015, 0], [50, "Nos", 1305, 0], [51, "Nos", 1595, 0], [52, "Nos", 1885, 0],
    [53, "RMT", 160, 0], [54, "RMT", 450, 0], [55, "RMT", 595, 0], [56, "RMT", 740, 0], [57, "RMT", 885, 0], [58, "RMT", 1030, 0],
    [59, "RMT", 131, 0], [60, "RMT", 174, 0], [61, "RMT", 218, 0], [62, "RMT", 261, 0], [63, "RMT", 305, 0], [64, "RMT", 348, 0],
    [65, "Nos", 551, 176], [66, "Nos", 653, 176], [67, "SQM", 6888, 1600], [68, "SQM", 5220, 800], [69, "SQM", 6235, 2880],
    [70, "SQM", 4785, 640], [71, "SQM", 5655, 640], [72, "SQM", 18343, 1920], [73, "SQM", 13775, 1920], [74, "Nos", 189, 64],
    [75, "Nos", 211, 64], [76, "Nos", 232, 64], [77, "Nos", 254, 64], [78, "Nos", 276, 64], [79, "Nos", 298, 64],
    [80, "SQM/RMT/NOS", 1450, 1280], [81, "Nos", 557, 192], [82, "Nos", 696, 240], [83, "Nos", 836, 288], [84, "Nos", 975, 336],
    [85, "Nos", 1253, 432], [86, "Nos", 1044, 360], [87, "SQM", 2320, 800], [88, "SQM", 1276, 0], [89, "Nos", 1310, 0],
    [90, "SQM", 1784, 0], [91, "Nos", 1743, 0], [92, "Nos", 3045, 640], [93, "Nos", 3698, 640], [94, "Nos", 8700, 1280],
  ];
  const sheet = new Map(SHEET.map(([row, , s, i]) => [row, [s, i] as const]));
  it("94 of 95 exact; row 33 (the 1200 x 300 diffuser, which carries no neck) is BLANK by R6 + R8, not mis-priced", () => {
    const adpItems = items.filter((i) => i.kind === spec.kind);
    expect(adpItems.length).toBe(95);
    let exact = 0; const blanks: string[] = []; const wrong: string[] = [];
    for (const it of adpItems) {
      const row = (it as unknown as { source: { row: number } }).source.row;
      const attrs: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(it.attributes)) {
        if (k === "item_name" || k === "item_detail") continue;
        attrs[k === "torque_nm" ? "torque" : k] = typeof v === "number" ? String(v) : String(v);
      }
      const r = priceItemList(spec, items, it.unit ?? "", [ext(attrs)]);
      const [s, i] = sheet.get(row)!;
      if (r.priced && r.supply === s && r.install === i) exact++;
      else if (!r.priced) blanks.push(`${row}: ${r.reason}`);
      else wrong.push(`${row}: ${r.supply}/${r.install} != ${s}/${i}`);
    }
    expect(wrong).toEqual([]);
    expect(blanks).toEqual(["33: no neck size stated"]);
    expect(exact).toBe(94);
  });
});

describe("slice 5 / every existing Electrical pipeline result is UNCHANGED (the interpreter is untouched)", () => {
  it("the 34 Electrical goldens through runPipeline hash to the pre-slice value", () => {
    const e = ELECTRICAL_V63 as unknown as Asset;
    const eItems = e.items.map((i) => ({ ...i, discipline: "Electrical" }));
    const lines: string[] = [];
    for (const c of e.category_configs) {
      for (const g of ((c as unknown as { goldens?: Array<{ id: string; attrs: Record<string, string | number> }> }).goldens) ?? []) {
        for (const [pid, pl] of Object.entries(c.pipelines)) {
          const r = runPipeline(pid, pl, eItems, g.attrs);
          lines.push(JSON.stringify([c.category_id, g.id, pid, r.status, r.finals, r.steps.map((s) => [s.step, s.label, s.matchedCondition ?? null, s.produced ?? null])]));
        }
      }
    }
    expect(lines.length).toBe(91);
    // measured BEFORE this slice touched the tree (2026-09-23, the untracked P9 harness in `electrical` mode)
    expect(createHash("sha256").update(lines.join("\n")).digest("hex")).toBe("de5f4348fc8422cc407dd67ae5bcb8ec0939846bbf697955880f4fab48189fc8");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 6 (2026-09-24, owner S6 / S7 / T4 / T7) -- HVAC v8: the eligibility switch, UL absent = not mentioned,
// the mixing box at any size, the quantity per row unit, the panel-facing helpers.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

const asset8 = HVAC_V8 as unknown as Asset;
const items8: RateMasterItem[] = asset8.items.map((i) => ({ ...i, discipline: "HVAC" }));
const adp8 = asset8.category_configs.find((c) => c.category_id === "hvac_adp")!;
const spec8 = itemListPricingSpec(adp8)!;
const price8 = (unit: string, ...its: ExtractedListItem[]) => priceItemList(spec8, items8, unit, its);
const one8 = (unit: string, attrs: Record<string, string | null>) => price8(unit, ext(attrs));

describe("slice 6 / v8 = v7 + the four deltas, and NOTHING else", () => {
  it("items and the six other configs byte-identical; the ADP config differs ONLY in pipelines, second_opinion, ul's default, the mixing-box block and the dropped plain-block pipelines", () => {
    expect(asset8.items).toEqual(asset.items);
    expect(asset8.category_configs.slice(1)).toEqual(asset.category_configs.slice(1));
    // T7: the shared per-item default lives in `pipelines` (the eligibility switch)
    expect(Object.keys(adp8.pipelines)).toEqual(["item_supply", "item_install"]);
    expect(adp8.pipelines.item_supply.steps.map((s) => (s as { step: string }).step)).toEqual(["match_master_row", "scale", "roundup"]);
    // S8: the second opinion is OFF
    expect((adp8 as unknown as { list_spec: { second_opinion: boolean } }).list_spec.second_opinion).toBe(false);
    expect((adp as unknown as { list_spec: { second_opinion: boolean } }).list_spec.second_opinion).toBe(true);   // v7 stays as it was
    // S6: UL only
    expect(spec8.defaults!.ul.absent_as_none).toBe(true);
    expect(spec8.defaults!.damper.absent_as_none).toBeUndefined();
    expect(spec8.defaults!.insulated.absent_as_none).toBeUndefined();
    expect(spec8.defaults!.variant.absent_as_none).toBeUndefined();
    // S7: the mixing box prices per number by CONVERSION from its per-sq.m rows
    const mb = spec8.families["mixing box / LP plenum"];
    expect(Object.keys(mb.units)).toEqual(["area"]);
    expect(mb.convert!.count[0].needs).toEqual(["face_w_mm", "face_h_mm", "depth_mm"]);
    expect(mb.convert!.count[0].to).toBe("area");
    // the plain blocks dropped their pipelines (29), every other block kept its own
    let without = 0, withOwn = 0;
    for (const f of Object.values(spec8.families)) for (const u of Object.values(f.units)) { if (u.pipelines) withOwn++; else without++; }
    expect(without).toBe(29);
    expect(withOwn).toBe(1);   // cross-talk's derived per-number block is the ONE unit block with its own pipelines
    // everything else in the block is v7's
    const strip = (s: ItemListPricingSpec) => {
      const c = JSON.parse(JSON.stringify(s)) as ItemListPricingSpec & { default_pipelines?: unknown };
      delete c.default_pipelines;
      delete c.defaults!.ul.absent_as_none;
      c.defaults!.ul.rule = spec.defaults!.ul.rule;
      delete c.families["mixing box / LP plenum"].convert;
      for (const f of Object.values(c.families)) for (const u of Object.values(f.units)) delete u.pipelines;
      return c;
    };
    const v7s = JSON.parse(JSON.stringify(spec)) as ItemListPricingSpec & { default_pipelines?: unknown };
    delete v7s.default_pipelines;
    delete v7s.families["mixing box / LP plenum"].units.count;
    for (const f of Object.values(v7s.families)) for (const u of Object.values(f.units)) delete u.pipelines;
    expect(strip(spec8)).toEqual(v7s);
  });
  it("T7 -- ADP is ELIGIBLE on v8 by the SAME predicate every category answers; NEGATIVE: v7's ADP is not, and no other HVAC config moved", () => {
    expect(isEligibleConfig(adp8)).toBe(true);
    expect(isEligibleConfig(adp)).toBe(false);
    for (let i = 1; i < asset8.category_configs.length; i++) {
      expect(isEligibleConfig(asset8.category_configs[i])).toBe(isEligibleConfig(asset.category_configs[i]));
      expect(isEligibleConfig(asset8.category_configs[i])).toBe(false);   // vendor-quote + alias configs: not eligible OF THEIR OWN
    }
    // the reader hands the module the config's pipelines as the shared default
    expect(Object.keys(spec8.default_pipelines!)).toEqual(["item_supply", "item_install"]);
    expect(Object.keys(spec.default_pipelines!)).toEqual([]);
  });
});

describe("slice 6 / T7 -- a block without pipelines runs the config's shared per-item default", () => {
  it("POSITIVE: every plain family prices EXACTLY as on v7 (the same 94 of 95 SKUs, row 33 blank by rule)", () => {
    const adpItems = items8.filter((i) => i.kind === spec8.kind);
    let exact = 0; const blanks: string[] = [];
    for (const it of adpItems) {
      const row = (it as unknown as { source: { row: number } }).source.row;
      const attrs: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(it.attributes)) {
        if (k === "item_name" || k === "item_detail") continue;
        attrs[k === "torque_nm" ? "torque" : k] = String(v);
      }
      const r7 = priceItemList(spec, items, it.unit ?? "", [ext(attrs)]);
      const r8 = priceItemList(spec8, items8, it.unit ?? "", [ext(attrs)]);
      expect([r8.priced, r8.supply, r8.install]).toEqual([r7.priced, r7.supply, r7.install]);
      if (r8.priced) exact++; else blanks.push(`${row}: ${r8.reason}`);
    }
    expect(exact).toBe(94);
    expect(blanks).toEqual(["33: no neck size stated"]);
    // and the trace names the CONFIG's pipeline, not a block copy
    const r = one8("Nos", { family: "spigot", dia_mm: "150" });
    expect(r.items[0].pipelineResults.map((p) => p.pipelineId)).toEqual(["item_supply", "item_install"]);
  });
  it("NEGATIVE: a spec with NO default pipelines and a block without its own refuses with a named reason", () => {
    const bare: ItemListPricingSpec = { ...spec8, default_pipelines: {} };
    const r = priceItemList(bare, items8, "Nos", [ext({ family: "spigot", dia_mm: "150" })]);
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("no pricing pipelines declared for this family and unit");
    // a block WITH its own pipelines is untouched by the default's absence (cross-talk's derived block)
    expect(figures(priceItemList(bare, items8, "Nos", [ext({ family: "cross-talk", face_w_mm: "200", face_h_mm: "200" })]))).toEqual([true, 557, 192]);
  });
});

describe("slice 6 / S6 -- an ABSENT UL answer is NOT MENTIONED (the non-UL default fires); UL only", () => {
  it("POSITIVE: an actuator with no UL answer prices the non-UL SKU, marked defaulted by the S6 rule", () => {
    const r = one8("Nos", { family: "actuator", torque: "8 NM" });   // no `ul` key at all
    expect(figures(r)).toEqual([true, 9570, 800]);
    expect(r.items[0].defaulted).toEqual([{ attr: "ul", value: "no", rule: "R14 / S6 UL not mentioned (or not answered) = non-UL" }]);
    const nul = one8("Nos", { family: "actuator", ul: null, torque: "8 NM" });   // an explicit null (could not tell)
    expect(figures(nul)).toEqual([true, 9570, 800]);
    // a fire damper too: absent UL -> non-UL
    expect(figures(one8("Sqm", { family: "fire damper", variant: "without sleeve" }))).toEqual([true, 14138, 1920]);
  });
  it("NEGATIVE: a STATED UL still prices UL; absent damper and absent insulation STILL refuse; v7 still refuses an absent UL", () => {
    expect(figures(one8("Nos", { family: "actuator", ul: "yes", torque: "8 NM" }))).toEqual([true, 23925, 800]);
    expect(one8("Nos", { family: "round diffuser", damper: null, dia_mm: "200" }).reason).toBe("could not tell whether it is with or without a damper");
    expect(one8("Nos", { family: "round diffuser", dia_mm: "200" }).reason).toBe("could not tell whether it is with or without a damper");
    expect(one8("Rmt", { family: "flexible duct", insulated: null, dia_mm: "150" }).reason).toBe("could not tell whether it is insulated");
    expect(one8("Rmt", { family: "flexible duct", dia_mm: "150" }).reason).toBe("could not tell whether it is insulated");
    expect(one("Nos", { family: "actuator", ul: null, torque: "8 NM" }).reason).toBe("could not tell whether it is UL listed");   // v7: no key, no change
  });
});

describe("slice 6 / S7 -- the mixing box / LP plenum prices at ANY stated size from the per-sq.m rows", () => {
  it("POSITIVE: 450 x 450 x 350 -> cost 1,424 / priced 2,065; 750 x 150 x 350 still 1,743 (with) and 1,310 (without)", () => {
    const r = one8("Nos", { family: "mixing box / LP plenum", insulated: "None", face_w_mm: "450", face_h_mm: "450", depth_mm: "350" });
    expect(figures(r)).toEqual([true, 2065, 0]);
    expect(r.items[0].working.some((w) => w.includes("= 1424"))).toBe(true);   // the rounded-up cost before the markup
    expect(r.items[0].conversion?.rule).toContain("S7");
    expect(figures(one8("Nos", { family: "mixing box / LP plenum", insulated: "None", face_w_mm: "750", face_h_mm: "150", depth_mm: "350" }))).toEqual([true, 1743, 0]);
    expect(figures(one8("Nos", { family: "mixing box / LP plenum", insulated: "without", face_w_mm: "750", face_h_mm: "150", depth_mm: "350" }))).toEqual([true, 1310, 0]);
    // the two derived SKUs of the sheet reproduce from their own attributes through the SAME conversion
    expect(figures(one8("Nos", { family: "mixing box / LP plenum", insulated: "with", face_w_mm: "750", face_h_mm: "150", depth_mm: "350" }))).toEqual([true, 1743, 0]);
    // the flat 150 carries to every size: 1000 x 1000 x 1000 -> 1230 x 6 + 150 = 7530 -> x1.45 = 10918.5 -> 10919
    expect(figures(one8("Nos", { family: "mixing box / LP plenum", insulated: "None", face_w_mm: "1000", face_h_mm: "1000", depth_mm: "1000" }))).toEqual([true, 10919, 0]);
  });
  it("NEGATIVE: a missing dimension refuses naming it; the per-sq.m row still prices per sq.m; v7 (exact sizes only) still refuses 450 x 450 x 350", () => {
    expect(one8("Nos", { family: "mixing box / LP plenum", insulated: "None", face_w_mm: "450", face_h_mm: "450" }).reason).toBe("per-number row: no width and height and depth stated to convert the per-sq.m rate");
    expect(one8("Nos", { family: "mixing box / LP plenum", insulated: "None", face_h_mm: "450", depth_mm: "350" }).reason).toBe("per-number row: no width and height and depth stated to convert the per-sq.m rate");
    expect(figures(one8("Sqm", { family: "mixing box / LP plenum", insulated: "None" }))).toEqual([true, 1784, 0]);
    expect(one("Nos", { family: "mixing box / LP plenum", insulated: "None", face_w_mm: "450", face_h_mm: "450", depth_mm: "350" }).priced).toBe(false);
  });
});

describe("slice 6 / T4 -- a quantity per row unit per item, default 1", () => {
  it("POSITIVE: absent = 1; a stated 2 doubles the item's figures and the row total; the working says so", () => {
    const base = one8("Nos", { family: "spigot", dia_mm: "150" });
    expect(figures(base)).toEqual([true, 211, 64]);
    expect(base.items[0].qty).toBe(1);
    const r = price8("Nos", { ...ext({ family: "spigot", dia_mm: "150" }), qtyPerRowUnit: "2" });
    expect(figures(r)).toEqual([true, 422, 128]);
    expect(r.items[0].finals).toEqual({ supply: 211, install: 64 });
    expect(r.items[0].figures).toEqual({ supply: 422, install: 128 });
    expect(r.items[0].working).toContain("x 2 per row unit");
    // two items, one doubled: the row sums the figures
    const two = price8("Nos", { ...ext({ family: "actuator", ul: "None", torque: "8 NM" }), qtyPerRowUnit: 2 }, ext({ family: "control panel", panel_ratio: "1:6" }));
    expect(figures(two)).toEqual([true, 9570 * 2 + 16791, 800 * 2 + 800]);
  });
  it("NEGATIVE: a blank, a zero or a non-numeric quantity refuses the item with its reason", () => {
    expect(price8("Nos", { ...ext({ family: "spigot", dia_mm: "150" }), qtyPerRowUnit: "" }).reason).toBe("quantity per row unit is blank");
    expect(price8("Nos", { ...ext({ family: "spigot", dia_mm: "150" }), qtyPerRowUnit: "0" }).reason).toBe("quantity per row unit '0' is not a positive number");
    expect(price8("Nos", { ...ext({ family: "spigot", dia_mm: "150" }), qtyPerRowUnit: "two" }).reason).toBe("quantity per row unit 'two' is not a positive number");
  });
});

describe("slice 6 / the panel-facing helpers read the CONFIG -- no family, label or option is hard-coded", () => {
  it("familyChoices: the 25 priceable families with their unit words; aliases and no-SKU families are not offered", () => {
    const fams = familyChoices(spec8);
    expect(fams).toHaveLength(25);
    expect(fams.find((f) => f.family === "VCD")).toEqual({ family: "VCD", units: "per sq.m" });
    expect(fams.find((f) => f.family === "canvas connection")!.units).toBe("per sq.m / per number / per metre");
    expect(fams.some((f) => f.family === "grille, type not stated" || f.family === "none of these")).toBe(false);
  });
  it("itemFieldDefs: the family's needs for the row's unit class, labelled from the list_spec, options from the def (None first when allow_none)", () => {
    const defs = listSpecDefs(adp8);
    // slice 6b (V5): every field now names its control -- v8 declares none, so a choice is a dropdown from the
    // definition and a number is text, exactly slice 6's controls
    expect(itemFieldDefs(spec8, defs, "round diffuser", "count")).toEqual([
      { id: "damper", label: "Damper", options: ["None", "with", "without"], allowNone: true, skuAttr: "damper", control: "dropdown", optionSource: "definition" },
      { id: "dia_mm", label: "Diameter (as written)", allowNone: false, skuAttr: "dia_mm", control: "text" },
    ]);
    // the R13 source (air) rides along on a linear grille; a per-number VCD shows the conversion needs
    expect(itemFieldDefs(spec8, defs, "linear grille", "area").map((f) => f.id)).toEqual(["damper", "air"]);
    expect(itemFieldDefs(spec8, defs, "VCD", "count").map((f) => f.id)).toEqual(["variant", "face_w_mm", "face_h_mm", "area_band"]);
    // the variant's options come from values_by_family
    expect(itemFieldDefs(spec8, defs, "VCD", "area")[0].options).toEqual(["None", "GI oval", "motorised", "GI rectangular"]);
    expect(itemFieldDefs(spec8, defs, "actuator", "count").map((f) => f.id)).toEqual(["ul", "torque"]);
    // NEGATIVE: no family / an unknown family / a config without a list_spec
    expect(itemFieldDefs(spec8, defs, null, "count")).toEqual([]);
    expect(itemFieldDefs(spec8, defs, "widget", "count")).toEqual([]);
    expect(listSpecDefs(null)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 6b (2026-09-24, owner V1-V8) -- HVAC v9: the panel's control per attribute is CONFIG (`panel_controls`),
// a dropdown's options come from the ACTIVE SKUs (narrowed by the block's other answers, the ladder's own rule),
// a BoQ measurement stays text, the quantity is per block and the row's own quantity never enters.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

const asset9 = HVAC_V9 as unknown as Asset;
const items9: RateMasterItem[] = asset9.items.map((i) => ({ ...i, discipline: "HVAC" }));
const adp9 = asset9.category_configs.find((c) => c.category_id === "hvac_adp")!;
const spec9 = itemListPricingSpec(adp9)!;
const defs9 = listSpecDefs(adp9);
const price9 = (unit: string, ...its: ExtractedListItem[]) => priceItemList(spec9, items9, unit, its);
/** The stocked values of one SKU attribute for a family, straight from the asset -- the test's own reading. */
const stocked = (family: string, attr: string, where: Record<string, string> = {}): string[] =>
  [...new Set(items9
    .filter((i) => i.kind === "hvac_adp_item" && i.attributes.family === family && attr in i.attributes && Object.entries(where).every(([k, v]) => String(i.attributes[k]) === v))
    .map((i) => { const v = i.attributes[attr]; return typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(v)) : String(v); }))]
    .sort((a, b) => Number(a) - Number(b));

describe("slice 6b / v9 = v8 + panel_controls on the ADP config, and NOTHING else (X1, V5)", () => {
  it("items and the six other configs byte-identical; the ADP config differs ONLY in list_spec.pricing.panel_controls", () => {
    expect(asset9.items).toEqual(asset8.items);
    expect(asset9.category_configs.slice(1)).toEqual(asset8.category_configs.slice(1));
    const strip = (c: RateCategoryConfig) => {
      const x = JSON.parse(JSON.stringify(c)) as { list_spec: { pricing: { panel_controls?: unknown } } };
      delete x.list_spec.pricing.panel_controls;
      return x;
    };
    expect(spec9.panel_controls).toBeDefined();
    expect(spec8.panel_controls).toBeUndefined();
    expect(strip(adp9)).toEqual(strip(adp8));
  });
  it("the declared list, attribute by attribute: every stocked size + every choice is a dropdown; the four BoQ measurements are text; nothing else", () => {
    const pc = spec9.panel_controls!;
    const dropdown = Object.entries(pc).filter(([, v]) => v === "dropdown").map(([k]) => k).sort();
    const text = Object.entries(pc).filter(([, v]) => v === "text").map(([k]) => k).sort();
    expect(dropdown).toEqual(["air", "damper", "dia_mm", "family", "insulated", "neck_mm", "panel_ratio", "slot_count", "thickness_mm", "torque_nm", "ul", "variant"]);
    expect(text).toEqual(["area_sqm", "depth_mm", "face_h_mm", "face_w_mm"]);
    // COMPLETE over the panel's namespace: every number reader, every choice, the family, the derive source
    const ns = new Set([...Object.keys(spec9.numbers), ...spec9.choice_attrs, "family", ...(spec9.derive_when_none ?? []).map((r) => r.when.attr)]);
    expect(new Set(Object.keys(pc))).toEqual(ns);
    // every ladder attribute is a dropdown (a stocked size); every text attribute is a conversion input, never a ladder
    for (const l of spec9.ladders) expect(pc[l]).toBe("dropdown");
    for (const t of text) expect(spec9.ladders).not.toContain(t);
  });
});

describe("slice 6b / V1, V4 -- a dropdown's options come from the ACTIVE SKUs, narrowed by the block's other answers (X2)", () => {
  it("POSITIVE: the disc valve's diameters are the sheet's two; a round diffuser's damper choices and diameters are the sheet's; a control panel's ratios; a plenum's thicknesses", () => {
    const dv = itemFieldDefs(spec9, defs9, "disc valve", "count", { items: items9 });
    expect(dv).toEqual([{ id: "dia_mm", label: "Diameter (as written)", allowNone: false, skuAttr: "dia_mm", control: "dropdown", options: ["100", "150"], optionSource: "catalogue" }]);
    expect(dv[0].options).toEqual(stocked("disc valve", "dia_mm"));
    const rd = itemFieldDefs(spec9, defs9, "round diffuser", "count", { items: items9 });
    expect(rd.map((f) => [f.id, f.control, f.options, f.optionSource])).toEqual([
      ["damper", "dropdown", ["None", "with", "without"], "catalogue"],
      ["dia_mm", "dropdown", ["200", "250", "300", "400"], "catalogue"],
    ]);
    expect(itemFieldDefs(spec9, defs9, "control panel", "count", { items: items9 })[0].options).toEqual(stocked("control panel", "panel_ratio"));
    expect(itemFieldDefs(spec9, defs9, "double-skin plenum", "area", { items: items9 })[0].options).toEqual(["25", "50"]);
    expect(itemFieldDefs(spec9, defs9, "slot diffuser", "length", { items: items9 }).find((f) => f.skuAttr === "slot_count")!.options).toEqual(["2", "3"]);
  });
  it("NARROWING: an actuator's torques under UL vs non-UL are exactly the sheet's for that UL (the ladder's own rule); a contradictory answer falls back to the family's full list", () => {
    const all = stocked("actuator", "torque_nm");
    const yes = stocked("actuator", "torque_nm", { ul: "yes" });
    const no = stocked("actuator", "torque_nm", { ul: "no" });
    expect(all.length).toBeGreaterThan(0);
    const torque = (answers: Record<string, string>) => itemFieldDefs(spec9, defs9, "actuator", "count", { items: items9, answers }).find((f) => f.skuAttr === "torque_nm")!;
    expect(torque({}).options).toEqual(all);
    expect(torque({ ul: "yes" }).options).toEqual(yes);
    expect(torque({ ul: "no" }).options).toEqual(no);
    // the measured fact, stated so a future SKU change is loud: do the two UL sides stock the same torques today?
    expect([yes, no].map((l) => l.join(","))).toEqual([stocked("actuator", "torque_nm", { ul: "yes" }).join(","), stocked("actuator", "torque_nm", { ul: "no" }).join(",")]);
    // "None" and blank answers never narrow; a value no SKU carries falls back to the full list (never an empty select)
    expect(torque({ ul: "None" }).options).toEqual(all);
    expect(torque({ ul: "" }).options).toEqual(all);
    expect(torque({ ul: "maybe" }).options).toEqual(all);
    // and the UL choice itself narrows by a picked torque
    const ul = (answers: Record<string, string>) => itemFieldDefs(spec9, defs9, "actuator", "count", { items: items9, answers }).find((f) => f.skuAttr === "ul")!;
    expect(ul({}).options).toEqual(["None", ...["yes", "no"].filter((v) => stocked("actuator", "ul").includes(v))]);
    expect(ul({ torque_nm: "20" }).options).toEqual(["None", ...["yes", "no"].filter((v) => stocked("actuator", "ul", { torque_nm: "20" }).includes(v))]);
  });
  it("a newly added SKU appears as an option with NO code change (X2); the family's other options are untouched", () => {
    const extra: RateMasterItem = { ...items9.find((i) => i.attributes.family === "disc valve")!, name: "TEST-DV-200", item_uid: "test-dv-200", attributes: { item_name: "PVC Disc Valve", item_detail: "200MM DIA", family: "disc valve", dia_mm: 200 } };
    const dv = itemFieldDefs(spec9, defs9, "disc valve", "count", { items: [...items9, extra] });
    expect(dv[0].options).toEqual(["100", "150", "200"]);
    // and it prices through the same pick
    expect(figures(priceItemList(spec9, [...items9, extra], "Nos", [ext({ family: "disc valve", dia_mm: "200" })]))[0]).toBe(true);
  });
  it("NEGATIVE: a BoQ measurement stays free text (no options); an attribute no SKU carries takes the definition's vocabulary; v8 (no panel_controls) keeps today's controls", () => {
    const vcd = itemFieldDefs(spec9, defs9, "VCD", "count", { items: items9 });
    expect(vcd.map((f) => [f.id, f.control, f.options === undefined])).toEqual([
      ["variant", "dropdown", false], ["face_w_mm", "text", true], ["face_h_mm", "text", true], ["area_band", "text", true],
    ]);
    // the choice keeps the DEFINITION's family order (values_by_family: GI oval, motorised, GI rectangular), from the SKUs
    expect(vcd[0].options).toEqual(["None", "GI oval", "motorised", "GI rectangular"]);
    expect(vcd[0].optionSource).toBe("catalogue");
    expect(new Set(vcd[0].options!.slice(1))).toEqual(new Set(stocked("VCD", "variant")));
    // the air stream (a derive source): a closed BoQ vocabulary, no SKU carries it -> the definition's list
    const lg = itemFieldDefs(spec9, defs9, "linear grille", "area", { items: items9 });
    expect(lg.find((f) => f.id === "air")).toMatchObject({ control: "dropdown", optionSource: "definition", options: ["None", "supply", "return", "exhaust", "fresh"] });
    // the mixing box's three dimensions are conversion inputs: text
    expect(itemFieldDefs(spec9, defs9, "mixing box / LP plenum", "count", { items: items9 }).map((f) => [f.id, f.control])).toEqual([["insulated", "dropdown"], ["face_w_mm", "text"], ["face_h_mm", "text"], ["depth_mm", "text"]]);
    // v8: a number is a text input, a choice a select from the definition -- exactly slice 6, plus the control key
    expect(itemFieldDefs(spec8, listSpecDefs(adp8), "disc valve", "count", { items: items8 })).toEqual([{ id: "dia_mm", label: "Diameter (as written)", allowNone: false, skuAttr: "dia_mm", control: "text" }]);
    // without SKUs handed in, a v9 dropdown size has no options to offer (the caller must pass the catalogue)
    expect(itemFieldDefs(spec9, defs9, "disc valve", "count")[0]).toEqual({ id: "dia_mm", label: "Diameter (as written)", allowNone: false, skuAttr: "dia_mm", control: "dropdown" });
  });
});

describe("slice 6b / V3 -- an off-ladder stated size prices at the ladder result (unchanged), above the largest still refuses", () => {
  it("the pricing itself is byte-identical between v8 and v9 for every stated size (the control is screen-only)", () => {
    for (const d of ["100", "120", "150", "160", "150MM DIA", "", "abc"]) {
      const a = price8("Nos", ext({ family: "disc valve", dia_mm: d }));
      const b = price9("Nos", ext({ family: "disc valve", dia_mm: d }));
      expect(b).toEqual(a);
    }
    expect(figures(price9("Nos", ext({ family: "disc valve", dia_mm: "120" })))).toEqual([true, 653, 176]);
    expect(price9("Nos", ext({ family: "disc valve", dia_mm: "160" })).reason).toBe("diameter 160 is above the largest size on the sheet (150)");
  });
});

describe("slice 6b / V6, V7 -- the same family more than once; the per-block quantity is per ONE row unit and the row's own quantity never enters", () => {
  it("V6: two disc valves of different sizes price separately and the row sums them", () => {
    const r = price9("Nos", ext({ family: "disc valve", dia_mm: "100" }), ext({ family: "disc valve", dia_mm: "150" }));
    expect(r.items.map((i) => [i.family, i.figures.supply, i.figures.install])).toEqual([["disc valve", 551, 176], ["disc valve", 653, 176]]);
    expect([r.supply, r.install]).toEqual([551 + 653, 176 + 176]);
  });
  it("V7: a 3-block row with quantities 1 / 2 / 4 prices to the sum of rate x quantity; NEGATIVE: the module has no row-quantity input at all", () => {
    const r = price9("Nos",
      { ...ext({ family: "disc valve", dia_mm: "100" }), qtyPerRowUnit: 1 },
      { ...ext({ family: "spigot", dia_mm: "150" }), qtyPerRowUnit: "2" },
      { ...ext({ family: "butterfly damper", dia_mm: "150" }), qtyPerRowUnit: 4 });
    const bf = price9("Nos", ext({ family: "butterfly damper", dia_mm: "150" })).items[0].finals;
    expect(r.priced).toBe(true);
    expect(r.supply).toBe(551 * 1 + 211 * 2 + bf.supply * 4);
    expect(r.install).toBe(176 * 1 + 64 * 2 + bf.install * 4);
    // the module's signature carries the unit and the items -- nothing about the row's quantity -- and its source
    // never reads one (the only quantity it knows is the per-block `qtyPerRowUnit`)
    expect(priceItemList.length).toBe(4);
    const src = readFileSync(join(__dirname, "itemListPricing.ts"), "utf8");
    expect(src).not.toMatch(/row\.(qty|quantity)|rowQty|ctx\.quantity|total_quantity/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 6d (owner ruling "yes ask the question") -- HVAC v10: the model is asked, per item, how many of it make
// ONE unit of the row. A returned number is the quantity and is READ; "None" or absent leaves code's 1, marked
// as a default. The fixtures below are the slice-6c check run's own rows: the six INVENTED count-stating rows
// and every count-like TRAP the live corpus contains.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

const asset10 = HVAC_V10 as unknown as Asset;
const items10: RateMasterItem[] = asset10.items.map((i) => ({ ...i, discipline: "HVAC" }));
const adp10 = asset10.category_configs.find((c) => c.category_id === "hvac_adp")!;
const spec10 = itemListPricingSpec(adp10)!;
const price10 = (unit: string, ...its: ExtractedListItem[]) => priceItemList(spec10, items10, unit, its);
const QTY = "qty_per_row_unit";
/** one item, its attributes plus the count the model answered (undefined = the model was not asked / said nothing) */
const withCount = (attrs: Record<string, string | null>, count?: number | string | null): ExtractedListItem => {
  const it = ext(attrs);
  if (count !== undefined) it.attributes[QTY] = { value: count as string | number | null, confidence: 0.9 };
  return it;
};

describe("slice 6d / v10 = v9 + the count question, and NOTHING else", () => {
  it("items and the six other configs byte-identical; the ADP config differs ONLY by the new definition and qty_attribute_id", () => {
    expect(asset10.items).toEqual(asset9.items);
    expect(asset10.category_configs.slice(1)).toEqual(asset9.category_configs.slice(1));
    const strip = (c: RateCategoryConfig) => {
      const x = JSON.parse(JSON.stringify(c)) as { list_spec: { attribute_definitions: Array<{ id: string }>; qty_attribute_id?: string } };
      x.list_spec.attribute_definitions = x.list_spec.attribute_definitions.filter((d) => d.id !== QTY);
      delete x.list_spec.qty_attribute_id;
      return x;
    };
    expect(strip(adp10)).toEqual(strip(adp9));
    // the new definition is a NUMBER with allow_none, appended last, and is NOT a SKU attribute
    const defs = listSpecDefs(adp10);
    expect(defs[defs.length - 1]).toEqual({ id: QTY, label: "How many of this item make ONE unit of the row", type: "number", allow_none: true });
    expect((adp10 as unknown as { list_spec: { qty_attribute_id: string } }).list_spec.qty_attribute_id).toBe(QTY);
    expect(spec10.qty_attribute_id).toBe(QTY);
    expect(spec10.numbers[QTY]).toBeUndefined();
    expect(spec10.choice_attrs).not.toContain(QTY);
    expect(spec10.panel_controls![QTY]).toBeUndefined();
    // NEGATIVE: v9 asks no such question, so its spec carries no id and its defs end elsewhere
    expect(spec9.qty_attribute_id).toBeUndefined();
    expect(listSpecDefs(adp9).some((d) => d.id === QTY)).toBe(false);
  });
});

describe("slice 6d / the model's count is the quantity; 'None' and absent leave code's 1, marked", () => {
  it("POSITIVE: a returned 2 prices rate x 2 and is READ (not defaulted); the working says so", () => {
    const one = price10("Nos", withCount({ family: "spigot", dia_mm: "150" }, 2));
    expect(figures(one)).toEqual([true, 422, 128]);
    expect(one.items[0]).toMatchObject({ qty: 2, qtyDefaulted: false });
    expect(one.items[0].finals).toEqual({ supply: 211, install: 64 });
    expect(one.items[0].working).toContain("x 2 per row unit");
  });
  it("'None' and ABSENT both leave 1, MARKED as a default -- identical figures, identical everything", () => {
    const none = price10("Nos", withCount({ family: "spigot", dia_mm: "150" }, "None"));
    const absent = price10("Nos", withCount({ family: "spigot", dia_mm: "150" }));
    expect(figures(none)).toEqual([true, 211, 64]);
    expect(none.items[0]).toMatchObject({ qty: 1, qtyDefaulted: true });
    expect(absent.items[0]).toMatchObject({ qty: 1, qtyDefaulted: true });
    expect(none.items[0].figures).toEqual(absent.items[0].figures);
    // an unreadable or non-positive ANSWER is not a count either: code's 1 stands, marked (it never refuses --
    // only a value the PRICER typed can refuse)
    for (const bad of [0, -2, "abc", null]) {
      const r = price10("Nos", withCount({ family: "spigot", dia_mm: "150" }, bad as number | string | null));
      expect(r.items[0], String(bad)).toMatchObject({ qty: 1, qtyDefaulted: true });
      expect(figures(r)).toEqual([true, 211, 64]);
    }
  });
  it("the PRICER's typed value always wins over the model's count, and a cleared one still refuses", () => {
    const typed = price10("Nos", { ...withCount({ family: "spigot", dia_mm: "150" }, 2), qtyPerRowUnit: "5" });
    expect(figures(typed)).toEqual([true, 211 * 5, 64 * 5]);
    expect(typed.items[0]).toMatchObject({ qty: 5, qtyDefaulted: false });
    const cleared = price10("Nos", { ...withCount({ family: "spigot", dia_mm: "150" }, 2), qtyPerRowUnit: "" });
    expect(cleared.reason).toBe("quantity per row unit is blank");
  });
  it("NEGATIVE: under v9 -- the same items, the same asset but no question asked -- every count is ignored and every quantity is 1", () => {
    const r = priceItemList(spec9, items9, "Nos", [withCount({ family: "spigot", dia_mm: "150" }, 2)]);
    expect(figures(r)).toEqual([true, 211, 64]);
    expect(r.items[0]).toMatchObject({ qty: 1, qtyDefaulted: true });
  });
});

describe("slice 6d / the check run's rows as FIXTURES -- the six invented reads and every corpus trap", () => {
  // what the model actually answered in the slice-6c check run, per item, on the six INVENTED rows that state
  // a count. The HOST item is "None" on every one of them: one diffuser, one damper, one valve per row unit.
  const INVENTED: Array<{ text: string; items: Array<[string, number | "None"]> }> = [
    { text: "Supply and installation of square diffuser 600 x 600 with 2 plenum boxes.",
      items: [["square diffuser", "None"], ["mixing box / LP plenum", 2]] },
    { text: "Supply, installation and testing of motorised fire damper complete with 4 nos actuators.",
      items: [["fire damper", "None"]] },
    { text: "SITC of linear slot diffuser 1200 mm long, 3 sets of collar dampers per diffuser.",
      items: [["slot diffuser", "None"], ["collar damper", 3]] },
    { text: "Supply of exhaust air valve with 2 no. spigots per outlet.",
      items: [["disc valve", "None"], ["spigot", 2]] },
    { text: "Supply and fixing of return air grille, each unit including 2 plenum boxes and 1 collar damper.",
      items: [["grille, type not stated", "None"], ["mixing box / LP plenum", 2], ["collar damper", 1]] },
    { text: "Supply of volume control damper assembly comprising 6 nos dampers.",
      items: [["VCD", 6]] },
  ];
  it("each invented row's count lands on the RIGHT item and the host item keeps code's 1, marked", () => {
    for (const row of INVENTED) {
      const priced = price10("Nos", ...row.items.map(([family, count]) => withCount({ family }, count)));
      expect(priced.items.map((i) => i.familyRaw), row.text).toEqual(row.items.map(([f]) => f));
      priced.items.forEach((it, i) => {
        const [, count] = row.items[i];
        if (count === "None") expect(it, `${row.text} / ${row.items[i][0]}`).toMatchObject({ qty: 1, qtyDefaulted: true });
        else expect(it, `${row.text} / ${row.items[i][0]}`).toMatchObject({ qty: count, qtyDefaulted: false });
      });
    }
  });
  // EVERY count-like row the live ADP corpus contains (3,519 rows searched; these 17 are all of them), with the
  // number a careless read would take. In the check run the model answered "None" on every one. This pins what
  // that answer MEANS downstream: code's 1, marked -- so a future prompt change that started reading capacities
  // or slot counts as quantities could not slip past as "the number was there anyway".
  const TRAPS: Array<[string, string, string]> = [
    ["BOQ-26-00098|Lowside|88", "Master Controller up to 5 Nos of dampers", "5 -- a controller's CAPACITY"],
    ["BOQ-26-00171|HVAC|69", "SITC of control panel for Fire Dampers with 240/24 transformer and distribution for 10 no damper actuators", "10 -- a panel's CAPACITY"],
    ["BOQ-26-00164|BOQ|34", "Panel for Fire Dampers with Sub Db's and 240/24 Step Down transformer and distribution for various damper actuators", "8 -- a panel's CAPACITY"],
    ["BOQ-26-00231|HVAC BOQ|226", "For 8 no. fire dampers", "8 -- a control panel VARIANT"],
    ["BOQ-26-00231|HVAC BOQ|227", "For 6 no. fire dampers", "6 -- a control panel VARIANT"],
    ["BOQ-26-00231|HVAC BOQ|228", "For 4 no. fire dampers", "4 -- a control panel VARIANT"],
    ["BOQ-26-00231|HVAC BOQ|229", "For 2 no. fire dampers", "2 -- a control panel VARIANT"],
    ["BOQ-26-00087|HVAC|67", "Plenum Box for 1 Slot Linear Diffuser -1000 mm Length", "1 -- a SLOT COUNT"],
    ["BOQ-26-00087|HVAC|68", "Plenum Box for 3 Slot Linear Diffuser - 1300 mm Length", "3 -- a SLOT COUNT"],
    ["BOQ-26-00087|HVAC|69", "Plenum Box for 3 Slot Linear Diffuser - 2600 mm Length", "3 -- a SLOT COUNT"],
    ["BOQ-26-00087|HVAC|70", "Plenum Box for 4 Slot Linear Diffuser - 2500 mm Length", "4 -- a SLOT COUNT"],
    ["BOQ-26-00087|HVAC|71", "Plenum Box for 4 Slot Linear Diffuser - 3000 mm Length", "4 -- a SLOT COUNT"],
    ["BOQ-26-00087|HVAC|72", "Plenum Box for 4 Slot Linear Diffuser -2200 mm Length", "4 -- a SLOT COUNT"],
    ["BOQ-26-00087|HVAC|73", "Plenum Box for 4 Slot Linear Diffuser -1600 mm Length", "4 -- a SLOT COUNT"],
    ["BOQ-26-00087|HVAC|74", "Plenum Box for 4 Slot Linear Diffuser -6409 mm Length", "4 -- a SLOT COUNT"],
    ["BOQ-26-00020|HVAC_-19TH FLOOR|371", "1.25m (L) X 150 (D)and 350mm (H) - For 3 slot diffuser", "3 -- a SLOT COUNT"],
    ["BOQ-26-00185|HVAC|25", "The supply & installation of higher grade Slot Air Grill 100mm witdh with 2 air flow outlets", "2 -- a FEATURE"],
  ];
  it("every corpus trap: the model's 'None' means code's 1, MARKED -- the misreadable number never becomes a quantity", () => {
    expect(TRAPS).toHaveLength(17);
    for (const [row, , what] of TRAPS) {
      const r = price10("Nos", withCount({ family: "spigot", dia_mm: "150" }, "None"));
      expect(r.items[0], `${row} (${what})`).toMatchObject({ qty: 1, qtyDefaulted: true });
      expect(figures(r), row).toEqual([true, 211, 64]);
    }
    // and the number those rows carry, had it been read, would have moved the price -- which is why the pin matters
    const misread = price10("Nos", withCount({ family: "spigot", dia_mm: "150" }, 5));
    expect(figures(misread)).toEqual([true, 211 * 5, 64 * 5]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 8 (owner M-b / M-c, 2026-09-24) -- HVAC v11: TWO declarations, both in config, neither naming a family
// or a SKU in code.
//   M-b  `override_when`  -- a STATED fact decides the pick whatever else the row said. A row mentioning UL
//        takes the UL 555 SKU whether it also says motorised, with sleeve or without.
//   M-c  flexible duct `convert.count` -- a duct is sold PER PIECE of a 2.5 m standard length, so a per-number
//        row prices from the per-metre SKU at that length, supply AND install, rounding LAST.
// Proved on the 1,150 stored replies of the slice-7 capture: 44 rows blank -> priced (29 M-b, 15 M-c), ZERO
// rows repriced while priced, ZERO rows priced -> blank.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

const asset11 = HVAC_V11 as unknown as Asset;
const items11: RateMasterItem[] = asset11.items.map((i) => ({ ...i, discipline: "HVAC" }));
const adp11 = asset11.category_configs.find((c) => c.category_id === "hvac_adp")!;
const spec11 = itemListPricingSpec(adp11)!;
const price11 = (unit: string, ...its: ExtractedListItem[]) => priceItemList(spec11, items11, unit, its);
const working = (r: ReturnType<typeof price11>, i = 0) => r.items[i].working;

describe("slice 8 / v11 = v10 + the two declarations, and NOTHING else", () => {
  it("items and the six other configs byte-identical; the ADP config differs ONLY by override_when and the flexible duct conversion", () => {
    expect(asset11.items).toEqual(asset10.items);
    expect(asset11.category_configs.slice(1)).toEqual(asset10.category_configs.slice(1));
    const strip = (c: RateCategoryConfig) => {
      const x = JSON.parse(JSON.stringify(c)) as {
        list_spec: { pricing: { override_when?: unknown; families: Record<string, { convert?: unknown }> } };
      };
      delete x.list_spec.pricing.override_when;
      delete x.list_spec.pricing.families["flexible duct"].convert;
      return x;
    };
    expect(strip(adp11)).toEqual(strip(adp10));
    // NEGATIVE: v10 carries neither, so the stripping above is not vacuously removing nothing
    expect(spec10.override_when).toBeUndefined();
    expect(spec10.families["flexible duct"].convert).toBeUndefined();
    expect(spec11.override_when).toEqual([
      { attr: "variant", families: ["fire damper"], when: { attr: "ul", equals: "yes" }, then: "UL",
        rule: "UL stated, so the UL 555 SKU is used (R-M-b)" },
    ]);
    // the standard length is DECLARED, in metres, in the config -- the module holds no such number
    const opt = spec11.families["flexible duct"].convert!.count[0];
    expect(opt.to).toBe("length");
    expect(opt.rule).toBe("per piece: per-metre rate x 2.5 m standard length (R-M-c)");
    const lenParams = opt.pipelines.item_supply.steps
      .map((s) => (s as { params?: Record<string, unknown> }).params?.standard_length_m)
      .filter((v) => v !== undefined);
    expect(lenParams).toEqual([2.5]);
    // M-d: no family name and no standard length in CODE. The guard strips COMMENT lines first -- prose that
    // explains which ruling a branch serves is the house style and is not what the rule forbids; what it forbids
    // is a branch that can only fire for one named family, or an arithmetic constant the config should own.
    const code = readFileSync(join(__dirname, "itemListPricing.ts"), "utf-8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    for (const forbidden of ["2.5", "fire damper", "flexible duct", "UL 555", "hvac"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe("slice 8 / M-b -- a stated UL decides the fire damper, whatever the variant says", () => {
  // the sheet's UL 555 row: cost 15000 / 1200, markups 0.45 / 0.60 -> ROUNDUP(21750) / ROUNDUP(1920)
  const UL = [true, 21750, 1920] as const;
  const NOTE = "UL stated, so the UL 555 SKU is used (R-M-b)";

  it("ul yes beats EVERY variant the sheet stocks -- motorised, with sleeve, without sleeve", () => {
    for (const variant of ["motorised", "with sleeve", "without sleeve"]) {
      const r = price11("Sq.m", ext({ family: "fire damper", ul: "yes", variant }));
      expect(figures(r), variant).toEqual(UL);
      expect(skuOf(r), variant).toBe("Fire damper / UL 555 Rated");
      expect(working(r), variant).toContain(NOTE);
      // NEGATIVE, the same row on v10: refused, which is the defect M-b answers
      const was = priceItemList(spec10, items10, "Sq.m", [ext({ family: "fire damper", ul: "yes", variant })]);
      expect(was.priced, variant).toBe(false);
      expect(was.reason, variant).toContain("no SKU for this combination");
    }
  });

  it("NEGATIVE: ul not mentioned, or never answered, keeps the non-UL default and the variant's own SKU", () => {
    // "None" = the row says nothing about UL (S6's absent_as_none makes an ABSENT answer read the same way)
    for (const ul of ["None", null]) {
      const r = price11("Sq.m", ext({ family: "fire damper", ul, variant: "motorised" }));
      expect(figures(r), String(ul)).toEqual([true, 12470, 1920]);
      expect(skuOf(r), String(ul)).toBe("FIRE DAMPER / Motorised fire damper");
      expect(working(r), String(ul)).not.toContain(NOTE);
      // and it is byte-identical to v10 -- figures AND every working line
      const was = priceItemList(spec10, items10, "Sq.m", [ext({ family: "fire damper", ul, variant: "motorised" })]);
      expect(figures(was), String(ul)).toEqual(figures(r));
      expect(was.items[0].working, String(ul)).toEqual(working(r));
    }
  });

  it("NEGATIVE: a row ALREADY on the UL SKU is untouched -- no second note, the same trace as v10", () => {
    const r = price11("Sq.m", ext({ family: "fire damper", ul: "yes", variant: "UL" }));
    const was = priceItemList(spec10, items10, "Sq.m", [ext({ family: "fire damper", ul: "yes", variant: "UL" })]);
    expect(figures(r)).toEqual(UL);
    expect(figures(was)).toEqual(UL);
    // the override fires only when it CHANGES something, so these rows keep their trace exactly
    expect(working(r)).not.toContain(NOTE);
    expect(working(r)).toEqual(was.items[0].working);
  });

  it("NEGATIVE: a family the override does not name is unaffected, even with UL stated", () => {
    // the VCD family stocks no UL row at all; `ul` is not one of its needs, so nothing about it may move
    const r = price11("Sq.m", ext({ family: "VCD", ul: "yes", variant: "GI rectangular" }));
    const was = priceItemList(spec10, items10, "Sq.m", [ext({ family: "VCD", ul: "yes", variant: "GI rectangular" })]);
    expect(r.priced).toBe(true);
    expect(figures(r)).toEqual(figures(was));
    expect(working(r)).toEqual(was.items[0].working);
    expect(working(r)).not.toContain(NOTE);
  });
});

describe("slice 8 / M-c -- a flexible duct is sold per piece of a 2.5 m standard length", () => {
  const RULE = "per piece: per-metre rate x 2.5 m standard length (R-M-c)";

  it("a per-NUMBER row prices from the per-metre SKU at the standard length, supply AND install, rounding last", () => {
    // Insulated 250 MM DIA: 510/m -> 510 x 2.5 = 1275, x 1.45 = 1848.75, ROUNDUP -> 1849. install 0 stays 0.
    const r = price11("Nos", ext({ family: "flexible duct", insulated: "with", dia_mm: "250 mm" }));
    expect(figures(r)).toEqual([true, 1849, 0]);
    expect(skuOf(r)).toBe("Insulated Flexible Duct / 250 MM DIA");
    expect(r.items[0].conversion).toEqual({ rule: RULE, to: "length" });
    expect(working(r)).toContain(RULE);
    // the ROUNDING IS LAST -- one roundup at the end, not a rounded per-metre rate multiplied afterwards
    expect(working(r)).toContain("item_supply: per piece: per-metre supply cost x 2.5 m standard length (R-M-c) = 1275");
    expect(working(r)).toContain("item_supply: ROUNDUP(supply, 0) (R15) = 1849");
    expect(1849).not.toBe(Math.ceil(510 * 1.45) * 2.5);
    // NEGATIVE, the same row on v10: refused -- the defect M-c answers
    const was = priceItemList(spec10, items10, "Nos", [ext({ family: "flexible duct", insulated: "with", dia_mm: "250 mm" })]);
    expect(was.priced).toBe(false);
    expect(was.reason).toBe("no SKU per number for flexible duct");
  });

  it("NEGATIVE: a per-METRE row prices per metre exactly as before -- the conversion is unreachable from it", () => {
    const r = price11("RMT", ext({ family: "flexible duct", insulated: "with", dia_mm: "250 mm" }));
    const was = priceItemList(spec10, items10, "RMT", [ext({ family: "flexible duct", insulated: "with", dia_mm: "250 mm" })]);
    expect(figures(r)).toEqual([true, 740, 0]);
    expect(figures(was)).toEqual(figures(r));
    expect(r.items[0].conversion).toBeNull();
    expect(working(r)).not.toContain(RULE);
    expect(working(r)).toEqual(was.items[0].working);
  });

  it("NEGATIVE: a family with no declared standard length still refuses with today's reason", () => {
    // the spigot stocks per-number rows only; nothing declares a length for it, so a per-metre row still refuses
    const r = price11("RMT", ext({ family: "spigot", dia_mm: "150" }));
    const was = priceItemList(spec10, items10, "RMT", [ext({ family: "spigot", dia_mm: "150" })]);
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("no SKU per metre for spigot");
    expect(r.reason).toBe(was.reason);
  });

  it("NEGATIVE: the ladder still governs -- a diameter above the largest refuses rather than pricing per piece", () => {
    const r = price11("Nos", ext({ family: "flexible duct", insulated: "with", dia_mm: "900 mm" }));
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("diameter 900 is above the largest size on the sheet (350)");
  });
});

// ==========================================================================================================
// SLICE 9 (2026-09-25, owner rulings A-1 .. A-6) -- ONE SIZE FIELD, THE STATED DIAMETER, NO HEADING BLEED,
// AND THE OUTER SIZE AS A SECOND KEY.
//
// A BoQ writes a size as one phrase. Asking for width, height and depth as three separate answers made the
// model copy the whole phrase into one of them, and code then refused it as "not a single number" -- 60 rows
// of the live corpus. The model is now asked ONCE, for the size as written, and CODE splits it.
// ==========================================================================================================
const asset12 = HVAC_V12 as unknown as Asset;
const items12: RateMasterItem[] = asset12.items.map((i) => ({ ...i, discipline: "HVAC" }));
const adp12 = asset12.category_configs.find((c) => c.category_id === "hvac_adp")!;
const spec12 = itemListPricingSpec(adp12)!;
const price12 = (unit: string, ...its: ExtractedListItem[]) => priceItemList(spec12, items12, unit, its);
/** The three axes as the config reads them, so a spelling is checked exactly where pricing reads it. */
const axes = (text: string | null) => ({
  w: readNumber(text, spec12.numbers.face_w_mm),
  h: readNumber(text, spec12.numbers.face_h_mm),
  d: readNumber(text, spec12.numbers.depth_mm),
});
const val = (r: ReturnType<typeof readNumber>) => (r && "value" in r ? r.value : null);

describe("slice 9 / v12 = v11 + the declared edits, and NOTHING else", () => {
  it("the ADP config differs ONLY by the one size field, the four def notes and the second key; every OTHER config and every other item is byte-identical", () => {
    expect(asset12.category_configs.slice(1)).toEqual(asset11.category_configs.slice(1));
    // the six catalogue cells are the ONLY items that moved (A-5), and their uids did NOT
    const changed = asset12.items.filter((it, i) => JSON.stringify(it) !== JSON.stringify(asset11.items[i]));
    expect(changed.length).toBe(6);
    expect(changed.map((i) => i.item_uid).sort()).toEqual(asset11.items.filter(
      (i) => String((i.attributes as Record<string, unknown>).item_detail ?? "").includes("OUTER: 595X595"),
    ).map((i) => i.item_uid).sort());
    // NEGATIVE: v11 carries none of the new keys, so the strip below removes something real
    expect(spec11.second_key).toBeUndefined();
    expect(spec11.numbers.face_w_mm.component).toBeUndefined();
    expect(spec11.override_when![0].display).toBeUndefined();
    expect(spec12.override_when![0].display).toBe("UL 555");
    expect(spec12.second_key).toEqual([{
      families: ["square diffuser"], primary: "neck_mm", key: ["face_w_mm", "face_h_mm"],
      alt_key: ["face_alt_w_mm", "face_alt_h_mm"], name: "outer size", primary_pick: "largest",
    }]);
    for (const [id, comp] of [["face_w_mm", 1], ["face_h_mm", 2], ["depth_mm", 3]] as const) {
      expect(spec12.numbers[id].from).toEqual(["size_mm"]);
      expect(spec12.numbers[id].component).toBe(comp);
    }
  });

  it("the model is asked for ONE size, not three; and the panel shows it ONCE", () => {
    const ids = listSpecDefs(adp12).map((d) => d.id);
    expect(ids).toContain("size_mm");
    for (const gone of ["face_w_mm", "face_h_mm", "depth_mm"]) expect(ids).not.toContain(gone);
    // the mixing box needs all three axes; the panel must still offer exactly ONE box for them
    const fields = itemFieldDefs(spec12, listSpecDefs(adp12), "mixing box / LP plenum", "count");
    const sizeFields = fields.filter((f) => f.id === "size_mm");
    expect(sizeFields.length).toBe(1);
    expect(sizeFields[0].label).toBe("Size (as written)");
    // NEGATIVE, on v11: the same family offered THREE boxes
    expect(itemFieldDefs(spec11, listSpecDefs(adp11), "mixing box / LP plenum", "count")
      .filter((f) => ["face_w_mm", "face_h_mm", "depth_mm"].includes(f.id)).length).toBe(3);
  });

  it("no new literal reaches the code: no family name, no size, no catalogue wording", () => {
    const code = readFileSync(join(__dirname, "itemListPricing.ts"), "utf-8")
      .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const forbidden of ["595", "600", "1200", "square diffuser", "outer size", "neck", "size_mm", "hvac"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe("slice 9 / A-1 -- every size spelling the live capture contains, and what code makes of it", () => {
  // Each row is a spelling the model actually produced on the 1,150-row corpus (or, for the labelled forms,
  // the phrase the rows those answers came from are written in), with the width / height / depth code reads.
  const TABLE: Array<[string, number | null, number | null, number | null]> = [
    // ---- plain x-joined pairs and triples: the common case, ordered as written -------------------------
    ["600x600", 600, 600, null],
    ["600 x 600 MM", 600, 600, null],
    ["596 x 596 mm", 596, 596, null],
    ["1200 mm X 250 mm", 1200, 250, null],
    ["1200x300", 1200, 300, null],
    ["525 x 525 x 450 mm", 525, 525, 450],
    ["595mmx595mmx450mm", 595, 595, 450],
    ["375x375x375", 375, 375, 375],
    ["450x 450 x 400 mm", 450, 450, 400],
    ["600 x 150 x 450 mm", 600, 150, 450],
    ["(275x275x350)mm", 275, 275, 350],
    ["600X1200x 400 mm High", 600, 1200, 400],   // ONE part labelled -> ordered as written, not by the label
    ["375x 375 x 400 mm High", 375, 375, 400],
    // ---- every part labelled: the LABELS order it, which is the only way these read correctly ----------
    ["1100(W) X 250(D) X 400(H)", 1100, 400, 250],
    ["200mm (W) x 200mm(H) x 1500mm(L)", 200, 200, 1500],
    ["250mm Wide X 250mm Height X 1500mm Length", 250, 250, 1500],
    // ---- one dimension only ---------------------------------------------------------------------------
    ["600", 600, null, null],                    // owner ruling: a bare number is the width; height refuses
    ["300 mm", 300, null, null],
    ["250 mm high", null, 250, null],            // it NAMES its axis, so it is a height and NOT a width
    ["150mm HEIGHT", null, 150, null],
    ["125mm deep", null, null, 125],
    // ---- units the reader already scaled, unchanged by the split --------------------------------------
    ["1.2 m x 0.6 m", 1200, 600, null],
  ];
  for (const [text, w, h, d] of TABLE) {
    it(`reads ${JSON.stringify(text)} as width ${w}, height ${h}, depth ${d}`, () => {
      const a = axes(text);
      expect(val(a.w), "width").toBe(w);
      expect(val(a.h), "height").toBe(h);
      expect(val(a.d), "depth").toBe(d);
    });
  }

  it("NEGATIVE: a form code cannot read REFUSES by name and never guesses a number", () => {
    // a list of sizes is several values, not a size -- the refusal names the quantity and quotes the text
    // SLICE 11: "100/150", "900/1000" and "350/400 mm" were in this list. They are ALTERNATIVE PAIRS and now
    // read as their higher value (asserted just below); the two genuine LISTS keep the negative half.
    for (const text of ["100, 150, 200 mm", "100/150/200/250 mm/600mmx600mm"]) {
      const got = axes(text).w;
      expect(got, text).not.toBeNull();
      expect(got && "blank" in got, text).toBe(true);
      expect((got as { blank: string }).blank, text).toContain("several values stated for width");
      expect((got as { blank: string }).blank, text).toContain(text);
    }
    // SLICE 11, the inverted half: each of the three pairs reads its HIGHER value as the width
    for (const [text, hi] of [["100/150", 150], ["900/1000", 1000], ["350/400 mm", 400]] as const) {
      const got = axes(text).w;
      expect(got && "value" in got ? got.value : null, text).toBe(hi);
    }
    // inches are refused by name, exactly as before this slice
    const inch = axes('6"').w as { blank: string };
    expect(inch.blank).toContain("width stated in inches");
    // FOUR or more parts is not a size this splitter reads: the whole text falls to the ordinary reader,
    // which refuses it -- it never silently takes the first three
    const four = axes("100 x 200 x 300 x 400").w as { blank: string };
    expect("blank" in four).toBe(true);
    expect(four.blank).toContain("not a single number");
    // labels that are not a permutation of the phrase's own slots are ambiguous, so not a phrase
    const odd = axes("1000(W) x 200(L)").w as { blank: string };
    expect("blank" in odd).toBe(true);
    expect(odd.blank).toContain("not a single number");
  });

  it("the rules downstream of the split are untouched: the box surface, the W x H conversion, the per-metre grille height, and a cross-talk SKU", () => {
    // every figure here is the figure the SAME row carried before this slice (the live replay's baseline)
    // a mixing box: per-sq.m cost x 2(WH + HD + WD) + 150, from a THREE-part phrase in one field
    const box = price12("Nos", ext({ family: "mixing box / LP plenum", insulated: "with", size_mm: "600 x 600 x 350" }));
    expect(box.priced).toBe(true);
    // a VCD per number: per-sq.m rate x W x H (R11)
    const vcd = price12("Nos", ext({ family: "VCD", variant: "GI rectangular", size_mm: "550X300" }));
    expect([vcd.priced, vcd.supply, vcd.install]).toEqual([true, 1292, 317]);
    // a per-metre grille: per-sq.m rate x HEIGHT in metres (R4) -- the height reached it from one field
    const grille = price12("RM", ext({ family: "linear grille", damper: "without", size_mm: "250 mm high" }));
    expect([grille.priced, grille.supply, grille.install]).toEqual([true, 1208, 220]);
    // a cross-talk silencer matches its stocked W x H pair
    const xt = price12("Nos", ext({ family: "cross-talk", size_mm: "200 x 200" }));
    expect([xt.priced, xt.supply, xt.install]).toEqual([true, 557, 192]);
    // and the axis-labelled plenum that reads correctly ONLY because the labels order it
    const lab = price12("Nos", ext({ family: "mixing box / LP plenum", insulated: "with", size_mm: "1100(W) X 250(D) X 400(H)" }));
    expect([lab.priced, lab.supply, lab.install]).toEqual([true, 3125, 0]);
  });

  it("NEGATIVE: a family that needs a depth still refuses when the phrase gives only two axes", () => {
    // the phrase states width and height and says NOTHING about a depth, so the third axis is NOT STATED and
    // the per-number conversion refuses in its own words -- byte-identical to the refusal a blank depth field
    // produced before this slice
    const r = price12("Nos", ext({ family: "mixing box / LP plenum", insulated: "with", size_mm: "600 x 600" }));
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("per-number row: no width and height and depth stated to convert the per-sq.m rate");
    const was = priceItemList(spec11, items11, "Nos", [ext({ family: "mixing box / LP plenum", insulated: "with", face_w_mm: "600", face_h_mm: "600" })]);
    expect(was.reason).toBe(r.reason);
  });
});

describe("slice 9 / A-4 -- the OUTER size is a SECOND key, never a replacement", () => {
  const SQ = { family: "square diffuser", damper: "without" };

  it("case 1: neck stated, outer not -- byte-identical to before the slice", () => {
    const now = price12("Nos", ext({ ...SQ, neck_mm: "375 x 375" }));
    const was = priceItemList(spec11, items11, "Nos", [ext({ ...SQ, neck_mm: "375 x 375" })]);
    expect([now.priced, now.supply, now.install]).toEqual([was.priced, was.supply, was.install]);
    expect(skuOf(now)).toBe("Diffuser Without Al Collar Damper / NECK:375X375/OUTER: 595X595 (600X600)");
    // NEGATIVE: no second-key note anywhere -- nothing resolved, so nothing is claimed
    expect(working(now).join(" ")).not.toContain("outer size");
  });

  it("case 2: BOTH stated -- the outer narrows, the neck ladders inside it", () => {
    const r = price12("Nos", ext({ ...SQ, neck_mm: "225 x 225", size_mm: "600 x 600" }));
    expect(r.priced).toBe(true);
    // the stated 225 is not a stocked rung: next size up is 300, inside the 595x595 outer
    expect(skuOf(r)).toBe("Diffuser Without Al Collar Damper / NECK:300X300/OUTER: 595X595 (600X600)");
    expect(working(r).join(" | ")).toContain("the outer size 600x600 is the sheet's 595x595 (A-5)");
  });

  it("case 3a: outer stated, neck not, SEVERAL SKUs behind it -- the largest neck, named", () => {
    const r = price12("Nos", ext({ ...SQ, size_mm: "600 x 600" }));
    expect([r.priced, r.supply, r.install]).toEqual([true, 1813, 400]);
    expect(skuOf(r)).toBe("Diffuser Without Al Collar Damper / NECK:450X450/OUTER: 595X595 (600X600)");
    expect(working(r).join(" | ")).toContain("matched on the outer size 595x595; largest neck size behind it is 450 (A-4)");
    // NEGATIVE, on v11: the same answer refused, which is the defect A-4 answers
    const was = priceItemList(spec11, items11, "Nos", [ext({ ...SQ, face_w_mm: "600", face_h_mm: "600" })]);
    expect(was.priced).toBe(false);
    expect(was.reason).toContain("no neck size stated");
  });

  it("case 3b: outer stated, neck not, ONLY ONE SKU behind it -- that SKU is adopted as it stands, its own damper named", () => {
    // the 1200x300 diffuser is the sheet's only one at that outer, and it is a WITH-damper row. The owner's
    // ruling is to use it; the working says where the damper came from, so a pricer is never surprised by it.
    const r = price12("Nos", ext({ family: "square diffuser", size_mm: "1200x300" }));
    expect([r.priced, r.supply, r.install]).toEqual([true, 2755, 576]);
    expect(skuOf(r)).toBe("Diffuser With Al Collar Damper / 1200MM X300MM");
    const w = working(r).join(" | ");
    expect(w).toContain("only one SKU carries the outer size 1200x300 -- used it");
    expect(w).toContain("taken from that SKU");
    // and the neck, which that SKU does not carry, stopped being a requirement rather than refusing the row
    expect(r.items[0].selection.neck_mm).toBeUndefined();
  });

  it("case 4: NEITHER stated -- refuses for the neck, exactly as before", () => {
    const r = price12("Nos", ext({ ...SQ }));
    expect(r.priced).toBe(false);
    expect(r.reason).toContain("no neck size stated");
    expect(working(r).join(" ")).not.toContain("outer size");
  });

  it("the no-match fallback: a stated outer the catalogue does not stock is SET ASIDE, the neck prices the row, and the panel says so", () => {
    const r = price12("Nos", ext({ ...SQ, neck_mm: "300 x 300", size_mm: "450 x 450" }));
    expect([r.priced, r.supply, r.install]).toEqual([true, 1532, 400]);
    expect(skuOf(r)).toBe("Diffuser Without Al Collar Damper / NECK:300X300/OUTER: 595X595 (600X600)");
    expect(working(r).join(" | ")).toContain("the outer size 450x450 did not match the catalogue -- matched on the neck size instead (A-4)");
    // NEGATIVE: with no neck to fall back to there is nothing to price, and the row refuses as it always did
    const bare = price12("Nos", ext({ ...SQ, size_mm: "450 x 450" }));
    expect(bare.priced).toBe(false);
    expect(bare.reason).toContain("no neck size stated");
  });

  it("NEGATIVE: the second key reaches ONLY the families the config names it for", () => {
    // cross-talk keys on its face size directly and declares no second key: a size that matches no SKU
    // must still refuse, not silently fall back to something else
    const r = price12("Nos", ext({ family: "cross-talk", size_mm: "123 x 456" }));
    expect(r.priced).toBe(false);
    expect(working(r).join(" ")).not.toContain("did not match the catalogue");
  });
});

describe("slice 9 / A-5 -- the alternative name is CATALOGUE WORDING, not a tolerance", () => {
  it("the six 595x595 SKUs carry 600X600 in their own text, and the reader derived it", () => {
    const alts = items12.filter((i) => (i.attributes as Record<string, unknown>).face_alt_w_mm !== undefined);
    expect(alts.length).toBe(6);
    for (const it of alts) {
      const a = it.attributes as Record<string, unknown>;
      expect(String(a.item_detail)).toContain("(600X600)");
      expect([a.face_w_mm, a.face_h_mm]).toEqual([595, 595]);
      expect([a.face_alt_w_mm, a.face_alt_h_mm]).toEqual([600, 600]);
    }
  });

  it("NEGATIVE: nothing treats 600 as near enough to 595 -- a size the catalogue does not name does not match", () => {
    // 596x596 appears in the corpus and is NOT an alternative name on any SKU: it falls back to the neck
    const r = price12("Nos", ext({ family: "square diffuser", damper: "without", neck_mm: "375 x 375", size_mm: "596 x 596" }));
    expect(working(r).join(" | ")).toContain("the outer size 596x596 did not match the catalogue");
    // and with no neck it cannot price at all -- there is no rounding anywhere
    const bare = price12("Nos", ext({ family: "square diffuser", damper: "without", size_mm: "596 x 596" }));
    expect(bare.priced).toBe(false);
  });
});

describe("slice 9 / A-6 -- an overridden field shows the catalogue's own word, and stays editable", () => {
  it("the Variant field reads 'UL 555' on an overridden row, with the rule beneath, and the VALUE stays a real option", () => {
    const r = price12("Sq.m", ext({ family: "fire damper", ul: "yes", variant: "motorised" }));
    expect([r.priced, r.supply, r.install]).toEqual([true, 21750, 1920]);
    expect(r.items[0].overrides).toEqual([
      { attr: "variant", value: "UL", display: "UL 555", rule: "UL stated, so the UL 555 SKU is used (R-M-b)" },
    ]);
    // the note is UNCHANGED from slice 8 -- the display is an addition, not a replacement
    expect(working(r)).toContain("UL stated, so the UL 555 SKU is used (R-M-b)");
    // and the value the panel selects is a value the field's own options carry, so the control cannot fall
    // back to another option (the controlled-select trap, frontend/CLAUDE.md)
    const fields = itemFieldDefs(spec12, listSpecDefs(adp12), "fire damper", "area", { items: items12 });
    const variant = fields.find((f) => f.skuAttr === "variant")!;
    expect(variant.options).toContain("UL");
    expect(variant.options).not.toContain("UL 555");
  });

  it("NEGATIVE: a row whose variant the override did NOT decide records no override at all", () => {
    const r = price12("Sq.m", ext({ family: "fire damper", ul: "no", variant: "motorised" }));
    expect(r.items[0].overrides).toEqual([]);
    // and a row ALREADY on the overridden value is byte-identical: the rule fires only when it CHANGES something
    const already = price12("Sq.m", ext({ family: "fire damper", ul: "yes", variant: "UL" }));
    expect(already.items[0].overrides).toEqual([]);
    expect([already.priced, already.supply, already.install]).toEqual([true, 21750, 1920]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 11 (2026-09-25) -- absent means NOT MENTIONED for damper / insulated / variant; four unit synonyms;
// the square foot as a different unit of the area class; a slash pair takes the higher value.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const asset13 = HVAC_V13 as unknown as Asset;
const items13: RateMasterItem[] = asset13.items.map((i) => ({ ...i, discipline: "HVAC" }));
const adp13 = asset13.category_configs.find((c) => c.category_id === "hvac_adp")!;
const spec13 = itemListPricingSpec(adp13)!;
const skuOf13 = (r: ReturnType<typeof priceItemList>, i = 0) =>
  `${r.items[i].sku?.item_name} / ${r.items[i].sku?.item_detail}`;

describe("slice 11 / v13 = v12 + the declared edits, and NOTHING else", () => {
  it("the ADP config differs ONLY by absent_as_none on three defaults, the four unit synonyms, unit_factors and the two def notes; every other config and EVERY item is byte-identical", () => {
    expect(asset13.category_configs.slice(1)).toEqual(asset12.category_configs.slice(1));
    // the items did NOT move at all this slice -- no catalogue cell was touched
    expect(asset13.items).toEqual(asset12.items);

    // F-1: the key `ul` already carried (owner S6) is now on three more defaults, and on NO others
    const withKey = (s: ItemListPricingSpec) =>
      Object.entries(s.defaults ?? {}).filter(([, d]) => (d as { absent_as_none?: boolean }).absent_as_none).map(([k]) => k).sort();
    expect(withKey(spec12)).toEqual(["ul"]);                                     // NEGATIVE: v12 = UL only
    expect(withKey(spec13)).toEqual(["damper", "insulated", "ul", "variant"]);

    // F-2: four TRUE synonyms, and sqft is NOT one of them -- in EITHER version
    expect(spec13.unit_classes.length).toEqual([...spec12.unit_classes.length, "mtrs", "rmts"]);
    expect(spec13.unit_classes.area).toEqual([...spec12.unit_classes.area, "smt", "sq. mtr"]);
    for (const cls of Object.values(spec13.unit_classes)) {
      for (const s of cls) expect(s.replace(/\.$/, "")).not.toMatch(/^(sqft|sq ?\.?ft|sft)$/i);
    }

    // F-2b: the square foot is declared as a DIFFERENT unit of the area class, never as a spelling of it
    expect(spec12.unit_factors).toBeUndefined();                                 // NEGATIVE: v12 has none
    expect(Object.keys(spec13.unit_factors!).sort()).toEqual(["sft", "sq ft", "sq.ft", "sqft"]);
    for (const d of Object.values(spec13.unit_factors!)) {
      expect(d).toEqual({ class: "area", factor: 0.0929, word: "sq.ft" });
    }

    // and the strip below proves the list above is exhaustive
    const strip = (a: Asset) => {
      const c = JSON.parse(JSON.stringify(a.category_configs[0])) as RateCategoryConfig;
      const p = (c as unknown as { list_spec: { pricing: Record<string, unknown>; attribute_definitions: Array<Record<string, unknown>> } }).list_spec;
      for (const k of ["damper", "insulated", "variant"]) {
        delete (p.pricing.defaults as Record<string, Record<string, unknown>>)[k].absent_as_none;
        delete (p.pricing.defaults as Record<string, Record<string, unknown>>)[k].rule;
      }
      delete p.pricing.unit_factors;
      const uc = p.pricing.unit_classes as Record<string, string[]>;
      uc.length = uc.length.filter((s) => !["mtrs", "rmts"].includes(s));
      uc.area = uc.area.filter((s) => !["smt", "sq. mtr"].includes(s));
      for (const d of p.attribute_definitions) if (["family", "damper"].includes(String(d.id))) delete d.note;
      return c;
    };
    expect(strip(asset13)).toEqual(strip(asset12));
  });
});

describe("slice 11 / F-1 -- an ABSENT answer means NOT MENTIONED, so the ruled default fires", () => {
  // Owner ruling 2026-09-25 on the slice-10 evidence: of 70 omitted slots read by hand, 70 of 70 were rows
  // that genuinely do not state the fact; corpus-wide only 12 of 2,208 sat on a row whose text does state it.
  // This widens the key `ul` has carried since S6 to damper, insulated and variant -- and it SUPERSEDES the
  // earlier "damper and insulation keep absent = blank" line in root CLAUDE.md.
  const p13 = (unit: string, ...its: ExtractedListItem[]) => priceItemList(spec13, items13, unit, its);
  const p12 = (unit: string, ...its: ExtractedListItem[]) => priceItemList(spec12, items12, unit, its);
  const defaulted = (r: ReturnType<typeof p13>, i = 0) =>
    r.items[i].defaulted.map((d) => `${d.attr}=${d.value}`).sort();

  it("a LEFT-OUT damper prices the row on the ruled default, and the panel is told it is a default", () => {
    const row = ext({ family: "linear grille", size_mm: "600 x 600", damper: null, air: "None", insulated: "None", variant: "None" });
    const r = p13("Sqm", row);
    expect([r.priced, r.items[0].selection.damper]).toEqual([true, "without"]);
    expect(defaulted(r)).toContain("damper=without");
    // NEGATIVE, the same row on v12: it REFUSED, in the owner's words
    const before = p12("Sqm", ext({ family: "linear grille", size_mm: "600 x 600", damper: null, air: "None", insulated: "None", variant: "None" }));
    expect(before.priced).toBe(false);
    expect(before.reason).toBe("could not tell whether it is with or without a damper");
  });

  it("a LEFT-OUT insulated and a LEFT-OUT variant do the same, each on its own ruled value", () => {
    const box = p13("Nos", ext({ family: "mixing box / LP plenum", size_mm: "525 x 525 x 450 mm", insulated: null }));
    expect(box.priced).toBe(true);
    expect(box.items[0].selection.insulated).toBe("with");
    expect(defaulted(box)).toContain("insulated=with");
    const vcd = p13("Sqm", ext({ family: "VCD", variant: null, damper: "None", insulated: "None" }));
    expect(vcd.priced).toBe(true);
    expect(vcd.items[0].selection.variant).toBe("GI rectangular");
    expect(defaulted(vcd)).toContain("variant=GI rectangular");
  });

  it("⚠️ NEGATIVE: a STATED value still wins, and it is NOT marked as a default", () => {
    const r = p13("Sqm", ext({ family: "VCD", variant: "motorised", damper: "None", insulated: "None" }));
    expect(r.items[0].selection.variant).toBe("motorised");
    expect(defaulted(r)).not.toContain("variant=GI rectangular");
    expect(skuOf13(r)).toContain("Motorized");
  });

  it("⚠️ NEGATIVE: \"None\" is unchanged -- absent and \"None\" now reach the SAME figure, which is the point", () => {
    const absent = p13("Sqm", ext({ family: "linear grille", size_mm: "600 x 600", damper: null, air: "None", insulated: "None", variant: "None" }));
    const none = p13("Sqm", ext({ family: "linear grille", size_mm: "600 x 600", damper: "None", air: "None", insulated: "None", variant: "None" }));
    expect([absent.supply, absent.install]).toEqual([none.supply, none.install]);
    expect(defaulted(absent)).toEqual(defaulted(none));
  });

  it("⚠️ NEGATIVE: a config WITHOUT the key still omits the attribute -- the behaviour is the key's, not the code's", () => {
    const noKey = JSON.parse(JSON.stringify(spec13)) as ItemListPricingSpec;
    delete (noKey.defaults!.damper as { absent_as_none?: boolean }).absent_as_none;
    const r = priceItemList(noKey, items13, "Sqm", [ext({ family: "linear grille", size_mm: "600 x 600", damper: null, air: "None", insulated: "None", variant: "None" })]);
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("could not tell whether it is with or without a damper");
  });

  it("⚠️ NEGATIVE: ul is untouched -- its rule and its behaviour are the same on both versions", () => {
    const mk = () => ext({ family: "fire damper", size_mm: "600 x 600", ul: null, variant: "None", damper: "None", insulated: "None" });
    const a = p12("Sqm", mk());
    const b = p13("Sqm", mk());
    expect([a.priced, a.supply]).toEqual([b.priced, b.supply]);
  });
});

describe("slice 11 / F-2 -- four TRUE synonyms, and three strings that are not units at all", () => {
  it("every spelling the live corpus writes resolves to the right class, in every case and with a trailing dot", () => {
    for (const u of ["Mtrs", "mtrs", "Mtrs.", "MTRS", "Rmts", "rmts"]) expect(unitClassOf(spec13, u), u).toBe("length");
    for (const u of ["SMT", "smt", "Sq. Mtr", "sq. mtr", "Sq. Mtr."]) expect(unitClassOf(spec13, u), u).toBe("area");
    // the spellings the table ALREADY held are untouched
    for (const u of ["Sqm", "sq.mtr", "Rmt", "Nos"]) expect(unitClassOf(spec13, u), u).toBe(unitClassOf(spec12, u));
  });

  it("⚠️ NEGATIVE: Lot, R/O and Cum are not units of measure and keep refusing in today's words", () => {
    for (const u of ["Lot", "R/O", "Cum"]) {
      expect(unitClassOf(spec13, u), u).toBeNull();
      const r = priceItemList(spec13, items13, u, [ext({ family: "VCD", variant: "None", damper: "None", insulated: "None" })]);
      expect(r.priced, u).toBe(false);
      expect(r.reason, u).toBe(`unit '${u}' is not a count, area or length unit (R12)`);
    }
  });

  it("⚠️ NEGATIVE: on v12 all four synonyms were unknown -- so the four entries above are what changed", () => {
    for (const u of ["Mtrs", "Rmts", "SMT", "Sq. Mtr"]) expect(unitClassOf(spec12, u), u).toBeNull();
  });
});

describe("slice 11 / F-2b -- a square foot is a DIFFERENT unit of the area class, and the RATE converts", () => {
  // Owner ruling 2026-09-25. 1 sq.ft is exactly 0.09290304 sq.m; the declared factor is the owner's 0.0929,
  // and declaring, computing and SHOWING one number matters more than 0.0033% -- which is far below the
  // 1-rupee ROUNDUP granularity on every rate this catalogue holds.
  const p13 = (unit: string, ...its: ExtractedListItem[]) => priceItemList(spec13, items13, unit, its);
  const vcd = () => ext({ family: "VCD", variant: "GI rectangular", damper: "None", insulated: "None" });

  it("every sq.ft spelling the live committed tier holds resolves to the area class WITH the factor", () => {
    // the 9 spellings and their row counts, surveyed 2026-09-25 over the whole committed tier:
    // Sqft 15, Sq ft 5, Sqft. 4, Sq.ft 3, SQFT 3, SFT 2, Sq.Ft. 2, Sft 1, sqft 1 -- 36 rows
    for (const u of ["Sqft", "Sq ft", "Sqft.", "Sq.ft", "SQFT", "SFT", "Sq.Ft.", "Sft", "sqft"]) {
      expect(unitClassOf(spec13, u), u).toBe("area");
      expect(unitFactorOf(spec13, u), u).toEqual({ class: "area", factor: 0.0929, word: "sq.ft" });
    }
  });

  it("the owner's stated test: the GI rectangular VCD prices 728 per sq.ft, and the working says how", () => {
    const perSqm = p13("Sqm", vcd());
    expect([perSqm.priced, perSqm.supply, perSqm.install]).toEqual([true, 7830, 1920]);
    const perSqft = p13("Sqft", vcd());
    expect([perSqft.priced, perSqft.supply, perSqft.install]).toEqual([true, 728, 179]);
    expect(perSqft.items[0].working).toContain("per sq.ft: sq.m rate x 0.0929");
    // the arithmetic, spelled out: the RATE is converted and then rounded, and the quantity is untouched
    expect(Math.ceil(7830 * 0.0929)).toBe(728);
    expect(Math.ceil(1920 * 0.0929)).toBe(179);
    expect(perSqft.items[0].qty).toBe(1);
  });

  it("⚠️ NEGATIVE: a TRUE synonym carries no factor and its figure does not move", () => {
    for (const u of ["SMT", "Sq. Mtr", "Sqm", "sq.mtr"]) {
      expect(unitFactorOf(spec13, u), u).toBeNull();
      const r = p13(u, vcd());
      expect([r.priced, r.supply, r.install], u).toEqual([true, 7830, 1920]);
      expect(r.items[0].working.join(" | "), u).not.toContain("sq.ft");
    }
  });

  it("⚠️ NEGATIVE: a unit with NO declared factor and no spelling still refuses in today's words", () => {
    expect(unitFactorOf(spec13, "Lot")).toBeNull();
    expect(unitFactorOf(spec13, "")).toBeNull();
    expect(unitFactorOf(spec13, null)).toBeNull();
    const r = p13("Sqft2", vcd());
    expect(r.reason).toBe("unit 'Sqft2' is not a count, area or length unit (R12)");
  });

  it("⚠️ NEGATIVE: on v12 nothing declares a factor, so a sq.ft row refused -- that is what changed", () => {
    expect(unitFactorOf(spec12, "Sqft")).toBeNull();
    expect(unitClassOf(spec12, "Sqft")).toBeNull();
    const r = priceItemList(spec12, items12, "Sqft", [vcd()]);
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("unit 'Sqft' is not a count, area or length unit (R12)");
  });

  it("⚠️ NEGATIVE: a unit_classes spelling ALWAYS wins -- a unit is declared in one place only", () => {
    const both = JSON.parse(JSON.stringify(spec13)) as ItemListPricingSpec;
    both.unit_classes.area.push("sqft");        // the shape the backend validator refuses outright
    expect(unitFactorOf(both, "Sqft")).toBeNull();
    expect(unitClassOf(both, "Sqft")).toBe("area");
  });
});

describe("slice 11 / F-3 -- a value written as an ALTERNATIVE takes the HIGHER, and says so", () => {
  // Owner ruling 2026-09-25 ("take the higher value"), consistent with the next-size-up ladder and the area
  // band. Every phrase below is one the model actually produced on the 1,151-row audit corpus.
  const W: NumberReader = { from: ["size_mm"], name: "width", unit: "mm", component: 1 };
  const H: NumberReader = { from: ["size_mm"], name: "height", unit: "mm", component: 2 };
  const D: NumberReader = { from: ["size_mm"], name: "depth", unit: "mm", component: 3 };
  const RATIO: NumberReader = { from: ["panel_ratio"], name: "panel ratio", ratio: true };
  const DIA: NumberReader = { from: ["dia_mm"], name: "diameter", unit: "mm" };
  const TORQUE: NumberReader = { from: ["torque"], name: "torque", unit: "nm" };
  const THK: NumberReader = { from: ["thickness_mm"], name: "plenum thickness", unit: "mm" };

  const TABLE: Array<[string, number | null, number | null, number | null]> = [
    ["375x 375 x 350/400 mm High", 375, 375, 400],
    ["450x 450 x 350/400 mm High", 450, 450, 400],
    ["600x 600 x 350/400 mm High", 600, 600, 400],
    ["1050x 100/150 x 300/350 mm High", 1050, 150, 350],
    ["600x 100/150 x 350/400 mm High", 600, 150, 400],
    ["750x 100/150 x350/400 mm High", 750, 150, 400],
    ["900/1000x 100/150 x 350/400 mm High", 1000, 150, 400],
    ["1150x100/150 x 400 mm High", 1150, 150, 400],
    ["600/750x600/150 x 400 mm High", 750, 600, 400],
    ["900/1000x 150 x 400 mm High", 1000, 150, 400],
    ["600/750 x 150 x 400 mm High", 750, 150, 400],
    ["1050x 150 x 300/350 mm High", 1050, 150, 350],
    ["900/1000x 150/300 x 350/400 mm High", 1000, 300, 400],
  ];

  it.each(TABLE)("%s -> width %s, height %s, depth %s", (text, w, h, d) => {
    const read = (r: NumberReader) => {
      const got = readNumber(text, r);
      return got && "value" in got ? got.value : null;
    };
    expect([read(W), read(H), read(D)]).toEqual([w, h, d]);
  });

  it("the note names the value taken and why, on every axis that resolved a pair", () => {
    const got = readNumber("900/1000x 100/150 x 350/400 mm High", W);
    expect(got).toEqual({ value: 1000, note: "'900/1000' states two values -- the higher, 1000, is taken" });
    expect(readNumber("375x 375 x 350/400 mm High", D)).toEqual({
      value: 400, note: "'350/400 mm High' states two values -- the higher, 400, is taken",
    });
  });

  it("a ratio and a diameter take the higher too -- the ruling is about a value, not only a size", () => {
    expect(readNumber("10/12 Module", RATIO)).toEqual({ value: 12, note: "'10/12 Module' states two values -- the higher, 12, is taken" });
    expect(readNumber("4/6 Module", RATIO)).toEqual({ value: 6, note: "'4/6 Module' states two values -- the higher, 6, is taken" });
    const dia = readNumber("150/200mm dia", DIA);
    expect(dia && "value" in dia ? dia.value : null).toBe(200);
  });

  it("⚠️ NEGATIVE: three values are not a pair, and a COMMA list is not one either -- both refuse BY NAME", () => {
    expect(readNumber("6/8 / 10 Port", RATIO)).toEqual({ blank: "several values stated for panel ratio ('6/8 / 10 Port')" });
    expect(readNumber("3.5, 7.9 & 15.9 Nm", TORQUE)).toEqual({
      blank: "several values stated for torque ('3.5, 7.9 & 15.9 Nm')",
    });
    expect(readNumber("100/150/200 mm", W)).toEqual({ blank: "several values stated for width ('100/150/200 mm')" });
    expect(splitSizePhrase("100/150/200 mm")).toBeNull();
  });

  it("⚠️ NEGATIVE: a TOLERANCE is not an alternative -- '25 +/- 2 mm' keeps refusing", () => {
    expect(readNumber("25 +/- 2 mm", THK)).toEqual({
      blank: "several values stated for plenum thickness ('25 +/- 2 mm')",
    });
  });

  it("⚠️ NEGATIVE: a plain size and a RANGE are byte-identical to before -- nothing else moved", () => {
    expect(splitSizePhrase("1100(W) X 250(D) X 400(H)")).toEqual(["1100(W)", "400(H)", "250(D)"]);
    expect(splitSizePhrase("375x375x375")).toEqual(["375", "375", "375"]);
    expect(readNumber("250 mm high", H)).toEqual({ value: 250 });
    expect(readNumber("10-12 NM", TORQUE)).toEqual({
      value: 12, note: "range '10-12 NM' -> its top value 12 (R6)",
    });
  });

  it("the alternative rule is NARROW by construction: the gap must be a bare slash, never one carrying a sign", () => {
    const code = readFileSync(join(__dirname, "itemListPricing.ts"), "utf-8");
    const fn = code.slice(code.indexOf("function isAltPair"), code.indexOf("}", code.indexOf("function isAltPair")) + 1);
    expect(fn).toContain("\\/");
    expect(fn).not.toContain("+");          // a '+' in the gap is a tolerance, and must not be admitted
    expect(fn).not.toContain(",");          // nor a comma: a comma list is not an alternative
  });
});
