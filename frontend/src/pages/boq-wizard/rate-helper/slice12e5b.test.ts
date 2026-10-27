/**
 * SLICE 12e-5b Part 1 (owner, 2026-10-15, on the 12e-5 Stage A audit) -- THE PRICER'S SHARE OF THE TWELVE FIXES.
 * No model is asked here. Every model answer is either one a 12e-5 Stage A run stored (BRSR-26-00447 ..), copied as
 * stored, or -- where the answer can only exist once v39's notes are live -- a hand-built answer in the shape v39
 * asks for, marked SYNTHETIC where it is used. Every rule is tested from the PANEL'S ENTRY POINT
 * (`makePricingSheetHelper(...).compute`) and, where a figure is asserted, against the PURE pricer.
 *
 *   AC1  (R6) A size written in inches with its millimetres in brackets ('1/2" (12.7mm)') is ONE size where the two
 *        agree within 0.5 mm, on every Piping / Insulation size reader, model-read and typed. Where they disagree
 *        the row refuses "the size is written two different ways (X and Y) - price this row by hand", and the box
 *        never shows a value the row then refuses on.
 *   AC2  (R7) A composed insulation (two or more layers) carries ONE cladding over the OUTER surface: girth =
 *        3.14 x (pipe as read + 2 x the TOTAL thickness) / 1000, with its working line. One-layer rows unchanged.
 *   AC3  (R2) "26 G GI cladding", copied as written, prices as the stocked aluminium of its gauge with the amber
 *        "BoQ says 26 G GI cladding -> priced as 26G Aluminium" line; a gauge the table does not list refuses.
 *   AC4  (R5) "none of these" + a material as written with closed cell AND polyethylene prices as Nitrile Rubber on
 *        a pipe (per metre), Thermal Nitrile on a duct / sheet (per sq.m), with its amber family line; plain
 *        polyethylene, PE foam and XLPE keep refusing by name.
 *   AC8a A priced insulation section's SKU line names the insulation, not " / (Mts)".
 *
 * AC2-AC4 are config-driven: the v38 asset carries none of their keys yet (v39 does), so this file prices against
 * v38 with the v39 keys added in `withKeys` -- the same objects v39 ships, asserted equal in the v39 loader test.
 * What each block protects is said in its `describe`. Negative halves sit beside every positive.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, makePricingSheetHelper,
  type ItemBlockView, type ItemEditOp, type ItemListEditState, type ItemListSuggestion, type ItemListView, type SectionBlockView,
} from "./pricingSheetHelper";
import { inchWithMmEcho, itemListPricingSpec, listSpecDefs, priceItemList, sizeWrittenTwoWaysMessage, INCH_MM_ECHO_MM } from "./itemListPricing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const V38 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v38.json`, import.meta.url));
const ITEMS: RateMasterItem[] = V38.items.map((it) => ({ ...it, discipline: V38.discipline } as RateMasterItem));
const INS = "hvac_insulation", PIP = "hvac_piping";
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
const NITRILE = "Nitrile Rubber Insulation", THERMAL = "Thermal Nitrile Insulation";
const SEC = "insulation";

/** The v39 Insulation keys this slice reads (AC2 / AC3 / AC4), added to a COPY of the v38 config. */
export const V39_INSULATION_KEYS = {
  outer_surface: {
    attr: "cladding_od_mm", pipe: "pipe_size_mm", thickness: "thickness_mm",
    girth_step: {
      step: "scale", target: "ov", result: "girth", params: { od_from_attr: "cladding_od_mm" }, formula: "3.14*od/1000",
      explain: "girth over the outer surface: 3.14 x (pipe size + 2 x the total thickness) / 1000 = sq.m of surface per metre",
    },
  },
  choice_text: [{
    attr: "cladding", from_attr: "cladding_as_written", words: ["gi", "g.i", "g.i.", "galvanised", "galvanized"],
    gauge_pattern: "(\\d{2})\\s*(?:g|swg|gauge)\\b", to_by_gauge: { "24": "24G Aluminium", "26": "26G Aluminium" }, default_to: "26G Aluminium",
    line: "BoQ says {from} -> priced as {to}",
    unlisted_line: "BoQ says {from} - the catalogue has no cladding of that gauge - price this row by hand",
    rule: "R2 GI cladding is priced as aluminium of its gauge until a GI cladding item exists (owner 2026-10-15)",
  }],
  material_text: {
    from_attr: "material_as_written", when_family: ["none of these"],
    map: [{
      all_of: [["closed cell", "close cell", "closed-cell"], ["polyethylene", "pe"]],
      to_by_unit_class: { length: NITRILE, area: THERMAL },
      line: "BoQ says closed cell polyethylene -> priced as {to}",
      rule: "R5 closed cell polyethylene is priced as nitrile (owner 2026-10-15)",
    }],
  },
};
function withKeys(cfg: RateCategoryConfig): RateCategoryConfig {
  const c = structuredClone(cfg) as RateCategoryConfig & { list_spec: { pricing: Record<string, unknown> & { compose: Record<string, unknown> } } };
  c.list_spec.pricing.compose = { ...c.list_spec.pricing.compose, outer_surface: V39_INSULATION_KEYS.outer_surface };
  c.list_spec.pricing.choice_text = V39_INSULATION_KEYS.choice_text;
  c.list_spec.pricing.material_text = V39_INSULATION_KEYS.material_text;
  return c;
}
const PLAIN = new Map<string, RateCategoryConfig>(V38.category_configs.map((c) => [c.category_id, c]));
const KEYED = new Map<string, RateCategoryConfig>(V38.category_configs.map((c) => [c.category_id, c.category_id === INS ? withKeys(c) : c]));

