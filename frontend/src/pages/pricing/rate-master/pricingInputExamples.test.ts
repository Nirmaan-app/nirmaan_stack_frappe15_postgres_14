/**
 * ELR-3a (owner R-9, R-18, Q5, Q7) -- the "impact on assemblies" view, on the SHIPPED asset (Electrical v69).
 *
 * Pins, for each worked example E1-E7 in point_wiring's config: its BEFORE figures (today's, = ELR-R1 / P4), and its
 * AFTER for each sample edit, recomputed through the product's compute -- never re-derived. NEGATIVES: an example that
 * stops pricing fails BY NAME; an example that illustrates nothing (moves for no input and gives no reason) fails BY
 * NAME; the examples module and the panel's example list carry no arithmetic (source pins). And the panel shape: the
 * nine new inputs and HVAC's flexible duct length are "assembly only"; every other input keeps the shape it had.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import { readJsonFixture } from "../calculatorPanelParity.harness";
import type { RateMasterItem } from "./rateMasterTypes";
import { computePricingInputReach } from "./pricingInputReach";
import {
  assemblyOnlySentence, exampleLegChange, panelShapeOf, pricingInputRangeRefusal,
} from "./pricingInputImpact";
import {
  computeExampleImpacts, examplesForInput, impactExamplesOf, priceExample, type ImpactExample,
} from "./pricingInputExamples";

type Cfg = { category_id: string; discipline?: string } & Record<string, any>;
type Asset = { discipline: string; items: RateMasterItem[]; category_configs: Cfg[] };
const read = (name: string) => readJsonFixture<Asset>(new URL(`../../../../../nirmaan_stack/services/boq_rate_master/data/${name}`, import.meta.url));
const V69 = read("rate_master_electrical_all_v69.json");
const V68 = read("rate_master_electrical_all_v68.json");
const H54 = read("rate_master_hvac_all_v54.json");
const asMaps = (a: Asset) => ({
  configs: Object.fromEntries(a.category_configs.map((c) => [c.category_id, { ...c, discipline: a.discipline }])) as Record<string, Cfg>,
  items: a.items.map((it) => ({ ...it, discipline: a.discipline })) as RateMasterItem[],
});
const E = asMaps(V69);
const REACH = computePricingInputReach(E.configs as never, E.items as never);
const NINE = ["pw_circuit_length_first", "pw_circuit_length_further", "pw_circuit_stretch",
  "conduit_fill_pvc_25", "conduit_fill_pvc_32", "conduit_fill_pvc_50", "conduit_fill_ms_25", "conduit_fill_ms_32", "conduit_fill_ms_50"];

/** Today's figures (supply / install / total), = ELR-R1 F6 "Today" and this slice's P4. */
const BEFORE: Record<string, [number, number, number]> = {
  E1: [1926, 389.2, 2315.2], E2: [2463, 497.8, 2960.8], E3: [8029, 2794.8, 10823.8], E4: [745, 149, 894],
  E5: [5149, 1030.8, 6179.8], E6: [3821, 685, 4506], E7: [589, 118.8, 707.8],
};
/** The TOTAL change per example for ELR-R1's four sample edits (F6): #1 15->18, #2 5->6, #3 30->35, #4 PVC 0.55->0.50. */
const EDITS: Array<[string, string, Record<string, number>, Record<string, number>]> = [
  ["#1 first point 15 -> 18", "pw_circuit_length_first", { factor: 18 }, { E1: 411, E2: 411, E3: 567, E4: 0, E5: 432, E6: 855, E7: 0 }],
  ["#2 per further point 5 -> 6", "pw_circuit_length_further", { factor: 6 }, { E1: 0, E2: 120, E3: 1629, E4: 120, E5: 0, E6: 0, E7: 0 }],
  ["#3 stretch 30 -> 35", "pw_circuit_stretch", { factor: 35 }, { E1: 0, E2: 0, E3: 0, E4: 0, E5: 600, E6: 0, E7: 0 }],
  ["#4 PVC 25 fill 0.55 -> 0.50", "conduit_fill_pvc_25", { factor: 0.5 }, { E1: 0, E2: 0, E3: 0, E4: 0, E5: 0, E6: 357, E7: 0 }],
];

