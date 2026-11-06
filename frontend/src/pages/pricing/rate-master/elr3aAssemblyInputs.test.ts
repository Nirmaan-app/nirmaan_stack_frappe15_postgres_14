/**
 * ELR-3a (owner R-9, R-R1 Q1-Q8; Q1 a / Q2 a of 2026-10-28) -- THE FOUR ASSEMBLY-STEP ARMS.
 *
 * Point wiring's four numbers (the first-point length 15, the per-further-point length 5, the circuit stretch 30, the six
 * conduit fills) move from literals in three pipelines to Pricing Inputs, read by `table_from_ctx` / `default_from_ctx`
 * (map_attribute), `constants_from_ctx` (derive_attribute) and `usable_from_ctx` (circuit_fit).
 *
 * The configs here are Electrical v68 with the 12 literals moved IN THE TEST (`moved`), so this file proves the
 * MECHANISM on the shipped rules without an asset: with the inputs at today's values every figure, every working line
 * and every field note of seven real stored rows (E1-E7, `__fixtures__/elr3aExampleRows.json`, computed by HEAD
 * 60ae6cd30 on v68) is exactly what it was; with one input changed, the rows move exactly as the literal would have.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import { readJsonFixture } from "../calculatorPanelParity.harness";
import type { RateMasterItem } from "./rateMasterTypes";
import {
  ASSEMBLY_CTX_ARMS, assemblyArmCtxKeys, assemblyOnlyCtxKeys, conduitFillInRange, hoistRateRefs, runPipeline,
} from "./ratePipelineInterpreter";
import { computePricingInputReach } from "./pricingInputReach";
import { pricingInputUsedBy } from "./rateMasterSpec";
import { makePricingSheetHelper } from "../../boq-wizard/rate-helper/pricingSheetHelper";

type Cfg = { category_id: string; discipline?: string; pipelines: Record<string, { steps: any[]; output?: string[] }> } & Record<string, any>;
type Asset = { discipline: string; items: RateMasterItem[]; category_configs: Cfg[] };

const V68 = readJsonFixture<Asset>(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v68.json", import.meta.url));
const FIX = readJsonFixture<{ rows: Array<{ id: string; key: string; excel_row: number; description: string; unit: string; attributes: Record<string, unknown>;
  expect: { values: Record<string, number>; sections: Array<{ label: string; derivation: string[]; rows: string[] }>; circuit_length_note: unknown } }> }>(
  new URL("../__fixtures__/elr3aExampleRows.json", import.meta.url));

/** The nine inputs (ELR-R1 F3; owner Q1 six fill rows, Q2 the `factor` column with a unit, Q8 one input per 15 and per 5). */
const INPUTS: Array<[string, string, number, string]> = [
  ["pw_circuit_length_first", "Point wiring - circuit length of the first point", 15, "m"],
  ["pw_circuit_length_further", "Point wiring - circuit length per further point", 5, "m"],
  ["pw_circuit_stretch", "Point wiring - circuit wiring stretch, DB to the first point", 30, "m"],
  ["conduit_fill_pvc_25", "Conduit fill - PVC 25 mm", 0.55, "fraction of the bore"],
  ["conduit_fill_pvc_32", "Conduit fill - PVC 32 mm", 0.55, "fraction of the bore"],
  ["conduit_fill_pvc_50", "Conduit fill - PVC 50 mm", 0.55, "fraction of the bore"],
  ["conduit_fill_ms_25", "Conduit fill - MS 25 mm", 0.45, "fraction of the bore"],
  ["conduit_fill_ms_32", "Conduit fill - MS 32 mm", 0.45, "fraction of the bore"],
  ["conduit_fill_ms_50", "Conduit fill - MS 50 mm", 0.47, "fraction of the bore"],
];
const K = (id: string) => `pi_${id}_factor`;
const clone = <T>(o: T): T => structuredClone(o);

