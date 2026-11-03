/**
 * VRF-2b (owner 2026-11-03: R-CONV / R-INPUTS, Q3 the unit picker, U2 A units on the options, CFM "Refuse, named",
 * RECON "both units given -> the sheet's unit", Q2 `extra_kinds`, QR-2 A Nos/Ro, QR-3 A kg / kgs, R-BRAND (a)).
 *
 * FIXTURE ONLY: v56's VRF config with the 2b keys added IN THIS FILE (`withVrf2b`) and `calculator_only` projected out
 * (VRF-4's state). The asset that ships them (v57) is proved by test_vrf_v57 and the parity / R-39 blocks; this file
 * proves the CODE -- each new key on its own, positive AND negative, and that a config without the keys is untouched.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";
import {
  familyKindOf, familyUnitOf, itemListPricingSpec, kindIn, matchStatedToOptionDetailed, priceItemList, pricingInputFactor,
  projectUnitClass, readCapacity, specKinds, unitPickerUnits, fieldOptionsFromSkus, UNIT_PICK_SUFFIX,
  type ExtractedListItem, type ItemListPricingSpec,
} from "./itemListPricing";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, makePricingSheetHelper, type ItemListEditState, type ItemListSuggestion } from "./pricingSheetHelper";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const v56 = readJsonFixture<Asset>(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v56.json", import.meta.url));
// brand is an ITEM column, projected into the attributes at read time (the API does the same)
const ITEMS: RateMasterItem[] = v56.items.map((it) => ({
  ...it, discipline: v56.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes },
} as RateMasterItem));
const VRF = "hvac_vrf";
const base56 = (): Record<string, any> => {
  const c = structuredClone(v56.category_configs.find((x) => x.category_id === VRF)) as Record<string, any>;
  delete c.calculator_only;           // VRF-4's state: the switch projected out (the calculator flag is proved in VRF-2a)
  return c;
};

const MISC = ["Drain Pump", "BACnet Integration Controller for VRF Units", "Refrigerant Gas Filling (R-410)", "MS Angle Base Frame Structure"];
const pipe = (kind: string, rateKey: string, markup: string | null, out: "supply" | "install") => ({
  output: [out],
  steps: [
    { step: "match_master_row", params: { kind }, explain: "match the SKU" },
    { step: "component", name: out === "supply" ? "unit" : "install", target: rateKey, formula: "base", explain: "the SKU's cost" },
    { step: "sum_components", result: markup ? `bcs_${out}` : out, explain: "BCS" },
    ...(markup ? [{ step: "scale", target: `bcs_${out}`, result: out, params: { m_from_ctx: markup }, formula: "base*(1+m)", explain: "x (1 + markup)" }] : []),
    { step: "roundup", target: out, params: { digits: 0 }, explain: "ROUNDUP" },
  ],
});
/** The VRF-2b keys, added to a copy of v56's VRF config (the mint adds the same; test_vrf_v57 pins the asset). */
function withVrf2b(cfg: Record<string, any>, drop: string[] = []): RateCategoryConfig {
  const c = structuredClone(cfg);
  const pr = c.list_spec.pricing;
  if (!drop.includes("units")) {
    pr.numbers.capacity.units = {
      unit_attr: "capacity_unit",
      words: { HP: ["hp", "h.p."], TR: ["tr", "t.r.", "ton", "tons"], kW: ["kw", "k.w."] },
      base: "TR",
      convert: { HP: { input: "vrf_hp_per_tr", label: "HP per TR" }, kW: { input: "vrf_kw_per_tr", label: "kW per TR" } },
      refuse_words: ["cfm", "cmh", "m3/h", "m3/hr"],
      refuse: "capacity is stated only as an airflow ({said}) - an airflow is not converted to HP / TR - price this row by hand",
    };
  }
  if (!drop.includes("misc")) {
    pr.extra_kinds = ["hvac_misc_item"];
    pr.unit_classes.weight = ["Kg", "kg", "kgs"];
    pr.unit_words.weight = "Kg";
    const k = "hvac_misc_item";
    pr.families["Drain Pump"] = { needs: [], units: { count: { pipelines: { supply: pipe(k, "cost_supply", "supply_markup", "supply"), install: pipe(k, "cost_install", "install_markup", "install") } } } };
    pr.families["BACnet Integration Controller for VRF Units"] = { needs: [], units: { count: { pipelines: { supply: pipe(k, "cost_supply", "supply_markup", "supply"), install: pipe(k, "cost_install", "install_markup", "install") } } } };
    pr.families["Refrigerant Gas Filling (R-410)"] = { needs: [], units: { weight: { pipelines: { supply: pipe(k, "cost_supply", "supply_markup", "supply"), install: pipe(k, "boq_install", null, "install") } } } };
    pr.families["MS Angle Base Frame Structure"] = { needs: [], units: { weight: { pipelines: { supply: pipe(k, "cost_supply", "supply_markup", "supply"), install: pipe(k, "cost_install", "install_markup", "install") } } } };
    const item = c.list_spec.attribute_definitions.find((d: any) => d.id === "item");
    item.values = [...item.values.filter((v: string) => v !== "none of these"), ...MISC, "none of these"];
  }
  if (!drop.includes("brand")) {
    pr.defaults.brand.unlisted = {
      several: "several brands stated ({said}) - priced as Blue Star",
      off_sheet: "brand {said} is not on the sheet - priced as Blue Star",
    };
  }
  if (!drop.includes("nosro")) pr.unit_lines = { "Nos/Ro": "unit 'Nos/Ro' read as Nos" };
  return c as RateCategoryConfig;
}
const CFG = withVrf2b(base56());
const SPEC = itemListPricingSpec(CFG)!;
const item = (attrs: Record<string, string>, typed = false): ExtractedListItem => ({
  attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, typed ? { value: v, typed: true } : { value: v }])),
});
const price = (attrs: Record<string, string>, unit = "Nos", spec: ItemListPricingSpec = SPEC, items: RateMasterItem[] = ITEMS, typed = false) =>
  priceItemList(spec, items, unit, [item(attrs, typed)]);