describe("ELR-3a AC5 (b) -- the worked examples E1-E7, priced by the product", () => {
  const examples = impactExamplesOf(E.configs.point_wiring);
  it("point_wiring carries the seven examples, by id and name (owner Q5)", () => {
    expect(examples.map((e) => e.id)).toEqual(["E1", "E2", "E3", "E4", "E5", "E6", "E7"]);
    expect(examples.find((e) => e.id === "E7")?.no_change_reason).toBe("a stated length is kept");
  });
  it("every one of the nine inputs shows all seven (read by point_wiring only)", () => {
    for (const id of NINE) expect(examplesForInput(REACH[id], E.configs).map((x) => x.example.id)).toEqual(["E1", "E2", "E3", "E4", "E5", "E6", "E7"]);
  });
  it.each(Object.entries(BEFORE))("%s: before = today's figures", (id, [s, i, t]) => {
    const ex = examples.find((e) => e.id === id)!;
    expect(priceExample("point_wiring", ex, E.configs, E.items)).toEqual({ ok: true, values: { supply_rate: s, install_rate: i, combined_rate: t } });
  });
  it.each(EDITS)("%s: after is the product's compute with the edit patched in; the total change per example", (_t, input, patch, want) => {
    const got = computeExampleImpacts(input, patch, REACH[input], E.configs, E.items);
    expect(Object.fromEntries(got.map((g) => [g.example.id, g.legs.find((l) => l.leg === "combined_rate")!.change]))
      .valueOf()).toEqual(Object.fromEntries(Object.entries(want).map(([k, v]) => [k, Math.round(v * 100) / 100])));
    for (const g of got) {
      expect(g.before.ok && g.after.ok).toBe(true);
      expect(g.moved).toBe(want[g.example.id] !== 0);
    }
  });
  it("AC0 in words: E1 +411 (+17.8%), E2 +411, E3 +567, E5 +432, E6 +855; E4 / E7 no change (E7: a stated length is kept)", () => {
    const got = computeExampleImpacts("pw_circuit_length_first", { factor: 18 }, REACH.pw_circuit_length_first, E.configs, E.items);
    const tot = (id: string) => got.find((g) => g.example.id === id)!.legs.find((l) => l.leg === "combined_rate")!;
    expect([tot("E1").changeText, tot("E1").pctText]).toEqual(["+411", "+17.8%"]);
    expect(["E2", "E3", "E5", "E6"].map((id) => tot(id).changeText)).toEqual(["+411", "+567", "+432", "+855"]);
    expect(got.filter((g) => !g.moved).map((g) => g.example.id)).toEqual(["E4", "E7"]);
  });
  it("no edit: after = before, nothing moved (the panel opens on today's figures)", () => {
    for (const g of computeExampleImpacts("pw_circuit_length_first", {}, REACH.pw_circuit_length_first, E.configs, E.items)) {
      expect(g.after).toEqual(g.before);
      expect(g.moved).toBe(false);
    }
  });
  it("⚠️ NEGATIVE: an example that STOPS PRICING fails BY NAME (a copy whose E3 names a wire size the catalogue lacks)", () => {
    const broken = structuredClone(E.configs);
    broken.point_wiring.impact_examples.find((e: ImpactExample) => e.id === "E3").attrs.wire1_thickness_sqmm = 7.77;
    const priced = impactExamplesOf(broken.point_wiring).map((e) => [e.id, priceExample("point_wiring", e, broken, E.items).ok]);
    expect(priced.filter(([, ok]) => !ok).map(([id]) => id)).toEqual(["E3"]);
    // and the shipped config has no such example
    expect(examples.filter((e) => !priceExample("point_wiring", e, E.configs, E.items).ok).map((e) => e.id)).toEqual([]);
  });
  it("⚠️ NEGATIVE: every example ILLUSTRATES something -- it moves for at least one of the nine, or says why it does not", () => {
    const moves: Record<string, boolean> = {};
    for (const id of NINE) {
      const v = (E.items.find((it) => it.attributes?.item === id)!.rates as Record<string, number>).factor;
      const edit = id.startsWith("conduit_fill") ? Math.round((v - 0.05) * 100) / 100 : v + 1;
      for (const g of computeExampleImpacts(id, { factor: edit }, REACH[id], E.configs, E.items)) moves[g.example.id] ||= g.moved;
    }
    const idleOf = (exs: ImpactExample[]) => exs.filter((e) => !moves[e.id] && !e.no_change_reason).map((e) => e.id);
    expect(idleOf(examples)).toEqual([]);
    // and the check can fail: an example that moves for none of the nine and gives no reason is NAMED
    expect(idleOf([{ id: "X9", name: "illustrates nothing", attrs: { points: 1 } }])).toEqual(["X9"]);
  });
});

