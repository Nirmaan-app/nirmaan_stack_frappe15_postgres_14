/**
 * VAV-2c1 R5 / T2 (owner 2026-11-22 10:58 / 11:02 "yes for both"): the working lines follow the row's scope -- on the Calculator and on the
 * helper panel, in every category whose scope declares `lines_follow`; the lines add up to the row total; NO row total moves under any
 * scope; a category without the key is unchanged.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig } from "../../pricing/rate-master/rateMasterTypes";
import { EXTRAS_INCLUDES_KEY, SCOPE_OVERRIDE_KEY, type ItemListView } from "./pricingSheetHelper";
import { lineFigures, workingWithoutSide } from "./scopeLines";
import { V81, VAV, calcOf, followed, pricedKinds, scopeOf, type CalcIn } from "./vav2c1.harness";
import { box81, sheet81 } from "./vav2b2.harness";

const CATS = [VAV, "hvac_ducting", "hvac_valve_package", "hvac_vrf"] as const;
const SCOPES = ["Supply only", "Installation only"] as const;
const sum = (v: ItemListView, k: "supply_rate" | "install_rate") => lineFigures(v).reduce((a, f) => a + (f[k] ?? 0), 0);
const blocksOf = (v: ItemListView) => [...v.items, ...v.items.flatMap((b) => (b.sections ?? []).flatMap((s) => s.view.items)), ...(v.sections?.independent ?? []).flatMap((s) => s.view.items)];
const linesOf = (v: ItemListView) => [...blocksOf(v), ...v.items.flatMap((b) => b.extras?.lines ?? [])].filter((b) => b.state === "priced");

/** one entry under the three scopes, with and without the key: what T2 asserts. Returns whether the line figures moved (non-vacuous). */
function checkEntry(cat: string, on: RateCategoryConfig, off: RateCategoryConfig, input: CalcIn, name: string): boolean {
  let moved = false;
  expect(JSON.stringify(calcOf(cat, on, input)), `${name}: supply + installation is untouched`).toBe(JSON.stringify(calcOf(cat, off, input)));
  for (const scope of SCOPES) {
    const a = calcOf(cat, on, { ...input, scope })!, b = calcOf(cat, off, { ...input, scope })!;
    expect(a.rowPriced, `${name} / ${scope}: priced`).toBe(b.rowPriced);
    expect(a.totals, `${name} / ${scope}: the row total`).toEqual(b.totals);
    expect(a.scope, `${name} / ${scope}: the scope note`).toEqual(b.scope);
    if (!a.rowPriced) { expect(JSON.stringify(a), `${name} / ${scope}: a refused row is untouched`).toBe(JSON.stringify(b)); continue; }
    expect([sum(a, "supply_rate"), sum(a, "install_rate")], `${name} / ${scope}: the lines add up`).toEqual([a.totals?.supply_rate, a.totals?.install_rate]);
    const out = scope === "Supply only" ? "install" : "supply";
    for (const l of linesOf(a)) {
      expect(l.figures[`${out}_rate`], `${name} / ${scope}: ${out} 0`).toBe(0);
      expect(l.notInScope, name).toEqual({ kind: `${out}_rate`, word: "not in scope" });
      expect(l.working.filter((w) => w === `${out}: 0 - not in scope`).length, `${name} / ${scope}: ${l.working.join(" | ")}`).toBe(1);
      expect(l.working.filter((w) => new RegExp(`^\\s*(item )?${out}\\s*:`, "i").test(w)).length, name).toBe(1);
    }
    for (const s of a.shares?.blocks ?? []) if (s.figures) expect(s.figures[`${out}_rate`], `${name} / ${scope}: share ${s.id}`).toBe(0);
    if (JSON.stringify([a.items, a.sections, a.shares]) !== JSON.stringify([b.items, b.sections, b.shares])) moved = true;
  }
  return moved;
}

describe("T2 every kind of each category, under each scope (the Calculator)", () => {
  // the counts are what each catalogue gives; a smaller one means the loop went blind
  const expected: Record<string, number> = { [VAV]: 7, hvac_ducting: 4, hvac_valve_package: 13, hvac_vrf: 18 };
  for (const cat of CATS) {
    it(`${cat}: lines add up to the row total, the total is the same with and without the key, refused rows untouched`, () => {
      const off = followed(V81.byId.get(cat)!, false), on = followed(off, true);
      const kinds = pricedKinds(cat, off);
      // EVERY kind of the category is in the loop
      const all = Object.keys((off as unknown as { list_spec: { pricing: { families: Record<string, unknown> } } }).list_spec.pricing.families);
      expect(all.filter((f) => !kinds.has(f)), "kinds the loop could not price").toEqual([]);
      expect(kinds.size).toBe(expected[cat]);
      let moved = 0;
      for (const [fam, input] of kinds) if (checkEntry(cat, on, off, input, `${cat} ${fam}`)) moved++;
      expect(moved, "VACUITY: the key changes the lines of these kinds").toBeGreaterThanOrEqual(Math.floor(expected[cat] / 2));
    }, 120_000);
  }
});

