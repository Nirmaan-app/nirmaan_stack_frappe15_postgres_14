/**
 * VAV-2c1: the edits that turn HVAC v81 into v82 (`__fixtures__/vav2c1Edits.json`) and how one config takes them -- no other harness import, so a
 * jsdom test can use it. Pinned equal to the mint's `apply_config` by vav2c1's MINT PARITY test.
 */
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { undoVav2c2 } from "./vav2c2Edits.harness";

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

/** PURE. A category's config from the newest file with this slice's edits undone = what v81 held there (a test that compares an older file
 *  with the newest one reads through this). A config that does not hold v82's own texts (v81 or older) is returned as it is; a text of v82
 *  that is in the file is reversed edit by edit, and an edit whose new text is absent is refused -- nothing else can hide in the undo. */
export function undoVav2c1(cfg0: RateCategoryConfig): RateCategoryConfig {
  // VAV-2c2 K2 (PIN K2-B, ANSWER 24): v83's edits undone first, so a v83 config reads as v81 too
  const cfg = undoVav2c2(cfg0);
  const mine = EDITS.configs.filter((e) => e.c === (cfg as unknown as { category_id: string }).category_id);
  const holds = (e: ConfigEdit): unknown => e.p.reduce<unknown>((n, p) => (n as Record<string | number, unknown> | undefined)?.[p], cfg);
  const isV82 = mine.length > 0 && mine.every((e) => JSON.stringify(holds(e) ?? null) === JSON.stringify(e.to));
  const isV81 = mine.every((e) => JSON.stringify(holds(e) ?? null) === JSON.stringify(e.from));
  if (!mine.length || isV81) return cfg;
  if (!isV82) throw new Error(`undoVav2c1: ${(cfg as unknown as { category_id: string }).category_id} holds neither v81's nor v82's texts`);
  return applyConfig(cfg, [...mine].reverse().map((e) => ({ ...e, from: e.to, to: e.from })));
}
/** a Pricing Input's name in the file it came from (v82 renames one) */
export const inputName81 = (item: { item_uid?: unknown; attributes?: Record<string, unknown> | null }): string => {
  const ch = EDITS.pricing_inputs[String(item.item_uid)]?.name, n = String(item.attributes?.name ?? "");
  return ch && n === ch[1] ? ch[0] : n;
};