const figs = (r: ReturnType<typeof price>) => (r.priced ? [r.supply, r.install] : r.reason ?? r.items[0]?.reason);
const sku = (r: ReturnType<typeof price>) => ITEMS.find((it) => it.item_uid === r.items[0]?.sku?.item_uid)?.attributes?.model;
const working = (r: ReturnType<typeof price>) => r.items[0]?.working ?? [];

describe("VRF-2b -- the capacity reader (HP / TR / kW through the two VRF Pricing Inputs)", () => {
  it("the fixture: the two inputs are 1.25 HP per TR and 3.517 kW per TR; Outdoor is stocked in HP, indoor in TR", () => {
    expect(pricingInputFactor(ITEMS, "vrf_hp_per_tr")).toBe(1.25);
    expect(pricingInputFactor(ITEMS, "vrf_kw_per_tr")).toBe(3.517);
    expect(pricingInputFactor(ITEMS, "no_such_input")).toBeNull();
    expect(familyUnitOf(SPEC, ITEMS, "Outdoor Unit", SPEC.numbers.capacity)).toBe("HP");
    expect(familyUnitOf(SPEC, ITEMS, "Cassette", SPEC.numbers.capacity)).toBe("TR");
    expect(familyUnitOf(SPEC, ITEMS, "Refnet/Y-Joint", SPEC.numbers.capacity)).toBeNull();
    expect(unitPickerUnits(SPEC.numbers.capacity)).toEqual(["HP", "TR", "kW"]);
  });

  it("C1: 16 TR on an Outdoor Unit = 16 x 1.25 = 20 HP -> IVRFB-20TC 476,040 / 20,000, with the line", () => {
    const r = price({ item: "Outdoor Unit", capacity: "16 TR" });
    expect(figs(r)).toEqual([476040, 20000]);
    expect(sku(r)).toBe("IVRFB-20TC / TCN");   // the sheet's own model text
    expect(working(r)).toContain("capacity: 16 TR x 1.25 (HP per TR, Pricing Inputs) = 20 HP");
  });

  it("C2: 4 HP on a Cassette = 4 / 1.25 = 3.2 TR -> VLC-38 43,680 / 3,500 (FOUR-WAY default)", () => {
    const r = price({ item: "Cassette", capacity: "4 HP" });
    expect(figs(r)).toEqual([43680, 3500]);
    expect(sku(r)).toBe("VLC-38");
    expect(working(r)).toContain("capacity: 4 HP / 1.25 (HP per TR, Pricing Inputs) = 3.2 TR");
  });

  it("C3: 5 kW on a Hi-Wall = 5 / 3.517 = 1.42 TR -> next size up 1.5 TR, VHW-18A 20,760 / 1,800", () => {
    const r = price({ item: "Hi-Wall", brand: "Blue Star", capacity: "5 kW" });
    expect(figs(r)).toEqual([20760, 1800]);
    expect(sku(r)).toBe("VHW-18A");
    expect(working(r)).toContain("capacity: 5 kW / 3.517 (kW per TR, Pricing Inputs) = 1.42 TR");
  });

  it("kW on an HP family goes through both inputs: 45 kW / 3.517 x 1.25 = 15.99 HP -> 16 HP, 436,920 / 16,000", () => {
    const r = price({ item: "Outdoor Unit", capacity: "45 kW" });
    expect(figs(r)).toEqual([436920, 16000]);
    expect(working(r)).toContain("capacity: 45 kW / 3.517 (kW per TR, Pricing Inputs) x 1.25 (HP per TR, Pricing Inputs) = 15.99 HP");
  });

  it("the family's own unit, stated or bare, reads as before (16 HP and 16 -> 16 HP, no conversion line)", () => {
    for (const cap of ["16 HP", "16", "16HP", "16 h.p."]) {
      const r = price({ item: "Outdoor Unit", capacity: cap });
      expect(figs(r)).toEqual([436920, 16000]);
      expect(working(r).some((w) => w.includes("Pricing Inputs"))).toBe(false);
    }
  });

  it("BOTH units in the row: the family's unit is used and the other named ('22.5 TR / 18 HP' on Outdoor -> 18 HP)", () => {
    const r = price({ item: "Outdoor Unit", capacity: "22.5 TR / 18 HP" });
    expect(r.priced).toBe(true);
    expect(r.items[0].selection.capacity).toBe(18);
    expect(working(r)).toContain("capacity: the row states 18 HP and 22.5 TR - 18 HP is used (Outdoor Unit is stocked in HP); 22.5 TR is not read");
  });

  it("NEGATIVE: two units and neither is the family's refuses, naming both -- no guess", () => {
    const r = price({ item: "Outdoor Unit", capacity: "22.5 TR / 79 kW" });
    expect(r.priced).toBe(false);
    expect(r.items[0].reason).toContain("the row states 22.5 TR and 79 kW - none in HP - price this row by hand");
  });

  it("CFM ONLY refuses, naming the airflow (owner 21:14 'Refuse, named'); CMH and m3/h too", () => {
    expect(price({ item: "Concealed Split", capacity: "670 CFM" }).items[0].reason)
      .toContain("capacity is stated only as an airflow (670 CFM) - an airflow is not converted to HP / TR - price this row by hand");
    expect(price({ item: "Concealed Split", capacity: "670Cfm" }).items[0].reason).toContain("(670 CFM)");
    expect(price({ item: "Ductable", capacity: "1200 CMH" }).items[0].reason).toContain("(1200 CMH)");
    expect(price({ item: "Ductable", capacity: "1200 m3/hr" }).items[0].reason).toContain("(1200 M3/HR)");
  });

  it("NEGATIVE (BEFORE): without the `units` key the airflow number IS read as the capacity (v56: '670Cfm' -> 670, above the ladder)", () => {
    const plainSpec = itemListPricingSpec(withVrf2b(base56(), ["units"]))!;
    const r = price({ item: "Concealed Split", capacity: "670Cfm" }, "Nos", plainSpec);
    expect(r.items[0].reason).toContain("capacity 670 is above the largest size");
    // ... and 16 TR on an Outdoor Unit is priced as 16 HP -- the silent trap the key closes
    expect(figs(price({ item: "Outdoor Unit", capacity: "16 TR" }, "Nos", plainSpec))).toEqual([436920, 16000]);
  });

  it("a capacity beside an airflow is read, the airflow set aside with a line ('1.0 TR / 459 CFM' on a Cassette -> 1 TR)", () => {
    const r = price({ item: "Cassette", capacity: "1.0 TR / 459 CFM" });
    expect(r.priced).toBe(true);
    expect(r.items[0].selection.capacity).toBe(1);
    expect(working(r)).toContain("capacity: 459 CFM is an airflow - not read");
  });

  it("several values, brackets and a temperature read EXACTLY as today", () => {
    // the refusal quotes the row's own words, case kept (a K3 parity case found the K1 reader lower-casing them)
    expect(price({ item: "Outdoor Unit", capacity: "20+18 HP" }).items[0].reason).toContain("several values stated for capacity ('20+18 HP')");
    expect(price({ item: "Outdoor Unit", capacity: "13 TR at 43°C ambient" }).items[0].reason).toContain("several values stated for capacity");
    expect(price({ item: "Outdoor Unit", capacity: "2# 12 HP" }).items[0].reason).toContain("several values stated for capacity");
    // brackets dropped: "2.0 HP (1.6 TR)" is 2 HP (below the smallest -> the smallest, as today)
    expect(price({ item: "Outdoor Unit", capacity: "2.0 HP (1.6 TR)" }).items[0].selection.capacity).toBe(7);
    expect(price({ item: "Cassette", capacity: "1.28 TR(1.6 HP)" }).items[0].selection.capacity).toBe(1.3);
  });

  it("A FACTOR EDIT MOVES EVERY CONVERTED CASE AND NO OTHER (fixture: HP per TR 1.25 -> 1.3)", () => {
    const edited = ITEMS.map((it) => (it.attributes?.item === "vrf_hp_per_tr" ? { ...it, rates: { ...it.rates, factor: 1.3 } } : it));
    const r = price({ item: "Outdoor Unit", capacity: "16 TR" }, "Nos", SPEC, edited);
    expect(working(r)).toContain("capacity: 16 TR x 1.3 (HP per TR, Pricing Inputs) = 20.8 HP");
    expect(r.items[0].selection.capacity).toBe(22);
    // an unconverted case does not move
    expect(figs(price({ item: "Outdoor Unit", capacity: "16 HP" }, "Nos", SPEC, edited))).toEqual(figs(price({ item: "Outdoor Unit", capacity: "16 HP" })));
    // kW per TR is not read on a TR -> HP conversion
    const kwEdited = ITEMS.map((it) => (it.attributes?.item === "vrf_kw_per_tr" ? { ...it, rates: { ...it.rates, factor: 9 } } : it));
    expect(figs(price({ item: "Outdoor Unit", capacity: "16 TR" }, "Nos", SPEC, kwEdited))).toEqual([476040, 20000]);
  });

  it("NEGATIVE: an input missing from the catalogue refuses by name (never a silent 1)", () => {
    const without = ITEMS.filter((it) => it.attributes?.item !== "vrf_hp_per_tr");
    expect(price({ item: "Outdoor Unit", capacity: "16 TR" }, "Nos", SPEC, without).items[0].reason)
      .toContain("capacity in TR cannot be converted to HP: the Pricing Input for HP per TR is missing - price this row by hand");
  });
});