/** v68's point_wiring with the 12 literals moved to the arms and the 9 rate_ref appended to each of the three pipelines. */
function moved(asset: Asset): Cfg[] {
  const cfgs = clone(asset.category_configs);
  const pw = cfgs.find((c) => c.category_id === "point_wiring")!;
  let touched = 0;
  for (const pid of ["pw_boq_supply", "pw_boq_install", "pw_bcs"]) {
    const steps = pw.pipelines[pid].steps;
    for (const s of steps) {
      const p = s.params ?? {};
      if (s.step === "map_attribute" && p.result_attr === "circuit_length_m") {
        expect(p.table).toEqual({ Primary: 15, Secondary: 5 });
        delete p.table;
        p.table_from_ctx = { Primary: K("pw_circuit_length_first"), Secondary: K("pw_circuit_length_further") };
        touched++;
      } else if (s.step === "derive_attribute" && p.result_attr === "circuit_length_m") {
        expect(p.constants).toEqual({ base: 15, per_extra: 5 });
        delete p.constants;
        p.constants_from_ctx = { base: K("pw_circuit_length_first"), per_extra: K("pw_circuit_length_further") };
        touched++;
      } else if (s.step === "map_attribute" && p.result_attr === "circuit_wire_length_m") {
        expect(p.default).toBe(30);
        delete p.default;
        p.default_from_ctx = K("pw_circuit_stretch");
        touched++;
      } else if (s.step === "circuit_fit") {
        expect(p.usable).toEqual({ PVC: [0.55, 0.55, 0.55], MS: [0.45, 0.45, 0.47] });
        delete p.usable;
        p.usable_from_ctx = { PVC: [25, 32, 50].map((z) => K(`conduit_fill_pvc_${z}`)), MS: [25, 32, 50].map((z) => K(`conduit_fill_ms_${z}`)) };
        touched++;
      }
    }
    for (const [id] of INPUTS) steps.push({ step: "rate_ref", ref: { kind: "electrical_pricing_input", item: id }, target: "factor", result: K(id) });
  }
  expect(touched).toBe(12);
  return cfgs;
}

function withInputs(items: RateMasterItem[], over: Record<string, number> = {}): RateMasterItem[] {
  return [
    ...items,
    ...INPUTS.map(([id, name, v, unit]) => ({
      discipline: "Electrical", kind: "electrical_pricing_input", unit, item_uid: `test-elr3a-${id}`,
      attributes: { item: id, name }, rates: { factor: id in over ? over[id] : v },
    }) as RateMasterItem),
  ];
}

const ITEMS = V68.items.map((it) => ({ ...it, discipline: "Electrical" })) as RateMasterItem[];
const MOVED = moved(V68);

function computeRow(cfgs: Cfg[], items: RateMasterItem[], r: (typeof FIX.rows)[number]) {
  const ext = new Map<number, any>([[r.excel_row, { excelRow: r.excel_row, description: r.description, attributes: r.attributes }]]);
  const h = makePricingSheetHelper({ configsByCategory: new Map(cfgs.map((c) => [c.category_id, c])), items, extractionByRow: ext } as never);
  const res: any = h.compute({ excelRow: r.excel_row, description: r.description, nodeType: "Line Item", category: "point_wiring",
    discipline: "Electrical", rateKinds: ["supply_rate", "install_rate", "combined_rate"], unit: r.unit } as never, {});
  return {
    values: res.values ?? null,
    sections: (res.workings?.sections ?? []).map((s: any) => ({ label: s.label, derivation: s.derivation, rows: s.matchedRows ?? [] })),
    note: (res.workings?.attributes ?? []).find((a: any) => a.id === "circuit_length_m")?.notes ?? null,
  };
}

