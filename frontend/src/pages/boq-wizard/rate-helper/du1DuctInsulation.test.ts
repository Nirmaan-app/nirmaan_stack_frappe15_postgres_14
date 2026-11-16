/**
 * THE DUCT'S INSULATION LINE ON ITS SHEET AND THE LIVE INSULATION LINK.
 * DU-3 (R1 the 90% rule + R2 which rows count; owner 2026-11-16 16:31 / 16:33 / 16:37 / 16:38; QR-1 Q1 unit test, Q3, Q4 18:06)
 * REPLACES DU-1's DR7 "any separate row -> no line" and the G-3 70 / 30 check with its "left for a person" (INVERTED here by the
 * slice's own rulings; the negative halves kept: no separate row -> priced as usual; the calculator never runs the check):
 *  - no separate duct-insulation row -> the line is priced as usual, no note;
 *  - separate rows >= the threshold (the Pricing Input, read live; exactly at = covered) -> no line, "Insulation is priced separately in
 *    row(s) ..." ;
 *  - below the threshold, or a quantity missing on either side -> the line IS priced, "Possible double counting ...";
 *  - no outcome leaves the row unpriced for a person;
 *  - R2: a row counts by its words / any heading naming duct / a plain "Insulation" heading; never in running metres, never one whose
 *    own words or nearer heading name pipes / AHU / equipment, never a building surface named by the row or an insulation heading.
 *  - THE LINK (DU-1, unchanged): the duct row's insulation line is Insulation's own figure, read live.
 */
import { describe, expect, it } from "vitest";
import { buildExtractionByRow, ductInsulationDecision, makePricingSheetHelper, sheetInsulationOf, type ItemListSuggestion, type ItemListView, type RowContextWithUnit } from "./pricingSheetHelper";
import { itemListPricingSpec } from "./itemListPricing";
import { ITEMS, cell, ductItems } from "./du1Duct.harness";
import { SI_V75, cfgV75, itemsV75 } from "./du3Insulation.harness";

const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const DUCT = "hvac_ducting";
const INS = "hvac_insulation";
const CFG75 = cfgV75();
const spec = itemListPricingSpec(CFG75.get(DUCT) as never)!;
const SI = spec.sheet_insulation!;
const I90 = itemsV75(0.9) as never;
type SheetRow = NonNullable<RowContextWithUnit["sheetInsulation"]>["rows"][number];
const insRow = (row: number, qty: number | null): SheetRow => ({ row, qty, unit: "Sqm", why: "words" });
const ctxOf = (rows: SheetRow[], ducts: Array<{ row: number; area: number | null }>) => ({ sheetInsulation: { rows, ducts } } as unknown as RowContextWithUnit);

