/**
 * ELR-4d (owner R-3C 2026-09-03, "rule still stands" 2026-10-28; R-3C-CALC 2026-10-29 "1 option ii"). PURE. THE SHARED
 * CONDUCTOR FLOOR -- the TS twin of `extraction.apply_conductor_floor`, which raises what the AI read. This one runs over
 * the EFFECTIVE values (a typed value, else the stored cell, else a default) on the BoQ panel and the calculator, both
 * through `makePricingSheetHelper(...).compute`, so there is one arithmetic on the two screens.
 *
 * THE RULE, the server's, per declared group: conductors = core x runs, summed across the wires that EXIST (a wire exists
 * when its THICKNESS is a number; its runs default is not a conductor). At or above three -> untouched, nothing is ever
 * reduced. Below -> the runs of a single-core wire take the shortfall (the bigger one when there are two, the first on a
 * tie); every wire multi-core -> a 1-core wire of the same size is added on the free slot, carrying the shortfall; no free
 * slot -> left as it is. `__fixtures__/conductorFloorCases.json` holds the table both languages must agree on
 * (test_conductor_floor_parity.py on the Python side, conductorFloor.test.ts here).
 *
 * CONFIG-DRIVEN, naming no category: a wire opts in by `conductor_floor` on its thickness definition (read through
 * `unknown`: the key is not on the AttributeDefinition type).
 */
import type { AttributeDefinition, RateCategoryConfig } from "@/pages/pricing/rate-master/rateMasterTypes";

const CONDUCTOR_FLOOR = 3;
const NONE_SENTINEL = "None";

/** The note on a raised field (owner R-3C-CALC: "raised to three conductors"). */
export const CONDUCTOR_FLOOR_NOTE = "Raised to three conductors.";

/** Does this field show a value the floor raised? (The panel selects such a box's text on focus: its value is not one the
 *  pricer typed, so typing replaces it -- a click and "1" on a computed 3 must not make "31".) */
export function isFloorRaised(a: { notes?: ReadonlyArray<{ kind: string; how?: string }> }): boolean {
  return (a.notes ?? []).some((n) => n.kind === "landed" && n.how === CONDUCTOR_FLOOR_NOTE);
}

/**
 * ELR-4d (owner P6 "Q7 b"): what a number box shows. A box the floor has raised keeps what the pricer is typing while it has
 * focus ("1" on the way to "12" must not turn into "3" and then "32"); the raised value shows once focus leaves. Any other
 * box, and a raised box nobody is typing in, shows `shown`. The figure beside it is priced on the raised value throughout.
 */
export function floorBoxValue(
  a: { id: string; notes?: ReadonlyArray<{ kind: string; how?: string }> },
  shown: string,
  typing: { id: string; text: string } | null,
): string {
  if (isFloorRaised(a) && typing?.id === a.id) return typing.text;
  return shown === NONE_SENTINEL ? "" : shown;
}

/** One wire: its thickness, core and runs attribute ids. */
export type ConductorWire = readonly [thickness: string, core: string, runs: string];

/** {group: [wire, ...]} in DEFINITION ORDER (`extraction.conductor_floor_groups`): it decides which wire is "wire 1". */
export function conductorFloorGroups(config: RateCategoryConfig): Record<string, ConductorWire[]> {
  const out: Record<string, ConductorWire[]> = {};
  for (const d of (config.attribute_definitions ?? []) as AttributeDefinition[]) {
    const spec = (d as unknown as { conductor_floor?: unknown }).conductor_floor;
    if (spec === null || typeof spec !== "object") continue;
    const { group, core_attr: core, runs_attr: runs } = spec as { group?: unknown; core_attr?: unknown; runs_attr?: unknown };
    if (typeof group !== "string" || !group || typeof core !== "string" || !core || typeof runs !== "string" || !runs) continue;
    (out[group] ??= []).push([d.id, core, runs]);
  }
  return out;
}

/** A cell's number, or `dflt`: blank and "None" are absence, not numbers (`extraction._cf_num`). */
function floorNum(v: string | number | null | undefined, dflt: number | null): number | null {
  if (v === null || v === undefined || v === "" || v === NONE_SENTINEL) return dflt;
  const f = Number(v);
  return Number.isNaN(f) ? dflt : f;
}

/** The attributes the floor changes -> their new values; empty when nothing moves. `valueOf` is the effective value. */
export function applyConductorFloor(
  valueOf: (id: string) => string | number | null | undefined,
  groups: Record<string, readonly ConductorWire[]>,
): Map<string, number> {
  const raised = new Map<string, number>();
  for (const wires of Object.values(groups)) {
    const present = wires.flatMap((w, idx) => {
      const thickness = floorNum(valueOf(w[0]), null);
      if (thickness === null) return [];
      return [{ idx, w, thickness, core: floorNum(valueOf(w[1]), 1) || 1, runs: floorNum(valueOf(w[2]), 1) || 1 }];
    });
    if (!present.length) continue;
    const total = present.reduce((sum, p) => sum + p.core * p.runs, 0);
    if (total >= CONDUCTOR_FLOOR) continue;
    const need = CONDUCTOR_FLOOR - total;
    const singles = present.filter((p) => p.core === 1);
    if (singles.length) {
      const target = singles.reduce((best, p) => (p.thickness > best.thickness ? p : best));
      raised.set(target.w[2], target.runs + need);
      continue;
    }
    const free = wires.find((w) => !present.some((p) => p.w[0] === w[0]));
    if (!free) continue;
    raised.set(free[0], present[0].thickness);
    raised.set(free[1], 1);
    raised.set(free[2], need);
  }
  return raised;
}
