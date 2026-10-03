/**
 * SLICE 12c, ACCEPTANCE 5 / U10 -- the Derivation tab's rule order, over the REAL assets.
 */
import { describe, it, expect } from "vitest";
import HVAC from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v16.json";
import EALL from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v66.json";
import { itemListRuleOrder } from "./itemListRuleOrder";
import { pricingInputUsedBy, pricingInputUsedByText } from "./rateMasterSpec";
import { editableFieldsOf, isPercentField } from "./pricingInputImpact";

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

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// THE THIRD "used by" SITE -- found by LOOKING AT THE LIVE PAGE during the cert, not by a test.
//
// `pricingInputUsedBy` walked `cfg.pipelines` only, so the Rate Master page's "used by" column read
// EMPTY for all seven HVAC inputs while they priced 204 rows. Two sibling walks had the identical
// blindness and were fixed earlier in the slice (`csv_exporter.pricing_input_used_by` and
// `computePricingInputReach`); this one had no test pointing at it, which is why only the screen
// showed it. All three now go through ONE resolver.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("pricingInputUsedBy sees an item-list category's pipelines", () => {
  const SEVEN = ["alu_sheet_24g", "alu_sheet_26g", "glass_cloth", "cladding_overlap",
                 "gi_sheet_rate", "gi_framework_factor", "gi_framework_adder"];

  it("every HVAC input is reported as used, by the category that reads it", () => {
    const used = pricingInputUsedBy(hvac.category_configs as never);
    for (const id of SEVEN) {
      expect(used[id], `${id} is reported as used by nothing`).toBeTruthy();
      expect(used[id].sites).toBeGreaterThan(0);
      expect(used[id].categories).toEqual(["hvac_insulation"]);
      expect(pricingInputUsedByText(used[id])).not.toBe("not used");
    }
    expect(Object.keys(used).sort()).toEqual([...SEVEN].sort());
  });

  it("NEGATIVE: Electrical is unchanged -- its pipelines were never nested", () => {
    const used = pricingInputUsedBy(eall.category_configs as never);
    expect(Object.keys(used).length).toBe(35);
    for (const v of Object.values(used)) expect(v.sites).toBeGreaterThan(0);
  });

  it("NEGATIVE: an input no pipeline reads is still 'not used'", () => {
    const used = pricingInputUsedBy(hvac.category_configs as never);
    expect(used["no_such_input"]).toBeUndefined();
    expect(pricingInputUsedByText(used["no_such_input"])).toBe("not used");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// THE PANEL'S EDIT BOX -- the OWNER found this on the live page: "there is no edit box in the panel to
// change the value like it was there in electrical pricing input panel. why?"
//
// `editableFieldsOf` carried a hardcoded list of the pre-12c EIGHT columns, so an HVAC input -- whose
// only value IS a rate or a factor -- got an EMPTY field list. The panel rendered no input at all and
// sat at "—" under the hint "Change a value above to see what it would do", with nothing to change.
// The FOURTH list in this slice that did not learn the two new columns.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("the impact panel offers an edit box for a rate or a factor", () => {
  it("every HVAC input has at least one editable field", () => {
    const inputs = (HVAC as unknown as { items: any[] }).items
      .filter((i) => i.kind === "hvac_pricing_input");
    expect(inputs).toHaveLength(7);
    for (const i of inputs) {
      const f = editableFieldsOf(i.rates);
      expect(f.length, `${i.attributes.item} has no editable field -- the panel shows no input`).toBe(1);
      expect(["rate", "factor", "amount"]).toContain(f[0]);
      // and neither new column renders as a percentage -- 450 must not read as 45000%
      if (f[0] !== "amount") expect(isPercentField(f[0])).toBe(false);
    }
  });

  it("NEGATIVE: Electrical's panels are byte-identical -- the two are APPENDED, nothing reordered", () => {
    const inputs = (EALL as unknown as { items: any[] }).items
      .filter((i) => i.kind === "electrical_pricing_input");
    expect(inputs.length).toBe(35);
    const PRE_12C = ["discount", "supply_markup", "wastage", "installation_markup", "bcs_markup",
                     "ratio", "share", "amount"];
    for (const i of inputs) {
      const f = editableFieldsOf(i.rates);
      expect(f.length).toBeGreaterThan(0);
      // the order is the pre-12c one, and no Electrical input carries either new column
      expect(f).toEqual(PRE_12C.filter((k) => k in (i.rates ?? {})));
      expect(f).not.toContain("rate");
      expect(f).not.toContain("factor");
    }
  });
});