type Answer = Record<string, string | null>;
function stored(configs: Map<string, RateCategoryConfig>, category: string, a: Answer): { attributes: ExtractionRow["attributes"]; section?: string } {
  const { section, ...given } = a;
  const own = section ? listSpecDefs(configs.get((itemListPricingSpec(configs.get(category)!)!.sections ?? []).find((s) => s.id === section)?.category_id ?? "")!) : listSpecDefs(configs.get(category)!);
  const attributes: Record<string, { value: string | null; confidence: number }> = {};
  for (const d of own) attributes[d.id] = { value: null, confidence: 0 };
  for (const [k, v] of Object.entries(given)) attributes[k] = { value: v, confidence: 0.9 };
  return { attributes: attributes as ExtractionRow["attributes"], ...(section ? { section } : {}) };
}
type Shown = { s: ItemListSuggestion; v: ItemListView; values: ItemListSuggestion["values"] };
/** The BoQ-ROW (panel) path: the stored answer through `extractionByRow`, the row's own unit, text and headings. */
function panel(category: string, answer: Answer[], unit = "Rmt", desc = "", headings: string[] = [], edits?: ItemListEditState, configs = KEYED): Shown {
  const row = { excelRow: 1, description: desc, attributes: {}, items: answer.map((a) => stored(configs, category, a)) } as unknown as ExtractionRow;
  const h = makePricingSheetHelper({ configsByCategory: configs, items: ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx = { excelRow: 1, description: desc, nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS], unit, headings, ownNotes: [] } as RateHelperRowContext & { unit?: string };
  const r = h.compute(ctx, edits ? { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(edits) } : {});
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, values: s.values };
}
/** The CALCULATOR path: no extraction; the whole edit state is the override; the unit is a pick. */
function calc(category: string, state: ItemListEditState, unit = "mts", configs = KEYED): Shown {
  const h = makePricingSheetHelper({ configsByCategory: configs, items: ITEMS, extractionByRow: new Map() });
  const ctx: RateHelperRowContext = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS] };
  const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: unit });
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { s, v: s.itemList!, values: s.values };
}
const field = (b: ItemBlockView, id: string) => b.fields.find((f) => f.id === id)!;
const fig = (values: Partial<Record<string, number>> | undefined): [number | undefined, number | undefined] => [values?.supply_rate, values?.install_rate];
const attached = (v: ItemListView, at = 0): SectionBlockView => v.items[at].sections![0];
const secBlock = (sv: SectionBlockView): ItemBlockView => sv.view.items[0];
const lines = (b: ItemBlockView): string[] => [b.reason ?? "", b.familyLine ?? "", b.skuLine ?? "", ...b.working, ...b.fields.flatMap((f) => [f.note ?? "", f.rule ?? ""])].filter(Boolean);
const TWO_WAYS = /written two different ways/;

