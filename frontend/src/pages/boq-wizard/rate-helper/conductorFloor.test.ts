/**
 * ELR-4d (owner R-3C-CALC, 2026-10-29: "One shared floor (the TS twin of apply_conductor_floor)") -- the TS floor on the table
 * `test_conductor_floor_parity.py` runs the server's floor on. Both must equal the one table, so the two agree.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ELECTRICAL_CONFIGS } from "@/pages/pricing/electricalRuleCases";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { applyConductorFloor, conductorFloorGroups, type ConductorWire } from "./conductorFloor";

interface FloorCase { id: string; groups?: Record<string, ConductorWire[]>; inputs: Record<string, string | number>; raised: Record<string, number> }
const TABLE = readJsonFixture<{ groups: Record<string, ConductorWire[]>; cases: FloorCase[] }>(pathToFileURL(path.resolve(__dirname, "__fixtures__", "conductorFloorCases.json")));

describe("the TS floor = the table the Python floor is pinned to", () => {
  it("the table covers every case the ruling names", () => {
    expect(TABLE.cases.length).toBeGreaterThanOrEqual(20);
    for (const needed of ["single-core 1 run", "two single-core wires: the bigger", "every wire multi-core", "never reduced", "circuit wires", "no free slot"]) {
      expect(TABLE.cases.some((c) => c.id.includes(needed)), needed).toBe(true);
    }
  });

  it.each(TABLE.cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const got = applyConductorFloor((id) => c.inputs[id] ?? null, c.groups ?? TABLE.groups);
    expect(Object.fromEntries(got)).toEqual(c.raised);
  });
});

describe("the groups come from the config", () => {
  it("point wiring's two groups, in definition order -- the table's", () => {
    expect(conductorFloorGroups(ELECTRICAL_CONFIGS.get("point_wiring")!)).toEqual(TABLE.groups);
  });

  it("NEGATIVE: every other Electrical config declares none, so the floor is inert there", () => {
    for (const [id, cfg] of ELECTRICAL_CONFIGS) if (id !== "point_wiring") expect(conductorFloorGroups(cfg), id).toEqual({});
  });
});
