/**
 * VAV-1 (HVAC v76) -- WHERE VAV BOX SHOWS AND WHERE IT DOES NOT, on the newest HVAC asset.
 *  T8 / B3 (owner QR-A (a), 2026-11-19 02:57 "optiom a"; TEMPORARY, removed by VAV-2b): the VAV config carries `calculator_only: true`.
 *     The CALCULATOR (the one construction passing `calculatorSurface: true`) prices it; a VAV-filed BoQ row keeps the coming-soon card,
 *     before and inside a run, exactly as before this slice; the key is honoured on hvac_vav_box ONLY.
 *  T7 Sensors is BORROW-ONLY: no Rate Master page, not in the calculator's category list, a Sensors-filed row stays "coming soon".
 *  REGISTRY: VAV Box appended after Ducting, Sensors after it (fetch_only); every earlier calculator sentinel row unchanged.
 *  T5 BUILT CATEGORIES: Valve Package's and Ducting's Derivation tabs equal v75's except the two nested Misc lines QR-C3 names.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { RATE_MASTER_DISCIPLINES, calculatorEntry, rateMasterPageEntry } from "../../pricing/rate-master/rateMasterRegistry";
import { calculatorRowFor } from "../../pricing/PricingCalculator";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";
import { COMING_SOON_REASON, buildExtractionByRow, isCalculatorOnlyConfig, isEligibleConfig, makePricingSheetHelper, rowUsesPreRunHelper } from "./pricingSheetHelper";
import { RATE_MASTER_CONFIG_TARGETS } from "./rateHelperPlumbing";
import { BY_ID, D2, ITEMS, LATEST, VAV, calc, surfaceMap, tot } from "./vav1Vav.harness";

const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const cell = (value: string) => ({ value, confidence: 0.9 });
/** a BoQ row on the BoQ pricing page's construction (NO calculator flag), with or without a run reading of it */
function boqRow(category: string, map: Map<string, RateCategoryConfig> = surfaceMap(), inRun = true) {
  const items = [{ attributes: { vav_item: cell("VAV box"), shape: cell("Rectangular"), vav_type: cell("AHRI Certified"), integrator_included: cell("Yes"),
    cfm_range: cell("450-800"), vav_item_as_written: cell("VAV box 750 CFM") } }];
  const h = makePricingSheetHelper({ configsByCategory: map, items: ITEMS,
    extractionByRow: inRun ? buildExtractionByRow([{ excel_row: 30, description: "750 CFM", category_id: category, attributes: {}, items }] as never) : new Map() });
  return h.compute({ excelRow: 30, description: "750 CFM", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: KINDS, unit: "Nos",
    headings: [], ownNotes: [], headingNotes: [] } as never, {}) as unknown as { kind: string; reason?: string; itemList?: { rowPriced: boolean } };
}
const withoutKey = () => { const m = surfaceMap(); const c = structuredClone(m.get(VAV)!) as RateCategoryConfig & { calculator_only?: boolean }; delete c.calculator_only; m.set(VAV, c); return m; };

