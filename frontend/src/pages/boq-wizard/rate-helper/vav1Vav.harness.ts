/**
 * VAV-1 (HVAC v76): the newest HVAC asset, the workbook's VAV Box tab lines (pinned from the workbook at mint time, never typed), and
 * the calculator built THE WAY THE CALCULATOR BUILDS IT -- every HVAC registry target fetched (`RATE_MASTER_CONFIG_TARGETS`: Misc and
 * Sensors included, `fetch_only` only keeps them off the lists), `makePricingSheetHelper` over an empty extraction map, the calculator's
 * row context. Shared by the vav1Vav* tests.
 */
import { readdirSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, SCOPE_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { RATE_MASTER_CONFIG_TARGETS } from "./rateHelperPlumbing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
/** the latest HVAC asset by version number (a latest-asset reader by file prefix: rate_master_hvac_all_v) */
export const LATEST = readdirSync(DATA).filter((f) => /^rate_master_hvac_all_v\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/v(\d+)/)![1]) - Number(b.match(/v(\d+)/)![1])).pop()!;
const A = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, LATEST)));
export const ITEMS: RateMasterItem[] = A.items.map((i) => ({ ...i, discipline: "HVAC", attributes: { ...i.attributes } } as RateMasterItem));
export const BY_ID = new Map<string, RateCategoryConfig>(A.category_configs.map((c) => [c.category_id, c]));
export const VAV = "hvac_vav_box";
export const VAV_ITEMS = ITEMS.filter((i) => i.kind === "hvac_vav_item");

export type TabLine = { row: number; item: string; type: string; integrator: string; cfm: string; bcs_supply: number; bcs_install: number;
  supply_markup: number; install_markup: number; boq_supply: number; boq_install: number };
type Fixture = { workbook_sha256: string; vav_box_tab: TabLine[]; misc: Record<string, Record<string, number | string>>; sensors: Record<string, Record<string, number | string>> };
export const TAB = readJsonFixture<Fixture>(new URL("./__fixtures__/vav1VavBoxTab.json", import.meta.url));

/** a surface's config map: the HVAC registry targets, each config the endpoint returns; `drop` takes targets out (vacuity) */
export const surfaceMap = (drop: string[] = [], byId: Map<string, RateCategoryConfig> = BY_ID) => new Map<string, RateCategoryConfig>(
  RATE_MASTER_CONFIG_TARGETS.filter((t) => t.discipline === "HVAC" && !drop.includes(t.categoryId))
    .map((t) => [t.categoryId, byId.get(t.categoryId)!] as [string, RateCategoryConfig]).filter(([, c]) => !!c));

export type Block = { base: null; family: string; attrs: Record<string, string>; qty?: string };
export type CalcState = { items: Block[]; sections?: Record<string, Block[]> };
export const blk = (family: string, attrs: Record<string, string> = {}, qty?: string): Block => ({ base: null, family, attrs, ...(qty ? { qty } : {}) });

/** VAV-2a2 (B3, owner 2026-11-19 13:31 / 13:46): on a config with `band_from` the band is never picked -- the user types the CFM or the inlet
 *  size. A band a test PICKS (cfm_range) is entered the v78 way: a CFM one below the band's max, inside it under either edge rule. */
type BandFromCfg = { attr: string; families: string[]; airflow_attr: string; inlet_attr: string; bands: Array<{ value: string; max: number }> };
export const bandFromOf = (cfg: RateCategoryConfig | undefined): BandFromCfg | undefined =>
  (cfg as unknown as { list_spec?: { pricing?: { band_from?: BandFromCfg } } } | undefined)?.list_spec?.pricing?.band_from;
export function typedBand(state: CalcState, bf: BandFromCfg | undefined): CalcState {
  if (!bf) return state;
  const one = (b: Block): Block => {
    const band = b.attrs[bf.attr];
    if (!bf.families.includes(b.family) || band === undefined || bf.airflow_attr in b.attrs || bf.inlet_attr in b.attrs) return b;
    const hit = bf.bands.find((x) => x.value === band);
    const { [bf.attr]: _picked, ...rest } = b.attrs;
    return { ...b, attrs: hit ? { ...rest, [bf.airflow_attr]: String(hit.max - 1) } : rest };
  };
  return { ...state, items: state.items.map(one) };
}

/** the calculator's own construction (PricingCalculator.tsx) on a config map, VAV Box picked, the row unit Nos */
export function calc(state: CalcState, map: Map<string, RateCategoryConfig> = surfaceMap(), items: RateMasterItem[] = ITEMS, unit = "Nos", scope?: string): ItemListSuggestion {
  // VAV-1 (QR-A (a)): `calculatorSurface: true` is the calculator's one difference from the BoQ page's construction
  const h = makePricingSheetHelper({ configsByCategory: map, items, extractionByRow: new Map(), calculatorSurface: true });
  const st = typedBand(state, bandFromOf(map.get(VAV)));
  return h.compute(calculatorCtx("HVAC", VAV), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(st), [ROW_UNIT_OVERRIDE_KEY]: unit, ...(scope ? { [SCOPE_OVERRIDE_KEY]: scope } : {}) }) as unknown as ItemListSuggestion;
}
export const view = (s: ItemListSuggestion): ItemListView | undefined => s.itemList;
export const tot = (s: ItemListSuggestion) => [s.itemList?.totals?.supply_rate ?? null, s.itemList?.totals?.install_rate ?? null];

export const TYPES: Record<string, string> = { "AHRI Certfied": "AHRI Certified", "AHRI Certfied Imported": "AHRI Certified Imported",
  "Nothing specific mentioned": "Nothing specific mentioned", "Imported": "Imported" };
/** the calculator entry for one tab line: its family and the facts the line varies on, as a person picks them */
export function tabEntry(r: TabLine): Block {
  return r.item === "VAV Integrator" ? blk("VAV Integrator", { vav_type: TYPES[r.type] })
    : blk("VAV box", { shape: r.item.startsWith("Rect") ? "Rectangular" : "Oval", vav_type: TYPES[r.type], integrator_included: r.integrator, cfm_range: r.cfm });
}
/** the D2 case (VAV-D0 D2, BOQ-26-00383 r30): box Rect / AHRI Certified / Integrator Yes / 450-800 + Conical piece x2 + Digital Thermostat */
export const D2_BOX = blk("VAV box", { shape: "Rectangular", vav_type: "AHRI Certified", integrator_included: "Yes", cfm_range: "450-800" });
export const D2: CalcState = { items: [D2_BOX, blk("Conical piece", {}, "2")], sections: { misc: [blk("Digital Thermostat")] } };
