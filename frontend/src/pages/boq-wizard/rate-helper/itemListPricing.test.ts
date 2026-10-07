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
import {
  isEligibleConfig, hasRunnablePricingRules,
  makePricingSheetHelper, declineReasonFor,
} from "./pricingSheetHelper";
// SLICE 12c FINISH / FA7 -- the admission is read from the SHIPPED asset, never a fixture
import HVAC_V25 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v25.json";
import HVAC_V26 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v26.json";
import HVAC_V27 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v27.json";
import { DISPLAY_RATE_KINDS, type RateHelperRowContext } from "./rateHelperTypes";
import {
  familyWhenNone,
  isRateOnlyUnit,
  itemListPricingSpec,
  priceItemList,
  rowUnitClasses,
  projectUnitClass,
  readLayers,
  readNumber,
  splitSizePhrase,
  unitClassOf,
  unitFactorOf,
  type ExtractedListItem,
  type ItemListPricingSpec,
  type NumberReader,
  splitRateOnlyUnit,
  wordStartHit,
} from "./itemListPricing";
import HVAC_V8 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v8.json";
import HVAC_V9 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v9.json";
import HVAC_V10 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v10.json";
import HVAC_V11 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v11.json";
import HVAC_V12 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v12.json";
import HVAC_V13 from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v13.json";
import { familyChoices, familyUnitClasses, fieldOptionsFromSkus, itemFieldDefs, listSpecDefs, ruledDefaultValue, sizeFieldHelp, typedFieldNote } from "./itemListPricing";
import { auditPanelFields, missingNotes } from "./panelFieldAudit";

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