// =====================================================================================================
// AC1 -- one size, written two ways
// =====================================================================================================
// Every inch-with-mm spelling the 12e-5 Stage A sheets hold (BOQ-26-00119 HVAC rows 19-32, BOQ-26-00158 DX - Hiwall
// rows 17-21), AS STORED, with the stocked size each must price at.
const AGREE: Array<[string, number]> = [
  ['1/4" (6.3mm)', 6.4], ['3/8" (9.5mm)', 9.5], ['1/2" (12.7mm)', 12.7], ['5/8" (15.9mm)', 15.9], ['3/4" (19.1mm)', 19.1],
  ['7/8" (22.2mm)', 22.2], ['1 1/8" (28.6mm)', 28.6], ['1 3/8" (34.9mm)', 34.9],
  ['1/4 " dia (6.4 MM)', 6.4], ['3/8 " dia (9.5 MM)', 9.5], ['1/2 " dia (12.7 MM)', 12.7], ['5/8 " dia (15.9 MM )', 15.9], ['3/4 " dia (19.1 MM )', 19.1],
];
// SYNTHETIC: the same spellings with a bracket that does not agree (beyond 0.5 mm), and one per inch spelling.
const DISAGREE: Array<[string, string, string]> = [
  ['1/2" (15.9mm)', '1/2"', "15.9 mm"], ['3/4 " dia (12.7 MM)', '3/4 " dia', "12.7 mm"],
  ['1 inch (19.1 mm)', "1 inch", "19.1 mm"], ['5/8 (22.2mm)', "5/8", "22.2 mm"],
];
const COPPER = (size: string): Answer[] => [
  { pipe_type: "Copper", pipe_type_as_written: "copper", size_mm: size, pipe_class: null, insulated: "Yes" },
  { section: SEC, item: NITRILE, cladding: "None", thickness_mm: "19mm", pipe_size_mm: size, brand: null, material_as_written: "nitrile rubber" }];
const INSULATION = (size: string): Answer[] => [{ item: NITRILE, cladding: "None", thickness_mm: "19mm", pipe_size_mm: size, brand: null, material_as_written: "nitrile rubber" }];

describe("AC1 the reader: inchWithMmEcho is the one place the two spellings are compared", () => {
  it("an agreeing bracket hands back the inch spelling alone; a disagreeing one, the refusal", () => {
    expect(inchWithMmEcho('1/2" (12.7mm)')).toEqual({ head: '1/2"' });
    expect(inchWithMmEcho('1 1/8" (28.6mm)')).toEqual({ head: '1 1/8"' });
    expect(inchWithMmEcho('1/4 " dia (6.4 MM)')).toEqual({ head: '1/4 " dia' });
    expect(inchWithMmEcho('1/2" (15.9mm)')).toEqual({ conflict: sizeWrittenTwoWaysMessage('1/2"', "15.9 mm") });
    expect(sizeWrittenTwoWaysMessage('1/2"', "15.9 mm")).toBe('the size is written two different ways (1/2" and 15.9 mm) - price this row by hand');
    expect(INCH_MM_ECHO_MM).toBe(0.5);
  });
  it("NEGATIVE: no inch head, no bracket, or a bare number is not its business", () => {
    for (const t of ["50mm dia (65mm)", "22.3 mm O.D (wall Thickness-1.0 mm)", '1/2"', "12.7", "(12.7mm)", null, 12.7]) expect(inchWithMmEcho(t as string)).toBeNull();
  });
  it("the tolerance edge: 0.5 mm agrees, 0.6 mm does not", () => {
    expect(inchWithMmEcho('1/2" (13.2mm)')).toEqual({ head: '1/2"' });
    expect(inchWithMmEcho('1/2" (13.3mm)')).toHaveProperty("conflict");
  });
});