describe("VRF-2b -- the unit picker (Q3) on a TYPED box", () => {
  it("a bare typed number is in the picker's unit; untouched, in the family's", () => {
    const r = price({ item: "Outdoor Unit", capacity: "16", [`capacity${UNIT_PICK_SUFFIX}`]: "TR" }, "Nos", SPEC, ITEMS, true);
    expect(figs(r)).toEqual([476040, 20000]);
    expect(working(r)).toContain("capacity: 16 TR x 1.25 (HP per TR, Pricing Inputs) = 20 HP");
    expect(figs(price({ item: "Outdoor Unit", capacity: "16" }, "Nos", SPEC, ITEMS, true))).toEqual([436920, 16000]);
  });

  it("a unit word typed in the box beats the picker, with a line", () => {
    const r = price({ item: "Outdoor Unit", capacity: "16 TR", [`capacity${UNIT_PICK_SUFFIX}`]: "HP" }, "Nos", SPEC, ITEMS, true);
    expect(figs(r)).toEqual([476040, 20000]);
    expect(working(r)).toContain("capacity: you typed TR - TR is used, not the picker's HP; 16 TR x 1.25 (HP per TR, Pricing Inputs) = 20 HP");
  });

  it("NEGATIVE: the picker is never read on a MODEL answer (a BoQ row has no picker)", () => {
    const r = price({ item: "Outdoor Unit", capacity: "16", [`capacity${UNIT_PICK_SUFFIX}`]: "TR" });
    expect(figs(r)).toEqual([436920, 16000]);
  });
});

