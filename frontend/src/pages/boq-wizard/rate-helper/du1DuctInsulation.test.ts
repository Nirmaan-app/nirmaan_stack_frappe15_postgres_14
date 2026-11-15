/**
 * DU-1 PART B -- THE DUCT'S INSULATION LINE ON ITS SHEET (DR7 + G-3) AND THE LIVE INSULATION LINK, on the newest HVAC asset.
 *  - DR7: a sheet that quotes duct insulation on its own rows does not get it priced again inside the duct rows (mode
 *    "doubtful_only": a plain thermal duct-insulation row drops the line outright, with the line naming the rows).
 *  - G-3: where the separate rows are doubtful (another kind, or under an AHU / plant-room heading) -- and on every sheet in mode
 *    "all" -- their area is compared with the insulated duct area: at or above `high` the line drops, below `low` it is priced
 *    with a note, in between (or with quantities that cannot be compared) it is left for a person.
 *  - The calculator has no sheet: the check never runs there (the 97-row reachability prices every insulated row in it).
 *  - THE LINK: the duct row's insulation line is Insulation's own figure, read live -- a changed Insulation rate moves it.
 */
import { describe, expect, it } from "vitest";
import { buildExtractionByRow, ductInsulationDecision, makePricingSheetHelper, sheetInsulationOf, type ItemListSuggestion, type ItemListView, type RowContextWithUnit } from "./pricingSheetHelper";
import { itemListPricingSpec } from "./itemListPricing";
import { CFG, ITEMS, LATEST, cell, ductItems } from "./du1Duct.harness";

const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const DUCT = "hvac_ducting";
const INS = "hvac_insulation";
// the pricing spec as the product builds it (with the list_spec's family attribute)
const spec = itemListPricingSpec(CFG.get(DUCT) as never)!;
const SI = { ...spec.sheet_insulation! };
const ALL = { ...SI, mode: "all" as const };
type SheetRow = NonNullable<RowContextWithUnit["sheetInsulation"]>["rows"][number];
const insRow = (row: number, qty: number | null, more: Partial<SheetRow> = {}): SheetRow => ({ row, qty, unit: "Sqm", kind: "thermal", doubtful: null, ...more });
const ctxOf = (rows: SheetRow[], ducts: Array<{ row: number; area: number | null }>) => ({ sheetInsulation: { rows, ducts } } as unknown as RowContextWithUnit);