describe("ELR-3a AC1 -- the moved rules price E1-E7 exactly as v68's literals do (figures, working lines, notes)", () => {
  it("the fixture is the seven named rows", () => {
    expect(FIX.rows.map((r) => r.id)).toEqual(["E1", "E2", "E3", "E4", "E5", "E6", "E7"]);
  });
  it.each(FIX.rows.map((r) => [r.id, r] as const))("%s: identical to HEAD on v68 -- figures, every section line, the circuit-length note", (_id, r) => {
    const got = computeRow(MOVED, withInputs(ITEMS), r);
    expect(got.values).toEqual(r.expect.values);
    // INVERTED at ELR-4c (owner R-ELR2 (c) "one line per input used", P6 "Q1 b") by mechanical authority. BEFORE:
    // toEqual(r.expect.sections) -- owner Q2 a, "the nine inputs add NO working line". NOW: every other line is byte-equal
    // and in order, and the only lines added are the "(Pricing Input)" lines of the inputs the row used.
    const withoutUsed = got.sections.map((s: any) => ({ ...s, rows: s.rows.filter((l: string) => !l.endsWith(" (Pricing Input)")) }));
    expect(withoutUsed).toEqual(r.expect.sections);
    expect(got.note).toEqual(r.expect.circuit_length_note);   // owner Q1 a: "15 + (2 - 1) x 5", never "base ... per_extra"
  });
  it("E2 in words: 2,463 / 497.8 and 'Worked out: 15 + (2 - 1) x 5 = 20 m'", () => {
    const got = computeRow(MOVED, withInputs(ITEMS), FIX.rows[1]);
    expect(got.values).toEqual({ supply_rate: 2463, install_rate: 497.8, combined_rate: 2960.8 });
    expect(got.note).toEqual([{ kind: "landed", how: "Worked out: 15 + (2 - 1) x 5 = 20 m" }]);
    // INVERTED at ELR-4c (owner R-ELR2 (c), P6 "Q1 b") by mechanical authority. BEFORE: no line matched
    // /circuit length|stretch|Conduit fill|pi_/. NOW: E2 (2 points, formula) shows the two lengths and its fill, each named
    // by the input's own name with "(Pricing Input)"; still no internal id and no stretch (circuit wiring not included).
    const rows = got.sections.flatMap((s: any) => s.rows);
    expect(rows.some((l: string) => /pi_/.test(l))).toBe(false);
    expect(rows.filter((l: string) => /circuit length|stretch|Conduit fill/.test(l)).every((l: string) => l.endsWith(" (Pricing Input)"))).toBe(true);
    expect(rows).toContain("Point wiring - circuit length of the first point = 15 m (Pricing Input)");
    expect(rows).toContain("Point wiring - circuit length per further point = 5 m (Pricing Input)");
    expect(rows.some((l: string) => /stretch/.test(l))).toBe(false);
  });
});

describe("ELR-3a AC1 -- an edited input moves the rows exactly as the literal would (ELR-R1 F6)", () => {
  // ELR-R1's measured changes, total (combined) per example: #1 15->18, #2 5->6, #3 30->35, #4 PVC 0.55->0.50
  const TOTAL: Record<string, Record<string, number>> = {
    first18: { E1: 411, E2: 411, E3: 567, E4: 0, E5: 432, E6: 855, E7: 0 },
    further6: { E1: 0, E2: 120, E3: 1629, E4: 120, E5: 0, E6: 0, E7: 0 },
    stretch35: { E1: 0, E2: 0, E3: 0, E4: 0, E5: 600, E6: 0, E7: 0 },
    pvc050: { E1: 0, E2: 0, E3: 0, E4: 0, E5: 0, E6: 357, E7: 0 },
  };
  const OVER: Record<string, Record<string, number>> = {
    first18: { pw_circuit_length_first: 18 }, further6: { pw_circuit_length_further: 6 }, stretch35: { pw_circuit_stretch: 35 },
    pvc050: { conduit_fill_pvc_25: 0.5, conduit_fill_pvc_32: 0.5, conduit_fill_pvc_50: 0.5 },
  };
  it.each(Object.keys(TOTAL))("%s", (k) => {
    for (const r of FIX.rows) {
      const after = computeRow(MOVED, withInputs(ITEMS, OVER[k]), r).values;
      expect([r.id, Math.round((after.combined_rate - r.expect.values.combined_rate) * 100) / 100]).toEqual([r.id, TOTAL[k][r.id]]);
    }
  });
  it("the note follows the edit: E2 with the first point at 18 reads 'Worked out: 18 + (2 - 1) x 5 = 23 m'", () => {
    expect(computeRow(MOVED, withInputs(ITEMS, { pw_circuit_length_first: 18 }), FIX.rows[1]).note)
      .toEqual([{ kind: "landed", how: "Worked out: 18 + (2 - 1) x 5 = 23 m" }]);
  });
  it("E4 (a looped point) follows the per-further-point input through the TABLE: 'Point type Secondary read as 6'", () => {
    expect(computeRow(MOVED, withInputs(ITEMS, { pw_circuit_length_further: 6 }), FIX.rows[3]).note)
      .toEqual([{ kind: "landed", how: "Point type Secondary read as 6" }]);
  });
});

// ───────────────────────────── the interpreter arms, one at a time, on synthetic pipelines ─────────────────────────────
const PI = (item: string, v: number): RateMasterItem => ({ discipline: "Electrical", kind: "electrical_pricing_input", attributes: { item }, rates: { factor: v } } as RateMasterItem);
const ref = (item: string) => ({ step: "rate_ref", ref: { kind: "electrical_pricing_input", item }, target: "factor", result: K(item) });
const run = (steps: any[], items: RateMasterItem[], sel: Record<string, string | number> = {}) =>
  runPipeline("t", { steps, output: ["out"] } as never, items, sel);