describe("ELR-3a AC5 (a) -- the assembly-only shape and its sentence, both disciplines (owner Q7)", () => {
  const H = asMaps(H54);
  const HREACH = computePricingInputReach(H.configs as never, H.items as never);
  const shapes = (a: { items: RateMasterItem[] }, reach: Record<string, any>) => Object.fromEntries(a.items
    .filter((it) => String(it.kind).endsWith("_pricing_input"))
    .map((it) => [it.attributes!.item as string, panelShapeOf(it.rates, reach[it.attributes!.item as string])]));
  it("the nine are assembly only; so is HVAC's flexible duct length; NOTHING else is", () => {
    const all = { ...shapes(E, REACH), ...shapes(H, HREACH) };
    expect(Object.entries(all).filter(([, s]) => s === "assembly_only").map(([id]) => id).sort())
      .toEqual([...NINE, "flexible_duct_length_m"].sort());
    // P3's two near-misses keep their shapes: cross-talk depth reaches 6 confirmed SKUs, the mixing box is a flat adder
    expect(all.crosstalk_assumed_depth_mm).toBe("pair");
    expect(all.mixing_box_supply_adder).toBe("flat_adder");
  });
  it("NEGATIVE: every v68 Electrical input keeps the shape it had", () => {
    const old = asMaps(V68);
    const before = shapes(old, computePricingInputReach(old.configs as never, old.items as never));
    const after = shapes(E, REACH);
    for (const id of Object.keys(before)) expect([id, after[id]]).toEqual([id, before[id]]);
  });
  it("the sentence, with and without examples", () => {
    expect(assemblyOnlySentence(["Point Wiring"], true))
      .toBe("This number moves no SKU's own rate. It changes how Point Wiring builds its price - worked examples below.");
    expect(assemblyOnlySentence(["HVAC ADP"], false)).toBe("This number moves no SKU's own rate. It changes how HVAC ADP builds its price.");
  });
});

describe("ELR-3a AC4 / U4 -- the panel's refusal is the server's own sentence", () => {
  it("length and fill, both ways", () => {
    const n = "Point wiring - circuit wiring stretch, DB to the first point";
    expect(pricingInputRangeRefusal("length", n, "factor", 0)).toBe(`${n} (factor): a length must be more than 0 (got 0).`);
    expect(pricingInputRangeRefusal("length", n, "factor", 35)).toBeNull();
    expect(pricingInputRangeRefusal("fill", "Conduit fill - PVC 25 mm", "factor", 1.2))
      .toBe("Conduit fill - PVC 25 mm (factor): a conduit fill must be more than 0 and at most 1 (got 1.2).");
    expect(pricingInputRangeRefusal("fill", "Conduit fill - PVC 25 mm", "factor", 0))
      .toBe("Conduit fill - PVC 25 mm (factor): a conduit fill must be more than 0 and at most 1 (got 0).");
    expect(pricingInputRangeRefusal("fill", "x", "factor", 1)).toBeNull();
    expect(pricingInputRangeRefusal(undefined, "Cable tray discount", "discount", 0)).toBeNull();   // NEGATIVE: no range, no refusal
  });
  it("the Python wording is the same text (csv_importer.validate_pricing_input_value)", () => {
    const PY = fs.readFileSync(new URL("../../../../../nirmaan_stack/services/boq_rate_master/csv_importer.py", import.meta.url), "utf-8");
    expect(PY).toContain('"%s: a length must be more than 0 (got %s)." % (label, _plain_number(f))');
    expect(PY).toContain('"%s: a conduit fill must be more than 0 and at most 1 (got %s)." % (label, _plain_number(f))');
  });
});

describe("ELR-3a AC5 (c) -- no arithmetic in the view (R-18)", () => {
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "``").replace(/"[^"\n]*"/g, '""').replace(/'[^'\n]*'/g, "''");
  const EX = fs.readFileSync(new URL("./pricingInputExamples.ts", import.meta.url), "utf-8");
  const PANEL = fs.readFileSync(new URL("./PricingInputImpactPanel.tsx", import.meta.url), "utf-8");
  it("the examples module prices through makePricingSheetHelper and the panel's own patch, and nothing else", () => {
    expect(EX).toContain("makePricingSheetHelper({");
    expect(EX).toContain("itemsWithInput(items, inputItemKey, patch)");
    for (const banned of ["runPipeline", "evalFormula", "rate_stages"]) expect(EX).not.toContain(banned);
  });
  it("the examples module and the panel's example list contain no arithmetic operator", () => {
    const list = PANEL.slice(PANEL.indexOf("function ExampleList("), PANEL.indexOf("function SkuWorking("));
    expect(list.length).toBeGreaterThan(200);
    for (const [name, src] of [["pricingInputExamples.ts", EX], ["ExampleList", list]] as const) {
      const c = code(src).replace(/=>/g, "").replace(/\?\?|\|\||&&|===|!==/g, "");
      expect([name, c.match(/[^\s=!<>]\s*[*/+]\s*[\w(]|\w\s+-\s+\w/g) ?? []]).toEqual([name, []]);
    }
  });
  it("the change and % come from the one helper", () => {
    expect(exampleLegChange(2315.2, 2726.2)).toMatchObject({ change: 411, moved: true, changeText: "+411", pctText: "+17.8%" });
    expect(exampleLegChange(707.8, 707.8)).toMatchObject({ change: 0, moved: false });
  });
});