describe(`DU-1 DR7 / G-3 decision (${LATEST}: mode ${SI.mode}, high ${SI.high}, low ${SI.low})`, () => {
  it("no separate duct-insulation row on the sheet -> the insulation line is priced as usual", () => {
    expect(ductInsulationDecision(SI, ctxOf([], [{ row: 5, area: 100 }]), false)).toEqual({ action: "price" });
  });
  it("doubtful_only: a plain thermal duct-insulation row -> the line drops, naming the row", () => {
    const d = ductInsulationDecision(SI, ctxOf([insRow(40, 12)], [{ row: 5, area: 100 }]), false);
    expect(d.action).toBe("drop");
    expect(d.line).toBe("Duct insulation is quoted on its own row on this sheet (rows 40) - not priced in this row.");
  });
  it("doubtful (under an AHU heading), covering >= high -> drops with the coverage line", () => {
    const d = ductInsulationDecision(SI, ctxOf([insRow(40, 80, { doubtful: "AHU room" })], [{ row: 5, area: 100 }]), false);
    expect(d).toEqual({ action: "drop", line: "Duct insulation is quoted on its own row on this sheet (rows 40) - not priced in this row. The separate rows cover about 80% of the insulated duct area on this sheet (80 of 100 sq.m)." });
  });
  it("doubtful, covering < low -> priced in this row too, with the note", () => {
    const d = ductInsulationDecision(SI, ctxOf([insRow(40, 10, { doubtful: "AHU room" }), insRow(41, 5, { doubtful: "AHU room" })], [{ row: 5, area: 100 }]), false);
    expect(d.action).toBe("add");
    expect(d.line).toContain("(rows 40, 41) cover only about 15% of the insulated duct area (15 of 100 sq.m) - the insulation is priced in this row too.");
  });
  it("doubtful, between low and high -> left for a person", () => {
    const d = ductInsulationDecision(SI, ctxOf([insRow(40, 50, { doubtful: "AHU room" })], [{ row: 5, area: 100 }]), false);
    expect(d.action).toBe("unpriced");
    expect(d.line).toContain("cover about 50% of the insulated duct area (50 of 100 sq.m) - check whether they cover this duct; insulation left for a person.");
  });
  it("another kind (acoustic rows beside a thermal duct) is doubtful; quantities that cannot be compared -> left for a person", () => {
    const d = ductInsulationDecision(SI, ctxOf([insRow(40, null, { kind: "acoustic" })], [{ row: 5, area: 100 }]), false);
    expect(d.action).toBe("unpriced");
    expect(d.line).toContain("but of another kind or under a plant heading, and the quantities cannot be compared");
    // the same acoustic row beside an acoustic duct row is not doubtful -> dropped
    expect(ductInsulationDecision(SI, ctxOf([insRow(40, null, { kind: "acoustic" })], [{ row: 5, area: 100 }]), true).action).toBe("drop");
  });
  it("mode all: a plain row is compared too (< low -> add, >= high -> drop, no duct area -> drop)", () => {
    expect(ductInsulationDecision(ALL, ctxOf([insRow(40, 10)], [{ row: 5, area: 100 }]), false).action).toBe("add");
    expect(ductInsulationDecision(ALL, ctxOf([insRow(40, 90)], [{ row: 5, area: 100 }]), false).action).toBe("drop");
    expect(ductInsulationDecision(ALL, ctxOf([insRow(40, 50)], [{ row: 5, area: null }]), false).action).toBe("drop");
  });
});

describe("DU-1 DR7 / G-3: the sheet summary", () => {
  const ext = buildExtractionByRow([
    { excel_row: 5, description: "GI round duct 200 mm dia 24G with 13 mm insulation", category_id: DUCT, attributes: {},
      items: [{ attributes: { duct_type: cell("Round (GI) - per metre"), size_as_written: cell("200 mm dia"), insulated: cell("Yes") } }] },
    { excel_row: 6, description: "GI rectangular duct 24G", category_id: DUCT, attributes: {}, items: [{ attributes: { duct_type: cell("Rectangular (GI)"), insulated: cell("Yes") } }] },
  ] as never);
  const ctx = {
    excelRow: 9, sheetLines: [
      { row: 5, text: "GI round duct 200 mm dia 24G with 13 mm insulation", unit: "Rmt" },
      { row: 6, text: "GI rectangular duct 24G", unit: "Sqm" },
      { row: 40, text: "Thermal insulation of supply air duct, 13 mm nitrile", unit: "Sq.ft", heading: "Insulation" },
      { row: 41, text: "Acoustic lining of duct", unit: "Sqm", heading: "AHU room" },
    ],
    sheetCategories: { 5: DUCT, 6: DUCT, 40: INS, 41: INS }, rowQuantities: { 5: 10, 6: 20, 40: 100, 41: 3 },
  } as unknown as RowContextWithUnit;
  const s = sheetInsulationOf(SI, spec, ctx, undefined, ext, DUCT);
  it("separate rows: their kind, doubt (heading) and quantity in sq.m (a sq.ft quantity through the config's factor)", () => {
    expect(s.rows.map((r) => [r.row, r.kind, r.doubtful])).toEqual([[40, "thermal", null], [41, "acoustic", "AHU room"]]);
    expect(s.rows[0].qty).toBeCloseTo(100 * 0.0929, 6);
    expect(s.rows[1].qty).toBe(3);
  });
  it("insulated duct rows: a per-metre round row by 3.14 x dia, a per-sq.m row by its quantity", () => {
    expect(s.ducts.map((d) => d.row)).toEqual([5, 6]);
    expect(s.ducts[0].area).toBeCloseTo(10 * 3.14 * 0.2, 6);
    expect(s.ducts[1].area).toBe(20);
  });
});

