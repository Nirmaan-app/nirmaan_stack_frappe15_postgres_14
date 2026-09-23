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
  unitClassOf,
  type ExtractedListItem,
} from "./itemListPricing";

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
  it("NEGATIVE (P8): the helper does not import this module, and no panel / calculator / grid file does", () => {
    const dir = __dirname;
    const files = [
      join(dir, "pricingSheetHelper.ts"), join(dir, "RateHelperPanel.tsx"), join(dir, "rateHelperPlumbing.tsx"),
      join(dir, "../SheetPricingPage.tsx"), join(dir, "../PricingGrid.tsx"), join(dir, "../../pricing/PricingCalculator.tsx"),
    ];
    for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(/itemListPricing/);
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
  it("NEGATIVE: SEVERAL values = blank (a list is not a range)", () => {
    for (const t of ["4, 8, 10 N-M", "3.5, 7.9 & 15.9 NM", "9/10 NM"]) {
      const r = one("Nos", { family: "actuator", ul: "None", torque: t });
      expect(r.priced).toBe(false);
      expect(r.reason).toBe(`several values stated for torque ('${t}')`);
    }
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
  it("NEGATIVE: several stated ratios = blank; above the largest = refuse", () => {
    expect(one("Nos", { family: "control panel", panel_ratio: "10/12 Module" }).reason).toBe("several values stated for panel ratio ('10/12 Module')");
    expect(one("Nos", { family: "control panel", panel_ratio: "1:16" }).reason).toBe("panel ratio 16 is above the largest size on the sheet (12)");
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
    expect(readNumber("350/400", spec.numbers.face_h_mm)).toEqual({ blank: "several values stated for height ('350/400')" });
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
