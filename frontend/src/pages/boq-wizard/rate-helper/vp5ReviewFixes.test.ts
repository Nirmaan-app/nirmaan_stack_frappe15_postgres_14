/**
 * VP-5 (2026-11-15) -- THE VP-4 ALL-ROWS REVIEW RULINGS E1-E11 (owner 2026-11-14 22:08-22:40; QR-1 "a a a") as code nets, through the
 * panel's entry point (`makePricingSheetHelper(...).compute`) on the COMMITTED HVAC v68 + Electrical v72 assets. Each POSITIVE and
 * NEGATIVE:
 *   E1   a "with and without strainer" heading over a size-only row -> the plain valve + the "add Y-strainers by hand" note
 *   E2   a swing check NRV -> refused by name, never priced as Flanged / Dual Plate
 *   E3   a differential pressure gauge -> the ordinary Misc gauge price + note
 *   E4   a thermometer "with necessary isolation valves" -> one thermometer; a sizeless valve folds in + note
 *   E6   a pressure gauge PROVISION -> the Misc test plug + note; the gauge itself is not included
 *   E7   a balancing valve with INTEGRATED P/T test points -> no extra test plug + note (a counted test point stays)
 *   E8   an on-off pressure independent valve -> the PIBCV price + the check note
 *   E9   an air vent only the heading names, over a row describing a ball valve -> the ball valve alone (no note)
 *   E10  "with out valve" -> supply + installation kept + the check note
 *   E11  installation only, ONE rule for valves and Misc: (i) the sheet quotes the supply -> normal rate; (ii) a refix of the item
 *        itself -> x 1.5 + note (never "existing CHW line", never "lifting, shifting"); (iii) otherwise -> supply + installation + note
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import type { ExtractedListItem } from "./itemListPricing";
import { buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { rowQuantitiesOf, sheetLinesOf } from "./rateSuggestionModel";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h68 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v68.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS: RateMasterItem[] = [...toItems(h68), ...toItems(e72)];
const CFG = new Map<string, RateCategoryConfig>([...h68.category_configs.map((c) => ({ ...c, discipline: "HVAC" })), ...e72.category_configs.map((c) => ({ ...c, discipline: "Electrical" }))].map((c) => [c.category_id, c as RateCategoryConfig]));
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const VALVE = "hvac_valve_package";

type Item = Record<string, string | null> & { _section?: string };
const mi = (a: Item): ExtractedListItem => {
  const { _section, ...attrs } = a;
  return { ...(_section ? { section: _section } : {}), attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v, confidence: v === null ? 0 : 0.9 }])) } as never;
};
type SheetRow = { row: number; text: string; items: Item[] };
/** One sheet of rows (the run's results + the page's priced rows), priced at row `at` -- the panel's own path. */
const sheet = (rows: SheetRow[], at: number, headings: string[] = [], unit = "Nos"): ItemListView => {
  const results = rows.map((r) => ({ excel_row: r.row, description: r.text, category_id: VALVE, attributes: {}, items: r.items.map(mi) }));
  const helper = makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS, extractionByRow: buildExtractionByRow(results as never) });
  const priced = rows.map((r) => ({ source_row_number: r.row, qty_total: 1, node_type: "Line Item", description: r.text }));
  const me = rows.find((r) => r.row === at)!;
  return (helper.compute({ excelRow: at, description: me.text, nodeType: "Line Item", category: VALVE, discipline: "HVAC", rateKinds: KINDS, unit,
    quantity: 1, headings, ownNotes: [], headingNotes: [], sheetLines: sheetLinesOf(priced as never), rowQuantities: rowQuantitiesOf(priced as never) } as never, {}) as unknown as ItemListSuggestion).itemList!;
};
const one = (items: Item[], text: string, headings: string[] = [], unit = "Nos") => sheet([{ row: 9, text, items }], 9, headings, unit);
const totals = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];
const all = (v: ItemListView) => JSON.stringify(v);
const fams = (v: ItemListView) => v.items.map((b) => b.family);
const V = (fam: string | null, size: string | null, more: Item = {}): Item => ({ valve_type: fam, valve_type_as_written: fam, size_mm: size, ...more });
const M = (item: string, said: string = item, more: Item = {}): Item => ({ _section: "misc", item, item_as_written: said, size_mm: null, ...more });

