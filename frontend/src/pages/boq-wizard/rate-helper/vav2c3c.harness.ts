/**
 * VAV-2c3 FIX-2 (ANSWER 19; the owner 2026-11-24 19:53 / 20:00 / 20:06; ANSWER 21 / 22 the A2 correction as v87): HVAC v86's and v87's edits (ONE file, `__fixtures__/vav2c3cEdits.json`, also read by
 * the v86 mint script) applied to SCRATCH COPIES of the v85 FILE (read by name, sha256 bc49096b...), so the tests run the same before the v86
 * mint and after it. `sheet86` prices a BoQ sheet through the panel's own helper with the context the PAGE builds -- the row's chain
 * (`chainRows`: the row, each heading above it and each heading's NOTE rows, then the sheet-wide notes) included, which the older sheet
 * harnesses do not pass. A row with `note: true` is a NOTE row (effective_classification "note") under its `parent`.
 */
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { rowChainOf, rowHeadings, rowQuantitiesOf, sheetCategoriesOf, sheetLinesOf } from "./rateSuggestionModel";
import { VAV, surfaceMap } from "./vav1Vav.harness";
import { mi } from "./vav2a.harness";
import { assetByName } from "./v78ByName.harness";
import { applyConfig, type ConfigEdit } from "./vav2c1Edits.harness";

export { VAV };
export const EDITS86 = readJsonFixture<{ configs: ConfigEdit[]; pricing_inputs: Record<string, never> }>(pathToFileURL(path.resolve(__dirname, "__fixtures__/vav2c3cEdits.json")));
/** the v85 FILE by name -- the base of v86 */
export const V85 = assetByName("rate_master_hvac_all_v85.json", "bc49096b");
export const ITEMS85: RateMasterItem[] = V85.items.map((i) => (i.brand ? { ...i, attributes: { ...i.attributes, brand: i.brand } } as RateMasterItem : i));
/** a category's v86 config; `drop` leaves edits out (vacuity) */
export const cfg86 = (cat: string, drop: (e: ConfigEdit) => boolean = () => false): RateCategoryConfig =>
  applyConfig(V85.byId.get(cat)!, EDITS86.configs.filter((e) => e.c === cat && !drop(e)));
/** ANSWER 21 / 22: v87 = v86 + `__fixtures__/vav2c3dEdits.json` (A2 narrowed to round / oval / circular naming the box) */
export const EDITS87 = readJsonFixture<{ configs: ConfigEdit[]; pricing_inputs: Record<string, never> }>(pathToFileURL(path.resolve(__dirname, "__fixtures__/vav2c3dEdits.json")));
export const cfg87 = (cat: string): RateCategoryConfig => applyConfig(cfg86(cat), EDITS87.configs.filter((e) => e.c === cat));

type Item = Record<string, string | number | null> & { _section?: string };
export type Row86 = { items?: Item[]; unit?: string; qty?: number | null; text?: string; category?: string; node?: string; parent?: number; note?: boolean;
  rowNotes?: string; claim?: { from: string; item: string; kind: string } };

/** a BoQ sheet priced on v86 (or `cfg`) with the page's context, chain included */
export function sheet86(rows: Record<number, Row86>, cfg: RateCategoryConfig = cfg87(VAV)) {
  const results = Object.entries(rows).filter(([, r]) => r.items || r.claim).map(([er, r]) => ({
    excel_row: Number(er), description: r.text ?? "", category_id: r.claim ? VAV : (r.category ?? VAV), attributes: {},
    items: (r.items ?? []).map((it) => mi(it as never)),
    ...(r.claim ? { claimed_from: r.claim.from, claimed_item: r.claim.item, claimed_kind: r.claim.kind } : {}),
  }));
  const map = surfaceMap([], V85.byId);
  map.set(VAV, cfg);
  const helper = makePricingSheetHelper({ configsByCategory: map, items: ITEMS85, extractionByRow: buildExtractionByRow(results as never) });
  const priced = Object.entries(rows).map(([er, r]) => ({ source_row_number: Number(er), row_index: Number(er), effective_parent_index: r.parent ?? -1,
    ...(r.qty === null ? {} : { qty_total: r.qty ?? 1 }), node_type: r.node ?? (r.note ? "Other" : "Line Item"), description: r.text ?? "",
    unit: r.unit ?? "Nos", ...(r.note ? { effective_classification: "note" } : {}), ...(r.rowNotes ? { row_notes: r.rowNotes } : {}) }));
  const sheetLines = sheetLinesOf(priced as never);
  const rowQuantities = rowQuantitiesOf(priced as never);
  const cats = Object.fromEntries(Object.entries(rows).filter(([, r]) => (r.node ?? "Line Item") === "Line Item" && !r.note).map(([er, r]) => [er, r.category ?? VAV]));
  const sheetCategories = sheetCategoriesOf(new Map(Object.entries(cats).map(([r, c]) => [Number(r), { effective_category_id: c } as never])));
  return (er: number, ov: Record<string, string> = {}): ItemListSuggestion => {
    const r = rows[er];
    const me = priced.find((p) => p.source_row_number === er)!;
    return helper.compute({ excelRow: er, description: r.text ?? "", nodeType: me.node_type, category: r.category ?? VAV, discipline: "HVAC",
      rateKinds: ["supply_rate", "install_rate", "combined_rate"], unit: r.unit ?? "Nos", quantity: r.qty ?? 1, rowQuantities, sheetLines, sheetCategories,
      headings: rowHeadings(me as never, priced as never), ownNotes: [], headingNotes: [], chainRows: rowChainOf(me as never, priced as never) } as never, ov) as unknown as ItemListSuggestion;
  };
}

/** a VAV box reading (the v85 answers), `over` changing any of them */
export const box86 = (over: Item = {}): Item => ({ vav_item: "VAV box", vav_item_as_written: "VAV box", shape: "Rectangular", vav_type: "Nothing specific mentioned",
  integrator_included: "No", cfm_range: "450-800", airflow_cfm: "700 CFM", qty_per_box: "None", scope: "None", controller_mention: "none",
  controller_by_others: "No", dp_sensor_mention: "No", needs_installing: "Yes", no_install_reason: "None", ...over });