const priceDuct = (name: string, unit: string, opts: { items?: typeof ITEMS; sheet?: boolean } = {}): ItemListView => {
  const rows = [{ excel_row: 9, description: name, category_id: DUCT, attributes: {}, items: ductItems(name) }];
  const h = makePricingSheetHelper({ configsByCategory: CFG as never, items: (opts.items ?? ITEMS) as never, extractionByRow: buildExtractionByRow(rows as never) });
  const sheet = opts.sheet ? {
    sheetLines: [{ row: 9, text: name, unit }, { row: 40, text: "Thermal insulation of duct, 13 mm nitrile", unit: "Sqm", heading: "Insulation" }],
    sheetCategories: { 9: DUCT, 40: INS }, rowQuantities: { 9: 50, 40: 50 },
  } : {};
  return (h.compute({ excelRow: 9, description: name, nodeType: "Line Item", category: DUCT, discipline: "HVAC", rateKinds: KINDS, unit,
    headings: [], ownNotes: [], headingNotes: [], ...sheet } as never, {}) as unknown as ItemListSuggestion).itemList!;
};
const tot = (v: ItemListView) => [Number(v.totals?.supply_rate), Number(v.totals?.install_rate)];

describe("DU-1 DR7 on the panel: a sheet quoting duct insulation on its own row", () => {
  const name = "GI Spiral/Oval with Insulation 24G + 13 mm insulation";
  it("the duct row's insulation line is not priced, the amber sheet box names the row; without that row it is priced", () => {
    const withRow = priceDuct(name, "Sqm", { sheet: true });
    const alone = priceDuct(name, "Sqm");
    const bare = priceDuct("GI Spiral/Oval 24G", "Sqm");
    expect(withRow.rowPriced).toBe(true);
    expect(tot(withRow)).toEqual(tot(bare));
    expect(withRow.sheetHeadingNotes ?? []).toContain("Duct insulation is quoted on its own row on this sheet (rows 40) - not priced in this row.");
    expect(tot(alone)[0]).toBeGreaterThan(tot(bare)[0]);
    expect(alone.sheetHeadingNotes ?? []).not.toContain("Duct insulation is quoted on its own row on this sheet (rows 40) - not priced in this row.");
  });
});

describe("DU-1 THE LIVE INSULATION LINK: the duct's insulation line follows Insulation's own rate", () => {
  const name = "GI Round GI Duct with Insulation 200 mm 24G + 13 mm insulation";
  it("raising every Thermal Nitrile Insulation sheet cost by 100 raises the duct row by 100 x 3.14 x 0.2 per metre (rounded up as priced)", () => {
    const before = tot(priceDuct(name, "Mts"));
    const bumped = ITEMS.map((i) => {
      const a = i.attributes as Record<string, unknown> | undefined;
      const r = i.rates as Record<string, number> | undefined;
      return i.kind === "hvac_insulation_item" && a?.item === "Thermal Nitrile Insulation" && r && typeof r.cost_insulation === "number"
        ? { ...i, rates: { ...r, cost_insulation: r.cost_insulation + 100 } } : i;
    });
    expect(bumped.filter((i, k) => i !== ITEMS[k]).length).toBeGreaterThan(0);
    const after = tot(priceDuct(name, "Mts", { items: bumped }));
    expect(after[1]).toBe(before[1]);
    // the per-sq.m Insulation figure rises by at least 100 (its markup on top); the per-metre line by at least 100 x 0.628
    expect(after[0] - before[0]).toBeGreaterThanOrEqual(Math.floor(100 * 3.14 * 0.2));
  });
});
