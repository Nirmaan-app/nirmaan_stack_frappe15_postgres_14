/**
 * VRF-10 K1 (the VRF-9 review, owner rulings 2026-11-11 08:41-09:10, ANSWER 1 09:25) -- THE PRICER, through the panel's entry point
 * (`makePricingSheetHelper(...).compute`), positive AND negative per mechanism:
 *   F1  a VRF row with a BLANK unit refuses "no unit on this row" -- never priced by assuming a unit (00029 r402 + every blank unit)
 *   F2  installation said at any level beats a nearer supply-type wording that is not "Supply of" -> the note quotes BOTH (00363 r51)
 *   F3  a row priced on the MS frame / stand item is supply + installation unless the sheet quotes its supply and installation on
 *       separate rows (00009 r80: 140 + 40 per Kg)
 *   F4  a refused unit carries only the refusal (no SKU line, working, fields, review); no priced extra line under a blank item
 *   F5  (a) the ON / OFF note only for a single-function controller; (b) a gas row refused for its unit (Lot) defaults to supply +
 *       installation (S9); (c) the 'BoQ says "None"' sentence never on a family-less / refused "None" block
 *   F6  a stored "Supply only" resting on supply-type wording only -> supply + installation, noted; kept where the sheet quotes
 *       installation on its own row or the BoQ says supply only plainly
 *
 * FIXTURE: HVAC v65 (live; the VRF-10 rules switch on from its `scope.panel_pick`) + Electrical v72. NEGATIVE: v64 (no
 * `panel_pick`) keeps VRF-9's behaviour on every case.
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { type ExtractedListItem, vrf10On, itemListPricingSpec } from "./itemListPricing";
import { buildExtractionByRow, makePricingSheetHelper, onOffAmongOthers, VRF10_ONOFF, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { rowQuantitiesOf, sheetLinesOf } from "./rateSuggestionModel";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { showFamilyRawLine } from "./RateHelperPanel";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h65 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v65.json`, import.meta.url));
const h64 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v64.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));

const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS: RateMasterItem[] = [...toItems(h65), ...toItems(e72)];
const VRF = "hvac_vrf";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const V65 = () => h65.category_configs.find((x) => x.category_id === VRF)!;
const V64 = () => h64.category_configs.find((x) => x.category_id === VRF)!;
const configsOf = (vrf: RateCategoryConfig, base: Asset) => new Map<string, RateCategoryConfig>([
  ...base.category_configs.map((c) => [c.category_id, c.category_id === VRF ? vrf : c] as [string, RateCategoryConfig]),
  ...e72.category_configs.map((c) => [c.category_id, c] as [string, RateCategoryConfig]),
]);
type Item = Record<string, string | null>;
const mi = (a: Item): ExtractedListItem => ({ attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: v === null ? 0 : 0.9 }])) as never });
type Row = { items?: Item[]; unit?: string; qty?: number; text?: string; headings?: string[]; ownNotes?: string[]; headingNotes?: string[]; ancestorNotes?: string[];
  chainRows?: Array<{ row: number; where: string; text: string }>; category?: string; node?: string };
const sheet = (rows: Record<number, Row>, v65 = true) => {
  const cfg = v65 ? V65() : V64();
  const results = Object.entries(rows).filter(([, r]) => r.items).map(([er, r]) => ({
    excel_row: Number(er), description: r.text ?? "", category_id: r.category ?? VRF, attributes: {}, items: r.items!.map(mi),
  }));
  const helper = makePricingSheetHelper({ configsByCategory: configsOf(cfg, v65 ? h65 : h64), items: ITEMS, extractionByRow: buildExtractionByRow(results as never) });
  const priced = Object.entries(rows).map(([er, r]) => ({ source_row_number: Number(er), qty_total: r.qty ?? 1, node_type: r.node ?? "Line Item", description: r.text ?? "", unit: r.unit ?? "Nos" }));
  const rowQuantities = rowQuantitiesOf(priced as never);
  const sheetLines = sheetLinesOf(priced as never);
  return (er: number, ov: Record<string, string> = {}): ItemListView => {
    const r = rows[er];
    const res = helper.compute({ excelRow: er, description: r.text ?? "", nodeType: "Line Item", category: r.category ?? VRF, discipline: "HVAC", rateKinds: KINDS,
      unit: r.unit ?? "Nos", quantity: r.qty ?? 1, rowQuantities, sheetLines, headings: r.headings ?? [], ownNotes: r.ownNotes ?? [], headingNotes: r.headingNotes ?? [],
      ...(r.ancestorNotes ? { ancestorNotes: r.ancestorNotes } : {}), ...(r.chainRows ? { chainRows: r.chainRows } : {}) } as never, ov) as unknown as ItemListSuggestion;
    return res.itemList!;
  };
};
const one = (r: Row, v65 = true) => sheet({ 9: r }, v65)(9);
const review = (v: ItemListView, b = 0) => (v.items[b]?.extras?.review?.points ?? []).join("\n");
const ch = (...e: Array<[number, string, string]>) => e.map(([row, where, text]) => ({ row, where, text }));
const totals = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];

describe("VRF-10 switch -- the rules ride v65's `scope.panel_pick` (no mint)", () => {
  it("v65 hvac_vrf is on; v64 hvac_vrf and every other v65 category are off", () => {
    expect(vrf10On(itemListPricingSpec(V65()))).toBe(true);
    expect(vrf10On(itemListPricingSpec(V64()))).toBe(false);
    for (const c of h65.category_configs.filter((x) => x.category_id !== VRF)) expect(vrf10On(itemListPricingSpec(c)), c.category_id).toBe(false);
  });
});

describe("VRF-10 F1 -- a VRF row with no unit is never priced by assuming one", () => {
  const FRAME = "Supply, Fabrication and Installation of MS frame using channels/angle iron sections as required for mounting of air cooled condensing units for VRF outdoor units.";
  it("00029 r402: the frame row with a blank unit refuses 'no unit on this row' (item read or not)", () => {
    for (const items of [[{ item: "MS frame / stand for ODU", scope: "Supply + installation" }], [{ item: null, scope: "Supply + installation" }]]) {
      const v = one({ items, unit: "", text: FRAME });
      expect(v.rowPriced).toBe(false);
      expect(v.reason).toBe("no unit on this row");
      expect(v.items.every((b) => b.state !== "priced")).toBe(true);
    }
  });
  it("every blank-unit VRF row, not only frames: an ODU '16 hp', a Hi-Wall '2 TR', a refnet pair", () => {
    for (const [items, text] of [[[{ item: "Outdoor Unit", brand: "Blue Star", capacity: "16 HP" }], "16 hp"], [[{ item: "Hi-Wall", capacity: "2 TR" }], "i. 2 TR nominal capacity"],
      [[{ item: "Refnet/Y-Joint" }], "Y- joints for refrigerant piping (pair)."]] as Array<[Item[], string]>) {
      const v = one({ items, unit: "", text });
      expect([v.rowPriced, v.reason], text).toEqual([false, "no unit on this row"]);
    }
  });
  it("NEGATIVE: a rate-only unit (R/O) and a real unit still price; v64 prices the blank unit per Nos (owner U2, VRF-9)", () => {
    expect(one({ items: [{ item: "Outdoor Unit", brand: "Blue Star", capacity: "16 HP" }], unit: "Nos", text: "16 hp" }).rowPriced).toBe(true);
    expect(one({ items: [{ item: "Outdoor Unit", brand: "Blue Star", capacity: "16 HP" }], unit: "R/O", text: "16 hp" }).rowPriced).toBe(true);
    const v = one({ items: [{ item: "Outdoor Unit", brand: "Blue Star", capacity: "16 HP" }], unit: "", text: "16 hp" }, false);
    expect(v.rowPriced).toBe(true);
    expect(v.unitNote).toBe("No unit on the BoQ row -> priced per Nos, the catalogue's unit for this item");
  });
});

describe("VRF-10 F2 -- a supply-type wording that is not 'Supply of', beaten by installation said higher up: the note quotes both", () => {
  const N50 = "Supply, port clearance, transport of AIR COOLED Variable Refrigerant Flow/Variable Refrigerant Volume Modular type Outdoor units suitable with high efficiency heat transfer Cooling Coil";
  const N20 = "Supply, Installation,testing & commissioning of Variable Refrigerant volume - modular type air-conditioning system complete with indoor units";
  const C51 = ch([51, "this row", "38 HP - Out door unit (14HP+24HP)"], [49, "heading row 49", "OUTDOOR UNITS"], [50, "note row 50", N50], [19, "heading row 19", "VRV HIGHSIDE WORKS"], [20, "note row 20", N20]);
  const row51 = { items: [{ item: "Outdoor Unit", brand: "Blue Star", capacity: "14HP", scope: "Supply + installation" }, { item: "Outdoor Unit", brand: "Blue Star", capacity: "24HP", scope: "Supply + installation" }],
    text: "38 HP - Out door unit (14HP+24HP)", qty: 2, chainRows: C51 };
  it("00363 r51: S+I and the F2 note quoting note row 50's supply wording and note row 20's installation", () => {
    const v = one(row51);
    expect(v.rowPriced).toBe(true);
    expect(v.scope?.value).toBe("Supply + installation");
    expect(v.scope?.note).toBe("BoQ: \"Supply, port clearance, transport of AIR COOLED Variable Refrigerant\" (note row 50) reads as supply, but \"Supply, Installation,testing & commissioning of Variable Refrigerant volume - modular\" (note row 20) says installation - priced as supply + installation (owner F2)");
    expect(totals(v)[1]).toBeGreaterThan(0);
  });
  it("NEGATIVE: no supply-type wording anywhere (00003 r301 shape: 'Supply,installation,testing ...') -> no note (QR-3 1a)", () => {
    const v = one({ items: [{ item: "Outdoor Unit", brand: "Blue Star", capacity: "6HP" }], text: "6HP VRF / VRV ODU",
      chainRows: ch([301, "this row", "6HP VRF / VRV ODU"], [297, "heading row 297", "VRF /VRV OUTDOOR UNIT"], [298, "note row 298", "Supply,installation,testing and commissioning of inverter based variable refrigerant flow (VRF /VRV) air conditioning system"]) });
    expect(v.scope?.note).toBeUndefined();
  });
  it("NEGATIVE: the supply wording ABOVE the installation (installation nearer) is no override -> no F2 note; v64 -> no note", () => {
    const v = one({ ...row51, chainRows: ch([51, "this row", "38 HP - Out door unit"], [49, "heading row 49", "OUTDOOR UNITS"], [50, "note row 50", N20], [19, "heading row 19", "VRV HIGHSIDE WORKS"], [20, "note row 20", N50]) });
    expect(v.scope?.note ?? "").not.toContain("owner F2");
    expect(one(row51, false).scope?.note).toBeUndefined();
  });
});

describe("VRF-10 F3 -- MS stand / frame rows are supply + installation unless the sheet quotes them on separate rows", () => {
  const T80 = "Supply & providing of MS stand for VRV ODU along with proper supports-suitable for above configuration";
  const r80 = { items: [{ item: "MS Angle Base Frame Structure", scope: "Supply only" }], unit: "Kg", text: T80 };
  it("00009 r80: per Kg 140 + 40 with the F3 note; the S11 pick shows supply + installation as the helper's choice", () => {
    const v = one(r80);
    expect(totals(v)).toEqual([140, 40]);
    expect(v.scope?.value).toBe("Supply + installation");
    expect(v.scope?.note).toBe("BoQ: an MS frame / stand row is always supply + installation unless the BoQ quotes its supply and its installation on separate rows (the row read \"Supply only\") - priced as supply + installation (owner F3)");
    expect(v.scope?.picker?.value).toBe("Supply + installation");
  });
  it("the per-Nos frame item (catalogue install 0): S+I in scope and note, the figure stays 5,600 + 0", () => {
    const v = one({ items: [{ item: "MS frame / stand for ODU", scope: "Supply only" }], unit: "Nos", text: "Supply & providing of MS stand for VRV/DX ODU along with proper supports" });
    expect(totals(v)).toEqual([5600, 0]);
    expect(v.scope?.value).toBe("Supply + installation");
  });
  it("separate rows: the sheet quotes the frame's supply (row 10) and its installation (row 20) -> each keeps its scope, the note names the other", () => {
    const at = sheet({
      10: { items: [{ item: "MS Angle Base Frame Structure", scope: "Supply only" }], unit: "Kg", text: "Supply of MS stand for ODU" },
      20: { items: [{ item: "MS Angle Base Frame Structure", scope: "Installation only" }], unit: "Kg", text: "Installation of MS stand for ODU" },
    });
    const s = at(10);
    expect(s.scope?.value).toBe("Supply only");
    expect(totals(s)).toEqual([140, 0]);
    expect(s.scope?.note).toContain("This sheet quotes the MS frame's supply and its installation on separate rows (row 20) - kept as \"Supply only\" (owner F3).");
    const i = at(20);
    expect(i.scope?.value).toMatch(/^Installation only/);
    expect(i.scope?.note).toContain("separate rows (row 10) - kept as \"Installation only\" (owner F3).");
  });
  it("NEGATIVE: v64 keeps VRF-9's supply only (140 + 0); a non-frame item is not F3's", () => {
    const v = one(r80, false);
    expect(totals(v)).toEqual([140, 0]);
    expect(v.scope?.value).toBe("Supply only");
    expect(one({ items: [{ item: "Remote Controller", remote_type: "Wired", scope: "Supply only" }], text: "Supply of wired remote controller", headings: ["REMOTES"] }).scope?.note ?? "").not.toContain("owner F3");
  });
});

describe("VRF-10 F4 -- a refused unit carries only the refusal; no priced extra line under a blank item", () => {
  const D12_NOTES = ["Hi-Wall Split Units", "4 Way Compact Cassette Units", "4 Way Cassette Units", "Ceiling Suspended Ductable Units"];
  const H = "SITC of BMS Compatible VRF Indoor air conditioning units, drain pumps for cassette, ductable & TFA units";
  const d12 = { items: [{ item: null, capacity: "2.0 TR", brand: "Blue Star" }], text: "2.0 TR", headings: [H], headingNotes: D12_NOTES };
  it("00380 2F r209 (several unit types): no SKU line, no working, no fields (no snapped capacity), no review note", () => {
    const v = one(d12);
    expect(v.reason).toBe("several unit types under this heading - fix the headings or pick the type (owner D12)");
    const b = v.items[0];
    expect([b.family, b.skuLine, b.working ?? [], b.fields, b.extras]).toEqual([null, undefined, [], [], undefined]);
  });
  it("NEGATIVE: v64 keeps the inherited block (VRF-9 data: the SKU line / working / fields)", () => {
    const b = one(d12, false).items[0];
    expect(b.fields.length).toBeGreaterThan(0);
  });
  it("00197 r315 shape: a unit refused for its capacity carries no PRICED remote line; v64 keeps it", () => {
    const r = { items: [{ item: "Ductable", brand: "Blue Star", capacity: "40 TR", remote_type: "Cordless", includes_remote: "Yes", includes_remote_where: "Heading",
      includes_remote_wording: "Scope" }], text: "40 TR - Ceiling Suspended", headings: ["Supply of Ceiling Suspended type AC with cordless remote"] };
    const v = one(r);
    expect(v.rowPriced).toBe(false);
    expect(v.items[0].state).not.toBe("priced");
    expect((v.items[0].extras?.lines ?? []).filter((l) => l.state === "priced")).toEqual([]);
    // the line stays, with no figure and the reason (its review note and the item count still name it)
    const rem = (v.items[0].extras?.lines ?? []).find((l) => l.id === "acc_remote");
    // VP-1 (A1, owner 2026-11-13 00:33): the panel leads with "Not priced -", so the reason no longer repeats it.
    // BEFORE: "not priced - the unit it belongs to is not priced"
    expect([rem?.state, rem?.figures, rem?.reason]).toEqual(["blank", {}, "the unit it belongs to is not priced"]);
    const old = one(r, false);
    expect(old.rowPriced).toBe(false);
    expect((old.items[0].extras?.lines ?? []).some((l) => l.state === "priced")).toBe(true);
  });
});

describe("VRF-10 F5 -- three cosmetics", () => {
  const TM = "SITC of Central Remote Controller / i - touch manager for monitoring and Controlling the VRF equipments. The CRC shall consists of LCD display, basic functions like ON / OFF, mode settings, temperature setting, fan speed";
  it("(a) 00380 2F r246: a touch manager listing ON / OFF among its functions gets no 'ON / OFF controller' note (family unchanged)", () => {
    const v = one({ items: [{ item: "Touch Screen Central Controller" }], unit: "Set", text: TM });
    expect(v.items[0].family).toBe("Touch Screen Central Controller");
    expect(review(v)).not.toContain("ON / OFF");
    expect(onOffAmongOthers("\\bon\\s*/\\s*off\\b", TM)).toBe(true);
  });
  it("(a) NEGATIVE: a single-function ON / OFF controller keeps the note (and is priced as the touch screen); v64 notes the touch manager", () => {
    const v = one({ items: [{ item: "Remote Controller" }], text: "Central ON / OFF controller for all indoor units" });
    expect(v.items[0].family).toBe(VRF10_ONOFF.family);
    expect(review(v)).toContain("BoQ says \"ON / OFF\" controller");
    expect(review(one({ items: [{ item: "Touch Screen Central Controller" }], unit: "Set", text: TM }, false))).toContain("ON / OFF");
  });
  const GAS = { items: [{ item: "Refrigerant Gas Filling (R-410)", scope: "Installation only" }], unit: "Lot",
    text: "Pressure testing each circuit with nitrogen Gas, Vaccumising Including all consumables for all floor VRV systems(VRF UNITS) .First Charge of Refrigerant" };
  it("(b) 00149 r259: a gas row refused for its unit (Lot) shows supply + installation (S9), never installation only x 1.5", () => {
    const v = one(GAS);
    expect(v.rowPriced).toBe(false);
    expect(v.scope?.value).toBe("Supply + installation");
    expect(v.scope?.note).toContain("(owner S9)");
    expect(v.scope?.note).not.toContain("1 + ");
    expect(v.scope?.picker?.value).toBe("Supply + installation");
  });
  it("(b) NEGATIVE: v64 shows installation only (VRF-9)", () => {
    expect(one(GAS, false).scope?.value).toBe("Installation only");
  });
  it("(c) the 'BoQ says \"None\"' sentence: hidden with no family, or on a refused block whose raw item is \"None\"; shown otherwise", () => {
    expect(showFamilyRawLine({ familyRaw: "None", familyLine: undefined, family: null, state: "blank" })).toBe(false);
    expect(showFamilyRawLine({ familyRaw: "None", familyLine: undefined, family: "Hi-Wall", state: "blank" })).toBe(false);
    expect(showFamilyRawLine({ familyRaw: "Wall mounted", familyLine: undefined, family: null, state: "blank" })).toBe(false);
    expect(showFamilyRawLine({ familyRaw: "Wall mounted", familyLine: undefined, family: "Hi-Wall", state: "priced" })).toBe(true);
    expect(showFamilyRawLine({ familyRaw: "None", familyLine: undefined, family: "Hi-Wall", state: "priced" })).toBe(true);
    expect(showFamilyRawLine({ familyRaw: "GI", familyLine: "BoQ says GI -> priced as MS", family: "MS", state: "priced" })).toBe(false);
  });
});

