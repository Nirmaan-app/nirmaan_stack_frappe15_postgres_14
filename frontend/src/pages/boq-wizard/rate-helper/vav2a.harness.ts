/**
 * VAV-2a: the shared pieces that apply the VAV rulings to a row, each switched on by a NEW key in the hvac_vav_box config. Shared by the
 * vav2a* tests. Every config here is a SCRATCH COPY (structuredClone) of the newest HVAC asset's -- the asset file is never written:
 *  - `vavWith(keys)` the VAV config with the VAV-2a keys set (or removed with `undefined`), from whatever the newest asset carries;
 *  - `boqMap(cfg)` the BoQ page's config map with that VAV config and its `calculator_only` switch REMOVED on the copy (the switch stays
 *    ON in the loaded config: VAV rows are "coming soon" until VAV-2b; brief B11 "with the switch treated as off ON A SCRATCH COPY");
 *  - `calcWith(cfg, state)` the calculator's own construction (vav1Vav.harness `calc`) on that config;
 *  - `vavSheet(rows)` a BoQ sheet of rows, model items per row, priced the way the BoQ page passes a row (the vp1Valve `sheet` pattern).
 * The VAV-2a Pricing Inputs are added to the items here only when the asset does not carry them yet (`withInputs`).
 */
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { type ExtractedListItem } from "./itemListPricing";
import { buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { rowHeadings, rowQuantitiesOf, sheetCategoriesOf, sheetLinesOf } from "./rateSuggestionModel";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { BY_ID, ITEMS, VAV, bandFromOf, calc, surfaceMap, type CalcState } from "./vav1Vav.harness";

export { VAV, ITEMS, BY_ID };

type Json = Record<string, unknown>;
const pricingOf = (c: RateCategoryConfig): Json => ((c as unknown as { list_spec: { pricing: Json } }).list_spec.pricing);
const sectionsOf = (c: RateCategoryConfig): Json[] => ((c as unknown as { list_spec: { sections: Json[] } }).list_spec.sections);

/** the VAV-2a keys and Pricing Inputs -- ONE file, read by these tests and by the HVAC v77 mint (mint_hvac_v77_vav2a.py) */
type Keys = { pricing: Record<string, unknown>; sections: Record<string, Record<string, unknown>>; inputs: Record<string, { name: string; factor: number }> };
export const KEYS = readJsonFixture<Keys>(new URL("./__fixtures__/vav2aKeys.json", import.meta.url));
/** the VAV-2a Pricing Inputs (the defaults the owner ruled); an input the asset already carries is taken from the asset */
export const VAV2A_INPUTS: Record<string, { name: string; factor: number }> = KEYS.inputs;
export function withInputs(items: readonly RateMasterItem[] = ITEMS, over: Record<string, number | null> = {}): RateMasterItem[] {
  const has = (id: string) => items.some((i) => /_pricing_input$/.test(String(i.kind)) && i.attributes?.item === id);
  const add = Object.entries(VAV2A_INPUTS).filter(([id]) => !has(id)).map(([id, v]) => ({
    kind: "hvac_pricing_input", discipline: "HVAC", unit: "share", item_uid: `rmi-test-${id}`,
    attributes: { item: id, name: v.name }, rates: { factor: v.factor },
  } as unknown as RateMasterItem));
  return [...items, ...add].flatMap((i) => {
    const id = /_pricing_input$/.test(String(i.kind)) ? String(i.attributes?.item ?? "") : "";
    if (!(id in over)) return [i];
    if (over[id] === null) return [];
    return [{ ...i, rates: { ...(i.rates as Json), factor: over[id] } } as unknown as RateMasterItem];
  });
}

/** B9: the combination warning as the owner worded it (12:49 / 12:59; wording shown to him at the mockup check) */
export const COMBINATION_WARNING = KEYS.pricing.combination_warning as { box_families: string[]; share_input: string; line: string; line_one: string; input_missing: string };

/** a scratch copy of the newest VAV config with pricing keys set / removed (`undefined` removes) and section keys per section id */
export function vavWith(pricing: Record<string, unknown> = {}, sections: Record<string, Record<string, unknown>> = {}): RateCategoryConfig {
  const c = structuredClone(BY_ID.get(VAV)!);
  const pr = pricingOf(c);
  for (const [k, v] of Object.entries(pricing)) { if (v === undefined) delete pr[k]; else pr[k] = structuredClone(v); }
  for (const s of sectionsOf(c)) {
    for (const [k, v] of Object.entries(sections[String(s.id)] ?? {})) { if (v === undefined) delete s[k]; else s[k] = structuredClone(v); }
  }
  return c;
}

/** the newest VAV config with EVERY VAV-2a key removed (what v76 priced by) */
export const vavBare = () => vavWith(Object.fromEntries(Object.keys(KEYS.pricing).map((k) => [k, undefined])),
  Object.fromEntries(Object.entries(KEYS.sections).map(([id, ks]) => [id, Object.fromEntries(Object.keys(ks).map((k) => [k, undefined]))])));
/** the VAV config with EVERY VAV-2a key on (what v77 carries); `drop` takes keys out (a key absent = unchanged) */
export const vavFull = (drop: string[] = []) => vavWith(Object.fromEntries(Object.entries(KEYS.pricing).map(([k, v]) => [k, drop.includes(k) ? undefined : v])),
  drop.includes("qty_attr") ? {} : KEYS.sections);

/** the calculator's map with this VAV config in it */
export const calcMap = (cfg: RateCategoryConfig) => { const m = surfaceMap(); m.set(VAV, cfg); return m; };
export const calcWith = (cfg: RateCategoryConfig, state: CalcState, items: RateMasterItem[] = withInputs(), unit = "Nos", scope?: string): ItemListSuggestion =>
  calc(state, calcMap(cfg), items, unit, scope);

/** the BoQ page's map with this VAV config, its calculator_only switch removed ON THE COPY */
export function boqMap(cfg: RateCategoryConfig): Map<string, RateCategoryConfig> {
  const c = structuredClone(cfg) as unknown as Json;
  delete c.calculator_only;
  const m = surfaceMap();
  m.set(VAV, c as unknown as RateCategoryConfig);
  return m;
}

type Item = Record<string, string | number | null> & { _section?: string };
export const mi = (a: Item): ExtractedListItem => {
  const { _section, ...attrs } = a;
  return { ...(_section ? { section: _section } : {}), attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v, confidence: v === null ? 0 : 0.9 }])) } as never;
};
export type SheetRow = { items?: Item[]; unit?: string; qty?: number | null; text?: string; headings?: string[]; ownNotes?: string[]; headingNotes?: string[];
  category?: string; node?: string; parent?: number; rowNotes?: string };
