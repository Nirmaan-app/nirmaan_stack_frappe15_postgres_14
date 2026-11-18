/**
 * VP-1 (B5 (iii) PARITY + (v) SWEEP, blocks 69a / 69c) -- THE CALCULATOR = THE PANEL on the LIVE asset (HVAC v66, the
 * committed file), each surface's config map built THE WAY THAT SURFACE BUILDS IT: both fetch every registry target
 * (`RATE_MASTER_CONFIG_TARGETS`, Misc included -- `fetch_only` only keeps it off the lists), the calculator lists
 * `calculatorEntry(...)` (no Misc), the panel resolves the row's category. Covered, by name: every one of the 124 valve SKUs
 * (each family, each choice value the sheet varies on, each stocked size) and every one of the 12 Misc SKUs (as a Misc
 * section) -- 136 cases, the count asserted; plus the scope options on one SKU of each family. A case = the calculator's typed
 * entry vs the panel's model-read row: totals equal. VACUITY: a panel map WITHOUT Misc (one surface loading less) must break
 * the Misc cases -- asserted below, so a parity that cannot fail is caught.
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import { writeFileSync } from "node:fs";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { type ExtractedListItem } from "./itemListPricing";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, SCOPE_OVERRIDE_KEY, buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { RATE_MASTER_CONFIG_TARGETS } from "./rateHelperPlumbing";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { RATE_MASTER_DISCIPLINES, calculatorEntry } from "../../pricing/rate-master/rateMasterRegistry";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const h66 = readJsonFixture<Asset>(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v66.json", import.meta.url));
const ITEMS: RateMasterItem[] = h66.items.map((it) => ({ ...it, discipline: h66.discipline, attributes: { ...it.attributes } } as RateMasterItem));
const byId = new Map<string, RateCategoryConfig>(h66.category_configs.map((c) => [c.category_id, c]));
/** a surface's map: the registry targets of HVAC, each config the endpoint would return (`fetch_only` changes nothing here) */
const surfaceMap = (drop: string[] = []) => new Map<string, RateCategoryConfig>(RATE_MASTER_CONFIG_TARGETS.filter((t) => t.discipline === "HVAC" && !drop.includes(t.categoryId))
  .map((t) => [t.categoryId, byId.get(t.categoryId)!] as [string, RateCategoryConfig]).filter(([, c]) => !!c));
const VALVE = "hvac_valve_package";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const CHOICES = ["actuation", "nrv_type", "spindle", "strainer_type", "operation"];
const mi = (section: string | undefined, a: Record<string, string | null>): ExtractedListItem =>
  ({ ...(section ? { section } : {}), attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) } as never);

const panelOf = (map: Map<string, RateCategoryConfig>, items: ExtractedListItem[], ov: Record<string, string> = {}): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: map, items: ITEMS,
    extractionByRow: buildExtractionByRow([{ excel_row: 9, description: "valve", category_id: VALVE, attributes: {}, items }] as never) });
  return (h.compute({ excelRow: 9, description: "valve", nodeType: "Line Item", category: VALVE, discipline: "HVAC", rateKinds: KINDS, unit: "Nos", headings: [], ownNotes: [], headingNotes: [] } as never, ov) as unknown as ItemListSuggestion).itemList!;
};
const calcOf = (map: Map<string, RateCategoryConfig>, state: unknown, ov: Record<string, string> = {}): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: map, items: ITEMS, extractionByRow: new Map() });
  return (h.compute(calculatorCtx("HVAC", VALVE), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: "Nos", ...ov }) as unknown as ItemListSuggestion).itemList!;
};
const tot = (v: ItemListView) => [v.totals?.supply_rate ?? null, v.totals?.install_rate ?? null, v.totals?.combined_rate ?? null];