describe("VRF-10 F6 -- supply + installation is the default; supply only only on a separate installation row or plain words", () => {
  const HW = "Supply of HI-WALL TYPE indoor unit as per the specification and as per the capacity below";
  const hw = (scope = "Supply only", text = "1.0 TR - Hi-Wall") => ({ items: [{ item: "Hi-Wall", capacity: "1.0 TR", scope }], text, headings: [HW] });
  it("00075 / 00169 shape: 'Supply of ...' heading, stored Supply only -> S+I with the F6 note quoting the heading; the S11 pick follows", () => {
    const v = one(hw());
    expect(v.scope?.value).toBe("Supply + installation");
    expect(totals(v)[1]).toBeGreaterThan(0);
    expect(v.scope?.note).toBe("BoQ says \"Supply of HI-WALL TYPE indoor unit as per the specification and as per the capacity below\" (a heading) - priced as supply + installation: installation is included unless the BoQ says \"supply only\" or quotes installation on its own row. Use the scope pick if this BoQ is supply only. (owner F6)");
    expect(v.scope?.picker?.value).toBe("Supply + installation");
  });
  it("(ii) the row says supply only / excluding installation / installation by the client -> stays supply only", () => {
    for (const t of ["1.0 TR - Hi-Wall (supply only)", "1.0 TR Hi-Wall excluding installation", "1.0 TR Hi-Wall - installation by the client"]) {
      const v = one(hw("Supply only", t));
      expect([v.scope?.value, totals(v)[1]], t).toEqual(["Supply only", 0]);
    }
  });
  it("(i) the sheet quotes installation of this item on its own row -> stays supply only", () => {
    const at = sheet({ 10: hw(), 30: { items: [{ item: "Hi-Wall", capacity: "1.0 TR", scope: "Installation only" }], text: "Installation of 1.0 TR Hi-Wall" } });
    expect(at(10).scope?.value).toBe("Supply only");
  });
  it("(i) sheet-level (QR-1 Q2 (a)): an installation-only row of ANOTHER VRF item on the sheet -> stays supply only, the note names it", () => {
    const at = sheet({ 10: hw(), 30: { items: [{ item: "Outdoor Unit", brand: "Blue Star", capacity: "10 HP", scope: "Installation only" }], text: "Installation of 10 HP ODU" } });
    const v = at(10);
    expect(v.scope?.value).toBe("Supply only");
    expect(v.scope?.note).toContain("This sheet quotes installation on its own rows (row 30) - supply only (owner F6).");
  });
  it("(i) sheet-level, ANY category (ANSWER 2): 00149's cassette installation rows are another category -> stays supply only", () => {
    const at = sheet({ 10: hw(), 196: { text: "Shifting, Assembly, Installation, Testing and Commissioning of Cassette ACs", category: "hvac_dx_unit", node: "Line Item" } });
    const v = at(10);
    expect(v.scope?.value).toBe("Supply only");
    expect(v.scope?.note).toContain("This sheet quotes installation on its own rows (row 196) - supply only (owner F6).");
    // NEGATIVE: a line that names the supply too is no installation-only row -- whether it starts with the supply or with the
    // installation ("Installation and supply of ...")
    for (const t of ["Supply, Installation, Testing and Commissioning of Cassette ACs", "Installation and supply of Cassette ACs with all accessories"]) {
      const at2 = sheet({ 10: hw(), 196: { text: t, category: "hvac_dx_unit" } });
      expect(at2(10).scope?.value, t).toBe("Supply + installation");
    }
  });
  it("NEGATIVE: v64 keeps supply only; a row S4 already converts keeps S4's note (QR-1 Q3 (a))", () => {
    expect(one(hw(), false).scope?.value).toBe("Supply only");
    const s4 = one({ ...hw(), ancestorNotes: ["Incase unit doesn't have, vendor to install externally and price for same to be included as part of unit cost"] });
    expect(s4.scope?.value).toBe("Supply + installation");
    expect(s4.scope?.note).toContain("(owner S4");
  });
});