describe("AC1 the sweep: every Piping / Insulation size reader, model-read and typed", () => {
  // The readers: the pipe's own size (Piping size_mm), the section's pipe size (Insulation pipe_size_mm inside a
  // Piping row), and Insulation's own pipe size on an Insulation row.
  const READERS: Array<{ name: string; read: (size: string) => { block: ItemBlockView; priced: boolean; values: Shown["values"] }; id: string; stocked?: true; typed?: true }> = [
    { name: "Piping size_mm (model)", id: "size_mm", stocked: true, read: (sz) => { const r = panel(PIP, COPPER(sz)); return { block: r.v.items[0], priced: (r.v.items[0].state === "priced"), values: r.values }; } },
    { name: "section pipe_size_mm (model)", id: "pipe_size_mm", read: (sz) => { const r = panel(PIP, COPPER(sz)); const b = secBlock(attached(r.v)); return { block: b, priced: (b.state === "priced"), values: r.values }; } },
    { name: "Insulation pipe_size_mm (model)", id: "pipe_size_mm", read: (sz) => { const r = panel(INS, INSULATION(sz)); return { block: r.v.items[0], priced: (r.v.items[0].state === "priced"), values: r.values }; } },
    { name: "Piping size_mm (typed)", id: "size_mm", stocked: true, typed: true, read: (sz) => {
      let st = panel(PIP, COPPER("10mm")).v.editState;
      for (const op of [{ op: "set_other", index: 0, id: "size_mm", on: true }, { op: "set_attr", index: 0, id: "size_mm", value: sz }] as ItemEditOp[]) st = applyItemEdit(st, op);
      const r = panel(PIP, COPPER("10mm"), "Rmt", "", [], st); return { block: r.v.items[0], priced: (r.v.items[0].state === "priced"), values: r.values }; } },
    { name: "Insulation pipe_size_mm (typed)", id: "pipe_size_mm", typed: true, read: (sz) => {
      let st = panel(INS, INSULATION("10mm")).v.editState;
      for (const op of [{ op: "set_other", index: 0, id: "pipe_size_mm", on: true }, { op: "set_attr", index: 0, id: "pipe_size_mm", value: sz }] as ItemEditOp[]) st = applyItemEdit(st, op);
      const r = panel(INS, INSULATION("10mm"), "Rmt", "", [], st); return { block: r.v.items[0], priced: (r.v.items[0].state === "priced"), values: r.values }; } },
  ];
  for (const rd of READERS) {
    it(`${rd.name}: every agreeing spelling prices at its stocked size, no two-ways line`, () => {
      // a TYPED size keeps the 12e-4b one-size forms: an inch mark followed by "dia" is not one of them, bracket or
      // not, so the typed sweep takes the spellings without it (reported as a finding, not changed here)
      for (const [sz, mm] of AGREE.filter(([t]) => !(rd.typed && /dia/i.test(t)))) {
        const { block, priced } = rd.read(sz);
        expect({ sz, priced, reason: block.reason ?? null }).toEqual({ sz, priced: true, reason: null });
        expect(lines(block).some((l) => TWO_WAYS.test(l))).toBe(false);
        if (rd.stocked) expect(field(block, rd.id).value).toBe(String(mm));
      }
    });
    it(`${rd.name}: NEGATIVE every disagreeing spelling refuses with the sentence, and the box shows no figure it refuses on`, () => {
      for (const [sz, inch, mm] of DISAGREE) {
        const { block, priced, values } = rd.read(sz);
        expect(priced).toBe(false);
        expect(lines(block)).toContain(sizeWrittenTwoWaysMessage(inch, mm));
        expect(values?.supply_rate).toBeUndefined();
        expect(field(block, rd.id).value).toBe("");
        expect(field(block, rd.id).blank).toBe(true);
      }
    });
  }
});

// =====================================================================================================
// AC2 -- one cladding over the outer surface
// =====================================================================================================
// BOQ-26-00162 / Water Side rows 17 and 18, AS STORED by BRSR-26-00454: 32 mm nitrile with 24G aluminium + glass cloth
// on a 50 / 40 mm MS pipe. 32 mm is above the stocked 25 mm, so it is composed as 13 + 19 mm.
const ROW = (size: string): Answer[] => [
  { pipe_type: "MS", pipe_type_as_written: "MS", size_mm: size, pipe_class: "Heavy class 'C'", insulated: "Yes" },
  { section: SEC, item: NITRILE, cladding: "24G Aluminium with Glass Cloth", thickness_mm: "32mm thick", pipe_size_mm: size, brand: null, material_as_written: "nitrile rubber foam sheet of density 50+/-2 kg/m3" }];