describe("ELR-3a AC1 -- map_attribute table_from_ctx / default_from_ctx", () => {
  const map = (params: Record<string, unknown>) => ({ step: "map_attribute", params: { result_attr: "len", ...params } });
  it("POSITIVE: the table reads the input; the default reads the input", () => {
    const items = [PI("a", 18), PI("b", 33)];
    const r1 = run([map({ from_attr: "pt", table_from_ctx: { Primary: K("a") } }), ref("a")], items, { pt: "Primary" });
    expect(r1.steps.find((s) => s.step === "map_attribute")?.mapAttribute?.value).toBe(18);
    const r2 = run([map({ from_attr: "pt", table: { No: 0 }, default_from_ctx: K("b") }), ref("b")], items, { pt: "Yes" });
    expect(r2.steps.find((s) => s.step === "map_attribute")?.mapAttribute?.value).toBe(33);
  });
  it("NEGATIVE: a key that was never computed refuses NAMING it", () => {
    const r = run([map({ from_attr: "pt", table_from_ctx: { Primary: K("a") } })], [], { pt: "Primary" });
    expect(r.status).toBe("no_match");
    expect(r.steps.at(-1)?.label).toContain(`'${K("a")}', which was not computed`);
    const r2 = run([map({ default_from_ctx: K("b") })], []);
    expect(r2.steps.at(-1)?.label).toContain(`'${K("b")}', which was not computed`);
  });
  it("NEGATIVE: the literal AND its _from_ctx together refuse (a replacement, never a merge)", () => {
    const items = [PI("a", 18)];
    expect(run([map({ table: { Primary: 15 }, table_from_ctx: { Primary: K("a") } }), ref("a")], items).steps.at(-1)?.label)
      .toContain("carries both 'table' and 'table_from_ctx'");
    expect(run([map({ default: 30, default_from_ctx: K("a") }), ref("a")], items).steps.at(-1)?.label)
      .toContain("carries both 'default' and 'default_from_ctx'");
  });
  it("⚠️ ELR-R1's TRAP: a pricer's stated 'None' on the stretch is still KEPT when the default comes from an input", () => {
    // the None-pick rule's condition (ii) tests the default; default_from_ctx must be resolved before it
    const step = map({ prefer_attr: "len", from_attr: "inc", table: { No: 0 }, default_from_ctx: K("b") });
    const r = run([step, ref("b")], [PI("b", 30)], { len: "None", inc: "Yes" });
    const m = r.steps.find((s) => s.step === "map_attribute")!;
    expect(m.mapAttribute).toEqual({ result_attr: "len", stated: true, value: "None" });
    // and the literal-era step agrees, which is what makes the move byte-identical
    const lit = run([map({ prefer_attr: "len", from_attr: "inc", table: { No: 0 }, default: 30 })], [], { len: "None", inc: "Yes" });
    expect(lit.steps.find((s) => s.step === "map_attribute")!.mapAttribute).toEqual(m.mapAttribute);
  });
});

describe("ELR-3a AC1 -- derive_attribute constants_from_ctx", () => {
  const derive = (params: Record<string, unknown>) => ({ step: "derive_attribute",
    params: { result_attr: "len", terms: [{ ident: "points", attr: "points" }], formula: "base + (points - 1) * per_extra", unit: "m", ...params } });
  it("POSITIVE: the constants come from the inputs and ride on the outcome (display-only)", () => {
    const r = run([derive({ constants_from_ctx: { base: K("a"), per_extra: K("b") } }), ref("a"), ref("b")], [PI("a", 18), PI("b", 6)], { points: 3 });
    const d = r.steps.find((s) => s.step === "derive_attribute")!;
    expect(d.derivedAttr).toEqual({ attr: "len", value: 30, stated: false, unit: "m", constants: { base: 18, per_extra: 6 } });
  });
  it("NEGATIVE: a literal-constant step publishes NO constants (every shipped trace byte-identical)", () => {
    const r = run([derive({ constants: { base: 15, per_extra: 5 } })], [], { points: 3 });
    expect(r.steps.find((s) => s.step === "derive_attribute")!.derivedAttr).toEqual({ attr: "len", value: 25, stated: false, unit: "m" });
  });
  it("NEGATIVE: missing ctx refuses naming the key; both together refuse", () => {
    expect(run([derive({ constants_from_ctx: { base: K("a"), per_extra: K("b") } }), ref("a")], [PI("a", 18)], { points: 3 }).steps.at(-1)?.label)
      .toContain(`constant 'per_extra' reads '${K("b")}', which was not computed`);
    expect(run([derive({ constants: { base: 15 }, constants_from_ctx: { per_extra: K("b") } }), ref("b")], [PI("b", 5)], { points: 3 }).steps.at(-1)?.label)
      .toContain("carries both 'constants' and 'constants_from_ctx'");
  });
  it("a STATED length is kept and the inputs are not even read (the literal era's rule)", () => {
    const r = run([derive({ constants_from_ctx: { base: K("a"), per_extra: K("b") } })], [], { points: 3, len: 7 });
    expect(r.steps[0].derivedAttr).toMatchObject({ stated: true, statedValue: 7 });
  });
});

