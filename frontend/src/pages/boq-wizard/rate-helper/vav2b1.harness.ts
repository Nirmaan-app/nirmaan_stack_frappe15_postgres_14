/**
 * VAV-2b1: the next HVAC rate file's keys (vav2b1Keys.harness.ts) applied to a SCRATCH COPY of the newest asset's VAV config and items,
 * so the vav2b1* tests run the same before the mint (keys applied here) and after it (keys already there; applying them again changes
 * nothing). The asset file is never written. Shared by the vav2b1* node tests (the jsdom test uses vav2b1Keys.harness.ts directly).
 */
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { vav78 } from "./vav2a2.harness";
import { ITEMS, VAV, surfaceMap, type CalcState } from "./vav1Vav.harness";
import { boxItem, vavSheet, withInputs, type SheetRow } from "./vav2a.harness";
import { SHARES_OVERRIDE_KEY, type SharesEditState } from "./vavSheetShares";
import { KEYS3, REAL, withV79Items, withV79Keys, type V79Over } from "./vav2b1Keys.harness";

export { KEYS3, REAL, withV79Keys, type V79Over };
type Json = Record<string, unknown>;

/** the newest VAV config with the v78 keys and the next file's keys (a scratch copy) */
export const vav79 = (over: V79Over = {}) => withV79Keys(vav78(), over);

/** the items with the next file's new items; `over` sets (or with null removes) a Pricing Input's factor */
export function itemsV79(items: readonly RateMasterItem[] = withInputs(), over: Record<string, number | null> = {}): RateMasterItem[] {
  return withV79Items(items).flatMap((i) => {
    const id = /_pricing_input$/.test(String(i.kind)) ? String(i.attributes?.item ?? "") : "";
    if (!(id in over)) return [i];
    if (over[id] === null) return [];
    return [{ ...i, rates: { ...(i.rates as Json), factor: over[id] } } as unknown as RateMasterItem];
  });
}

/** the calculator's own construction (vav1Vav.harness `calc`) on this VAV config, with the shares' edits */
export function calc79(state: CalcState, shares: SharesEditState = {}, cfg: RateCategoryConfig = vav79(), items: RateMasterItem[] = itemsV79()): ItemListSuggestion {
  const m = surfaceMap();
  m.set(VAV, cfg);
  const h = makePricingSheetHelper({ configsByCategory: m, items, extractionByRow: new Map(), calculatorSurface: true });
  return h.compute(calculatorCtx("HVAC", VAV), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: "Nos",
    ...(Object.keys(shares).length ? { [SHARES_OVERRIDE_KEY]: JSON.stringify(shares) } : {}) }) as unknown as ItemListSuggestion;
}

/** a box row of a BoQ sheet with its reading (the three attributes the model answers in VAV-2b2; the stub here) */
export function box(qty: number | null, reading: { controller?: string; byOthers?: boolean; dp?: boolean } = {}, over: Record<string, string | number | null> = {}): SheetRow {
  return { qty, items: [boxItem({ controller_mention: reading.controller ?? "none", controller_by_others: reading.byOthers ? "Yes" : "No",
    dp_sensor_mention: reading.dp ? "Yes" : "No", ...over })] };
}
/** a row of another category on the sheet (a separate controller / router / DDC / DP row) */
export const other = (text: string, qty: number | null = 1, category = "hvac_misc", unit = "Nos"): SheetRow => ({ text, qty, category, unit });

/** the real row named `ref` as a row of a test sheet (its words, notes, unit, quantity and category as the BoQ has them) */
export function real(ref: string): SheetRow {
  const r = REAL.find((x) => x.ref === ref);
  if (!r) throw new Error(`no real row ${ref}`);
  return { text: r.description, ...(r.notes.length ? { rowNotes: r.notes.join(" | ") } : {}), qty: r.qty, unit: r.unit ?? "", category: r.category || "hvac_misc" };
}

/** a BoQ sheet priced with the next file's keys (the switch removed on the copy, as vav2a.harness `vavSheet`) */
export const sheet79 = (rows: Record<number, SheetRow>, over: V79Over = {}, items: RateMasterItem[] = itemsV79()) =>
  vavSheet(rows, { cfg: vav79(over), items });

export { ITEMS, VAV };