describe("VP-5 E1 -- 'with and without strainer' over a size-only row", () => {
  const head = ["Supply Installation,Laying and testing of Ball Valves with and without Strainer and necessary nitrile rubber insulation"];
  it("POSITIVE: Ball Valve 20 -> 451 / 1,000 + the add-Y-strainers-by-hand note; no strainer added (00164 r50)", () => {
    const v = one([V("Ball Valve", "20mm", { valve_type_as_written: "Ball Valves" })], "Dia 20mm", head);
    expect(totals(v)).toEqual([451, 1000]);
    expect(fams(v)).toEqual(["Ball Valve"]);
    expect(all(v)).toMatch(/BoQ says \\"with and without Strainer\\" but not how many have one - add Y-strainers by hand/);
  });
  it("NEGATIVE: a plain 'Ball Valves' heading -> no note", () => {
    expect(all(one([V("Ball Valve", "20mm")], "Dia 20mm", ["Supply and installation of Ball Valves"]))).not.toMatch(/add Y-strainers by hand/);
  });
});

describe("VP-5 E2 -- a swing check NRV is refused by name", () => {
  const head = ["insulated Non Return Valve complete with flanges, nuts, gaskets etc., with 1.0 rating / relevant code / equiv. Swing check type, IS 210 Gr FG 260 body"];
  it("POSITIVE: NRV Flanged 125 under 'Swing check type' -> refused 'No SKU in the catalogue for swing check NRV' (00425 r101)", () => {
    const v = one([V("NRV / Check Valve", "Φ 125 mm", { valve_type_as_written: "Non Return Valve", nrv_type: "Flanged", flanged: "Yes" })], "Φ 125 mm", head);
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toMatch(/No SKU in the catalogue for swing check NRV - price this row by hand/);
  });
  it("NEGATIVE: a Flanged NRV without swing words still prices (14,700 / 1,000)", () => {
    expect(totals(one([V("NRV / Check Valve", "125 mm", { nrv_type: "Flanged", flanged: "Yes" })], "125 mm", ["Non Return Valve with flanges"]))).toEqual([14700, 1000]);
  });
  it("NEGATIVE: a BTU meter under the same swing-check heading is untouched (00425 r137)", () => {
    expect(fams(one([V("BTU Meter", "250mm dia", { flanged: "Yes" })], "250mm dia - 975 GPM", head))).toEqual(["BTU Meter"]);
  });
});

describe("VP-5 E3 -- a differential pressure gauge", () => {
  it("POSITIVE: 'Differential Pressure gauge' -> the Misc gauge 2,175 / 500 + note (00245 r41)", () => {
    const v = one([M("Pressure Gauge", "Differential Pressure gauge")], "Differential Pressure gauge | Nos");
    expect(totals(v)).toEqual([2175, 500]);
    expect(all(v)).toMatch(/BoQ asks for a differential pressure gauge/);
  });
  it("NEGATIVE: a plain pressure gauge -> no note", () => {
    expect(all(one([M("Pressure Gauge", "Pressure Gauge")], "Pressure gauge 100 mm dial"))).not.toMatch(/differential/);
  });
});

describe("VP-5 E4 -- a thermometer with necessary isolation valves", () => {
  const text = "Supply and fixing Dial type Thermometers with necessary isolation valves & fittings";
  it("POSITIVE: thermometer + a sizeless ball valve -> one thermometer 2,175 / 500 + note (00164 r77)", () => {
    const v = one([M("Temperature Gauge / Thermometer", "Dial type Thermometers"), V("Ball Valve", null, { valve_type_as_written: "isolation valves" })], text);
    expect(totals(v)).toEqual([2175, 500]);
    expect(all(v)).toMatch(/the isolation valves are part of the thermometer/);
  });
  it("NEGATIVE: a thermometer row naming no isolation valves -> no note", () => {
    expect(all(one([M("Temperature Gauge / Thermometer", "Dial type Thermometers")], "Supply and fixing Dial type Thermometers"))).not.toMatch(/isolation valves are part/);
  });
});