describe("DU-3 R1 decision (the 90% rule, threshold read live from the Pricing Input)", () => {
  it("no separate duct-insulation row on the sheet -> the insulation line is priced as usual, no note", () => {
    expect(ductInsulationDecision(SI, ctxOf([], [{ row: 5, area: 100 }]), I90)).toEqual({ action: "price" });
  });
  it(">= 90% -> no line; the note names the single row as 'row 40' (R8 wording)", () => {
    const d = ductInsulationDecision(SI, ctxOf([insRow(40, 95)], [{ row: 5, area: 100 }]), I90);
    expect(d.action).toBe("drop");
    expect(d.line).toBe("Insulation is priced separately in row 40 - not included in this row. (The separate rows cover about 95% of the insulated duct quantity on this sheet: 95 of 100 sq.m; threshold 90%.)");
  });
  it("exactly at the threshold = covered (edge c), also when the sum is not exact in floating point", () => {
    expect(ductInsulationDecision(SI, ctxOf([insRow(40, 90)], [{ row: 5, area: 100 }]), I90).action).toBe("drop");
    expect(ductInsulationDecision(SI, ctxOf([insRow(40, 0.3 * 3), insRow(41, 0)], [{ row: 5, area: 1 }]), I90).action).toBe("drop");
  });
  it("below 90% -> the line IS priced with the double-counting note naming 'rows 40, 41'", () => {
    const d = ductInsulationDecision(SI, ctxOf([insRow(40, 10), insRow(41, 5)], [{ row: 5, area: 100 }]), I90);
    expect(d.action).toBe("add");
    expect(d.line).toBe("Possible double counting - insulation is also priced separately in rows 40, 41. Check before quoting. (The separate rows cover about 15% of the insulated duct quantity on this sheet: 15 of 100 sq.m; threshold 90%.)");
  });
  it("quantities missing on either side (edge a) -> priced + the double-counting note, no percentage", () => {
    expect(ductInsulationDecision(SI, ctxOf([insRow(40, null)], [{ row: 5, area: 100 }]), I90))
      .toEqual({ action: "add", line: "Possible double counting - insulation is also priced separately in row 40. Check before quoting." });
    expect(ductInsulationDecision(SI, ctxOf([insRow(40, 50)], [{ row: 5, area: null }]), I90).action).toBe("add");
    expect(ductInsulationDecision(SI, ctxOf([insRow(40, 50)], []), I90).action).toBe("add");
  });
  it("THE THRESHOLD IS READ LIVE: 60% is below 90% but covered when the Pricing Input says 50%; at 61% the 60% sheet flips back", () => {
    const ctx = ctxOf([insRow(40, 60)], [{ row: 5, area: 100 }]);
    expect(ductInsulationDecision(SI, ctx, I90).action).toBe("add");
    expect(ductInsulationDecision(SI, ctx, itemsV75(0.5) as never).action).toBe("drop");
    expect(ductInsulationDecision(SI, ctx, itemsV75(0.6) as never).action).toBe("drop");
    expect(ductInsulationDecision(SI, ctx, itemsV75(0.61) as never).action).toBe("add");
  });
  it("the threshold Pricing Input absent -> priced + the note and the 'not set' line (never unpriced)", () => {
    const d = ductInsulationDecision(SI, ctxOf([insRow(40, 95)], [{ row: 5, area: 100 }]), itemsV75(null) as never);
    expect(d.action).toBe("add");
    expect(d.line).toContain("is not set - set it in Pricing Inputs");
  });
  it("no outcome is 'unpriced' (the G-3 'left for a person' state is gone)", () => {
    for (const q of [0, 10, 29, 30, 50, 69, 70, 89, 90, 120, null]) {
      expect(["price", "drop", "add"]).toContain(ductInsulationDecision(SI, ctxOf([insRow(40, q)], [{ row: 5, area: 100 }]), I90).action);
    }
  });
});