const H162 = ["CHILLED WATER PIPING with INSULATION."];
/** The girth each priced layer of a section ran with, read off the pure pricer's own pipeline results. */
function girths(configs: Map<string, RateCategoryConfig>, size: string): Array<number | undefined> {
  const spec = itemListPricingSpec(configs.get(INS)!)!;
  const s = stored(configs, PIP, ROW(size)[1]);
  const r = priceItemList(spec, ITEMS, "Rmt", [{ attributes: s.attributes }] as never, "", "");
  return r.items.map((it) => {
    const g = (it.pipelineResults ?? [])[0]?.steps.find((st) => st.produced?.key === "girth");
    return g?.produced?.value;
  });
}

describe("AC2 composed insulation: ONE cladding over the outer surface", () => {
  it("00162 row 17 (50 mm, 32 mm as 13 + 19): the outer layer's girth is 3.14 x (50 + 2 x 32) / 1000, with its working line", () => {
    const g = girths(KEYED, "50mm. Dia");
    expect(g.length).toBe(2);
    // 12e-6 AC1 INVERTED by mechanical authority (owner R7, STANDING: "mm = NB and NB = mm"): "50mm. Dia" is not an outside
    // diameter, so the ONE wrap (unchanged, 12e-5b R7) sits on the MATCHED size. BEFORE: girth 3.14 x (50 + 2 x 32) / 1000 and the line
    // "... -- pipe size as read 50 + 2 x 32 (the total thickness) = 114 mm".
    expect(g[1]).toBeCloseTo((3.14 * (53.98 + 2 * 32)) / 1000, 9);
    const r = panel(PIP, ROW("50mm. Dia"), "Rmt.", "50mm. Dia", H162);
    const sec = attached(r.v);
    expect(sec.view.items.flatMap((b) => b.working.map((w) => w.trim()))).toContain("cladding: ONE wrap over the outer surface -- pipe size as matched (mm = NB, not an outside diameter) 53.98 + 2 x 32 (the total thickness) = 117.98 mm");
    // the negative half kept: the same row written as an OUTSIDE diameter wraps on the size as read, as before
    expect(girths(KEYED, "50 mm O.D.")[1]).toBeCloseTo((3.14 * (50 + 2 * 32)) / 1000, 9);
  });
  it("00162 row 18 (40 mm): 3.14 x (40 + 2 x 32) / 1000", () => {
    // 12e-6 AC1 INVERTED by mechanical authority (owner R7, STANDING: "mm = NB and NB = mm"): "50mm. Dia" is not an outside
    // diameter, so the ONE wrap (unchanged, 12e-5b R7) sits on the MATCHED size. BEFORE: 3.14 x (40 + 2 x 32) / 1000.
    expect(girths(KEYED, "40mm Dia")[1]).toBeCloseTo((3.14 * (41.28 + 2 * 32)) / 1000, 9);
  });
  it("NEGATIVE the inner layer carries no cladding and keeps the config's own girth step", () => {
    const g = girths(KEYED, "50mm. Dia");
    const plain = girths(PLAIN, "50mm. Dia");
    expect(g[0]).toBe(plain[0]);
  });
  it("NEGATIVE before the keys (v38 as shipped) the outer layer wraps only its own thickness -- the defect", () => {
    const plain = girths(PLAIN, "50mm. Dia");
    expect(plain[1]).not.toBeCloseTo((3.14 * 114) / 1000, 6);
  });
  // INVERTED at 12e-5b2 (owner R6: "use the original size everywhere"). BEFORE: "NEGATIVE a one-layer row prices
  // byte-identically with and without the keys" -- a.values equal to b.values (1,683 / 574) and the same working.
  it("a one-layer row WITH the keys measures its cladding on the pipe as read (50, not 53.98); without them it does not", () => {
    const one: Answer[] = [{ ...ROW("50mm. Dia")[0] }, { ...ROW("50mm. Dia")[1], thickness_mm: "19mm" }];
    const a = panel(PIP, one, "Rmt.", "50mm. Dia", H162, undefined, KEYED);
    const b = panel(PIP, one, "Rmt.", "50mm. Dia", H162, undefined, PLAIN);
    // 12e-6 AC1 INVERTED by mechanical authority (owner R7: "mm = NB"): BEFORE a.values [1669, 574] (on the size as read 50)
    // with the line "cladding: measured on the pipe size as read 50 (not the 53.98 it was priced at) + 2 x 19 ...". AFTER the
    // keyed row is on the matched size like the plain one, and says so; the OD form keeps the as-read figure (the negative half).
    expect(fig(a.values)).toEqual([1683, 574]);
    expect(fig(b.values)).toEqual([1683, 574]);
    expect(attached(a.v).view.items.flatMap((x) => x.working.map((w) => w.trim()))).toContain("cladding: measured on the matched size 53.98 (mm = NB: the size as read, 50, is not an outside diameter)");
    const od: Answer[] = [{ ...ROW("50 mm O.D.")[0] }, { ...ROW("50 mm O.D.")[1], thickness_mm: "19mm" }];
    const c = panel(PIP, od, "Rmt.", "50 mm O.D.", H162, undefined, KEYED);
    expect(fig(c.values)).toEqual([1669, 574]);
    expect(attached(c.v).view.items.flatMap((x) => x.working.map((w) => w.trim()))).toContain("cladding: measured on the pipe size as read 50 (not the 53.98 it was priced at) + 2 x 19 (the thickness) = 88 mm");
    expect(attached(b.v).view.items.flatMap((x) => x.working).some((w) => w.trim().startsWith("cladding: measured"))).toBe(false);
  });
  it("the calculator: a typed pipe size counts as the size as read", () => {
    const st: ItemListEditState = { items: [{ base: null, family: NITRILE, attrs: { cladding: "24G Aluminium", thickness_mm: "32", pipe_size_mm: "50" } }] } as unknown as ItemListEditState;
    const r = calc(INS, st);
    const w = r.v.items.flatMap((b) => b.working.map((x) => x.trim())).find((l) => l.startsWith("cladding: ONE wrap"));
    // 12e-6 AC1 INVERTED (owner R7: a typed 50 is mm = NB too). BEFORE "... -- pipe size as read 50 + 2 x 32 (the total thickness) = 114 mm"
    expect(w).toBe("cladding: ONE wrap over the outer surface -- pipe size as matched (mm = NB, not an outside diameter) 53.98 + 2 x 32 (the total thickness) = 117.98 mm");
  });
});