describe("VP-5 E6 -- a pressure gauge provision", () => {
  const text = "Pressure guage provision in chilled water line with required sockets, ball valves & siphon to fix pressure guage / sensor at later stage if required by tenant.";
  it("POSITIVE: refused 'none of these' -> the Misc test plug 720 / 100 + the provision note (00023 r540)", () => {
    const v = one([M("none of these", "Pressure guage provision")], text);
    expect(totals(v)).toEqual([720, 100]);
    expect(all(v)).toMatch(/gauge provision \(socket \/ test point\); the gauge itself is not included/);
  });
  it("NEGATIVE: a real pressure gauge row stays the gauge (2,175 / 500), no note", () => {
    const v = one([M("Pressure Gauge", "Pressure Gauge")], "Pressure gauge 100 mm dial with glycerine filling");
    expect(totals(v)).toEqual([2175, 500]);
    expect(all(v)).not.toMatch(/gauge provision/);
  });
});

describe("VP-5 E7 -- a balancing valve with integrated P/T test points", () => {
  const head = ["Balancing valve shall be complete with union/flanged ends as specified, integrated P/T test points for flow verification, and a precision-adjustment handwheel"];
  it("POSITIVE: balancing 150 + a test plug the model listed -> balancing only 34,998 / 1,000 + note (00137 r77)", () => {
    const v = one([V("Balancing Valve", "150NB"), M("Test Plug / Thermowell", "P/T test points")], "150NB", head);
    expect(totals(v)).toEqual([34998, 1000]);
    expect(all(v)).toMatch(/integrated P\/T test points are part of the balancing valve/);
  });
  it("NEGATIVE: a COUNTED test point ('two P/T test points') stays its own item (W1)", () => {
    const v = one([V("Balancing Valve", "150NB"), M("Test Plug / Thermowell", "two P/T test points", { qty_per_row_unit: "2" })], "150NB", head);
    // the Misc block (an independent section) still carries the test plug family; the row prices more than the valve alone
    expect(JSON.stringify(v.sections?.independent ?? [])).toMatch(/"family":"Test Plug \/ Thermowell"/);
    expect((v.totals?.supply_rate ?? 0) > 34998).toBe(true);
  });
});

describe("VP-5 E8 -- an on-off pressure independent valve", () => {
  it("POSITIVE: PIBCV 25 read from '2 way pressure independent on-off type ...' -> 17,481 / 1,000 + the check note (00086 r177)", () => {
    const v = one([V("PIBCV", "25 NB", { valve_type_as_written: "2 way pressure independent on-off type flow limiting valve" })], "Size- 25 NB", ["2 WAY CONTROL VALVE (ON/OFF TYPE)"]);
    expect(totals(v)).toEqual([17481, 1000]);
    expect(all(v)).toMatch(/priced as our PIBCV \(modulating\) - check the price/);
  });
  it("NEGATIVE: a modulating PIBCV -> no note", () => {
    expect(all(one([V("PIBCV", "25 NB", { valve_type_as_written: "PIBCV" })], "Size- 25 NB", ["PIBCV with actuator"]))).not.toMatch(/check the price/);
  });
});

