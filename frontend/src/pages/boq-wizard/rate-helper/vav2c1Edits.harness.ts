/**
 * VAV-2c1: the edits that turn HVAC v81 into v82 (`__fixtures__/vav2c1Edits.json`) and how one config takes them -- no other harness import, so a
 * jsdom test can use it. Pinned equal to the mint's `apply_config` by vav2c1's MINT PARITY test.
 */
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

export type ConfigEdit = { c: string; p: Array<string | number>; from: unknown; to: unknown; why: string };
export type InputText = { item: string; unit?: [string, string]; remarks?: [string, string]; name?: [string, string] };
export const EDITS = readJsonFixture<{ configs: ConfigEdit[]; pricing_inputs: Record<string, InputText> }>(pathToFileURL(path.resolve(__dirname, "__fixtures__/vav2c1Edits.json")));

/** one config with its edits applied, as the mint's `apply_config` (an edit whose `from` the copy does not hold is refused) */
export function applyConfig(cfg: RateCategoryConfig, edits: readonly ConfigEdit[]): RateCategoryConfig {
  const c = structuredClone(cfg);
  for (const e of edits) {
    let node = c as unknown as Record<string | number, unknown>;
    for (const p of e.p.slice(0, -1)) node = node[p] as Record<string | number, unknown>;
    const last = e.p[e.p.length - 1];
    if (JSON.stringify(node[last] ?? null) !== JSON.stringify(e.from)) throw new Error(`edit ${e.c} ${e.p.join("/")}: the file holds ${JSON.stringify(node[last] ?? null)}`);
    if (e.to === null) delete node[last]; else node[last] = structuredClone(e.to);
  }
  return c;
}
