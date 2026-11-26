/**
 * VAV-2c1 T6: the Derivation tab on v82 (its edits on scratch copies of the v81 file) -- coverage for VAV Box and every category whose texts
 * lost their labels. MISSING / ORPHAN / UNREASONED / WRONG: no category is worse than on v81, and VAV Box, Ducting, Valve Package and Misc
 * stay at 0. A reason's text only ever lost a label, so every reason still shows on the same line (the DEAD list is v81's own).
 */
import { describe, expect, it } from "vitest";
import { derivationCoverage } from "../../pricing/rate-master/derivationCoverage";
import { V81, VAV, cfg82, items82 } from "./vav2c1.harness";

type Sec = { list_spec?: { sections?: Array<{ category_id?: string }> } };
const CATS = ["hvac_adp", "hvac_insulation", "hvac_vrf", "hvac_valve_package", "hvac_misc", "hvac_ducting", VAV, "hvac_piping", "hvac_sensors"];
// the borrow-only categories: the Derivation tab of the category that borrows them carries their lines
const BORROW = ["hvac_misc", "hvac_sensors"];
const cov = (cat: string, v82: boolean) => {
  const of = (c: string) => (v82 ? cfg82(c) : V81.byId.get(c)!);
  const cfg = of(cat);
  const ids = ((cfg as unknown as Sec).list_spec?.sections ?? []).map((s) => String(s?.category_id ?? "")).filter((c) => BORROW.includes(c));
  return derivationCoverage(cfg as never, (v82 ? items82() : V81.items) as never, Object.fromEntries(ids.map((c) => [c, of(c)])) as never);
};
const counts = (r: ReturnType<typeof cov>) => [r.missing.length, r.orphan.length, r.unreasoned.length, r.wrong.length, r.dead.length];

describe("T6 Derivation coverage on v82", () => {
  for (const cat of CATS) it(`${cat}: the same counts as on v81 (missing / orphan / unreasoned / wrong / dead)`, () => {
    const a = cov(cat, false), b = cov(cat, true);
    expect(counts(b)).toEqual(counts(a));
    expect(b.lines.length).toBe(a.lines.length);
    expect(b.dead.map((x) => x.split(" ")[1])).toEqual(a.dead.map((x) => x.split(" ")[1]));
  });
  it("VAV Box, Ducting, Valve Package, Misc and Sensors: missing / orphan / wrong 0", () => {
    for (const cat of [VAV, "hvac_ducting", "hvac_valve_package", "hvac_misc", "hvac_sensors"]) {
      const r = cov(cat, true);
      expect([cat, r.missing, r.orphan, r.wrong]).toEqual([cat, [], [], []]);
    }
    expect(cov(VAV, true).unreasoned).toEqual([]);
    expect(cov(VAV, true).dead).toEqual([]);
  });
  it("VACUITY: a reason whose title stops matching its line is DEAD", () => {
    const c = structuredClone(cfg82(VAV)) as unknown as { list_spec: { pricing: { derivation_reasons: Array<{ title: string; why: string }> } } };
    c.list_spec.pricing.derivation_reasons[0].title = "^a line no rule writes";
    const r = derivationCoverage(c as never, items82() as never, { hvac_misc: cfg82("hvac_misc"), hvac_sensors: cfg82("hvac_sensors") } as never);
    expect(r.dead.length).toBeGreaterThan(0);
  });
});