// =====================================================================================================
// AC3 -- GI cladding as written
// =====================================================================================================
// SYNTHETIC: the answer v39 asks for -- the cladding choice left out ("None"), the words copied into
// cladding_as_written. The 00321 sheet's own words are "26 G GI cladding".
const GI = (asWritten: string | null, cladding: string | null = "None"): Answer[] => [
  { pipe_type: "MS", pipe_type_as_written: "MS", size_mm: "50 mm dia", pipe_class: "C Class", insulated: "Yes" },
  { section: SEC, item: NITRILE, cladding, thickness_mm: "19mm", pipe_size_mm: "50 mm dia", brand: null, material_as_written: "nitrile rubber", cladding_as_written: asWritten }];

describe("AC3 GI cladding, as written, priced as aluminium of its gauge", () => {
  it("26 G GI cladding -> 26G Aluminium, with the amber line on the cladding box", () => {
    const r = panel(PIP, GI("26 G GI cladding"));
    const b = secBlock(attached(r.v));
    expect((b.state === "priced")).toBe(true);
    const f = field(b, "cladding");
    expect(f.value).toBe("26G Aluminium");
    expect(f.rule).toBe("BoQ says 26 G GI cladding -> priced as 26G Aluminium");
    const same = panel(PIP, GI(null, "26G Aluminium"));
    expect(fig(r.values)).toEqual(fig(same.values));
  });
  it("24 SWG GI -> 24G; GI with no gauge -> 26G", () => {
    expect(field(secBlock(attached(panel(PIP, GI("24 SWG G.I. sheet")).v)), "cladding").value).toBe("24G Aluminium");
    expect(field(secBlock(attached(panel(PIP, GI("GI sheet cladding")).v)), "cladding").value).toBe("26G Aluminium");
  });
  it("NEGATIVE a gauge the table does not list refuses -- never priced without the cladding asked for", () => {
    const b = secBlock(attached(panel(PIP, GI("22 G GI cladding")).v));
    expect((b.state === "priced")).toBe(false);
    expect(lines(b)).toContain("BoQ says 22 G GI cladding - the catalogue has no cladding of that gauge - price this row by hand");
  });
  it("NEGATIVE an answered cladding wins over the words; no GI word, no mapping; without the keys, nothing maps", () => {
    expect(field(secBlock(attached(panel(PIP, GI("26 G GI cladding", "24G Aluminium")).v)), "cladding").value).toBe("24G Aluminium");
    const noWord = secBlock(attached(panel(PIP, GI("aluminium sheet")).v));
    expect(field(noWord, "cladding").rule ?? "").not.toMatch(/BoQ says/);
    const plain = secBlock(attached(panel(PIP, GI("26 G GI cladding"), "Rmt", "", [], undefined, PLAIN).v));
    expect(field(plain, "cladding").rule ?? "").not.toMatch(/BoQ says/);
  });
});