describe("VP-5 E9 -- an air vent only the heading names", () => {
  it("POSITIVE: the row describes only the ball valve -> Ball Valve 25 alone, 682 / 1,000 (00365 r68)", () => {
    const v = one([V("Automatic Air Vent", null, { valve_type_as_written: "AUTO AIR VENT" }), V("Ball Valve", "25 mm diameter")],
      "Supply, Installation, Testing , & Commissioning of Ball Valve of 25 mm diameter across the highest point in pipe line complete with nipples etc.", ["AUTO AIR VENT"]);
    expect(fams(v)).toEqual(["Ball Valve"]);
    expect(totals(v)).toEqual([682, 1000]);
  });
  it("NEGATIVE: the row's own words name the air vent -> both stay", () => {
    const v = one([V("Automatic Air Vent", null), V("Ball Valve", "25 mm")], "Automatic air vent with 25 mm ball valve", ["AUTO AIR VENT"]);
    expect(fams(v)).toEqual(["Automatic Air Vent", "Ball Valve"]);
  });
  it("NEGATIVE: an 'Air Purge valve' IS the air vent -> both stay (00313 r295, 00425 r118 name it; no 'with' here)", () => {
    for (const text of ["Supply & Installation of Air Purge valves and Ball Valve 15 mm", "Air release valve, ball valve 15 mm"]) {
      const v = one([V("Automatic Air Vent", null), V("Ball Valve", "15 mm")], text, ["AUTO AIR VENT"]);
      expect(fams(v)).toEqual(["Automatic Air Vent", "Ball Valve"]);
    }
  });
  it("NEGATIVE: '... With 15 mm ball valve' under the air vent heading -> both stay, 1,372 / 2,000 (VP-3 C2; 00086 r161)", () => {
    const v = one([V("Automatic Air Vent", null), V("Ball Valve", "15 mm")], "15 mm dia. With 15 mm ball valve", ["AUTOMATIC AIR VENT"]);
    expect(fams(v)).toEqual(["Automatic Air Vent", "Ball Valve"]);
    expect(totals(v)).toEqual([1372, 2000]);
  });
});

describe("VP-5 E10 -- 'with out valve'", () => {
  it("POSITIVE: Butterfly 100 -> 4,108 / 1,000 kept + the may-be-installation-only note (00379 r25)", () => {
    const v = one([V("Butterfly Valve", "100 mm dia", { valve_type_as_written: "Butterfly Valves" })], "Butterfly Valves 100 mm dia with out valve");
    expect(totals(v)).toEqual([4108, 1000]);
    expect(all(v)).toMatch(/this may be installation only; check before quoting/);
  });
  it("NEGATIVE: no such words -> no note", () => {
    expect(all(one([V("Butterfly Valve", "100 mm dia")], "Butterfly Valves 100 mm dia"))).not.toMatch(/may be installation only/);
  });
});

