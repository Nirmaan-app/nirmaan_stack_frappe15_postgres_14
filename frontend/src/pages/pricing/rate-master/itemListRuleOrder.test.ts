/**
 * SLICE 12c, ACCEPTANCE 5 / U10 -- the Derivation tab's rule order, over the REAL assets.
 */
import { describe, it, expect } from "vitest";
import HVAC from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v16.json";
import EALL from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v66.json";
import { itemListRuleOrder } from "./itemListRuleOrder";

const hvac = HVAC as unknown as { category_configs: any[] };
const eall = EALL as unknown as { category_configs: any[] };
const cfgOf = (a: { category_configs: any[] }, id: string) =>
  a.category_configs.find((c) => c.category_id === id);

describe("acceptance 5: the Derivation tab describes an item-list category's rules", () => {
  it("Insulation gets the whole order, numbered from 1 with no gaps", () => {
    const got = itemListRuleOrder(cfgOf(hvac, "hvac_insulation"));
    expect(got.length).toBeGreaterThanOrEqual(8);
    expect(got.map((r) => r.n)).toEqual(got.map((_r, i) => i + 1));
    for (const r of got) expect(r.title.trim().length).toBeGreaterThan(0);
  });

  it("it names the category's OWN vocabulary, read from the config", () => {
    const got = itemListRuleOrder(cfgOf(hvac, "hvac_insulation"));
    const all = got.map((r) => `${r.title} ${r.detail ?? ""}`).join(" | ");
    // its unit classes, its ladders by their reader NAMES, its composition and its sq.ft conversion
    expect(all).toContain("length");
    expect(all).toContain("area");
    expect(all).toContain("thickness");
    expect(all).toContain("pipe size");
    expect(all).toContain("sqft");
    expect(all).toContain("the pricing inputs are read first");
    expect(all).toMatch(/built from 4 or fewer layers within 2/);
  });

  it("⚠️ NEGATIVE: NO INTERNAL KEY NAME reaches the screen", () => {
    const got = itemListRuleOrder(cfgOf(hvac, "hvac_insulation"));
    const all = got.map((r) => `${r.title} ${r.detail ?? ""}`).join(" | ");
    for (const key of ["unit_class_attr", "list_spec", "rate_ref", "match_master_row",
                       "sum_components", "roundup", "family_attribute_id", "label_attr",
                       "size_match", "match_attrs", "choice_attrs"]) {
      expect(all).not.toContain(key);
    }
  });

  it("⚠️ NEGATIVE: a category with NO list_spec renders NOTHING -- every Electrical tab unchanged", () => {
    for (const c of eall.category_configs) {
      expect(itemListRuleOrder(c)).toEqual([]);
    }
    // and the vendor-quote / alias configs, which have no pricing block either
    for (const id of ["hvac_ahu", "hvac_cables", "hvac_pricing_inputs"]) {
      expect(itemListRuleOrder(cfgOf(hvac, id))).toEqual([]);
    }
    expect(itemListRuleOrder(null)).toEqual([]);
    expect(itemListRuleOrder({})).toEqual([]);
    expect(itemListRuleOrder({ list_spec: {} })).toEqual([]);
  });

  it("ADP gets it too (U10), and its lines reflect ITS config, not Insulation's", () => {
    const adp = itemListRuleOrder(cfgOf(hvac, "hvac_adp"));
    const ins = itemListRuleOrder(cfgOf(hvac, "hvac_insulation"));
    expect(adp.length).toBeGreaterThan(0);
    const a = adp.map((r) => `${r.title} ${r.detail ?? ""}`).join(" | ");
    // ADP declares no composition, so no line claims one
    expect(a).not.toMatch(/built from \d+ or fewer layers/);
    // ...and Insulation's does
    expect(ins.map((r) => `${r.title} ${r.detail ?? ""}`).join(" | ")).toMatch(/or fewer layers/);
    // ADP's own ladders are named
    expect(a).toContain("torque");
    expect(a).toContain("neck size");
  });

  it("a mechanism the category does not use is OMITTED, not shown as 'none'", () => {
    const bare = {
      list_spec: { pricing: { unit_classes: { count: ["nos"] }, families: { F: { needs: [], units: {} } },
                              ladders: [], numbers: {} } },
    };
    const got = itemListRuleOrder(bare);
    const all = got.map((r) => `${r.title} ${r.detail ?? ""}`).join(" | ");
    expect(all).not.toContain("ruled value");         // no defaults declared
    expect(all).not.toContain("replaces a value");    // no override_when declared
    expect(all).not.toMatch(/Fitting the stated/);    // no ladders
    expect(all).not.toContain("converts to the unit"); // no unit_factors
    expect(got.map((r) => r.n)).toEqual(got.map((_r, i) => i + 1));   // still numbered 1..n
  });
});
