/**
 * SLICE 12c commit 3 -- the two pure rules, as the tables the design demonstrated them on.
 *
 * Both tables are the CATALOGUE's own numbers, so a rung that moves in a later mint moves these
 * fixtures too and the pin stays about the RULE rather than about one asset.
 */
import { describe, it, expect } from "vitest";
import { roundHalfUp, resolveSize, collisionFree, composeSize } from "./ladderResolution";

/** The pipe sizes the HVAC Insulation catalogue stocks -- the union across its two piped families. */
const NITRILE = [6.35, 9.52, 12.7, 15.88, 19.05, 22.23, 28.58, 34.93, 41.28, 53.98];
const PUF = [25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300];
const ALL = [...NITRILE, ...PUF].sort((a, b) => a - b);

const DP2: { dp: number[] } = { dp: [2, 1] };

describe("roundHalfUp", () => {
  it("lands 7/8\" on 22.23 where toFixed drops it to 22.22", () => {
    const seven_eighths = (7 / 8) * 25.4;
    // the trap, stated as a fact about the platform rather than assumed
    expect(seven_eighths.toFixed(2)).toBe("22.22");
    expect(roundHalfUp(seven_eighths, 2)).toBe(22.23);
  });

  it("rounds half away from zero and leaves an exact value alone", () => {
    expect(roundHalfUp(22.225, 2)).toBe(22.23);
    expect(roundHalfUp(22.224, 2)).toBe(22.22);
    expect(roundHalfUp(19.05, 2)).toBe(19.05);
    expect(roundHalfUp(19.05, 1)).toBe(19.1);
    expect(roundHalfUp(-2.5, 0)).toBe(-3);
    expect(roundHalfUp(NaN, 2)).toBeNaN();
  });
});

describe("resolveSize -- the D4 table", () => {
  const cases: Array<[string, number, number[], number | null]> = [
    // stated,                        value,      rungs,    expected rung (null = fall through to the ladder)
    ["22.2 mm on Nitrile", 22.2, NITRILE, 22.23],
    ["22.23 mm on Nitrile", 22.23, NITRILE, 22.23],
    ["7/8\" on Nitrile", (7 / 8) * 25.4, NITRILE, 22.23],
    ["1-3/8\" on Nitrile", (1 + 3 / 8) * 25.4, NITRILE, 34.93],
    ["6.35 mm on Nitrile", 6.35, NITRILE, 6.35],
    ["6.4 mm on Nitrile", 6.4, NITRILE, 6.35],
    ["19.05 mm on Nitrile", 19.05, NITRILE, 19.05],
    ["19.1 mm on Nitrile", 19.1, NITRILE, 19.05],
    ["20 mm NB on Nitrile", 20, NITRILE, null], // not a rung at either depth -- the LADDER buys 22.23
    ["25 mm NB on Nitrile", 25, NITRILE, null], // Nitrile has no 25 -- the ladder buys 28.58
    ["25 mm NB on Puf", 25, PUF, 25],
    ["100 mm on Nitrile", 100, NITRILE, null], // above the largest -- the ladder refuses
    ["100 mm on Puf", 100, PUF, 100],
    ["350 mm on Puf", 350, PUF, null],
  ];
  for (const [label, stated, rungs, want] of cases) {
    it(label + " -> " + String(want), () => {
      const got = resolveSize(stated, rungs, DP2);
      expect(got ? got.rung : null).toBe(want);
    });
  }

  it("reports `exact` only when the stated value already equalled the rung", () => {
    expect(resolveSize(22.23, NITRILE, DP2)!.exact).toBe(true);
    expect(resolveSize(22.2, NITRILE, DP2)!.exact).toBe(false);
    expect(resolveSize(22.2, NITRILE, DP2)!.dp).toBe(1);
    expect(resolveSize(22.23, NITRILE, DP2)!.dp).toBe(2);
  });

  it("NEGATIVE: ABSENT spec resolves nothing, so a category that declares none is unchanged", () => {
    expect(resolveSize(22.2, NITRILE, undefined)).toBeNull();
    expect(resolveSize(22.2, NITRILE, null)).toBeNull();
    expect(resolveSize(22.2, NITRILE, { dp: [] })).toBeNull();
  });

  it("the catalogue's 22 sizes are collision-free at BOTH depths, so neither pass can match two rungs", () => {
    expect(ALL.length).toBe(22);
    expect(new Set(ALL).size).toBe(22);
    expect(collisionFree(ALL, 2)).toBe(true);
    expect(collisionFree(ALL, 1)).toBe(true);
  });

  it("NEGATIVE: a depth that is NOT collision-free is SKIPPED, never resolved arbitrarily", () => {
    const clashing = [10.04, 10.01]; // both 10.0 at 1 dp
    expect(collisionFree(clashing, 1)).toBe(false);
    expect(collisionFree(clashing, 2)).toBe(true);
    // at 2 dp it still resolves; at 1 dp alone it must fall through rather than pick one
    expect(resolveSize(10.04, clashing, { dp: [2] })!.rung).toBe(10.04);
    expect(resolveSize(10.0, clashing, { dp: [1] })).toBeNull();
  });
});