describe("ELR-3a AC1 / AC4 -- circuit_fit usable_from_ctx, and the interpreter's fill refusal", () => {
  const fit = (params: Record<string, unknown>) => ({ step: "circuit_fit", binds: ["fitted_size", "circuits", "conduit_qty"],
    params: { sizes: [25, 32], wire_specs: [["c", "t"]], length_attr: "len", conduit_type_attr: "ct", ...params } });
  const sel = { c: 1, t: 1.5, len: 15, ct: "PVC" };
  const keys = { PVC: [K("f25"), K("f32")] };
  it("POSITIVE: the fills come from the inputs, size for size -- same answer as the literal table", () => {
    const viaCtx = run([fit({ usable_from_ctx: keys }), ref("f25"), ref("f32")], [PI("f25", 0.55), PI("f32", 0.55)], sel);
    const lit = run([fit({ usable: { PVC: [0.55, 0.55] } })], [], sel);
    expect(viaCtx.steps.find((s) => s.step === "circuit_fit")!.matchedCondition).toBe(lit.steps[0].matchedCondition);
  });
  it.each([[0], [-0.1], [1.2]])("NEGATIVE: a fill of %s refuses NAMING the input", (v) => {
    const r = run([fit({ usable_from_ctx: keys }), ref("f25"), ref("f32")], [PI("f25", v), PI("f32", 0.55)], sel);
    expect(r.status).toBe("no_match");
    expect(r.steps.at(-1)?.step).toBe("circuit_fit");
    expect(r.steps.at(-1)?.label).toBe(`conduit fill '${K("f25")}' is ${v}; a fill must be more than 0 and at most 1 -- no value computed`);
  });
  it("a fill of exactly 1 is allowed (at most 1); the range predicate itself", () => {
    const r = run([fit({ usable_from_ctx: keys }), ref("f25"), ref("f32")], [PI("f25", 1), PI("f32", 1)], sel);
    expect(r.steps.find((s) => s.step === "circuit_fit")?.matchedCondition).toMatch(/^dia .* -> 25mm, \d+ circuits, conduit qty \d+$/);
    expect([0, 0.0001, 0.55, 1, 1.0001, -1].map(conduitFillInRange)).toEqual([false, true, true, true, false, false]);
  });
  it("NEGATIVE: both 'usable' and 'usable_from_ctx' refuse", () => {
    expect(run([fit({ usable: { PVC: [0.55, 0.55] }, usable_from_ctx: keys }), ref("f25"), ref("f32")], [PI("f25", 0.55), PI("f32", 0.55)], sel)
      .steps.at(-1)?.label).toContain("carries both 'usable' and 'usable_from_ctx'");
  });
});

