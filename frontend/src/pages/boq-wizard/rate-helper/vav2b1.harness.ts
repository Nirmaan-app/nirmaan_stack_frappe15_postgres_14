/**
 * VAV-2b1: the next HVAC rate file's keys (vav2b1Keys.harness.ts) applied to a SCRATCH COPY of the newest asset's VAV config and items,
 * so the vav2b1* tests run the same before the mint (keys applied here) and after it (keys already there; applying them again changes
 * nothing). The asset file is never written. Shared by the vav2b1* node tests (the jsdom test uses vav2b1Keys.harness.ts directly).
 */
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { ITEMS, VAV, surfaceMap, type CalcState } from "./vav1Vav.harness";
import { boxItem, vavSheet, withInputs, type SheetRow } from "./vav2a.harness";
import { SHARES_OVERRIDE_KEY, type SharesEditState } from "./vavSheetShares";
import { KEYS3, KEYS80, REAL, withV79Items, withV79Keys, withV80Keys, withV80Sensors, type V79Over } from "./vav2b1Keys.harness";
import { V78, assetByName } from "./v78ByName.harness";

export { KEYS3, KEYS80, REAL, withV79Keys, withV80Keys, withV80Sensors, type V79Over };
type Json = Record<string, unknown>;

/** HVAC v78's VAV config READ BY FILE NAME (sha256 1cabaea4...) -- a scratch copy. VAV-2b1 K2 (PIN 17): the base of `vav79` and the v78
 *  side of T3, so neither depends on which file is newest (BEFORE: `vav78()` = the newest config + the v78 keys, which on v79 is a hybrid) */
export const vav78file = (): RateCategoryConfig => structuredClone(V78.byId.get(VAV)!);
/** the v78 FILE's VAV config with the next file's keys (a scratch copy) = what the v79 mint wrote (pinned in vav2b1Rules) */
export const vav79 = (over: V79Over = {}) => withV79Keys(vav78file(), over);

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
  const h = makePricingSheetHelper({ configsByCategory: m, items, extractionByRow: new Map() });
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

/** VAV-2b1 v80 (owner 2026-11-21 01:07 / 01:09): v79's VAV config + the full-rate add (`withV80Keys`), and the Sensors config with the
 *  Duct Static Pressure Sensor family (`withV80Sensors`) -- scratch copies of the v79 keys on the v78 FILE, so they run the same before and
 *  after the v80 mint */
export const vav80 = (over: Parameters<typeof withV80Keys>[1] = {}) => withV80Keys(vav79(), over);
/** the v79 FILE (by name, sha256 a5e43564...) -- the base of v80's Sensors config */
export const V79 = assetByName("rate_master_hvac_all_v79.json", "a5e43564");
export const sens80 = () => withV80Sensors(structuredClone(V79.byId.get("hvac_sensors")!));

/** the calculator on v80's VAV and Sensors configs */
export function calc80(state: CalcState, shares: SharesEditState = {}, cfg: RateCategoryConfig = vav80(), items: RateMasterItem[] = itemsV79()): ItemListSuggestion {
  const m = surfaceMap();
  m.set(VAV, cfg);
  m.set("hvac_sensors", sens80());
  const h = makePricingSheetHelper({ configsByCategory: m, items, extractionByRow: new Map() });
  return h.compute(calculatorCtx("HVAC", VAV), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: "Nos",
    ...(Object.keys(shares).length ? { [SHARES_OVERRIDE_KEY]: JSON.stringify(shares) } : {}) }) as unknown as ItemListSuggestion;
}

/** a BoQ sheet priced with v80's VAV and Sensors configs */
export const sheet80 = (rows: Record<number, SheetRow>, over: Parameters<typeof withV80Keys>[1] = {}, items: RateMasterItem[] = itemsV79()) =>
  vavSheet(rows, { cfg: vav80(over), items, also: [sens80()] });
