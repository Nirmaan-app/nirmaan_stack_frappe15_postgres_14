/**
 * VAV-1 (owner QR-A (a), 2026-11-19 02:57 "optiom a"; TEMPORARY, removed by VAV-2b) -- THE CLIENT HALF OF THE CALCULATOR-ONLY SWITCH, the
 * VRF-2a shape (92834b7e5) re-pointed at hvac_vav_box. FIXTURES, no v76 file (this commits BEFORE the asset, owner ANSWER 3): v75's Valve
 * Package config relabelled hvac_vav_box -- an eligible item-list config -- with and without `calculator_only: true`.
 *  - the key read as exactly true on hvac_vav_box ONLY (the mirror of the server validator's `_CALCULATOR_ONLY_CATEGORIES`);
 *  - the BoQ page's construction declines it with the coming-soon text; the calculator's construction (`calculatorSurface: true`) prices
 *    it byte-identically to the switch-free config; an explicit false / another category = no switch;
 *  - the pre-run rules see nothing to run for it; every built category stays eligible on both surfaces.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { COMING_SOON_REASON, ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, isCalculatorOnlyConfig, isEligibleConfig, makePricingSheetHelper, rowUsesPreRunHelper } from "./pricingSheetHelper";

type Asset = { items: Array<Record<string, unknown>>; category_configs: RateCategoryConfig[] };
const A75 = readJsonFixture<Asset>(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v75.json", import.meta.url));
const ITEMS = A75.items.map((i) => ({ ...i, discipline: "HVAC" })) as unknown as RateMasterItem[];
const BY = new Map(A75.category_configs.map((c) => [c.category_id, c]));
const VAV = "hvac_vav_box";
/** an eligible item-list config under the id hvac_vav_box (the Valve Package's v75 rules, relabelled), with or without the key */
const NO_KEY = Symbol("no key");
const vav = (key: unknown = true): RateCategoryConfig => {
  const c = { ...structuredClone(BY.get("hvac_valve_package")!), category_id: VAV } as RateCategoryConfig & { calculator_only?: unknown };
  if (key !== NO_KEY) c.calculator_only = key;
  return c;
};
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const STATE = { items: [{ base: null, family: "Butterfly Valve", attrs: { size_mm: "100" }, other: ["size_mm"] }] };
const compute = (cfg: RateCategoryConfig, calculatorSurface?: boolean) => {
  const map = new Map(BY); map.set(VAV, cfg);
  const h = makePricingSheetHelper({ configsByCategory: map, items: ITEMS, extractionByRow: new Map(), ...(calculatorSurface ? { calculatorSurface } : {}) });
  return h.compute({ excelRow: 15, description: "", nodeType: "", category: VAV, discipline: "HVAC", rateKinds: KINDS, unit: "Nos" } as never,
    { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(STATE), [ROW_UNIT_OVERRIDE_KEY]: "Nos" }) as unknown as { kind: string; reason?: string; itemList?: { totals?: Record<string, number> } };
};

describe("VAV-1 (QR-A (a)) the temporary calculator-only switch, client half", () => {
  it("the key counts only as exactly true, on hvac_vav_box only", () => {
    expect(isCalculatorOnlyConfig(vav(true))).toBe(true);
    for (const bad of [false, "true", 1, null, NO_KEY]) expect(isCalculatorOnlyConfig(vav(bad)), String(bad)).toBe(false);
    for (const id of ["hvac_valve_package", "hvac_ducting", "hvac_vrf", "hvac_insulation", "hvac_misc"])
      expect(isCalculatorOnlyConfig({ ...structuredClone(BY.get(id)!), calculator_only: true } as RateCategoryConfig), id).toBe(false);
  });
  it("eligible on the calculator surface only; the rules still run", () => {
    expect(isEligibleConfig(vav(NO_KEY))).toBe(true);
    expect(isEligibleConfig(vav(true))).toBe(false);
    expect(isEligibleConfig(vav(true), { calculator: true })).toBe(true);
    expect(isEligibleConfig(vav(true), { calculator: false })).toBe(false);
  });
  it("the BoQ page's construction declines it with the coming-soon text; the calculator prices it = the switch-free config", () => {
    const boq = compute(vav(true));
    expect([boq.kind, boq.reason]).toEqual(["none", COMING_SOON_REASON]);
    const calc = compute(vav(true), true), free = compute(vav(NO_KEY), true), freeBoq = compute(vav(NO_KEY));
    expect(calc.itemList?.totals).toEqual(free.itemList?.totals);
    expect(calc.itemList?.totals).toEqual(freeBoq.itemList?.totals);
    expect(calc.itemList?.totals?.supply_rate).toBeGreaterThan(0);
  });
  it("VACUITY: without the key the BoQ page prices it -- the switch alone holds it back", () => {
    expect(compute(vav(NO_KEY)).kind).not.toBe("none");
  });
  it("the pre-run rules see nothing to run for it (a VAV row keeps the pre-run helper card)", () => {
    const map = new Map(BY); map.set(VAV, vav(true));
    const targets = [...BY.keys(), VAV].map((c) => ({ discipline: "HVAC", categoryId: c }));
    expect(rowUsesPreRunHelper("HVAC", VAV, map, targets)).toBe(true);
    map.set(VAV, vav(NO_KEY));
    expect(rowUsesPreRunHelper("HVAC", VAV, map, targets)).toBe(false);
  });
  it("NEGATIVE: every built category is eligible on both surfaces, with or without a stray key", () => {
    for (const id of ["hvac_adp", "hvac_ducting", "hvac_insulation", "hvac_piping", "hvac_valve_package", "hvac_vrf"]) {
      const c = BY.get(id)!, k = { ...structuredClone(c), calculator_only: true } as RateCategoryConfig;
      for (const x of [c, k]) { expect(isEligibleConfig(x), id).toBe(true); expect(isEligibleConfig(x, { calculator: true }), id).toBe(true); }
    }
  });
  it("only PricingCalculator passes the flag; the BoQ pricing page never names it", () => {
    const src = (f: string) => readFileSync(path.resolve(__dirname, f), "utf-8");
    expect(src("../../pricing/PricingCalculator.tsx")).toMatch(/calculatorSurface: true,/);
    expect(src("../SheetPricingPage.tsx")).not.toMatch(/calculatorSurface/);
  });
});