describe("composeSize -- the D2 table", () => {
  const RUNGS = [13, 19, 25]; // Nitrile Rubber's stocked thicknesses
  const SPEC = { tolerance: 2, max_layers: 4 };

  const cases: Array<[number, number[], number]> = [
    [30, [19, 13], 2], //  above 25 -> 13 + 19 = 32 (+2)
    [26, [13, 13], 0], //  the owner's refused exception: NEVER a single 25
    [38, [19, 19], 0],
    [44, [25, 19], 0],
    [50, [25, 25], 0],
    [100, [25, 25, 25, 25], 0],
  ];
  for (const [stated, layers, delta] of cases) {
    it(`${stated} mm composes as ${layers.join(" + ")} (${delta >= 0 ? "+" : ""}${delta})`, () => {
      const got = composeSize(stated, RUNGS, SPEC)!;
      expect(got.layers).toEqual(layers);
      expect(got.delta).toBe(delta);
    });
  }

  it("NEGATIVE: 26 mm is NEVER a single 25 -- a composition carries at least two layers", () => {
    const got = composeSize(26, RUNGS, SPEC)!;
    expect(got.layers.length).toBeGreaterThanOrEqual(2);
    expect(got.layers).not.toEqual([25]);
    // and the rule holds for every stated value the search can reach
    for (let s = 26; s <= 100; s++) {
      const c = composeSize(s, RUNGS, SPEC);
      if (c) expect(c.layers.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("NEGATIVE: a spec that forbids two layers composes nothing at all", () => {
    expect(composeSize(26, RUNGS, { tolerance: 2, max_layers: 1 })).toBeNull();
    expect(composeSize(26, RUNGS, undefined)).toBeNull();
    expect(composeSize(26, RUNGS, null)).toBeNull();
  });

  it("NEGATIVE: a value no multiset reaches within the tolerance still refuses", () => {
    expect(composeSize(29, RUNGS, { tolerance: 0, max_layers: 4 })).toBeNull(); // 26/32/38 all miss
    expect(composeSize(1000, RUNGS, SPEC)).toBeNull(); // beyond 4 x 25
  });

  it("prefers FEWEST layers, then closest, and is independent of the rung array's order", () => {
    // 50 is reachable as 25+25 (2 layers, +0) and as 13+19+19 (3 layers, +1): fewest wins
    expect(composeSize(50, RUNGS, SPEC)!.layers).toEqual([25, 25]);
    const shuffled = [25, 13, 19];
    for (const s of [26, 30, 38, 44, 50, 100]) {
      expect(composeSize(s, shuffled, SPEC)).toEqual(composeSize(s, RUNGS, SPEC));
    }
  });
});