describe("slice 5 / the block is read off the config (P8 -- INVERTED by 12d-2: the predicate now reads the block)", () => {
  it("v7 carries list_spec.pricing for 25 families; 12d-2's predicate reads a fully-piped block as rules that run", () => {
    expect(spec).not.toBeNull();
    expect(Object.keys(spec.families).length).toBe(25);
    expect(spec.kind).toBe("hvac_adp_item");
    // P8 (slice 5) pinned `isEligibleConfig(adp) === false` with pipelines {} -- the predicate then read
    // top-level pipelines only. INVERTED by 12d-2 (owner S1), NOT deleted: v7's every unit block carries
    // its own pipelines, so the generic predicate now reads this frozen file as eligible. `pipelines` is
    // still {} -- the first claim stands.
    expect(adp.pipelines).toEqual({});
    expect(isEligibleConfig(adp)).toBe(true);
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

/**
 * SLICE 12c-U (owner U1-U5, 2026-10-07) -- A ROW THAT STATES NO UNIT, OR "RATE ONLY".
 *
 * Plain English, one line per test:
 *   the four spellings of "rate only" are ONE thing, and nothing else is
 *   a blank unit on a one-unit item PRICES in that unit and says so
 *   a rate-only unit does the same, quoting what the BoQ actually wrote
 *   an item priced in SEVERAL units REFUSES and names them -- it never guesses (U4)
 *   a unit the row STATED that the item cannot take still refuses, unchanged (U1)
 *   the set of units comes from `familyUnitClasses` -- the same function the picker reads
 *   an item with no family at all still refuses, in today's words
 */
describe("slice 12c-U / no unit or rate-only -> the catalogue's unit, or a named choice", () => {
  it("the rate-only spellings are one thing, and a real unit is never one of them", () => {
    for (const u of ["R/O", "RO", "R.O.", "r/o", "ro", "R O", "Rate Only", "rate only", "RATE-ONLY", " R/O "]) {
      expect(isRateOnlyUnit(u), u).toBe(true);
    }
    // NEGATIVE: a blank is NOT "rate only" (it is its own case), and no unit of measure is
    for (const u of ["", "   ", "Nos", "Sqm", "Rmt", "Lot", "Cum", "Rolls", "Round", "Rod"]) {
      expect(isRateOnlyUnit(u), u).toBe(false);
    }
    // NEGATIVE, the load-bearing one: every rate-only spelling is UNKNOWN to the unit table, so the
    // unit lookup -- which runs FIRST -- can never be shadowed by this rule.
    for (const u of ["R/O", "RO", "R.O.", "Rate Only"]) expect(unitClassOf(spec, u), u).toBeNull();
  });

  it("a blank unit on a one-unit item prices in that unit and says so (U2)", () => {
    const r = one("", { family: "butterfly damper", dia_mm: "100" });
    expect(r.priced).toBe(true);
    expect(r.unitClass).toBe("count");
    expect(r.unitNote).toBe("No unit on the BoQ row -> priced per number, the catalogue's unit for this item");
  });

  it("a rate-only unit does the same, quoting what the BoQ wrote (U3)", () => {
    for (const u of ["R/O", "Rate Only"]) {
      const r = one(u, { family: "butterfly damper", dia_mm: "100" });
      expect(r.priced, u).toBe(true);
      expect(r.unitClass, u).toBe("count");
      expect(r.unitNote, u).toBe(`BoQ says ${u} (rate only) -> priced per number, the catalogue's unit for this item`);
    }
  });

  it("the figures are the ones that unit always gave -- resolving the unit changes no arithmetic", () => {
    const resolved = one("", { family: "butterfly damper", dia_mm: "100" });
    const stated = one("Nos", { family: "butterfly damper", dia_mm: "100" });
    expect(resolved.supply).toBe(stated.supply);
    expect(resolved.install).toBe(stated.install);
    // ...and the STATED row carries no note, because nothing had to be resolved for it
    expect(stated.unitNote).toBeUndefined();
  });

  it("an item priced in SEVERAL units refuses and NAMES them -- it never guesses (U4)", () => {
    for (const u of ["", "R/O"]) {
      const r = one(u, { family: "VCD", variant: "None", damper: "None", insulated: "None" });
      expect(r.priced, u).toBe(false);
      expect(r.unitNote, u).toBeUndefined();
      expect(r.reason, u).toContain("this item is priced per sq.m or per number; set the unit");
      expect(r.reason, u).toContain(u === "" ? "No unit on the BoQ row" : "BoQ says R/O (rate only)");
    }
  });

  it("NEGATIVE (U1): a unit the row STATED that this item cannot take still refuses, unchanged", () => {
    // spigot is priced by number only; a row written per metre said something, and it was wrong
    const r = one("Rmt", { family: "spigot", dia_mm: "200" });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("no SKU per metre for spigot");
    expect(r.unitNote).toBeUndefined();
  });

  it("the offered set IS `familyUnitClasses` -- one source, not a second list", () => {
    expect(rowUnitClasses(spec, [ext({ family: "butterfly damper", dia_mm: "100" })]))
      .toEqual(familyUnitClasses(spec, "butterfly damper"));
    expect(rowUnitClasses(spec, [ext({ family: "VCD", variant: "None" })]))
      .toEqual(familyUnitClasses(spec, "VCD"));
    // a row of SEVERAL items can only be priced in a class EVERY item supports -- the intersection
    const mixed = rowUnitClasses(spec, [
      ext({ family: "VCD", variant: "None" }),           // [area, count]
      ext({ family: "butterfly damper", dia_mm: "100" }), // [count]
    ]);
    expect(mixed).toEqual(["count"]);
  });

  it("NEGATIVE: an item with no family contributes nothing, so the row still refuses in today's words", () => {
    expect(rowUnitClasses(spec, [ext({ family: "None" })])).toEqual([]);
    expect(rowUnitClasses(spec, [])).toEqual([]);
    const r = one("", { family: "None" });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("no unit on this row (R12)");
    expect(r.unitNote).toBeUndefined();
  });
});

describe("slice 5 / R12 -- the row's unit decides the unit class; no unit = refuse with the reason", () => {
  it("POSITIVE: the spellings seen on real BoQs classify", () => {
    for (const [u, c] of [["Nos", "count"], ["No.", "count"], ["No's", "count"], ["EA", "count"], ["Sqm", "area"], ["Sq.m", "area"], ["SqM", "area"], ["Sqmt", "area"], ["M2", "area"], ["m²", "area"], ["Rmt", "length"], ["RM", "length"], ["Metre", "length"], ["M", "length"]]) {
      expect(unitClassOf(spec, u)).toBe(c);
    }
  });
  /**
   * INVERTED 2026-10-07 under the MECHANICAL AUTHORITY, NOT deleted (slice 12c-U, owner U2).
   *
   * This half used to assert that a row with NO unit refuses naming R12. The owner superseded that
   * for a MISSING unit: "no unit at all should be priced in the default unit of the SKU with proper
   * comment". Spigot is priced in exactly ONE class (count), so there is a default and the row now
   * prices in it, saying so.
   *
   * ⚠️ WHAT THE PIN WAS PROTECTING IS KEPT AND SHARPENED. The thing that must stay true is not "no
   * unit refuses", it is "a unit the row DID state and that is not a unit of measure still refuses,
   * in today's words" -- so `Lot` and `Cum` are asserted here unchanged, and they are the half that
   * would catch this rule leaking past the missing-unit case.
   */
  it("INVERTED: no unit now prices in the item's one catalogue unit; a stated non-unit still refuses", () => {
    const r = one("", { family: "spigot", dia_mm: "100" });
    expect(r.priced).toBe(true);
    expect(r.unitClass).toBe("count");
    expect(r.unitNote).toBe("No unit on the BoQ row -> priced per number, the catalogue's unit for this item");
    expect(r.items.length).toBe(1);
    // NEGATIVE, unchanged: a unit the row STATED that is not a unit of measure keeps refusing
    expect(one("Lot", { family: "spigot", dia_mm: "100" }).reason).toBe("unit 'Lot' is not a count, area or length unit (R12)");
    expect(one("Cum", { family: "spigot", dia_mm: "100" }).reason).toContain("Cum");
    // NEGATIVE: and neither of those carries a unit note -- the note belongs to the resolved case only
    expect(one("Lot", { family: "spigot", dia_mm: "100" }).unitNote).toBeUndefined();
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
    // SLICE 12d-1a (owner R6, pin INVERTED): the sentence is category-NEUTRAL now -- ADP's family def is
    // labelled "Item family", so it reads "no item family ..."; the old "ADP kind" wording must be GONE.
    const missingFamily = one("Nos", { family: null, dia_mm: "200" }).reason;
    expect(missingFamily).toBe("no item family could be told for this item");
    expect(missingFamily).not.toMatch(/ADP/);
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
  it("T7 -- ADP is ELIGIBLE on v8 by the SAME predicate every category answers (and, since 12d-2, on v7 by its fully-piped block); no other HVAC config moved", () => {
    expect(isEligibleConfig(adp8)).toBe(true);
    // INVERTED by 12d-2 (owner S1), NOT deleted: T7 pinned v7's ADP NOT eligible because the predicate
    // read top-level pipelines only; the 12d-2 predicate reads v7's fully-piped block as rules that run.
    expect(isEligibleConfig(adp)).toBe(true);
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
  it("itemFieldDefs: the family's needs for the row's unit class, labelled from the list_spec, options from the def (None first when allow_none AND no ruled default maps it -- 12d-2 S4)", () => {
    const defs = listSpecDefs(adp8);
    // slice 6b (V5): every field now names its control -- v8 declares none, so a choice is a dropdown from the
    // definition and a number is text, exactly slice 6's controls
    expect(itemFieldDefs(spec8, defs, "round diffuser", "count")).toEqual([
      // 12d-2 (owner S4, INVERTING the slice-6 "None first" half, NOT deleting it): the damper has a ruled default
      // ("not mentioned" -> without), so "None" is no longer OFFERED -- the field shows the default's value amber
      { id: "damper", label: "Damper", options: ["with", "without"], allowNone: true, skuAttr: "damper", control: "dropdown", optionSource: "definition" },
      { id: "dia_mm", label: "Diameter (as written)", allowNone: false, skuAttr: "dia_mm", control: "text" },
    ]);
    // the R13 source (air) rides along on a linear grille; a per-number VCD shows the conversion needs
    expect(itemFieldDefs(spec8, defs, "linear grille", "area").map((f) => f.id)).toEqual(["damper", "air"]);
    expect(itemFieldDefs(spec8, defs, "VCD", "count").map((f) => f.id)).toEqual(["variant", "face_w_mm", "face_h_mm", "area_band"]);
    // the variant's options come from values_by_family
    expect(itemFieldDefs(spec8, defs, "VCD", "area")[0].options).toEqual(["GI oval", "motorised", "GI rectangular"]);   // 12d-2 S4
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
      ["damper", "dropdown", ["with", "without"], "catalogue"],   // 12d-2 S4: a ruled default maps "None", so it is not offered
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
    // 12d-2 S4: UL carries a ruled default (not mentioned -> no), so "None" is not offered
    expect(ul({}).options).toEqual(["yes", "no"].filter((v) => stocked("actuator", "ul").includes(v)));
    expect(ul({ torque_nm: "20" }).options).toEqual(["yes", "no"].filter((v) => stocked("actuator", "ul", { torque_nm: "20" }).includes(v)));
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
    // 12d-2 S4: VCD's variant has a per-family ruled default (GI rectangular), so "None" is not offered
    expect(vcd[0].options).toEqual(["GI oval", "motorised", "GI rectangular"]);
    expect(vcd[0].optionSource).toBe("catalogue");
    expect(new Set(vcd[0].options!)).toEqual(new Set(stocked("VCD", "variant")));
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

  /**
   * PARTIALLY INVERTED 2026-10-07 under the MECHANICAL AUTHORITY, NOT deleted (slice 12c-U, owner
   * U3 / U4). `Lot` and `Cum` are untouched -- they are still not units of measure and still refuse
   * in today's words, which is two thirds of what this pin always protected.
   *
   * `R/O` moved, and ONLY `R/O`: the owner ruled it means RATE ONLY, not a unit -- "R/O is rate
   * only. tthese should also be priced in the default SKU unit with appropriate comment". The
   * fixture's family here is VCD, which is priced per sq.m OR by number, so there is NO single
   * default and U4 applies: it refuses and NAMES the choice rather than guessing one.
   *
   * ⚠️ `unitClassOf` STILL RETURNS NULL FOR ALL THREE, and that half is asserted for all three
   * unchanged -- the rate-only rule must never make `R/O` resolve as a unit; it only decides what
   * happens AFTER the unit lookup has failed.
   */
  it("⚠️ PARTIALLY INVERTED: Lot and Cum still refuse in today's words; R/O is rate only and names the choice", () => {
    for (const u of ["Lot", "R/O", "Cum"]) {
      expect(unitClassOf(spec13, u), u).toBeNull();
    }
    for (const u of ["Lot", "Cum"]) {
      const r = priceItemList(spec13, items13, u, [ext({ family: "VCD", variant: "None", damper: "None", insulated: "None" })]);
      expect(r.priced, u).toBe(false);
      expect(r.reason, u).toBe(`unit '${u}' is not a count, area or length unit (R12)`);
      expect(r.unitNote, u).toBeUndefined();
    }
    const ro = priceItemList(spec13, items13, "R/O", [ext({ family: "VCD", variant: "None", damper: "None", insulated: "None" })]);
    expect(ro.priced).toBe(false);
    expect(ro.reason).toBe("BoQ says R/O (rate only) - this item is priced per sq.m or per number; set the unit");
    expect(ro.unitNote).toBeUndefined();
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 12c commit 3 -- THE SEAM between the two pure rules and the pricer.
//
// `ladderResolution.test.ts` proves the RULES; these prove they are WIRED. A test on each side of a
// boundary is not a test of the boundary: the rules could be perfect and never called, or called on the
// wrong axis, and both suites would stay green.
//
// They run against the REAL ADP spec with the two blocks added, rather than a hand-built one, so what is
// exercised is the pipeline path a live row takes. ADP itself declares NEITHER block -- that is the
// negative half, and it is what keeps the shipped category byte-identical.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("slice 12c: size_match and compose, wired", () => {
  const SQ = "square diffuser";                 // neck rungs 300 / 375 / 450
  const withBlocks = (extra: Record<string, unknown>) => ({ ...spec, ...extra });

  it("NEGATIVE: the shipped ADP spec declares neither block, so nothing here can reach it", () => {
    expect(spec.size_match).toBeUndefined();
    expect(spec.compose).toBeUndefined();
    // and the unmodified spec still refuses above the top rung, in its own words
    const r = priceItemList(spec, items, "Nos", [ext({ family: SQ, damper: "None", neck_mm: "900 x 900" })]);
    expect(r.priced).toBe(false);
    expect(r.reason).toMatch(/above the largest size on the sheet \(450\)/);
  });

  describe("size_match", () => {
    const sm = withBlocks({ size_match: { dp: [2, 1] } });

    it("resolves a differently-written size onto its rung instead of laddering past it", () => {
      // 375.04 is 375.0 at 1 dp. It sits just ABOVE the rung, so WITHOUT the block the ladder does the
      // only thing it can and buys the NEXT size up (450) -- a size the row never asked for. This is the
      // real shape of D4's "19.1 -> 19.05": BELOW a rung the ladder already lands it, so the block earns
      // its place only above one.
      const bare = priceItemList(spec, items, "Nos", [ext({ family: SQ, damper: "None", neck_mm: "375.04 x 375.04" })]);
      const wired = priceItemList(sm, items, "Nos", [ext({ family: SQ, damper: "None", neck_mm: "375.04 x 375.04" })]);
      expect(bare.items[0].selection.neck_mm).toBe(450);
      expect(wired.items[0].selection.neck_mm).toBe(375);
      expect(wired.priced).toBe(true);
      expect(wired.supply).not.toBe(bare.supply);
    });

    it("says so in the working, and an EXACT size gains no line", () => {
      const w = priceItemList(sm, items, "Nos", [ext({ family: SQ, damper: "None", neck_mm: "375.04 x 375.04" })]);
      expect(w.items[0].working.some((l) => /375.04 is 375 on the sheet/.test(l))).toBe(true);
      const exact = priceItemList(sm, items, "Nos", [ext({ family: SQ, damper: "None", neck_mm: "375 x 375" })]);
      expect(exact.items[0].working.some((l) => /on the sheet/.test(l))).toBe(false);
    });

    it("NEGATIVE: a size that is genuinely between rungs still ladders UP, unchanged", () => {
      const r = priceItemList(sm, items, "Nos", [ext({ family: SQ, damper: "None", neck_mm: "400 x 400" })]);
      expect(r.items[0].selection.neck_mm).toBe(450);
      expect(r.items[0].working.some((l) => /not on the sheet -> 450 \(next size up, R6\)/.test(l))).toBe(true);
    });
  });

  describe("compose", () => {
    const cp = withBlocks({ compose: { attr: "neck_mm", tolerance: 2, max_layers: 4 } });

    it("a size above the top rung prices as SEVERAL layers, and the row is their sum", () => {
      const r = priceItemList(cp, items, "Nos", [ext({ family: SQ, damper: "None", neck_mm: "900 x 900" })]);
      expect(r.priced).toBe(true);
      expect(r.items.length).toBe(2);
      expect(r.items.map((i) => i.selection.neck_mm)).toEqual([450, 450]);
      expect(r.supply).toBe((r.items[0].figures.supply ?? 0) + (r.items[1].figures.supply ?? 0));
      // the indices are renumbered, so the panel draws blocks 1..n and not two blocks both called 1
      expect(r.items.map((i) => i.index)).toEqual([0, 1]);
    });

    it("carries the disclosure on the FIRST layer, naming the top rung, the layers and the delta", () => {
      const r = priceItemList(cp, items, "Nos", [ext({ family: SQ, damper: "None", neck_mm: "749 x 749" })]);
      // 300 + 450 and 375 + 375 BOTH total 750, so the delta cannot settle it -- FEWEST DISTINCT SIZES
      // does, which is why that tie-break is in the rule rather than left to the rung array's order.
      expect(r.items.map((i) => i.selection.neck_mm)).toEqual([375, 375]);
      // ⚠️ INVERTED BY OWNER FA8(c) (2026-10-04), NOT RELAXED: the line now reads in the owner's own
      // phrasing -- "<who said it> ... -> priced as ..." -- and still names the top rung it could not
      // reach, the layers, the total and the delta. The retired wording is asserted ABSENT.
      // ⚠️ INVERTED AGAIN by 12d-2 (owner S5 / F17): this cell is a MODEL cell (`ext`), so it reads
      // "BoQ says"; "You typed" is reserved for a cell the pricer typed (the 12d-1b `typed` marker).
      expect(r.items[0].working[0]).toBe(
        "BoQ says 749 mm -> priced as 375 + 375 mm (750 mm, +1) -- above the largest stocked size (450 mm)",
      );
      const typedCell = { ...ext({ family: SQ, damper: "None" }), attributes: { ...ext({ family: SQ, damper: "None" }).attributes, neck_mm: { value: "749 x 749", typed: true } } };
      expect(priceItemList(cp, items, "Nos", [typedCell]).items[0].working[0]).toBe(
        "You typed 749 mm -> priced as 375 + 375 mm (750 mm, +1) -- above the largest stocked size (450 mm)",
      );
      expect(r.items[0].working[0]).not.toContain("749 is above the largest");
      expect(r.items[1].working.some((l) => /composed as/.test(l))).toBe(false);
    });

    it("layers run INNER to OUTER, and only the outer keeps the outer_only attribute", () => {
      const oo = withBlocks({ compose: { attr: "neck_mm", tolerance: 2, max_layers: 4, outer_only: { attr: "damper", value: "None" } } });
      const r = priceItemList(oo, items, "Nos", [ext({ family: SQ, damper: "with", neck_mm: "900 x 900" })]);
      expect(r.items.length).toBe(2);
      // the stripped value re-enters the ordinary path, so the selection shows the value AFTER this
      // category's own default rule ("None" => without), not the raw token the config named
      expect(r.items[0].selection.damper).toBe("without");  // inner layer: stripped
      expect(r.items[1].selection.damper).toBe("with");     // outer layer: as the row stated
    });

    it("NEGATIVE: it composes ONLY the named axis -- another ladder above its top still refuses", () => {
      const r = priceItemList(cp, items, "Nos", [ext({ family: "actuator", ul: "None", torque: "100 NM" })]);
      expect(r.priced).toBe(false);
      expect(r.reason).toMatch(/above the largest size on the sheet/);
    });

    it("NEGATIVE: a value no multiset reaches still refuses in the ORIGINAL words", () => {
      const r = priceItemList(cp, items, "Nos", [ext({ family: SQ, damper: "None", neck_mm: "10000 x 10000" })]);
      expect(r.priced).toBe(false);
      expect(r.reason).toMatch(/neck size 10000 is above the largest size on the sheet \(450\)/);
    });
  });

  it("NEGATIVE (O3-a): the family attribute is read from the config, and ADP declares 'family'", () => {
    expect(spec.family_attribute_id).toBe("family");
    // a spec whose family id is WRONG must price nothing -- proving the id is really what is read,
    // rather than the literal still being in force underneath
    const wrong = { ...spec, family_attribute_id: "not_the_family_key" };
    const r = priceItemList(wrong, items, "Nos", [ext({ family: SQ, damper: "None", neck_mm: "375 x 375" })]);
    expect(r.priced).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * SLICE 12c FINISH, FA7 -- THE CALCULATOR ADMISSION (owner ruling 2026-10-04, option A)
 *
 * Insulation's pricing rules are complete, so the category is priceable in the HVAC Pricing
 * CALCULATOR tab while BoQ rows and the extraction population stay untouched. The owner asked for it
 * to be pinned BOTH WAYS, and these are the two halves on this side of the boundary:
 *   - priceable in the calculator        (the helper built WITH the admission)
 *   - coming soon on a BoQ row          (the helper built WITHOUT it -- what the BoQ editor builds)
 * The third half -- excluded from the extraction population -- is a server fact and is pinned in
 * `test_rate_master.TestCalculatorAdmission`.
 *
 * ⚠️ IT READS THE REAL SHIPPED ASSET, not a hand-built config. A fixture would pass just as happily
 * if the key never reached the asset at all, which is the vacuity this slice has already hit once.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
const HELPER_SRC = readFileSync(join(__dirname, "pricingSheetHelper.ts"), "utf-8");
const CALCULATOR_SRC = readFileSync(
  join(__dirname, "..", "..", "pricing", "PricingCalculator.tsx"), "utf-8");

describe("SLICE 12d-2 (owner S1) -- the FA7 calculator admission is RETIRED; ONE predicate admits an item-list category on every surface", () => {
  /**
   * ⚠️ INVERTED under MECHANICAL AUTHORITY (12d-2's own ruling S1), NOT deleted. This block used to pin
   * that `calculator_only` admitted v25's Insulation to the CALCULATOR ONLY and that the BoQ-shaped helper
   * declined it. 12d-2 switched Insulation on through the one generic predicate: `hasRunnablePricingRules`
   * recognises an item-list pricing block whose EVERY unit block carries its own pipelines, so the same
   * helper -- built identically by the calculator and the BoQ pricing editor -- prices it with NO flag.
   * The negative halves are kept and sharpened: a config with NO rules is still declined, the admission
   * identifiers appear in NO code line of either product file, and no discipline is named in code.
   */
  const CAT = "hvac_insulation";
  const cfgs25 = (HVAC_V25 as { category_configs: Array<Record<string, unknown> & { category_id: string }> })
    .category_configs;
  const ins = cfgs25.find((c) => c.category_id === CAT) as unknown as RateCategoryConfig;
  const items25 = (HVAC_V25 as unknown as { items: RateMasterItem[] }).items;

  const ctx = (): RateHelperRowContext => ({
    excelRow: 1, description: "Insulation", unit: "Mtr", quantity: 1,
    category: CAT, discipline: "HVAC", displayKinds: [...DISPLAY_RATE_KINDS],
  } as unknown as RateHelperRowContext);

  // THE construction both surfaces now share -- no flag exists to pass
  const helper = () =>
    makePricingSheetHelper({
      configsByCategory: new Map([[CAT, ins]]),
      items: items25,
      extractionByRow: new Map(),
    });

  it("the frozen v25 file still carries the retired key (a historical asset is never edited) and `pipelines` is still {}", () => {
    expect((ins as { calculator_only?: unknown }).calculator_only).toBe(true);
    expect(Object.keys(ins.pipelines ?? {})).toEqual([]);
  });

  it("INVERTED: v25's Insulation IS eligible through the generic predicate -- its pricing block runs (7 of 7 unit blocks carry pipelines)", () => {
    expect(hasRunnablePricingRules(ins)).toBe(true);
    expect(isEligibleConfig(ins)).toBe(true);
  });

  it("INVERTED: the BoQ-shaped helper (no flag) does NOT decline the row -- it reaches the item-list path", () => {
    const res = helper().compute(ctx());
    expect(res.kind).not.toBe("none");
  });

  it("NEGATIVE kept: a config with NO pricing rules is still declined, with or without the retired key", () => {
    const empty = { category_id: "x", calculator_only: true, attribute_definitions: [{ id: "a", label: "A", type: "text" }], pipelines: {} } as unknown as RateCategoryConfig;
    expect(hasRunnablePricingRules(empty)).toBe(false);
    expect(isEligibleConfig(empty)).toBe(false);
    const res = makePricingSheetHelper({ configsByCategory: new Map([["x", empty]]), items: items25, extractionByRow: new Map() })
      .compute({ ...ctx(), category: "x" } as RateHelperRowContext);
    expect(res.kind).toBe("none");
    expect((res as { reason: string }).reason).toBe(declineReasonFor(empty));
  });

  it("NEGATIVE kept: an item-list block with an UN-PIPED unit block and no top-level default is NOT runnable (a block would price nothing)", () => {
    const broken = structuredClone(ins) as RateCategoryConfig;
    const fams = (broken as unknown as { list_spec: { pricing: { families: Record<string, { units: Record<string, { pipelines?: unknown }> }> } } }).list_spec.pricing.families;
    const [famName] = Object.keys(fams);
    const [unitName] = Object.keys(fams[famName].units);
    delete fams[famName].units[unitName].pipelines;
    expect(hasRunnablePricingRules(broken)).toBe(false);
    expect(isEligibleConfig(broken)).toBe(false);
    // ... and a top-level default makes the same block runnable again, which is ADP's shape
    (broken as { pipelines: Record<string, unknown> }).pipelines = { item_supply: { output: ["supply"], steps: [] } };
    expect(hasRunnablePricingRules(broken)).toBe(true);
  });

  it("an ELIGIBLE config with a top-level default (ADP) is eligible by the same predicate", () => {
    const adp = cfgs25.find((c) => c.category_id === "hvac_adp") as unknown as RateCategoryConfig;
    expect(isEligibleConfig(adp)).toBe(true);
    expect(hasRunnablePricingRules(adp)).toBe(true);
  });

  it("⚠️ NEGATIVE: the admission identifiers appear in NO code line of either product file; prose may still name them", () => {
    for (const src of [HELPER_SRC, CALCULATOR_SRC]) {
      const codeLines = src
        .split("\n")
        .filter((l) => /calculator_only|admitCalculatorOnly|isCalculatorPriceableConfig|isCalculatorOnlyConfig/.test(l))
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));          // prose may name them; code may not
      expect(codeLines).toEqual([]);
    }
  });

  it("⚠️ NO DISCIPLINE AND NO CATEGORY IS NAMED IN THE PREDICATE'S CODE (the HV-10 rule)", () => {
    const start = HELPER_SRC.indexOf("export function hasRunnablePricingRules");
    const fn = HELPER_SRC.slice(start, HELPER_SRC.indexOf("\n}\n", start));
    expect(fn.length).toBeGreaterThan(0);
    for (const l of fn.split("\n")) {
      if (/^\s*(\*|\/\/|\/\*)/.test(l)) continue;
      expect(l).not.toMatch(/hvac_|HVAC|Electrical|insulation/);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * SLICE 12c FINISH, FA8 -- A CATALOGUE ATTRIBUTE IS A LIVE DROPDOWN; A TYPED ONE SAYS WHAT TO TYPE
 *
 * Owner (2026-10-04): "all attributes which can be dropdpwns based on catalog miust be made
 * dropdowns instead of free text/number. the dropdowns must be dynamic, so that any change in
 * catalog must be refelcted automativcally. the attributes whic cannot be dropdowns and the user is
 * expected to type in, must have brief explantion abnout whathe user is expected to eneter there."
 *
 * On thickness and pipe size the owner chose the live stocked values PLUS "Other...", because the
 * ladder, the rounding and the composition rules exist precisely to resolve a size the sheet does
 * NOT stock -- a plain dropdown would remove the only way to say what the document says.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
describe("SLICE 12c FINISH / FA8 -- dropdown_or_other, and what to type", () => {
  const asset = HVAC_V25 as unknown as { category_configs: Array<Record<string, unknown> & { category_id: string }>; items: RateMasterItem[] };
  const insCfg = asset.category_configs.find((c) => c.category_id === "hvac_insulation")!;
  const items = asset.items.filter((i) => i.kind === "hvac_insulation_item");
  const NR = "Nitrile Rubber Insulation";

  /** the spec with FA8's controls declared, as v19 ships them */
  const withControls = (controls: Record<string, string>, notes?: Record<string, string>) => {
    const cfg = structuredClone(insCfg) as unknown as { list_spec: { pricing: Record<string, unknown> } };
    cfg.list_spec.pricing.panel_controls = controls;
    if (notes) cfg.list_spec.pricing.panel_notes = notes;
    return itemListPricingSpec(cfg as never)!;
  };
  const FA8_CONTROLS = { item: "dropdown", cladding: "dropdown",
                         thickness_mm: "dropdown_or_other", pipe_size_mm: "dropdown_or_other" };
  const FA8_NOTES = { thickness_mm: "Type the thickness in mm as the BoQ states it.",
                      pipe_size_mm: "Type the pipe size the BoQ states, in mm or inches." };

  const defsFor = (spec: ReturnType<typeof itemListPricingSpec>) =>
    itemFieldDefs(spec!, listSpecDefs(insCfg as never), NR, "length",
                  { items, answers: {} } as never);

  it("⚠️ THE SHIPPED CONFIG declares them -- not a fixture this test built", () => {
    const pr = (insCfg as unknown as { list_spec: { pricing: Record<string, unknown> } }).list_spec.pricing;
    expect(pr.panel_controls).toEqual({
      item: "dropdown", cladding: "dropdown",
      thickness_mm: "dropdown_or_other", pipe_size_mm: "dropdown_or_other",
    });
    // ⚠️ AND THE NOTES NAME NO SIZE (owner FA8(f)): every worked example is generated live from the
    // catalogue, because a note naming a size that is no longer stocked teaches the reader a lie.
    const notes = pr.panel_notes as Record<string, string>;
    expect(Object.keys(notes).sort()).toEqual(["pipe_size_mm", "thickness_mm"]);
    for (const n of Object.values(notes)) expect(n).not.toMatch(/\d/);
  });

  it("the SHIPPED spec gives both sizes the Other... control, end to end", () => {
    const shipped = itemListPricingSpec(insCfg as never)!;
    const defs = itemFieldDefs(shipped, listSpecDefs(insCfg as never), NR, "length",
                               { items, answers: {} } as never);
    for (const attr of ["thickness_mm", "pipe_size_mm"]) {
      const f = defs.find((d) => d.skuAttr === attr)!;
      expect(f.allowOther, attr).toBe(true);
      expect(f.optionSource, attr).toBe("catalogue");
      expect((f.typedNote ?? ""), attr).not.toBe("");
    }
    expect(defs.find((d) => d.skuAttr === "cladding")!.allowOther).toBeUndefined();
  });

  it("a size field offers the LIVE stocked values AND the right to type", () => {
    const defs = defsFor(withControls(FA8_CONTROLS, FA8_NOTES));
    const thick = defs.find((d) => d.skuAttr === "thickness_mm")!;
    expect(thick.control).toBe("dropdown_or_other");
    expect(thick.allowOther).toBe(true);
    expect(thick.optionSource).toBe("catalogue");
    // the options ARE the catalogue's, not a list in code or config
    expect(thick.options).toEqual(["13", "19", "25"]);
    expect(thick.typedNote).toBe(FA8_NOTES.thickness_mm);
  });

  it("⚠️ DYNAMIC: a new catalogue row IS a new option, with no code and no config change", () => {
    const extra = {
      ...items.find((i) => (i.attributes as Record<string, unknown>).item === NR)!,
      item_uid: "rmi-test-fa8", attributes: {
        ...(items.find((i) => (i.attributes as Record<string, unknown>).item === NR)!.attributes as Record<string, unknown>),
        thickness_mm: 32,
      },
    } as RateMasterItem;
    const spec = withControls(FA8_CONTROLS, FA8_NOTES);
    const before = itemFieldDefs(spec, listSpecDefs(insCfg as never), NR, "length", { items, answers: {} } as never)
      .find((d) => d.skuAttr === "thickness_mm")!.options;
    const after = itemFieldDefs(spec, listSpecDefs(insCfg as never), NR, "length", { items: [...items, extra], answers: {} } as never)
      .find((d) => d.skuAttr === "thickness_mm")!.options;
    expect(before).not.toContain("32");
    expect(after).toContain("32");
    // and removing it again takes the option away -- the deactivate half
    const back = itemFieldDefs(spec, listSpecDefs(insCfg as never), NR, "length", { items, answers: {} } as never)
      .find((d) => d.skuAttr === "thickness_mm")!.options;
    expect(back).toEqual(before);
  });

  it("a plain `dropdown` offers NO typed box -- the two controls are different things", () => {
    const defs = defsFor(withControls({ ...FA8_CONTROLS, thickness_mm: "dropdown" }, FA8_NOTES));
    const thick = defs.find((d) => d.skuAttr === "thickness_mm")!;
    expect(thick.control).toBe("dropdown");
    expect(thick.allowOther).toBeUndefined();
    expect(thick.typedNote).toBeUndefined();
  });

  it("ABSENT panel_controls is byte-identical to before FA8 existed", () => {
    // the shipped config now DECLARES the block, so the absent case is constructed by removing it --
    // this is what every category that declares nothing (ADP's siblings, all of Electrical) still gets
    const stripped = structuredClone(insCfg) as unknown as { list_spec: { pricing: Record<string, unknown> } };
    delete stripped.list_spec.pricing.panel_controls;
    delete stripped.list_spec.pricing.panel_notes;
    const plain = itemListPricingSpec(stripped as never)!;
    expect(plain.panel_controls).toBeUndefined();
    const defs = itemFieldDefs(plain, listSpecDefs(stripped as never), NR, "length", { items, answers: {} } as never);
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) {
      expect(d.allowOther, d.skuAttr).toBeUndefined();
      expect(d.typedNote, d.skuAttr).toBeUndefined();
    }
  });

  it("⚠️ THE SIZE HELP NAMES REAL SIZES, GENERATED LIVE -- never a number written in code", () => {
    const spec = withControls(FA8_CONTROLS, FA8_NOTES);
    const help = sizeFieldHelp(spec, "thickness_mm", ["13", "19", "25"])!;
    expect(help).not.toBeNull();
    const all = help.lines.join(" ");
    // every size it names is one the catalogue stocks, or a composition of them
    expect(all).toContain("13");
    expect(all).toMatch(/next size UP/i);
    expect(all).toMatch(/layers/i);
    // the composition example is computed by the SAME composer the pricer uses
    expect(all).toMatch(/\d+ \+ \d+/);
  });

  it("the help follows the catalogue: different stocked values give different sentences", () => {
    const spec = withControls(FA8_CONTROLS, FA8_NOTES);
    const a = sizeFieldHelp(spec, "thickness_mm", ["13", "19", "25"])!.lines.join(" ");
    const b = sizeFieldHelp(spec, "thickness_mm", ["9", "13", "16", "19", "25"])!.lines.join(" ");
    expect(a).not.toBe(b);
    expect(b).toContain("9");
  });

  it("NEGATIVE: an attribute that is not a size gets no size help", () => {
    const spec = withControls(FA8_CONTROLS, FA8_NOTES);
    expect(sizeFieldHelp(spec, "cladding", ["No"])).toBeNull();
  });

  /**
   * INVERTED 2026-10-04 under mechanical authority, NOT deleted. Its claim -- the select must PIN to
   * OTHER for an unstocked value, or the controlled-select trap shows a size nobody chose
   * (frontend/CLAUDE.md) -- still holds; what changed is WHAT THE PIN IS READ FROM. Keying that
   * decision on the RESOLVED value was itself the cert-found defect: a typed 16 resolves to the
   * stocked 19, so the select left OTHER and the typed box vanished mid-entry. The decision now
   * lives in the pure `otherMode`, keyed on what was TYPED.
   *
   * The negative half is KEPT and is the important line: the retired expression must be ABSENT, so
   * the old binding cannot quietly come back.
   */
  it("the panel renders the OTHER entry and pins the select to it -- via the typed value", () => {
    const src = readFileSync(join(__dirname, "RateHelperPanel.tsx"), "utf-8");
    expect(src).toContain("OTHER_VALUE");
    expect(src).toContain("f.allowOther");
    expect(src).toContain("otherMode(f) ? OTHER_VALUE : f.value");
    // the typed box reads what was TYPED, never the resolved size
    expect(src).toContain("value={f.typedValue}");
    expect(src).toContain("f.typedNote");
    // NEGATIVE: the retired resolved-value binding is gone, from BOTH the select and the box
    expect(src).not.toContain("!f.options.includes(f.value) ? OTHER_VALUE : f.value");
    expect(src).not.toContain("(f.value === \"\" || !f.options.includes(f.value))");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * SLICE 12c FINISH -- THE COMPOSITION RULINGS (owner C-R1 / C-R2 / C-R3, 2026-10-04)
 *
 * C-R1 "within +-2 mm -> fewest layers -> CLOSEST to the stated thickness -> if still tied, LOWEST
 *      insulation material cost (cost_insulation of the layers summed)". Closeness before cost.
 * C-R2 "if iyt can be composed using the same pipe size sku, then we can do it. but we cannot
 *      combine 2 diffrent sized pipe SKus."
 * C-R3 a PUF thickness below the pipe's stocked one takes the next size up.
 *
 * All three were VIOLATED before this change, and all three are one root cause: the ladder -- and so
 * the composition built from its rungs -- was drawn from the whole family instead of from the rows of
 * one pipe size, because the narrowing skipped every other LADDER attribute.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
describe("SLICE 12c FINISH -- composition: same pipe size, closest, then cheapest", () => {
  const asset = HVAC_V25 as unknown as { category_configs: Array<Record<string, unknown> & { category_id: string }>; items: RateMasterItem[] };
  const insCfg = asset.category_configs.find((c) => c.category_id === "hvac_insulation")!;
  const spec = itemListPricingSpec(insCfg as never)!;
  const items = asset.items.filter((i) => i.kind === "hvac_insulation_item" || i.kind === "hvac_pricing_input");
  const NR = "Nitrile Rubber Insulation", PUF = "Tubular Puf Insulation";

  const price = (family: string, attrs: Record<string, string>, unit = "mts") =>
    priceItemList(spec, items, unit, [{
      attributes: Object.fromEntries(Object.entries({ item: family, ...attrs }).map(([k, v]) => [k, { value: v }])),
    }] as never);
  const layersOf = (r: ReturnType<typeof priceItemList>) =>
    (r.items ?? []).map((x) => Number((x as { selection?: Record<string, unknown> }).selection?.thickness_mm)).sort((a, b) => a - b);

  it("the SHIPPED config resolves the PIPE SIZE first and names the cost key", () => {
    // ⚠️ THE ORDER IS THE MECHANISM. The axis that selects the SKU set must resolve first, or the
    // thickness rungs come from every pipe size at once -- which is what produced all three defects.
    expect(spec.ladders).toEqual(["pipe_size_mm", "thickness_mm"]);
    expect(spec.compose?.cost_key).toBe("cost_insulation");
  });

  it("C5: 38 at pipe 19.05 takes 13 + 25 (283), not 19 + 19 (286) -- the cost tie-break", () => {
    const r = price(NR, { pipe_size_mm: "19.05", thickness_mm: "38", cladding: "No" });
    expect(r.priced).toBe(true);
    expect(layersOf(r)).toEqual([13, 25]);
    // and the two candidates really are a tie on everything before cost
    const cost = (t: number) => Number((items.find((i) => {
      const a = i.attributes as Record<string, unknown>;
      return a.item === NR && Number(a.pipe_size_mm) === 19.05 && Number(a.thickness_mm) === t && a.cladding === "No";
    })?.rates ?? {}).cost_insulation);
    expect(cost(13) + cost(25)).toBe(283);
    expect(cost(19) + cost(19)).toBe(286);
  });

  it("CLOSENESS BEATS COST: Thermal Nitrile 30 takes 16 + 13 (29), whatever the costs are", () => {
    const r = price("Thermal Nitrile Insulation", { thickness_mm: "30", cladding: "No" }, "sqm");
    expect(r.priced).toBe(true);
    expect(layersOf(r)).toEqual([13, 16]);          // 29, one off -- beats 19+9 (28) and 19+13 (32)
  });

  it("an exact-cost tie still resolves to ONE composition, deterministically", () => {
    // 50 at pipe 19.05: 25 + 25 is the only two-layer exact fit, and it is reached the same way twice
    const a = layersOf(price(NR, { pipe_size_mm: "19.05", thickness_mm: "50", cladding: "No" }));
    const b = layersOf(price(NR, { pipe_size_mm: "19.05", thickness_mm: "50", cladding: "No" }));
    expect(a).toEqual([25, 25]);
    expect(a).toEqual(b);
  });

  it("C-R2: PUF 100 on a 50-pipe is 50 + 50 -- built from that pipe's own rows", () => {
    const r = price(PUF, { pipe_size_mm: "50", thickness_mm: "100", cladding: "No" });
    expect(r.priced).toBe(true);
    expect(layersOf(r)).toEqual([50, 50]);
  });

  it("C-R2: PUF 75 on a 50-pipe is NOT PRICED, with its reason", () => {
    const r = price(PUF, { pipe_size_mm: "50", thickness_mm: "75", cladding: "No" });
    expect(r.priced).toBe(false);
    expect(r.reason ?? "").toMatch(/above the largest size on the sheet \(50\)/);
  });

  it("C-R3: PUF 25 on a 50-pipe takes the 50 that pipe stocks", () => {
    const r = price(PUF, { pipe_size_mm: "50", thickness_mm: "25", cladding: "No" });
    expect(r.priced).toBe(true);
    expect(layersOf(r)).toEqual([50]);
  });

  it("⚠️ PROPERTY: NO composition anywhere mixes pipe sizes -- every family, every pipe size", () => {
    const byFamilyPipe = new Map<string, Set<number>>();
    for (const it of items) {
      const a = it.attributes as Record<string, unknown>;
      if (it.kind !== "hvac_insulation_item" || a.pipe_size_mm === undefined) continue;
      const key = `${a.item}\u0000${a.pipe_size_mm}`;
      (byFamilyPipe.get(key) ?? byFamilyPipe.set(key, new Set()).get(key)!).add(Number(a.thickness_mm));
    }
    expect(byFamilyPipe.size).toBeGreaterThan(0);
    let composed = 0;
    for (const [key, stocked] of byFamilyPipe) {
      const [family, pipe] = key.split("\u0000");
      const top = Math.max(...stocked);
      // ⚠️ THE PROBE VALUES MUST REACH THE MIXING REGIME, or this property is decoration. Mixing can
      // only arise where the FAMILY stocks a thickness this pipe does not, so the sweep asks for
      // values that need one: the family-wide top, and sums that only a foreign rung can reach. The
      // first version asked only around THIS pipe's own top and stayed green while the narrowing was
      // disabled -- it was measuring nothing.
      const famTop = Math.max(...[...byFamilyPipe].filter(([k]) => k.startsWith(`${family}\u0000`))
        .flatMap(([, v]) => [...v]));
      for (const want of [top + 5, top * 2, top * 3, famTop + top, famTop * 2, famTop + 5]) {
        const r = price(family, { pipe_size_mm: pipe, thickness_mm: String(want), cladding: "No" });
        // ⚠️ NOT GATED ON `priced`. A composition that MIXES pipe sizes proposes a layer that pipe
        // does not stock, so the row then fails to match a SKU and comes back UNPRICED -- gating on
        // `priced` would skip exactly the case this property exists to catch, and did: the first
        // version of this test stayed green while the narrowing was disabled.
        if ((r.items ?? []).length < 2) continue;
        composed++;
        for (const layer of layersOf(r)) {
          expect(stocked.has(layer),
                 `${family} @ pipe ${pipe}: layer ${layer} is not stocked at that pipe`).toBe(true);
        }
      }
    }
    expect(composed, "the sweep must actually reach some compositions").toBeGreaterThan(0);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * SLICE 12c FINISH, FA8(d)/(e) -- A PIPE SIZE MAY BE TYPED IN mm OR IN INCHES
 *
 * Owner: "Type the pipe size the BoQ states, in mm (e.g. 22.2) or inches (e.g. 7/8"). For NB sizes
 * type the number (32 NB -> 32)." and the matching rules: 2 decimals -> used; else 1 decimal ->
 * used; else the next stocked size up; larger than the largest -> not priced, reason shown.
 *
 * ⚠️ THE BARE FRACTION IS THE DANGEROUS CASE. Before this, `7/8` parsed as the NUMBER 0.875 and
 * priced silently as a 9.52 mm pipe -- a plausible wrong size with nothing on screen to catch it.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
describe("SLICE 12c FINISH / FA8(d) -- inches, decimals and the next size up", () => {
  const asset = HVAC_V25 as unknown as { category_configs: Array<Record<string, unknown> & { category_id: string }>; items: RateMasterItem[] };
  const insCfg = asset.category_configs.find((c) => c.category_id === "hvac_insulation")!;
  const spec = itemListPricingSpec(insCfg as never)!;
  const items = asset.items.filter((i) => i.kind === "hvac_insulation_item" || i.kind === "hvac_pricing_input");
  const NR = "Nitrile Rubber Insulation";

  const used = (pipe: string) => {
    const r = priceItemList(spec, items, "mts", [{
      attributes: Object.fromEntries(Object.entries({ item: NR, pipe_size_mm: pipe, thickness_mm: "19", cladding: "No" })
        .map(([k, v]) => [k, { value: v }])),
    }] as never);
    return { priced: r.priced, pipe: (r.items?.[0] as { selection?: Record<string, unknown> })?.selection?.pipe_size_mm,
             reason: r.reason };
  };

  it("the SHIPPED axis declares inches -- and no other axis does", () => {
    expect(spec.numbers.pipe_size_mm.inches).toBe(true);
    expect(spec.numbers.thickness_mm.inches).toBeUndefined();
  });

  it('an inch size converts and matches: 7/8" -> 22.23, 3/4" -> 19.05', () => {
    expect(used('7/8"').pipe).toBe(22.23);     // 7/8" = 22.225, the stocked rung is 22.23
    expect(used('3/4"').pipe).toBe(19.05);     // exactly stocked
    expect(used("1/4 inch").pipe).toBe(6.35);
  });

  it("⚠️ A BARE FRACTION IS INCHES, not the number 0.875 -- the silent wrong size, pinned", () => {
    expect(used("7/8").pipe).toBe(22.23);
    // the defect it replaces: 0.875 would ladder up to the smallest rung
    expect(used("7/8").pipe).not.toBe(9.52);
  });

  it("decimals: 22.2 and 22.23 are the same size; 22 takes the next size up", () => {
    expect(used("22.23").pipe).toBe(22.23);
    expect(used("22.2").pipe).toBe(22.23);
    expect(used("22").pipe).toBe(22.23);
  });

  it("larger than the largest is NOT PRICED, with its reason", () => {
    const r = used("500");
    expect(r.priced).toBe(false);
    expect(r.reason ?? "").toMatch(/above the largest size on the sheet \(53\.98\)/);
  });

  it("FA8(e): an entry that is not a number at all is refused, naming what to enter", () => {
    const r = used("abc");
    expect(r.priced).toBe(false);
    expect(r.reason ?? "").toMatch(/no number in 'abc'/);
  });

  it("NEGATIVE: an axis WITHOUT the flag still refuses inches, so ADP is untouched", () => {
    const noFlag = structuredClone(insCfg) as unknown as { list_spec: { pricing: { numbers: Record<string, Record<string, unknown>> } } };
    delete noFlag.list_spec.pricing.numbers.pipe_size_mm.inches;
    const s2 = itemListPricingSpec(noFlag as never)!;
    const r = priceItemList(s2, items, "mts", [{
      attributes: Object.fromEntries(Object.entries({ item: NR, pipe_size_mm: '7/8"', thickness_mm: "19", cladding: "No" })
        .map(([k, v]) => [k, { value: v }])),
    }] as never);
    expect(r.priced).toBe(false);
    expect(r.reason ?? "").toMatch(/stated in inches/);
  });

  it("the help states the inch rule with an example the catalogue actually stocks", () => {
    const help = sizeFieldHelp(spec, "pipe_size_mm", ["6.35", "9.52", "22.23", "53.98"])!;
    const inchLine = help.lines.find((l) => /inch/i.test(l))!;
    expect(inchLine).toBeTruthy();
    // whatever fraction it chose, the size it names must be one of the options it was given
    const named = inchLine.match(/matches ([\d.]+)/)![1];
    expect(["6.35", "9.52", "22.23", "53.98"]).toContain(named);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * OWNER RULING, FINAL FORM (2026-10-04) -- A NOTE IS REQUIRED ON EXACTLY THREE CONDITIONS
 *
 * "any field on the calculator or pricing helper panel which must be mandatorily filled for a rate
 * to be calculated and the user needs to type it in should have the note explnantion."
 *
 *   (1) TYPED  (2) RENDERS on the panel  (3) MANDATORY -- no rate without it
 *
 * ⚠️ THE RULE LIVES HERE, NOT IN THE PYTHON VALIDATOR, AND THAT IS FORCED. Two of the three are
 * decided by the frontend's own code paths -- `itemFieldDefs` decides what renders, the pricer
 * decides what is mandatory -- and Python can read neither. Re-deriving them server-side would be
 * exactly the second list the owner forbade, free to drift from the panel, which is how a field
 * loses its note silently. The validator keeps the SHAPE checks (a note names a real typed control
 * and says something); this measures the rule against the product.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
describe("OWNER final form -- a note on every typed, rendered, mandatory field", () => {
  const asset = HVAC_V25 as unknown as { category_configs: Array<Record<string, unknown> & { category_id: string }>; items: RateMasterItem[] };
  const cfgOf = (id: string) => asset.category_configs.find((c) => c.category_id === id)!;
  const itemsOf = (id: string) => {
    const kind = ((cfgOf(id) as never as { list_spec?: { pricing?: { kind?: string } } }).list_spec?.pricing?.kind) ?? "";
    return asset.items.filter((i) => i.kind === kind || i.kind === "hvac_pricing_input");
  };

  it("INSULATION: every field that must carry a note does", () => {
    expect(missingNotes(cfgOf("hvac_insulation"), itemsOf("hvac_insulation"))).toEqual([]);
  });

  it("ADP: every field that must carry a note does", () => {
    expect(missingNotes(cfgOf("hvac_adp"), itemsOf("hvac_adp"))).toEqual([]);
  });

  it("the three properties, measured -- INSULATION", () => {
    const rows = auditPanelFields(cfgOf("hvac_insulation"), itemsOf("hvac_insulation"));
    expect(rows.map((r) => r.attr)).toEqual(["cladding", "pipe_size_mm", "thickness_mm"]);
    // a `dropdown_or_other` counts as TYPED: choosing "Other..." opens a box, which is the case the
    // owner's rule is about
    expect(rows.find((r) => r.attr === "cladding")!.typed).toBe(false);
    for (const a of ["pipe_size_mm", "thickness_mm"]) {
      const f = rows.find((r) => r.attr === a)!;
      expect(f.typed, a).toBe(true);
      expect(f.mandatory, a).toBe(true);
      expect(f.needsNote, a).toBe(true);
      expect(f.note.trim(), a).not.toBe("");
    }
  });

  it("the three properties, measured -- ADP: ONE typed field renders, and it is mandatory", () => {
    const rows = auditPanelFields(cfgOf("hvac_adp"), itemsOf("hvac_adp"));
    const typed = rows.filter((r) => r.typed);
    expect(typed.map((r) => r.attr)).toEqual(["face_w_mm"]);
    expect(typed[0].mandatory).toBe(true);
    expect(typed[0].note).toContain("Type the size as the BoQ states it");
    // ⚠️ and the three the owner removed render NOWHERE, which is why they carry no note
    for (const gone of ["face_h_mm", "depth_mm", "area_sqm"]) {
      expect(rows.map((r) => r.attr)).not.toContain(gone);
    }
  });

  /* ---- each condition proved BOTH WAYS (owner item 2) ---------------------------------------- */

  it("(1) TYPED: a rendered mandatory field with NO note is REFUSED; as a dropdown it is accepted", () => {
    const cfg = structuredClone(cfgOf("hvac_insulation")) as never as
      { list_spec: { pricing: { panel_notes: Record<string, string>; panel_controls: Record<string, string> } } };
    delete cfg.list_spec.pricing.panel_notes.thickness_mm;
    expect(missingNotes(cfg, itemsOf("hvac_insulation"))).toEqual(["thickness_mm"]);
    // the SAME field as a plain dropdown needs no note
    cfg.list_spec.pricing.panel_controls.thickness_mm = "dropdown";
    expect(missingNotes(cfg, itemsOf("hvac_insulation"))).toEqual([]);
  });

  it("(2) RENDERS: a typed control the panel never shows needs no note", () => {
    // ADP declares four typed controls and renders ONE field for them; the other three are exactly
    // this case, and the audit does not ask for their notes
    const rows = auditPanelFields(cfgOf("hvac_adp"), itemsOf("hvac_adp"));
    const declared = Object.entries(((cfgOf("hvac_adp") as never as { list_spec: { pricing: { panel_controls: Record<string, string> } } })
      .list_spec.pricing.panel_controls)).filter(([, v]) => v !== "dropdown").map(([k]) => k);
    expect(declared.sort()).toEqual(["area_sqm", "depth_mm", "face_h_mm", "face_w_mm"]);
    expect(rows.filter((r) => r.typed).map((r) => r.attr)).toEqual(["face_w_mm"]);
    expect(missingNotes(cfgOf("hvac_adp"), itemsOf("hvac_adp"))).toEqual([]);
  });

  it("(3) MANDATORY: the same field made OPTIONAL needs no note", () => {
    const cfg = structuredClone(cfgOf("hvac_insulation")) as never as
      { list_spec: { pricing: { panel_notes: Record<string, string>; families: Record<string, { units: Record<string, { needs?: string[] }> }> } } };
    delete cfg.list_spec.pricing.panel_notes.thickness_mm;
    expect(missingNotes(cfg, itemsOf("hvac_insulation"))).toEqual(["thickness_mm"]);
    // drop it from every family's `needs` -- the pricer then no longer refuses without it
    for (const fam of Object.values(cfg.list_spec.pricing.families)) {
      for (const unit of Object.values(fam.units ?? {})) {
        unit.needs = (unit.needs ?? []).filter((n) => n !== "thickness_mm");
      }
    }
    const rows = auditPanelFields(cfg, itemsOf("hvac_insulation"));
    const th = rows.find((r) => r.attr === "thickness_mm");
    // it is either no longer mandatory, or no longer rendered -- either way no note is demanded
    expect(th?.needsNote ?? false).toBe(false);
    expect(missingNotes(cfg, itemsOf("hvac_insulation"))).toEqual([]);
  });

  it("⚠️ the audit asks the PRODUCT, not a list: no attribute id is written in the module", () => {
    const src = readFileSync(join(__dirname, "panelFieldAudit.ts"), "utf-8");
    for (const banned of ["thickness_mm", "pipe_size_mm", "face_w_mm", "hvac_", "Electrical"]) {
      const code = src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
      expect(code, banned).not.toContain(banned);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * CERT-FOUND DEFECT (2026-10-04, v25) -- A NOTE MUST NOT PROMISE WHAT THE READER REFUSES
 *
 * The shipped thickness note read "Two layers may be written out." -- and the reader REFUSES
 * "13+13" ("several values stated for thickness"). Nothing was broken in the pricing; the SENTENCE
 * was wrong, which is the harder kind to notice: it reads as a documented capability, and a pricer
 * who believes it gets a refusal they cannot explain.
 *
 * ⚠️ THE REFUSAL IS THE CORRECT BEHAVIOUR AND MUST STAY. Accepting written-out layers would let a
 * pricer hand-pick the layers and so bypass C-R1 entirely -- the ordering (fewest layers, then
 * closest, then cheapest) the owner spent three rulings pinning. The composition is the system's
 * job; the pricer states the thickness. So the NOTE was corrected, not the reader.
 *
 * Pinned BOTH WAYS: the refusal still fires, and the shipped note no longer claims otherwise.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
describe("v25 -- the thickness note says only what the reader will accept", () => {
  const asset = HVAC_V25 as unknown as { category_configs: Array<Record<string, unknown> & { category_id: string }>; items: RateMasterItem[] };
  const insCfg = asset.category_configs.find((c) => c.category_id === "hvac_insulation")!;
  const spec = itemListPricingSpec(insCfg as never)!;
  const items = asset.items.filter((i) => i.kind === "hvac_insulation_item" || i.kind === "hvac_pricing_input");
  const notes = ((insCfg as never as { list_spec: { pricing: { panel_notes: Record<string, string> } } })
    .list_spec.pricing.panel_notes);

  // SLICE 12d-1b (owner T6, pin INVERTED in part): the pricer's entry is TYPED (`typed: true`, what
  // `assembleItems` now marks) -- that is the entry this note is about, and it STILL refuses. A MODEL
  // answer written as layers now prices through the composition path (owner T4) -- pinned beside it.
  const price = (thickness: string, typed = true) => priceItemList(spec, items, "mts", [{
    attributes: Object.fromEntries(Object.entries({
      item: "Nitrile Rubber Insulation", pipe_size_mm: "19.05", thickness_mm: thickness, cladding: "No",
    }).map(([k, v]) => [k, k === "thickness_mm" && typed ? { value: v, typed: true } : { value: v }])),
  }] as never);

  it("THE REFUSAL STANDS for the PRICER'S TYPED entry: written-out layers are not an entry the reader accepts (T6)", () => {
    for (const written of ["13+13", "13 + 13", "13x2"]) {
      const r = price(written);
      expect(r.priced, written).toBe(false);
      expect(r.reason ?? "", written).toMatch(/thickness/);
    }
  });

  it("SLICE 12d-1b (T4): the SAME words as a MODEL answer price as two layers of 13 -- the inverted half", () => {
    const r = price("13 + 13", false);
    expect(r.priced).toBe(true);
    expect((r.items ?? []).map((x) => Number((x as { selection?: Record<string, unknown> }).selection?.thickness_mm))).toEqual([13, 13]);
  });

  it("and a SINGLE number composes, which is what the note now describes", () => {
    const r = price("26");
    expect(r.priced).toBe(true);
    expect((r.items ?? []).map((x) => Number((x as { selection?: Record<string, unknown> }).selection?.thickness_mm)))
      .toEqual([13, 13]);
  });

  it("⚠️ the shipped note no longer claims layers may be written out", () => {
    expect(notes.thickness_mm).not.toMatch(/written out/i);
    // and it still says the two things a pricer needs: one number, and that layers happen for them
    expect(notes.thickness_mm).toMatch(/single number/i);
    expect(notes.thickness_mm).toMatch(/layers/i);
  });

  /**
   * ⚠️ THE THIRD CERT-FOUND DEFECT, AND THE REASON THIS TEST EXISTS.
   *
   * The false "layers may be written out" promise lived in TWO places: the config note AND the
   * generated help under it. Correcting the note alone left the help still saying it, and a green
   * suite could not see the difference -- only a runtime read of the screen did. A field's note and
   * its "How is this matched?" help are two sentences about ONE behaviour; they must agree, and the
   * only durable way to enforce that is to ask the SAME behaviour about both.
   */
  it("NEITHER the note NOR the generated help promises written-out layers", () => {
    const help = sizeFieldHelp(spec, "thickness_mm", ["13", "19", "25"])!;
    const everything = [notes.thickness_mm, ...help.lines].join(" | ");
    // the behaviour: the reader refuses it when the PRICER types it (T6; a model answer is T4's, pinned above)
    expect(price("19+13").priced).toBe(false);
    // so neither sentence may offer it
    expect(everything).not.toMatch(/each price as their own item/i);
    expect(everything).not.toMatch(/may be written out/i);
    // and the help says positively what to type instead
    expect(help.lines.join(" ")).toMatch(/Type one number/i);
  });

  it("the pipe note's inch claim is BACKED by the shipped reader (the other half of the same audit)", () => {
    expect(notes.pipe_size_mm).toMatch(/inches/i);
    expect(spec.numbers.pipe_size_mm.inches).toBe(true);
    const r = priceItemList(spec, items, "mts", [{
      attributes: Object.fromEntries(Object.entries({
        item: "Nitrile Rubber Insulation", pipe_size_mm: "3/4\"", thickness_mm: "19", cladding: "No",
      }).map(([k, v]) => [k, { value: v }])),
    }] as never);
    expect(r.priced).toBe(true);
    expect((r.items?.[0] as { selection?: Record<string, unknown> })?.selection?.pipe_size_mm).toBe(19.05);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// SLICE 12c-S -- DEPENDENT DROPDOWNS, THE UNIT PICKER (owner S10) AND NOTES GENERATED FROM
// WHAT THE PRICING READS (owner S1, S2, S3, S4, S5 on F16, S6)
// ══════════════════════════════════════════════════════════════════════════════════════════
describe("SLICE 12c-S -- options, units and notes", () => {
  const assetS = HVAC_V26 as unknown as { category_configs: RateCategoryConfig[]; items: RateMasterItem[] };
  const itemsS: RateMasterItem[] = assetS.items.map((i) => ({ ...i, discipline: "HVAC" }));
  const adpS = assetS.category_configs.find((c) => c.category_id === "hvac_adp")!;
  const insS = assetS.category_configs.find((c) => c.category_id === "hvac_insulation")!;
  const adpSpec = itemListPricingSpec(adpS)!;
  const insSpec = itemListPricingSpec(insS)!;
  const insDefs = listSpecDefs(insS);
  const adpDefs = listSpecDefs(adpS);

  // -- item 2 / OWNER RULING S10 -- the unit picker ----------------------------------------
  /**
   * THE SIX-FAMILY TABLE THE OWNER ASKED TO BE PINNED. Two rules meet here: a family is offered
   * every class it can be priced in (its own pipelines PLUS any declared conversion), less any it
   * DECLARES hidden. Only `double-skin plenum` declares one, and that is the whole reason the key
   * exists -- it and `VCD` are identical on every axis a generic rule could key on.
   */
  it("S10: each family offers exactly the units it can be priced in, less the ones it hides", () => {
    expect(familyUnitClasses(insSpec, "Nitrile Rubber Insulation")).toEqual(["length"]);
    expect(familyUnitClasses(insSpec, "Thermal Nitrile Insulation")).toEqual(["area"]);
    expect(familyUnitClasses(insSpec, "Cladding Only").slice().sort()).toEqual(["area", "length"]);
    expect(familyUnitClasses(adpSpec, "double-skin plenum")).toEqual(["area"]);
    // the two that prove the rule is not simply "the unit the SKUs are sold in"
    expect(familyUnitClasses(adpSpec, "VCD").slice().sort()).toEqual(["area", "count"]);
    expect(familyUnitClasses(adpSpec, "mixing box / LP plenum").slice().sort()).toEqual(["area", "count"]);
  });

  it("S10 NEGATIVE: VCD and double-skin plenum are identical in config, and differ ONLY by the key", () => {
    const vcd = adpSpec.families["VCD"];
    const dsp = adpSpec.families["double-skin plenum"];
    // identical on every axis a generic rule could read
    expect(Object.keys(vcd.units)).toEqual(Object.keys(dsp.units));
    expect(Object.keys(vcd.convert ?? {})).toEqual(Object.keys(dsp.convert ?? {}));
    // ...so ONLY the declaration separates them
    expect(vcd.units_not_offered).toBeUndefined();
    expect(dsp.units_not_offered).toEqual(["count"]);
    // and taking the declaration away makes double-skin behave exactly like VCD -- the key does the work
    const without = { ...dsp };
    delete without.units_not_offered;
    const spoofed = { ...adpSpec, families: { ...adpSpec.families, "double-skin plenum": without } };
    expect(familyUnitClasses(spoofed, "double-skin plenum").slice().sort()).toEqual(["area", "count"]);
  });

  it("S10: an unknown family offers nothing", () => {
    expect(familyUnitClasses(adpSpec, "no such family")).toEqual([]);
  });

  // -- item 14 / OWNER RULING S4 -- the pricing is UNCHANGED --------------------------------
  /**
   * The negative half of the whole slice. `double-skin plenum` no longer OFFERS a per-number unit
   * in the picker, but a BoQ row that ARRIVES in Nos must price exactly as it always did -- the
   * owner's "lets leave the pricing as it is for now". Depth is still read by nothing, by design.
   */
  it("S4: a double-skin plenum still prices 1723 / 231, at every depth and with none", () => {
    const at = (size: string) => {
      const attributes: Record<string, { value: string }> = {
        family: { value: "double-skin plenum" }, insulation_thickness_mm: { value: "25" },
      };
      if (size) attributes.size_mm = { value: size };
      const r = priceItemList(adpSpec, itemsS, "Nos", [{ attributes }]);
      return [r.priced, r.supply, r.install] as const;
    };
    expect(at("600 x 600")).toEqual([true, 1723, 231]);
    expect(at("600 x 600 x 50")).toEqual([true, 1723, 231]);
    expect(at("600 x 600 x 300")).toEqual([true, 1723, 231]);
    expect(at("600 x 600 x 1000")).toEqual([true, 1723, 231]);
    // and per sq.m, where it is always meant to be bought
    const sq = priceItemList(adpSpec, itemsS, "SQM", [{ attributes: {
      family: { value: "double-skin plenum" }, insulation_thickness_mm: { value: "25" } } }]);
    expect([sq.priced, sq.supply, sq.install]).toEqual([true, 4785, 640]);
  });

  // -- item 1 / OWNER RULING S1 -- dependent dropdowns --------------------------------------
  /**
   * Tubular PUF stocks exactly ONE thickness per pipe size, and the dropdown used to offer all four
   * at every pipe: picking 25 at pipe 100 priced as 65, which is 2.6x the thickness on screen.
   */
  it("S1: a thickness list narrows to what the answered pipe size actually stocks", () => {
    const th = (pipe: number) => fieldOptionsFromSkus(
      insSpec, itemsS, "Tubular Puf Insulation", "length", "thickness_mm",
      { item: "Tubular Puf Insulation", unit_class: "length", cladding: "No", pipe_size_mm: pipe });
    expect(th(25)).toEqual(["25"]);
    expect(th(50)).toEqual(["50"]);
    expect(th(100)).toEqual(["65"]);
    expect(th(300)).toEqual(["80"]);
  });

  it("S1 NEGATIVE: an UNANSWERED attribute narrows nothing -- the full list is still offered", () => {
    const all = fieldOptionsFromSkus(
      insSpec, itemsS, "Tubular Puf Insulation", "length", "thickness_mm", {});
    expect(all).toEqual(["25", "50", "65", "80"]);
  });

  it("S1 NEGATIVE: an answer no SKU can satisfy is SKIPPED, never allowed to empty the list", () => {
    // pipe 999 is stocked nowhere; the list must not collapse to nothing
    const th = fieldOptionsFromSkus(
      insSpec, itemsS, "Tubular Puf Insulation", "length", "thickness_mm",
      { item: "Tubular Puf Insulation", unit_class: "length", pipe_size_mm: 999 });
    expect(th.length).toBeGreaterThan(0);
  });

  // -- item 9 / OWNER RULING S6 -- cladding-only per sq.m -----------------------------------
  /**
   * Cladding Only is quoted per METRE and derives a per-SQ.M price from those same rows, so the
   * unit-class filter found no rows and the panel fell back to the DEFINITION's whole vocabulary --
   * 9 claddings, 4 of which cannot price, three of them other families' values.
   */
  it("S6: at sq.m the cladding list is exactly the claddings that can price there", () => {
    const f = itemFieldDefs(insSpec, insDefs, "Cladding Only", "area", { items: itemsS, answers: {} })
      .find((x) => x.id === "cladding")!;
    expect(f.options).toEqual([
      "None", "24G Aluminium", "24G Aluminium with Glass Cloth", "26G Aluminium",
      "26G Aluminium with Glass Cloth", "Glass Cloth with paint",
    ]);
    // POSITIVE: every one of them really does price
    for (const c of (f.options ?? []).filter((o) => o !== "None")) {
      const r = priceItemList(insSpec, itemsS, "sqm", [{ attributes: {
        item: { value: "Cladding Only" }, cladding: { value: c } } }]);
      expect([c, r.priced]).toEqual([c, true]);
    }
    // NEGATIVE: the three that refuse are exactly the ones no longer offered
    for (const c of ["Aluminium Foil", "GI Framework with perforated Al sheet", "No"]) {
      expect(f.options).not.toContain(c);
      const r = priceItemList(insSpec, itemsS, "sqm", [{ attributes: {
        item: { value: "Cladding Only" }, cladding: { value: c } } }]);
      expect([c, r.priced]).toEqual([c, false]);
    }
  });

  // -- items 3, 4, 11 -- the note is GENERATED from what the pricing reads ------------------
  const sizeNote = (family: string, cls: string) =>
    itemFieldDefs(adpSpec, adpDefs, family, cls, { items: itemsS, answers: {} })
      .find((f) => f.skuAttr === "face_w_mm")?.typedNote;

  it("F1 (S4): the size note invites a depth ONLY where the pricing reads one", () => {
    // the mixing box's conversion needs face_w, face_h AND depth -- so the note asks for all three
    expect(adpSpec.families["mixing box / LP plenum"].convert!.count[0].needs).toContain("depth_mm");
    expect(sizeNote("mixing box / LP plenum", "count")).toBe(
      "Type the size as the BoQ states it, in mm: width x height. Add the depth where the BoQ gives one.");
    // the double-skin's conversion reads W and H only -- so the note must not ask for a depth
    expect(adpSpec.families["double-skin plenum"].convert!.count[0].needs).not.toContain("depth_mm");
    expect(sizeNote("double-skin plenum", "count")).toBe(
      "Type the size as the BoQ states it, in mm: width x height.");
    expect(sizeNote("double-skin plenum", "count")).not.toMatch(/depth/i);
  });

  it("F3 (S3): the area field carries the owner's approved note, on every family that shows it", () => {
    const withArea = Object.keys(adpSpec.families).filter((fam) =>
      itemFieldDefs(adpSpec, adpDefs, fam, "count", { items: itemsS, answers: {} })
        .some((f) => f.skuAttr === "area_sqm"));
    expect(withArea.length).toBe(12);          // the audit's count, re-measured here
    for (const fam of withArea) {
      const f = itemFieldDefs(adpSpec, adpDefs, fam, "count", { items: itemsS, answers: {} })
        .find((x) => x.skuAttr === "area_sqm")!;
      expect([fam, f.typedNote]).toEqual([fam,
        "Type the area in sq.m. Where the BoQ gives a band, type the largest value in it."]);
    }
  });

  it("F16 (S5): the layering clause appears only where the sheet stocks sizes to layer between", () => {
    const thNote = (family: string, cls: string) =>
      itemFieldDefs(insSpec, insDefs, family, cls, { items: itemsS, answers: {} })
        .find((f) => f.skuAttr === "thickness_mm")?.typedNote;
    // Nitrile stocks 13 / 19 / 25, so layering is real and is promised
    expect(thNote("Nitrile Rubber Insulation", "length")).toMatch(/layers are combined automatically/);
    // Cladding Only stocks NO sizes at all -- nothing can be layered, so the clause is dropped
    expect(thNote("Cladding Only", "length")).toBe(
      "Type the thickness the BoQ states, in mm - a single number.");
    expect(thNote("Cladding Only", "length")).not.toMatch(/layer/i);
  });

  // -- the note generator itself, as a table ------------------------------------------------
  it("typedFieldNote: a plain string passes through, and clauses are filtered by their condition", () => {
    const base = { ...insSpec, panel_notes: {
      plain: "just this",
      clauses: [
        { text: "always." },
        { text: "reads depth.", when_reads: "depth_mm" },
        { text: "stocked.", when_stocked: true },
      ],
      allOut: [{ text: "never.", when_reads: "depth_mm" }],
    } } as unknown as typeof insSpec;
    expect(typedFieldNote(base, "plain", new Set(), [])).toBe("just this");
    expect(typedFieldNote(base, "clauses", new Set(), [])).toBe("always.");
    expect(typedFieldNote(base, "clauses", new Set(["depth_mm"]), [])).toBe("always. reads depth.");
    expect(typedFieldNote(base, "clauses", new Set(), ["13"])).toBe("always. stocked.");
    expect(typedFieldNote(base, "clauses", new Set(["depth_mm"]), ["13"]))
      .toBe("always. reads depth. stocked.");
    // NEGATIVE: every clause conditioned out yields NO note, not an empty paragraph
    expect(typedFieldNote(base, "allOut", new Set(), [])).toBeUndefined();
    // NEGATIVE: an attribute with no note at all is still undefined
    expect(typedFieldNote(base, "nothing", new Set(), [])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------
// SLICE 12d-1a (owner R2, 2026-10-07) -- family_when_none: a row that names NO material prices as the
// family its ROW KIND implies, declared in config, marked amber; a stated family is never touched.
// ---------------------------------------------------------------------------------------------------------
describe("SLICE 12d-1a / R2 -- family_when_none: a silent material prices by row kind, marked as a default", () => {
  type Cfg = RateCategoryConfig & { list_spec: { pricing: Record<string, unknown> } };
  const V26 = HVAC_V26 as unknown as Asset;
  const INS = V26.category_configs.find((c) => c.category_id === "hvac_insulation") as unknown as Cfg;
  const ITEMS = V26.items;
  const NR = "Nitrile Rubber Insulation";
  const TN = "Thermal Nitrile Insulation";
  const AN = "Acoustic Nitrile Insulation";
  const FWN = {
    by_unit_class: { length: NR, area: TN },
    when_words: [{ unit_class: "area", words: ["acoustic", "lining"], family: AN }],
    rule: "R2 material not mentioned -> Nitrile by row kind",
  };
  const CLAD = { cladding: { value: "No", rule: "R1 cladding not mentioned -> without cladding", absent_as_none: false } };
  const cfg = (pricing: Record<string, unknown> = {}): Cfg => ({
    ...INS,
    list_spec: { ...INS.list_spec, pricing: { ...INS.list_spec.pricing, family_when_none: FWN, defaults: CLAD, ...pricing } },
  });
  const spec = (c: Cfg = cfg()) => itemListPricingSpec(c)!;
  const item = (attrs: Record<string, string>): ExtractedListItem => ({
    attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v }])),
  });
  const price = (unit: string, attrs: Record<string, string>, text = "", s = spec()) =>
    priceItemList(s, ITEMS, unit, [item(attrs)], text);

  it("POSITIVE (b): no material, per metre -> Nitrile Rubber, marked, and the row prices (286 / 14 at 25 mm dia -> 28.58, 19 mm, no cladding)", () => {
    const r = price("Rmt", { cladding: "None", thickness_mm: "19 mm", pipe_size_mm: "25 mm dia" }, "25 mm dia | 19 mm thick insulation from 25 mm dia to 32 mm dia");
    expect(r.priced).toBe(true);
    expect(r.items[0].family).toBe(NR);
    expect(r.items[0].familyDefaulted).toEqual({ value: NR, rule: FWN.rule });
    expect(r.items[0].working).toContain(`item not mentioned -> ${NR} (${FWN.rule})`);
    expect(r.supply).toBe(286);
    expect(r.install).toBe(14);
  });

  it("POSITIVE (c): no material, per sq.m -> Thermal Nitrile, marked (383 / 154 at 9 mm, no cladding)", () => {
    const r = price("M2", { cladding: "None", thickness_mm: "9MM" }, "THERMAL INSULATION 9MM TH");
    expect(r.priced).toBe(true);
    expect(r.items[0].family).toBe(TN);
    expect(r.items[0].familyDefaulted?.value).toBe(TN);
    expect([r.supply, r.install]).toEqual([383, 154]);
  });

  it("POSITIVE (d): no material, per sq.m, 'acoustic' in a HEADING -> Acoustic Nitrile, marked (1371 / 154 at 15 mm)", () => {
    const r = price("Sqmt", { cladding: "None", thickness_mm: "15mm" }, "15mm thick for Ducts | ACOUSTIC INSULATION");
    expect(r.priced).toBe(true);
    expect(r.items[0].family).toBe(AN);
    expect(r.items[0].familyDefaulted?.value).toBe(AN);
    expect([r.supply, r.install]).toEqual([1371, 154]);
  });

  it("POSITIVE: 'lining' in the row's OWN text decides acoustic too; the test is a word start, case-insensitive ('ACOUSTICS' counts, 'subacoustic' does not)", () => {
    expect(price("Sqm", { cladding: "None", thickness_mm: "15 mm" }, "15 mm thick duct Lining").items[0].family).toBe(AN);
    expect(price("Sqm", { cladding: "None", thickness_mm: "15 mm" }, "INSULATION & ACOUSTICS").items[0].family).toBe(AN);
    expect(price("Sqm", { cladding: "None", thickness_mm: "15 mm" }, "subacoustic duct").items[0].family).toBe(TN);
    expect(price("Sqm", { cladding: "None", thickness_mm: "15 mm" }, "").items[0].family).toBe(TN);
  });

  it("NEGATIVE: a STATED family is never touched -- Thermal stays Thermal under an acoustic heading, and carries no default mark", () => {
    const r = price("Sqm", { item: TN, cladding: "None", thickness_mm: "13 mm" }, "ACOUSTIC INSULATION");
    expect(r.items[0].family).toBe(TN);
    expect(r.items[0].familyDefaulted).toBeUndefined();
    expect(r.items[0].working.some((w) => w.startsWith("item not mentioned"))).toBe(false);
  });

  it("NEGATIVE: a stated 'none of these' is a stated family -- it refuses for its SKU, it is NOT defaulted", () => {
    const r = price("Sqm", { item: "none of these", cladding: "None", thickness_mm: "13 mm" }, "rockwool");
    expect(r.priced).toBe(false);
    expect(r.items[0].familyDefaulted).toBeUndefined();
    expect(r.items[0].reason).toMatch(/no SKU in the catalogue for 'none of these'/);
  });

  it("NEGATIVE: the words fire ONLY on the unit class they are declared for -- an acoustic word on a per-metre row still prices Nitrile Rubber", () => {
    const r = price("Rmt", { cladding: "None", thickness_mm: "19 mm", pipe_size_mm: "25 mm dia" }, "acoustic lining of pipe");
    expect(r.items[0].family).toBe(NR);
  });

  it("NEGATIVE: a unit class the block does not name, or NO block at all, refuses exactly as before (no family, no mark)", () => {
    const only = cfg({ family_when_none: { by_unit_class: { length: NR }, rule: FWN.rule } });
    const r = price("Sqm", { cladding: "None", thickness_mm: "13 mm" }, "ACOUSTIC", spec(only));
    expect(r.priced).toBe(false);
    expect(r.items[0].familyDefaulted).toBeUndefined();
    expect(r.items[0].reason).toMatch(/could be told for this item/);
    const none = { ...INS, list_spec: { ...INS.list_spec, pricing: { ...INS.list_spec.pricing, defaults: CLAD } } } as Cfg;
    const r2 = price("Rmt", { cladding: "None", thickness_mm: "19 mm", pipe_size_mm: "25 mm dia" }, "", spec(none));
    expect(r2.priced).toBe(false);
    expect(r2.items[0].familyDefaulted).toBeUndefined();
  });

  it("POSITIVE: the ruled family rides through a COMPOSITION -- every layer prices as it, each marked", () => {
    const r = price("Rmt", { cladding: "None", thickness_mm: "32 mm", pipe_size_mm: "25 mm dia" }, "25 mm dia");
    expect(r.priced).toBe(true);
    expect(r.items.length).toBe(2);
    for (const p of r.items) {
      expect(p.family).toBe(NR);
      expect(p.familyDefaulted?.value).toBe(NR);
    }
  });

  it("familyWhenNone itself: null without the block or for an unmapped class; the FIRST matching word rule wins", () => {
    expect(familyWhenNone(spec({ ...INS, list_spec: { ...INS.list_spec, pricing: { ...INS.list_spec.pricing } } } as Cfg), "area", "acoustic")).toBeNull();
    expect(familyWhenNone(spec(), "count", "acoustic")).toBeNull();
    const two = cfg({ family_when_none: { ...FWN, when_words: [
      { unit_class: "area", words: ["lining"], family: AN },
      { unit_class: "area", words: ["lining"], family: TN },
    ] } });
    expect(familyWhenNone(spec(two), "area", "duct lining")?.value).toBe(AN);
  });
});

// ---------------------------------------------------------------------------------------------------------
// SLICE 12d-1a (owner R4, 2026-10-07) -- value_map: a STATED choice value maps to another value of the same
// attribute for named families (foil on a pipe -> 26G), or REFUSES with a reason (foil on an acoustic row).
// ---------------------------------------------------------------------------------------------------------
describe("SLICE 12d-1a / R4 -- value_map: foil on a pipe prices as 26G; foil on an acoustic row refuses; a sheet keeps Aluminium Foil", () => {
  type Cfg = RateCategoryConfig & { list_spec: { pricing: Record<string, unknown> } };
  const V26 = HVAC_V26 as unknown as Asset;
  const INS = V26.category_configs.find((c) => c.category_id === "hvac_insulation") as unknown as Cfg;
  const ITEMS = V26.items;
  const NR = "Nitrile Rubber Insulation";
  const TN = "Thermal Nitrile Insulation";
  const AN = "Acoustic Nitrile Insulation";
  const PUF = "Tubular Puf Insulation";
  const VM = [
    { attr: "cladding", families: [NR, PUF], from: "Aluminium Foil", to: "26G Aluminium", rule: "R4 foil on a pipe is priced as 26G cladding", display: "26G Aluminium" },
    { attr: "cladding", families: [AN], from: "Aluminium Foil", refuse: "foil on an acoustic row - the catalogue has no foil-faced acoustic insulation; set the cladding (R4)" },
  ];
  const CLAD = { cladding: { value: "No", rule: "R1 cladding not mentioned -> without cladding", absent_as_none: false } };
  const cfg = (pricing: Record<string, unknown> = {}): Cfg => ({
    ...INS,
    list_spec: { ...INS.list_spec, pricing: { ...INS.list_spec.pricing, value_map: VM, defaults: CLAD, ...pricing } },
  });
  const spec = (c: Cfg = cfg()) => itemListPricingSpec(c)!;
  const item = (attrs: Record<string, string>): ExtractedListItem => ({
    attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v }])),
  });
  const price = (unit: string, attrs: Record<string, string>, s = spec()) => priceItemList(s, ITEMS, unit, [item(attrs)]);

  it("POSITIVE (g): foil on a PIPE -> 26G Aluminium, recorded as an override with the catalogue's word, priced 545 / 224 (25 mm at 32 NB -> 34.93)", () => {
    const r = price("Rmt", { item: NR, cladding: "Aluminium Foil", thickness_mm: "25 mm", pipe_size_mm: "32 mm NB" });
    expect(r.priced).toBe(true);
    expect(r.items[0].selection.cladding).toBe("26G Aluminium");
    expect(r.items[0].overrides).toEqual([{ attr: "cladding", value: "26G Aluminium", display: "26G Aluminium", rule: VM[0].rule }]);
    expect(r.items[0].working).toContain(VM[0].rule);
    expect([r.supply, r.install]).toEqual([545, 224]);
  });

  it("POSITIVE: the same on Tubular PUF (the other pipe family)", () => {
    const r = price("Rmt", { item: PUF, cladding: "Aluminium Foil", thickness_mm: "25 mm", pipe_size_mm: "50 mm NB" });
    expect(r.priced).toBe(true);
    expect(r.items[0].selection.cladding).toBe("26G Aluminium");
  });

  it("POSITIVE (h): foil on an ACOUSTIC row REFUSES with the configured reason, nothing priced", () => {
    const r = price("Sqm", { item: AN, cladding: "Aluminium Foil", thickness_mm: "15 mm" });
    expect(r.priced).toBe(false);
    expect(r.items[0].reason).toBe(VM[1].refuse);
    expect(r.items[0].overrides).toEqual([]);
  });

  it("NEGATIVE: a SHEET row keeps Aluminium Foil as stated -- no rule names Thermal Nitrile, so the catalogue's own foil SKU prices (581 / 154 at 13 mm)", () => {
    const r = price("Sqm", { item: TN, cladding: "Aluminium Foil", thickness_mm: "13 mm" });
    expect(r.priced).toBe(true);
    expect(r.items[0].selection.cladding).toBe("Aluminium Foil");
    expect(r.items[0].overrides).toEqual([]);
    expect([r.supply, r.install]).toEqual([581, 154]);
  });

  it("NEGATIVE: no foil mentioned -> no cladding (the R1 default), the map does not fire on 'No'", () => {
    const r = price("Rmt", { item: NR, cladding: "None", thickness_mm: "25 mm", pipe_size_mm: "32 mm NB" });
    expect(r.priced).toBe(true);
    expect(r.items[0].selection.cladding).toBe("No");
    expect(r.items[0].overrides).toEqual([]);
    expect(r.items[0].defaulted.map((d) => d.attr)).toEqual(["cladding"]);
  });

  it("NEGATIVE: a stated 26G on a pipe is byte-identical to before (the map fires only on its `from`)", () => {
    const before = priceItemList(itemListPricingSpec(INS)!, ITEMS, "Rmt", [item({ item: NR, cladding: "26G Aluminium", thickness_mm: "25 mm", pipe_size_mm: "32 mm NB" })]);
    const after = price("Rmt", { item: NR, cladding: "26G Aluminium", thickness_mm: "25 mm", pipe_size_mm: "32 mm NB" });
    expect(after).toEqual(before);
  });

  it("NEGATIVE: without the block, foil on a pipe refuses as it always did (no SKU for that combination)", () => {
    const r = price("Rmt", { item: NR, cladding: "Aluminium Foil", thickness_mm: "25 mm", pipe_size_mm: "32 mm NB" }, spec({ ...INS, list_spec: { ...INS.list_spec, pricing: { ...INS.list_spec.pricing, defaults: CLAD } } } as Cfg));
    expect(r.priced).toBe(false);
    expect(r.items[0].reason).toMatch(/no SKU for this combination/);
  });

  it("the map runs AFTER the defaults and overrides: a ruled 'No' never reads as foil, and the panel's field shows the mapped word", () => {
    const r = price("Rmt", { item: NR, cladding: "Aluminium Foil", thickness_mm: "25 mm", pipe_size_mm: "32 mm NB" });
    expect(r.items[0].readValues.cladding).toBe("26G Aluminium");
  });
});

// ---------------------------------------------------------------------------------------------------------
// SLICE 12d-1b (owner T1, 2026-10-07) -- A STATED THICKNESS IS READ BEFORE ANY DEFAULT; an unreadable one
// REFUSES; 9 mm (then the ladder) applies ONLY when nothing is mentioned, on every Insulation family.
// ---------------------------------------------------------------------------------------------------------
describe("SLICE 12d-1b / T1 -- a stated thickness is read first; unreadable refuses; the 9 mm default only when nothing is mentioned", () => {
  type Cfg = RateCategoryConfig & { list_spec: { pricing: Record<string, unknown> } };
  const V27 = HVAC_V27 as unknown as Asset;
  const INS = V27.category_configs.find((c) => c.category_id === "hvac_insulation") as unknown as Cfg;
  const ITEMS = V27.items;
  const NR = "Nitrile Rubber Insulation";
  const TN = "Thermal Nitrile Insulation";
  const FG = " Fiberglass Rigid Board Insulation, Density 48Kg/m3";
  const PUF = "Tubular Puf Insulation";
  /** v27 scopes the 9 mm default to Cladding Only; the slice widens it to every family (the v28 mint). */
  const WIDE = { thickness_mm: { value: 9.0, rule: "T1 thickness not mentioned -> 9 mm, then the ladder" } };
  const cfg = (pricing: Record<string, unknown> = {}): Cfg => ({
    ...INS, list_spec: { ...INS.list_spec, pricing: { ...INS.list_spec.pricing, number_defaults: WIDE, ...pricing } },
  });
  const spec = (c: Cfg = cfg()) => itemListPricingSpec(c)!;
  const item = (attrs: Record<string, string>): ExtractedListItem => ({
    attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v }])),
  });
  const price = (unit: string, attrs: Record<string, string>, s = spec()) => priceItemList(s, ITEMS, unit, [item(attrs)]);

  it("POSITIVE (e): 'as per specification' as the thickness REFUSES with its reason -- never 9 mm, even with the default widened", () => {
    const r = price("Rmt", { item: NR, cladding: "No", thickness_mm: "as specified in the tender specs.", pipe_size_mm: "50 mm" });
    expect(r.priced).toBe(false);
    expect(r.items[0].reason).toBe("no number in 'as specified in the tender specs.' for thickness");
    expect(r.items[0].defaulted).toEqual([]);
  });

  it("NEGATIVE: a text the reader cannot take ('13+13' typed, a comma list) refuses by name, not 9", () => {
    for (const t of ["13+13", "9, 13 mm"]) {
      const typedItem: ExtractedListItem = { attributes: { item: { value: NR }, cladding: { value: "No" }, thickness_mm: { value: t, typed: true }, pipe_size_mm: { value: "25 mm dia" } } };
      const r = priceItemList(spec(), ITEMS, "Rmt", [typedItem]);
      expect(r.priced).toBe(false);
      expect(r.items[0].reason).toBe(`several values stated for thickness ('${t}')`);
      expect(r.items[0].selection.thickness_mm).toBeUndefined();
    }
  });

  it("POSITIVE (a): nothing mentioned -> 9 mm, marked, then the ladder -- Nitrile Rubber 13 at 28.58 (238 / 14)", () => {
    const r = price("Rmt", { item: NR, cladding: "No", pipe_size_mm: "25 mm dia" });
    expect(r.priced).toBe(true);
    expect(r.items[0].defaulted).toEqual([{ attr: "thickness_mm", value: "9", rule: WIDE.thickness_mm.rule }]);
    expect(r.items[0].ladderHops.find((h) => h.attr === "thickness_mm")).toMatchObject({ requested: 9, fitted: 13 });
    expect([r.supply, r.install]).toEqual([238, 14]);
  });

  it("POSITIVE (a): Thermal 9 (383 / 154); Fiberglass -> 12 (310 / 154); PUF at pipe 50 -> its stocked 50 (210 / 14)", () => {
    const tn = price("Sqm", { item: TN, cladding: "No" });
    expect(tn.priced).toBe(true); expect([tn.supply, tn.install]).toEqual([383, 154]);
    expect(tn.items[0].selection.thickness_mm).toBe(9);
    const fg = price("Sqm", { item: FG, cladding: "No" });
    expect(fg.priced).toBe(true); expect([fg.supply, fg.install]).toEqual([310, 154]);
    expect(fg.items[0].selection.thickness_mm).toBe(12);
    const puf = price("Rmt", { item: PUF, cladding: "No", pipe_size_mm: "50 mm" });
    expect(puf.priced).toBe(true); expect([puf.supply, puf.install]).toEqual([210, 14]);
    expect(puf.items[0].selection.thickness_mm).toBe(50);
    for (const r of [tn, fg, puf]) expect(r.items[0].defaulted.map((d) => d.attr)).toEqual(["thickness_mm"]);
  });

  it("NEGATIVE: a STATED thickness is used as stated and carries no default mark", () => {
    const r = price("Sqm", { item: TN, cladding: "No", thickness_mm: "13 mm" });
    expect(r.priced).toBe(true);
    expect(r.items[0].selection.thickness_mm).toBe(13);
    expect(r.items[0].defaulted).toEqual([]);
  });

  it("NEGATIVE: with the v27 scope (Cladding Only) a silent Nitrile row still refuses 'no thickness stated' -- the widening is the asset's, not code's", () => {
    const r = price("Rmt", { item: NR, cladding: "No", pipe_size_mm: "25 mm dia" }, itemListPricingSpec(INS)!);
    expect(r.priced).toBe(false);
    expect(r.items[0].reason).toBe("no thickness stated");
  });
});

// ---------------------------------------------------------------------------------------------------------
// SLICE 12d-1b (owner T2, 2026-10-07) -- `numbers[attr].several = "highest"`: a bare slash list of ANY length
// reads as its highest. ABSENT => a list of three or more still refuses, so ADP is byte-identical.
// ---------------------------------------------------------------------------------------------------------
describe("SLICE 12d-1b / T2 -- several = highest: a bare slash list of any length reads as its highest (config-gated)", () => {
  type Cfg = RateCategoryConfig & { list_spec: { pricing: Record<string, unknown> } };
  const V27 = HVAC_V27 as unknown as Asset;
  const INS = V27.category_configs.find((c) => c.category_id === "hvac_insulation") as unknown as Cfg;
  const ITEMS = V27.items;
  const NR = "Nitrile Rubber Insulation";
  const base = (INS.list_spec.pricing as { numbers: Record<string, NumberReader> }).numbers;
  const HIGHEST: NumberReader = { ...base.thickness_mm, several: "highest" };
  const cfg = (): Cfg => ({
    ...INS, list_spec: { ...INS.list_spec, pricing: { ...INS.list_spec.pricing, numbers: { ...base, thickness_mm: HIGHEST } } },
  });
  const item = (attrs: Record<string, string>): ExtractedListItem => ({
    attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v }])),
  });

  it("readNumber: with several = highest a three-value slash list reads as 32 with a note; the pair rule is unchanged", () => {
    expect(readNumber("19/ 25 / 32 mm", HIGHEST)).toEqual({ value: 32, note: "'19/ 25 / 32 mm' states several values -- the highest, 32, is taken" });
    expect(readNumber("13/19/25/32", HIGHEST)).toMatchObject({ value: 32 });
    expect(readNumber("25mm/32mm", HIGHEST)).toMatchObject({ value: 32 });
  });

  it("NEGATIVE: ABSENT => today's behaviour, byte-identical -- three values refuse by name", () => {
    expect(readNumber("19/ 25 / 32 mm", base.thickness_mm)).toEqual({ blank: "several values stated for thickness ('19/ 25 / 32 mm')" });
    expect(readNumber("25mm/32mm", base.thickness_mm)).toMatchObject({ value: 32 });
  });

  it("NEGATIVE: only a BARE slash list qualifies -- a comma list, a '+' pair and a signed tolerance still refuse under the flag", () => {
    for (const t of ["3.5, 7.9 & 15.9", "65 mm + 32 mm", "25 +/- 2 mm", "6/8 / 10 Port, 12"]) {
      expect(readNumber(t, HIGHEST)).toEqual({ blank: `several values stated for thickness ('${t}')` });
    }
  });

  it("POSITIVE (b): '19/ 25 / 32 mm' on a Nitrile pipe row at 32NB -> 32 -> composed 13 + 19, cladding on the outer only: 250/14 + 493/224 = 743 / 238", () => {
    const r = priceItemList(itemListPricingSpec(cfg())!, ITEMS, "RMT",
      [item({ item: NR, cladding: "26G Aluminium", thickness_mm: "19/ 25 / 32 mm", pipe_size_mm: "32NB" })]);
    expect(r.priced).toBe(true);
    expect(r.items.map((p) => [p.selection.thickness_mm, p.selection.cladding, p.figures.supply, p.figures.install]))
      .toEqual([[13, "No", 250, 14], [19, "26G Aluminium", 493, 224]]);
    expect([r.supply, r.install]).toEqual([743, 238]);
    // the 'highest' note belongs to the STATED item; the composition re-prices its layers from the numbers
    // (12d-2 S5: a MODEL cell reads "BoQ says"; the 12d-1b pin said "You typed" for every composition)
    expect(r.items[0].working[0]).toMatch(/^BoQ says 32 mm -> priced as 13 \+ 19 mm/);
  });

  it("NEGATIVE: the same row WITHOUT the flag refuses 'several values stated', exactly as before this slice", () => {
    const r = priceItemList(itemListPricingSpec(INS)!, ITEMS, "RMT",
      [item({ item: NR, cladding: "26G Aluminium", thickness_mm: "19/ 25 / 32 mm", pipe_size_mm: "32NB" })]);
    expect(r.priced).toBe(false);
    expect(r.items[0].reason).toBe("several values stated for thickness ('19/ 25 / 32 mm')");
  });

  it("HAZARD PIN (recon item 10): a pipe-size field holding a slash list is NOT read as inches -- it refuses by name", () => {
    expect(readNumber("19/ 25 / 32 mm", base.pipe_size_mm)).toEqual({ blank: "several values stated for pipe size ('19/ 25 / 32 mm')" });
    // a genuine inch fraction still converts
    expect((readNumber("7/8\"", base.pipe_size_mm) as { value: number }).value).toBeCloseTo(22.225, 3);
  });

  it("HAZARD PIN (recon item 10): '50 mm - 32 mm' copied into thickness reads as a RANGE -> its top, 50 -- pinned so a prompt change that starts copying such phrases is caught", () => {
    expect(readNumber("50 mm - 32 mm thick", HIGHEST)).toEqual({ value: 50, note: "range '50 mm - 32 mm thick' -> its top value 50 (R6)" });
  });
});

// ---------------------------------------------------------------------------------------------------------
// SLICE 12d-1b (owner T4 / T6, 2026-10-07) -- DOUBLE LAYERS the MODEL reads ("a + b", "a x 2", "2 layers of a")
// expand through the EXISTING composition path with outer_only: each layer its own item at the row's pipe
// size, cladding on the outer layer only. A pricer's TYPED entry is never parsed as layers (T6).
// ---------------------------------------------------------------------------------------------------------
describe("SLICE 12d-1b / T4 -- model-read layers expand through the composition path; T6 -- a typed entry does not", () => {
  type Cfg = RateCategoryConfig & { list_spec: { pricing: Record<string, unknown> } };
  const V27 = HVAC_V27 as unknown as Asset;
  const INS = V27.category_configs.find((c) => c.category_id === "hvac_insulation") as unknown as Cfg;
  const ITEMS = V27.items;
  const NR = "Nitrile Rubber Insulation";
  const spec = itemListPricingSpec({
    ...INS, list_spec: { ...INS.list_spec, pricing: { ...INS.list_spec.pricing,
      defaults: { cladding: { value: "No", rule: "R1", absent_as_none: false } } } },
  } as Cfg)!;
  const item = (attrs: Record<string, string>, typed: string[] = []): ExtractedListItem => ({
    attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, typed.includes(k) ? { value: v, typed: true } : { value: v, confidence: 0.9 }])),
  });
  const price = (unit: string, attrs: Record<string, string>, typed: string[] = []) => priceItemList(spec, ITEMS, unit, [item(attrs, typed)]);

  it("readLayers: the three shapes, and nothing else", () => {
    expect(readLayers("13 + 13")).toEqual([13, 13]);
    expect(readLayers("65 mm + 32 mm thick")).toEqual([32, 65]);
    expect(readLayers("19 + 25 + 19 mm")).toEqual([19, 19, 25]);
    expect(readLayers("13 x 2")).toEqual([13, 13]);
    expect(readLayers("2 x 13 mm")).toEqual([13, 13]);
    expect(readLayers("2 layers of 19 mm")).toEqual([19, 19]);
    expect(readLayers("double layer of 19 mm")).toEqual([19, 19]);
    expect(readLayers("two layers of 25mm")).toEqual([25, 25]);
    for (const t of ["19", "19/ 25 / 32 mm", "25 +/- 2 mm", "9, 13", "1 layer of 19", "0 x 13", "600 x 600", "13+", "as per spec"]) {
      expect(readLayers(t)).toBeNull();
    }
  });

  it("POSITIVE (d): '13 + 13' on a small pipe (25 mm dia -> 28.58): two 13 mm items, cladding on the OUTER only (here the R1 default No on both): 238 + 238 = 476 / 28", () => {
    const r = price("Rmt", { item: NR, cladding: "None", thickness_mm: "13 + 13", pipe_size_mm: "25 mm dia" });
    expect(r.priced).toBe(true);
    expect(r.items.map((p) => [p.selection.thickness_mm, p.selection.cladding, p.selection.pipe_size_mm, p.sourceIndex])).toEqual([[13, "No", 28.58, 0], [13, "No", 28.58, 0]]);
    expect([r.supply, r.install]).toEqual([476, 28]);
    expect(r.items[0].working[0]).toBe("BoQ says 13 + 13 -> priced as two layers, 13 + 13 mm (26 mm); cladding on the outer layer only");
  });

  it("POSITIVE: with a stated cladding the OUTER layer keeps it and the inner is bare: '19 x 2' at 32NB with 26G -> 19 (No) + 19 (26G)", () => {
    const r = price("Rmt", { item: NR, cladding: "26G Aluminium", thickness_mm: "19 x 2", pipe_size_mm: "32NB" });
    expect(r.priced).toBe(true);
    expect(r.items.map((p) => [p.selection.thickness_mm, p.selection.cladding])).toEqual([[19, "No"], [19, "26G Aluminium"]]);
    expect(r.items[1].overrides).toEqual([]);
  });

  it("POSITIVE: a row with NO pipe size still refuses, per layer, exactly as today ('65 mm + 32 mm' -> no pipe size stated)", () => {
    const r = price("Rmt", { item: NR, cladding: "26G Aluminium with Glass Cloth", thickness_mm: "65 mm + 32 mm" });
    expect(r.priced).toBe(false);
    expect(r.reason).toBe("item 1 (Nitrile Rubber Insulation): no pipe size stated");
    expect(r.items.length).toBe(2);
    expect(r.items.every((p) => p.reason === "no pipe size stated")).toBe(true);
  });

  it("NEGATIVE (T6): the SAME text TYPED by the pricer is never parsed as layers -- it refuses 'several values stated', the calculator's single-number entry unchanged", () => {
    const r = price("Rmt", { item: NR, cladding: "None", thickness_mm: "13+13", pipe_size_mm: "25 mm dia" }, ["thickness_mm"]);
    expect(r.priced).toBe(false);
    expect(r.items.length).toBe(1);
    expect(r.items[0].reason).toBe("several values stated for thickness ('13+13')");
  });

  it("NEGATIVE: a single stated thickness is one item, never split; a layer text on a category with NO `compose` refuses as before", () => {
    const one = price("Rmt", { item: NR, cladding: "None", thickness_mm: "19 mm", pipe_size_mm: "25 mm dia" });
    expect(one.items.length).toBe(1);
    const noCompose = itemListPricingSpec({ ...INS, list_spec: { ...INS.list_spec, pricing: { ...INS.list_spec.pricing, compose: undefined } } } as Cfg)!;
    const r = priceItemList(noCompose, ITEMS, "Rmt", [item({ item: NR, cladding: "No", thickness_mm: "13 + 13", pipe_size_mm: "25 mm dia" })]);
    expect(r.priced).toBe(false);
    expect(r.items[0].reason).toBe("several values stated for thickness ('13 + 13')");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * SLICE 12d-2 (owner S4 / S5 / S6, 2026-10-07) -- "None" NOT OFFERED WHERE A RULED DEFAULT MAPS IT;
 * "You typed" ONLY FOR WHAT A PERSON TYPED; A REFUSING ROW SAYS "unit taken as", A PRICED ONE
 * "priced per", AND THE FIGURES' UNIT IS THE CATALOGUE'S WORD.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
describe("SLICE 12d-2 / S4 -- the sentinel \"None\" is offered ONLY where no ruled default maps it to a catalogue value", () => {
  const v27 = HVAC_V27 as unknown as Asset;
  const insCfg = v27.category_configs.find((c) => c.category_id === "hvac_insulation")!;
  const insSpec = itemListPricingSpec(insCfg)!;
  const insDefs = listSpecDefs(insCfg);
  const insItems = v27.items.map((i) => ({ ...i, discipline: "HVAC" }));

  it("ONE reader: ruledDefaultValue is exactly what the pricing applies over a \"None\" answer -- value, by_family, or nothing", () => {
    expect(ruledDefaultValue(spec, "damper", "round diffuser")).toBe("without");
    expect(ruledDefaultValue(spec, "ul", "actuator")).toBe("no");
    expect(ruledDefaultValue(spec, "variant", "VCD")).toBe("GI rectangular");
    expect(ruledDefaultValue(spec, "variant", "linear grille")).toBeUndefined();     // by_family names no such family
    expect(ruledDefaultValue(spec, "air", "linear grille")).toBeUndefined();          // no default at all
    expect(ruledDefaultValue(insSpec, "cladding", "Thermal Nitrile Insulation")).toBe("No");
    // and the pricing agrees: a "None" damper on a round diffuser prices as the default the reader names
    const r = priceItemList(spec, items, "Nos", [ext({ family: "round diffuser", damper: "None", dia_mm: "150" })]);
    expect(r.items[0].defaulted.map((d) => [d.attr, d.value])).toEqual([["damper", "without"]]);
  });

  it("POSITIVE: Insulation's cladding (ruled default: not mentioned -> No) offers NO \"None\"; the catalogue values stay", () => {
    const f = itemFieldDefs(insSpec, insDefs, "Thermal Nitrile Insulation", "area", { items: insItems }).find((x) => x.id === "cladding")!;
    expect(f.allowNone).toBe(true);                       // the definition still allows the model to answer "None" ...
    expect(f.options).not.toContain("None");              // ... but a person is not offered it
    expect(f.options!.length).toBeGreaterThan(0);
    expect(f.options).toContain("No");
  });

  it("NEGATIVE kept: an allow_none attribute with NO ruled default still offers \"None\" first (the air stream); a per-family default spares the other families", () => {
    const air = itemFieldDefs(spec, listSpecDefs(adp), "linear grille", "area").find((f) => f.id === "air")!;
    expect(air.allowNone).toBe(true);
    expect(air.options![0]).toBe("None");
    // variant: VCD and fire damper carry a by_family default; a family outside the map keeps the sentinel
    const specWithVariantEverywhere = itemListPricingSpec({
      ...adp, list_spec: { ...(adp as unknown as { list_spec: Record<string, unknown> }).list_spec,
        pricing: { ...spec, families: { ...spec.families, "linear grille": { ...spec.families["linear grille"], needs: [...spec.families["linear grille"].needs, "variant"] } } } },
    } as unknown as RateCategoryConfig)!;
    const v = itemFieldDefs(specWithVariantEverywhere, listSpecDefs(adp), "linear grille", "area").find((f) => f.id === "variant")!;
    expect(v.options![0]).toBe("None");
  });

  it("NEGATIVE: the DISPLAY half is untouched -- a \"None\" answer under a ruled default already renders the catalogue value, marked (the pricing's `defaulted`)", () => {
    const r = priceItemList(insSpec, insItems, "Sqm", [{ attributes: { item: { value: "Thermal Nitrile Insulation" }, cladding: { value: "None" }, thickness_mm: { value: "13 mm" } } }]);
    expect(r.priced).toBe(true);
    expect(r.items[0].defaulted.map((d) => [d.attr, d.value])).toEqual([["cladding", "No"]]);
  });
});

describe("SLICE 12d-2 / S5 -- \"You typed\" only for what a person typed; a model-read value reads \"BoQ says\"", () => {
  const v27 = HVAC_V27 as unknown as Asset;
  const insCfg = v27.category_configs.find((c) => c.category_id === "hvac_insulation")!;
  const insSpec = itemListPricingSpec(insCfg)!;
  const insItems = v27.items.map((i) => ({ ...i, discipline: "HVAC" }));
  const NR = "Nitrile Rubber Insulation";
  const cell = (v: string, typed?: boolean) => ({ value: v, ...(typed ? { typed: true } : {}) });

  it("a MODEL-read 32 mm above the top rung composes and says \"BoQ says 32 mm -> priced as 13 + 19 mm\"", () => {
    const r = priceItemList(insSpec, insItems, "Rmt", [{ attributes: { item: cell(NR), cladding: cell("No"), thickness_mm: cell("32"), pipe_size_mm: cell("19.05") } }]);
    expect(r.priced).toBe(true);
    expect(r.items[0].working[0]).toMatch(/^BoQ says 32 mm -> priced as 13 \+ 19 mm \(32 mm, \+0\)/);
  });

  it("the SAME value typed by the pricer (the 12d-1b `typed` marker) says \"You typed 32 mm\"", () => {
    const r = priceItemList(insSpec, insItems, "Rmt", [{ attributes: { item: cell(NR), cladding: cell("No"), thickness_mm: cell("32", true), pipe_size_mm: cell("19.05") } }]);
    expect(r.priced).toBe(true);
    expect(r.items[0].working[0]).toMatch(/^You typed 32 mm -> priced as 13 \+ 19 mm \(32 mm, \+0\)/);
  });

  it("NEGATIVE: the figures are identical either way -- the marker changes the sentence, never the price; explicit layers keep their own line", () => {
    const model = priceItemList(insSpec, insItems, "Rmt", [{ attributes: { item: cell(NR), cladding: cell("No"), thickness_mm: cell("32"), pipe_size_mm: cell("19.05") } }]);
    const typed = priceItemList(insSpec, insItems, "Rmt", [{ attributes: { item: cell(NR), cladding: cell("No"), thickness_mm: cell("32", true), pipe_size_mm: cell("19.05") } }]);
    expect([model.supply, model.install]).toEqual([typed.supply, typed.install]);
    expect(model.items.map((i) => i.selection.thickness_mm)).toEqual(typed.items.map((i) => i.selection.thickness_mm));
  });
});

describe("SLICE 12d-2 / S6 -- a no-unit / rate-only row: \"unit taken as\" while it refuses, \"priced per\" once it prices, and the catalogue word as the rate's unit", () => {
  it("PRICED: the note says \"priced per number\" and the result carries rateUnit \"number\" (the figures' label), never the BoQ's spelling", () => {
    for (const u of ["", "R/O", "Rate Only"]) {
      const r = one(u, { family: "butterfly damper", dia_mm: "100" });
      expect(r.priced, u).toBe(true);
      expect(r.unitNote, u).toMatch(/-> priced per number, the catalogue's unit for this item$/);
      expect(r.rateUnit, u).toBe("number");
    }
  });

  it("REFUSING: the same row with a size the catalogue cannot take says \"unit taken as number\" -- never \"priced\" -- and still names the unit", () => {
    const r = one("", { family: "butterfly damper", dia_mm: "as per drawing" });
    expect(r.priced).toBe(false);
    expect(r.unitNote).toBe("No unit on the BoQ row -> unit taken as number, the catalogue's unit for this item");
    expect(r.rateUnit).toBe("number");
    const ro = one("R/O", { family: "butterfly damper", dia_mm: "as per drawing" });
    expect(ro.priced).toBe(false);
    expect(ro.unitNote).toBe("BoQ says R/O (rate only) -> unit taken as number, the catalogue's unit for this item");
    // and a row with no items at all
    const empty = priceItemList(spec, items, "", []);
    expect(empty.priced).toBe(false);
    expect(empty.unitNote).toBeUndefined();   // no items -> no classes to resolve -> nothing was taken
  });

  it("NEGATIVE: a row that STATED its unit carries neither a note nor a rateUnit -- its own spelling labels the figures", () => {
    const r = one("Nos", { family: "butterfly damper", dia_mm: "100" });
    expect(r.priced).toBe(true);
    expect(r.unitNote).toBeUndefined();
    expect(r.rateUnit).toBeUndefined();
    const refused = one("Nos", { family: "butterfly damper", dia_mm: "as per drawing" });
    expect(refused.unitNote).toBeUndefined();
    expect(refused.rateUnit).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------
// SLICE 12d-4a (owner D3 / D4 / D7 / D8 / D9b / D10 / D11 on the 12d-3 audit, 2026-10-11) -- THE AUDIT FIXES.
// Every rule below is CONFIG-gated (a spec without the key is byte-identical: the NEGATIVE pins) and reads the
// row's OWN text -- its description and its own notes, NEVER a heading -- which the calculator does not have.
// ---------------------------------------------------------------------------------------------------------
describe("SLICE 12d-4a -- the audit fixes: named cladding, unstocked materials, sheet glass cloth, the density line, '- 2 Layers', QRO, the refusal order", () => {
  type Cfg = RateCategoryConfig & { list_spec: { pricing: Record<string, unknown> } };
  const V27 = HVAC_V27 as unknown as Asset;
  const INS = V27.category_configs.find((c) => c.category_id === "hvac_insulation") as unknown as Cfg;
  const ITEMS = V27.items;
  const NR = "Nitrile Rubber Insulation";
  const TN = "Thermal Nitrile Insulation";
  const FG = " Fiberglass Rigid Board Insulation, Density 48Kg/m3";
  const CO = "Cladding Only";
  const BASE = {
    ...INS.list_spec.pricing,
    defaults: { cladding: { value: "No", rule: "R1", absent_as_none: false } },
    no_sku_families: ["none of these"], no_sku_named_by: "material_as_written",
  };
  const withKeys = (extra: Record<string, unknown>) =>
    itemListPricingSpec({ ...INS, list_spec: { ...INS.list_spec, pricing: { ...BASE, ...extra } } } as Cfg)!;
  const plain = withKeys({});
  const D3 = { named_in_row: [{ attr: "cladding", words: ["glass cloth", "foil", "gi strip", "frp"], refuse: "cladding named in this row but not read - set the cladding", rule: "D3" }] };
  const D7 = { unstocked_materials: { words: ["epdm", "xlpe"], from_attr: "material_as_written", rule: "D7" } };
  const D9B = { refuse_on_unit_class: [{ unit_class: "area", attr: "cladding", value_contains: "Glass Cloth", words: ["glass cloth", "gc cloth"], refuse: "glass cloth is not offered on sheet insulation - price this row by hand", rule: "D9b" }] };
  const D8 = { read_notes: [{ families: [FG], from_attr: "material_as_written", pattern: "(\\d+(?:\\.\\d+)?)\\s*kg\\s*/\\s*(?:m3|cum|cu\\.?\\s*m)", unless: "48", line: "BoQ says {match} -> priced as the 48 kg/m3 board" }] };
  const item = (attrs: Record<string, string | null>): ExtractedListItem => ({
    attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v, confidence: 0.9 }])),
  });
  const price = (spec: ReturnType<typeof withKeys>, unit: string, attrs: Record<string, string | null>, ownText = "", rowText = "") =>
    priceItemList(spec, ITEMS, unit, [item(attrs)], rowText, ownText);

  it("D4: readLayers takes the SUFFIX form -- '25 mm thick - 2 Layers', '25 mm - two layers', 'double layer' after the number -- and nothing new besides", () => {
    expect(readLayers("25 mm thick - 2 Layers")).toEqual([25, 25]);
    expect(readLayers("25 mm - 2 Layers")).toEqual([25, 25]);
    expect(readLayers("25 mm thick two layers insulation")).toEqual([25, 25]);
    expect(readLayers("19mm thick double layer")).toEqual([19, 19]);
    expect(readLayers("25 mm thick: 3 layers")).toEqual([25, 25, 25]);
    for (const t of ["25 mm thick - 1 layer", "25 mm - 5 layers", "25 mm thick - Single layer", "2 Layers", "25 mm thick"]) {
      expect(readLayers(t), t).toBeNull();
    }
    // the three 12d-1b shapes are untouched
    expect(readLayers("65 mm + 32 mm thick")).toEqual([32, 65]);
    expect(readLayers("2 layers of 19 mm")).toEqual([19, 19]);
  });

  it("D4 POSITIVE: a model-read '25 mm thick - 2 Layers' at 50 mm dia prices as TWO 25 mm layers at 53.98, cladding on the outer only; the line names the BoQ's words", () => {
    const r = price(plain, "Rmt", { item: NR, cladding: "None", thickness_mm: "25 mm thick - 2 Layers", pipe_size_mm: "50 mm dia" });
    expect(r.priced).toBe(true);
    expect(r.items.map((p) => [p.selection.thickness_mm, p.selection.pipe_size_mm, p.sourceIndex])).toEqual([[25, 53.98, 0], [25, 53.98, 0]]);
    expect(r.items[0].working[0]).toBe("BoQ says 25 mm thick - 2 Layers -> priced as two layers, 25 + 25 mm (50 mm); cladding on the outer layer only");
    expect(r.supply).toBe(r.items[0].figures.supply + r.items[1].figures.supply);
  });

  it("wordStartHit: a WORD START, case-insensitive -- 'acoustic' matches 'Acoustics', never 'subacoustic'; the first hit is returned", () => {
    expect(wordStartHit("AHU Acoustics lining", ["acoustic"])).toBe("acoustic");
    expect(wordStartHit("subacoustic", ["acoustic"])).toBeNull();
    expect(wordStartHit("with GI strip at 1 m", ["foil", "gi strip"])).toBe("gi strip");
    expect(wordStartHit("anything", undefined)).toBeNull();
  });

  it("D3 POSITIVE: cladding answered 'None' while the row's OWN text names one -> refuses for a person, never the R1 default", () => {
    const r = price(withKeys(D3), "Sqm", { item: TN, cladding: "None", thickness_mm: "13 mm" }, "13 mm thick nitrile with chemically treated glass cloth");
    expect(r.priced).toBe(false);
    expect(r.items[0].reason).toBe("cladding named in this row but not read - set the cladding");
    expect(r.items[0].defaulted).toEqual([]);
  });

  it("D3 NEGATIVE x4: no key -> the R1 default prices (byte-identical); a heading-only word does not trigger it; a STATED value is never touched; the calculator (no own text) prices", () => {
    const own = "13 mm thick nitrile with chemically treated glass cloth";
    const noKey = price(plain, "Sqm", { item: TN, cladding: "None", thickness_mm: "13 mm" }, own);
    expect(noKey.priced).toBe(true);
    expect(noKey.items[0].defaulted.map((d) => d.attr)).toEqual(["cladding"]);
    const headingOnly = price(withKeys(D3), "Sqm", { item: TN, cladding: "None", thickness_mm: "13 mm" }, "13 mm thick", "13 mm thick | INSULATION WITH GLASS CLOTH");
    expect(headingOnly.priced).toBe(true);
    const stated = price(withKeys(D3), "Sqm", { item: TN, cladding: "No", thickness_mm: "13 mm" }, own);
    expect(stated.priced).toBe(true);
    const calculator = price(withKeys(D3), "Sqm", { item: TN, cladding: "None", thickness_mm: "13 mm" });
    expect(calculator.priced).toBe(true);
    expect([noKey.supply, headingOnly.supply, stated.supply, calculator.supply]).toEqual([464, 464, 464, 464]);
  });

  it("D7 POSITIVE: an unstocked material named in the copied text (EPDM) refuses BY NAME although the model picked Nitrile Rubber; named in the row's own text alone it still refuses, in capitals", () => {
    const copied = price(withKeys(D7), "RM", { item: NR, cladding: "None", thickness_mm: "19 mm", pipe_size_mm: "50mm dia", material_as_written: "closed cell elastomeric insulation with glass cloth facing (EPDM)" });
    expect(copied.priced).toBe(false);
    expect(copied.items[0].reason).toBe("No SKU in the catalogue for closed cell elastomeric insulation with glass cloth facing (EPDM) - price this row by hand");
    const own = price(withKeys(D7), "RM", { item: NR, cladding: "None", thickness_mm: "19 mm", pipe_size_mm: "50mm dia" }, "50 mm dia EPDM tubing");
    expect(own.items[0].reason).toBe("No SKU in the catalogue for EPDM - price this row by hand");
  });

  it("D7 NEGATIVE: without the key the same row prices (376 / 14 -- 19 mm at 53.98, cladding No by R1); with the key and no listed word it prices unchanged; the T5 'none of these' sentence is untouched", () => {
    const attrs = { item: NR, cladding: "None", thickness_mm: "19 mm", pipe_size_mm: "50mm dia", material_as_written: "closed cell elastomeric insulation with glass cloth facing (EPDM)" };
    const noKey = price(plain, "RM", attrs);
    expect([noKey.priced, noKey.supply, noKey.install]).toEqual([true, 376, 14]);
    const clean = price(withKeys(D7), "RM", { ...attrs, material_as_written: "closed cell nitrile rubber" });
    expect([clean.priced, clean.supply, clean.install]).toEqual([true, 376, 14]);
    const t5 = price(withKeys(D7), "Sqm", { item: "none of these", cladding: "None", thickness_mm: "25mm", material_as_written: "XLPE board" });
    expect(t5.items[0].reason).toBe("No SKU in the catalogue for XLPE board - price this row by hand");
  });

  it("D9b POSITIVE: glass cloth on a SHEET (area) row refuses with the ruled sentence -- on the value the pricing reads (Cladding Only per sq.m), and on a 'None' answer when the row's own text asks for it", () => {
    const byValue = price(withKeys(D9B), "Sqm", { item: CO, cladding: "Glass Cloth with paint" });
    expect(byValue.items[0].reason).toBe("glass cloth is not offered on sheet insulation - price this row by hand");
    const byWord = price(withKeys({ ...D9B, ...D3 }), "Sqm", { item: TN, cladding: "None", thickness_mm: "13 mm" }, "13 mm nitrile with treated glass cloth");
    // D9b runs BEFORE D3, so the person is told the OUTCOME, not asked to set a cladding the sheet would refuse
    expect(byWord.items[0].reason).toBe("glass cloth is not offered on sheet insulation - price this row by hand");
  });

  it("D9b NEGATIVE: a LENGTH row keeps glass cloth (a 26G Aluminium with Glass Cloth pipe prices); without the key the Cladding Only sq.m row prices 294 / 70; a sheet row with cladding 'No' is untouched", () => {
    const pipe = price(withKeys(D9B), "Rmt", { item: NR, cladding: "26G Aluminium with Glass Cloth", thickness_mm: "19 mm", pipe_size_mm: "50NB" });
    expect(pipe.priced).toBe(true);
    const noKey = price(plain, "Sqm", { item: CO, cladding: "Glass Cloth with paint" });
    expect([noKey.priced, noKey.supply, noKey.install]).toEqual([true, 294, 70]);
    const no = price(withKeys(D9B), "Sqm", { item: TN, cladding: "No", thickness_mm: "13 mm" }, "13 mm nitrile");
    expect([no.priced, no.supply]).toEqual([true, 464]);
  });

  it("D8: the density line appears for a 32 kg/m3 fibre glass row and not for 48; the PRICE is the same 48 kg board either way (display only)", () => {
    const r32 = price(withKeys(D8), "Sqm", { item: FG, cladding: "None", thickness_mm: "50 mm", material_as_written: "resin bonded fibre glass of density not less than 32Kg/CuM" });
    const r48 = price(withKeys(D8), "Sqm", { item: FG, cladding: "None", thickness_mm: "50 mm", material_as_written: "fibre glass of 48 Kg/Cum density" });
    expect(r32.items[0].working).toContain("BoQ says 32Kg/CuM -> priced as the 48 kg/m3 board");
    expect(r48.items[0].working.some((w) => w.includes("priced as the 48 kg/m3 board"))).toBe(false);
    expect([r32.supply, r32.install]).toEqual([r48.supply, r48.install]);
    expect(r32.priced).toBe(true);
  });

  it("D10: 'QRO - Sqm.' is a rate-only marker WITH a unit -- the row prices per sq.m with the rate-only note; the unit part resolves through the same unit_classes", () => {
    expect(splitRateOnlyUnit("QRO - Sqm.")).toBe("Sqm.");
    expect(splitRateOnlyUnit("R/O Rmt")).toBe("Rmt");
    expect(splitRateOnlyUnit("Sqm")).toBeNull();
    expect(splitRateOnlyUnit("QRO")).toBeNull();
    expect(isRateOnlyUnit("QRO")).toBe(true);
    const r = price(plain, "QRO - Sqm.", { item: TN, cladding: "None", thickness_mm: "19mm" });
    expect([r.priced, r.unitClass, r.supply, r.install]).toEqual([true, "area", 594, 154]);
    expect(r.unitNote).toBe("BoQ says QRO - Sqm. (rate only) -> priced per sq.m, the catalogue's unit for this item");
    expect(r.rateUnit).toBe("sq.m");
    // a rate-only prefix before a NON-unit still refuses by name, exactly as before
    expect(price(plain, "QRO - Lot", { item: TN, cladding: "None", thickness_mm: "19mm" }).reason).toBe("unit 'QRO - Lot' is not a count, area or length unit (R12)");
  });

  it("D11: on a row with NO unit, a named-material refusal shows FIRST; a stocked family on a no-unit row still takes the 12c-U path (priced per sq.m)", () => {
    const pir = price(plain, "", { item: "none of these", cladding: "None", thickness_mm: "20mm", material_as_written: "Eco+ PIR Panels" });
    expect(pir.reason).toBe("No SKU in the catalogue for Eco+ PIR Panels - price this row by hand");
    const lot = price(withKeys(D7), "Lot", { item: NR, cladding: "None", thickness_mm: "19 mm", material_as_written: "EPDM tubing" });
    expect(lot.reason).toBe("No SKU in the catalogue for EPDM tubing - price this row by hand");
    const stocked = price(plain, "", { item: TN, cladding: "None", thickness_mm: "19mm" });
    expect([stocked.priced, stocked.supply]).toEqual([true, 594]);
    expect(stocked.unitNote).toBe("No unit on the BoQ row -> priced per sq.m, the catalogue's unit for this item");
  });
});