describe(`VAV-1 T8 (B3, QR-A (a)) on ${LATEST}: the calculator prices VAV Box, a VAV-filed BoQ row stays "coming soon"`, () => {
  it("the shipped VAV config declares calculator_only (top-level attributes present for the Rate Master columns)", () => {
    const c = BY_ID.get(VAV)! as RateCategoryConfig & { calculator_only?: boolean };
    expect(c.calculator_only).toBe(true);
    expect(c.attribute_definitions.map((d) => d.id)).toEqual(["vav_item", "item_name", "shape", "vav_type", "integrator_included", "cfm_range"]);
    expect(isCalculatorOnlyConfig(c)).toBe(true);
    expect(isEligibleConfig(c)).toBe(false);
    expect(isEligibleConfig(c, { calculator: true })).toBe(true);
  });
  it("the calculator: D2 = 34,720 + 2,900", () => {
    expect(tot(calc(D2))).toEqual([34720, 2900]);
  });
  it("a VAV-filed BoQ row, inside a run and before one: the coming-soon card, no item list", () => {
    for (const inRun of [true, false]) {
      const r = boqRow(VAV, surfaceMap(), inRun);
      expect(r.kind, String(inRun)).toBe("none");
      expect(r.reason).toBe(COMING_SOON_REASON);
      expect(r.itemList).toBeUndefined();
    }
  });
  it("the pre-run rules: a VAV row uses the pre-run helper exactly as before VAV had a config", () => {
    const now = rowUsesPreRunHelper("HVAC", VAV, surfaceMap(), RATE_MASTER_CONFIG_TARGETS);
    const before = rowUsesPreRunHelper("HVAC", VAV, surfaceMap([VAV, "hvac_sensors"]), RATE_MASTER_CONFIG_TARGETS.filter((t) => t.categoryId !== VAV && t.categoryId !== "hvac_sensors"));
    expect(now).toBe(before);
    expect(now).toBe(true);
  });
  it("VACUITY: the key taken out of the VAV config -> the BoQ row prices (the switch is what holds it back)", () => {
    const r = boqRow(VAV, withoutKey());
    expect(r.kind).not.toBe("none");
    expect(r.itemList?.rowPriced).toBe(true);
  });
  it("NEGATIVE: a calculator built WITHOUT the flag declines VAV Box like a BoQ row", () => {
    const h = makePricingSheetHelper({ configsByCategory: surfaceMap(), items: ITEMS, extractionByRow: new Map() });
    expect((h.compute({ excelRow: 1, description: "", nodeType: "", category: VAV, discipline: "HVAC", rateKinds: KINDS, unit: "Nos" } as never, {}) as { kind: string }).kind).toBe("none");
  });
  it("NEGATIVE: the key is IGNORED on any other category (every built category stays eligible on every surface)", () => {
    for (const id of ["hvac_adp", "hvac_ducting", "hvac_insulation", "hvac_piping", "hvac_valve_package", "hvac_vrf"]) {
      const c = { ...structuredClone(BY_ID.get(id)!), calculator_only: true } as RateCategoryConfig;
      expect(isCalculatorOnlyConfig(c), id).toBe(false);
      expect(isEligibleConfig(BY_ID.get(id)!), id).toBe(true);
      expect(isEligibleConfig(c), id).toBe(true);
    }
  });
  it("only PricingCalculator passes the calculator flag; the BoQ page never names it", () => {
    const src = (f: string) => readFileSync(path.resolve(__dirname, f), "utf-8");
    expect(src("../../pricing/PricingCalculator.tsx")).toMatch(/calculatorSurface: true/);
    expect(src("../SheetPricingPage.tsx")).not.toMatch(/calculatorSurface/);
  });
});

describe(`VAV-1 T7 Sensors borrow-only on ${LATEST}`, () => {
  const hvac = RATE_MASTER_DISCIPLINES.find((d) => d.discipline === "HVAC")!;
  it("Sensors: fetched (a config target) but on neither the Rate Master page nor the calculator's list; VAV Box on both", () => {
    expect(RATE_MASTER_CONFIG_TARGETS.some((t) => t.categoryId === "hvac_sensors")).toBe(true);
    const page = rateMasterPageEntry(hvac)!.categories.map((c) => c.category_id);
    const calcList = calculatorEntry(hvac)!.categories.map((c) => c.category_id);
    for (const id of ["hvac_sensors", "hvac_misc"]) { expect(page).not.toContain(id); expect(calcList).not.toContain(id); }
    expect(page).toContain(VAV);
    expect(calcList).toContain(VAV);
  });
  it("a Sensors-filed row and a Misc-filed row stay 'coming soon' (no top-level attributes: never eligible)", () => {
    for (const id of ["hvac_sensors", "hvac_misc"]) {
      expect(isEligibleConfig(BY_ID.get(id)), id).toBe(false);
      const r = boqRow(id, surfaceMap(), false);
      expect(r.kind, id).toBe("none");
      expect(r.reason, id).toBe(COMING_SOON_REASON);
    }
  });
});

describe("VAV-1 registry: appended after Ducting, every earlier sentinel row unchanged", () => {
  const ids = RATE_MASTER_DISCIPLINES.find((d) => d.discipline === "HVAC")!.categories.map((c) => c.category_id);
  it("the last three HVAC entries: Ducting, VAV Box, Sensors (fetch_only)", () => {
    expect(ids.slice(-3)).toEqual(["hvac_ducting", VAV, "hvac_sensors"]);
    const hvac = RATE_MASTER_DISCIPLINES.find((d) => d.discipline === "HVAC")!.categories;
    expect(hvac.slice(-2)).toEqual([{ category_id: VAV, label: "VAV Box" }, { category_id: "hvac_sensors", label: "Sensors & Controls", fetch_only: true }]);
  });
  it("Ducting's calculator row is still its index + 1 (14) and VAV Box takes the next (15)", () => {
    expect(calculatorRowFor("HVAC", "hvac_ducting")).toBe(14);
    expect(calculatorRowFor("HVAC", VAV)).toBe(15);
    ids.slice(0, -2).forEach((id, i) => expect(calculatorRowFor("HVAC", id), id).toBe(i + 1));
  });
});