// =====================================================================================================
// AC4 -- closed cell polyethylene
// =====================================================================================================
// BOQ-26-00273 / 247 - VRF System row 61, AS STORED by BRSR-26-00461.
const PE = (asWritten: string, item = "none of these"): Answer[] => [
  { pipe_type: "CPVC", pipe_type_as_written: "CPVC", size_mm: "20 mm dia.", pipe_class: null, insulated: "Yes" },
  { section: SEC, item, cladding: "None", thickness_mm: "6 mm", pipe_size_mm: "20 mm dia.", brand: null, material_as_written: asWritten }];
const H273 = ["CPVC Pipes with 6mm thick Closed Cell Polyethylene"];

describe("AC4 closed cell polyethylene is priced as nitrile", () => {
  it("00273 row 61 (per metre, on a pipe): Nitrile Rubber, with the amber family line", () => {
    const r = panel(PIP, PE("6 mm thick closed cell polyethylene"), "Rmt", "20 mm dia.", H273);
    const b = secBlock(attached(r.v));
    expect((b.state === "priced")).toBe(true);
    expect(lines(b)).toContain(`BoQ says closed cell polyethylene -> priced as ${NITRILE}`);
    const same = panel(PIP, PE("nitrile", NITRILE), "Rmt", "20 mm dia.", H273);
    expect(fig(r.values)).toEqual(fig(same.values));
  });
  it("per sq.m (a duct / sheet): Thermal Nitrile", () => {
    const r = panel(INS, [{ item: "none of these", cladding: "None", thickness_mm: "13 mm", pipe_size_mm: null, brand: null, material_as_written: "closed-cell PE foam" }], "sqm");
    expect(lines(r.v.items[0])).toContain(`BoQ says closed cell polyethylene -> priced as ${THERMAL}`);
  });
  it("NEGATIVE plain polyethylene, PE foam, XLPE: still refused by name; without the keys, closed cell refuses too", () => {
    for (const m of ["polyethylene", "PE foam", "XLPE", "cross linked polyethylene"]) {
      const b = secBlock(attached(panel(PIP, PE(m), "Rmt", "20 mm dia.").v));
      expect({ m, priced: (b.state === "priced") }).toEqual({ m, priced: false });
    }
    const plain = secBlock(attached(panel(PIP, PE("6 mm thick closed cell polyethylene"), "Rmt", "20 mm dia.", H273, undefined, PLAIN).v));
    expect((plain.state === "priced")).toBe(false);
  });
});

// =====================================================================================================
// AC8a -- the section's SKU line names the insulation
// =====================================================================================================
describe("AC8a a priced insulation section names its insulation", () => {
  it("the SKU line is '<family> (<unit>)', never ' / (Mts)'", () => {
    const b = secBlock(attached(panel(PIP, COPPER("12.7mm")).v));
    expect((b.state === "priced")).toBe(true);
    expect(b.skuLine).toMatch(new RegExp(`^${NITRILE} \\(`));
    expect(b.skuLine).not.toMatch(/^ \/ /);
  });
  it("NEGATIVE a Piping pipe keeps its own SKU line (it has an item name)", () => {
    const b = panel(PIP, COPPER("12.7mm")).v.items[0];
    expect(b.skuLine ?? "").not.toMatch(new RegExp(`^${NITRILE}`));
  });
});

