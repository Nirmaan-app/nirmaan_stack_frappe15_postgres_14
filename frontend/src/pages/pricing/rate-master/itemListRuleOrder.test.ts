/**
 * SLICE 12c, ACCEPTANCE 5 / U10 -- the Derivation tab's rule order, over the REAL assets.
 */
import { describe, it, expect } from "vitest";
import HVAC from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v16.json";
import EALL from "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v66.json";
import { readdirSync } from "node:fs";
import { itemListRuleOrder, plainSentence } from "./itemListRuleOrder";
import { readJsonFixture } from "../calculatorPanelParity.harness";
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

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 12d-4c (owner C5, finding F6): EVERY rule the config declares appears on the tab, NAMED, in run
// order, in plain English, derived from the config -- never a second list. The LATEST HVAC asset on disk
// is READ at runtime (the heap cliff: never `import` a 16,000-line asset), so this is the rule set the live
// site serves once that asset is loaded.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════
const DATA_DIR = new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/", import.meta.url);
const latestHvac = () => {
  const files = readdirSync(DATA_DIR).filter((f) => /^rate_master_hvac_all_v\d+\.json$/.test(f));
  files.sort((x, y) => Number(x.match(/_v(\d+)/)![1]) - Number(y.match(/_v(\d+)/)![1]));
  return readJsonFixture<{ category_configs: any[]; items: any[] }>(new URL(files[files.length - 1], DATA_DIR));
};
const LIVE = latestHvac();
const insulation = () => cfgOf(LIVE, "hvac_insulation");
const textOf = (cfg: unknown, items: any[] = LIVE.items) => itemListRuleOrder(cfg, items).map((r) => `${r.title} -- ${r.detail ?? ""}`).join("\n");
const without = (cfg: any, key: string) => {
  const c = structuredClone(cfg);   // a structured clone, not a JSON round-trip: the F2 residence ratchet counts inline parses under pages/
  delete c.list_spec.pricing[key];
  return c;
};

