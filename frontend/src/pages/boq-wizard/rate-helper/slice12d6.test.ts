/**
 * SLICE 12d-6 (owner, 2026-10-08/09) -- INSULATION PANEL-PATH FIXES: the double layer, the hyphenated mixed
 * inch, the doubled unit in the field note, and (U4) a TYPED layered wording that must refuse rather than
 * price one layer.
 *
 * Every figure here is the LIVE v33 catalogue's, priced through the SAME `makePricingSheetHelper(...).compute`
 * the BoQ page and the calculator build -- the PANEL path -- because that is the path 12e-0b found broken:
 * the pure pricer composed "Double layer of 19mm thick" (991 / 238) while the panel handed it the dropdown
 * option "19" (615 / 224). A test on the pure pricer alone could never see it.
 *
 * ⚠️ The asset is READ at runtime, never `import`ed (a JSON import makes tsc infer a structural type for the
 * whole file).
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion, type ItemBlockView,
} from "./pricingSheetHelper";
import { TYPED_THICKNESS_MESSAGE, TYPED_THICKNESS_RE, itemListPricingSpec, priceItemList, readLayers, readNumber } from "./itemListPricing";

const ASSET = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
  new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v33.json", import.meta.url),
);
const INS = ASSET.category_configs.find((c) => c.category_id === "hvac_insulation")!;
const CONFIGS = new Map<string, RateCategoryConfig>([["hvac_insulation", INS]]);
const ITEMS: RateMasterItem[] = ASSET.items.map((it) => ({ ...it, discipline: ASSET.discipline } as RateMasterItem));
const SPEC = itemListPricingSpec(INS)!;
const NR = "Nitrile Rubber Insulation";

type Cells = ExtractionRow["attributes"];
const cells = (a: Record<string, string>): Cells =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));

/** The PANEL path: the row's STORED answer arrives through `extractionByRow`, exactly as the page hands it. */
function panel(answer: Record<string, string>, unit = "RMT") {
  const row = { excelRow: 1, description: answer.pipe_size_mm ?? "", attributes: {}, items: [{ attributes: cells(answer) }] } as ExtractionRow;
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx: RateHelperRowContext & { unit?: string } = {
    excelRow: 1, description: answer.pipe_size_mm ?? "", nodeType: "Line Item", category: "hvac_insulation",
    discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"], unit,
  };
  const r = h.compute(ctx, {});
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const v = (r as ItemListSuggestion).itemList!;
  return { r: r as ItemListSuggestion, v, block: v.items[0] as ItemBlockView };
}

