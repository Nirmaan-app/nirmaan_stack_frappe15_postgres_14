/**
 * DU-3 K1b (owner rulings 2026-11-16 14:15-15:44 + QR-1 answers 18:06), positive AND negative per mechanism, on the newest asset with the
 * v75 config data (du3K1b.harness):
 *  R3  reverse pair rule: a supply row (also behind a heading echo) whose installation the sheet quotes on its own same-kind row(s) ->
 *      supply only, the note naming every such row; Ducting AND Valve Package (pair_note)
 *  R4  gauge reading: every spelling of the gauge word, the word before the number, a bare 16-30 = that gauge, a bare decimal = mm; the
 *      calculator's typed gauge goes through the same reader (CERT-1); "mmG" never written
 *  R5  "SM", "Sq mt", "Sqm/Ro" = sq.m
 *  R6  a labour row with no gauge = the duct's installation only, its insulation not priced here
 *  R7  a row with no duct type: round / spiral / oval words -> Spiral / Oval; "rectangular/round" -> Rectangular + note; several gauges
 *      in the answer but the row's own words name one -> that gauge
 *  C8  a duct-painting row in the BoQ 380 context -> Misc Paint, the note naming the duct rows; out of context -> unchanged + a note
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { gaugeFieldText } from "./itemListPricing";
import { cfgK1b } from "./du3K1b.harness";
import { itemsV75 } from "./du3Insulation.harness";

const DUCT = "hvac_ducting";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const RECT = "Rectangular (GI)", SPIRAL = "Spiral / Oval (GI)", FIRE = "Fire Rated (MS)";
const CFG = cfgK1b();
const ITEMS = itemsV75(0.9);
type Item = Record<string, string | null> & { _section?: string };
const mi = (a: Item) => {
  const { _section, ...attrs } = a;
  return { ...(_section ? { section: _section } : {}), attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) };
};
const D = (type: string | null, gauge: string | null, more: Item = {}): Item => ({ duct_type: type, duct_type_as_written: type, gauge_as_written: gauge, insulated: "No", ...more });
type SheetRow = { row: number; text: string; items: Item[]; cat?: string; qty?: number; unit?: string; heading?: string };
const sheet = (rows: SheetRow[], at: number, unit = "Sqm"): ItemListView => {
  const ext = buildExtractionByRow(rows.map((r) => ({ excel_row: r.row, description: r.text, category_id: r.cat ?? DUCT, attributes: {}, items: r.items.map(mi) })) as never);
  const h = makePricingSheetHelper({ configsByCategory: CFG as never, items: ITEMS as never, extractionByRow: ext });
  const me = rows.find((r) => r.row === at)!;
  return (h.compute({ excelRow: at, description: me.text, nodeType: "Line Item", category: me.cat ?? DUCT, discipline: "HVAC", rateKinds: KINDS, unit: me.unit ?? unit,
    headings: [], ownNotes: [], headingNotes: [],
    sheetLines: rows.map((r) => ({ row: r.row, text: r.text, unit: r.unit ?? unit, ...(r.heading ? { heading: r.heading } : {}) })),
    sheetCategories: Object.fromEntries(rows.map((r) => [r.row, r.cat ?? DUCT])),
    rowQuantities: Object.fromEntries(rows.map((r) => [r.row, r.qty ?? 10])) } as never, {}) as unknown as ItemListSuggestion).itemList!;
};
const one = (items: Item[], text: string, unit = "Sqm") => sheet([{ row: 9, text, items, unit }], 9, unit);
const calc = (gauge: string, family = RECT, unit = "sqm"): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: CFG as never, items: ITEMS as never, extractionByRow: new Map() });
  return (h.compute(calculatorCtx("HVAC", DUCT), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs: { gauge_as_written: gauge }, other: ["gauge_as_written"] }] }),
    [ROW_UNIT_OVERRIDE_KEY]: unit }) as unknown as ItemListSuggestion).itemList!;
};
const tot = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];
const txt = (v: ItemListView) => JSON.stringify(v);

describe("DU-3 R3 the reverse pair rule (Ducting + Valve Package)", () => {
  const fire = (scope: string) => D(FIRE, "22G", { duct_type_as_written: "fire rated factory fabricated ducts", scope });
  it("pos: a heading-echo supply row ('FIRE RATED DUCTING Supply of ...') with installation rows 87, 89 -> supply only, note names both", () => {
    const v = sheet([
      { row: 86, text: "FIRE RATED DUCTING Supply of fire rated factory fabricated ducts as per drawings", items: [fire("Supply + installation")] },
      { row: 87, text: "FIRE RATED DUCTING Installation and testing of fire rated factory fabricated ducts", items: [fire("Installation only")] },
      { row: 89, text: "FIRE RATED DUCTING Installation and testing of fire rated ducts above", items: [fire("Installation only")] },
    ], 86);
    expect(tot(v)).toEqual([3040, 0]);
    expect(v.scope?.note).toBe("Installation not priced in this row - this sheet quotes the installation of this duct on its own rows: 87, 89");
  });
  it("pos: one installation row -> 'row: 87' (singular)", () => {
    const v = sheet([{ row: 86, text: "Supply of fire rated ducts", items: [fire("Supply + installation")] },
                     { row: 87, text: "Installation of fire rated ducts", items: [fire("Installation only")] }], 86);
    expect(v.scope?.note).toBe("Installation not priced in this row - this sheet quotes the installation of this duct on its own row: 87");
  });
  it("neg: no installation row of the same kind on the sheet -> supply + installation, no pair note", () => {
    const v = sheet([{ row: 86, text: "FIRE RATED DUCTING Supply of fire rated ducts", items: [fire("Supply + installation")] },
                     { row: 87, text: "Installation of GI ducts", items: [D(RECT, "24G", { scope: "Installation only" })] }], 86);
    expect(tot(v)).toEqual([3040, 490]);
    expect(txt(v)).not.toContain("Installation not priced in this row");
  });
  it("neg: a row naming its own installation ('Supply and installation of ...') is not a supply row", () => {
    const v = sheet([{ row: 86, text: "FIRE RATED DUCTING Supply and installation of fire rated ducts", items: [fire("Supply + installation")] },
                     { row: 87, text: "Installation of fire rated ducts", items: [fire("Installation only")] }], 86);
    expect(tot(v)).toEqual([3040, 490]);
  });
  it("neg: lower-case words before 'Supply of' are no heading echo", () => {
    const v = sheet([{ row: 86, text: "the contractor shall arrange Supply of fire rated ducts", items: [fire("Supply + installation")] },
                     { row: 87, text: "Installation of fire rated ducts", items: [fire("Installation only")] }], 86);
    expect(tot(v)).toEqual([3040, 490]);
  });
  it("Valve Package: the pair rule's note names the installation row (pair_note), the figure unchanged", async () => {
    const v = (CFG.get("hvac_valve_package") as { list_spec: { pricing: { scope: { supply_row: { pair_note?: string } } } } }).list_spec.pricing.scope.supply_row;
    expect(v.pair_note).toBe("Installation not priced in this row - this sheet quotes the installation of this valve on its own {rows}");
  });
});

describe("DU-3 R4 gauge reading (panel + calculator; CERT-1; mmG)", () => {
  for (const g of ["24G", "24 g", "24   G", "24 gauge", "24 guage", "24 gage", "24 gause", "24 SWG", "24 swg", "G24", "24-G", "Guage: 24", "24"]) {
    it(`pos: the model's gauge '${g}' reads 24G (Rectangular 1080 / 260)`, () => {
      expect(tot(one([D(RECT, g)], "GI rectangular duct"))).toEqual([1080, 260]);
    });
  }
  it("pos: 'Guage: 20' (BOQ-26-00401) reads 20G; a bare '20' reads 20G with the bare-number line", () => {
    expect(tot(one([D(RECT, "Guage: 20")], "GI duct"))).toEqual([1520, 260]);
    const v = one([D(RECT, "20")], "GI duct");
    expect(tot(v)).toEqual([1520, 260]);
    expect(txt(v)).toContain("BoQ says 20 -> 20G (a bare number in the gauge field is the gauge)");
  });
  it("pos: a bare decimal is mm -> the standard-thickness table (0.63 -> 24G; 1.0 -> 20G)", () => {
    expect(tot(one([D(RECT, "0.63")], "GI duct"))).toEqual([1080, 260]);
    expect(tot(one([D(RECT, "1.0")], "GI duct"))).toEqual([1520, 260]);
  });
  it("neg: a bare number outside 16-30 is not a gauge ('12' -> no gauge read; '1500' a size, not a gauge)", () => {
    expect(gaugeFieldText("12").bare).toBeNull();
    expect(gaugeFieldText("1500").bare).toBeNull();
    expect(gaugeFieldText("G 1500x600").text).toBe("G 1500x600");
    expect(gaugeFieldText("24 mm").bare).toBeNull();
  });
  it("neg: 'G24' inside a size ('G24 x 600') is not rewritten when a size follows", () => {
    expect(gaugeFieldText("gauge 24 x 600").text).toBe("gauge 24 x 600");
  });
  for (const g of ["24", "24 g", "24 gauge", "0.63", "0.63MM", "G24"]) {
    it(`CERT-1 pos: the calculator's typed gauge '${g}' reads 24G like the panel`, () => {
      expect(tot(calc(g))).toEqual([1080, 260]);
    });
  }
  it("CERT-1 neg: a picked sheet mm ('0.6') stays that number (24G); a typed '24 mm' is 24 mm (thicker than 18G -> by hand)", () => {
    expect(tot(calc("0.6"))).toEqual([1080, 260]);
    expect(calc("24 mm").rowPriced).toBe(false);
  });
  it("mmG: a thickness between two gauges reads '0.83 mm', never '0.83 mmG'", () => {
    const v = one([D(RECT, "0.83 mm")], "GI duct");
    expect(txt(v)).not.toMatch(/\d mmG/);
    expect(txt(v)).toContain("0.83 mm is not on the sheet");
  });
});

describe("DU-3 R5 units (owner 15:00 'all three are sqm')", () => {
  for (const u of ["SM", "Sq mt", "Sqm/Ro"]) {
    it(`pos: unit '${u}' prices per sq.m (24G Rectangular 1080 / 260)`, () => {
      expect(tot(one([D(RECT, "24G")], "GI duct", u))).toEqual([1080, 260]);
    });
  }
  it("neg: 'Sq' alone is no unit we know -> not priced", () => {
    expect(one([D(RECT, "24G")], "GI duct", "Sq").rowPriced).toBe(false);
  });
});

describe("DU-3 R6 labour row (owner 15:00 'fix')", () => {
  const labour = [D("None", null, { duct_type_as_written: "GI Duct", insulated: "Yes", scope: "Installation only" }),
                  { _section: "insulation", item: "Acoustic Nitrile Insulation", thickness_mm: null, cladding: null } as Item];
  it("pos: 'Labour Charges for GI Duct Erections , Thermal insulation' with no gauge -> 0 / 260, insulation not priced here", () => {
    const v = one(labour, "Labour Charges for GI Duct Erections , Thermal insulation, Accoustic, ,", "SQM");
    expect(tot(v)).toEqual([0, 260]);
    expect(txt(v)).toContain("Labour row: the duct's installation does not vary by gauge");
    expect(txt(v)).toContain("Labour row: the duct's installation only - insulation is priced by Insulation's own rows, not here");
  });
  it("neg: the same row without labour words still needs a gauge -> unpriced", () => {
    expect(one(labour, "Erection of GI ducts", "SQM").rowPriced).toBe(false);
  });
});

describe("DU-3 R7 round per sq.m, rectangular/round, the row's own band", () => {
  it("pos: no duct type, 'GI Round duct' per sq.m -> Spiral / Oval 24G (1240 / 280) with the line", () => {
    const v = one([D(null, "24G", { duct_type_as_written: "GI Round duct" })], "Supply, installation of GI Round duct. The Sheet thickness shall be 24G");
    expect(v.items[0].family).toBe(SPIRAL);
    expect(tot(v)).toEqual([1240, 280]);
  });
  it("pos: 'rectangular/ round' per sq.m -> Rectangular with the note", () => {
    const v = one([D(null, "0.63 mm", { duct_type_as_written: "GSS sheet metal rectangular/ round ducting" })], "factory fabricated GSS sheet metal rectangular/ round ducting");
    expect(v.items[0].family).toBe(RECT);
    expect(txt(v)).toContain("BoQ says rectangular/round - priced as rectangular (unit sq.m)");
  });
  it("neg: a model duct type stands (Rectangular read for a row naming round collars)", () => {
    expect(one([D(RECT, "24G")], "GI rectangular duct with round collars").items[0].family).toBe(RECT);
  });
  it("pos: several gauges in the answer, the row's own words name 22 G -> 22G (not the 20G of the largest size)", () => {
    const v = one([D(RECT, "22 G up to 751 to 1500mm; 20G up to 1501 to 2250mm", { size_as_written: "up to 751 to 1500mm; up to 1501 to 2250mm" })], "22 G up to 751 to 1500mm");
    expect(tot(v)).toEqual([1310, 260]);
    expect(txt(v)).toContain("This row's own words say");
  });
  it("pos: the row's own NOTES repeat the band table, its description names 22 G -> still 22G (BOQ-26-00336 r16)", () => {
    const ext = buildExtractionByRow([{ excel_row: 16, description: "22 G up to 751 to 1500mm", category_id: DUCT, attributes: {},
      items: [mi(D(RECT, "22 G up to 751 to 1500mm; 20G up to 1501 to 2250mm", { size_as_written: "up to 751 to 1500mm; up to 1501 to 2250mm" }))] }] as never);
    const h = makePricingSheetHelper({ configsByCategory: CFG as never, items: ITEMS as never, extractionByRow: ext });
    const v = (h.compute({ excelRow: 16, description: "22 G up to 751 to 1500mm", nodeType: "Line Item", category: DUCT, discipline: "HVAC", rateKinds: KINDS,
      unit: "Sqm", headings: [], ownNotes: ["24 G up to 750mm, 22 G up to 751 to 1500mm, 20G up to 1501 to 2250mm"], headingNotes: [] } as never, {}) as unknown as ItemListSuggestion).itemList!;
    expect(tot(v)).toEqual([1310, 260]);
  });
  it("neg: the row's own words name no gauge -> the band reader decides as before (20G for 2250 mm)", () => {
    const v = one([D(RECT, "22 G up to 751 to 1500mm; 20G up to 1501 to 2250mm", { size_as_written: "up to 751 to 1500mm; up to 1501 to 2250mm" })], "Rectangular GI ducting");
    expect(tot(v)).toEqual([1520, 260]);
  });
});

describe("DU-3 Case 8 the duct-painting row (BoQ 380 context, QR-1 Q5 (a))", () => {
  const ducts = (qty: number): SheetRow[] => [21, 22, 23, 24].map((r) => ({ row: r, text: `Flat oval GI duct ${r}`, items: [D(SPIRAL, "24G")], qty }));
  const paint = (qty: number, gauge: string | null = null): SheetRow => ({ row: 25, text: "SITC of oval duct with enamel paint finish in color shade approved by the Architect", items: [D(SPIRAL, gauge)], qty });
  it("pos: after duct rows 21-24 (40 sq.m), quantity 42 -> Misc Paint 196 / 140, the note names rows 21-24", () => {
    const v = sheet([...ducts(10), paint(42)], 25);
    expect(tot(v)).toEqual([196, 140]);
    expect(v.sheetHeadingNotes ?? []).toContain("Reads as painting of the ducts in rows 21-24 - priced as Paint");
  });
  it("neg: quantity off by more than 20% (60 vs 40) -> today's outcome + the price-by-hand note", () => {
    const v = sheet([...ducts(10), paint(60)], 25);
    expect(v.rowPriced).toBe(false);
    expect((v.sheetHeadingNotes ?? []).join(" ")).toContain("is not close to the duct rows'");
  });
  it("neg: the row states a gauge -> a duct, not painting", () => {
    const v = sheet([...ducts(10), paint(40, "24G")], 25);
    expect(tot(v)).toEqual([1240, 280]);
    expect((v.sheetHeadingNotes ?? []).join(" ")).toContain("it states a gauge (24G)");
  });
  it("neg: no duct rows directly above (another category in between) -> unchanged + note", () => {
    const v = sheet([...ducts(10), { row: 24.5, text: "Grille", items: [], cat: "hvac_adp" }, paint(40)], 25);
    expect(v.rowPriced).toBe(false);
    expect((v.sheetHeadingNotes ?? []).join(" ")).toContain("no duct rows of this sheet sit directly above it");
  });
});

describe("DU-3 K1c: the R8 cases", () => {
  const withHead = (items: Item[], text: string, heads: { headings?: string[]; headingNotes?: string[] }, unit = "Sqm") => {
    const ext = buildExtractionByRow([{ excel_row: 9, description: text, category_id: DUCT, attributes: {}, items: items.map(mi) }] as never);
    const h = makePricingSheetHelper({ configsByCategory: CFG as never, items: ITEMS as never, extractionByRow: ext });
    return (h.compute({ excelRow: 9, description: text, nodeType: "Line Item", category: DUCT, discipline: "HVAC", rateKinds: KINDS, unit,
      headings: heads.headings ?? [], ownNotes: [], headingNotes: heads.headingNotes ?? [] } as never, {}) as unknown as ItemListSuggestion).itemList!;
  };
  it("Case 2 pos: a GI duct the BoQ calls fire rated -> the Fire Rated item (3040 / 490) + 'GI fire-rated duct - priced as our Fire Rated duct item'", () => {
    const v = one([D(FIRE, "22G", { duct_type_as_written: "GI fire rated ducts" })], "GI fire rated ducts 22G");
    expect(tot(v)).toEqual([3040, 490]);
    expect(txt(v)).toContain("GI fire-rated duct - priced as our Fire Rated duct item");
  });
  it("Case 2 neg: a fire-rated duct with no GI / galvanised / zinc word carries no GI note", () => {
    expect(txt(one([D(FIRE, "22G")], "MS fire rated duct 22G"))).not.toContain("GI fire-rated duct");
  });
  it("Case 3 pos: a GI row under a heading naming aluminium keeps GI 22G (1310 / 260) + the check-the-material note", () => {
    const v = withHead([D(RECT, "0.8 mm thickness")], "0.8 mm thickness (Upto 750mm) GI ducting with TDF flanges", { headings: ["Aluminium ducting for MRI room"] });
    expect(tot(v)).toEqual([1310, 260]);
    expect(txt(v)).toContain("heading says Aluminium - check the material before quoting");
  });
  it("Case 3 neg: a heading naming no aluminium -> no note", () => {
    expect(txt(withHead([D(RECT, "0.8 mm thickness")], "GI ducting", { headings: ["Low side office works"] }))).not.toContain("heading says Aluminium");
  });
  it("Case 4 pos: acoustic insulation asked for the first 3.5 m only -> duct + thermal only, the acoustic item left out with the note", () => {
    const items = [D(SPIRAL, "22G", { insulated: "Yes" }),
      { _section: "insulation", item: "Thermal Nitrile Insulation", thickness_mm: "13mm", cladding: "None" } as Item,
      { _section: "insulation", item: "Acoustic Nitrile Insulation", thickness_mm: "15mm", cladding: "None" } as Item];
    const note = "The costing of acoustic insulation to be included along with cost of supply of flat oval duct works- First 3.5 Meters from outlet of AC unit";
    const v = withHead(items, "22 Gauge. (0.80mm Thick)", { headingNotes: [note] });
    const thermalOnly = withHead(items.slice(0, 2), "22 Gauge. (0.80mm Thick)", {});
    expect(tot(v)).toEqual(tot(thermalOnly));
    // Case 4's own note (why), not the general two-insulations note
    expect(txt(v)).toContain("acoustic insulation asked only for the First 3.5 Meters from outlet - add by hand");
    expect(txt(v)).not.toContain("second insulation (acoustic");
  });
  // INVERTED by QR-2 Q1 (b) (owner 21:19 "1b"): BEFORE "no part-length words -> both insulation items priced"; AFTER the general rule
  // prices the whole-duct (thermal) one and notes the second -- Case 4's note is absent (negative half kept)
  it("Case 4 neg: no part-length words -> no Case 4 note (the general two-insulations rule notes the second instead)", () => {
    const items = [D(SPIRAL, "22G", { insulated: "Yes" }),
      { _section: "insulation", item: "Thermal Nitrile Insulation", thickness_mm: "13mm", cladding: "None" } as Item,
      { _section: "insulation", item: "Acoustic Nitrile Insulation", thickness_mm: "15mm", cladding: "None" } as Item];
    const v = withHead(items, "22 Gauge", { headingNotes: ["acoustic insulation for the full length"] });
    expect(txt(v)).not.toContain("asked only for");
    expect(txt(v)).toContain("second insulation (acoustic 15 mm) - add by hand");
  });
  it("Case 5 pos: 'This duct shall be double skin duct' -> unpriced, 'double-skin duct - not on our sheet, price by hand'", () => {
    const v = one([D(SPIRAL, "20G")], "1.00 mm (20 WG). This duct shall be double skin duct. Inner skin shall be with 0.5 mm plain flat oval ducting.");
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe("double-skin duct - not on our sheet, price by hand");
  });
  it("Case 5 neg: a single-skin duct row prices", () => {
    expect(one([D(SPIRAL, "20G")], "1.00 mm (20 WG) flat oval ducting").rowPriced).toBe(true);
  });
  it("Case 6 pos: removal of rectangular AND flat oval ducts -> the higher (oval) basis 0 / 140 + the note", () => {
    const v = one([D(null, null, { duct_type_as_written: "Removal of existing rectangular and flat oval ducts" })], "HVAC Ducting Removal: Removal of existing rectangular and flat oval ducts");
    expect(tot(v)).toEqual([0, 140]);
    expect(txt(v)).toContain("removal of mixed shapes - priced at the higher (oval) rate");
  });
  it("Case 6 neg: removal of rectangular ducts only -> the rectangular basis 0 / 130", () => {
    expect(tot(one([D(null, null, { duct_type_as_written: "Removal of existing rectangular ducts" })], "Removal of existing rectangular ducts"))).toEqual([0, 130]);
  });
  // owner 2026-11-17 00:18 "limit it to removal only" / 00:28: any other row naming rectangular AND oval -> unpriced, select the duct type
  it("CH-DU3-17 pos: a SUPPLY row naming rectangular and flat oval -> unpriced, 'BoQ names rectangular and oval - select the correct duct type'", () => {
    const v = one([D(null, "24G")], "Supply and installation of rectangular and flat oval GI ducts, 24G");
    expect(v.rowPriced).toBe(false);
    expect(txt(v)).toContain("BoQ names rectangular and oval - select the correct duct type");
    expect(txt(v)).not.toContain("removal of mixed shapes");
  });
  it("CH-DU3-17 neg: a supply row naming rectangular only -> priced as rectangular, no select-the-type note", () => {
    const v = one([D(null, "24G")], "Supply and installation of rectangular GI ducts, 24G");
    expect(v.rowPriced).toBe(true);
    expect(txt(v)).not.toContain("select the correct duct type");
  });
  it("Case 12 pos: a stainless-steel DUCT row -> unpriced 'Stainless-steel duct is not on our sheet - price this row by hand' (no re-file)", () => {
    const v = one([D("None", "22G", { duct_type_as_written: "Stainless Steel ducting system" })], "Supply, fabrication, installation of Stainless Steel ducting system, SS 304, 22G");
    expect(v.rowPriced).toBe(false);
    expect(txt(v)).toContain("Stainless-steel duct is not on our sheet - price this row by hand");
    expect(txt(v)).not.toContain("re-file");
  });
  it("Case 12 neg: any other stainless-steel row keeps the butterfly-valve re-file note", () => {
    const v = one([D("None", null, { duct_type_as_written: "stainless steel butterfly" })], "Stainless steel butterfly dampers");
    expect(txt(v)).toContain("Reads as butterfly valves (stainless steel), not a duct - re-file this row");
  });
});

describe("DU-3 QR-2 Q1 (b): two insulations on one duct row (owner 21:19 '1b')", () => {
  const duct = D(SPIRAL, "24G", { insulated: "Yes" });
  it("pos: ONE item naming '10mm Open Cell Accoustic / inner thermal insulation of 9mm' -> duct + thermal 9 mm, the row prices, acoustic by hand", () => {
    const v = one([duct, { _section: "insulation", item: null, thickness_mm: "10mm Open Cell Accoustic Insulation / inner thermal insulation of 9mm thick", cladding: "None" } as Item], "24G. Ducting");
    expect(v.rowPriced).toBe(true);
    expect(tot(v)).toEqual(tot(one([duct, { _section: "insulation", item: "Thermal Nitrile Insulation", thickness_mm: "9 mm", cladding: "None" } as Item], "24G. Ducting")));
    expect(v.sheetHeadingNotes ?? []).toContain("second insulation (acoustic 10 mm) - add by hand");
  });
  it("pos: TWO items (thermal 13 mm + acoustic 15 mm) -> duct + thermal only (the Case 4 figure), acoustic 15 mm by hand", () => {
    const v = one([duct, { _section: "insulation", item: "Thermal Nitrile Insulation", thickness_mm: "13mm", cladding: "None" } as Item,
      { _section: "insulation", item: "Acoustic Nitrile Insulation", thickness_mm: "15mm", cladding: "None" } as Item], "22 Gauge");
    const thermalOnly = one([duct, { _section: "insulation", item: "Thermal Nitrile Insulation", thickness_mm: "13mm", cladding: "None" } as Item], "22 Gauge");
    expect(tot(v)).toEqual(tot(thermalOnly));
    expect(v.sheetHeadingNotes ?? []).toContain("second insulation (acoustic 15 mm) - add by hand");
  });
  it("neg: one insulation of one kind -> priced as before, no note", () => {
    const v = one([duct, { _section: "insulation", item: "Acoustic Nitrile Insulation", thickness_mm: "15mm", cladding: "None" } as Item], "24G duct");
    expect(v.rowPriced).toBe(true);
    expect((v.sheetHeadingNotes ?? []).join(" ")).not.toContain("second insulation");
  });
});