describe("DU-3 R2: which rows count as the sheet's separate DUCT insulation", () => {
  const ext = buildExtractionByRow([
    { excel_row: 5, description: "GI round duct 200 mm dia 24G with 13 mm insulation", category_id: DUCT, attributes: {},
      items: [{ attributes: { duct_type: cell("Round (GI) - per metre"), size_as_written: cell("200 mm dia"), insulated: cell("Yes") } }] },
    { excel_row: 6, description: "GI rectangular duct 24G", category_id: DUCT, attributes: {}, items: [{ attributes: { duct_type: cell("Rectangular (GI)"), insulated: cell("Yes") } }] },
  ] as never);
  const L = (row: number, text: string, unit: string, headings: string[]) => ({ row, text, unit, heading: headings[headings.length - 1], ...(headings.length > 1 ? { headings } : {}) });
  const ctx = {
    excelRow: 9, sheetLines: [
      L(5, "GI round duct 200 mm dia 24G with 13 mm insulation", "Rmt", ["HVAC", "Ducting"]),
      L(6, "GI rectangular duct 24G", "Sqm", ["HVAC", "Ducting"]),
      L(40, "Thermal insulation of supply air duct, 13 mm nitrile", "Sq.ft", ["HVAC", "Insulation"]),            // own words: duct
      L(41, "13 mm nitrile, factory laminated", "Sqm", ["HVAC", "Duct insulation", "Thermal"]),                   // a heading names duct
      L(42, "19 mm nitrile sheet", "Sqm", ["First floor", "Insulation"]),                                        // plain heading ("floor" not an insulation heading)
      L(43, "Nitrile insulation 19 mm", "Rmt", ["HVAC", "Insulation"]),                                          // running metres -> pipe
      L(44, "Nitrile insulation for chilled water pipes", "Sqm", ["HVAC", "Insulation"]),                        // own words: pipe
      L(45, "Acoustic insulation 25 mm", "Sqm", ["HVAC", "Insulation", "AHU room"]),                             // nearer heading: AHU
      L(46, "Under deck insulation 50 mm PIR", "Sqm", ["HVAC", "Insulation"]),                                   // own words: building surface
      L(47, "Acoustic panels 25 mm", "Sqm", ["HVAC", "Wall insulation"]),                                        // an insulation heading names a wall
      L(48, "Nitrile 13 mm", "Sqm", ["HVAC", "Miscellaneous"]),                                                  // no duct word, no plain heading
      L(49, "Nitrile insulation 9 mm", "Nos", ["HVAC", "Insulation"]),                                           // quantity 0 counts as 0
      L(50, "Nitrile 19 mm", "Sqm", ["Pipe insulation", "Insulation"]),                                          // plain heading, but a farther one names pipes
    ],
    sheetCategories: { 5: DUCT, 6: DUCT, 40: INS, 41: INS, 42: INS, 43: INS, 44: INS, 45: INS, 46: INS, 47: INS, 48: INS, 49: INS, 50: INS },
    rowQuantities: { 5: 10, 6: 20, 40: 100, 41: 3, 42: 7, 43: 50, 44: 60, 45: 70, 46: 80, 47: 90, 48: 11, 49: 0, 50: 5 },
  } as unknown as RowContextWithUnit;
  const s = sheetInsulationOf(SI, spec, ctx, undefined, ext, DUCT);
  it("counted: own duct words, a duct heading in the chain, a plain 'Insulation' heading, and a 0-quantity row (Q4)", () => {
    expect(s.rows.map((r) => [r.row, r.why])).toEqual([[40, "words"], [41, "heading"], [42, "plain_heading"], [49, "plain_heading"]]);
    expect(s.rows[0].qty).toBeCloseTo(100 * 0.0929, 6);
    expect(s.rows.map((r) => r.qty).slice(1)).toEqual([3, 7, 0]);
  });
  it("NOT counted, each with its reason: running metres, pipe words, an AHU heading nearer, a building surface, no duct link", () => {
    expect((s.excluded ?? []).map((e) => e.row)).toEqual([43, 44, 45, 46, 47, 48, 50]);
    const why = Object.fromEntries((s.excluded ?? []).map((e) => [e.row, e.why]));
    expect(why[43]).toContain("running metres");
    expect(why[44]).toContain("pipes");
    expect(why[45]).toContain("AHU");
    expect(why[46]).toContain("Under deck");
    expect(why[47]).toContain("Wall");
    expect(why[48]).toBe("no duct word and no plain Insulation heading");
    // R2 "unless its words / headings clearly name pipes": a plain 'Insulation' heading under 'Pipe insulation' never counts
    expect(why[50]).toContain("Pipe insulation");
  });
  it("a long scope preamble heading is not read as naming equipment; a duct word anywhere nearer still wins", () => {
    const pre = "SITC of the following items including all equipment, supports, hangers and accessories as per the specification and the drawings, complete in all respects";
    const c2 = { ...ctx, sheetLines: [L(6, "GI rectangular duct 24G", "Sqm", ["Ducting"]), L(60, "Nitrile 13 mm", "Sqm", ["Insulation", pre]),
      L(61, "Thermal insulation of ducts", "Sqm", ["DRAIN PIPING & AIR DISTRIBUTION WORKS"])], sheetCategories: { 6: DUCT, 60: INS, 61: INS },
      rowQuantities: { 6: 20, 60: 5, 61: 4 } } as unknown as RowContextWithUnit;
    expect(sheetInsulationOf(SI, spec, c2, undefined, ext, DUCT).rows.map((r) => r.row)).toEqual([60, 61]);
  });
  it("insulated duct rows: a per-metre round row by 3.14 x dia, a per-sq.m row by its quantity (unchanged)", () => {
    expect(s.ducts.map((d) => d.row)).toEqual([5, 6]);
    expect(s.ducts[0].area).toBeCloseTo(10 * 3.14 * 0.2, 6);
    expect(s.ducts[1].area).toBe(20);
  });
});

