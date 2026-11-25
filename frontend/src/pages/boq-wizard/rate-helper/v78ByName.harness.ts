/**
 * VAV-2b1 (ANSWER 10, PIN 1 - 3; chat-Claude 2026-11-20 20:33 "(P-a)"): an HVAC rate file READ BY ITS FILE NAME, never the newest one --
 * TEST-ONLY. The reader asserts the file it was asked for exists and that its sha256 starts with the expected prefix, so it can never
 * fall back to another file. It offers the same calls the VAV harnesses offer on the newest asset (`calc`, `calcWith`, `vavWith`,
 * `calc78`), built on THAT file's configs and items, so a test of a past file's behaviour changes only the reader it calls.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import type { ItemListSuggestion } from "./pricingSheetHelper";
import { VAV, calc as calcOn, surfaceMap, type CalcState } from "./vav1Vav.harness";
import { KEYS, withInputs } from "./vav2a.harness";
import { withV78Keys } from "./vav2a2.harness";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");

/** The asset `file` (by name, in the rate-file folder), refused unless its sha256 starts with `sha256Prefix`. */
export function assetByName(file: string, sha256Prefix: string) {
  const p = path.join(DATA, file);
  if (!existsSync(p)) throw new Error(`assetByName: no rate file named ${file}`);
  const sha = createHash("sha256").update(readFileSync(p)).digest("hex");
  if (!sha.startsWith(sha256Prefix)) throw new Error(`assetByName: ${file} has sha256 ${sha.slice(0, 16)}, not ${sha256Prefix}...`);
  const a = readJsonFixture<Asset>(pathToFileURL(p));
  const items: RateMasterItem[] = a.items.map((i) => ({ ...i, discipline: "HVAC", attributes: { ...i.attributes } } as RateMasterItem));
  const byId = new Map<string, RateCategoryConfig>(a.category_configs.map((c) => [c.category_id, c]));
  const map = (cfg?: RateCategoryConfig) => { const m = surfaceMap([], byId); if (cfg) m.set(VAV, cfg); return m; };
  const pricingOf = (c: RateCategoryConfig) => (c as unknown as { list_spec: { pricing: Record<string, unknown> } }).list_spec.pricing;
  return {
    file, sha256: sha, items, byId,
    /** vav1Vav.harness `calc` on this file's configs and items */
    calc: (state: CalcState, unit = "Nos"): ItemListSuggestion => calcOn(state, map(), items, unit),
    /** vav2a.harness `vavWith` on this file's VAV config (pricing keys set / removed with `undefined`) */
    vavWith: (pricing: Record<string, unknown> = {}): RateCategoryConfig => {
      const c = structuredClone(byId.get(VAV)!);
      const pr = pricingOf(c);
      for (const [k, v] of Object.entries(pricing)) { if (v === undefined) delete pr[k]; else pr[k] = structuredClone(v); }
      return c;
    },
    /** vav2a.harness `calcWith` on this file's calculator map and items (+ the VAV-2a inputs the file already carries) */
    calcWith: (cfg: RateCategoryConfig, state: CalcState, unit = "Nos"): ItemListSuggestion => calcOn(state, map(cfg), withInputs(items), unit),
    /** vav2a2.harness `vav78(over)` on this file's VAV config (the v78 keys, already there in v78; `over` as vav78's) */
    cfg78: (over: Parameters<typeof withV78Keys>[1] = {}): RateCategoryConfig => withV78Keys(byId.get(VAV)!, over),
    /** vav2a2Band `calc78` on this file: its VAV config with the v78 keys (already there in v78; applying them again changes nothing) */
    calc78: (its: CalcState["items"], sections?: CalcState["sections"]): ItemListSuggestion =>
      calcOn({ items: its, ...(sections ? { sections } : {}) }, map(withV78Keys(byId.get(VAV)!)), withInputs(items)),
  };
}

/** HVAC v78 by name (the file the VAV-2a / VAV-2a2 per-box-controller tests prove; sha256 1cabaea4...). */
export const V78 = assetByName("rate_master_hvac_all_v78.json", "1cabaea4");
export { KEYS };
