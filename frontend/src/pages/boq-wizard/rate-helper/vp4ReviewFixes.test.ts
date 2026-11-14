/**
 * VP-4 (2026-11-14) -- THE VP-3 RE-REVIEW RULINGS' CODE SAFETY NETS (owner 2026-11-13 23:35 "1 yes / 2 yes / 3 yes / 4 yes") and the
 * wording tidy (block 65; QR-1 "a a a"), through the panel's entry point (`makePricingSheetHelper(...).compute`) on the COMMITTED
 * HVAC v67 + Electrical v72 assets. Each mechanism POSITIVE and NEGATIVE:
 *   R1  a sizeless ball valve the BoQ ties to the strainer's drain is part of the strainer (a ball valve with its own size stays)
 *   R2  "balancing" + "modulating" in one valve -> the PIBCV (a plain 2-way modulating valve stays a 2-way valve)
 *   R3  "provision ... (digital) thermometer in future" -> the Misc test plug (a real thermometer stays a thermometer)
 *   R4  a high rangeability control valve -> a 2-way modulating valve, 20-32 mm; above 32 the ladder refuses (plain words untouched)
 *   W1  a count written for a listed item prices that many ("two test points"); never "two way" / "2-way"
 *   W2  the row's own size (before the appended text) wins over the appended text's (no appended text -> untouched)
 *   T1  an inch size is named by its nominal bore in the note; the figure is the ladder's (an mm size keeps its line)
 *   T2  the heading's OWN note block (no line item between) and the flange note off a flanged = No item unless its own words say so
 *   T4  a D7c strainer moved by the ladder carries ONE note (its D7c line with the size it is priced at)
 *   T5  a kit with several unstocked items names every one of them (one unstocked item -> as before)
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import type { ExtractedListItem } from "./itemListPricing";
import { NOMINAL_BORE_MM, buildExtractionByRow, makePricingSheetHelper, nominalBoreOf, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { rowHeadingNotes, rowOwnHeadingNotes } from "./rateSuggestionModel";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h67 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v67.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS: RateMasterItem[] = [...toItems(h67), ...toItems(e72)];
const baseCfg = () => new Map<string, RateCategoryConfig>([...h67.category_configs.map((c) => ({ ...c, discipline: "HVAC" })), ...e72.category_configs.map((c) => ({ ...c, discipline: "Electrical" }))].map((c) => [c.category_id, c as RateCategoryConfig]));
const CFG = baseCfg();
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const VALVE = "hvac_valve_package";

type Item = Record<string, string | null> & { _section?: string };
const mi = (a: Item): ExtractedListItem => {
  const { _section, ...attrs } = a;
  return { ...(_section ? { section: _section } : {}), attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v, confidence: v === null ? 0 : 0.9 }])) } as never;
};
type Row = { items: Item[]; unit?: string; text?: string; headings?: string[]; headingNotes?: string[]; ownHeadingNotes?: string[]; cfg?: Map<string, RateCategoryConfig> };
const compute = (r: Row) => {
  const helper = makePricingSheetHelper({ configsByCategory: r.cfg ?? CFG, items: ITEMS,
    extractionByRow: buildExtractionByRow([{ excel_row: 9, description: r.text ?? "", category_id: VALVE, attributes: {}, items: r.items.map(mi) }] as never) });
  return helper.compute({ excelRow: 9, description: r.text ?? "", nodeType: "Line Item", category: VALVE, discipline: "HVAC", rateKinds: KINDS,
    unit: r.unit ?? "Nos", quantity: 1, headings: r.headings ?? [], ownNotes: [], headingNotes: r.headingNotes ?? [],
    ...(r.ownHeadingNotes ? { ownHeadingNotes: r.ownHeadingNotes } : {}) } as never, {});
};
const one = (r: Row): ItemListView => (compute(r) as unknown as ItemListSuggestion).itemList!;
const totals = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];
const all = (v: ItemListView) => JSON.stringify(v);
const fams = (v: ItemListView) => v.items.map((b) => b.family);
const V = (fam: string | null, size: string | null, more: Item = {}): Item => ({ valve_type: fam, valve_type_as_written: fam, size_mm: size, ...more });
const M = (item: string, said: string = item, more: Item = {}): Item => ({ _section: "misc", item, item_as_written: said, size_mm: null, ...more });
const NONE = (said: string, more: Item = {}): Item => ({ valve_type: "none of these", valve_type_as_written: said, size_mm: null, ...more });
const fieldNotes = (v: ItemListView) => v.items.flatMap((b) => (b.fields ?? []).map((f) => f.note).filter((n): n is string => !!n));

describe("VP-4 R1 -- a sizeless ball valve tied to the strainer's drain is part of the strainer", () => {
  const head = ["HVAC SYSTEM", "Y Strainer with matching flanges ... Strainer to have ball valve for strainer drain to be considered as part of supply of this item"];
  it("POSITIVE: Strainer 80 + 'Ball valve for strainer drain' (no size) -> one Strainer item, 4,898 / 1,000, with the R1 line (00247 r232)", () => {
    const v = one({ items: [V("Strainer", "80 mmdia", { strainer_type: "Y-Type", flanged: "Yes" }), V("Ball Valve", null, { valve_type_as_written: "Ball valve for strainer drain" })], text: "80 mmdia", headings: head });
    expect(v.rowPriced).toBe(true);
    expect(fams(v)).toEqual(["Strainer"]);
    expect(totals(v)).toEqual([4898, 1000]);
    expect(all(v)).toMatch(/drain ball valve included in the strainer item/);
  });
  it("POSITIVE: 100 mm -> 6,942 / 1,000 (00247 r233)", () => {
    expect(totals(one({ items: [V("Strainer", "100 mmdia", { strainer_type: "Y-Type" }), V("Ball Valve", null, { valve_type_as_written: "Ball valve for strainer drain" })], text: "100 mmdia", headings: head }))).toEqual([6942, 1000]);
  });
  it("NEGATIVE: a ball valve with its OWN size beside the strainer stays its own item", () => {
    const v = one({ items: [V("Strainer", "80 mm", { strainer_type: "Y-Type" }), V("Ball Valve", "25 mm", { valve_type_as_written: "Ball valve for strainer drain" })], text: "80 mm", headings: head });
    expect(fams(v)).toEqual(["Strainer", "Ball Valve"]);
  });
  it("NEGATIVE: a sizeless 'drain cock' on a kit row with no strainer-drain words is not folded (it still refuses for its size)", () => {
    const v = one({ items: [V("Strainer", "32 mm", { strainer_type: "Y-Type" }), V("Ball Valve", null, { valve_type_as_written: "drain cock" })], text: "32 mm", headings: ["FCU Valve Kit"] });
    expect(fams(v)).toEqual(["Strainer", "Ball Valve"]);
    expect(v.rowPriced).toBe(false);
  });
});

describe("VP-4 R2 -- balancing + modulating actuation in one valve is the PIBCV", () => {
  it("POSITIVE: '2 way Modulating Balancing Valves' read as a 2-Way modulating valve, 50 mm -> PIBCV 50,699 / 1,000 (00165 r24)", () => {
    const v = one({ items: [V("2-Way Valve", "50 mm", { valve_type_as_written: "2 way Modulating Balancing Valves", operation: "Modulating", flanged: "Yes" })], text: "50 mm", headings: ["2 way Modulating Balancing Valves"] });
    expect(v.rowPriced).toBe(true);
    expect(fams(v)).toEqual(["PIBCV"]);
    expect(totals(v)).toEqual([50699, 1000]);
    expect(all(v)).toMatch(/a balancing valve with modulating actuation is the PIBCV/);
  });
  it("NEGATIVE: a plain 2-way modulating valve (no 'balancing') stays a 2-Way Valve", () => {
    const v = one({ items: [V("2-Way Valve", "25 mm", { valve_type_as_written: "2 way modulating valve", operation: "Modulating" })], text: "25 mm" });
    expect(fams(v)).toEqual(["2-Way Valve"]);
  });
  it("NEGATIVE: a 'none of these' Thermostat beside a PIBCV under a 'modulating ... balancing' heading is NOT a second PIBCV (D1 folds it)", () => {
    const v = one({ items: [V("PIBCV", "50 mm"), NONE("Thermostat")], text: "50 mm Dia", headings: ["PIBCV - 2 way Modulating / Self Dynamic Balancing Valves along with thermostat"] });
    expect(fams(v)).toEqual(["PIBCV"]);
    expect(totals(v)).toEqual([50699, 1000]);
  });
  it("NEGATIVE: a 2-way valve beside a PIBCV under a 'modulating ... balancing' heading stays a 2-way valve (never a second PIBCV)", () => {
    const v = one({ items: [V("PIBCV", "50 mm"), V("2-Way Valve", "25 mm", { valve_type_as_written: "2-way valve", operation: "Modulating" })], text: "50 mm",
      headings: ["PIBCV - 2 way Modulating / Self Dynamic Balancing Valves"] });
    expect(fams(v)).toEqual(["PIBCV", "2-Way Valve"]);
  });
  it("NEGATIVE: a plain balancing valve (no 'modulating') stays the Balancing Valve", () => {
    expect(fams(one({ items: [V("Balancing Valve", "100 mm", { valve_type_as_written: "manual balancing valve" })], text: "100 mm" }))).toEqual(["Balancing Valve"]);
  });
});

describe("VP-4 R3 -- a thermometer provision is the Misc test plug", () => {
  it("POSITIVE: Misc 'none of these' 'Provision in chilled water lines to connected digital thermometer in future' -> test plug 720 / 100 (00016 r200)", () => {
    const said = "Provision in chilled water lines to connected digital thermometer in future";
    const v = one({ items: [M("none of these", said)], text: `${said}.`, unit: "Set", headings: ["CHILLED WATER WORKS", "Miscellaneous"] });
    expect(v.rowPriced).toBe(true);
    expect(totals(v)).toEqual([720, 100]);
    expect(all(v)).toMatch(/priced as a test plug \/ thermowell provision/);
  });
  it("POSITIVE: the model put it in the VALVE section as 'none of these' -> still the Misc test plug", () => {
    const v = one({ items: [NONE("Provision to connect thermometer in future")], text: "Provision to connect thermometer in future", unit: "Nos" });
    expect(totals(v)).toEqual([720, 100]);
  });
  it("NEGATIVE: a real thermometer stays the thermometer (no 'provision')", () => {
    const v = one({ items: [M("Temperature Gauge / Thermometer", "Dial type thermometer")], text: "Dial type thermometer", unit: "Nos" });
    expect(all(v)).not.toMatch(/test plug \/ thermowell provision/);
  });
});

describe("VP-4 R4 -- a high rangeability control valve is a 2-way modulating valve (20-32 mm)", () => {
  const head = ["AHU", "Supply, installation, testing and commissioning of High Rangeability Control Valve Provided with modulating actuators"];
  it("POSITIVE: 'none of these' High Rangeability Control Valve 25 / 32 mm -> 3,920 / 1,000 and 4,900 / 1,000 (00425 r265 / r266)", () => {
    expect(totals(one({ items: [NONE("High Rangeability Control Valve", { size_mm: "Φ 25 mm" })], text: "Φ 25 mm", headings: head }))).toEqual([3920, 1000]);
    const v = one({ items: [NONE("High Rangeability Control Valve", { size_mm: "Φ 32 mm" })], text: "Φ 32 mm", headings: head });
    expect(totals(v)).toEqual([4900, 1000]);
    expect(fams(v)).toEqual(["2-Way Valve"]);
    expect(all(v)).toMatch(/read as a 2-way modulating valve/);
  });
  it("POSITIVE (refusal): 40 mm -> the ladder's own refusal 'valve size 40 is above the largest size on the sheet (32)' + the R4 line (QR-1 Q3 (a))", () => {
    const v = one({ items: [NONE("High Rangeability Control Valve", { size_mm: "Φ 40 mm" })], text: "Φ 40 mm", headings: head });
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toMatch(/valve size 40 is above the largest size on the sheet \(32\)/);
    expect(all(v)).toMatch(/read as a 2-way modulating valve/);
  });
  it("NEGATIVE: a named unstocked item ('Thermostat') under a high-rangeability heading keeps its own refusal", () => {
    expect(one({ items: [NONE("Thermostat")], text: "Thermostat", headings: head }).reason).toMatch(/No SKU in the catalogue for Thermostat/);
  });
  it("NEGATIVE: another unstocked valve ('globe valve') keeps its no-SKU refusal", () => {
    expect(one({ items: [NONE("Globe valve", { size_mm: "25 mm" })], text: "25 mm" }).reason).toMatch(/No SKU in the catalogue for Globe valve/);
  });
});

describe("VP-4 W1 -- a written count prices that many of the item", () => {
  const head = ["VAlves- CHILLED WATER", "Supply, installation ... of manual balancing valve ... with two pressure/temperature test points"];
  it("POSITIVE: Balancing Valve 80 + Misc 'two pressure/temperature test points' -> 2 test plugs, 20,507 / 1,200 (00017 r26)", () => {
    const v = one({ items: [V("Balancing Valve", "80mm Dia", { valve_type_as_written: "manual balancing valve", flanged: "Yes" }), M("Test Plug / Thermowell", "two pressure/temperature test points (Pete’s plugs)")], text: "80mm Dia", headings: head });
    expect(v.rowPriced).toBe(true);
    expect(totals(v)).toEqual([20507, 1200]);
    expect(all(v)).toMatch(/-> 2 of this item/);
  });
  it("NEGATIVE: one test point -> ONE test plug (19,787 / 1,100)", () => {
    expect(totals(one({ items: [V("Balancing Valve", "80mm Dia", { valve_type_as_written: "manual balancing valve" }), M("Test Plug / Thermowell", "pressure/temperature test point")], text: "80mm Dia" }))).toEqual([19787, 1100]);
  });
  it("NEGATIVE: 'two way' / '2-way' is never a count", () => {
    expect(all(one({ items: [V("2-Way Valve", "25 mm", { valve_type_as_written: "two way on-off valve" })], text: "25 mm" }))).not.toMatch(/of this item/);
    expect(all(one({ items: [V("2-Way Valve", "25 mm", { valve_type_as_written: "2-way modulating valve" })], text: "25 mm" }))).not.toMatch(/of this item/);
  });
});

describe("VP-4 W2 -- the row's own size wins over the appended text's", () => {
  const app = "Supply and fixing in position, the following GM ball valves of approved brand ... complete.Zolloto make.. 40mm dia. (Screwed end)";
  it("POSITIVE: 'Ball valves - 25mm dia. | ... 40mm dia.' with no size read -> Ball Valve 25 = 682 / 1,000, the note names both (00368 r17)", () => {
    const v = one({ items: [V("Ball Valve", null, { valve_type_as_written: "GM ball valves", flanged: "Yes" })], text: `Ball valves - 25mm dia. | ${app}` });
    expect(totals(v)).toEqual([682, 1000]);
    expect(all(v)).toMatch(/The row's own words say 25 mm; the appended text says 40 mm -> the row's own size, 25 mm/);
  });
  it("POSITIVE: 20 mm -> 451 / 1,000 (00368 r18)", () => {
    expect(totals(one({ items: [V("Ball Valve", null, { valve_type_as_written: "GM ball valves" })], text: `Ball valves - 20mm dia. | ${app}` }))).toEqual([451, 1000]);
  });
  it("NEGATIVE: no appended text -> a sizeless ball valve still refuses 'no valve size stated'", () => {
    expect(one({ items: [V("Ball Valve", null)], text: "Ball valves" }).reason).toMatch(/no valve size stated/);
  });
});

describe("VP-4 T1 -- an inch size is named by its nominal bore", () => {
  it("POSITIVE: 3/4\" -> 'BoQ says 3/4\" -> 20 mm (3/4\" = 20 NB)', figure the ladder's; 1/2\" -> 15 NB", () => {
    const v = one({ items: [V("Ball Valve", "3/4\"")], text: "Drain valve 3/4\"" });
    expect(fieldNotes(v)).toContain("BoQ says 3/4\" -> 20 mm (3/4\" = 20 NB)");
    expect(all(v)).not.toMatch(/19\.05/);
    expect(fieldNotes(one({ items: [V("Ball Valve", "1/2\"")], text: "1/2\"" }))).toContain("BoQ says 1/2\" -> 15 mm (1/2\" = 15 NB)");
  });
  it("NEGATIVE: an mm size keeps its own line; the table is the owner's (1/2\" = 15 ... 12\" = 300)", () => {
    expect(fieldNotes(one({ items: [V("Ball Valve", "25 mm dia")], text: "25 mm dia" })).join(" ")).not.toMatch(/NB\)/);
    expect(NOMINAL_BORE_MM[0]).toEqual([0.5, 15]);
    expect(NOMINAL_BORE_MM[NOMINAL_BORE_MM.length - 1]).toEqual([12, 300]);
    expect(nominalBoreOf("25", 25)).toBeNull();
    expect(nominalBoreOf("1-1/4\"", 31.75)).toBe(32);
  });
});

describe("VP-4 T2 -- the heading's own note block; the flange note off a flanged = No item", () => {
  type R = { row_index: number; source_row_number: number; node_type: string; effective_classification?: string; effective_parent_index?: number | null; description: string; row_notes?: string };
  const rows: R[] = [
    { row_index: 0, source_row_number: 421, node_type: "Heading", effective_parent_index: null, description: "Chilled Water Cassette Unit" },
    { row_index: 1, source_row_number: 422, node_type: "Note", effective_classification: "note", effective_parent_index: 0, description: "19mm thick Nitrile rubber insulation for Valve package" },
    { row_index: 2, source_row_number: 423, node_type: "Line Item", effective_parent_index: 0, description: "Cassette unit 1 TR" },
    { row_index: 3, source_row_number: 500, node_type: "Note", effective_classification: "note", effective_parent_index: 0, description: "Butterfly valve with matching flanges" },
    { row_index: 4, source_row_number: 556, node_type: "Line Item", effective_parent_index: 0, description: "Supply & Installation of Drain cock 25 mm dia" },
  ];
  it("POSITIVE: rowOwnHeadingNotes keeps the note before the first line item, drops the one past it (rowHeadingNotes keeps both)", () => {
    expect(rowOwnHeadingNotes(rows[4] as never, rows as never)).toEqual(["19mm thick Nitrile rubber insulation for Valve package"]);
    expect(rowHeadingNotes(rows[4] as never, rows as never)).toHaveLength(2);
  });
  it("POSITIVE: a valve row priced with the own block -> no flange line from another section's note; the insulation line stays", () => {
    const v = one({ items: [V("Ball Valve", "25 mm dia", { valve_type_as_written: "Drain cock" })], text: "Supply & Installation of Drain cock 25 mm dia",
      headings: ["Chilled Water Cassette Unit"], headingNotes: rowHeadingNotes(rows[4] as never, rows as never), ownHeadingNotes: rowOwnHeadingNotes(rows[4] as never, rows as never) });
    expect(all(v)).not.toMatch(/The BoQ names flanges/);
    expect(all(v)).toMatch(/Valve insulation is not on our sheets/);
  });
  it("NEGATIVE: no ownHeadingNotes (the calculator, an old caller) -> the full heading notes as before (flange line present)", () => {
    const v = one({ items: [V("Ball Valve", "25 mm dia")], text: "25 mm dia", headings: ["Chilled Water Cassette Unit"], headingNotes: rowHeadingNotes(rows[4] as never, rows as never) });
    expect(all(v)).toMatch(/The BoQ names flanges/);
  });
  // the `unless` key the v68 config sets on the flange note, on a clone of v67's valve config
  const withUnless = () => {
    const cfg = baseCfg();
    const c = structuredClone(cfg.get(VALVE)!) as { list_spec: { pricing: { text_notes: Array<{ pattern: string; unless?: unknown }> } } };
    for (const tn of c.list_spec.pricing.text_notes) if (tn.pattern === "flang") tn.unless = { attr: "flanged", equals: "No", own_words: true };
    cfg.set(VALVE, c as never);
    return cfg;
  };
  it("POSITIVE: a PIBCV read flanged = No under a heading naming flanges -> no flange line (00365 r53)", () => {
    const v = one({ cfg: withUnless(), items: [V("PIBCV", "50 mm", { flanged: "No" })], text: "DN 50 mm dia", headings: ["PIBCV DN 15 to DN 50 threaded, DN 65 and above flanged"] });
    expect(all(v)).not.toMatch(/The BoQ names flanges/);
  });
  it("NEGATIVE: flanged = No but the row's OWN words name flanges -> the line stays; flanged = Yes -> the line stays", () => {
    expect(all(one({ cfg: withUnless(), items: [V("PIBCV", "50 mm", { flanged: "No" })], text: "DN 50 mm flanged" }))).toMatch(/The BoQ names flanges/);
    expect(all(one({ cfg: withUnless(), items: [V("PIBCV", "50 mm", { flanged: "Yes" })], text: "DN 50 mm", headings: ["... flanged"] }))).toMatch(/The BoQ names flanges/);
  });
});

describe("VP-4 T4 -- a D7c strainer moved by the ladder carries ONE note", () => {
  const head = ["Supply, installation ... of ball valve with strainer, suitable for HVAC water piping systems"];
  it("POSITIVE: ball valve 40 + strainer 40 (below the smallest strainer, 50) -> the D7c line says 'priced at 50 mm (the smallest size)', no size line", () => {
    const v = one({ items: [V("Ball Valve", "40NB"), V("Strainer", "40NB", { strainer_type: "Y-Type" })], text: "40NB", headings: head });
    const st = v.items[1];
    expect(JSON.stringify(st.working)).toMatch(/The Y-strainer of \\"with strainer\\", priced at 50 mm \(the smallest size\)/);
    expect((st.fields ?? []).map((f) => f.note).filter(Boolean)).toEqual([]);
    expect(JSON.stringify(st.working)).not.toMatch(/is not on the sheet ->/);
  });
  it("NEGATIVE: strainer 50 (stocked) -> the D7c line keeps 'at the valve's size'", () => {
    const v = one({ items: [V("Ball Valve", "50 mm"), V("Strainer", "50 mm", { strainer_type: "Y-Type" })], text: "50 mm", headings: head });
    expect(JSON.stringify(v.items[1].working)).toMatch(/at the valve's size/);
  });
});

describe("VP-4 T5 -- a kit with several unstocked items names every one", () => {
  it("POSITIVE: by-pass ('none of these') + On-Off 2-way -> both named in the refusal (00122 r492)", () => {
    const v = one({ unit: "Sets", items: [V("Ball Valve", "32mm dia"), NONE("by pass arrangement"), V("2-Way Valve", "32mm dia", { valve_type_as_written: "On-Off type 2 way motorised valves", operation: "On-Off" })], text: "32mm dia valves" });
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toMatch(/by pass arrangement/);
    expect(v.reason).toMatch(/2-Way Valve/);
  });
  it("NEGATIVE: one unstocked item -> the refusal names it alone, as before", () => {
    const v = one({ items: [V("Ball Valve", "32 mm"), NONE("by pass arrangement")], text: "32 mm" });
    expect(v.reason).toMatch(/^item 2 \(none of these\): No SKU in the catalogue for by pass arrangement/);
  });
});