describe("VP-5 E11 -- installation only: one rule for valves and Misc", () => {
  const gaugeSheet = (supplyScope: string): SheetRow[] => [
    { row: 47, text: "Supply of following industrial type Pressure Gauges PN16 (Glycerine filled) with 100mm Dial", items: [M("Pressure Gauge", "Pressure Gauges", { scope: supplyScope })] },
    { row: 48, text: "Installation, testing and Commissioning of following industrial type Pressure Gauges PN16 (Glycerine filled) with 100mm Dial", items: [M("Pressure Gauge", "Pressure Gauges", { scope: "Installation only" })] },
  ];
  it("(i) POSITIVE: a Misc installation-only row whose supply is on the sheet -> 0 / 500, the normal rate (00104 r48)", () => {
    expect(totals(sheet(gaugeSheet("Supply only"), 48))).toEqual([0, 500]);
  });
  it("(i) POSITIVE: the same for valves (the VR9 rule kept): 0 / 1,000", () => {
    const rows: SheetRow[] = [
      { row: 53, text: "Supply of brass ball valves", items: [V("Ball Valve", "32", { scope: "Supply + installation" })] },
      { row: 54, text: "Installation, and Testing & Commissioning of brass ball valves", items: [V("Ball Valve", "32", { scope: "Installation only" })] },
    ];
    expect(totals(sheet(rows, 54))).toEqual([0, 1000]);
  });
  it("(iii) POSITIVE: installation only with NO supply row, not a refix -> supply + installation + note", () => {
    const v = one([V("Ball Valve", "32", { scope: "Installation only" })], "Installation, testing and commissioning of brass ball valves");
    expect(totals(v)).toEqual([1224, 1000]);
    expect(v.scope?.note ?? "").toMatch(/no supply row is quoted for it - priced supply \+ installation \(we do end to end\)/);
  });
  it("(iii) POSITIVE: a Misc row the same way (2,175 / 500 + note)", () => {
    const v = one([M("Pressure Gauge", "Pressure Gauges", { scope: "Installation only" })], "Installation of pressure gauges");
    expect(totals(v)).toEqual([2175, 500]);
    expect(v.scope?.note ?? "").toMatch(/priced supply \+ installation/);
  });
  it("(ii) POSITIVE: refixing existing valves -> installation x 1.5 + note (1,000 -> 1,500)", () => {
    const v = one([V("Ball Valve", "32", { scope: "Installation only" })], "Dismantling and refixing of existing ball valves");
    expect(totals(v)).toEqual([0, 1500]);
    expect(JSON.stringify(v)).toMatch(/refixing existing items - installation only with the uplift/);
  });
  it("(ii) NEGATIVE: 'existing CHW line' is not a refix of the item -> (iii) supply + installation (QR-1 Q1 (a))", () => {
    expect(totals(one([M("Pressure Gauge", "Pressure Gauge", { scope: "Installation only" })], "Installation of Pressure Gauge with Well and accessories in existing CHW line"))).toEqual([2175, 500]);
  });
  it("(ii) NEGATIVE: 'lifting, shifting, positioning at site' is material handling, not a refix -> (iii)", () => {
    expect(totals(one([V("Ball Valve", "32", { scope: "Installation only" })], "Installation of ball valves including lifting, shifting, positioning at site"))).toEqual([1224, 1000]);
  });
  it("PAIR (QR-2 a) POSITIVE: a valve SUPPLY row whose installation-only twin is on the sheet -> Supply only 1,224 / 0 + note (00104 r53)", () => {
    const rows: SheetRow[] = [
      { row: 53, text: "Supply of brass ball valves of the following sizes suitable for pressure of PN16", items: [V("Ball Valve", "32", { scope: "Supply + installation" })] },
      { row: 54, text: "Installation, and Testing & Commissioning of brass ball valves of the following sizes", items: [V("Ball Valve", "32", { scope: "Installation only" })] },
    ];
    const v = sheet(rows, 53);
    expect(totals(v)).toEqual([1224, 0]);
    expect(v.scope?.note ?? "").toMatch(/The installation of this item is quoted on its own row \(row 54\) - priced supply only here/);
  });
  it("PAIR (QR-2 a) POSITIVE: the Misc supply row the same way -> 2,175 / 0 (00104 r47), its scope blank or S + I", () => {
    expect(totals(sheet(gaugeSheet("Supply + installation"), 47))).toEqual([2175, 0]);
    const blank: SheetRow[] = [{ ...gaugeSheet("x")[0], items: [M("Pressure Gauge", "Pressure Gauges")] }, gaugeSheet("x")[1]];
    expect(totals(sheet(blank, 47))).toEqual([2175, 0]);
  });
  it("PAIR NEGATIVE: a supply row with no installation-only twin on the sheet keeps supply + installation", () => {
    expect(totals(one([V("Ball Valve", "32", { scope: "Supply + installation" })], "Supply of brass ball valves"))).toEqual([1224, 1000]);
  });
  it("PAIR NEGATIVE: a 'Supply and installation of' row beside an installation-only twin is untouched", () => {
    const rows: SheetRow[] = [
      { row: 53, text: "Supply and installation of brass ball valves", items: [V("Ball Valve", "32", { scope: "Supply + installation" })] },
      { row: 54, text: "Installation of brass ball valves", items: [V("Ball Valve", "32", { scope: "Installation only" })] },
    ];
    expect(totals(sheet(rows, 53))).toEqual([1224, 1000]);
  });
  it("NEGATIVE: a supply + installation row is untouched by E11", () => {
    const v = one([V("Ball Valve", "32", { scope: "Supply + installation" })], "Supply and installation of ball valves");
    expect(totals(v)).toEqual([1224, 1000]);
    expect(v.scope?.note ?? "").not.toMatch(/owner E11/);
  });
});