const priceDuct = (name: string, unit: string, opts: { items?: unknown[]; insQty?: number; calc?: boolean; noSheet?: boolean } = {}): ItemListView => {
  const rows = [{ excel_row: 9, description: name, category_id: DUCT, attributes: {}, items: ductItems(name) }];
  const h = makePricingSheetHelper({ configsByCategory: CFG75 as never, items: (opts.items ?? I90) as never, extractionByRow: buildExtractionByRow(rows as never) });
  const sheet = opts.noSheet ? {} : {
    sheetLines: [{ row: 9, text: name, unit }, ...(opts.insQty !== undefined ? [{ row: 40, text: "Thermal insulation of duct, 13 mm nitrile", unit: "Sqm", heading: "Insulation" }] : [])],
    sheetCategories: { 9: DUCT, 40: INS }, rowQuantities: { 9: 50, 40: opts.insQty ?? 0 },
  };
  return (h.compute({ excelRow: 9, description: name, nodeType: "Line Item", category: DUCT, discipline: "HVAC", rateKinds: KINDS, unit,
    headings: [], ownNotes: [], headingNotes: [], ...sheet, ...(opts.calc ? { noRow: true } : {}) } as never, {}) as unknown as ItemListSuggestion).itemList!;
};
const tot = (v: ItemListView) => [Number(v.totals?.supply_rate), Number(v.totals?.install_rate)];

describe("DU-3 R1 on the panel (a duct row insulated = Yes, 50 sq.m, beside a separate duct-insulation row)", () => {
  const name = "GI Spiral/Oval with Insulation 24G + 13 mm insulation";
  const bare = tot(priceDuct("GI Spiral/Oval 24G", "Sqm"));
  it("covered (50 of 50 sq.m) -> the row prices WITHOUT the insulation line; the amber box names the row", () => {
    const v = priceDuct(name, "Sqm", { insQty: 50 });
    expect(v.rowPriced).toBe(true);
    expect(tot(v)).toEqual(bare);
    expect((v.sheetHeadingNotes ?? []).join(" ")).toContain("Insulation is priced separately in row 40 - not included in this row.");
  });
  it("below (20 of 50 sq.m) -> the row prices WITH the insulation line and the double-counting note", () => {
    const v = priceDuct(name, "Sqm", { insQty: 20 });
    expect(v.rowPriced).toBe(true);
    expect(tot(v)[0]).toBeGreaterThan(bare[0]);
    expect((v.sheetHeadingNotes ?? []).join(" ")).toContain("Possible double counting - insulation is also priced separately in row 40. Check before quoting.");
  });
  it("no separate row -> priced with the line, no insulation note; the same as below in figures", () => {
    const v = priceDuct(name, "Sqm");
    expect(tot(v)).toEqual(tot(priceDuct(name, "Sqm", { insQty: 20 })));
    expect((v.sheetHeadingNotes ?? []).join(" ")).not.toMatch(/priced separately/);
  });
  it("raising the threshold to 100% flips the covered sheet (50 of 50 stays covered; 45 of 50 becomes double counting)", () => {
    expect(tot(priceDuct(name, "Sqm", { insQty: 45, items: itemsV75(0.9) }))).toEqual(bare);
    expect(tot(priceDuct(name, "Sqm", { insQty: 45, items: itemsV75(1) }))[0]).toBeGreaterThan(bare[0]);
  });
});

