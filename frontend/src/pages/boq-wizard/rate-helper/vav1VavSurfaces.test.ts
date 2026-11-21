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
import { COMING_SOON_REASON, buildExtractionByRow, isEligibleConfig, makePricingSheetHelper, rowUsesPreRunHelper } from "./pricingSheetHelper";
import { RATE_MASTER_CONFIG_TARGETS } from "./rateHelperPlumbing";
import { BY_ID, D2, ITEMS, LATEST, VAV, calc, surfaceMap, tot, bandFromOf } from "./vav1Vav.harness";

const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const cell = (value: string) => ({ value, confidence: 0.9 });
/** a BoQ row on the BoQ pricing page's construction (NO calculator flag), with or without a run reading of it */
function boqRow(category: string, map: Map<string, RateCategoryConfig> = surfaceMap(), inRun = true) {
  const items = [{ attributes: { vav_item: cell("VAV box"), shape: cell("Rectangular"), vav_type: cell("AHRI Certified"), integrator_included: cell("Yes"),
    cfm_range: cell("450-800"), vav_item_as_written: cell("VAV box 750 CFM"),
    // VAV-2a2 (v78, B1): the band is worked out from the airflow the row states ("750 CFM" -> 450-800), never read from a band answer
    ...(bandFromOf(map.get(VAV)) ? { airflow_cfm: cell("750 CFM") } : {}) } }];
  const h = makePricingSheetHelper({ configsByCategory: map, items: ITEMS,
    extractionByRow: inRun ? buildExtractionByRow([{ excel_row: 30, description: "750 CFM", category_id: category, attributes: {}, items }] as never) : new Map() });
  return h.compute({ excelRow: 30, description: "750 CFM", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: KINDS, unit: "Nos",
    headings: [], ownNotes: [], headingNotes: [] } as never, {}) as unknown as { kind: string; reason?: string; itemList?: { rowPriced: boolean } };
}
const withoutKey = () => { const m = surfaceMap(); const c = structuredClone(m.get(VAV)!) as RateCategoryConfig & { calculator_only?: boolean }; delete c.calculator_only; m.set(VAV, c); return m; };