describe("VRF-2b -- the rewriter shows the size that is priced (matchStatedToOption reads the same reader)", () => {
  const opts = fieldOptionsFromSkus(SPEC, ITEMS, "Outdoor Unit", "count", "capacity", {});
  const rd = SPEC.numbers.capacity;
  const cap = (t: string) => readCapacity(t, rd, { familyUnit: "HP", factorOf: (id) => pricingInputFactor(ITEMS, id), family: "Outdoor Unit" });
  it("'12 TR' on the outdoor options is 15 HP -> no option (the ladder shows 16), never the option '12'; '16 HP' -> '16'", () => {
    expect(opts).toContain("12");
    expect(matchStatedToOptionDetailed("12 TR", opts, rd, cap)).toBeNull();
    expect(matchStatedToOptionDetailed("16 TR", opts, rd, cap)).toEqual({ to: "20", by: "number" });
    expect(matchStatedToOptionDetailed("16 HP", opts, rd, cap)).toEqual({ to: "16", by: "number" });
  });
  it("NEGATIVE (BEFORE): without the reader the trap is back -- '12 TR' matches the option '12'", () => {
    expect(matchStatedToOptionDetailed("12 TR", opts, rd)).toEqual({ to: "12", by: "number" });
  });
});

describe("VRF-2b -- the Misc four via `extra_kinds` (Q2) and the weight class (QR-3 A)", () => {
  it("the kinds: the block prices hvac_vrf_item and hvac_misc_item; a Misc family's kind is its own", () => {
    expect([...specKinds(SPEC)]).toEqual(["hvac_vrf_item", "hvac_misc_item"]);
    expect(kindIn(SPEC, "hvac_misc_item")).toBe(true);
    expect(kindIn(SPEC, "hvac_piping_item")).toBe(false);
    expect(familyKindOf(SPEC, ITEMS, "Drain Pump")).toBe("hvac_misc_item");
    expect(familyKindOf(SPEC, ITEMS, "Outdoor Unit")).toBe("hvac_vrf_item");
  });

  it("each Misc item at the sheet's figures: Drain Pump 3,500 / 750 and BACnet 50,000 / 4,500 per Nos; R-410 1,020 / 350 and MS Angle 140 / 40 per Kg", () => {
    expect(figs(price({ item: "Drain Pump" }, "Nos"))).toEqual([3500, 750]);
    expect(figs(price({ item: "BACnet Integration Controller for VRF Units" }, "Nos"))).toEqual([50000, 4500]);
    expect(figs(price({ item: "Refrigerant Gas Filling (R-410)" }, "Kg"))).toEqual([1020, 350]);
    expect(figs(price({ item: "MS Angle Base Frame Structure" }, "kgs"))).toEqual([140, 40]);
    expect(figs(price({ item: "MS Angle Base Frame Structure" }, "KG"))).toEqual([140, 40]);
  });

  it("NEGATIVE: a wrong unit refuses -- a Kg item on a Nos row, a Nos item on a Kg row", () => {
    const a = price({ item: "MS Angle Base Frame Structure" }, "Nos");
    expect(a.priced).toBe(false);
    expect(a.reason ?? a.items[0]?.reason).toBe("MS Angle Base Frame Structure is not stocked per Nos (stocked per Kg) - price this row by hand");
    const b = price({ item: "Drain Pump" }, "Kg");
    expect(b.reason ?? b.items[0]?.reason).toBe("Drain Pump is not stocked per Kg (stocked per Nos) - price this row by hand");
  });

  it("the kind SET reaches the projection: with `extra_kinds` the Misc rows carry their unit class; NEGATIVE: without it they are left unprojected", () => {
    const c = withVrf2b(base56()) as unknown as Record<string, any>;
    delete c.list_spec.pricing.extra_kinds;
    const without = itemListPricingSpec(c as RateCategoryConfig)!;
    const cls = (spec: ItemListPricingSpec) => projectUnitClass(spec, ITEMS).filter((it) => it.kind === "hvac_misc_item")
      .map((it) => `${it.attributes.item}=${String(it.attributes.unit_class ?? "-")}`).sort();
    expect(cls(SPEC)).toEqual(["BACnet Integration Controller for VRF Units=count", "Drain Pump=count", "MS Angle Base Frame Structure=weight", "Refrigerant Gas Filling (R-410)=weight"]);
    expect(cls(without)).toEqual(["BACnet Integration Controller for VRF Units=-", "Drain Pump=-", "MS Angle Base Frame Structure=-", "Refrigerant Gas Filling (R-410)=-"]);
    // the wrong-unit refusal comes from the family's declared units, with or without the set (the pipeline names its
    // kind): the VALIDATOR is what refuses a Misc pipeline without `extra_kinds` (test_rate_master v2b_*)
    expect(price({ item: "MS Angle Base Frame Structure" }, "Nos", without).reason).toBe(price({ item: "MS Angle Base Frame Structure" }, "Nos").reason);
  });

  it("the VRF units still price as v56 with the Misc in the block (every family's own kind)", () => {
    expect(figs(price({ item: "Outdoor Unit", capacity: "16" }))).toEqual([436920, 16000]);
    expect(figs(price({ item: "Cassette", capacity: "1.5" }))).toEqual([37320, 3500]);
  });
});

