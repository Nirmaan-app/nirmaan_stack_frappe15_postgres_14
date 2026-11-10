/**
 * VRF-9 K1 (the VRF-8 review S1-S7, owner rulings R1-R4 2026-11-11 00:36-00:43, ANSWER 2 S8-S10 00:59-01:06) -- THE PRICER,
 * through the panel's entry point (`makePricingSheetHelper(...).compute`), positive AND negative per mechanism:
 *   S2  a row naming its OWN unit type ("Wall Mounted Type") is priced as it under a several-types heading (R-D12 only when unnamed)
 *   S3  "Supply of" row + installation said above -> supply + installation AND the scope note, whatever the model answered
 *   S4  installation at ANY level of the chain wins over a supply-only reading of a nearer note
 *   S5  the panel's own notes quote exact stretches (no "...") and name each quote's row
 *   S6  a make fallback keeps every extra (the drain pump) and the note names the asked makes
 *   S7  the feeder "N m" note on every module; a TFA with no capacity read takes the row's CFM / TR / HP
 *   S8  a Set the BoQ defines (liquid + gas = one Set) = 1 refnet per Set
 *   S9  gas charging / topping up is always supply + installation; a gas row with no item read gets the gas item
 *   S10 an ODU frame row with no item read gets the frame item (per Kg -> the per-Kg frame item)
 *   R1  "factory charged with first charge of refrigerant" = gas included (the own-row rule still decides)
 *   R2  BMS-interface cables are not the VRF communication cable
 *   R3  civil pedestal / foundation is not the MS frame
 *   R4  a Fan Coil Unit with no type told refuses "Fan Coil Unit - pick the indoor type"
 *
 * FIXTURE: HVAC v64 + Electrical v72, hvac_vrf's VRF-9 keys from `pricing/__fixtures__/vrf9Model.json` (the file the v65 mint
 * reads; test_vrf_v65 proves the asset equals it). A config WITHOUT the keys (v64 as it is) keeps VRF-8's behaviour.
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { type ExtractedListItem } from "./itemListPricing";
import { buildExtractionByRow, makePricingSheetHelper, type ExtraLineView, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { rowQuantitiesOf, sheetLinesOf } from "./rateSuggestionModel";
import { applyVrf9, readJsonFixture, type Vrf9Fixture, type Vrf9Group } from "../../pricing/calculatorPanelParity.harness";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h64 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v64.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
const FX9 = readJsonFixture<Vrf9Fixture>(new URL("../../pricing/__fixtures__/vrf9Model.json", import.meta.url));

const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS: RateMasterItem[] = [...toItems(h64), ...toItems(e72)];
const VRF = "hvac_vrf";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const V64 = () => h64.category_configs.find((x) => x.category_id === VRF)!;
const vrf9 = (omit: Vrf9Group[] = []) => applyVrf9(V64(), FX9, omit);
const v64 = () => V64();
const configsOf = (vrf: RateCategoryConfig) => new Map<string, RateCategoryConfig>([
  ...h64.category_configs.map((c) => [c.category_id, c.category_id === VRF ? vrf : c] as [string, RateCategoryConfig]),
  ...e72.category_configs.map((c) => [c.category_id, c] as [string, RateCategoryConfig]),
]);
type Item = Record<string, string | null>;
const mi = (a: Item): ExtractedListItem => ({ attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: v === null ? 0 : 0.9 }])) as never });
type Row = { items?: Item[]; unit?: string; qty?: number; text?: string; headings?: string[]; ownNotes?: string[]; headingNotes?: string[]; ancestorNotes?: string[];
  chainRows?: Array<{ row: number; where: string; text: string }>; category?: string; node?: string };
const sheet = (rows: Record<number, Row>, cfg = vrf9()) => {
  const results = Object.entries(rows).filter(([, r]) => r.items).map(([er, r]) => ({
    excel_row: Number(er), description: r.text ?? "", category_id: r.category ?? VRF, attributes: {}, items: r.items!.map(mi),
  }));
  const helper = makePricingSheetHelper({ configsByCategory: configsOf(cfg), items: ITEMS, extractionByRow: buildExtractionByRow(results as never) });
  const priced = Object.entries(rows).map(([er, r]) => ({ source_row_number: Number(er), qty_total: r.qty ?? 1, node_type: r.node ?? "Line Item", description: r.text ?? "", unit: r.unit ?? "Nos" }));
  const rowQuantities = rowQuantitiesOf(priced as never);
  const sheetLines = sheetLinesOf(priced as never);
  return (er: number): ItemListView => {
    const r = rows[er];
    const res = helper.compute({ excelRow: er, description: r.text ?? "", nodeType: "Line Item", category: r.category ?? VRF, discipline: "HVAC", rateKinds: KINDS,
      unit: r.unit ?? "Nos", quantity: r.qty ?? 1, rowQuantities, sheetLines, headings: r.headings ?? [], ownNotes: r.ownNotes ?? [], headingNotes: r.headingNotes ?? [],
      ...(r.ancestorNotes ? { ancestorNotes: r.ancestorNotes } : {}), ...(r.chainRows ? { chainRows: r.chainRows } : {}) } as never, {}) as unknown as ItemListSuggestion;
    return res.itemList!;
  };
};
const one = (r: Row, cfg = vrf9()) => sheet({ 9: r }, cfg)(9);
const ODU = (more: Item = {}): Item => ({ item: "Outdoor Unit", brand: "Blue Star", capacity: "10 HP", ...more });
const lines = (v: ItemListView, b = 0): ExtraLineView[] => v.items[b]?.extras?.lines ?? [];
const byId = (v: ItemListView, id: string, b = 0) => lines(v, b).find((l) => l.id === id);
const review = (v: ItemListView, b = 0) => (v.items[b]?.extras?.review?.points ?? []).join("\n");
const unitField = (v: ItemListView, id: string, b = 0) => v.items[b]?.fields?.find((f) => f.id === id)?.value;
const ch = (...e: Array<[number, string, string]>) => e.map(([row, where, text]) => ({ row, where, text }));
const D12_NOTES = ["Hi-Wall Split Units", "4 Way Compact Cassette Units", "4 Way Cassette Units", "Ceiling Suspended Ductable Units"];
const D12_REFUSAL = "several unit types under this heading - fix the headings or pick the type (owner D12)";

describe("VRF-9 S2 -- R-D12 refuses only when the row names no unit type", () => {
  const H = "SITC of VRF indoor units of the following types";
  it("00051 r48 'Wall Mounted Type (2.0TR)' under a several-types heading -> priced as Hi-Wall", () => {
    const v = one({ items: [{ item: "Hi-Wall", capacity: "2.0TR" }], text: "Wall Mounted Type (2.0TR)", headings: [H], headingNotes: D12_NOTES });
    expect(v.rowPriced).toBe(true);
    expect(v.items[0].family).toBe("Hi-Wall");
  });
  it("NEGATIVE: a row naming no type still refuses, with the ruled text on the row and on every unit", () => {
    const v = one({ items: [{ item: null, capacity: "2.0 TR" }], text: "2.0 TR", headings: [H], headingNotes: D12_NOTES });
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe(D12_REFUSAL);
    expect(v.items.every((b) => b.reason === D12_REFUSAL)).toBe(true);
  });
  it("NEGATIVE: v64 (no VRF-9 unit words) refuses the 'Wall Mounted Type' row (the VRF-8 behaviour)", () => {
    expect(one({ items: [{ item: "Hi-Wall", capacity: "2.0TR" }], text: "Wall Mounted Type (2.0TR)", headings: [H], headingNotes: D12_NOTES }, v64()).reason).toBe(D12_REFUSAL);
  });
  it("NEGATIVE: 'wall mounted corded remote' is a remote, not a Hi-Wall unit -- the row still names no type", () => {
    const v = one({ items: [{ item: null, capacity: "2.0 TR" }], text: "2.0 TR with wall mounted corded remote", headings: [H], headingNotes: D12_NOTES });
    expect(v.reason).toBe(D12_REFUSAL);
  });
});

describe("VRF-9 S3 -- 'Supply of' row + installation said above: supply + installation AND the scope note, always", () => {
  const NOTE3 = "Notes 1. Materials Debris shall be cleared as per site instruction. 9.The unit rate for all Items shall include all costs - packing, forwarding, freight, insurance and transport to site, storage, installation, testing, balancing, commissioning";
  const r4 = (scope: string | null, cfg = vrf9(), text = "VRV/VRF - 50HP | Supply of VRV/VRF outdoor unit as per the specification and as per the capacity below") =>
    one({ items: [ODU({ capacity: "16 HP", scope })], text, chainRows: ch([4, "this row", text], [3, "heading row 3", NOTE3]) }, cfg);
  it("00370 r4: the model left the scope blank -> S+I and the note quoting both, with the heading's row", () => {
    const v = r4(null);
    expect(v.scope?.value).toBe("Supply + installation");
    expect(v.scope?.note ?? "").toMatch(/^BoQ: the row says "Supply of VRV\/VRF outdoor unit as per the specification and as per the capacity below" and ".*installation.*" \(heading row 3\) - priced as supply \+ installation \(owner R-D1\)$/);
    expect(v.scope?.note ?? "").not.toMatch(/\.\.\./);
    expect(v.totals?.install_rate).toBeGreaterThan(0);
  });
  it("00098 r14 shape: 'Supply of ... to be installed in the terrace' on the unit's own heading note -> the note", () => {
    const n13 = "Supply of high static outdoor unit suitable for multiple indoor units as listed below. Outdoor units to be installed in the terrace.";
    const v = one({ items: [ODU({ capacity: "4 HP", scope: "Supply + installation" })], text: "3 TR at 43C ambient",
      chainRows: ch([14, "this row", "3 TR at 43C ambient"], [9, "heading row 9", "VARIABLE REFRIGERANT FLOW UNITS :"], [13, "note row 13", n13]) });
    expect(v.scope?.note ?? "").toMatch(/the row says "Supply of high static outdoor unit suitable for multiple indoor units as listed below" and "Outdoor units to be installed in the terrace" \(note row 13\)/);
  });
  it("NEGATIVE: no installation wording anywhere (00009 r80) -> no note; the row's own installation words -> no note; v64 -> no note", () => {
    const t80 = "Supply & providing of MS stand for VRV ODU along with proper supports";
    expect(one({ items: [ODU({ capacity: "6 HP" })], text: t80, chainRows: ch([80, "this row", t80], [21, "heading row 21", "VRF SYSTEM WORKS"]) }).scope?.note).toBeUndefined();
    expect(r4(null, vrf9(), "Supply of VRV outdoor unit including installation, testing and commissioning").scope?.note).toBeUndefined();
    expect(r4(null, v64()).scope?.note).toBeUndefined();
  });
});

describe("VRF-9 S4 -- installation at ANY level wins over a supply-only reading of a nearer note", () => {
  const n50 = "Supply, port clearance, transport of AIR COOLED Variable Refrigerant Flow Modular type Outdoor units suitable with high efficiency";
  const n20 = "Supply, Installation,testing & commissioning of Variable Refrigerant volume - modular type air-conditioning system complete with indoor units";
  const chain51 = ch([51, "this row", "38 HP - Out door unit (14HP+24HP)"], [49, "heading row 49", "OUTDOOR UNITS"], [50, "note row 50", n50], [19, "heading row 19", "VRV HIGHSIDE WORKS"], [20, "note row 20", n20]);
  const r51 = (cfg = vrf9(), text = "38 HP - Out door unit (14HP+24HP)") => one({ items: [ODU({ capacity: "38 HP (14HP+24HP)", scope: "Supply only" })], text, chainRows: chain51 }, cfg);
  it("00363 r51: Supply only from note row 50; note row 20 says installation -> S+I + the note naming note row 20", () => {
    const v = r51();
    expect(v.scope?.value).toBe("Supply + installation");
    expect(v.scope?.note ?? "").toMatch(/^BoQ: the row reads as supply only, but "Supply, Installation,testing & commissioning of Variable Refrigerant volume.*" \(note row 20\) says installation - priced as supply \+ installation \(owner S4; VRF-7 ruled S\+I\)$/);
    expect(v.totals?.install_rate).toBeGreaterThan(0);
  });
  it("00102 r22 shape: 'Supply & providing of MS stand' (model: Supply only) under heading row 8 '... installing, testing ...' -> S+I", () => {
    const t = "Supply & providing of MS stand for VRV ODU along with proper supports";
    const h8 = "Design, Supply, delivery, hoisting, installing, testing and commissioning including the freight up to site";
    const v = one({ items: [{ item: "MS frame / stand for ODU", scope: "Supply only" }], unit: "Kgs", text: t, chainRows: ch([22, "this row", t], [11, "heading row 11", "VARIABLE REFRIGERANT FLOW SYSTEM"], [8, "heading row 8", h8]) });
    expect(v.scope?.value).toBe("Supply + installation");
    expect(v.scope?.note ?? "").toMatch(/\(heading row 8\) says installation/);
    expect(v.totals).toEqual({ supply_rate: 140, install_rate: 40, combined_rate: 180 });
  });
  it("NEGATIVE: the row itself says 'supply only' -> supply only stays; v64 -> supply only; an installation row of this kind on the sheet -> Q5 supply only", () => {
    expect(r51(vrf9(), "38 HP - Out door unit (14HP+24HP) - supply only").scope?.value).toBe("Supply only");
    expect(r51(v64()).scope?.value).toBe("Supply only");
    const s = sheet({ 51: { items: [ODU({ capacity: "38 HP (14HP+24HP)", scope: "Supply only" })], text: "38 HP - Out door unit (14HP+24HP)", chainRows: chain51 },
      60: { items: [ODU({ capacity: "38 HP", scope: "Installation only" })], text: "Installation of 38 HP outdoor unit" } });
    expect(s(51).scope?.value).toBe("Supply only");
  });
});

describe("VRF-9 S5 -- exact quotes in the panel's own notes, with the right row", () => {
  const h356 = "Supply of HI WALL Acs-The Indoor unit to be with cleanable filters.";
  const n357 = "The Details of HI WALL AC s.Quoted rate also include Supports for suspending AC units as per Seismic Condition of Building. Scope includes providing plug top with 3 Rmt of multi core cable till AC unit- Scope also includes thermostatic cordless Ac remotes.";
  const n312 = "The configuration of System is as given below.The indoor units shall be ceiling mounted ducted type/ Cassette /Hiwall Split Type. Each unit to be with LCD wired remote controller with weekly timer and many more functions as specified";
  const r358 = (cfg = vrf9()) => one({ items: [{ item: "Hi-Wall", remote_type: "Cordless", capacity: "2.0 TR", includes_remote: "Yes", includes_remote_where: "Note", includes_remote_words: "Scope also includes thermostatic cordless Ac remotes" }],
    text: "2.0 TR -671 cfm", headings: ["DX VRF INDOOR UNITS", h356], headingNotes: [n357], ancestorNotes: [n357, n312], chainRows: ch([358, "this row", "2.0 TR -671 cfm"], [356, "heading row 356", h356], [357, "note row 357", n357], [311, "heading row 311", "DX VRF INDOOR UNITS"], [312, "note row 312", n312]) }, cfg);
  it("00197 r358: the two-remote note names note row 357 for the cordless words and note row 312 for the wired ones, no '...'", () => {
    const pts = review(r358());
    const line = pts.split("\n").find((p) => /^Remote: the BoQ says .* and also /.test(p)) ?? "";
    expect(line).toMatch(/\(note row 357\) and also ".*wired remote controller.*" \(note row 312\)/);
    expect(line).not.toMatch(/\.\.\./);
  });
  it("NEGATIVE: v64 keeps the '...' and names only note row 312", () => {
    const line = review(r358(v64())).split("\n").find((p) => /^Remote: the BoQ says .* and also /.test(p)) ?? "";
    expect(line).toMatch(/\.\.\./);
    expect(line).not.toMatch(/note row 357\) and also/);
  });
  const SP = "The unit mouted starter panel shall be complete with IP-55 protection consisting of power disconnecting switches with fuses, soft starters, for compressor motors, under/over voltage trip, single phase preventers";
  it("00003 r301: the D1 starter-panel note quotes an exact stretch and names its row; v64 cuts it with '...'", () => {
    const mk = (cfg = vrf9()) => review(one({ items: [ODU({ capacity: "6HP", includes_mccb: "Yes", includes_mccb_where: "Note", includes_mccb_words: "power disconnecting switches with fuses" })],
      text: "6HP VRF / VRV ODU", headings: ["VRF /VRV OUTDOOR UNIT"], headingNotes: [SP], chainRows: ch([301, "this row", "6HP VRF / VRV ODU"], [297, "heading row 297", "VRF /VRV OUTDOOR UNIT"], [300, "note row 300", SP]) }, cfg));
    const d1 = (s: string) => s.split("\n").find((p) => /^MCB \+ ELCB: the BoQ says/.test(p)) ?? "";
    expect(d1(mk())).toMatch(/^MCB \+ ELCB: the BoQ says "unit mouted starter panel shall be complete with IP-55 protection consisting of power disconnecting switches with fuses" \(note row 300\) - /);
    expect(d1(mk(v64()))).toMatch(/\.\.\."/);
  });
  it("a long model quote (frame) is shown as an exact stretch, never with '...'; v64 adds '...'", () => {
    const w = "MS Channel frame for outdoor units complete with epoxy black painted,vibration isolation pads and necessary MS supports to be included in the costing of the outdoor unit as per the drawings and as directed";
    const mk = (cfg = vrf9()) => review(one({ items: [ODU({ includes_frame: "Yes", includes_frame_where: "Note", includes_frame_words: w })], chainRows: ch([9, "this row", "10 HP ODU"], [8, "note row 8", w]) }, cfg));
    const fr = (s: string) => s.split("\n").find((p) => /^MS frame \/ stand: the BoQ says/.test(p)) ?? "";
    expect(fr(mk())).not.toMatch(/\.\.\./);
    expect(fr(mk())).toMatch(/\(note row 8\)/);
    expect(fr(mk(v64()))).toMatch(/\.\.\."/);
  });
});

describe("VRF-9 S6 -- the make fallback keeps every extra (00175 GF r28)", () => {
  const H22 = "Ceiling suspended indoor units complete with refrigerant charging, oil charging, control wiring and drain connection, etc. The rate shall be inclusive of drain pump of suitable capacity.";
  const r28 = (pump: string) => one({ items: [{ item: "Ductable", brand_as_written: "TOSHIBA / DAIKIN / PANASONIC; MITSUBISHI ELECTRIC / TOSHIBA / DAIKIN / PANASONIC / HITACHI", remote_type: "Wired", capacity: "1.59 TR",
    includes_drain_pump: pump, includes_drain_pump_where: "Heading", includes_drain_pump_words: "The rate shall be inclusive of drain pump of suitable capacity." }], text: "1.59 TR/441 CFM", headings: [H22] });
  it("Daikin's smallest is too big -> Blue Star, the drain pump line stays (3,500 / 750) and the note lists the asked makes", () => {
    const v = r28("Yes");
    expect(unitField(v, "brand")).toBe("Blue Star");
    expect(byId(v, "acc_drain_pump")?.figures).toEqual({ supply_rate: 3500, install_rate: 750, combined_rate: 4250 });
    expect(review(v)).toMatch(/several makes stated \(TOSHIBA \/ DAIKIN \/ PANASONIC; MITSUBISHI ELECTRIC \/ TOSHIBA \/ DAIKIN \/ PANASONIC \/ HITACHI\)/);
  });
  it("NEGATIVE: the model's No on the drain pump -> no pump line (the fallback adds nothing of its own)", () => {
    expect(byId(r28("No"), "acc_drain_pump")).toBeUndefined();
  });
});

describe("VRF-9 S7 -- the feeder note on every module; a TFA with no capacity read", () => {
  const n13 = "Note: Single feeder shall be provided for all VRF ODU within 5 mtr distance from ODU";
  const r14 = (cfg = vrf9()) => one({ items: [ODU({ cooling: "Heat Pump", capacity: "38HP (20+18)", includes_power: "Yes", includes_power_where: "Heading" })], text: "System-1 38HP (20+18)",
    chainRows: ch([14, "this row", "System-1 38HP (20+18)"], [9, "heading row 9", "VRF SYSTEM"], [13, "note row 13", n13]) }, cfg);
  it("00350 r14: 20 + 18 HP, the '5 m' note on BOTH modules", () => {
    const v = r14();
    expect(v.items.length).toBe(2);
    for (const b of [0, 1]) expect(review(v, b)).toMatch(/5 m used as the power cable length \(owner D4\)/);
  });
  it("NEGATIVE: v64 says it on the first module only", () => {
    const v = r14(v64());
    expect(review(v, 0)).toMatch(/owner D4/);
    expect(review(v, 1)).not.toMatch(/owner D4/);
  });
  const T32 = "Supply, installation, testing and commissioning of 741 CFM (6 HP) Treated Fresh Air (TFA) Unit complete with suitable Outdoor unit double-skin insulated casing";
  it("00191 r32: the TFA item came back with no capacity -> the row's '741 CFM (6 HP)' is used; TFA + 6 HP outdoor unit price", () => {
    const v = one({ items: [{ item: "Single Skin Treated Fresh Air", capacity: null }, { item: "Outdoor Unit", capacity: "6 HP" }], text: T32 });
    expect(v.rowPriced).toBe(true);
    expect(v.items.map((b) => b.state)).toEqual(["priced", "priced"]);
    expect(review(v)).toMatch(/Fresh-air unit: no capacity was read - the row states "741 CFM \(6 HP\)"/);
  });
  it("NEGATIVE: v64 leaves the TFA unpriced (no capacity stated)", () => {
    const v = one({ items: [{ item: "Single Skin Treated Fresh Air", capacity: null }, { item: "Outdoor Unit", capacity: "6 HP" }], text: T32 }, v64());
    expect(v.rowPriced).toBe(false);
  });
});

describe("VRF-9 S8 -- a Set the BoQ defines (liquid + gas = one Set) is 1 refnet per Set", () => {
  const T39 = "Refrigerant joints to connect copper piping of the indoor unit onto the main circuit line. (Liquid and Gas considered as a one Set)";
  const r39 = (contents: string | null, cfg = vrf9()) => one({ items: [{ item: "Refnet/Y-Joint", set_contents_as_written: contents, set_covers: "Indoor side only", set_idu: "8" }], unit: "Set", qty: 2, text: T39 }, cfg);
  it("00093 Opt1 r39: 1 piece per Set, the note names the quantity and the joints expected", () => {
    const v = r39("Liquid and Gas considered as a one Set");
    expect(v.items[0].qty).toBe("1");
    expect(v.items[0].setCount?.sentence).toBe("BoQ says liquid + gas = one Set - priced as 1 refnet per Set; BoQ quantity (2) is below the 7 joints expected - check the quantity.");
    expect(v.totals).toEqual({ supply_rate: 4200, install_rate: 800, combined_rate: 5000 });
  });
  it("NEGATIVE: v64 rounds up to 4 pieces per Set; a Set whose contents say nothing of liquid + gas keeps the count rule", () => {
    expect(r39("Liquid and Gas considered as a one Set", v64()).items[0].qty).toBe("4");
    expect(r39(null).items[0].qty).toBe("4");
  });
});

describe("VRF-9 S9 -- gas charging / topping up is always supply + installation", () => {
  const T41 = "Installation, testing, commissioning of Refrigerant gas - R-410 A for Imported Equipment including topping up of Refrigerant R-410A";
  it("00307 r41: the model read 'Installation only' -> supply + installation (1,020 + 350 per kg) with the note", () => {
    const v = one({ items: [{ item: "Refrigerant Gas Filling (R-410)", scope: "Installation only" }], unit: "kg", text: T41 });
    expect(v.scope?.value).toBe("Supply + installation");
    expect(v.scope?.note ?? "").toMatch(/refrigerant gas charging \/ topping up is always supply \+ installation \(the row read "Installation only"\)/);
    expect(v.totals).toEqual({ supply_rate: 1020, install_rate: 350, combined_rate: 1370 });
  });
  it("00393 r42: no item read ('none of these') on a kg row topping up refrigerant -> the gas item, supply + installation", () => {
    const t = "Installation, testing, commissioning of Imported Equipment including topping up of Refrigerant R-410A";
    const v = one({ items: [{ item: "none of these", includes_gas: "Yes", scope: "Installation only" }], unit: "kg", text: t });
    expect(v.items[0].family).toBe("Refrigerant Gas Filling (R-410)");
    expect(v.totals).toEqual({ supply_rate: 1020, install_rate: 350, combined_rate: 1370 });
  });
  it("NEGATIVE: v64 keeps installation only (350 x 1.5 = 525); another item's installation-only row is untouched", () => {
    expect(one({ items: [{ item: "Refrigerant Gas Filling (R-410)", scope: "Installation only" }], unit: "kg", text: T41 }, v64()).totals).toEqual({ supply_rate: 0, install_rate: 525, combined_rate: 525 });
    expect(one({ items: [ODU({ scope: "Installation only" })], text: "Installation of 10 HP ODU" }).scope?.value).toBe("Installation only");
  });
});

describe("VRF-9 S10 -- an ODU frame row with no item read gets the frame item", () => {
  const T58 = "Supply and installation of MS base frames coated with anti corrosive paint and finished with 2 coats of enamel paint as per site requirements for outdoor units";
  it("00134 r58 (Nos): the frame item, 5,600", () => {
    const v = one({ items: [{ scope: "Supply + installation" }], text: T58 });
    expect(v.items[0].family).toBe("MS frame / stand for ODU");
    expect(v.totals).toEqual({ supply_rate: 5600, install_rate: 0, combined_rate: 5600 });
    expect(review(v)).toMatch(/no item was read; priced as the MS frame \/ stand \(owner S10\)/);
  });
  it("00218 r274 (Kgs): the per-Kg frame item, 140 + 40 per Kg (QR-1 (a))", () => {
    const t = "Supply & Installation of MS structural work with railling arrangement for outdoor unit positioning and necessary MS Sheet/C channel with mesh for out door unit";
    const v = one({ items: [{ scope: "Supply + installation" }], unit: "Kgs", text: t });
    expect(v.items[0].family).toBe("MS Angle Base Frame Structure");
    expect(v.totals).toEqual({ supply_rate: 140, install_rate: 40, combined_rate: 180 });
  });
  it("NEGATIVE (QR-3 5a): a frame row with NO unit (00029 r402) gets no item -- it stays refused for its unit", () => {
    const t = "Supply, Fabrication and Installation of MS frame using channels/angle iron sections as required for mounting of air cooled remote condensers";
    const v = one({ items: [{ scope: "Supply + installation" }], unit: "", text: t });
    expect(v.rowPriced).toBe(false);
    expect(v.items[0].family ?? null).toBeNull();
  });
  it("NEGATIVE: a civil pedestal row stays unread; v64 leaves the frame row unread", () => {
    expect(one({ items: [{ scope: "Supply + installation" }], text: "Construction of civil pedestal for outdoor units" }).reason).toMatch(/could be told/);
    expect(one({ items: [{ scope: "Supply + installation" }], text: T58 }, v64()).reason).toMatch(/could be told/);
  });
});

describe("VRF-9 R1 -- 'factory charged with first charge of refrigerant' = gas included", () => {
  const N14 = "Outdoor unit shall be factory assembled in weather proof casing. The unit shall be factory charged with first charge of refrigerant and oil";
  const r15 = (cfg = vrf9(), more: Record<number, Row> = {}, gas: string | null = "None") => sheet({ 15: { items: [ODU({ capacity: "12 HP", includes_gas: gas })], text: "12 HP ODU", chainRows: ch([15, "this row", "12 HP ODU"], [13, "heading row 13", "OUTDOOR UNIT"], [14, "note row 14", N14]) }, ...more }, cfg)(15);
  it("00134 r15 shape: the model answered 'None' (or 'No') -> the gas line, kg = HP (12)", () => {
    const g = byId(r15(), "acc_gas");
    expect(g?.state).toBe("priced");
    expect(g?.fields.find((f) => f.id === "qty")?.value).toBe("12");
    expect(byId(r15(vrf9(), {}, "No"), "acc_gas")?.state).toBe("priced");
  });
  it("NEGATIVE: the sheet has its own gas row (00134 row 83) -> not added, the own row named; v64 adds nothing", () => {
    const v = r15(vrf9(), { 83: { items: [{ item: "Refrigerant Gas Filling (R-410)" }], unit: "kgs", text: "Supply & filling of R-410A refrigerant as per the ASHRAE standard 34" } });
    expect(byId(v, "acc_gas")).toBeUndefined();
    expect(review(v)).toMatch(/Gas charge: .*own row \(row 83\)/);
    expect(byId(r15(v64()), "acc_gas")).toBeUndefined();
  });
});

describe("VRF-9 R2 -- BMS-interface cables are not the VRF communication cable", () => {
  const W = "Suitable provison for BMS interface bacnet / Modbus for thrid party system integration, communication cables, etc.";
  const r202 = (words: string, cfg = vrf9()) => one({ items: [ODU({ capacity: "8 HP", includes_comm: "Yes", includes_comm_where: "Note", includes_comm_words: words })], text: "8 HP", chainRows: ch([202, "this row", "8 HP"], [200, "note row 200", words]) }, cfg);
  it("00218 3F r202: no comm line, the note says why", () => {
    const v = r202(W);
    expect(byId(v, "comm")).toBeUndefined();
    expect(review(v)).toMatch(/Communication cable: NOT added - the BoQ says ".*BMS interface.*" \(note row 200\): cables for the BMS interface are not the VRF communication cable \(owner R2\)/);
  });
  it("NEGATIVE: control cabling between indoor and outdoor units -> the comm line; v64 adds the BMS-read line", () => {
    expect(byId(r202("control cabling between indoor & outdoor units and to the BMS panel"), "comm")?.state).toBe("priced");
    expect(byId(r202(W, v64()), "comm")?.state).toBe("priced");
  });
});

describe("VRF-9 R3 -- a civil pedestal / foundation is not the MS frame", () => {
  const r198 = (words: string | null, cfg = vrf9()) => one({ items: [ODU({ capacity: "8HP", ...(words ? { includes_frame: "Yes", includes_frame_where: "Note", includes_frame_words: words } : {}) })], text: "8HP VRF ODU",
    chainRows: ch([198, "this row", "8HP VRF ODU"], [197, "note row 197", words ?? "Including Civil pedestal supports for outdoor units with rubber pads"]) }, cfg);
  it("00336 r198: 'Civil pedestal supports' -> no frame, the note says why; 'suitable foundation' the same", () => {
    const v = r198("Including Civil pedestal supports for outdoor units with rubber pads");
    expect(byId(v, "acc_frame")).toBeUndefined();
    expect(review(v)).toMatch(/MS frame \/ stand: NOT added - the BoQ says "Including Civil pedestal supports for outdoor units with rubber pads" \(note row 197\): civil pedestal \/ foundation work, not the MS frame \(owner R3\)/);
    expect(byId(r198("vibration Isolators with suitable foundation etc. complete as required"), "acc_frame")).toBeUndefined();
  });
  it("NEGATIVE: an MS base frame -> the frame line; v64 adds the civil one; the D2 'supports' safety net no longer reads a civil clause", () => {
    expect(byId(r198("MS base frame duly painted & vibration isolation arrangement"), "acc_frame")?.state).toBe("priced");
    expect(byId(r198("Including Civil pedestal supports for outdoor units with rubber pads", v64()), "acc_frame")?.state).toBe("priced");
    expect(byId(r198(null), "acc_frame")).toBeUndefined();
    expect(byId(r198(null, v64()), "acc_frame")?.state).toBe("priced");
    // the D2 exclusion on its own (the R3 guard left out): a civil clause is never read as 'supports' = the MS stand
    expect(byId(r198(null, vrf9(["prepare"])), "acc_frame")).toBeUndefined();
  });
});

describe("VRF-9 R4 -- a Fan Coil Unit with no type told refuses with its own reason", () => {
  const r217 = (cfg = vrf9(), head = "Fan Coil Units") => one({ items: [{ capacity: "1.0 TR", scope: "Supply + installation" }], text: "1.0 TR",
    chainRows: ch([217, "this row", "1.0 TR"], [216, "heading row 216", head], [202, "heading row 202", "SITC of BMS Compatible VRF Indoor air conditioning units"]) }, cfg);
  it("00380 3F r217: 'Fan Coil Unit - pick the indoor type' on the row and the unit", () => {
    const v = r217();
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe("Fan Coil Unit - pick the indoor type");
    expect(v.items[0].reason).toBe("Fan Coil Unit - pick the indoor type");
  });
  it("NEGATIVE: no Fan Coil heading -> the generic reason; v64 -> the generic reason; a told type prices", () => {
    expect(r217(vrf9(), "Indoor Units").reason).toMatch(/no item could be told/);
    expect(r217(v64()).reason).toMatch(/no item could be told/);
    const v = one({ items: [{ item: "Cassette", capacity: "1.0 TR" }], text: "1.0 TR", chainRows: ch([217, "this row", "1.0 TR"], [216, "heading row 216", "Fan Coil Units"]) });
    expect(v.rowPriced).toBe(true);
  });
});

describe("VRF-9 post-run fixes (the paid run's answers)", () => {
  const T32 = "Supply, installation, testing and commissioning of 741 CFM (6 HP) Treated Fresh Air (TFA) Unit complete with suitable Outdoor unit double-skin insulated casing";
  it("00191 r32: the TFA came back as an airflow only ('741 CFM') -> the row's '741 CFM (6 HP)' is used and the row prices", () => {
    const v = one({ items: [{ item: "Single Skin Treated Fresh Air", capacity: "741 CFM" }, { item: "Outdoor Unit", capacity: "6 HP" }], text: T32 });
    expect(v.rowPriced).toBe(true);
    expect(review(v)).toMatch(/the row states "741 CFM \(6 HP\)"/);
  });
  it("00393 r42: a 'none of these' item beside the gas item is not made a second gas item", () => {
    const t = "Installation, testing, commissioning of Imported Equipment including topping up of Refrigerant R-410A";
    const v = one({ items: [{ item: "none of these", includes_gas: "Yes", scope: "Installation only" }, { item: "Refrigerant Gas Filling (R-410)", scope: "Installation only" }], unit: "kg", text: t });
    expect(v.items.filter((b) => b.family === "Refrigerant Gas Filling (R-410)")).toHaveLength(1);
    expect(v.totals?.combined_rate).toBe(1370);
  });
  it("R4: a Fan Coil unit the model called 'none of these' shows no type, refused with the Fan Coil reason", () => {
    const v = one({ items: [{ item: "none of these", capacity: "1.0 TR" }], text: "1.0 TR", chainRows: ch([221, "this row", "1.0 TR"], [211, "heading row 211", "Fan Coil Units"]) });
    expect(v.reason).toBe("Fan Coil Unit - pick the indoor type");
    expect(v.items[0].family ?? null).toBeNull();
  });
});