describe("ELR-3a -- the arm registry and the assembly-only key set (owner Q2 a)", () => {
  it("exactly four arms on exactly three step types (the Python _ASSEMBLY_CTX_ARMS twin)", () => {
    expect(ASSEMBLY_CTX_ARMS).toEqual({ map_attribute: ["table_from_ctx", "default_from_ctx"], derive_attribute: ["constants_from_ctx"], circuit_fit: ["usable_from_ctx"] });
    const PY = fs.readFileSync(new URL("../../../../../nirmaan_stack/services/boq_rate_master/config_validation.py", import.meta.url), "utf-8");
    expect(PY).toContain('"map_attribute": {"table_from_ctx": "table", "default_from_ctx": "default"}');
    expect(PY).toContain('"derive_attribute": {"constants_from_ctx": "constants"}');
    expect(PY).toContain('"circuit_fit": {"usable_from_ctx": "usable"}');
  });
  it("the moved point_wiring pipelines: the nine keys are assembly-only; every other input keeps its line", () => {
    const pw = MOVED.find((c) => c.category_id === "point_wiring")!;
    for (const pid of ["pw_boq_supply", "pw_boq_install", "pw_bcs"]) {
      const only = assemblyOnlyCtxKeys(pw.pipelines[pid] as never);
      expect([...only].sort()).toEqual(INPUTS.map(([id]) => K(id)).sort());
      const otherRefs = pw.pipelines[pid].steps.filter((s: any) => s.step === "rate_ref" && !only.has(s.result));
      expect(otherRefs.length).toBeGreaterThan(0);   // cable / conduit / switch inputs still show their lines
    }
    const circuitFit = pw.pipelines.pw_boq_supply.steps.find((s: any) => s.step === "circuit_fit");
    expect(assemblyArmCtxKeys(circuitFit)).toHaveLength(6);
  });
  it("NEGATIVE: a key read by an arm AND elsewhere is not assembly-only (it keeps its working line)", () => {
    const pl = { steps: [
      { step: "derive_attribute", params: { constants_from_ctx: { base: "k1" } } },
      { step: "scale", target: "x", result: "y", formula: "x * m", params: { m_from_ctx: "k1" } },
      { step: "map_attribute", params: { default_from_ctx: "k2" } },
    ] };
    expect([...assemblyOnlyCtxKeys(pl)]).toEqual(["k2"]);
  });
  it("NEGATIVE: every v68 pipeline has NO assembly-only key -- so no shipped bill loses a line", () => {
    for (const c of V68.category_configs) for (const pl of Object.values(c.pipelines ?? {})) expect(assemblyOnlyCtxKeys(pl as never).size).toBe(0);
  });
  it("the hoist runs the appended preamble first, so an arm reads a value that exists", () => {
    const pl = MOVED.find((c) => c.category_id === "point_wiring")!.pipelines.pw_boq_supply.steps;
    const order = hoistRateRefs(pl).map((s: any) => s.step);
    expect(order.indexOf("map_attribute")).toBeGreaterThan(order.lastIndexOf("rate_ref"));
  });
});

describe("ELR-3a AC1 -- the reach walk and used_by know the new keys", () => {
  const configs = Object.fromEntries(MOVED.map((c) => [c.category_id, c]));
  const reach = computePricingInputReach(configs as never, withInputs(ITEMS) as never);
  it.each(INPUTS.map(([id]) => [id]))("%s: read by point_wiring through its 3 pipelines, 0 SKUs, no candidates", (id) => {
    const r = reach[id];
    expect(r.readByCategories).toEqual(["point_wiring"]);
    expect(r.pipelines.map((p) => p.pipelineId)).toEqual(["pw_bcs", "pw_boq_install", "pw_boq_supply"]);
    expect(r.distinctSkus).toEqual([]);
    expect(r.candidateSkus).toEqual([]);
    expect(r.isFlatAdder).toBe(false);
    expect(r.assemblyRange).toBe(id.startsWith("conduit_fill") ? "fill" : "length");
  });
  it("NEGATIVE: every v68 input's reach record is byte-identical with the nine added", () => {
    const before = computePricingInputReach(Object.fromEntries(V68.category_configs.map((c) => [c.category_id, c])) as never, ITEMS as never);
    for (const id of Object.keys(before)) expect([id, reach[id]]).toEqual([id, before[id]]);
    expect(Object.keys(reach).length).toBe(Object.keys(before).length + 9);
    for (const id of Object.keys(before)) expect(before[id].assemblyRange).toBeUndefined();
  });
  it("used_by (TS): each of the nine reads 'point_wiring', 3 uses -- derived from the rate_refs, no code of its own", () => {
    const used = pricingInputUsedBy(MOVED as never);
    for (const [id] of INPUTS) expect(used[id]).toEqual({ sites: 3, categories: ["point_wiring"] });
    const usedV68 = pricingInputUsedBy(V68.category_configs as never);
    for (const id of Object.keys(usedV68)) expect(used[id]).toEqual(usedV68[id]);
  });
});