const VAVBOX = { base: null, family: "VAV box", attrs: { shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "700" } };
/** a box with three extras (a conical piece x 2, a thermostat, a BACnet share of 17 VAVs) */
function entries0(): CalcIn {
  return { state: { items: [VAVBOX, { base: null, family: "Conical piece", attrs: {}, qty: "2" }], sections: { misc: [{ base: null, family: "Digital Thermostat", attrs: {} }] } }, unit: "Nos", shares: { bacnet: { added: true, set: { vavs: "17" } } } };
}
describe("T2 rows of several lines: borrowed items, shared items, extras", () => {
  const entries: Array<[string, string, CalcIn]> = [
    [VAV, "box + conical x2 + thermostat + BACnet share", { state: { items: [VAVBOX, { base: null, family: "Conical piece", attrs: {}, qty: "2" }], sections: { misc: [{ base: null, family: "Digital Thermostat", attrs: {} }] } }, unit: "Nos", shares: { bacnet: { added: true, set: { vavs: "17" } } } }],
    [VAV, "box + DDC share", { state: { items: [VAVBOX] }, unit: "Nos", shares: { ddc: { added: true, set: { vavs: "80" } } } }],
    [VAV, "box + full-rate DDC panel", { state: { items: [VAVBOX] }, unit: "Nos", shares: { ddc_whole: { added: true, set: { vavs: "80" } } } }],
    [VAV, "full-rate BACnet controller alone", { state: { items: [] }, unit: "Nos", shares: { bacnet_whole: { added: true, set: { vavs: "96" } } } }],
    [VAV, "box + a share whose amount is typed", { state: { items: [VAVBOX] }, unit: "Nos", shares: { bacnet: { added: true, amount: { supply: "1000", install: "77" } } } }],
    ["hvac_ducting", "duct + insulation", { state: { items: [{ base: null, family: "Rectangular (GI)", attrs: { gauge_as_written: "24G", insulated: "Yes" }, sections: { insulation: { family: "Thermal Nitrile Insulation", attrs: { thickness_mm: "9", cladding: "No" } } } }] }, unit: "sqm" }],
    ["hvac_valve_package", "valve + pressure gauge", { state: { items: [{ base: null, family: "BTU Meter", attrs: { size_mm: "80" } }], sections: { misc: [{ base: null, family: "Pressure Gauge", attrs: {} }] } }, unit: "Nos" }],
    ["hvac_vrf", "outdoor unit + copper, insulation, gas, frame", { state: { items: [{ base: null, family: "Outdoor Unit", attrs: { brand: "Blue Star", capacity: "10" } }] }, unit: "Nos", more: { [EXTRAS_INCLUDES_KEY]: "copper,insulation,gas,frame" } }],
    [VAV, "box + CO2 sensor", { state: { items: [VAVBOX], sections: { sensors: [{ base: null, family: "CO2 Sensor", attrs: {} }] } }, unit: "Nos" }],
  ];
  for (const [cat, name, input] of entries) {
    it(`${cat}: ${name}`, () => {
      const off = followed(V81.byId.get(cat)!, false), on = followed(off, true);
      expect(calcOf(cat, off, input)?.rowPriced, "the entry prices").toBe(true);
      expect(checkEntry(cat, on, off, input, name)).toBe(true);
    });
  }
  it("with an uplift (VAV 33%) and several lines, the lines still add up to the row's ONE rounding", () => {
    const off = followed(V81.byId.get(VAV)!, false), on = followed(off, true);
    const items = V81.items.map((i) => (i.attributes?.item === "vav_install_only_uplift" ? { ...i, rates: { factor: 0.333 } } as typeof i : i));
    const input = { ...entries[0][2], scope: "Installation only" };
    const a = calcOf(VAV, on, input, items)!, b = calcOf(VAV, off, input, items)!;
    expect(a.totals).toEqual(b.totals);
    expect(sum(a, "install_rate")).toBe(a.totals?.install_rate);
    expect(linesOf(a).some((l) => l.working.some((w) => /^install: \d+ x \(1 \+ 33\.3%\) = \d+/.test(w)))).toBe(true);
  });
  it("the shared item's own working follows: the BACnet share under each scope", () => {
    const on = followed(V81.byId.get(VAV)!, true);
    const share = (scope?: string) => calcOf(VAV, on, { ...entries[0][2], ...(scope ? { scope } : {}) })!.shares!.blocks[0];
    expect(share().sumLines).toEqual(["1 x (46,200 + 3,200) = 49,400 / 17 VAVs = 2,906 per box"]);
    expect(share("Installation only")).toMatchObject({ sumLines: ["1 x 3,200 = 3,200 / 17 VAVs = 188 per box"], figures: { supply_rate: 0, install_rate: 188 }, notInScope: { kind: "supply_rate", word: "not in scope" } });
    expect(share("Supply only")).toMatchObject({ sumLines: ["1 x 46,200 = 46,200 / 17 VAVs = 2,718 per box"], figures: { supply_rate: 2718, install_rate: 0 }, notInScope: { kind: "install_rate", word: "not in scope" } });
  });
});

