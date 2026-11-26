/**
 * VAV-2c2: HVAC v83's edits (ONE file, `__fixtures__/vav2c2Edits.json`, also read by the mint script) applied to SCRATCH COPIES of the v82
 * FILE (read by name, sha256 3c9dc559...), so the vav2c2 tests run the same before the v83 mint and after it. The asset files are never written.
 */
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { assetByName } from "./v78ByName.harness";
import { applyConfig, type ConfigEdit } from "./vav2c1Edits.harness";

export const EDITS83 = readJsonFixture<{ configs: ConfigEdit[]; pricing_inputs: Record<string, never> }>(pathToFileURL(path.resolve(__dirname, "__fixtures__/vav2c2Edits.json")));
/** the v82 FILE by name -- the base of v83 */
export const V82 = assetByName("rate_master_hvac_all_v82.json", "3c9dc559");
/** the items as the app hands them on: a brand sits among the item's attributes too */
export const ITEMS82: RateMasterItem[] = V82.items.map((i) => (i.brand ? { ...i, attributes: { ...i.attributes, brand: i.brand } } as RateMasterItem : i));

/** a category's v83 config; `drop` leaves edits out (vacuity) */
export const cfg83 = (cat: string, drop: (e: ConfigEdit) => boolean = () => false): RateCategoryConfig =>
  applyConfig(V82.byId.get(cat)!, EDITS83.configs.filter((e) => e.c === cat && !drop(e)));
/** every category's v83 config */
export const byId83 = (): Map<string, RateCategoryConfig> => new Map([...V82.byId.keys()].map((k) => [k, cfg83(k)]));
