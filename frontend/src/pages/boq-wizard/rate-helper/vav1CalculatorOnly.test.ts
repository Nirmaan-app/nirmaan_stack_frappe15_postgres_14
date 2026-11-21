/**
 * VAV-2b2 K2 (R1, owner 2026-11-19 02:55 "removed in VAV-2b"; PIN F2, ANSWER 28 term 5): THE SWITCH IS REMOVED -- this file was the client
 * half of VAV-1's calculator-only switch and is now the proof of its removal. The seven test names are VAV-1's (kept so no test disappears);
 * each says what it asserted BEFORE.
 *
 * VAV-1 (owner QR-A (a), 2026-11-19 02:57 "optiom a"; TEMPORARY, removed by VAV-2b) -- the VRF-2a shape (92834b7e5) re-pointed at
 * hvac_vav_box. FIXTURES, no asset file: v75's Valve Package config relabelled hvac_vav_box -- an eligible item-list config -- with and
 * without `calculator_only: true`.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, isEligibleConfig, makePricingSheetHelper, rowUsesPreRunHelper } from "./pricingSheetHelper";
import * as helper from "./pricingSheetHelper";

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
const compute = (cfg: RateCategoryConfig) => {
  const map = new Map(BY); map.set(VAV, cfg);
  const h = makePricingSheetHelper({ configsByCategory: map, items: ITEMS, extractionByRow: new Map() });
  return h.compute({ excelRow: 15, description: "", nodeType: "", category: VAV, discipline: "HVAC", rateKinds: KINDS, unit: "Nos" } as never,
    { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(STATE), [ROW_UNIT_OVERRIDE_KEY]: "Nos" }) as unknown as { kind: string; reason?: string; itemList?: { totals?: Record<string, number> } };
};

describe("VAV-1 (QR-A (a)) the temporary calculator-only switch, client half", () => {
  it("the key counts only as exactly true, on hvac_vav_box only", () => {
    // BEFORE: isCalculatorOnlyConfig read the key as exactly true on hvac_vav_box only. AFTER: the reader is gone; no value of the key, on any
    // category, changes eligibility.
    expect("isCalculatorOnlyConfig" in helper).toBe(false);
    for (const k of [true, false, "true", 1, null, NO_KEY]) expect(isEligibleConfig(vav(k)), String(k)).toBe(true);
  });
  it("eligible on the calculator surface only; the rules still run", () => {
    // BEFORE: eligible only with `{ calculator: true }` while the key was set. AFTER: eligible on every surface, the key or not.
    expect(isEligibleConfig(vav(NO_KEY))).toBe(true);
    expect(isEligibleConfig(vav(true))).toBe(true);
  });
  it("the BoQ page's construction declines it with the coming-soon text; the calculator prices it = the switch-free config", () => {
    // BEFORE: the BoQ page answered 'none' + the coming-soon text with the key set. AFTER: it prices it, the same figures as the key-free config.
    const withKey = compute(vav(true)), free = compute(vav(NO_KEY));
    expect(withKey.kind).not.toBe("none");
    expect(withKey.itemList?.totals).toEqual(free.itemList?.totals);
    expect(withKey.itemList?.totals?.supply_rate).toBeGreaterThan(0);
  });
  it("VACUITY: without the key the BoQ page prices it -- the switch alone holds it back", () => {
    expect(compute(vav(NO_KEY)).kind).not.toBe("none");
  });
  it("the pre-run rules see nothing to run for it (a VAV row keeps the pre-run helper card)", () => {
    // BEFORE: with the key the row kept the pre-run helper card. AFTER: the rules run for it with or without the key.
    const map = new Map(BY); map.set(VAV, vav(true));
    const targets = [...BY.keys(), VAV].map((c) => ({ discipline: "HVAC", categoryId: c }));
    expect(rowUsesPreRunHelper("HVAC", VAV, map, targets)).toBe(false);
    map.set(VAV, vav(NO_KEY));
    expect(rowUsesPreRunHelper("HVAC", VAV, map, targets)).toBe(false);
  });
  it("NEGATIVE: every built category is eligible on both surfaces, with or without a stray key", () => {
    for (const id of ["hvac_adp", "hvac_ducting", "hvac_insulation", "hvac_piping", "hvac_valve_package", "hvac_vrf"]) {
      const c = BY.get(id)!, k = { ...structuredClone(c), calculator_only: true } as RateCategoryConfig;
      for (const x of [c, k]) expect(isEligibleConfig(x), id).toBe(true);
    }
  });
  it("only PricingCalculator passes the flag; the BoQ pricing page never names it", () => {
    // BEFORE: PricingCalculator.tsx passed `calculatorSurface: true`. AFTER: no file passes or reads a surface flag.
    const src = (f: string) => readFileSync(path.resolve(__dirname, f), "utf-8");
    expect(src("../../pricing/PricingCalculator.tsx")).not.toMatch(/calculatorSurface: true/);
    expect(src("./pricingSheetHelper.ts")).not.toMatch(/calculatorSurface\??:/);
    expect(src("../SheetPricingPage.tsx")).not.toMatch(/calculatorSurface/);
  });
});