// =====================================================================================================
// v39 -- the asset ships exactly the keys this file prices with, and the real rows price on it
// =====================================================================================================
// v39's items are v38's byte for byte (test_piping_v34.test_29), so ITEMS stays the catalogue; only the configs move.
const V39 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v39.json`, import.meta.url));
const LIVE = new Map<string, RateCategoryConfig>(V39.category_configs.map((c) => [c.category_id, c]));

describe("v39 (AC2 / AC3 / AC4 / AC8b) -- the shipped keys and the real rows", () => {
  it("the Insulation config ships V39_INSULATION_KEYS exactly", () => {
    const pr = (LIVE.get(INS) as unknown as { list_spec: { pricing: Record<string, unknown> & { compose: Record<string, unknown> } } }).list_spec.pricing;
    expect(pr.compose.outer_surface).toEqual(V39_INSULATION_KEYS.outer_surface);
    expect(pr.choice_text).toEqual(V39_INSULATION_KEYS.choice_text);
    expect(pr.material_text).toEqual(V39_INSULATION_KEYS.material_text);
  });
  it("00162 rows 17 / 18 (AC2), 00273 row 61 (AC4) and a GI cladding (AC3) price on v39 as on the keyed v38", () => {
    for (const [answer, unit, desc, h] of [
      [ROW("50mm. Dia"), "Rmt.", "50mm. Dia", H162], [ROW("40mm Dia"), "Rmt.", "40mm Dia", H162],
      [PE("6 mm thick closed cell polyethylene"), "Rmt", "20 mm dia.", H273], [GI("26 G GI cladding"), "Rmt", "", []],
    ] as Array<[Answer[], string, string, string[]]>) {
      const live = panel(PIP, answer, unit, desc, h, undefined, LIVE);
      expect(live.v.rowPriced).toBe(true);
      expect(live.values).toEqual(panel(PIP, answer, unit, desc, h, undefined, KEYED).values);
    }
  });
  it("NEGATIVE v38 as shipped: 00273 row 61 refuses and 00162 row 17 prices differently", () => {
    expect(panel(PIP, PE("6 mm thick closed cell polyethylene"), "Rmt", "20 mm dia.", H273, undefined, PLAIN).v.rowPriced).toBe(false);
    expect(panel(PIP, ROW("50mm. Dia"), "Rmt.", "50mm. Dia", H162, undefined, LIVE).values)
      .not.toEqual(panel(PIP, ROW("50mm. Dia"), "Rmt.", "50mm. Dia", H162, undefined, PLAIN).values);
  });
  it("AC8b: an insulation section on a count unit says what insulation is priced by; v38 said 'not a count, area or length unit'", () => {
    // INVERTED at ADP-3a (owner 13:35, U5: a unit the kind is not stocked in names the unit and the stocked ones) by mechanical authority: BEFORE "unit 'Nos' is not a length or area unit - insulation is priced per metre or per sq.m"
    const sentence = "Nitrile Rubber Insulation is not stocked per 'Nos' (stocked per metre) - price this row by hand";
    const sec = (configs: Map<string, RateCategoryConfig>) => attached(panel(PIP, COPPER("12.7mm"), "Nos", "", [], undefined, configs).v).view;
    expect(sec(LIVE).reason).toBe(sentence);
    // INVERTED at ADP-3a (owner 13:35, U5) by mechanical authority: BEFORE "unit 'Nos' is not a count, area or length unit" (the same U5 sentence on both configs now)
    expect(sec(PLAIN).reason).toBe("Nitrile Rubber Insulation is not stocked per 'Nos' (stocked per metre) - price this row by hand");
    expect(panel(INS, INSULATION("12.7mm"), "Nos", "", [], undefined, LIVE).v.items[0].reason).toBe(sentence);
  });
});
