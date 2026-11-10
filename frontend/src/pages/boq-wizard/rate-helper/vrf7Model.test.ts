/**
 * VRF-7 K1 (owner rulings 2026-11-10 01:30-01:53, from the VRF-6 review) -- THE PRICER, through the panel's entry point
 * (`makePricingSheetHelper(...).compute`), positive AND negative per mechanism:
 *   A1  Side below the smallest Top (regression: a remote type on the ODU hid the Top list); a discharge the chain states wins
 *   A2  armoured only when the BoQ says so (the model's answer; the words safety net)
 *   A3  a length per cable / pipe item; an item with none = the default + a note
 *   A4  the "control wiring" keyword rule is gone (v63 drops the key): the model's scope answer decides
 *   A5  cooling-and-heating wordings = Heat Pump; the row's own "Cooling Type" wins with the override note
 *   A6  every breaker step-up is a note with the HP
 *   B7  the own-row check for every extra wherever stated (the row included); B8 notes quote the BoQ words and where they sit
 *   B9  a stated module setup first when stocked; else the split rule + note
 *   B10 an optional remote is priced in; C13 an individual controller = one remote per indoor unit
 *   B11 fresh air beats CSU; D1 the starter-panel note; D2 the wired-remote note
 *
 * FIXTURE: HVAC v62 + Electrical v72, hvac_vrf's VRF-7 keys from `pricing/__fixtures__/vrf7Model.json` (the file the v63 mint
 * reads; test_vrf_v63 proves the asset equals it). A config WITHOUT the keys (v62 as it is) keeps VRF-6's behaviour.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { type ExtractedListItem } from "./itemListPricing";
import { buildExtractionByRow, chainOf, clip, locateWords, makePricingSheetHelper, type ExtraLineView, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { rowChainOf, rowQuantitiesOf, sheetLinesOf } from "./rateSuggestionModel";
import { applyVrf7, readJsonFixture, type Vrf7Fixture, type Vrf7Group } from "../../pricing/calculatorPanelParity.harness";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h62 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v62.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
const FX7 = readJsonFixture<Vrf7Fixture>(new URL("../../pricing/__fixtures__/vrf7Model.json", import.meta.url));
const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS: RateMasterItem[] = [...toItems(h62), ...toItems(e72)];
const VRF = "hvac_vrf";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
type Q = { id: string; note?: string; [k: string]: unknown };
type Cfg = { list_spec: { pricing: { extras: { prepare: { family_words: Array<Record<string, unknown>> } } }; attribute_definitions: Q[]; second_opinion?: boolean } };
const V62 = () => h62.category_configs.find((x) => x.category_id === VRF)!;
// K2: the fixture is applied by the parity harness's `applyVrf7` -- one copy for these tests and the parity blocks
const vrf7 = (omit: Vrf7Group[] = []) => applyVrf7(V62(), FX7, omit);
const configsOf = (vrf: RateCategoryConfig) => new Map<string, RateCategoryConfig>([
  ...h62.category_configs.map((c) => [c.category_id, c.category_id === VRF ? vrf : c] as [string, RateCategoryConfig]),
  ...e72.category_configs.map((c) => [c.category_id, c] as [string, RateCategoryConfig]),
]);
type Item = Record<string, string>;
const mi = (a: Item): ExtractedListItem => ({ attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) });
type Row = { items?: Item[]; unit?: string; qty?: number; text?: string; headings?: string[]; ownNotes?: string[]; headingNotes?: string[]; ancestorNotes?: string[];
  chainRows?: Array<{ row: number; where: string; text: string }>; category?: string; node?: string };
const sheet = (rows: Record<number, Row>, cfg = vrf7()) => {
  const results = Object.entries(rows).filter(([, r]) => r.items).map(([er, r]) => ({
    excel_row: Number(er), description: r.text ?? "", category_id: r.category ?? VRF, attributes: {}, items: r.items!.map(mi),
  }));
  const helper = makePricingSheetHelper({ configsByCategory: configsOf(cfg), items: ITEMS, extractionByRow: buildExtractionByRow(results as never) });
  const priced = Object.entries(rows).map(([er, r]) => ({ source_row_number: Number(er), qty_total: r.qty ?? 1, node_type: r.node ?? "Line Item", description: r.text ?? "" }));
  const rowQuantities = rowQuantitiesOf(priced as never);
  const sheetLines = sheetLinesOf(priced as never);
  return (er: number): ItemListView => {
    const r = rows[er];
    const res = helper.compute({ excelRow: er, description: r.text ?? "", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: KINDS,
      unit: r.unit ?? "Nos", quantity: r.qty ?? 1, rowQuantities, sheetLines, headings: r.headings ?? [], ownNotes: r.ownNotes ?? [], headingNotes: r.headingNotes ?? [],
      ...(r.ancestorNotes ? { ancestorNotes: r.ancestorNotes } : {}), ...(r.chainRows ? { chainRows: r.chainRows } : {}) } as never, {}) as unknown as ItemListSuggestion;
    return res.itemList!;
  };
};
const one = (r: Row, cfg = vrf7()) => sheet({ 9: r }, cfg)(9);
const ODU = (more: Item = {}): Item => ({ item: "Outdoor Unit", brand: "Blue Star", capacity: "10 HP", ...more });
const lines = (v: ItemListView, b = 0): ExtraLineView[] => v.items[b]?.extras?.lines ?? [];
const byId = (v: ItemListView, id: string, b = 0) => lines(v, b).find((l) => l.id === id);
const val = (l: ExtraLineView | undefined, id: string) => l?.fields.find((f) => f.id === id)?.value;
const note = (l: ExtraLineView | undefined, id: string) => l?.fields.find((f) => f.id === id)?.note;
const review = (v: ItemListView, b = 0) => (v.items[b]?.extras?.review?.points ?? []).join("\n");
const allText = (v: ItemListView) => JSON.stringify(v);
const unitField = (v: ItemListView, id: string, b = 0) => v.items[b]?.fields?.find((f) => f.id === id)?.value;

describe("VRF-7 pure readers", () => {
  it("rowChainOf: the row, its note rows, each heading up with its notes, then the sheet's notes -- each with its excel row", () => {
    const rows = [
      { row_index: 0, source_row_number: 3, description: "Sheet note: all rates include taxes", effective_parent_index: null, effective_classification: "note" },
      { row_index: 1, source_row_number: 10, description: "VRF SYSTEM", effective_parent_index: null, row_notes: "Daikin" },
      { row_index: 2, source_row_number: 11, description: "control wiring in contractor's scope", effective_parent_index: 1, effective_classification: "note" },
      { row_index: 3, source_row_number: 12, description: "Outdoor units", effective_parent_index: 1 },
      { row_index: 4, source_row_number: 13, description: "16 HP", effective_parent_index: 3, row_notes: "16HP+16HP" },
    ];
    expect(rowChainOf(rows[4] as never, rows as never)).toEqual([
      { row: 13, where: "this row", text: "16 HP | 16HP+16HP" },
      { row: 12, where: "heading row 12", text: "Outdoor units" },
      { row: 10, where: "heading row 10", text: "VRF SYSTEM | Daikin" },
      { row: 11, where: "note row 11", text: "control wiring in contractor's scope" },
      { row: 3, where: "sheet note row 3", text: "Sheet note: all rates include taxes" },
    ]);
  });
  it("locateWords finds the quote without case / spacing / punctuation; its first six words when the quote runs on; else null", () => {
    const chain = [{ where: "this row", text: "2.01 TR" }, { where: "heading row 12", text: "Hi-Wall units with in-built  drain pump, wired remote" }];
    expect(locateWords("with inbuilt drain pump", chain)).toBeNull();
    expect(locateWords("with in built drain pump", chain)).toBe("heading row 12");
    expect(locateWords("HI-WALL UNITS WITH IN-BUILT DRAIN PUMP, WIRED REMOTE AND MORE WORDS THAT ARE NOT THERE", chain)).toBe("heading row 12");
    expect(locateWords("refnet", chain)).toBeNull();
  });
  it("chainOf without chainRows: the row, its notes, the headings' notes, the headings nearest first; clip cuts on a word", () => {
    expect(chainOf({ description: "6 HP", ownNotes: ["n1"], headings: ["ROOT", "PARENT"], headingNotes: ["hn"] } as never).map((c) => c.where + ":" + c.text))
      .toEqual(["this row:6 HP", "this row's note:n1", "a heading's note:hn", "a heading:PARENT", "a heading:ROOT"]);
    expect(clip("one two three four five", 10)).toBe("one two...");
    expect(clip("short", 10)).toBe("short");
  });
});

describe("VRF-7 A1 -- Side below the smallest Top; a stated discharge wins", () => {
  it("00098 r14 '3 TR' with the model's remote type on the ODU -> Side 4 HP (the regression), noted", () => {
    const v = one({ items: [ODU({ capacity: "3 TR", remote_type: "Wired", compressor: "Standard" })] });
    expect(unitField(v, "discharge")).toBe("Side");
    expect(unitField(v, "capacity")).toBe("4");
  });
  it("a heading 'top discharge' on a 6 HP Blue Star -> Top (next stocked Top 7 HP) + the note; 'side discharge' -> Side 6", () => {
    const top = one({ items: [ODU({ capacity: "6 HP" })], headings: ["VRF ODU - top discharge"] });
    expect(unitField(top, "discharge")).toBe("Top");
    expect(unitField(top, "capacity")).toBe("7");
    expect(review(top)).toMatch(/BoQ says "top discharge" \(a heading\) - priced as Top discharge/);
    const side = one({ items: [ODU({ capacity: "8 HP" })], text: "8 HP Side discharge" });
    expect(unitField(side, "discharge")).toBe("Side");
    expect(unitField(side, "capacity")).toBe("8");
  });
  it("the nearest level wins: the row 'Top dishcarge' over a heading 'side discharge'", () => {
    const v = one({ items: [ODU({ capacity: "18 HP" })], text: "18 HP - Top dishcarge", headings: ["ODU side discharge"] });
    expect(unitField(v, "discharge")).toBe("Top");
    expect(review(v)).toMatch(/"Top dishcarge" \(this row\)/);
  });
  it("NEGATIVE: the model's own discharge stands over the chain's words; nothing stated + 8 HP -> Top (team default)", () => {
    expect(unitField(one({ items: [ODU({ capacity: "8 HP", discharge: "Side" })], headings: ["top discharge"] }), "discharge")).toBe("Side");
    expect(unitField(one({ items: [ODU({ capacity: "8 HP" })] }), "discharge")).toBe("Top");
  });
  it("NEGATIVE: without discharge_words (v62's keys) a heading's 'top discharge' is not read -> a 6 HP goes Side", () => {
    expect(unitField(one({ items: [ODU({ capacity: "6 HP" })], headings: ["top discharge"] }, vrf7(["prepare"])), "discharge")).toBe("Side");
  });
});

describe("VRF-7 A2 -- armoured only when the BoQ says so", () => {
  const ARM = "Price includes armoured copper conductor cabling with end termination from Switch to ODU";
  it("the heading's 'armoured ... cabling ... to ODU' (00234 r8) -> the power cable armoured, the note quotes the clause", () => {
    const v = one({ items: [ODU({ capacity: "6 HP", includes_power: "Yes", includes_power_where: "Note" })], headingNotes: [ARM] });
    expect(val(byId(v, "power"), "armour")).toBe("ARMOURED");
    expect(review(v)).toMatch(/Power cable: armoured - the BoQ says "Price includes armoured copper conductor cabling/);
  });
  it("the model's own Yes (no words in the chain) -> armoured with the field note", () => {
    const v = one({ items: [ODU({ includes_power: "Yes", extra_power_armoured: "Yes" })] });
    expect(val(byId(v, "power"), "armour")).toBe("ARMOURED");
    expect(note(byId(v, "power"), "armour")).toMatch(/armoured \(owner A2\)/);
  });
  it("NEGATIVE: no armour words (00073 r51) -> unarmoured; 'unarmoured cable' -> unarmoured; power not included -> no note", () => {
    expect(val(byId(one({ items: [ODU({ includes_power: "Yes" })] }), "power"), "armour")).toBe("UNARMOURED");
    expect(val(byId(one({ items: [ODU({ includes_power: "Yes" })], headingNotes: ["unarmoured power cable"] }), "power"), "armour")).toBe("UNARMOURED");
    expect(review(one({ items: [ODU({ includes_frame: "Yes" })], headingNotes: [ARM] }))).not.toMatch(/armoured/);
  });
  it("NEGATIVE: v62's keys -> the heading's armour is missed (the review's A2)", () => {
    const v = one({ items: [ODU({ capacity: "6 HP", includes_power: "Yes" })], headingNotes: [ARM] }, vrf7(["prepare", "from_model"]));
    expect(val(byId(v, "power"), "armour")).toBe("UNARMOURED");
  });
});

describe("VRF-7 A3 -- a length per item", () => {
  it("00175: power 5 m (its own answer), comm the 30 m default with the note", () => {
    const v = one({ items: [ODU({ capacity: "18 HP", includes_power: "Yes", includes_comm: "Yes", extra_power_length_as_written: "around a distance of 5m" })] });
    expect(val(byId(v, "power"), "length")).toBe("5");
    expect(val(byId(v, "comm"), "length")).toBe("30");
    expect(note(byId(v, "comm"), "length")).toBe("no length stated for communication cable - 30 m default used (owner A3)");
    expect(note(byId(v, "power"), "length")).toBeUndefined();
  });
  it("a copper length reaches the copper lines only", () => {
    const v = one({ items: [ODU({ includes_copper: "Yes", includes_power: "Yes", extra_copper_length_as_written: "up to 15 m" })] });
    expect(val(byId(v, "copper_supply"), "length")).toBe("15");
    expect(val(byId(v, "power"), "length")).toBe("30");
  });
  it("NEGATIVE: v62's keys -> the one shared length reaches every line (the review's A3)", () => {
    const v = one({ items: [ODU({ capacity: "18 HP", includes_power: "Yes", includes_comm: "Yes", extra_length_as_written: "around a distance of 5m" })] }, vrf7(["from_model"]));
    expect(val(byId(v, "comm"), "length")).toBe("5");
  });
});

describe("VRF-7 A4 -- the control-wiring keyword rule is gone", () => {
  it("a heading 'control wiring' with no comm answer -> no comm line; the model's Yes -> comm", () => {
    const fault = ["During any fault / Breakdown in the control wiring circuit the system must work"];
    expect(byId(one({ items: [ODU({ includes_power: "Yes" })], headings: fault }), "comm")).toBeUndefined();
    expect(byId(one({ items: [ODU({ includes_comm: "Yes" })], headings: fault }), "comm")).toBeDefined();
  });
  it("NEGATIVE: v62's safeguard (control_wiring kept) -> comm from the fault sentence (the review's A4)", () => {
    const v = one({ items: [ODU({ includes_power: "Yes" })], headings: ["During any fault / Breakdown in the control wiring circuit"] }, vrf7(["safeguard"]));
    expect(byId(v, "comm")).toBeDefined();
  });
  it("the v63 includes_comm question says fault sentences are not scope and every chain level counts", () => {
    const q = (vrf7() as unknown as Cfg).list_spec.attribute_definitions.find((d) => d.id === "includes_comm")!;
    expect(q.note).toMatch(/fails or breaks down is NOT scope/);
    expect(q.note).toMatch(/EVERY level above the row/);
  });
});

describe("VRF-7 A5 / A6 -- heat pump wordings; the override and step-up notes", () => {
  it("00100 r8: 'suitable for cooling/heating' in a heading -> Heat Pump, noted", () => {
    const v = one({ items: [ODU({ includes_frame: "Yes" })], headings: ["VRF outdoor units suitable for cooling/heating"] });
    expect(unitField(v, "cooling")).toBe("Heat Pump");
    expect(review(v)).toMatch(/BoQ says "cooling\/heating" \(a heading\) - priced as Heat Pump \(owner A5\)/);
  });
  it("00144 r33: the row's '(Cooling Type)' under 'cooling as well as heating' -> Cool Only with the override note", () => {
    const v = one({ items: [ODU({ cooling: "Cool Only", capacity: "26HP" })], text: "26HP high COP outdoor unit.(Cooling Type) TFA", headings: ["outdoor unit for cooling as well as heating mode"] });
    expect(unitField(v, "cooling")).toBe("Cool Only");
    expect(review(v)).toMatch(/The row says "Cooling Type" and the heading says "cooling as well as heating" - the row wins: priced as Cool Only/);
  });
  it("A6: 6 HP -> MCB 20 A -> 25 A and ELCB 20 A -> 25 A, each a note with the HP; 12 HP -> only the ELCB 32 -> 40 A", () => {
    const six = review(one({ items: [ODU({ capacity: "6 HP", includes_mccb: "Yes" })] }));
    expect(six).toMatch(/MCB - 6 HP: schedule says 20 A - not stocked; 25 A used \(owner A6\)/);
    expect(six).toMatch(/ELCB - 6 HP: schedule says 20 A - not stocked; 25 A used/);
    const twelve = review(one({ items: [ODU({ capacity: "12 HP", includes_mccb: "Yes" })] }));
    expect(twelve).toMatch(/ELCB - 12 HP: schedule says 32 A - not stocked; 40 A used/);
    expect(twelve).not.toMatch(/MCB - 12 HP/);
  });
  it("NEGATIVE: no heat wording -> Cool Only (default); v62's keys -> no override note on 00144, no step-up note", () => {
    expect(unitField(one({ items: [ODU({ includes_frame: "Yes" })], headings: ["VRF outdoor units"] }), "cooling")).toBe("Cool Only");
    const v = one({ items: [ODU({ cooling: "Cool Only", capacity: "26HP" })], text: "26HP (Cooling Type)", headings: ["cooling as well as heating mode"] }, vrf7(["prepare"]));
    expect(review(v)).not.toMatch(/the row wins/);
    expect(review(one({ items: [ODU({ capacity: "6 HP", includes_mccb: "Yes" })] }, vrf7(["accessories"])))).not.toMatch(/schedule says/);
  });
});

describe("VRF-7 B7 / B8 -- the own-row check for every extra; notes quote the BoQ", () => {
  const chain = [{ row: 13, where: "this row", text: "2.01 TR / 600 CFM" }, { row: 12, where: "heading row 12", text: "Hi-Wall units with inbuilt drain pump" }];
  it("00233 r13: inbuilt drain pump + the sheet's pump row 50 -> NOT added; the note quotes the words and says where", () => {
    const s = sheet({
      13: { items: [{ item: "Hi-Wall", brand: "Blue Star", capacity: "2 TR", includes_drain_pump: "Yes", includes_drain_pump_where: "Heading", includes_drain_pump_words: "with inbuilt drain pump" }], chainRows: chain },
      50: { items: [{ item: "Drain Pump", brand: "Blue Star" }], text: "Drain pump" },
    });
    const r = review(s(13));
    expect(r).toMatch(/Drain pump: the BoQ says "with inbuilt drain pump" \(heading row 12\) - NOT added: the BoQ quotes it on its own row \(row 50\)/);
    expect(byId(s(13), "acc_drain_pump")).toBeUndefined();
  });
  it("an extra the ROW states, with an own row on the sheet -> NOT added (owner 01:36); with none -> added + the quoting note", () => {
    const mk = (withRow: boolean) => {
      const rows: Record<number, Row> = { 9: { items: [ODU({ includes_frame: "Yes", includes_frame_where: "Row", includes_frame_words: "including MS frame" })], text: "10 HP including MS frame" } };
      if (withRow) rows[60] = { items: [{ item: "MS frame / stand for ODU" }], text: "MS stand for ODU" };
      return sheet(rows)(9);
    };
    expect(byId(mk(true), "acc_frame")).toBeUndefined();
    expect(review(mk(true))).toMatch(/MS frame \/ stand: the BoQ says "including MS frame" \(this row\) - NOT added: the BoQ quotes it on its own row \(row 60\)/);
    expect(byId(mk(false), "acc_frame")).toBeDefined();
    expect(review(mk(false))).toMatch(/MS frame \/ stand: the BoQ says "including MS frame" \(this row\) - added \(the BoQ has no row of its own for it\)/);
  });
  it("words the chain does not hold -> the model's place; no words -> VRF-6's line", () => {
    expect(review(one({ items: [ODU({ includes_frame: "Yes", includes_frame_where: "Note", includes_frame_words: "frame by contractor" })] })))
      .toMatch(/the BoQ says "frame by contractor" \(the note\) - added/);
    expect(review(one({ items: [ODU({ includes_frame: "Yes", includes_frame_where: "Note" })] }))).toMatch(/MS frame \/ stand: stated in note - added/);
  });
  it("NEGATIVE: v62's safeguard -> a row-stated extra is added with no note despite its own row (the review's B7)", () => {
    const v = sheet({
      9: { items: [ODU({ includes_frame: "Yes", includes_frame_where: "Row" })], text: "10 HP including MS frame" },
      60: { items: [{ item: "MS frame / stand for ODU" }], text: "MS stand for ODU" },
    }, vrf7(["safeguard"]))(9);
    expect(byId(v, "acc_frame")).toBeDefined();
    expect(review(v)).not.toMatch(/frame/i);
  });
});

describe("VRF-7 B9 -- a stated module setup first", () => {
  it("00191 r7 'minimum 2 units of at least 20 HP each' (Blue Star) -> 20 + 20, noted", () => {
    const v = one({ items: [ODU({ capacity: "40 HP (in a combination of minimum 2 units of at least 20 HP each with combined capacity of 40 HP or higher)", cooling: "Heat Pump", includes_gas: "Yes" })] });
    expect(v.items.map((b) => b.fields?.find((f) => f.id === "capacity")?.value)).toEqual(["20", "20"]);
    expect(review(v)).toMatch(/The BoQ states the modules: "minimum 2 units of at least 20 HP each" \(this row\) - priced as 20 \+ 20 HP/);
  });
  it("Blue Star '32 HP' + the row note '16HP+16HP' -> 16 + 16, gas 16 Kg per module", () => {
    const v = one({ items: [ODU({ capacity: "32 H.P", includes_gas: "Yes" })], text: "ODU-01 : 32 H.P", ownNotes: ["16HP+16HP"] });
    expect(v.items.map((b) => b.fields?.find((f) => f.id === "capacity")?.value)).toEqual(["16", "16"]);
    expect(val(byId(v, "acc_gas", 0), "qty")).toBe("16");
  });
  it("00267 r14 Daikin heat pump '16HP+16HP' -> not stocked (Daikin HP: 6 / 8 / 20 / 34): the split rule (34 HP single) + the note", () => {
    const v = one({ items: [ODU({ brand: "Daikin", cooling: "Heat Pump", capacity: "32 H.P" })], text: "ODU-01 : 32 H.P", ownNotes: ["16HP+16HP"] });
    expect(v.items.map((b) => b.fields?.find((f) => f.id === "capacity")?.value)).toEqual(["34"]);
    expect(review(v)).toMatch(/16 HP is not stocked for Daikin Heat Pump - priced by the split rule \(owner B9\)/);
  });
  it("NEGATIVE: v62's keys -> 00191 r7 by the split rule (28 + 12, the review's B9); a heading's '20HP+18HP' is not this row's setup", () => {
    const v = one({ items: [ODU({ capacity: "40 HP (in a combination of minimum 2 units of at least 20 HP each)", cooling: "Heat Pump" })] }, vrf7(["prepare"]));
    expect(v.items.map((b) => b.fields?.find((f) => f.id === "capacity")?.value)).toEqual(["28", "12"]);
    const h = one({ items: [ODU({ capacity: "16 HP" })], headings: ["System-1 38HP (20HP+18HP)"] });
    expect(h.items.map((b) => b.fields?.find((f) => f.id === "capacity")?.value)).toEqual(["16"]);
  });
});

describe("VRF-7 B10 / C13 / B11 / D1 / D2", () => {
  const DUCT = (more: Item = {}): Item => ({ item: "Ductable", brand: "Blue Star", capacity: "8.0 TR", ...more });
  it("B10: 'with/without wired remote controller as per the requirement of the client' -> a Wired remote added, the note quotes it", () => {
    const v = one({ items: [DUCT()], headingNotes: ["Units to be supplied with/without wired remote controller as per the requirement of the client."] });
    expect(val(byId(v, "acc_remote"), "remote_type")).toBe("Wired");
    expect(review(v)).toMatch(/Remote: the BoQ says "with\/without wired remote controller as per the requirement of the client" \(a heading's note\) - the remote is priced in/);
  });
  it("C13: 'with individual controller' in a system heading -> one remote per indoor unit, noted; NEGATIVE: an outdoor unit under it gets none", () => {
    const head = ["VRF system complete with indoor and outdoor units with individual controller"];
    const v = one({ items: [{ item: "Hi-Wall", brand: "Blue Star", capacity: "1.5 TR" }], headings: head });
    expect(byId(v, "acc_remote")).toBeDefined();
    expect(review(v)).toMatch(/one remote per indoor unit \(owner C13\)/);
    expect(allText(one({ items: [ODU()], headings: head }))).not.toMatch(/owner C13/);
  });
  it("B11: 'CSU type ... treated fresh air unit' (00158 r82) -> the fresh-air unit 6.8 TR; NEGATIVE: CSU alone stays Ductable", () => {
    const v = one({ items: [DUCT({ capacity: "6.8 TR" })], headings: ["Supply of CSU type VRF / VRV treated fresh air unit"] });
    expect(v.items[0].family).toBe("Single Skin Treated Fresh Air");
    expect(unitField(v, "capacity")).toBe("6.8");
    expect(review(v)).toMatch(/fresh air beats CSU \(owner B11\)/);
    expect(one({ items: [DUCT({ capacity: "3 TR" })], headings: ["Supply of CSU type indoor unit"] }).items[0].family).toBe("Ductable");
  });
  it("B11 NEGATIVE (K1b): 'TFA' further up (a grandparent heading, another unit's note) leaves a Ductable and a cassette alone; a cassette under a TFA heading stays a cassette", () => {
    const up = { headings: ["VRF system - ODU 26HP for the TFA units", "Ductable units"], ancestorNotes: ["the TFA is on the terrace"] };
    expect(one({ items: [DUCT({ capacity: "3 TR" })], ...up }).items[0].family).toBe("Ductable");
    expect(one({ items: [{ item: "Cassette", brand: "Blue Star", capacity: "2 TR", way: "FOUR-WAY" }], headings: ["Treated fresh air units"] }).items[0].family).toBe("Cassette");
    // a CSU row with 'TFA' only further up: the CSU rule still applies (its 'unless' reads the row and its own heading only)
    expect(one({ items: [{ capacity: "3 TR" }], text: "CSU 3 TR", headings: ["VRF system for the TFA units", "Indoor units"] }).items[0].family).toBe("Ductable");
    // 00218 HVAC-2F r225 (K1b): the unit's own heading LISTS "drain pumps for cassette, ductable & TFA units" -- that names other units
    expect(one({ items: [DUCT({ capacity: "2 TR" })], headings: ["VRF SYSTEM", "SITC of VRF indoor units ... drain pumps for cassette, ductable & TFA units"], ownNotes: ["Ceiling Suspended Ductable Units"] }).items[0].family).toBe("Ductable");
    // 'TFA' in the row itself with 'CSU' -> the fresh-air unit, and no CSU note re-labels it
    const rowTfa = one({ items: [DUCT({ capacity: "6.8 TR" })], text: "6.8 TR TFA (CSU type)" });
    expect(rowTfa.items[0].family).toBe("Single Skin Treated Fresh Air");
    expect(review(rowTfa)).not.toMatch(/priced as a Ductable unit/);
    // the unit's OWN heading saying TFA still wins over CSU (00158 r82, its heading row 79)
    expect(one({ items: [DUCT({ capacity: "6.8 TR" })], headings: ["INDOOR UNIT", "Supply of CSU type VRF / VRV treated fresh air unit"] }).items[0].family).toBe("Single Skin Treated Fresh Air");
  });
  it("B11: the Ductable rule's own 'unless' holds even without the fresh-air rule (an item with no family under 'CSU ... treated fresh air' is not made a Ductable)", () => {
    const cfg = vrf7();
    const fw = (cfg as unknown as Cfg).list_spec.pricing.extras.prepare.family_words;
    (cfg as unknown as Cfg).list_spec.pricing.extras.prepare.family_words = fw.filter((f) => f.family !== "Single Skin Treated Fresh Air");
    const head = ["CSU type treated fresh air unit"];
    expect(one({ items: [{ capacity: "2 TR" }], headings: head }, cfg).items[0].family).not.toBe("Ductable");
    // NEGATIVE: without the unless (v62's rule) the CSU words make it a Ductable
    expect(one({ items: [{ capacity: "2 TR" }], headings: head }, vrf7(["family"])).items[0].family).toBe("Ductable");
  });
  it("D1: 'unit mounted starter panel ... disconnecting switches with fuses' -> MCB + ELCB kept + the note; NEGATIVE: none -> no note", () => {
    const v = one({ items: [ODU({ capacity: "6 HP", includes_mccb: "Yes" })], headingNotes: ["unit mounted starter panel with power disconnecting switches with fuses"] });
    expect(byId(v, "acc_mcb")).toBeDefined();
    expect(byId(v, "acc_elcb")).toBeDefined();
    expect(review(v)).toMatch(/the unit's own starter panel has switches with fuses; MCB \+ ELCB still added, please check \(owner D1\)/);
    expect(review(one({ items: [ODU({ capacity: "6 HP", includes_mccb: "Yes" })] }))).not.toMatch(/owner D1/);
  });
  it("D2: 'coreded/cordless ... remotes' + a note 'LCD wired remote controller' -> Cordless kept, the note quotes both", () => {
    const chainRows = [{ row: 324, where: "this row", text: "2.0 TR" },
      { row: 311, where: "heading row 311", text: "scope also covers for suitable coreded/cordless digital thermostat remotes with LCD screen" },
      { row: 312, where: "note row 312", text: "Each indoor unit shall have an LCD wired remote controller" }];
    const v = one({ items: [DUCT({ capacity: "2 TR", includes_remote: "Yes" })], headings: [chainRows[1].text], ancestorNotes: [chainRows[2].text], chainRows });
    expect(val(byId(v, "acc_remote"), "remote_type")).toBe("Cordless");
    expect(review(v)).toMatch(/Remote: the BoQ says ".*coreded\/cordless.*" and also ".*LCD wired remote controller" \(note row 312\) - priced as Cordless, please check \(owner D2\)/);
  });
  it("NEGATIVE: the model's own Wired -> no D2 note; v62's keys -> no remote on B10 / C13 rows, Ductable on 00158 r82", () => {
    expect(review(one({ items: [DUCT({ includes_remote: "Yes", remote_type: "Wired" })], headings: ["coreded/cordless remotes"], headingNotes: ["wired remote"] }))).not.toMatch(/owner D2/);
    const old = vrf7(["prepare", "family"]);
    expect(byId(one({ items: [DUCT()], headingNotes: ["supplied with/without wired remote controller as per the requirement of the client"] }, old), "acc_remote")).toBeUndefined();
    expect(one({ items: [DUCT({ capacity: "6.8 TR" })], headings: ["CSU type treated fresh air unit"] }, old).items[0].family).toBe("Ductable");
  });
});

describe("VRF-7 -- the v63 questions (fixture)", () => {
  it("adds the armour / per-item length / BoQ-words / module setup questions, drops the shared length; second opinion stays off", () => {
    const defs = (vrf7() as unknown as Cfg).list_spec.attribute_definitions.map((d) => d.id);
    for (const id of ["extra_power_armoured", "extra_comm_armoured", "extra_power_length_as_written", "extra_comm_length_as_written",
      "extra_copper_length_as_written", "includes_copper_words", "includes_mccb_words", "module_setup_as_written"]) expect(defs).toContain(id);
    expect(defs).not.toContain("extra_length_as_written");
    expect(defs.length).toBe(68);
    expect((vrf7() as unknown as Cfg).list_spec.second_opinion).toBe(false);
  });
});

describe("VRF-7 -- Derivation lines, each on its key", () => {
  it("v63 adds the ten VRF-7 lines and names only 'quantified separately' (the control-wiring key is gone); v62 lists none of them", () => {
    const t7 = itemListRuleOrder(vrf7(), ITEMS).map((l) => l.title);
    const t6 = itemListRuleOrder(V62(), ITEMS).map((l) => l.title);
    const v7Titles = ["A discharge type the BoQ states wins", "Cooling-and-heating wordings are a heat pump", "A cable is armoured only when the BoQ says so",
      "A length belongs to the item it is written for", "Every extra: added only when the sheet has no row of its own for it, always with a note",
      "A breaker step-up is noted", "A module setup the BoQ states comes first", "An optional remote and an individual controller include the remote",
      "A treated fresh air unit is priced as the fresh-air unit", "Starter-panel and wired-remote notes"];
    for (const t of v7Titles) { expect(t7).toContain(t); expect(t6).not.toContain(t); }
    expect(t7).toContain("'Quantified separately' wins");
    expect(t7).not.toContain("'Control wiring' and 'quantified separately'");
    expect(t6).toContain("'Control wiring' and 'quantified separately'");
    expect(t7.length - t6.length).toBe(v7Titles.length);
  });
});