describe("12d-4c: the Derivation tab lists EVERY Insulation rule the config declares, in run order, plain English", () => {
  // each entry: the config key that carries the rule -> a marker the tab MUST show for it (and must NOT show once the key is gone)
  const DECLARED: Array<[string, RegExp]> = [
    ["family_when_none", /names no material takes the kind its row implies -- per metre: Nitrile Rubber Insulation; per sq\.m: Thermal Nitrile Insulation; 'acoustic', 'accoustic', 'lining'/],
    ["no_sku_families", /'none of these' is a refusal for a person, naming the material as the row wrote it/],
    ["unstocked_materials", /does not stock refuses by name, whatever kind was picked -- 'epdm', 'xlpe', 'rockwool'/],
    ["compose", /writes as layers is priced as those layers -- 'a \+ b', 'a x 2', '2 layers of a', 'a mm - 2 layers', 'double layer of a' -- each layer at the row's own size, the cladding on the outer layer only; a value the pricer types is never read as layers/],
    ["defaults", /cladding not mentioned -> No/],
    ["number_defaults", /thickness not mentioned at all -> 9 mm, then the ladder; a thickness the row itself states always wins, over a heading's too/],
    ["value_map", /Aluminium Foil as the cladding on Nitrile Rubber Insulation, Tubular Puf Insulation is priced as 26G Aluminium/],
    ["refuse_on_unit_class", /Glass Cloth as the cladding on a per-sq\.m row of Thermal Nitrile Insulation, Acoustic Nitrile Insulation, Fiberglass Rigid Board Insulation, Density 48Kg\/m3 refuses -- glass cloth is not offered on sheet insulation - price this row by hand; the same when the model read no cladding but the row's own words say 'glass cloth'/],
    ["named_in_row", /A cladding named in the row's own text but read as not mentioned refuses -- cladding named in this row but not read - set the cladding -- the words: 'aluminium', 'aluminum', 'foil'/],
    ["read_notes", /row stating its own figure in the insulation material as written carries a line saying what was priced -- 'BoQ says <the stated figure> -> priced as the 48 kg\/m3 board' \(not when the figure is 48\)/],
    ["ladders", /Fitting the stated pipe size to the catalogue -- the stated size, else the next size the catalogue stocks; the same size written to a different precision counts as that size; above the largest stocked size refuses, naming the size/],
    ["unit_factors", /sqft, sq ft, sq\.ft, sft convert to the catalogue's own unit/],
  ];

  it("every declared rule appears, NAMED, and in the order the pricing applies it", () => {
    const text = textOf(insulation());
    let last = -1;
    const order = ["names no material", "could not match to any kind", "does not stock refuses by name", "That kind's rule for that unit", "facts that rule needs",
                   "writes as layers", "Several thickness values", "written in inches", "does not mention takes its ruled value", "Aluminium Foil as the cladding on Nitrile",
                   "Aluminium Foil as the cladding on Acoustic Nitrile Insulation refuses", "Glass Cloth as the cladding", "named in the row's own text", "carries a line saying what was priced",
                   "Fitting the stated pipe size", "Fitting the stated thickness", "Then the priced steps", "read live from another catalogue row", "shown greyed, never typed", "derived from another row's cell",
                   "converts to the unit", "Multiplied by how many"];
    for (const needle of order) {
      const at = text.indexOf(needle);
      expect(at, needle).toBeGreaterThan(last);
      last = at;
    }
    for (const [, marker] of DECLARED) expect(text, String(marker)).toMatch(marker);
    // the concrete rulings beyond the keyed markers
    expect(text).toMatch(/Aluminium Foil as the cladding on Acoustic Nitrile Insulation refuses -- foil on an acoustic row - the catalogue has no foil-faced acoustic insulation; set the cladding$/m);
    expect(text).toMatch(/built from 4 or fewer layers within 2 -- the fewest layers, then the closest, then the cheapest, all at one pipe size/);
    // owner (on approving 5d): the Pricing Inputs by their LABELS, read off the Pricing Inputs rows -- never the item ids
    expect(text).toMatch(/the pricing inputs are read first \(Aluminium sheet 24G, Aluminium sheet 26G, Cladding overlap, GI framework fabrication, GI framework sheet, GI framework sheet factor, Glass cloth\)/);
    expect(text).toMatch(/A rate read live from another catalogue row -- Cladding Only/);
    expect(text).toMatch(/shown greyed, never typed -- cladding --/);
    expect(text).toMatch(/\d+ cells on \d+ rows \(the grey 'derived' cells\)/);
    expect(text).toMatch(/a row with no unit, or a rate-only unit \(R\/O, QRO\), is priced in the item's own unit/);
    expect(text).toMatch(/A pipe size written in inches is converted to millimetres/);
    expect(text).toMatch(/Several thickness values stated take the highest/);
  });

  it("VACUITY, structural: remove one declared rule from the config and its line is GONE (every key, one by one)", () => {
    for (const [key, marker] of DECLARED) {
      expect(textOf(insulation()), key).toMatch(marker);
      expect(textOf(without(insulation(), key)), `without ${key}`).not.toMatch(marker);
    }
  });

  it("NEGATIVE: no internal code and no config key name reaches the screen", () => {
    const text = textOf(insulation());
    expect(text).not.toMatch(/\b[RDTS]-?\d{1,2}[a-z]?\b/);           // R4, D3, T1, S6 ...
    expect(text).not.toMatch(/\(owner/i);
    for (const key of ["value_map", "named_in_row", "unstocked_materials", "refuse_on_unit_class", "read_notes", "family_when_none", "number_defaults",
                       "no_sku_families", "no_sku_named_by", "derived_rates", "absent_as_none", "thickness_mm", "pipe_size_mm", "material_as_written", "list_spec", "rate_ref", "component",
                       "gi_framework_factor", "gi_sheet_rate", "alu_sheet_26g", "glass_cloth", "item_install"]) {
      expect(text, key).not.toContain(key);
    }
    // owner: "no internal names anywhere on the tab" -- no snake_case token at all, on Insulation AND on ADP, with the
    // items supplied (labels) AND without them (ids written as plain words), so neither path can leak an id
    for (const cid of ["hvac_insulation", "hvac_adp"]) {
      expect(textOf(cfgOf(LIVE, cid)), cid).not.toMatch(/\b\w+_\w+\b/);
      expect(textOf(cfgOf(LIVE, cid), []), `${cid} without items`).not.toMatch(/\b\w+_\w+\b/);
    }
    expect(textOf(insulation(), [])).toMatch(/the pricing inputs are read first \(alu sheet 24g, alu sheet 26g, cladding overlap, gi framework adder, gi framework factor, gi sheet rate, glass cloth\)/);
    expect(textOf(cfgOf(LIVE, "hvac_adp"))).toMatch(/Then the priced steps below, in their own order -- install, item install, item supply, supply/);
    expect(plainSentence("foil on an acoustic row - set the cladding (R4)")).toBe("foil on an acoustic row - set the cladding");
    expect(plainSentence("R4 foil on a pipe is priced as 26G cladding (owner 2026-10-07)")).toBe("R4 foil on a pipe is priced as 26G cladding");
    expect(plainSentence("glass cloth is not offered on sheet insulation - price this row by hand")).toBe("glass cloth is not offered on sheet insulation - price this row by hand");
  });

  it("NEGATIVE: every Electrical tab is still EMPTY, and a vendor-quote / alias config too", () => {
    for (const c of eall.category_configs) expect(itemListRuleOrder(c)).toEqual([]);
    for (const id of ["hvac_ahu", "hvac_cables", "hvac_pricing_inputs"]) expect(itemListRuleOrder(cfgOf(LIVE, id))).toEqual([]);
  });

  it("ADP (5d, approved on the owner's word): its lines are ITS config -- the damper / insulated / UL defaults with their values, the UL 555 override, the five ladders, the derived cells; none of Insulation's", () => {
    const text = textOf(cfgOf(LIVE, "hvac_adp"));
    expect(text).toMatch(/damper not mentioned -> without, insulated not mentioned -> with, UL listed not mentioned -> no/);
    expect(text).toMatch(/variant on fire damper becomes UL 555 when UL listed is yes/);
    expect(text).toMatch(/double-skin plenum is not offered per number/);
    expect(text).toMatch(/Fitting the stated torque to the catalogue -- the stated size, else the next size the catalogue stocks; above the largest stocked size refuses, naming the size/);
    expect(text).toMatch(/\d+ cells on \d+ rows \(the grey 'derived' cells\)/);
    for (const not of ["Nitrile", "Glass Cloth", "epdm", "writes as layers", "Several", "inches"]) expect(text, not).not.toContain(not);
  });
});