describe("VRF-2b -- the brand note (R-BRAND (a))", () => {
  it("one brand off the sheet: priced as Blue Star, amber, naming the row's words", () => {
    const r = price({ item: "Outdoor Unit", brand: "Toshiba", capacity: "16" });
    expect(figs(r)).toEqual([436920, 16000]);
    expect(r.items[0].defaulted).toContainEqual(expect.objectContaining({ attr: "brand", value: "Blue Star", rule: "brand Toshiba is not on the sheet - priced as Blue Star", asWritten: "Toshiba" }));
  });
  it("several brands: priced as Blue Star with the several line", () => {
    const r = price({ item: "Outdoor Unit", brand: "Daikin / Blue Star / Toshiba", capacity: "16" });
    expect(figs(r)).toEqual([436920, 16000]);
    expect(r.items[0].defaulted).toContainEqual(expect.objectContaining({ attr: "brand", rule: "several brands stated (Daikin / Blue Star / Toshiba) - priced as Blue Star" }));
  });
  it("one brand on the sheet is read as stated; no brand keeps its ruled default", () => {
    const d = price({ item: "Outdoor Unit", brand: "Daikin", capacity: "8", cooling: "Heat Pump" });
    expect(d.items[0].selection.brand).toBe("Daikin");
    expect(d.items[0].defaulted.find((x) => x.attr === "brand")).toBeUndefined();
    const n = price({ item: "Outdoor Unit", capacity: "16" });
    expect(n.items[0].defaulted).toContainEqual(expect.objectContaining({ attr: "brand", rule: "no brand stated - priced as Blue Star" }));
  });
  it("NEGATIVE (BEFORE): without `unlisted` the off-sheet brand refuses as unstocked", () => {
    const r = price({ item: "Outdoor Unit", brand: "Toshiba", capacity: "16" }, "Nos", itemListPricingSpec(withVrf2b(base56(), ["brand"]))!);
    expect(r.priced).toBe(false);
    expect(String(r.items[0].reason)).toContain("Toshiba");
  });
});

