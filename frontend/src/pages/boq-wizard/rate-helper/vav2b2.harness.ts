/**
 * VAV-2b2: HVAC v81's keys (vav2b2Keys.harness.ts) applied to SCRATCH COPIES of the v80 FILE (read by name, sha256 76f0a942...), so the
 * vav2b2* tests run the same before the v81 mint and after it. The asset files are never written. A BoQ sheet here can carry rows the VAV
 * helper CLAIMED from Misc / Sensors (R16): the run's result row says so (`claim`), the page keeps the row's filed category.
 */
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { rowHeadings, rowQuantitiesOf, sheetCategoriesOf, sheetLinesOf } from "./rateSuggestionModel";
import { VAV, surfaceMap, type CalcState } from "./vav1Vav.harness";
import { bandFromOf } from "./vav1Vav.harness";
import { mi, type SheetRow } from "./vav2a.harness";
import { SHARES_OVERRIDE_KEY, type SharesEditState } from "./vavSheetShares";
import { assetByName } from "./v78ByName.harness";
import { KEYS81, withV81Items, withV81Keys, type V81Over } from "./vav2b2Keys.harness";
import type { RowClaim } from "./vavClaims";

export { KEYS81, withV81Items, withV81Keys, type V81Over, VAV };
type Json = Record<string, unknown>;

/** the v80 FILE by name -- the base of v81 */
export const V80 = assetByName("rate_master_hvac_all_v80.json", "76f0a942");
/** v81's VAV config (a scratch copy of the v80 file's + the keys) */
export const vav81 = (over: V81Over = {}): RateCategoryConfig => withV81Keys(structuredClone(V80.byId.get(VAV)!), over);
/** the v80 file's VAV config as it is (the "before" side of T4 / KEY ABSENT) -- its calculator_only switch removed on the copy */
export const vav80file = (): RateCategoryConfig => { const c = structuredClone(V80.byId.get(VAV)!) as unknown as Json; delete c.calculator_only; return c as unknown as RateCategoryConfig; };
/** v81's items (the warning share 0.25); `over` sets / removes a Pricing Input */
export const items81 = (over: Record<string, number | null> = {}): RateMasterItem[] => withV81Items(V80.items, over);

/** the map every surface reads, on the v80 file's configs, with this VAV config */
export function map81(cfg: RateCategoryConfig = vav81()): Map<string, RateCategoryConfig> {
  const m = surfaceMap([], V80.byId);
  m.set(VAV, cfg);
  return m;
}

/** the calculator's own construction on v81 (or the given VAV config), with the shares' edits */
export function calc81(state: CalcState, shares: SharesEditState = {}, cfg: RateCategoryConfig = vav81(), items: RateMasterItem[] = items81()): ItemListSuggestion {
  const h = makePricingSheetHelper({ configsByCategory: map81(cfg), items, extractionByRow: new Map() });
  return h.compute(calculatorCtx("HVAC", VAV), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: "Nos",
    ...(Object.keys(shares).length ? { [SHARES_OVERRIDE_KEY]: JSON.stringify(shares) } : {}) }) as unknown as ItemListSuggestion;
}

/** a sheet row; `claim` = the run claimed it for VAV (its result row is VAV's, its page category stays `category`) */
export type Row81 = SheetRow & { claim?: RowClaim };

/** a BoQ sheet priced on v81 (the vav2a.harness `vavSheet` shape, plus claimed rows) */
export function sheet81(rows: Record<number, Row81>, opts: { cfg?: RateCategoryConfig; items?: RateMasterItem[]; runId?: string } = {}) {
  const cfg = opts.cfg ?? vav81();
  const bf = bandFromOf(cfg);
  const asRead = (it: Json): Json => {
    if (!bf || !bf.families.includes(String(it.vav_item)) || typeof it[bf.attr] !== "string" || bf.airflow_attr in it || bf.inlet_attr in it) return it;
    const hit = bf.bands.find((x) => x.value === it[bf.attr]);
    return hit ? { ...it, [bf.airflow_attr]: `${hit.max - 1} CFM` } : it;
  };
  const results = Object.entries(rows).filter(([, r]) => r.items || r.claim).map(([er, r]) => ({
    excel_row: Number(er), description: r.text ?? "", category_id: r.claim ? VAV : (r.category ?? VAV), attributes: {},
    items: (r.items ?? []).map((it) => mi(asRead(it as Json) as never)),
    ...(r.claim ? { claimed_from: r.claim.from, claimed_item: r.claim.item, claimed_kind: r.claim.kind } : {}),
  }));
  const helper = makePricingSheetHelper({ configsByCategory: map81(cfg), items: opts.items ?? items81(), extractionByRow: buildExtractionByRow(results as never) });
  const priced = Object.entries(rows).map(([er, r]) => ({ source_row_number: Number(er), row_index: Number(er), effective_parent_index: r.parent ?? -1,
    ...(r.qty === null ? {} : { qty_total: r.qty ?? 1 }), node_type: r.node ?? "Line Item", description: r.text ?? "", unit: r.unit ?? "Nos",
    ...(r.rowNotes ? { row_notes: r.rowNotes } : {}) }));
  const sheetLines = sheetLinesOf(priced as never);
  const rowQuantities = rowQuantitiesOf(priced as never);
  const cats = Object.fromEntries(Object.entries(rows).filter(([, r]) => (r.node ?? "Line Item") !== "Preamble").map(([er, r]) => [er, r.category ?? VAV]));
  const sheetCategories = sheetCategoriesOf(new Map(Object.entries(cats).map(([r, c]) => [Number(r), { effective_category_id: c } as never])));
  return (er: number, ov: Record<string, string> = {}): ItemListSuggestion => {
    const r = rows[er];
    const me = priced.find((p) => p.source_row_number === er)!;
    return helper.compute({ excelRow: er, description: r.text ?? "", nodeType: r.node ?? "Line Item", category: r.category ?? VAV, discipline: "HVAC",
      rateKinds: ["supply_rate", "install_rate", "combined_rate"], unit: r.unit ?? "Nos", quantity: r.qty ?? 1, rowQuantities, sheetLines, sheetCategories,
      headings: r.headings ?? rowHeadings(me as never, priced as never), ownNotes: r.ownNotes ?? [], headingNotes: r.headingNotes ?? [],
      ...(opts.runId ? { runId: opts.runId } : {}) } as never, ov) as unknown as ItemListSuggestion;
  };
}

/** a VAV box row with its reading (the three questions the model answers from v81) */
export function box81(qty: number | null, reading: { controller?: string; byOthers?: boolean; dp?: boolean } = {}, over: Record<string, string | number | null> = {}): Row81 {
  return { qty, items: [{ vav_item: "VAV box", vav_item_as_written: "VAV box", shape: "Rectangular", vav_type: "Nothing specific mentioned",
    integrator_included: "No", cfm_range: "450-800", airflow_cfm: "700 CFM", qty_per_box: "None", scope: "None",
    controller_mention: reading.controller ?? "none", controller_by_others: reading.byOthers ? "Yes" : "No", dp_sensor_mention: reading.dp ? "Yes" : "No", ...over }] };
}