const KINDS = ["supply_rate", "install_rate", "combined_rate"];

/** a BoQ sheet: rows by excel row, model items on the rows that have them; `cats` = the page's category of each row */
export function vavSheet(rows: Record<number, SheetRow>, opts: { cfg?: RateCategoryConfig; items?: RateMasterItem[]; cats?: Record<number, string> } = {}) {
  const cfg = opts.cfg ?? vavWith();
  // VAV-2a2 (B1): on a config with `band_from` the band is worked out from the airflow the BoQ states -- a box item that names a band and no
  // airflow / inlet size is given the airflow one below the band's max (inside it under either edge rule), as the BoQ would state it
  const bf = bandFromOf(cfg);
  const asRead = (it: Item): Item => {
    if (!bf || !bf.families.includes(String(it.vav_item)) || typeof it[bf.attr] !== "string" || bf.airflow_attr in it || bf.inlet_attr in it) return it;
    const hit = bf.bands.find((x) => x.value === it[bf.attr]);
    return hit ? { ...it, [bf.airflow_attr]: `${hit.max - 1} CFM` } : it;
  };
  const results = Object.entries(rows).filter(([, r]) => r.items).map(([er, r]) => ({
    excel_row: Number(er), description: r.text ?? "", category_id: r.category ?? VAV, attributes: {}, items: r.items!.map((it) => mi(asRead(it))),
  }));
  const helper = makePricingSheetHelper({ configsByCategory: boqMap(cfg), items: opts.items ?? withInputs(), extractionByRow: buildExtractionByRow(results as never) });
  // the page's rows: a heading above a row = its parent chain (`parent` = the heading's excel row), as `rowHeadings` reads it
  const priced = Object.entries(rows).map(([er, r]) => ({ source_row_number: Number(er), row_index: Number(er), effective_parent_index: r.parent ?? -1,
    ...(r.qty === null ? {} : { qty_total: r.qty ?? 1 }), node_type: r.node ?? "Line Item", description: r.text ?? "", unit: r.unit ?? "Nos",
    ...(r.rowNotes ? { row_notes: r.rowNotes } : {}) }));
  const sheetLines = sheetLinesOf(priced as never);
  const rowQuantities = rowQuantitiesOf(priced as never);
  const cats = opts.cats ?? Object.fromEntries(Object.entries(rows).filter(([, r]) => (r.node ?? "Line Item") !== "Preamble").map(([er, r]) => [er, r.category ?? VAV]));
  const sheetCategories = sheetCategoriesOf(new Map(Object.entries(cats).map(([r, c]) => [Number(r), { effective_category_id: c } as never])));
  return (er: number, ov: Record<string, string> = {}): ItemListSuggestion => {
    const r = rows[er];
    const me = priced.find((p) => p.source_row_number === er)!;
    return helper.compute({ excelRow: er, description: r.text ?? "", nodeType: r.node ?? "Line Item", category: r.category ?? VAV, discipline: "HVAC", rateKinds: KINDS,
      unit: r.unit ?? "Nos", quantity: r.qty ?? 1, rowQuantities, sheetLines, sheetCategories, headings: r.headings ?? rowHeadings(me as never, priced as never), ownNotes: r.ownNotes ?? [],
      headingNotes: r.headingNotes ?? [] } as never, ov) as unknown as ItemListSuggestion;
  };
}
export const tot = (v: ItemListView | undefined) => [v?.totals?.supply_rate ?? null, v?.totals?.install_rate ?? null];

/** a VAV box model item (the facts the box line needs) */
export const boxItem = (over: Item = {}): Item => ({ vav_item: "VAV box", vav_item_as_written: "VAV box", shape: "Rectangular", vav_type: "Nothing specific mentioned",
  integrator_included: "No", cfm_range: "450-800", qty_per_box: "None", scope: "None", ...over });