describe("VRF-2b -- 'Nos/Ro' read as Nos with its line (QR-2 A)", () => {
  it("POSITIVE: priced as Nos, with the line", () => {
    const r = price({ item: "Outdoor Unit", capacity: "16" }, "Nos/Ro");
    expect(figs(r)).toEqual([436920, 16000]);
    expect(r.unitNote).toBe("unit 'Nos/Ro' read as Nos");
  });
  it("NEGATIVE: without `unit_lines` it prices with no line; a plain Nos row never carries it", () => {
    const r = price({ item: "Outdoor Unit", capacity: "16" }, "Nos/Ro", itemListPricingSpec(withVrf2b(base56(), ["nosro"]))!);
    expect(r.priced).toBe(true);
    expect(r.unitNote).toBeUndefined();
    expect(price({ item: "Outdoor Unit", capacity: "16" }, "Nos").unitNote).toBeUndefined();
  });
});

describe("VRF-2b -- the Derivation lines (QR-3 A, U7)", () => {
  const lines = itemListRuleOrder(CFG, ITEMS as never).map((l) => `${l.title}. ${l.detail ?? ""}`);
  if (process.env.VRF2B_PRINT) console.log(["LINES", ...lines.map((l, i) => `${i + 1}. ${l}`), "END"].join(String.fromCharCode(10)));
  it("line 1 quotes a unit VRF refuses ('Set', not 'nos'), and says 'Nos/Ro' is read as Nos", () => {
    expect(lines[0]).toContain("'Nos/Ro' is read as Nos, with a line saying so");
    expect(lines[0]).toContain("unit 'Set' is not a VRF unit");
    expect(lines[0]).not.toContain("unit 'nos'");
  });
  it("line 4 words two classes right: per Nos or per Kg, one rule each", () => {
    expect(lines).toContain("That kind's rule for that unit. a kind is priced per Nos or per Kg - each kind has one rule, for the unit it is stocked in");
  });
  it("the conversion line and the brand line are generated", () => {
    // owner QR-1b (2026-11-04 01:26): the exact titles of the two new lines
    expect(lines.some((l) => l.startsWith("A capacity in TR, HP or kW that is not the item's own unit is converted first."))).toBe(true);
    expect(lines.some((l) => l.startsWith("Several brands, or one brand not on the sheet, are priced as Blue Star, naming the row's words."))).toBe(true);
  });
  it("NEGATIVE: every other category's lines are byte-identical (Insulation line 4, Piping line 1 example 'nos')", () => {
    const ins = v56.category_configs.find((c) => c.category_id === "hvac_insulation")!;
    const pip = v56.category_configs.find((c) => c.category_id === "hvac_piping")!;
    const insLines = itemListRuleOrder(ins, ITEMS as never).map((l) => l.detail ?? "");
    expect(insLines).toContain("a kind priced per metre and per square metre has a rule for each");
    const pipLines = itemListRuleOrder(pip, ITEMS as never);
    expect(pipLines[0].detail ?? "").toContain("unit 'nos'");
  });
});

