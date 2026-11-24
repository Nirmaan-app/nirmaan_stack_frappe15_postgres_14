/**
 * VAV-FIX (2026-11-25; the final fix slice of the VAV Box build): HVAC v88's edits (ONE file, `__fixtures__/vavfixEdits.json`, also read by the
 * v88 mint script) applied to SCRATCH COPIES of the v87 FILE (read by name, sha256 1a98fe23...), so the tests run the same before the v88 mint and
 * after it. `calc88` is the Calculator's own construction (vav1Vav.harness `calc`); `sheet88` prices a BoQ sheet through the panel's own helper with
 * the PAGE's context (vav2c3c.harness `sheet86`, the row's chain included).
 */
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import type { ItemListSuggestion } from "./pricingSheetHelper";
import { VAV, calc, surfaceMap, type CalcState } from "./vav1Vav.harness";
import { assetByName } from "./v78ByName.harness";
import { applyConfig, type ConfigEdit } from "./vav2c1Edits.harness";
import { sheet86, type Row86 } from "./vav2c3c.harness";

export { VAV };
export type { Row86 };
export const EDITS88 = readJsonFixture<{ configs: ConfigEdit[]; pricing_inputs: Record<string, never> }>(pathToFileURL(path.resolve(__dirname, "__fixtures__/vavfixEdits.json")));
/** the v87 FILE by name -- the base of v88 */
export const V87 = assetByName("rate_master_hvac_all_v87.json", "1a98fe23");
export const ITEMS87: RateMasterItem[] = V87.items.map((i) => (i.brand ? { ...i, attributes: { ...i.attributes, brand: i.brand } } as RateMasterItem : i));
/** a category's v88 config; `drop` leaves edits out (vacuity) */
export const cfg88 = (cat: string, drop: (e: ConfigEdit) => boolean = () => false): RateCategoryConfig =>
  applyConfig(V87.byId.get(cat)!, EDITS88.configs.filter((e) => e.c === cat && !drop(e)));
export const cfg87 = (cat: string): RateCategoryConfig => V87.byId.get(cat)!;
const mapWith = (vav: RateCategoryConfig) => { const m = surfaceMap([], V87.byId); m.set(VAV, vav); return m; };

/** the Calculator (no row), VAV Box picked, the row unit Nos, on v88's VAV config (or `cfg`) */
export const calc88 = (state: CalcState, cfg: RateCategoryConfig = cfg88(VAV)): ItemListSuggestion => calc(state, mapWith(cfg), ITEMS87);
/** a BoQ sheet priced on v88's VAV config (or `cfg`) with the page's context */
export const sheet88 = (rows: Record<number, Row86>, cfg: RateCategoryConfig = cfg88(VAV)) => sheet86(rows, cfg);