/** The CALCULATOR path: an empty extraction map, every value TYPED through the edit state (Other... for a text). */
function calculator(attrs: Record<string, string>, other: string[]) {
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
  const edits = { items: [{ base: null, family: NR, attrs, other }] };
  const r = h.compute(
    { excelRow: 1, description: "", nodeType: "Line Item", category: "hvac_insulation", discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"] },
    { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(edits), [ROW_UNIT_OVERRIDE_KEY]: "mts" },
  );
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const v = (r as ItemListSuggestion).itemList!;
  return { r: r as ItemListSuggestion, v, block: v.items[0] as ItemBlockView };
}

const BASE = { item: NR, cladding: "26G Aluminium", pipe_size_mm: "50 mm" };
const thk = (b: ItemBlockView) => b.fields.find((f) => f.id === "thickness_mm")!;
const size = (b: ItemBlockView) => b.fields.find((f) => f.id === "pipe_size_mm")!;
const layerLines = (b: ItemBlockView) => b.working.filter((w) => /priced as two layers|^Layer \d of \d/.test(w));

describe("SLICE 12d-6 / AC1 -- a layered thickness survives option matching on the PANEL path", () => {
  it.each([
    ["(i)", "Double layer of 19mm thick"],
    ["(ii)", "Double layer of 19 mm"],
    ["(iii)", "Double layer of 19 mm thick"],
  ])("%s a model-read %j prices as TWO layers: 991 / 238, the stated text kept in the Other... box, the layer lines in the working", (_, stated) => {
    const { r, block } = panel({ ...BASE, thickness_mm: stated });
    expect(r.values).toEqual({ supply_rate: 991, install_rate: 238, combined_rate: 1229 });
    expect(block.state).toBe("priced");
    expect(layerLines(block)[0]).toBe(`BoQ says ${stated} -> priced as two layers, 19 + 19 mm (38 mm); cladding on the outer layer only`);
    expect(layerLines(block).filter((w) => /^Layer \d of 2/.test(w))).toHaveLength(2);
    // AC2: displayed the way "25 mm thick - 2 Layers" already is -- the Other... box holds the stated text
    expect(thk(block).otherMode).toBe(true);
    expect(thk(block).typedValue).toBe(stated);
    expect(thk(block).note).toBeUndefined();
  });

  it("(iv) \"25 mm thick - 2 Layers\" -> 1016 / 238 and (v) \"13+13\" -> 904 / 238, UNCHANGED by this slice", () => {
    const four = panel({ ...BASE, thickness_mm: "25 mm thick - 2 Layers" });
    expect(four.r.values).toEqual({ supply_rate: 1016, install_rate: 238, combined_rate: 1254 });
    expect(layerLines(four.block)[0]).toMatch(/^BoQ says 25 mm thick - 2 Layers -> priced as two layers, 25 \+ 25 mm \(50 mm\)/);
    const five = panel({ ...BASE, thickness_mm: "13+13" });
    expect(five.r.values).toEqual({ supply_rate: 904, install_rate: 238, combined_rate: 1142 });
    expect(layerLines(five.block)[0]).toMatch(/^BoQ says 13\+13 -> priced as two layers, 13 \+ 13 mm \(26 mm\)/);
  });

  it("(vi) a plain \"19 mm\" still option-matches and prices ONE layer: 615 / 224, no layer line", () => {
    const { r, block } = panel({ ...BASE, thickness_mm: "19 mm" });
    expect(r.values).toEqual({ supply_rate: 615, install_rate: 224, combined_rate: 839 });
    expect(layerLines(block)).toEqual([]);
    expect(thk(block).value).toBe("19");
    expect(thk(block).otherMode).toBe(false);
  });

  it("(vii) \"19mm thick - Single layer\" is ONE layer: 615 / 224 -- the layers reader does not accept a single layer", () => {
    expect(readLayers("19mm thick - Single layer")).toBeNull();
    const { r, block } = panel({ ...BASE, thickness_mm: "19mm thick - Single layer" });
    expect(r.values).toEqual({ supply_rate: 615, install_rate: 224, combined_rate: 839 });
    expect(layerLines(block)).toEqual([]);
    expect(thk(block).value).toBe("19");
  });

  it("(viii) \"25mm thick - Single layer\" at 65 NB still refuses on SIZE, the layer rule changes nothing there", () => {
    const { v } = panel({ ...BASE, pipe_size_mm: "65 NB", thickness_mm: "25mm thick - Single layer" });
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toContain("pipe size 65 is above the largest size on the sheet (53.98)");
  });

  it("the stored shape 12e-0 photographed (BOQ-26-00137 row 32: \"Double layer of 19mm thick\" at 250 NB) still refuses on size -- now as a composed row, the way a \"- 2 Layers\" row at that size already does", () => {
    const { v, block } = panel({ ...BASE, pipe_size_mm: "250 NB", thickness_mm: "Double layer of 19mm thick" });
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe("item 1 (Nitrile Rubber Insulation): pipe size 250 is above the largest size on the sheet (53.98)");
    expect(thk(block).otherMode).toBe(true);
    expect(thk(block).typedValue).toBe("Double layer of 19mm thick");
    const control = panel({ ...BASE, pipe_size_mm: "250 NB", thickness_mm: "25 mm thick - 2 Layers" });
    expect(control.v.reason).toBe("item 1 (Nitrile Rubber Insulation): pipe size 250 is above the largest size on the sheet (53.98)");
  });

  it("NEGATIVE -- the guard's predicate: `readLayers` accepts exactly the layered wordings and nothing a dropdown option could stand for", () => {
    expect(readLayers("Double layer of 19mm thick")).toEqual([19, 19]);
    expect(readLayers("Double layer of 19 mm")).toEqual([19, 19]);
    expect(readLayers("25 mm thick - 2 Layers")).toEqual([25, 25]);
    expect(readLayers("13+13")).toEqual([13, 13]);
    expect(readLayers("19 mm")).toBeNull();
    expect(readLayers("19")).toBeNull();
    expect(readLayers("19/ 25 / 32 mm")).toBeNull();
  });

  it("NEGATIVE -- the pure pricer agrees to the rupee, so the panel is now handing it what it reads", () => {
    const pure = priceItemList(SPEC, ITEMS, "RMT", [{ attributes: cells({ ...BASE, thickness_mm: "Double layer of 19mm thick" }) }]);
    expect(pure.priced).toBe(true);
    expect([pure.supply, pure.install]).toEqual([991, 238]);
  });
});

describe("SLICE 12d-6 / U4 -- the TYPED thickness box accepts a single number only (T6 kept and tightened)", () => {
  it.each([
    "Double layer of 19 mm thick", "Double layer of 19 mm", "Double layer of 19mm thick",
    "25 mm thick - 2 Layers", "13+13", "two layers of 19", "19 and 25", "thick", "19 mm thk",
  ])("typed %j in the calculator: NOT priced, refused with the ONE message -- never read as a 19", (typed) => {
    const { r, v, block } = calculator({ pipe_size_mm: "50", thickness_mm: typed, cladding: "26G Aluminium" }, ["pipe_size_mm", "thickness_mm"]);
    expect(r.values).toEqual({});
    expect(v.rowPriced).toBe(false);
    expect(block.reason).toBe(TYPED_THICKNESS_MESSAGE);
    expect(block.reason).toBe("Type the thickness as a single number in mm");
    expect(layerLines(block)).toEqual([]);
    expect(TYPED_THICKNESS_RE.test(typed)).toBe(false);
  });

  it("the same rule on a TYPED PANEL edit: the stored answer is overridden by a typed layered text -> refused", () => {
    const row = { excelRow: 1, description: "50 mm", attributes: {}, items: [{ attributes: cells({ ...BASE, thickness_mm: "19 mm" }) }] } as ExtractionRow;
    const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
    const edits = { items: [{ base: 0, family: null, attrs: { thickness_mm: "Double layer of 19 mm thick" }, other: ["thickness_mm"] }] };
    const r = h.compute(
      { excelRow: 1, description: "50 mm", nodeType: "Line Item", category: "hvac_insulation", discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"], unit: "RMT" } as RateHelperRowContext & { unit?: string },
      { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(edits) },
    );
    expect(isSuggestion(r)).toBe(true);
    const v = (r as ItemListSuggestion).itemList!;
    expect(v.rowPriced).toBe(false);
    expect(v.items[0].reason).toBe(TYPED_THICKNESS_MESSAGE);
  });

  it.each([["19", 615], ["19 mm", 615], ["19mm", 615], ["12.5", 556], ["9.5", 556]])(
    "POSITIVE -- a typed single number prices: %j -> supply %i (12.5 and 9.5 ladder to the stocked 13 mm)",
    (typed, supply) => {
      const { r } = calculator({ pipe_size_mm: "50", thickness_mm: typed, cladding: "26G Aluminium" }, ["pipe_size_mm", "thickness_mm"]);
      expect(TYPED_THICKNESS_RE.test(typed)).toBe(true);
      expect(r.values?.supply_rate).toBe(supply);
      expect(r.values?.install_rate).toBe(224);
    },
  );

  it("NEGATIVE -- the PIPE-SIZE box is NOT on this axis: a typed 5/8\" and a typed 1-1/4\" still read as inches and price", () => {
    const a = calculator({ pipe_size_mm: '5/8"', thickness_mm: "13", cladding: "No" }, ["pipe_size_mm"]);
    expect(a.r.values).toEqual({ supply_rate: 216, install_rate: 14, combined_rate: 230 });
    const b = calculator({ pipe_size_mm: '1-1/4"', thickness_mm: "13", cladding: "No" }, ["pipe_size_mm"]);
    expect(size(b.block).value).toBe("34.93");
  });

  it("NEGATIVE -- the same wording MODEL-read (not typed) still composes: the refusal is for the pricer's own entry only", () => {
    const { r } = panel({ ...BASE, thickness_mm: "Double layer of 19 mm thick" });
    expect(r.values).toEqual({ supply_rate: 991, install_rate: 238, combined_rate: 1229 });
  });
});

describe("SLICE 12d-6 / AC3 -- a hyphenated mixed inch is one number", () => {
  const reader = SPEC.numbers.pipe_size_mm;
  const mm = (text: string) => (readNumber(text, reader) as { value: number }).value;

  it.each(['1-1/4"', '1 1/4"', "1-1/4 inch"])("%j -> 31.75 mm", (text) => {
    expect(mm(text)).toBeCloseTo(31.75, 3);
  });

  it("on the panel 1-1/4\" ladders to 34.93 and the note names the right size", () => {
    const { block } = panel({ ...BASE, cladding: "No", thickness_mm: "13 mm", pipe_size_mm: '1-1/4"' });
    expect(size(block).value).toBe("34.93");
    expect(size(block).note).toBe("BoQ says 31.75 mm -> priced as 34.93 mm (next size up)");
  });

  it("UNCHANGED: 5/8\" 15.875, 1\" 25.4, 1/4\" 6.35, 2-1/8\" 53.975, \"100 mm NB\" 100, \"40-50 mm\" is a range (its top, 50), a slash LIST still refuses", () => {
    expect(mm('5/8"')).toBeCloseTo(15.875, 3);
    expect(mm('1"')).toBeCloseTo(25.4, 3);
    expect(mm('1/4"')).toBeCloseTo(6.35, 3);
    expect(mm('2-1/8"')).toBeCloseTo(53.975, 3);
    expect(mm("100 mm NB")).toBe(100);
    expect(readNumber("40-50 mm", reader)).toMatchObject({ value: 50 });
    expect(readNumber("19/ 25 / 32 mm", reader)).toEqual({ blank: "several values stated for pipe size ('19/ 25 / 32 mm')" });
  });

  it("NEGATIVE -- a reader that does NOT declare inches still refuses an inch, hyphen or not", () => {
    const thickness = SPEC.numbers.thickness_mm;
    expect(readNumber('1-1/4"', thickness)).toEqual({ blank: "thickness stated in inches ('1-1/4\"')" });
  });

  it("REPORTED, not built: a unicode fraction (1¼\") has no reader path and still reads as 1\"", () => {
    expect(mm('1¼"')).toBeCloseTo(25.4, 3);
  });
});

describe("SLICE 12d-6 / AC4 -- the 'own spelling' note never doubles the unit", () => {
  it("a stated value that carries its unit: \"19 mm\" -> \"BoQ says 19 mm -> 19 mm (...)\"", () => {
    const { block } = panel({ ...BASE, thickness_mm: "19 mm" });
    expect(thk(block).note).toBe("BoQ says 19 mm -> 19 mm (the sheet's own spelling of this value)");
  });

  it("a BARE number still gets the unit appended: \"19.0\" -> \"BoQ says 19.0 mm -> 19 mm (...)\"", () => {
    const { block } = panel({ ...BASE, thickness_mm: "19.0" });
    expect(thk(block).note).toBe("BoQ says 19.0 mm -> 19 mm (the sheet's own spelling of this value)");
  });

  it("NEGATIVE -- no field note on a priced Nitrile row contains a doubled unit", () => {
    for (const stated of ["19 mm", "19mm thick - Single layer", "19.0", "25 mm"]) {
      const { block } = panel({ ...BASE, thickness_mm: stated });
      for (const f of block.fields) expect(f.note ?? "").not.toMatch(/ mm mm\b/);
    }
  });
});