describe(`VAV-1 T5 built categories on ${LATEST} vs v75`, () => {
  type Asset = { items: Array<Record<string, unknown>>; category_configs: RateCategoryConfig[] };
  const A75 = readJsonFixture<Asset>(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v75.json", import.meta.url));
  const C75 = new Map(A75.category_configs.map((c) => [c.category_id, c]));
  const I75 = A75.items.map((i) => ({ ...i, discipline: "HVAC" })) as unknown as RateMasterItem[];
  const tab = (C: Map<string, RateCategoryConfig>, items: RateMasterItem[], id: string) =>
    itemListRuleOrder(C.get(id), items, { hvac_misc: C.get("hvac_misc") });
  const MISC_STOCKED_BEFORE = "'<kind> is not stocked per <unit> (stocked per <units>) - price this row by hand'; a unit the catalogue does not know "
    + "('Lot', 'Nos/Ro') the same way -- e.g. Temperature Gauge / Thermometer (stocked per Nos), Pressure Gauge (stocked per Nos), Rubber Bellows / "
    + "Expansion Joint (stocked per Nos), Test Plug / Thermowell (stocked per Nos), Paint (stocked per sq.m or per sq.ft), Fire Retardant Spray Paint "
    + "(stocked per sq.m or per sq.ft), Air Balancing (stocked per sq.m or per CFM or per sq.ft)";
  for (const [id, line] of [["hvac_valve_package", 45], ["hvac_ducting", 63]] as const) {
    it(`${id}: its own config byte-identical; its Derivation tab equal except the two nested Misc lines under line ${line} (QR-C3)`, () => {
      expect(JSON.stringify(BY_ID.get(id))).toBe(JSON.stringify(C75.get(id)));
      const was = tab(C75, I75, id), now = tab(BY_ID, ITEMS, id);
      expect(now.length).toBe(was.length);
      const moved: string[] = [];
      now.forEach((l, i) => {
        const { sub: s1, ...a } = l; const { sub: s0, ...b } = was[i];
        expect(JSON.stringify(a), `line ${l.n}`).toBe(JSON.stringify(b));
        (s1 ?? []).forEach((s, j) => { if (JSON.stringify(s) !== JSON.stringify((s0 ?? [])[j])) moved.push(`${l.n}.${s.n}`); });
        expect((s1 ?? []).length).toBe((s0 ?? []).length);
      });
      expect(moved).toEqual([`${line}.2`, `${line}.17`]);
      // QR-C3 (a) (owner 2026-11-19 03:03 "option a"): the two nested Misc lines, word for word, BEFORE (v75) and AFTER (v76)
      const sub = now.find((l) => l.n === line)!.sub!, sub0 = was.find((l) => l.n === line)!.sub!;
      expect([sub0[1].title, sub0[1].detail]).toEqual(["The item's own kind decides which products can price it", "7 kinds in the catalogue"]);
      expect([sub[1].title, sub[1].detail]).toEqual(["The item's own kind decides which products can price it", "9 kinds in the catalogue"]);
      expect(sub0[16].detail).toBe(MISC_STOCKED_BEFORE);
      expect(sub[16].detail).toBe(MISC_STOCKED_BEFORE + ", Digital Thermostat (stocked per Nos), Transformation Pieces (stocked per Nos)");
    });
  }
  it("Misc: 24 items, the 22 of v75 byte-identical", () => {
    const m75 = A75.items.filter((i) => i.kind === "hvac_misc_item");
    const m76 = ITEMS.filter((i) => i.kind === "hvac_misc_item");
    expect([m75.length, m76.length]).toEqual([22, 24]);
    const byUid = new Map(m76.map((i) => [i.item_uid, i]));
    for (const i of m75) expect(JSON.stringify({ ...byUid.get(String(i.item_uid)) })).toBe(JSON.stringify({ ...i, discipline: "HVAC" }));
  });
});
