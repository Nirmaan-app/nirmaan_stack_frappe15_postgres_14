/**
 * VAV-2c3 FIX-2 (ANSWER 22): a config of the newest file with v87's edits undone = what v86 held there, the twin of
 * services/boq_rate_master/vav2c3d_undo_support.py. `undoVav2c3c` applies it first, so every older comparison reads v87 as v86 (then v85 ...).
 * Driven by `__fixtures__/vav2c3dEdits.json` alone; a config holding neither v86's nor v87's values is refused. No other harness import (a jsdom test can
 * use it).
 */
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { undoVavfix } from "./vavfixEdits.harness";

type Edit = { c: string; p: Array<string | number>; from: unknown; to: unknown };
const EDITS87 = readJsonFixture<{ configs: Edit[] }>(pathToFileURL(path.resolve(__dirname, "__fixtures__/vav2c3dEdits.json")));
const MISSING = Symbol("missing");

const at = (cfg: unknown, p: ReadonlyArray<string | number>): unknown =>
  p.reduce<unknown>((n, k) => (n === MISSING || n === null || typeof n !== "object" || !(k in (n as object)) ? MISSING : (n as Record<string | number, unknown>)[k]), cfg);
const holds = (cfg: unknown, e: Edit, v: unknown): boolean => {
  const have = at(cfg, e.p);
  return v === null ? have === MISSING : have !== MISSING && JSON.stringify(have) === JSON.stringify(v);
};

/** PURE. `cfg` with v87's edits undone; a v86 (or older) config comes back as it is; one holding some but not all of v87's values throws. A key v87
 *  REMOVES is absent from older files too, so it never counts as a sign of v87. */
export function undoVav2c3d(cfg0: RateCategoryConfig): RateCategoryConfig {
  // VAV-FIX (PIN VAVFIX F-B, accepted ANSWER 3): v88's edits undone first, so a v88 config reads as v86 (and on down the chain)
  const cfg = undoVavfix(cfg0);
  const id = (cfg as unknown as { category_id: string }).category_id;
  const mine = EDITS87.configs.filter((e) => e.c === id);
  if (!mine.length || mine.every((e) => holds(cfg, e, e.from)) || !mine.some((e) => e.to !== null && holds(cfg, e, e.to))) return cfg;
  if (!mine.every((e) => holds(cfg, e, e.to))) throw new Error(`undoVav2c3d: ${id} holds neither v86's nor v87's values`);
  const out = structuredClone(cfg) as unknown as Record<string | number, unknown>;
  for (const e of [...mine].reverse()) {
    const parent = e.p.slice(0, -1).reduce<Record<string | number, unknown>>((n, k) => n[k] as Record<string | number, unknown>, out);
    const last = e.p[e.p.length - 1];
    if (e.from === null) delete parent[last]; else parent[last] = structuredClone(e.from);
  }
  return out as unknown as RateCategoryConfig;
}
