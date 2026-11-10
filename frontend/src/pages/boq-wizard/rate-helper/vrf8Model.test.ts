/**
 * VRF-8 K1 (owner rulings 2026-11-10 13:56-15:05, from the VRF-7 review) -- THE PRICER, through the panel's entry point
 * (`makePricingSheetHelper(...).compute`), positive AND negative per mechanism:
 *   W1  a unit-mounted starter panel with fused switches adds the MCB + ELCB set (+ the D1 note) where the model left it blank
 *   W2 / W3  a written module setup the make does not stock -> the split rule on the TOTAL, the note says it was not followed
 *   W5  "quantified separately" is said even where the model read no cable
 *   W7 / D14-4  a type decided by plain words keeps its price; a both-types phrase elsewhere -> a note quoting both
 *   K1c the wired / cordless note reads only this unit's own words (never a sibling unit type's sub-note)
 *   D1  "Supply of" heading + an installation note -> supply + installation + a scope note
 *   D2  "supports" in an outdoor unit's rate / heading = the MS stand
 *   D4  "feeder ... within N m of the ODU" = the power cable length
 *   D5  "breaker (if required)" wins over the electrical contractor's scope; that scope alone = not added
 *   D6 / D7  plug-top power cable on a unit = its power cable; drain-pump cabling never is (a note says so)
 *   D8  "interconnections with power supply / refrigerant connections" = connection work only
 *   D9  the nearer heading wins on cooling / heating
 *   D10 an installation-only row follows its supply row's make (and so its split)
 *   D11 a capacity stated twice wins
 *   D12 several unit types under one heading refuse
 *   D13 an extra the model left OUT whose words sit in the chain follows the normal rules
 *   D14-1 a TFA "complete with suitable outdoor unit" prices the outdoor unit too; D14-2 a stated make with no close size gives way
 *   D14-7 only verified quotes are shown
 *
 * FIXTURE: HVAC v63 + Electrical v72, hvac_vrf's VRF-8 keys from `pricing/__fixtures__/vrf8Model.json` (the file the v64 mint
 * reads; test_vrf_v64 proves the asset equals it). A config WITHOUT the keys (v63 as it is) keeps VRF-7's behaviour.
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { type ExtractedListItem } from "./itemListPricing";
import { buildExtractionByRow, locateWordsStrict, makePricingSheetHelper, type ExtraLineView, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { rowQuantitiesOf, sheetLinesOf } from "./rateSuggestionModel";
import { applyVrf8, readJsonFixture, type Vrf8Fixture, type Vrf8Group } from "../../pricing/calculatorPanelParity.harness";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h63 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v63.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
// K2: the fixture is applied by the parity harness's `applyVrf8` -- one copy for these tests and the parity blocks
const FX8 = readJsonFixture<Vrf8Fixture>(new URL("../../pricing/__fixtures__/vrf8Model.json", import.meta.url));
type Q8 = { id: string; note?: string; allow_none?: boolean; required?: boolean; [k: string]: unknown };
type Cfg8 = { list_spec: { attribute_definitions: Q8[]; second_opinion?: boolean } };

const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const ITEMS: RateMasterItem[] = [...toItems(h63), ...toItems(e72)];
const VRF = "hvac_vrf";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
const V63 = () => h63.category_configs.find((x) => x.category_id === VRF)!;
const vrf8 = (omit: Vrf8Group[] = []) => applyVrf8(V63(), FX8, omit);
const configsOf = (vrf: RateCategoryConfig) => new Map<string, RateCategoryConfig>([
  ...h63.category_configs.map((c) => [c.category_id, c.category_id === VRF ? vrf : c] as [string, RateCategoryConfig]),
  ...e72.category_configs.map((c) => [c.category_id, c] as [string, RateCategoryConfig]),
]);
type Item = Record<string, string | null>;
const mi = (a: Item): ExtractedListItem => ({ attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: v === null ? 0 : 0.9 }])) as never });
type Row = { items?: Item[]; unit?: string; qty?: number; text?: string; headings?: string[]; ownNotes?: string[]; headingNotes?: string[]; ancestorNotes?: string[];
  chainRows?: Array<{ row: number; where: string; text: string }>; category?: string; node?: string };
const sheet = (rows: Record<number, Row>, cfg = vrf8()) => {
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
const one = (r: Row, cfg = vrf8()) => sheet({ 9: r }, cfg)(9);
const ODU = (more: Item = {}): Item => ({ item: "Outdoor Unit", brand: "Blue Star", capacity: "10 HP", ...more });
const lines = (v: ItemListView, b = 0): ExtraLineView[] => v.items[b]?.extras?.lines ?? [];
const byId = (v: ItemListView, id: string, b = 0) => lines(v, b).find((l) => l.id === id);
const val = (l: ExtraLineView | undefined, id: string) => l?.fields.find((f) => f.id === id)?.value;
const review = (v: ItemListView, b = 0) => (v.items[b]?.extras?.review?.points ?? []).join("\n");
const unitField = (v: ItemListView, id: string, b = 0) => v.items[b]?.fields?.find((f) => f.id === id)?.value;
const ch = (...e: Array<[number, string, string]>) => e.map(([row, where, text]) => ({ row, where, text }));

describe("VRF-8 W2 / W3 -- a written setup the make does not stock: the split rule on the total", () => {
  const D = (cap: string) => ODU({ brand: "Daikin", cooling: "Cool Only", capacity: cap });
  it("00175 GF r17 '60.0 HP (18+18+24)' Daikin Cool Only -> 20 + 20 + 20 (not 20 + 20 + 12 + 12), the note says the setup could not be followed", () => {
    const v = one({ items: [D("60.0 HP (18+18+24)")] });
    expect(v.items.map((b) => unitField(v, "capacity", v.items.indexOf(b)))).toEqual(["20", "20", "20"]);
    expect(v.split?.note ?? "").toMatch(/The BoQ states 18\+18\+24 HP; 18 \/ 24 HP is not stocked for Daikin Cool Only - the stated setup could not be followed, priced by the split rule on the total 60 HP/);
  });
  it("00175 FF r18 '34 HP (16+18)' -> 20 + 16 by the split rule, and the note no longer says the stated split was followed", () => {
    const v = one({ items: [D("34 HP (16+18)")] });
    expect(v.items.map((_b, i) => unitField(v, "capacity", i)).sort()).toEqual(["16", "20"]);
    expect(v.split?.note ?? "").toMatch(/could not be followed/);
    expect(v.split?.note ?? "").not.toMatch(/The row states a split/);
  });
  it("NEGATIVE: a stocked setup '40HP (20+20)' is followed as written ('The row states a split')", () => {
    const v = one({ items: [D("40HP (20+20)")] });
    expect(v.items.map((_b, i) => unitField(v, "capacity", i))).toEqual(["20", "20"]);
    expect(v.split?.note ?? "").toMatch(/The row states a split: 20 \+ 20 HP/);
  });
  it("NEGATIVE: without stated_not_stocked (v63) the 60 HP row keeps VRF-6's per-module split (4 modules)", () => {
    expect(one({ items: [D("60.0 HP (18+18+24)")] }, vrf8(["split"])).items.length).toBe(4);
  });
});

describe("VRF-8 W1 -- the starter panel's fused switches add the MCB + ELCB set", () => {
  const SP = "The unit mouted starter panel shall be complete with IP-55 protection consisting of power disconnecting switches with fuses, soft starters";
  it("00009 r27: includes_mccb left blank + the starter-panel note -> MCB + ELCB lines and the D1 note", () => {
    const v = one({ items: [ODU({ capacity: "6 HP" })], headingNotes: [SP] });
    expect(byId(v, "acc_mcb")?.state).toBe("priced");
    expect(byId(v, "acc_elcb")?.state).toBe("priced");
    expect(review(v)).toMatch(/the unit's own starter panel has switches with fuses; MCB \+ ELCB still added, please check \(owner D1\)/);
  });
  it("NEGATIVE: the model's explicit No stands; without the VRF-8 keys nothing is added", () => {
    expect(byId(one({ items: [ODU({ capacity: "6 HP", includes_mccb: "No" })], headingNotes: [SP] }), "acc_mcb")).toBeUndefined();
    expect(byId(one({ items: [ODU({ capacity: "6 HP" })], headingNotes: [SP] }, vrf8(["implied"])), "acc_mcb")).toBeUndefined();
  });
});

describe("VRF-8 W5 -- 'quantified separately' is always said", () => {
  const QS = "3) All piping, cabling & ODU stands quantified separately.";
  it("00350 r100: a cassette whose model read no cable -> both cable notes quote the note", () => {
    const v = one({ items: [{ item: "Cassette", capacity: "1.6TR", includes_remote: "Yes" }], headingNotes: [QS] });
    expect(review(v)).toMatch(/Power cable: not added - the BoQ note says "cabling & ODU stands quantified separately"/);
    expect(review(v)).toMatch(/Communication cable: not added - the BoQ note says/);
  });
  it("NEGATIVE: no such note -> no such line; without line_silent (v63) the row stays silent", () => {
    expect(review(one({ items: [{ item: "Cassette", capacity: "1.6TR", includes_remote: "Yes" }] }))).not.toMatch(/quantified/);
    expect(review(one({ items: [{ item: "Cassette", capacity: "1.6TR", includes_remote: "Yes" }], headingNotes: [QS] }, vrf8(["safeguard"])))).not.toMatch(/quantified/);
  });
});

describe("VRF-8 K1c / W7 / D14-4 -- the remote note reads only this unit's words", () => {
  const HW = { item: "Hi-Wall", capacity: "1.0TR", remote_type: "Cordless", includes_remote: "Yes", includes_remote_where: "Note" };
  const subNotes = ch([331, "this row", "Hi wall unit type 1 -1.0TR"], [324, "heading row 324", "VRF LOW SIDE WORKS"],
    [326, "note row 326", "Ductable Unit -SITC of Ceiling Suspended Ductable unit with washable filter and corded remote controller, unit shall including shifting"],
    [327, "note row 327", "Cassette Unit- SITC of 4 way Cassette Type VRV Indoor Unit with multi speed fan, cooling coil, remote sensor , cordless remote controller"],
    [328, "note row 328", "Hi wall Unit- SITC of Hi wall Type VRV Indoor Unit with multi speed fan,cooling coil, remote sensor , drain pump and cordless remote controller to be considered"]);
  const subTexts = { headings: ["VRF LOW SIDE WORKS"], headingNotes: subNotes.slice(2).map((c) => c.text), chainRows: subNotes };
  it("00003 r331 (K1c): a Hi-Wall's Cordless, the 'corded' sits in the DUCTABLE sub-note -> no D2 note", () => {
    const v = one({ items: [HW], text: "Hi wall unit type 1 -1.0TR", ...subTexts });
    expect(val(byId(v, "acc_remote"), "remote_type")).toBe("Cordless");
    expect(review(v)).not.toMatch(/owner D2|owner W7/);
  });
  it("NEGATIVE (the VRF-7 behaviour): without the sibling key the same row carries the D2 note", () => {
    expect(review(one({ items: [HW], text: "Hi wall unit type 1 -1.0TR", ...subTexts }, vrf8(["accessories"])))).toMatch(/owner D2/);
  });
  const W7 = ch([51, "this row", "Cassette unit - One Way : 1.28 TR(1.6 HP)"],
    [50, "heading row 50", "Indoor Units (Cassette): Supply, Installation of VRF compatible Cassette indoor units with thermostat, control panel, wall mounted corded remote with LCD display with control wiring, all accessories"],
    [45, "heading row 45", "VRF SYSTEM"],
    [46, "note row 46", "Supply, Installation, testing & commissioning of following VRF system. The system should be complete with outdoor units, indoor units, controls, control panel, cordless/ Corded remote, power and control wiring"],
    [47, "note row 47", "Outdoor Units: Supply, Installation of Top Discharge VRF units complete with controls, control panel, cordless/ corded remote, required refnut"]);
  const CAS = { item: "Cassette", way: "ONE-WAY", capacity: "1.28 TR", remote_type: "Wired", includes_remote: "Yes", includes_remote_where: "Heading" };
  it("00073 r51 (W7): Wired from 'corded remote' (heading row 50) stays; the system note's 'cordless/ Corded remote' -> a note quoting both", () => {
    const v = one({ items: [CAS], text: W7[0].text, headings: ["VRF SYSTEM", W7[1].text], chainRows: W7 });
    expect(val(byId(v, "acc_remote"), "remote_type")).toBe("Wired");
    expect(review(v)).toMatch(/Remote: the BoQ says ".*corded remote.*" and also ".*cordless\/ Corded remote.*" \(note row 46\) - priced as Wired, please check \(owner W7\)/);
    expect(review(v)).not.toMatch(/note row 47/);
  });
  it("NEGATIVE: no both-types phrase in this unit's chain -> no W7 note", () => {
    const v = one({ items: [CAS], text: W7[0].text, chainRows: W7.slice(0, 3) });
    expect(review(v)).not.toMatch(/owner W7|owner D2/);
  });
  it("D14-4 (00363 r29) kept: own note 'corded remote for each unit' vs a general 'Cordless remote control unit' -> Wired + the D2 note", () => {
    const c = ch([29, "this row", "Capacity: 4.55TR - Ceiling mounted Ducted Hi Static AC Units"],
      [28, "note row 28", "Quoted price shall be inclusive of Plug Top & necessary FRLS power cable. the price should be Including supply of corded remote for each unit"],
      [24, "note row 24", "Supply of VRV Indoor Units including necessary Cordless remote control unit, Thermostatic controls"]);
    const v = one({ items: [{ item: "Ductable", capacity: "4.55TR", remote_type: "Wired", includes_remote: "Yes", includes_remote_where: "Note" }], text: c[0].text,
      headingNotes: [c[1].text, c[2].text], chainRows: c });
    expect(val(byId(v, "acc_remote"), "remote_type")).toBe("Wired");
    expect(review(v)).toMatch(/priced as Wired, please check \(owner D2\)/);
  });
});

describe("VRF-8 D1 -- a 'Supply of' heading with an installation note", () => {
  const c = ch([233, "this row", "18HP Top discharge"], [226, "heading row 226", "Supply of VRV ODU System"],
    [231, "note row 231", "Installation, testing and commissioning of VRV Condensor Units. The Quoted rate to include charges towards first charge of oil"]);
  it("00117 r233: supply + installation kept, the scope note quotes both", () => {
    const v = one({ items: [ODU({ capacity: "18 HP", scope: "Supply + installation" })], text: c[0].text, chainRows: c });
    expect(v.scope?.value).toBe("Supply + installation");
    expect(v.scope?.note ?? "").toMatch(/the heading says "Supply of VRV ODU System" and its note says "Installation, testing and commissioning of VRV Condensor Units" \(note row 231\) - priced as supply \+ installation \(owner D1\)/);
    expect((v.totals?.install_rate ?? 0) > 0).toBe(true);
  });
  it("NEGATIVE: a heading that is not 'Supply of' -> no note; a supply-only answer keeps its own path; v63 -> no note", () => {
    const c2 = [c[0], { ...c[1], text: "SITC of VRV ODU System" }, c[2]];
    expect(one({ items: [ODU({ capacity: "18 HP", scope: "Supply + installation" })], text: c[0].text, chainRows: c2 }).scope?.note ?? "").not.toMatch(/owner D1/);
    expect(one({ items: [ODU({ capacity: "18 HP", scope: "Supply only" })], text: c[0].text, chainRows: c }).scope?.note ?? "").not.toMatch(/owner D1/);
    expect(one({ items: [ODU({ capacity: "18 HP", scope: "Supply + installation" })], text: c[0].text, chainRows: c }, vrf8(["scope"])).scope?.note ?? "").not.toMatch(/owner D1/);
  });
});

describe("VRF-8 D2 -- 'supports' on an outdoor unit = the MS stand", () => {
  const H = "SITC of Outdoor units with accumulator and refnet kits.The Rate shall be inclusive of R-410A refrigerant & oil pre charging, vibration isolators, supports, etc.";
  const c = ch([202, "this row", "8 HP"], [197, "heading row 197", H]);
  it("00218 2F r202: frame unanswered -> the MS frame / stand line 5,600 / 0, the note quotes 'supports'", () => {
    const v = one({ items: [ODU({ capacity: "8 HP" })], text: "8 HP", headings: [H], chainRows: c });
    const f = byId(v, "acc_frame");
    expect(f?.figures).toEqual({ supply_rate: 5600, install_rate: 0, combined_rate: 5600 });
    expect(review(v)).toMatch(/"supports" in the outdoor unit's rate \/ heading = the MS stand \(owner D2\)/);
  });
  it("NEGATIVE: indoor / ceiling supports, the model's No, an own frame row, and v63 -> no frame line", () => {
    const ind = ch([202, "this row", "8 HP"], [197, "heading row 197", "VRF LOW SIDE WORKS - Indoor units necessary supports to be included in the costing"]);
    expect(byId(one({ items: [ODU({ capacity: "8 HP" })], text: "8 HP", chainRows: ind }), "acc_frame")).toBeUndefined();
    expect(byId(one({ items: [ODU({ capacity: "8 HP", includes_frame: "No" })], text: "8 HP", chainRows: c }), "acc_frame")).toBeUndefined();
    const s = sheet({ 202: { items: [ODU({ capacity: "8 HP" })], text: "8 HP", chainRows: c }, 280: { text: "MS angle base frame for ODU" } })(202);
    expect(byId(s, "acc_frame")).toBeUndefined();
    expect(review(s)).toMatch(/MS frame \/ stand: .* NOT added: the BoQ quotes it on its own row \(row 280\)/);
    expect(byId(one({ items: [ODU({ capacity: "8 HP" })], text: "8 HP", chainRows: c }, vrf8(["implied"])), "acc_frame")).toBeUndefined();
  });
});

describe("VRF-8 D4 -- a feeder within N m of the ODU sets the power cable length", () => {
  const N = "Note: Single feeder shall be provided for all VRF ODU within 5 mtr distance from ODU. IP 65 rated DB & necessary breakers";
  it("00350 r14: power cable 5 m, the comm cable keeps its 30 m default, noted", () => {
    const v = one({ items: [ODU({ capacity: "10 HP", includes_power: "Yes", includes_comm: "Yes", includes_power_where: "Heading", includes_comm_where: "Heading" })], headingNotes: [N] });
    expect(val(byId(v, "power"), "length")).toBe("5");
    expect(val(byId(v, "comm"), "length")).toBe("30");
    expect(review(v)).toMatch(/Power cable: the BoQ says "Note: Single feeder shall be provided for all VRF ODU within 5 mtr distance from ODU" \(.*\) - 5 m used as the power cable length \(owner D4\)/);
  });
  it("NEGATIVE: no feeder words -> 30 m default; v63 -> 30 m", () => {
    const P = ODU({ capacity: "10 HP", includes_power: "Yes", includes_power_where: "Heading" });
    expect(val(byId(one({ items: [P] }), "power"), "length")).toBe("30");
    expect(val(byId(one({ items: [P], headingNotes: [N] }, vrf8(["prepare"])), "power"), "length")).toBe("30");
  });
});

describe("VRF-8 D5 -- 'breaker (if required)' wins", () => {
  const B = "The cost of the unit shall include all necessary cabling, gland, cable tray and breaker (if required) to distribute power from single source";
  const EC = "Battery Limits for Electrical works: a) 25/32/50/63 Amps, MCCB / MCB isolator & incoming power supply for VRV/VRF ODU unit will be in Electrical contractor scope of work";
  const M = (more: Item = {}) => ODU({ capacity: "24 HP", brand: "Daikin", cooling: "Cool Only", includes_mccb: "No", includes_mccb_words: "MCCB / MCB isolator & incoming power supply ... will be in Electrical contractor scope of work", ...more });
  it("00175 GF r18: both notes -> MCB + ELCB on every module, the note quotes both", () => {
    const v = one({ items: [M()], headingNotes: [B, EC] });
    expect(byId(v, "acc_mcb", 0)?.state).toBe("priced");
    expect(byId(v, "acc_elcb", 1)?.state).toBe("priced");
    expect(review(v)).toMatch(/MCB \+ ELCB: the BoQ says ".*breaker \(if required\).*" \(.*\) and also ".*Electrical contractor scope.*" \(.*\) - added as the safe choice \(owner D5\)/);
  });
  it("NEGATIVE: the electrical-contractor wording alone -> not added, with a note; v63 -> not added, no note", () => {
    const v = one({ items: [M()], headingNotes: [EC] });
    expect(byId(v, "acc_mcb")).toBeUndefined();
    expect(review(v)).toMatch(/MCB \+ ELCB: NOT added - the BoQ says ".*Electrical contractor scope.*" \(.*\): the electrical contractor's scope \(owner D5\)/);
    // the model's Yes read FROM the electrical-contractor wording is set back to No
    const yes = one({ items: [M({ includes_mccb: "Yes", includes_mccb_words: "MCCB / MCB isolator & incoming power supply for VRV/VRF ODU unit will be in Electrical contractor scope" })], headingNotes: [EC] });
    expect(byId(yes, "acc_mcb")).toBeUndefined();
    expect(review(yes)).toMatch(/owner D5/);
    const v63 = one({ items: [M()], headingNotes: [B, EC] }, vrf8(["prepare"]));
    expect(byId(v63, "acc_mcb")).toBeUndefined();
    expect(review(v63)).not.toMatch(/owner D5/);
  });
});

describe("VRF-8 D6 / D7 -- plug-top power cable; drain-pump cabling", () => {
  it("00148 r186: 'inclusive of Plug Top & necessary power cable' on the units' heading -> the power line at 30 m", () => {
    const v = one({ items: [{ item: "Hi-Wall", cooling: "Cool Only", capacity: "2.56TR", includes_drain_pump: "No", includes_power: "None" }],
      headings: ["INDOOR UNITS"], headingNotes: ["Supply, Installation of VRV indoor units. Quoted price shall be inclusive of Plug Top & necessary power cable."] });
    expect(byId(v, "power")?.state).toBe("priced");
    expect(val(byId(v, "power"), "length")).toBe("30");
  });
  it("00020 r117: 'cabling including plug top ... for the drain pump' -> no power line, the note says the cabling is the pump's", () => {
    const v = one({ items: [{ item: "Hi-Wall", capacity: "1.6 TR", includes_remote: "Yes" }], headingNotes: ["The price should including the following :", "Necessary cabling including plug top from nearest power point for the drain pump."] });
    expect(byId(v, "power")).toBeUndefined();
    expect(review(v)).toMatch(/Power cable: not added - the BoQ's cabling "cabling including plug top from nearest power point for the drain pump" \(.*\) is for the drain pump/);
  });
  it("00164 r62 (D7): the only row quoting the cable is the drain-pump row 102 -> no power line, the note says it is the pump's cabling", () => {
    const s = sheet({
      62: { items: [{ item: "Cassette", capacity: "3.2TR", includes_power: "Yes", includes_power_where: "Heading", includes_power_words: "Scope includes providing plug top with 3 Rmt of multi core cable till AC unit" }],
            text: "3.2TR", headings: ["Shifting, Assembly, Installation of Cassette ACs. Scope includes providing plug top with 3 Rmt of multi core cable till AC unit."] },
      102: { text: "SITC of compact drain pump suitable for ducted unit with necessary controls; power cable from the nearest point" },
    })(62);
    expect(byId(s, "power")).toBeUndefined();
    expect(review(s)).toMatch(/Power cable: NOT added - the BoQ's cabling ".*plug top.*" is the drain pump's: the sheet quotes it only on the drain-pump row \(row 102\) \(owner D7\)/);
  });
  it("NEGATIVE: a real cable row -> the VRF-7 own-row note; the model's No on power stands over the plug-top words; v63 -> no drain notes", () => {
    const s = sheet({ 62: { items: [{ item: "Cassette", capacity: "3.2TR", includes_power: "Yes", includes_power_where: "Heading" }], text: "3.2TR" },
      110: { text: "Supply and laying of 3C x 2.5 sqmm power cable" } })(62);
    expect(review(s)).toMatch(/NOT added: the BoQ quotes it on its own row \(row 110\)/);
    expect(review(s)).not.toMatch(/owner D7/);
    const no = one({ items: [{ item: "Hi-Wall", capacity: "2.56TR", includes_power: "No" }], headingNotes: ["Quoted price shall be inclusive of Plug Top & necessary power cable."] });
    expect(byId(no, "power")).toBeUndefined();
    expect(review(one({ items: [{ item: "Hi-Wall", capacity: "1.6 TR", includes_remote: "Yes" }], headingNotes: ["Necessary cabling including plug top from nearest power point for the drain pump."] }, vrf8(["lines"])))).not.toMatch(/owner D6/);
  });
});

describe("VRF-8 D8 -- interconnections are connection work", () => {
  const H = "Supply, Installation of duct type Indoor Units. The scope includes required supports with necessary Panels, cordless remote, bolts, and necessary interconnections with Power supply / earthing / Refrigerant Connections Complete as required";
  it("00158 r49: the power cable the model read from those words is not added, noted", () => {
    const v = one({ items: [{ item: "Ductable", capacity: "3.0 TR", includes_power: "Yes", includes_power_where: "Heading", includes_power_words: "necessary interconnections with Power supply / earthing / Refrigerant Connections" }], headings: [H] });
    expect(byId(v, "power")).toBeUndefined();
    expect(review(v)).toMatch(/Power cable: NOT added - the BoQ says ".*interconnections with Power supply.*" \(.*\) - connection work only \(owner D8\)/);
  });
  it("NEGATIVE: a power cable read from its own words stays; v63 keeps the line", () => {
    const own = { item: "Ductable", capacity: "3.0 TR", includes_power: "Yes", includes_power_where: "Heading", includes_power_words: "power cable from the DB to the unit" };
    expect(byId(one({ items: [own], headings: [H] }), "power")?.state).toBe("priced");
    const m = { ...own, includes_power_words: "necessary interconnections with Power supply / earthing / Refrigerant Connections" };
    expect(byId(one({ items: [m], headings: [H] }, vrf8(["prepare"])), "power")?.state).toBe("priced");
  });
});

describe("VRF-8 D9 -- the nearer heading wins on cooling / heating", () => {
  const near = [268, "note row 268", "The condensing units shall be suitable to work on cooling mode even during peak winter season"] as [number, string, string];
  const far = [266, "note row 266", "Supply of VRV multi unit air-conditioning system with individual controller for cooling & heating application"] as [number, string, string];
  it("00108 r271: the outdoor units' own note says 'cooling mode', the system note 'cooling & heating' -> Cool Only + the note", () => {
    const v = one({ items: [ODU({ capacity: "18 HP" })], chainRows: ch([271, "this row", "18HP"], [267, "heading row 267", "OUTDOOR UNITS"], near, [265, "heading row 265", "VRV SYSTEM"], far) });
    expect(unitField(v, "cooling")).toBe("Cool Only");
    expect(review(v)).toMatch(/The nearer heading says ".*cooling mode.*" \(note row 268\) and another says ".*cooling & heating.*" \(note row 266\) - the nearer heading wins: priced as Cool Only \(owner D9\)/);
  });
  it("the other way round -> Heat Pump", () => {
    const v = one({ items: [ODU({ capacity: "18 HP" })], chainRows: ch([271, "this row", "18HP"], [267, "heading row 267", "OUTDOOR UNITS"], far, [265, "heading row 265", "VRV SYSTEM"], near) });
    expect(unitField(v, "cooling")).toBe("Heat Pump");
    expect(review(v)).toMatch(/priced as Heat Pump \(owner D9\)/);
  });
  it("NEGATIVE: one wording only -> no D9 note; the row's own 'Cooling Type' wins; v63 -> no D9 note", () => {
    expect(review(one({ items: [ODU({ capacity: "18 HP" })], chainRows: ch([271, "this row", "18HP"], [267, "heading row 267", "OUTDOOR UNITS"], near) }))).not.toMatch(/owner D9/);
    const rowSays = one({ items: [ODU({ capacity: "18 HP" })], text: "18HP Cooling Type", chainRows: ch([271, "this row", "18HP Cooling Type"], [267, "heading row 267", "OUTDOOR UNITS"], far, [265, "heading row 265", "X"], near) });
    expect(review(rowSays)).not.toMatch(/owner D9/);
    expect(review(one({ items: [ODU({ capacity: "18 HP" })], chainRows: ch([271, "this row", "18HP"], [267, "heading row 267", "OUTDOOR UNITS"], near, [265, "heading row 265", "VRV"], far) }, vrf8(["prepare"])))).not.toMatch(/owner D9/);
  });
});

describe("VRF-8 D10 -- an installation-only row follows its supply row", () => {
  const rows = {
    6: { items: [{ item: "Outdoor Unit", brand: "Daikin", brand_as_written: "Daikin", discharge: "Side", capacity: "6HP", scope: "Supply only" }], text: "6HP Side Discharge Outdoor unit" },
    7: { items: [{ item: "Outdoor Unit", brand: "Daikin", brand_as_written: "Daikin", discharge: "Side", capacity: "12HP", scope: "Supply only" }], text: "12HP Side Discharge Outdoor unit" },
    22: { items: [{ item: "Outdoor Unit", discharge: "Side", capacity: "6HP", scope: "Installation only" }], text: "6HP Side Discharge Outdoor unit" },
    23: { items: [{ item: "Outdoor Unit", discharge: "Side", capacity: "12HP", scope: "Installation only" }], text: "12HP Side Discharge Outdoor unit" },
    30: { items: [{ item: "Outdoor Unit", discharge: "Side", capacity: "8HP", scope: "Installation only" }], text: "8HP Side Discharge Outdoor unit" },
  } as Record<number, Row>;
  it("00210 r22 / r23: Daikin as on rows 6 / 7 (r23 = 6 + 6), the note names the supply row", () => {
    const s = sheet(rows);
    const r22 = s(22);
    expect(unitField(r22, "brand")).toBe("Daikin");
    expect(review(r22)).toMatch(/Installation only: the supply of this Outdoor Unit 6HP is quoted on row 6 as Daikin - priced as Daikin \(owner D10\)/);
    const r23 = s(23);
    expect(r23.items.map((_b, i) => `${unitField(r23, "brand", i)} ${unitField(r23, "capacity", i)}`)).toEqual(["Daikin 6", "Daikin 6"]);
    expect(review(r23)).toMatch(/quoted on row 7 as Daikin/);
  });
  it("NEGATIVE: no supply row of that size -> the defaults (Blue Star); v63 -> Blue Star", () => {
    expect(unitField(sheet(rows)(30), "brand")).toBe("Blue Star");
    expect(unitField(sheet(rows, vrf8(["prepare"]))(22), "brand")).toBe("Blue Star");
  });
});

describe("VRF-8 D11 -- a capacity stated twice wins", () => {
  const T = "VRV/VRF-CSU high static ductable type indoor-4.0 TR capacity | Supply of CSU high static ductable type indoor unit with corded remorte as per the specification and as per the capacity belo5.5 TR capacity 4.0TR capacity FOR ODC AREA";
  it("00370 r11: the model read 5.5 -> priced at 4 TR, the note names 5.5", () => {
    const v = one({ items: [{ item: "Ductable", remote_type: "Wired", capacity: "5.5TR" }], text: T });
    expect(unitField(v, "capacity")).toBe("4");
    expect(review(v)).toMatch(/The row states 4 TR twice and 5.5 TR once - priced at 4 TR \(owner D11\)/);
  });
  it("NEGATIVE: two capacities once each -> no D11 note; v63 keeps the model's 5.5 TR (next size up 6)", () => {
    expect(review(one({ items: [{ item: "Cassette", capacity: "2.6 TR" }], text: "4-WAY Cassette Type- 2.6 Tr Capacity | capacity below 1.3 TR" }))).not.toMatch(/owner D11/);
    // v63: the model's 5.5 TR goes to the next stocked Ductable size up, never the repeated 4 TR
    expect(unitField(one({ items: [{ item: "Ductable", remote_type: "Wired", capacity: "5.5TR" }], text: T }, vrf8(["prepare"])), "capacity")).toBe("6");
  });
});

describe("VRF-8 D12 -- several unit types under one heading refuse", () => {
  const notes = ["Hi-Wall Split Units", "4 Way Compact Cassette Units", "4 Way Cassette Units", "Ceiling Suspended Ductable Units"];
  const H = "SITC of BMS Compatible VRF Indoor air conditioning units, drain pumps for cassette, ductable & TFA units, suitable plug top, control wiring";
  it("00380 2F r209: the heading's notes list four unit types and the row names none -> refused with the D12 reason", () => {
    const v = one({ items: [{ item: null, capacity: "2.0 TR", includes_gas: "Yes", includes_gas_where: "Heading" }], text: "2.0 TR", headings: [H], headingNotes: notes });
    expect(v.rowPriced).toBe(false);
    expect(v.reason).toBe("several unit types under this heading - fix the headings or pick the type (owner D12)");
    expect(v.items[0].reason).toBe(v.reason);
  });
  it("NEGATIVE: one long note listing types is no sub-heading; a row naming its type prices; v63 prices", () => {
    expect(one({ items: [{ item: "Cassette", capacity: "2.0 TR" }], text: "2.0 TR", headings: [H] }).rowPriced).toBe(true);
    expect(one({ items: [{ item: "Cassette", capacity: "2.0 TR" }], text: "2.0 TR 4 way cassette", headings: [H], headingNotes: notes }).rowPriced).toBe(true);
    expect(one({ items: [{ item: null, capacity: "2.0 TR" }], text: "2.0 TR", headings: [H], headingNotes: notes }, vrf8(["prepare"])).reason ?? "").not.toMatch(/owner D12/);
  });
});

describe("VRF-8 D13 -- an extra the model left OUT follows the BoQ's words", () => {
  const H = "SITC of VRF Indoor units with direct driven fan, drain pumps for cassette, ductable & TFA units, necessary ceiling supports";
  it("00380 2F r214: includes_drain_pump left out, the heading names drain pumps -> the pump is added with the normal note", () => {
    const v = one({ items: [{ item: "Cassette", capacity: "3.0TR", includes_drain_pump: null }], headings: [H] });
    expect(byId(v, "acc_drain_pump")?.state).toBe("priced");
    expect(review(v)).toMatch(/Drain pump: the BoQ says ".*drain pumps for cassette.*" \(a heading\) - added \(the BoQ has no row of its own for it\)/);
  });
  it("with the sheet's own pump row -> NOT added, naming the row (the normal rule)", () => {
    const s = sheet({ 214: { items: [{ item: "Cassette", capacity: "3.0TR", includes_drain_pump: null }], headings: [H] }, 300: { text: "SITC of drain pump for cassette units" } })(214);
    expect(byId(s, "acc_drain_pump")).toBeUndefined();
    expect(review(s)).toMatch(/NOT added: the BoQ quotes it on its own row \(row 300\)/);
  });
  it("NEGATIVE: an explicit 'None' / 'No' is an answer; words saying 'by others' are no inclusion; v63 ignores the gap", () => {
    expect(byId(one({ items: [{ item: "Cassette", capacity: "3.0TR", includes_drain_pump: "None" }], headings: [H] }), "acc_drain_pump")).toBeUndefined();
    expect(byId(one({ items: [{ item: "Cassette", capacity: "3.0TR", includes_drain_pump: null }], headings: ["Drain pumps by others"] }), "acc_drain_pump")).toBeUndefined();
    expect(byId(one({ items: [{ item: "Cassette", capacity: "3.0TR", includes_drain_pump: null }], headings: [H] }, vrf8(["prepare"])), "acc_drain_pump")).toBeUndefined();
  });
});

describe("VRF-8 D14-1 / D14-2 / D14-7", () => {
  const T = "Supply, installation, testing and commissioning of 741 CFM (6 HP) Treated Fresh Air (TFA) Unit complete with suitable Outdoor unit double-skin";
  it("D14-1 00191 r32: the outdoor unit item takes the stated 6 HP -> the row prices both", () => {
    const v = one({ items: [{ item: "Single Skin Treated Fresh Air", capacity: "741 CFM (6 HP)" }, { item: "Outdoor Unit" }], text: T });
    expect(v.rowPriced).toBe(true);
    expect(unitField(v, "capacity", 1)).toBe("6");
    expect(review(v)).toMatch(/the fresh-air unit is priced with an outdoor unit of the stated 6 HP \(owner D14-1\)/);
  });
  it("NEGATIVE D14-1: without the words (or v63) the blank outdoor unit still refuses", () => {
    expect(one({ items: [{ item: "Single Skin Treated Fresh Air", capacity: "741 CFM (6 HP)" }, { item: "Outdoor Unit" }], text: "741 CFM (6 HP) TFA unit" }).rowPriced).toBe(false);
    expect(one({ items: [{ item: "Single Skin Treated Fresh Air", capacity: "741 CFM (6 HP)" }, { item: "Outdoor Unit" }], text: T }, vrf8(["prepare"])).rowPriced).toBe(false);
  });
  it("D14-2 00175 GF r28: '1.59 TR' with Daikin first (smallest Ductable 4 TR) -> the next stated make with a close size, else Blue Star, noted", () => {
    const v = one({ items: [{ item: "Ductable", brand_as_written: "TOSHIBA / DAIKIN / PANASONIC", capacity: "1.59 TR" }] });
    expect(unitField(v, "brand")).not.toBe("Daikin");
    expect(review(v)).toMatch(/several makes stated \(TOSHIBA \/ DAIKIN \/ PANASONIC\): Daikin's smallest is 4 TR, too big for the BoQ's 1.59 TR/);
  });
  it("NEGATIVE D14-2: a 4 TR row keeps Daikin (close enough); v63 keeps Daikin for 1.59 TR", () => {
    expect(unitField(one({ items: [{ item: "Ductable", brand_as_written: "TOSHIBA / DAIKIN / PANASONIC", capacity: "4 TR" }] }), "brand")).toBe("Daikin");
    expect(unitField(one({ items: [{ item: "Ductable", brand_as_written: "TOSHIBA / DAIKIN / PANASONIC", capacity: "1.59 TR" }] }, vrf8(["prepare"])), "brand")).toBe("Daikin");
  });
  it("D14-7: a quote with '...' or one not found whole is not shown; a whole quote is shown with its row", () => {
    const c = ch([16, "this row", "24.0 HP"], [10, "note row 10", "The cost of the unit shall include a necessary MS angle base frame and an MS plate structure, duly black-painted"]);
    const shown = one({ items: [ODU({ capacity: "10 HP", includes_frame: "Yes", includes_frame_where: "Note", includes_frame_words: "The cost of the unit shall include a necessary MS angle base frame" })], chainRows: c });
    expect(review(shown)).toMatch(/MS frame \/ stand: the BoQ says "The cost of the unit shall include a necessary MS angle base frame" \(note row 10\)/);
    const dots = one({ items: [ODU({ capacity: "10 HP", includes_frame: "Yes", includes_frame_where: "Note", includes_frame_words: "The cost of the unit ... MS plate structure" })], chainRows: c });
    expect(review(dots)).not.toMatch(/the BoQ says "The cost of the unit \.\.\./);
    expect(review(dots)).toMatch(/MS frame \/ stand: stated in note/);
    expect(locateWordsStrict("MS angle base frame", c)).toBe("note row 10");
    expect(locateWordsStrict("MS angle ... frame", c)).toBeNull();
    expect(locateWordsStrict("an MS plate structure...", c)).toBeNull();
    expect(locateWordsStrict("an MS plate structure", c)).toBe("note row 10");
    expect(locateWordsStrict("MS angle base frame and the stand", c)).toBeNull();
  });
});

describe("VRF-8 Derivation and questions", () => {
  const v8Titles = ["A written module setup that is not stocked -> the split rule on the total", "Starter-panel breakers, ODU supports and plug-top power cable",
    "'Quantified separately' is always said", "Remote notes read only this unit's own words", "A 'Supply of' heading with an installation note stays supply + installation",
    "A feeder within N m of the ODU sets the power cable length", "'Breaker (if required)' includes the MCB + ELCB", "Drain-pump cabling is never the unit's power cable",
    "'Interconnections with power supply' are connection work", "The nearer heading wins on cooling / heating", "An installation-only row follows its supply row",
    "A capacity stated twice wins", "Several unit types under one heading refuse", "An extra the model left unanswered follows the BoQ's words",
    "A fresh-air unit complete with its outdoor unit", "A stated make with no size close enough gives way", "Only verified BoQ quotes are shown"];
  it("the 17 VRF-8 Derivation lines appear on the v64 keys, after VRF-7's, and none on v63", () => {
    const t8 = itemListRuleOrder(vrf8()).map((l) => l.title);
    const t7 = itemListRuleOrder(V63()).map((l) => l.title);
    for (const t of v8Titles) { expect(t8).toContain(t); expect(t7).not.toContain(t); }
    expect(t8.length).toBe(t7.length + 17);
  });
  it("every extra question is REQUIRED (never left out; 'None' only when nothing describes it), its note says so; second opinion stays off", () => {
    const c = vrf8() as unknown as Cfg8;
    const defs = c.list_spec.attribute_definitions;
    for (const id of FX8.question_required) {
      const q = defs.find((d) => d.id === id)!;
      expect(q.required).toBe(true);
      expect(q.allow_none).toBe(true);
      expect(q.note).toMatch(/REQUIRED on every item - never leave it out/);
      expect(defs.find((d) => d.id === `${id}_words`)!.note).toMatch(/ONE exact clause/);
    }
    expect(c.list_spec.second_opinion).toBe(false);
    expect(defs.length).toBe((V63() as unknown as Cfg8).list_spec.attribute_definitions.length);
  });
});
