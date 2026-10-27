/**
 * ADP-3a (owner rulings H1 / H2 / B6 / unit refusals / H6, 2026-10-20) -- THE ENTRY POINTS THE SLICE'S TESTS DRIVE. NOT
 * product code. ADP-3a mints no asset: every case runs on the LIVE assets (HVAC v48, Electrical v66), through the panel's
 * construction (an extraction map holding the row) and the calculator's (the same factory, an EMPTY map) -- the two
 * surfaces the owner's "calculator = panel" rule names.
 */
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { mergeItemsByName } from "./rateHelperPlumbing";
import { isSuggestion, type ExtractionRow, type HelperResult, type RateHelperRowContext } from "./rateHelperTypes";

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[] };
// READ at runtime, never `import`ed (tsc dies typing a multi-megabyte JSON module); by `__dirname`, which both the node and
// the jsdom environments give (jsdom's `import.meta.url` is not a file URL)
const DATA_DIR = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
// the parse stays in the parity family's ONE fixture reader (ADR-0010 F2 counts every inline parse under pages/)
const readAsset = (file: string): Asset => readJsonFixture<Asset>(pathToFileURL(path.join(DATA_DIR, file)));
const HVAC = readAsset("rate_master_hvac_all_v48.json");
const ELEC = readAsset("rate_master_electrical_all_v66.json");

// the endpoint projects `brand` into attributes at read time (extraction.PROJECTED_ITEM_COLUMNS)
const itemsOf = (a: Asset): RateMasterItem[] =>
  a.items.map((i) => ({ ...i, attributes: { ...i.attributes, ...(i.brand ? { brand: i.brand } : {}) }, discipline: a.discipline } as RateMasterItem));
export const ITEMS: RateMasterItem[] = mergeItemsByName(itemsOf(HVAC), itemsOf(ELEC));
export const CONFIGS = new Map<string, RateCategoryConfig>([...HVAC.category_configs, ...ELEC.category_configs].map((c) => [c.category_id, c]));
export const DISCIPLINE_OF = (cat: string): string => (HVAC.category_configs.some((c) => c.category_id === cat) ? "HVAC" : "Electrical");

const cells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
const RATE_KINDS = ["supply_rate", "install_rate", "combined_rate"];

export interface RowIn {
  cat: string;
  unit?: string;
  /** an item-list row's model items (attributes as the model wrote them) */
  model?: Array<Record<string, string>>;
  /** an attribute row's extracted attributes */
  attrs?: Record<string, string>;
  desc?: string;
}

/** `unit` absent on the calculator, as `calculatorCtx` builds it -- a row-unit pick is then the unit */
function ctxOf(cat: string, unit: string | undefined, desc: string): RateHelperRowContext & { unit?: string } {
  return { excelRow: 1, description: desc, nodeType: "Line Item", category: cat, discipline: DISCIPLINE_OF(cat), rateKinds: RATE_KINDS, headings: [], ownNotes: [], ...(unit !== undefined ? { unit } : {}) };
}
function must(r: HelperResult, what: string): ItemListSuggestion {
  if (!isSuggestion(r)) throw new Error(`${what}: expected a suggestion`);
  return r as ItemListSuggestion;
}

/** THE PANEL: the row stored in an extraction map, then any pricer edits as overrides. */
export function panel(row: RowIn, overrides: Record<string, string> = {}): ItemListSuggestion {
  const ext = new Map<number, ExtractionRow>([[1, {
    excelRow: 1, description: row.desc ?? "", attributes: cells(row.attrs ?? {}),
    ...(row.model ? { items: row.model.map((a) => ({ attributes: cells(a) })) } : {}),
  } as unknown as ExtractionRow]]);
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: ext });
  return must(h.compute(ctxOf(row.cat, row.unit ?? "", row.desc ?? ""), overrides), `panel ${row.cat}`);
}

/** THE CALCULATOR: the same factory with an EMPTY extraction map; every answer is a pick. */
export function calculator(cat: string, picks: Record<string, string>): ItemListSuggestion {
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
  return must(h.compute(ctxOf(cat, undefined, ""), picks), `calculator ${cat}`);
}

/** One item-list field, flattened to what the screen draws for it. */
export interface FieldSeen { id: string; label: string; value: string; required: boolean; group: string | null; blank: boolean; outline: boolean; note: string | null }
export const fieldsOf = (s: ItemListSuggestion, block = 0): FieldSeen[] =>
  (s.itemList?.items[block]?.fields ?? []).map((f) => ({
    id: f.id, label: f.label, value: f.value, required: !!f.required, group: (f.group as string | undefined) ?? null,
    blank: !!f.blank, outline: !!f.outline, note: f.note ?? null,
  }));
export const field = (s: ItemListSuggestion, id: string, block = 0): FieldSeen => {
  const f = fieldsOf(s, block).find((x) => x.id === id);
  if (!f) throw new Error(`no field ${id}`);
  return f;
};
/** One attribute-panel row, flattened the same way (the landed note's words included). */
export const attrsOf = (s: ItemListSuggestion) =>
  s.workings.attributes.map((a) => ({
    id: a.id, label: a.label, value: a.value, required: !!a.required, disabled: !!a.disabled,
    landed: (a.notes ?? []).flatMap((n) => (n.kind === "landed" ? [n.how] : [])),
  }));
export const attr = (s: ItemListSuggestion, id: string) => {
  const a = attrsOf(s).find((x) => x.id === id);
  if (!a) throw new Error(`no attribute ${id}`);
  return a;
};
export const priced = (s: ItemListSuggestion): boolean => Object.keys(s.values ?? {}).length > 0;
