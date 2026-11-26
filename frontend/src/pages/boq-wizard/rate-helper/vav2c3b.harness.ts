/**
 * VAV-2c3 FIX (PIN FIX-0, ANSWER 9 / 10): HVAC v85's edits (ONE file, `__fixtures__/vav2c3bEdits.json`, also read by the v85 mint script) applied to
 * SCRATCH COPIES of the v84 FILE (read by name, sha256 9c6b87f9...), so the tests run the same before the v85 mint and after it.
 */
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { assetByName } from "./v78ByName.harness";
import { applyConfig, type ConfigEdit } from "./vav2c1Edits.harness";

export const EDITS85 = readJsonFixture<{ configs: ConfigEdit[]; pricing_inputs: Record<string, never> }>(pathToFileURL(path.resolve(__dirname, "__fixtures__/vav2c3bEdits.json")));
/** the v84 FILE by name -- the base of v85 */
export const V84 = assetByName("rate_master_hvac_all_v84.json", "9c6b87f9");
export const ITEMS84: RateMasterItem[] = V84.items.map((i) => (i.brand ? { ...i, attributes: { ...i.attributes, brand: i.brand } } as RateMasterItem : i));
/** a category's v85 config; `drop` leaves edits out (vacuity) */
export const cfg85 = (cat: string, drop: (e: ConfigEdit) => boolean = () => false): RateCategoryConfig =>
  applyConfig(V84.byId.get(cat)!, EDITS85.configs.filter((e) => e.c === cat && !drop(e)));
export const byId85 = (): Map<string, RateCategoryConfig> => new Map([...V84.byId.keys()].map((k) => [k, cfg85(k)]));