type Row = { case: string; sku: string; family: string; choice: string; size: number | null; panel: Array<number | null>; calc: Array<number | null>; equal: boolean };
const CASES: Row[] = [];
const PANEL = surfaceMap(); const CALC = surfaceMap();
for (const it of ITEMS.filter((i) => i.kind === "hvac_valve_item")) {
  const a = it.attributes as Record<string, unknown>;
  const fam = String(a.valve_type); const size = typeof a.size_mm === "number" ? a.size_mm : null;
  const choice = Object.fromEntries(CHOICES.filter((k) => typeof a[k] === "string").map((k) => [k, String(a[k])]));
  const p = panelOf(PANEL, [mi(undefined, { valve_type: fam, valve_type_as_written: fam, size_mm: size === null ? null : `${size} mm`, ...choice })]);
  const c = calcOf(CALC, { items: [{ base: null, family: fam, attrs: { ...(size === null ? {} : { size_mm: String(size) }), ...choice }, other: size === null ? [] : ["size_mm"] }] });
  CASES.push({ case: "valve SKU", sku: String(a.item_name), family: fam, choice: JSON.stringify(choice), size, panel: tot(p), calc: tot(c), equal: JSON.stringify(tot(p)) === JSON.stringify(tot(c)) && p.rowPriced === true });
}
for (const it of ITEMS.filter((i) => i.kind === "hvac_misc_item" && (i.attributes as Record<string, unknown>).group === "Misc"
  && ["Temperature Gauge / Thermometer", "Pressure Gauge", "Rubber Bellows / Expansion Joint", "Test Plug / Thermowell"].includes(String((i.attributes as Record<string, unknown>).item)))) {
  const a = it.attributes as Record<string, unknown>;
  const fam = String(a.item); const size = typeof a.size_mm === "number" ? a.size_mm : null;
  const p = panelOf(PANEL, [mi("misc", { item: fam, item_as_written: fam, size_mm: size === null ? null : `${size} mm` })]);
  const c = calcOf(CALC, { items: [], sections: { misc: [{ base: null, family: fam, attrs: size === null ? {} : { size_mm: String(size) }, other: size === null ? [] : ["size_mm"] }] } });
  CASES.push({ case: "Misc SKU (section)", sku: String(a.item_name), family: fam, choice: "", size, panel: tot(p), calc: tot(c), equal: JSON.stringify(tot(p)) === JSON.stringify(tot(c)) && p.rowPriced === true });
}
if (process.env.VP1_SWEEP_OUT) writeFileSync(process.env.VP1_SWEEP_OUT, JSON.stringify(CASES, null, 1));

describe("VP-1 parity + sweep -- calculator = panel on every valve and Misc SKU (live v66)", () => {
  it("136 cases (124 valve + 12 Misc), every one priced and equal", () => {
    expect(CASES.length).toBe(136);
    expect(CASES.filter((c) => c.case === "valve SKU").length).toBe(124);
    expect(CASES.filter((c) => !c.equal).map((c) => `${c.sku} ${c.size} ${c.choice} panel ${c.panel} calc ${c.calc}`)).toEqual([]);
  });
  it("the scope options agree on one SKU of each family (Supply only / Installation only)", () => {
    const fams = [...new Set(ITEMS.filter((i) => i.kind === "hvac_valve_item").map((i) => String((i.attributes as Record<string, unknown>).valve_type)))];
    expect(fams.length).toBe(13);
    for (const fam of fams) {
      const it = ITEMS.find((i) => i.kind === "hvac_valve_item" && (i.attributes as Record<string, unknown>).valve_type === fam)!;
      const a = it.attributes as Record<string, unknown>;
      const size = typeof a.size_mm === "number" ? String(a.size_mm) : null;
      const choice = Object.fromEntries(CHOICES.filter((k) => typeof a[k] === "string").map((k) => [k, String(a[k])]));
      for (const pick of ["Supply only", "Installation only"]) {
        const p = panelOf(PANEL, [mi(undefined, { valve_type: fam, valve_type_as_written: fam, size_mm: size === null ? null : `${size} mm`, ...choice })], { [SCOPE_OVERRIDE_KEY]: pick });
        const c = calcOf(CALC, { items: [{ base: null, family: fam, attrs: { ...(size === null ? {} : { size_mm: size }), ...choice }, other: size === null ? [] : ["size_mm"] }] }, { [SCOPE_OVERRIDE_KEY]: pick });
        expect(tot(p), `${fam} ${pick}`).toEqual(tot(c));
      }
    }
  });
  it("each surface's map holds Misc (fetched); the calculator's LIST does not show it", () => {
    expect(PANEL.has("hvac_misc") && CALC.has("hvac_misc")).toBe(true);
    const hvac = RATE_MASTER_DISCIPLINES.find((d) => d.discipline === "HVAC")!;
    expect(calculatorEntry(hvac).categories.map((c) => c.category_id)).toContain(VALVE);
    expect(calculatorEntry(hvac).categories.map((c) => c.category_id)).not.toContain("hvac_misc");
  });
  it("VACUITY: a panel map WITHOUT Misc breaks the Misc cases (the parity can fail)", () => {
    const noMisc = surfaceMap(["hvac_misc"]);
    const p = panelOf(noMisc, [mi("misc", { item: "Pressure Gauge", item_as_written: "Pressure Gauge", size_mm: null })]);
    const c = calcOf(CALC, { items: [], sections: { misc: [{ base: null, family: "Pressure Gauge", attrs: {} }] } });
    expect(JSON.stringify(tot(p))).not.toBe(JSON.stringify(tot(c)));
    expect(p.rowPriced).toBe(false);
  });
});