describe(`VAV-1 T8 (B3, QR-A (a)) on ${LATEST}: the calculator prices VAV Box, a VAV-filed BoQ row stays "coming soon"`, () => {
  // VAV-2b2 K2 (R1, owner 2026-11-19 02:55 "removed in VAV-2b"; PIN F3, ANSWER 28): the switch is REMOVED - on the newest asset a VAV-filed BoQ
  // row is priced like the calculator. The test names are VAV-1's (kept so no test disappears); each body states its BEFORE.
  it("the shipped VAV config declares calculator_only (top-level attributes present for the Rate Master columns)", () => {
    // BEFORE: calculator_only true, not eligible except on the calculator surface. AFTER: no key; eligible on every surface.
    const c = BY_ID.get(VAV)! as RateCategoryConfig & { calculator_only?: boolean };
    expect("calculator_only" in c).toBe(false);
    expect(c.attribute_definitions.map((d) => d.id)).toEqual(["vav_item", "item_name", "shape", "vav_type", "integrator_included", "cfm_range"]);
    expect(isEligibleConfig(c)).toBe(true);
  });
  it("the calculator: D2 = 34,720 + 2,900", () => {
    expect(tot(calc(D2))).toEqual([34720, 2900]);
  });
  it("a VAV-filed BoQ row, inside a run and before one: the coming-soon card, no item list", () => {
    // BEFORE: 'none' + the coming-soon text, no item list, inside a run and before one. AFTER: inside a run the row is priced; before a run
    // it is not the coming-soon card any more (the item-list view asks for the items)
    const inRun = boqRow(VAV, surfaceMap(), true);
    expect(inRun.kind).not.toBe("none");
    expect(inRun.itemList?.rowPriced).toBe(true);
    const before = boqRow(VAV, surfaceMap(), false);
    expect(before.reason).not.toBe(COMING_SOON_REASON);
  });
  it("the pre-run rules: a VAV row uses the pre-run helper exactly as before VAV had a config", () => {
    // BEFORE: a VAV row used the pre-run helper (true), as before VAV had a config. AFTER: the rules run for it (false)
    const now = rowUsesPreRunHelper("HVAC", VAV, surfaceMap(), RATE_MASTER_CONFIG_TARGETS);
    expect(now).toBe(false);
  });
  it("VACUITY: the key taken out of the VAV config -> the BoQ row prices (the switch is what holds it back)", () => {
    const r = boqRow(VAV, withoutKey());
    expect(r.kind).not.toBe("none");
    expect(r.itemList?.rowPriced).toBe(true);
  });
  it("NEGATIVE: a calculator built WITHOUT the flag declines VAV Box like a BoQ row", () => {
    // BEFORE: a helper built without the calculator flag declined VAV Box ('none'). AFTER: there is no flag - the same construction prices it
    const h = makePricingSheetHelper({ configsByCategory: surfaceMap(), items: ITEMS, extractionByRow: new Map() });
    expect((h.compute({ excelRow: 1, description: "", nodeType: "", category: VAV, discipline: "HVAC", rateKinds: KINDS, unit: "Nos" } as never, {}) as { kind: string }).kind).not.toBe("none");
  });
  it("NEGATIVE: the key is IGNORED on any other category (every built category stays eligible on every surface)", () => {
    // BEFORE: isCalculatorOnlyConfig false off VAV. AFTER: no reader of the key exists; every built category eligible, a stray key or not
    for (const id of ["hvac_adp", "hvac_ducting", "hvac_insulation", "hvac_piping", "hvac_valve_package", "hvac_vrf"]) {
      const c = { ...structuredClone(BY_ID.get(id)!), calculator_only: true } as RateCategoryConfig;
      expect(isEligibleConfig(BY_ID.get(id)!), id).toBe(true);
      expect(isEligibleConfig(c), id).toBe(true);
    }
  });
  it("only PricingCalculator passes the calculator flag; the BoQ page never names it", () => {
    // BEFORE: PricingCalculator.tsx passed `calculatorSurface: true`. AFTER: no file passes it
    const src = (f: string) => readFileSync(path.resolve(__dirname, f), "utf-8");
    expect(src("../../pricing/PricingCalculator.tsx")).not.toMatch(/calculatorSurface: true/);
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
  /** VAV-2a2 R7: undo exactly the v78 Valve changes (the two supply-row notes back to v75's text, the E13 rule line out) -- and check
   *  there IS exactly one E13 line and the two notes differ from v75 by the tag alone, so nothing else can hide in the undo */
  const withoutR7 = (c: RateCategoryConfig, v75: RateCategoryConfig): RateCategoryConfig => {
    type V = { list_spec: { pricing: { rule_lines: Array<{ rule: string }>; scope: { supply_row: { with_row: string; no_row: string } } } } };
    const out = structuredClone(c) as unknown as V, old = v75 as unknown as V;
    const sr = out.list_spec.pricing.scope.supply_row, sr0 = old.list_spec.pricing.scope.supply_row;
    expect(sr.with_row).toBe(sr0.with_row.replace(" (owner VR9)", ""));
    expect(sr.no_row).toBe(sr0.no_row.replace(" (owner VR9)", ""));
    sr.with_row = sr0.with_row; sr.no_row = sr0.no_row;
    expect(out.list_spec.pricing.rule_lines.filter((r) => r.rule === "E13")).toHaveLength(1);
    out.list_spec.pricing.rule_lines = out.list_spec.pricing.rule_lines.filter((r) => r.rule !== "E13");
    return out as unknown as RateCategoryConfig;
  };
  for (const [id, line] of [["hvac_valve_package", 45], ["hvac_ducting", 63]] as const) {
    it(`${id}: its own config byte-identical; its Derivation tab equal except the two nested Misc lines under line ${line} (QR-C3)`, () => {
      // VAV-2a2 (HVAC v78; owner QR-V (a) 2026-11-20 00:10, R7): the Valve Package config's DECLARED changes -- the two scope notes lose
      // " (owner VR9)" and the Derivation gains the E13 line -- are undone on a copy before the byte comparison; every other byte is pinned
      const cur = new Map(BY_ID);
      if (id === "hvac_valve_package" && Number(LATEST.match(/v(\d+)/)![1]) >= 78) cur.set(id, withoutR7(BY_ID.get(id)!, C75.get(id)!));
      expect(JSON.stringify(cur.get(id))).toBe(JSON.stringify(C75.get(id)));
      const was = tab(C75, I75, id), now = tab(cur, ITEMS, id);
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