describe("QR-SC2 (owner 2026-11-22 20:09 'option a fopr 3'): the 'Review before using' amounts follow the scope; the rows that show it do not change", () => {
  const on = followed(V81.byId.get(VAV)!, true), off = followed(on, false);
  const input = entries0();
  it("supply + installation: today's block; each other scope: the same block, its amounts the lines' own, its total the row's", () => {
    const w = (cfg: RateCategoryConfig, scope?: string) => calcOf(VAV, cfg, { ...input, ...(scope ? { scope } : {}) })!;
    expect(w(on).combinationWarning).toBe(w(off).combinationWarning);
    for (const scope of SCOPES) {
      const a = w(on, scope), b = w(off, scope);
      expect([a.reviewHeading, !!a.combinationWarning]).toEqual([b.reviewHeading, !!b.combinationWarning]);
      const lines = a.combinationWarning!.split("\n");
      const y = (a.totals!.supply_rate ?? 0) + (a.totals!.install_rate ?? 0);
      const extras = lineFigures(a).slice(1).reduce((t, f) => t + (f.supply_rate ?? 0) + (f.install_rate ?? 0), 0);
      expect(lines[lines.length - 1]).toBe(`Extras total Rs ${extras.toLocaleString("en-IN")} of Rs ${y.toLocaleString("en-IN")}. Review each item before using.`);
      expect(lines.length).toBe(b.combinationWarning!.split("\n").length);
      expect(a.combinationWarning).not.toBe(b.combinationWarning);   // VACUITY: without the key the amounts are the supply + installation ones
    }
  });
  it("NEGATIVE: a row without the block has none under any scope", () => {
    for (const scope of ["", ...SCOPES]) expect(calcOf(VAV, on, { state: { items: [VAVBOX] }, unit: "Nos", ...(scope ? { scope } : {}) })!.combinationWarning).toBeUndefined();
  });
});

describe("R5 on the helper panel (a BoQ row), the pick", () => {
  const on = followed(V81.byId.get(VAV)!, true), off = followed(on, false);
  const row = (cfg: RateCategoryConfig, pick?: string) => sheet81({ 10: { ...box81(17, { controller: "bacnet" }) } }, { cfg, items: V81.items })(10, pick ? { [SCOPE_OVERRIDE_KEY]: pick } : {}).itemList!;
  it("the three choices; the pick's lines add up; the total is today's", () => {
    expect(row(on).scope?.picker?.options).toEqual(["Supply + installation", "Supply only", "Installation only"]);
    expect(JSON.stringify(row(on))).toBe(JSON.stringify(row(off)));
    for (const s of SCOPES) {
      const a = row(on, s), b = row(off, s);
      expect(a.totals).toEqual(b.totals);
      expect([sum(a, "supply_rate"), sum(a, "install_rate")]).toEqual([a.totals?.supply_rate, a.totals?.install_rate]);
      expect(linesOf(a).every((l) => l.notInScope?.word === "not in scope")).toBe(true);
    }
    // NEGATIVE (the gap this closes): without the key the lines still show the supply under Installation only
    expect(sum(row(off, "Installation only"), "supply_rate")).toBeGreaterThan(0);
  });
});

describe("KEY ABSENT = unchanged; the pure pieces", () => {
  it("a category without the key keeps today's lines under every scope (v81 as it is)", () => {
    for (const cat of CATS) expect(scopeOf(V81.byId.get(cat)!).lines_follow, cat).toBeUndefined();
  });
  it("workingWithoutSide: the side's steps become one line where the first stood; a line writing both sides is kept", () => {
    expect(workingWithoutSide(["x", "supply: a = 1", "supply: b = 2", "install: c = 3"], "supply", "not in scope")).toEqual(["x", "supply: 0 - not in scope", "install: c = 3"]);
    expect(workingWithoutSide(["25A MCB: 1 Nos x supply 1400 / install 280 = 1400 / 280"], "install", "not in scope")).toEqual(["25A MCB: 1 Nos x supply 1400 / install 280 = 1400 / 280", "install: 0 - not in scope"]);
  });
});