describe("VRF-2b -- the screen: option units (U2 A), the picker (U1), other forms unchanged (U8)", () => {
  const configs = new Map<string, RateCategoryConfig>(v56.category_configs.map((c) => [c.category_id, c]));
  configs.set(VRF, CFG);
  const calc = makePricingSheetHelper({ configsByCategory: configs, items: ITEMS, extractionByRow: new Map(), calculatorSurface: true });
  const run = (cat: string, unit: string, block: Record<string, unknown>) =>
    calc.compute(calculatorCtx("HVAC", cat), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [block] }), [ROW_UNIT_OVERRIDE_KEY]: unit }) as unknown as ItemListSuggestion;
  const field = (r: ItemListSuggestion, id: string) => r.itemList!.items[0].fields.find((f) => f.id === id)!;

  it("each capacity option shows its unit ('16HP' outdoor, '1.5TR' indoor); the option VALUE stays the bare number", () => {
    const o = field(run(VRF, "Nos", { base: null, family: "Outdoor Unit", attrs: { capacity: "16" } }), "capacity");
    expect(o.options).toContain("16");
    expect(o.optionLabels?.["16"]).toBe("16HP");
    const c = field(run(VRF, "Nos", { base: null, family: "Cassette", attrs: { capacity: "1.5" } }), "capacity");
    expect(c.optionLabels?.["1.5"]).toBe("1.5TR");
  });

  it("the picker sits on the typed box: default = the family's unit; the pick is the stored answer beside a bare number", () => {
    const r = run(VRF, "Nos", { base: null, family: "Outdoor Unit", attrs: { capacity: "16", [`capacity${UNIT_PICK_SUFFIX}`]: "TR" }, other: ["capacity"] });
    const f = field(r, "capacity");
    expect(f.unitPicker).toEqual({ id: `capacity${UNIT_PICK_SUFFIX}`, units: ["HP", "TR", "kW"], value: "TR", defaultUnit: "HP" });
    expect(f.typedValue).toBe("16");
    expect(f.note).toBe("16 TR x 1.25 (HP per TR, Pricing Inputs) = 20 HP");
    expect(r.itemList!.totals!.supply_rate).toBe(476040);
    const fresh = field(run(VRF, "Nos", { base: null, family: "Cassette", attrs: {} }), "capacity");
    expect(fresh.unitPicker?.value).toBe("TR");
  });

  it("C3 on the screen: 5 kW on a Hi-Wall reads 1.42 TR and lands on 1.5 TR", () => {
    const r = run(VRF, "Nos", { base: null, family: "Hi-Wall", attrs: { brand: "Blue Star", capacity: "5", [`capacity${UNIT_PICK_SUFFIX}`]: "kW" }, other: ["capacity"] });
    expect(field(r, "capacity").note).toBe("5 kW / 3.517 (kW per TR, Pricing Inputs) = 1.42 TR -> priced as 1.5 TR (next size up)");
    expect([r.itemList!.totals!.supply_rate, r.itemList!.totals!.install_rate]).toEqual([20760, 1800]);
  });

  it("a size PICKED from the list after the typed box is never read in the picker's leftover unit (found in the cert: '1.5TR' after kW priced 1.5 kW)", () => {
    // the panel's select sends set_other(on: false) then set_attr for a real pick -- the picker's value goes with the box
    let st: ItemListEditState = { items: [{ base: null, family: "Hi-Wall", attrs: { brand: "Blue Star", capacity: "5", [`capacity${UNIT_PICK_SUFFIX}`]: "kW" }, other: ["capacity"] }] };
    st = applyItemEdit(st, { op: "set_other", index: 0, id: "capacity", on: false });
    st = applyItemEdit(st, { op: "set_attr", index: 0, id: "capacity", value: "1.5" });
    const attrs = st.items[0].attrs;
    expect(attrs[`capacity${UNIT_PICK_SUFFIX}`]).toBeUndefined();
    const r = run(VRF, "Nos", st.items[0] as unknown as Record<string, unknown>);
    expect([r.itemList!.totals!.supply_rate, r.itemList!.totals!.install_rate]).toEqual([20760, 1800]);
    // NEGATIVE (BEFORE): with the leftover kW the same pick read 1.5 kW -> 0.43 TR -> the 0.8 TR unit
    const stale = run(VRF, "Nos", { base: null, family: "Hi-Wall", attrs: { brand: "Blue Star", capacity: "1.5", [`capacity${UNIT_PICK_SUFFIX}`]: "kW" } });
    expect(stale.itemList!.totals!.supply_rate).toBe(18240);
    // opening the box again keeps nothing stale either: the picker shows the item's own unit
    st = applyItemEdit(st, { op: "set_other", index: 0, id: "capacity", on: true });
    expect(field(run(VRF, "Nos", st.items[0] as unknown as Record<string, unknown>), "capacity").unitPicker?.value).toBe("TR");
  });

  it("NEGATIVE (U8): no other category's form carries a picker or unit labels -- Piping's size field is as before", () => {
    const p = run("hvac_piping", "Mtr", { base: null, family: "Copper", attrs: { size_mm: "41.3" }, other: ["size_mm"] });
    for (const f of p.itemList!.items[0].fields) expect(f.unitPicker).toBeUndefined();
    const sz = p.itemList!.items[0].fields.find((f) => f.id === "size_mm");
    expect(sz?.optionLabels).toBeUndefined();
  });
});
