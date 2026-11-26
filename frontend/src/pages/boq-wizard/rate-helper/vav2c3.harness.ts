/**
 * VAV-2c3: HVAC v84's edits (ONE file, `__fixtures__/vav2c3Edits.json`, also read by the mint script) applied to SCRATCH COPIES of the v83
 * FILE (read by name, sha256 bafd6d26...), so the vav2c3 tests run the same before the v84 mint and after it. The asset files are never written.
 */
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { assetByName } from "./v78ByName.harness";
import { applyConfig, type ConfigEdit } from "./vav2c1Edits.harness";

export const EDITS84 = readJsonFixture<{ configs: ConfigEdit[]; pricing_inputs: Record<string, never> }>(pathToFileURL(path.resolve(__dirname, "__fixtures__/vav2c3Edits.json")));
/** the v83 FILE by name -- the base of v84 */
export const V83 = assetByName("rate_master_hvac_all_v83.json", "bafd6d26");
/** the items as the app hands them on: a brand sits among the item's attributes too */
export const ITEMS83: RateMasterItem[] = V83.items.map((i) => (i.brand ? { ...i, attributes: { ...i.attributes, brand: i.brand } } as RateMasterItem : i));

/** a category's v84 config; `drop` leaves edits out (vacuity) */
export const cfg84 = (cat: string, drop: (e: ConfigEdit) => boolean = () => false): RateCategoryConfig =>
  applyConfig(V83.byId.get(cat)!, EDITS84.configs.filter((e) => e.c === cat && !drop(e)));
/** every category's v84 config */
export const byId84 = (): Map<string, RateCategoryConfig> => new Map([...V83.byId.keys()].map((k) => [k, cfg84(k)]));