describe("THE LIVE INSULATION LINK: the duct's insulation line follows Insulation's own rate (DU-1, unchanged)", () => {
  const name = "GI Round GI Duct with Insulation 200 mm 24G + 13 mm insulation";
  it("raising every Thermal Nitrile Insulation sheet cost by 100 raises the duct row by 100 x 3.14 x 0.2 per metre (rounded up as priced)", () => {
    const before = tot(priceDuct(name, "Mts", { noSheet: true }));
    const bumped = itemsV75(0.9).map((i) => {
      const a = i.attributes as Record<string, unknown> | undefined;
      const r = i.rates as Record<string, number> | undefined;
      return i.kind === "hvac_insulation_item" && a?.item === "Thermal Nitrile Insulation" && r && typeof r.cost_insulation === "number"
        ? { ...i, rates: { ...r, cost_insulation: r.cost_insulation + 100 } } : i;
    });
    expect(bumped.filter((i, k) => i !== itemsV75(0.9)[k]).length).toBeGreaterThan(0);
    const after = tot(priceDuct(name, "Mts", { items: bumped, noSheet: true }));
    expect(after[1]).toBe(before[1]);
    expect(after[0] - before[0]).toBeGreaterThanOrEqual(Math.floor(100 * 3.14 * 0.2));
  });
  it("the retired G-3 shape (v74 and earlier: no threshold_input) runs no sheet check -- the line prices, no insulation note", () => {
    const old = { ...SI_V75, mode: "doubtful_only", high: 0.7, low: 0.3 } as Record<string, unknown>;
    delete old.threshold_input;
    const name = "GI Spiral/Oval with Insulation 24G + 13 mm insulation";
    const rows = [{ excel_row: 9, description: name, category_id: DUCT, attributes: {}, items: ductItems(name) }];
    const h = makePricingSheetHelper({ configsByCategory: cfgV75(old) as never, items: ITEMS as never, extractionByRow: buildExtractionByRow(rows as never) });
    const v = (h.compute({ excelRow: 9, description: name, nodeType: "Line Item", category: DUCT, discipline: "HVAC", rateKinds: KINDS, unit: "Sqm",
      headings: [], ownNotes: [], headingNotes: [], sheetLines: [{ row: 9, text: name, unit: "Sqm" }, { row: 40, text: "Thermal insulation of duct", unit: "Sqm", heading: "Insulation" }],
      sheetCategories: { 9: DUCT, 40: INS }, rowQuantities: { 9: 50, 40: 50 } } as never, {}) as unknown as ItemListSuggestion).itemList!;
    expect(v.rowPriced).toBe(true);
    expect(tot(v)).toEqual(tot(priceDuct(name, "Sqm")));
    expect((v.sheetHeadingNotes ?? []).join(" ")).not.toMatch(/priced separately|left for a person/);
  });
});

describe("DU-3 R1: the threshold Pricing Input is 'used by' Ducting (Rate Master > Pricing Inputs)", () => {
  it("the v75 Ducting config names it; the retired v74 shape does not", async () => {
    const { pricingInputUsedBy } = await import("../../pricing/rate-master/rateMasterSpec");
    const used = pricingInputUsedBy([CFG75.get(DUCT) as never]);
    expect(used["ducting_insulation_coverage_threshold"]?.categories).toEqual([DUCT]);
    expect(used["ducting_install_only_uplift"]?.categories).toEqual([DUCT]);
    // the retired shape (no threshold_input), built here so the negative holds whatever the newest asset is
    const old = structuredClone(CFG75.get(DUCT)) as { list_spec: { pricing: { sheet_insulation: Record<string, unknown> } } };
    delete old.list_spec.pricing.sheet_insulation.threshold_input;
    expect(pricingInputUsedBy([old as never])["ducting_insulation_coverage_threshold"]).toBeUndefined();
  });
});
