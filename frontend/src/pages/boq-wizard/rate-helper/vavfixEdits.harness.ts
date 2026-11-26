/**
 * VAV-FIX (HVAC v88): a config of the newest file with v88's edits undone = what v87 held there, the twin of
 * services/boq_rate_master/vavfix_undo_support.py. `undoVav2c3d` applies it first, so every older comparison reads v88 as v87 (then v86 ...).
 * Driven by `__fixtures__/vavfixEdits.json` alone; a config holding neither v87's nor v88's values is refused. No other harness import (a jsdom test can
 * use it).
 */
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

type Edit = { c: string; p: Array<string | number>; from: unknown; to: unknown };
const EDITS88 = readJsonFixture<{ configs: Edit[] }>(pathToFileURL(path.resolve(__dirname, "__fixtures__/vavfixEdits.json")));
const MISSING = Symbol("missing");

const at = (cfg: unknown, p: ReadonlyArray<string | number>): unknown =>
  p.reduce<unknown>((n, k) => (n === MISSING || n === null || typeof n !== "object" || !(k in (n as object)) ? MISSING : (n as Record<string | number, unknown>)[k]), cfg);
const holds = (cfg: unknown, e: Edit, v: unknown): boolean => {
  const have = at(cfg, e.p);
  return v === null ? have === MISSING : have !== MISSING && JSON.stringify(have) === JSON.stringify(v);
};

/** PURE. `cfg` with v88's edits undone; a v87 (or older) config comes back as it is; one holding some but not all of v88's values throws. A key v88
 *  REMOVES is absent from older files too, so it never counts as a sign of v88. */
export function undoVavfix(cfg: RateCategoryConfig): RateCategoryConfig {
  const id = (cfg as unknown as { category_id: string }).category_id;
  const mine = EDITS88.configs.filter((e) => e.c === id);
  if (!mine.length || mine.every((e) => holds(cfg, e, e.from)) || !mine.some((e) => e.to !== null && holds(cfg, e, e.to))) return cfg;
  if (!mine.every((e) => holds(cfg, e, e.to))) throw new Error(`undoVavfix: ${id} holds neither v87's nor v88's values`);
  const out = structuredClone(cfg) as unknown as Record<string | number, unknown>;
  for (const e of [...mine].reverse()) {
    const parent = e.p.slice(0, -1).reduce<Record<string | number, unknown>>((n, k) => n[k] as Record<string | number, unknown>, out);
    const last = e.p[e.p.length - 1];
    if (e.from === null) delete parent[last]; else parent[last] = structuredClone(e.from);
  }
  return out as unknown as RateCategoryConfig;
}
