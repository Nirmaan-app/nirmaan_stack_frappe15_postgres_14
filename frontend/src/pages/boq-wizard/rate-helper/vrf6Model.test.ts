/**
 * VRF-6 K1 (owner rulings 2026-11-08 / 09; team 10:41-10:45; pre-VRF-6 13:02-13:45) -- THE PRICER, through the panel's entry point
 * (`makePricingSheetHelper(...).compute`) and the calculator's, positive AND negative per mechanism:
 *   F1   the remote's type: the ambiguous spellings -> Cordless first, then the model's answer, then the words, then the default
 *   F3   every extra read as included that the item cannot carry is a review point with the reason (role, no-extras family, needs)
 *   F4   the own-row check reads each row's category first (piping rows = copper; a VRF row by its item; words only uncategorised)
 *   F8   "12HP x 2NOS" is a written split; a written module above the largest is split; the least excess over the stated size wins (QR-1 Q3)
 *   F11  a length inside the cable's words reaches that cable only; "AL" = aluminium; drain-pump cabling is not the power cable
 *   F12  accessories take the unit's make; "make same as outdoor" = the sheet's outdoor make
 *   TEAM frame / stand (its own Nos item, 1 per module), gas kg = HP, MCB + ELCB by the HP schedule (next stocked rating up)
 *   Q1 built-in drain pump; Q5 scope conflict; installation-only vs a supply row; Q6 row cooling; Q7 note wins; Q-pre 4 / 7 / 11 / 13;
 *   the two-capacity refusal; "6 .3TR"
 *
 * FIXTURE: HVAC v61 + Electrical v72, hvac_vrf's VRF-6 keys, the 14 new Pricing Inputs and the new frame item from
 * `pricing/__fixtures__/vrf6Model.json` (the file the v62 mint reads; test_vrf_v62 proves the asset equals it). A config WITHOUT
 * the keys (v61 as it is) is unchanged.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { ownRowQuotes, rankCover, readCableKindWords, readStatedSplit, type ExtractedListItem, type NumberReader } from "./itemListPricing";
import { coveringSets } from "./ladderResolution";
import {
  EXTRAS_INCLUDES_KEY, ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, buildExtractionByRow, makePricingSheetHelper,
  type ExtraLineView, type ItemListSuggestion, type ItemListView,
} from "./pricingSheetHelper";
import { rowAncestorNotes, rowQuantitiesOf, sheetLinesOf } from "./rateSuggestionModel";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const h61 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v61.json`, import.meta.url));
const e72 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_electrical_all_v72.json`, import.meta.url));
type Fx = Record<string, unknown> & {
  accessories: unknown[]; accessory_includes: Record<string, string>; safeguard_add: Record<string, unknown> & { lines: Record<string, string> };
  own_row_add: Record<string, Record<string, unknown>>; own_row_drop: string[]; scope_add: Record<string, unknown>; split_add: Record<string, unknown>;
  lines_add: Record<string, string>; prepare: unknown; two_capacities: unknown; families_add: Record<string, unknown>;
  inputs: Array<{ item: string; name: string; unit: string; factor: number }>; retire_inputs: string[];
  new_items: Array<{ kind: string; unit: string; attributes: Record<string, unknown>; rates: Record<string, number> }>;
};
const FX = readJsonFixture<Fx>(new URL("../../pricing/__fixtures__/vrf6Model.json", import.meta.url));
const toItems = (a: Asset) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
const inputItem = (p: { item: string; name: string; unit: string; factor: number }): RateMasterItem =>
  ({ name: `fx-${p.item}`, discipline: "HVAC", kind: "hvac_pricing_input", brand: null, unit: p.unit, attributes: { item: p.item, name: p.name, shared_by: "vrf" }, rates: { factor: p.factor } } as unknown as RateMasterItem);
const retired = new Set(FX.retire_inputs);
const ITEMS: RateMasterItem[] = [
  ...toItems(h61).filter((it) => !(it.kind === "hvac_pricing_input" && retired.has(String(it.attributes?.item ?? "")))),
  ...toItems(e72),
  ...FX.inputs.map(inputItem),
  ...FX.new_items.map((n, i) => ({ name: `fx-new-${i}`, discipline: "HVAC", brand: null, ...n } as unknown as RateMasterItem)),
];
const VRF = "hvac_vrf";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
type Keys = "accessories" | "safeguard" | "split" | "lines" | "prepare" | "scope" | "two";

/** v61's hvac_vrf + the VRF-6 keys (each group can be left out to prove the config without it is unchanged) */
type Px = { families: Record<string, unknown>; split: Record<string, unknown>; extras: { accessories?: unknown; from_model: Record<string, unknown>; scope: Record<string, unknown>;
  lines: Record<string, string>; prepare?: unknown; two_capacities?: unknown; safeguard: { lines: Record<string, string>; own_row: Record<string, Record<string, unknown>>; [k: string]: unknown } } };
const vrf6 = (omit: Keys[] = [], tweak?: (p: Px) => void): RateCategoryConfig => {
  const c = structuredClone(h61.category_configs.find((x) => x.category_id === VRF)) as unknown as { list_spec: { pricing: Px } };
  const p = c.list_spec.pricing;
  const x = p.extras;
  if (!omit.includes("accessories")) {
    x.accessories = structuredClone(FX.accessories);
    x.from_model.accessory_includes = structuredClone(FX.accessory_includes);
    Object.assign(p.families, structuredClone(FX.families_add));
  }
  if (!omit.includes("safeguard")) {
    for (const [k, v] of Object.entries(FX.safeguard_add)) { if (k === "lines") Object.assign(x.safeguard.lines, v); else x.safeguard[k] = structuredClone(v); }
    for (const k of FX.own_row_drop) delete x.safeguard.own_row[k];
    for (const [k, v] of Object.entries(FX.own_row_add)) x.safeguard.own_row[k] = { words: [], ...(x.safeguard.own_row[k] ?? {}), ...structuredClone(v) };
  }
  if (!omit.includes("scope")) Object.assign(x.scope, structuredClone(FX.scope_add));
  if (!omit.includes("split")) Object.assign(p.split, structuredClone(FX.split_add));
  if (!omit.includes("lines")) Object.assign(x.lines, FX.lines_add);
  if (!omit.includes("prepare")) x.prepare = structuredClone(FX.prepare);
  if (!omit.includes("two")) x.two_capacities = structuredClone(FX.two_capacities);
  tweak?.(p);
  return c as unknown as RateCategoryConfig;
};
const V61 = () => h61.category_configs.find((x) => x.category_id === VRF)!;
const configsOf = (vrf: RateCategoryConfig) => new Map<string, RateCategoryConfig>([
  ...h61.category_configs.map((c) => [c.category_id, c.category_id === VRF ? vrf : c] as [string, RateCategoryConfig]),
  ...e72.category_configs.map((c) => [c.category_id, c] as [string, RateCategoryConfig]),
]);
type Item = Record<string, string>;
const mi = (a: Item): ExtractedListItem => ({ attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) });
/** a BoQ sheet: excel row -> the model's items (a row with items is a run row of `category`, default VRF; without items: no category) */
type Row = { items?: Item[]; unit?: string; qty?: number; text?: string; headings?: string[]; ownNotes?: string[]; headingNotes?: string[]; ancestorNotes?: string[];
  category?: string; node?: string };
const sheet = (rows: Record<number, Row>, cfg = vrf6(), items = ITEMS) => {
  const results = Object.entries(rows).filter(([, r]) => r.items).map(([er, r]) => ({
    excel_row: Number(er), description: r.text ?? "", category_id: r.category ?? VRF, attributes: {}, items: r.items!.map(mi),
  }));
  const helper = makePricingSheetHelper({ configsByCategory: configsOf(cfg), items, extractionByRow: buildExtractionByRow(results as never) });
  const priced = Object.entries(rows).map(([er, r]) => ({ source_row_number: Number(er), qty_total: r.qty ?? 1, node_type: r.node ?? "Line Item", description: r.text ?? "" }));
  const rowQuantities = rowQuantitiesOf(priced as never);
  const sheetLines = sheetLinesOf(priced as never);
  return (er: number, overrides: Record<string, string> = {}): ItemListView => {
    const r = rows[er];
    const res = helper.compute({ excelRow: er, description: r.text ?? "", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: KINDS,
      unit: r.unit ?? "Nos", quantity: r.qty ?? 1, rowQuantities, sheetLines, headings: r.headings ?? [], ownNotes: r.ownNotes ?? [], headingNotes: r.headingNotes ?? [],
      ...(r.ancestorNotes ? { ancestorNotes: r.ancestorNotes } : {}) } as never, overrides) as unknown as ItemListSuggestion;
    return res.itemList!;
  };
};
const one = (r: Row, cfg = vrf6()) => sheet({ 9: r }, cfg)(9);
const calc = (edits: unknown[], more: Record<string, string> = {}, cfg = vrf6()): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: configsOf(cfg), items: ITEMS, extractionByRow: new Map() });
  return (h.compute(calculatorCtx("HVAC", VRF), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: edits }), [ROW_UNIT_OVERRIDE_KEY]: "Nos", ...more }) as unknown as ItemListSuggestion).itemList!;
};
const ODU = (more: Item = {}): Item => ({ item: "Outdoor Unit", brand: "Blue Star", capacity: "10 HP", ...more });
const CAS = (more: Item = {}): Item => ({ item: "Cassette", brand: "Blue Star", capacity: "2 TR", ...more });
const lines = (v: ItemListView, b = 0): ExtraLineView[] => v.items[b]?.extras?.lines ?? [];
const byId = (v: ItemListView, id: string, b = 0) => lines(v, b).find((l) => l.id === id);
const val = (l: ExtraLineView | undefined, id: string) => l?.fields.find((f) => f.id === id)?.value;
const tagOf = (l: ExtraLineView | undefined, id: string) => l?.fields.find((f) => f.id === id)?.tag;
const review = (v: ItemListView, b = 0) => (v.items[b]?.extras?.review?.points ?? []).join("\n");
const allText = (v: ItemListView) => JSON.stringify(v);

describe("VRF-6 pure readers", () => {
  const reader = (vrf6() as unknown as { list_spec: { pricing: { numbers: { capacity: NumberReader } } } }).list_spec.pricing.numbers.capacity;
  it("readStatedSplit (F8): '24HP (12HP x 2NOS)' / '12 HP x 2 Nos' = n equal modules -- only with `times`", () => {
    expect(readStatedSplit("24HP (12HP x 2NOS)", reader, { times: true })).toMatchObject({ modules: [12, 12], total: 24 });
    expect(readStatedSplit("12 HP x 2 Nos", reader, { times: true })).toMatchObject({ modules: [12, 12], total: null });
    expect(readStatedSplit("24HP (12HP x 2NOS)", reader)).toBeNull();
    expect(readStatedSplit("2# 12 HP", reader, { times: true })).toBeNull();
    expect(readStatedSplit("24 HP", reader, { times: true })).toBeNull();
  });
  it("readCableKindWords (F11): 'AL' / 'Alu' = aluminium only with `abbrev`; 'aluminium' always", () => {
    expect(readCableKindWords("power cable (FRLS, XLPE, AL Armoured)", { abbrev: true })).toEqual({ armour: "ARMOURED", conductor: "ALUMINIUM" });
    expect(readCableKindWords("power cable (FRLS, XLPE, AL Armoured)")).toEqual({ armour: "ARMOURED" });
    expect(readCableKindWords("aluminium cable")).toEqual({ conductor: "ALUMINIUM" });
  });
  it("ownRowQuotes (F4) category first: the category's rows count; a same-category row by its item; words only for an uncategorised row", () => {
    const rule = { words: ["\\bcopper\\b[^|]*\\bpip"], categories: ["hvac_piping"], category_not_families: { hvac_piping: ["CPVC"] } };
    const rows = [
      { row: 287, text: "5/8 dia with 13 mm insulation", category: "hvac_piping", family1: "Copper" },
      { row: 298, text: "25mm dia", category: "hvac_piping", family1: "CPVC" },
      { row: 38, text: "Refrigerant joints to connect copper piping", category: "hvac_vrf", family1: "Refnet/Y-Joint" },
      { row: 50, text: "copper piping 12.7 mm", category: null },
    ];
    const cf = { categoryFirst: true, askingCategory: "hvac_vrf" };
    expect(ownRowQuotes(rule, rows, 9, new Set(["Outdoor Unit"]), cf).map((q) => q.row)).toEqual([50, 287]);
    // without category-first (v61): words over every row -> the refnet row counts, the piping rows do not
    expect(ownRowQuotes(rule, rows, 9, new Set(["Outdoor Unit"])).map((q) => q.row)).toEqual([38, 50]);
  });
  it("rowAncestorNotes (Q6): every heading's notes above the row, nearest first", () => {
    const rows = [
      { row_index: 0, source_row_number: 1, effective_parent_index: null, description: "VRF", node_type: "Preamble" },
      { row_index: 1, source_row_number: 2, effective_parent_index: 0, description: "(HEAT PUMP)", effective_classification: "note" },
      { row_index: 2, source_row_number: 3, effective_parent_index: 0, description: "Outdoor units", node_type: "Preamble" },
      { row_index: 3, source_row_number: 4, effective_parent_index: 2, description: "42 HP (Cooling Type)", node_type: "Line Item" },
    ];
    expect(rowAncestorNotes(rows[3] as never, rows as never)).toEqual(["(HEAT PUMP)"]);
  });
});

describe("VRF-6 F1 -- the remote's type", () => {
  const REM = (more: Item = {}) => CAS({ includes_remote: "Yes", includes_remote_where: "Row", ...more });
  it("the model said Wired (00003 r345) -> Wired, even when a heading note elsewhere says cordless", () => {
    const v = one({ items: [REM({ remote_type: "Wired" })], headingNotes: ["Cassette: cordless remote controller"] });
    expect(val(byId(v, "acc_remote"), "remote_type")).toBe("Wired");
    expect(tagOf(byId(v, "acc_remote"), "remote_type")).toBe("boq");
  });
  it("'corded less' / 'cordless/corded' / 'corded or cordless' -> Cordless, over a model's Wired", () => {
    for (const t of ["with corded less remote", "remote cordless/corded", "corded or cordless remote"]) {
      const v = one({ items: [REM({ remote_type: "Wired" })], ownNotes: [t] });
      expect({ t, type: val(byId(v, "acc_remote"), "remote_type") }).toEqual({ t, type: "Cordless" });
    }
  });
  it("'corded' alone in the notes, no model answer -> Wired; nothing anywhere -> Cordless, tagged default", () => {
    expect(val(byId(one({ items: [REM()], ownNotes: ["corded remote controller"] }), "acc_remote"), "remote_type")).toBe("Wired");
    const v = one({ items: [REM()] });
    expect(val(byId(v, "acc_remote"), "remote_type")).toBe("Cordless");
    expect(tagOf(byId(v, "acc_remote"), "remote_type")).toBe("default");
  });
  it("NEGATIVE: v61's remote (no model_attr / first_words): the model's Wired is ignored, 'corded less' reads Wired (the review's F1)", () => {
    const old = vrf6([], (p) => { p.extras.accessories = structuredClone((V61() as unknown as { list_spec: { pricing: Px } }).list_spec.pricing.extras.accessories); });
    expect(val(byId(one({ items: [REM({ remote_type: "Wired" })] }, old), "acc_remote"), "remote_type")).toBe("Cordless");
    expect(val(byId(one({ items: [REM()], text: "1.5 TR corded less" }, old), "acc_remote"), "remote_type")).toBe("Wired");
  });
});

describe("VRF-6 F3 -- every included extra that is not added says why", () => {
  it("gas on an indoor unit (00218 r210) -> 'applies to outdoor units only'; refnet on an ODU -> 'applies to indoor units only' + its own row", () => {
    const v = sheet({ 9: { items: [CAS({ includes_gas: "Yes", includes_gas_where: "Heading" })] } })(9);
    expect(review(v)).toMatch(/Gas charge: stated in heading - NOT added: applies to outdoor units only/);
    const w = sheet({ 24: { items: [ODU({ capacity: "24 HP", includes_refnet: "Yes", includes_refnet_where: "Note" })] }, 133: { items: [{ item: "Refnet/Y-Joint" }], text: "Refnet Joints (Y- Joints)" } })(24);
    expect(review(w)).toMatch(/Refnet: stated in note - NOT added: applies to indoor units only; the BoQ also quotes it on its own row \(row 133\)/);
  });
  it("a controller with comm included (00108 r45) -> 'no extras are added on Touch Screen Central Controller'", () => {
    const v = one({ items: [{ item: "Touch Screen Central Controller", includes_comm: "Yes", includes_comm_where: "Row" }] });
    expect(review(v)).toMatch(/Communication cable: stated in row - NOT added: no extras are added on Touch Screen Central Controller/);
    expect(v.rowPriced).toBe(true);
  });
  it("the calculator: a gas tick on a Hi-Wall says why too", () => {
    const v = calc([{ base: null, family: "Hi-Wall", attrs: { capacity: "1.5" } }], { [EXTRAS_INCLUDES_KEY]: "gas" });
    expect(review(v)).toMatch(/Gas charge: stated in your tick - NOT added: applies to outdoor units only/);
  });
  it("NEGATIVE: v61's safeguard (no not_added line) -> silent, as the review found", () => {
    const v = sheet({ 9: { items: [CAS({ includes_gas: "Yes", includes_gas_where: "Heading" })] } }, vrf6(["safeguard"]))(9);
    expect(review(v)).not.toMatch(/outdoor units only/);
  });
});

describe("VRF-6 F4 -- the own-row check, category first", () => {
  it("copper in a note + piping-category rows (00298 r254 vs r287+) -> NOT added, the rows named", () => {
    const v = sheet({ 254: { items: [ODU({ capacity: "6 HP", includes_copper: "Yes", includes_copper_where: "Note" })] },
      287: { items: [{ item: "Copper", size: "15.6 mm" }], category: "hvac_piping", text: "5/8 dia (15.6 MM) with 13 mm insulation" } })(254);
    expect(byId(v, "copper_supply")).toBeUndefined();
    expect(review(v)).toMatch(/Copper piping: stated in note - NOT added: the BoQ quotes it on its own row \(row 287\)/);
  });
  it("a refnet-joint VRF row 'to connect copper piping' (00093 r38) is not a copper row -> copper ADDED + the Q-pre 13 review point", () => {
    const v = sheet({ 24: { items: [ODU({ capacity: "8 HP", includes_copper: "Yes", includes_copper_where: "Note" })] },
      38: { items: [{ item: "Refnet/Y-Joint" }], text: "Refrigerant joints to connect copper piping of the indoor unit" } })(24);
    expect(byId(v, "copper_supply")).toBeDefined();
    expect(review(v)).toMatch(/Copper piping is usually quoted separately/);
  });
  it("a sheet-level Preamble the run read (00234 r55 'Supply of additional Refrigerant') -> gas NOT added", () => {
    const v = sheet({ 12: { items: [ODU({ capacity: "16 HP", includes_gas: "Yes", includes_gas_where: "Heading" })] },
      55: { items: [{ item: "Refrigerant Gas Filling (R-410)" }], node: "Preamble", text: "Supply of additional Refrigerant R-410A" } })(12);
    expect(byId(v, "acc_gas")).toBeUndefined();
    expect(review(v)).toMatch(/row 55/);
  });
  it("an MS-frame VRF row is not a remote row (00029 r402); an uncategorised 'remote operation' starter row is not either", () => {
    const v = sheet({ 393: { items: [{ item: "Hi-Wall", capacity: "1.6 TR", includes_remote: "Yes", includes_remote_where: "Heading" }] },
      402: { items: [{ item: "MS Angle Base Frame Structure" }], text: "Supply of MS frame for the remote condensers" },
      185: { text: "TPN MPCB with DOL starter ... potential free contacts for remote operation" } })(393);
    expect(byId(v, "acc_remote")).toBeDefined();
  });
  it("NEGATIVE: v61's match (no category first) -> the refnet row still blocks copper, as the review found", () => {
    const v = sheet({ 24: { items: [ODU({ capacity: "8 HP", includes_copper: "Yes", includes_copper_where: "Note" })] },
      38: { items: [{ item: "Refnet/Y-Joint" }], text: "Refrigerant joints to connect copper piping of the indoor unit" } }, vrf6(["safeguard"]))(24);
    expect(byId(v, "copper_supply")).toBeUndefined();
  });
});

describe("VRF-6 F8 -- splits", () => {
  it("'24HP (12HP x 2NOS)' (00119 r9) -> 12 + 12", () => {
    const v = one({ items: [ODU({ capacity: "24HP (12HP x 2NOS)" })] });
    expect(v.items.map((b) => b.fields.find((f) => f.id === "capacity")?.value)).toEqual(["12", "12"]);
  });
  it("'60 HP (18+18+24)' on a Daikin Cool Only sheet (00175 r17) -> priced, the 24 split (largest 20), with the 4-module note", () => {
    const v = one({ items: [ODU({ brand: "Daikin", cooling: "Cool Only", capacity: "60.0 HP (18+18+24)" })] });
    expect(v.rowPriced).toBe(true);
    expect(v.split?.note).toMatch(/Module 24 HP is above the largest single unit \(20 HP\), so that module is split: 12 \+ 12 HP/);
    expect(v.split?.note).toMatch(/split into 4 modules/);
  });
  const caps = (v: ReturnType<typeof one>) => v.items.map((b) => b.fields.find((f) => f.id === "capacity")?.value);
  it("26 HP Daikin heat pump (00131 r17) -> the pair 20 + 6 (0 over), cheaper than the 34 HP combination SKU that covers it; the note says so", () => {
    const v = one({ items: [ODU({ brand: "Daikin", cooling: "Heat Pump", capacity: "26 HP" })] });
    expect(caps(v)).toEqual(["20", "6"]);
    expect(v.split?.note).toMatch(/26 HP is not a stocked size: the pair 20 \+ 6 HP \(0 HP over, cost \d+\) is cheaper than the 34 HP single that covers it \(cost \d+\)/);
  });
  it("QR-1 Q3 final: 22 HP Daikin heat pump (00131 r15) -> the cheaper pair with the least excess, 20 + 6 (4 over); NEGATIVE: never the exact 8 + 8 + 6", () => {
    const v = one({ items: [ODU({ brand: "Daikin", cooling: "Heat Pump", capacity: "22 HP" })] });
    expect(caps(v)).toEqual(["20", "6"]);
    expect(v.split?.note).toMatch(/22 HP is not a stocked size: the pair 20 \+ 6 HP \(4 HP over/);
    expect(v.split?.note).not.toMatch(/split into 3 modules/);
  });
  it("QR-1 Q3 final: 10 HP Daikin heat pump -> 6 + 6, cheaper than the 20 HP single", () => {
    expect(caps(one({ items: [ODU({ brand: "Daikin", cooling: "Heat Pump", capacity: "10 HP" })] }))).toEqual(["6", "6"]);
  });
  it("NEGATIVE: a pair whose cost nobody read is never proved cheaper -- 10 HP Daikin heat pump with the 6 HP cost blanked -> not 6 + 6 (cost unknown) but the next cheaper pair, 8 + 8", () => {
    const is6 = (it: RateMasterItem) => it.kind === "hvac_vrf_item" && it.attributes.brand === "Daikin" && it.attributes.item === "Outdoor Unit"
      && it.attributes.cooling === "Heat Pump" && it.attributes.discharge === "Top" && Number(it.attributes.capacity) === 6;
    expect(ITEMS.filter(is6).length).toBeGreaterThan(0);
    const blanked = ITEMS.map((it) => (is6(it) ? ({ ...it, rates: Object.fromEntries(Object.entries(it.rates ?? {}).filter(([k]) => k !== "cost_supply")) } as RateMasterItem) : it));
    const v = sheet({ 9: { items: [ODU({ brand: "Daikin", cooling: "Heat Pump", capacity: "10 HP" })] } }, vrf6(), blanked)(9);
    expect(caps(v)).toEqual(["8", "8"]);
  });
  it("NEGATIVE: 30 HP Daikin heat pump (00131 r19) -> the 34 HP single, cheaper than every covering pair (cheapest 20 + 20)", () => {
    const v = one({ items: [ODU({ brand: "Daikin", cooling: "Heat Pump", capacity: "30 HP" })] });
    expect(caps(v)).toEqual(["34"]);
    expect(v.items[0].working.join(" | ")).toMatch(/30 HP is not a stocked size: the single 34 HP unit covers it \(4 HP over, cost \d+\) and is cheaper than any pair that covers it \(the cheapest, 20 \+ 20 HP/);
  });
  it("NEGATIVE: 16.25 HP Blue Star (00098 r15) -> one 18 HP; the pair 10 + 7 has less excess (0.75) but costs more", () => {
    const v = one({ items: [ODU({ capacity: "16.25 HP", discharge: "Top" })] });
    expect(caps(v)).toEqual(["18"]);
    expect(v.items[0].working.join(" | ")).toMatch(/the single 18 HP unit covers it \(1.75 HP over/);
  });
  it("NEGATIVE: 10 HP Daikin Cool Only top discharge (00378 r3) -> one 12 HP; 6 + 6 costs more", () => {
    const v = one({ items: [ODU({ brand: "Daikin", cooling: "Cool Only", discharge: "Top", capacity: "10 HP" })] });
    expect(caps(v)).toEqual(["12"]);
    expect(v.items[0].working.join(" | ")).toMatch(/the single 12 HP unit covers it \(2 HP over, cost \d+\) and is cheaper than any pair that covers it \(the cheapest, 6 \+ 6 HP/);
  });
  it("NEGATIVE: a Blue Star 9 HP keeps the single 10 HP (cheaper than 7 + 7) and the working line says so; v61's split keys -> 34 HP / refuse as before", () => {
    const v = one({ items: [ODU({ capacity: "9 HP", discharge: "Top" })] });
    expect(v.items).toHaveLength(1);
    expect(v.items[0].fields.find((f) => f.id === "capacity")?.value).toBe("10");
    expect(v.items[0].working.join(" | ")).toMatch(/9 HP is not a stocked size: the single 10 HP unit covers it \(1 HP over, cost \d+\) and is cheaper than any pair that covers it \(the cheapest, 7 \+ 7 HP/);
    const old = vrf6(["split"]);
    expect(one({ items: [ODU({ brand: "Daikin", cooling: "Heat Pump", capacity: "26 HP" })] }, old).items[0].fields.find((f) => f.id === "capacity")?.value).toBe("34");
    expect(one({ items: [ODU({ brand: "Daikin", cooling: "Cool Only", capacity: "60.0 HP (18+18+24)" })] }, old).rowPriced).toBe(false);
    expect(one({ items: [ODU({ capacity: "24HP (12HP x 2NOS)" })] }, old).items).toHaveLength(1);
  });
});

describe("VRF-6 F11 -- cable / pipe facts reach their own item", () => {
  const C = (more: Item) => CAS({ capacity: "1.28 TR", includes_copper: "Yes", includes_copper_where: "Note", includes_power: "Yes", includes_power_where: "Heading",
    includes_comm: "Yes", includes_comm_where: "Heading", ...more });
  it("a 3 m cord (00073 r51) -> the power cable at 3 m; copper and comm keep the 30 m default", () => {
    const v = one({ items: [C({ extra_cable_spec_as_written: "3 meters long 3 core flexible copper cable with 3 pin top", extra_length_as_written: "3 meters long" })] });
    expect(val(byId(v, "power"), "length")).toBe("3");
    expect(val(byId(v, "copper_supply"), "length")).toBe("30");
    expect(val(byId(v, "comm"), "length")).toBe("30");
  });
  it("'FRLS, XLPE, AL Armoured' (00093 r25) -> aluminium armoured", () => {
    const v = one({ items: [ODU({ capacity: "8 HP", includes_power: "Yes", includes_power_where: "Note", extra_cable_spec_as_written: "power cable (FRLS, XLPE, AL Armoured)" })] });
    expect(val(byId(v, "power"), "conductor")).toBe("ALUMINIUM");
    expect(val(byId(v, "power"), "armour")).toBe("ARMOURED");
  });
  it("cabling for the drain pump (00020 r114) -> no power cable line, the note says why", () => {
    const v = one({ items: [{ item: "Hi-Wall", capacity: "0.6 TR", includes_power: "Yes", includes_power_where: "Note" }],
      headingNotes: ["Necessary cabling including plug top from nearest power point for the drain pump"] });
    expect(byId(v, "power")).toBeUndefined();
    expect(review(v)).toMatch(/is for the drain pump, not the unit's power cable/);
  });
  it("NEGATIVE: v61's lines -> the 3 m reaches every line; AL stays copper; the drain-pump cabling adds a power line", () => {
    const old = vrf6(["lines"]);
    const v = one({ items: [C({ extra_cable_spec_as_written: "3 meters long 3 core flexible copper cable", extra_length_as_written: "3 meters long" })] }, old);
    expect(val(byId(v, "copper_supply"), "length")).toBe("3");
    const w = one({ items: [ODU({ capacity: "8 HP", includes_power: "Yes", includes_power_where: "Note", extra_cable_spec_as_written: "power cable (FRLS, XLPE, AL Armoured)" })] }, old);
    expect(val(byId(w, "power"), "conductor")).toBe("COPPER");
  });
});

describe("VRF-6 F12 -- accessories follow the unit's make; make same as outdoor", () => {
  it("a Daikin cassette's wired remote is Daikin's (00131 r24)", () => {
    const v = one({ items: [CAS({ brand: "Daikin", capacity: "1 TR", includes_remote: "Yes", includes_remote_where: "Heading", remote_type: "Wired" })] });
    expect(val(byId(v, "acc_remote"), "item")).toMatch(/\(Daikin\)/);
  });
  it("a Daikin unit's drain pump: none stocked in Daikin -> the catalogue's pump, with a note", () => {
    const v = one({ items: [CAS({ brand: "Daikin", capacity: "1 TR", includes_drain_pump: "Yes", includes_drain_pump_where: "Row" })] });
    const dp = byId(v, "acc_drain_pump")!;
    expect(dp.state).toBe("priced");
    expect(dp.working.join(" ")).toMatch(/no Daikin drain pump is stocked/);
  });
  it("'Make will be same as of Outdoor' (00131 r33) -> the sheet's outdoor make (Daikin), noted", () => {
    const v = sheet({ 13: { items: [ODU({ brand: "None", brand_as_written: "TOSHIBA, MITSUBISHI, DAIKIN", capacity: "10 HP" })] },
      33: { items: [{ item: "Hi-Wall", capacity: "1.0Tr" }], headingNotes: ["(Make will be same as of Outdoor)"] } })(33);
    expect(v.items[0].fields.find((f) => f.id === "brand")?.value).toBe("Daikin");
    expect(review(v)).toMatch(/priced as Daikin, the make of this sheet's outdoor units \(row 13/);
  });
  it("NEGATIVE: a Blue Star unit's remote stays Blue Star with no note; v61's accessories -> Blue Star on a Daikin cassette", () => {
    const v = one({ items: [CAS({ includes_remote: "Yes", includes_remote_where: "Row" })] });
    expect(byId(v, "acc_remote")?.working.join(" ")).not.toMatch(/no Blue Star/);
    const old = one({ items: [CAS({ brand: "Daikin", capacity: "1 TR", includes_remote: "Yes", includes_remote_where: "Row", remote_type: "Wired" })] }, vrf6(["accessories"]));
    const oldRemote = lines(old).find((l) => l.id === "acc_remote");
    expect(val(oldRemote, "item")).not.toMatch(/Daikin/);
    expect(oldRemote?.perMetre?.supply).toBe(1200);   // v61: the Blue Star cordless (the model's Wired ignored, F1), never the Daikin
  });
});

describe("VRF-6 TEAM -- frame / stand, gas by HP, MCB + ELCB by HP", () => {
  const ALL = { includes_frame: "Yes", includes_frame_where: "Row", includes_gas: "Yes", includes_gas_where: "Row", includes_mccb: "Yes", includes_mccb_where: "Row" };
  it("26 HP ODU (00140 r18) -> one frame 5,600 / 0, gas 26 Kg, 63 A MCB + 63 A ELCB", () => {
    const v = one({ items: [ODU({ capacity: "26 HP", cooling: "Heat Pump", ...ALL })] });
    const fr = byId(v, "acc_frame")!;
    expect([val(fr, "qty"), fr.figures.supply_rate, fr.figures.install_rate]).toEqual(["1", 5600, 0]);
    expect(val(byId(v, "acc_gas"), "qty")).toBe("26");
    expect(val(byId(v, "acc_mcb"), "item")).toBe("63A FP MCB C CURVE");
    expect(val(byId(v, "acc_elcb"), "item")).toBe("63A RCCB 300mA(FP)");
  });
  it("the schedule steps up where Electrical does not stock the rating: 5 HP -> 16 A -> 25 A (noted); 12 HP ELCB 32 A -> 40 A", () => {
    const v = one({ items: [ODU({ capacity: "5 HP", discharge: "Side", ...ALL })] });
    expect(val(byId(v, "acc_mcb"), "item")).toBe("25A FP MCB C CURVE");
    expect(byId(v, "acc_mcb")!.working.join(" ")).toMatch(/does not stock a 16 A MCB 4-pole/);
    const w = one({ items: [ODU({ capacity: "12 HP", ...ALL })] });
    expect(val(byId(w, "acc_mcb"), "item")).toBe("32A FP MCB C CURVE");
    expect(val(byId(w, "acc_elcb"), "item")).toBe("40A RCCB 300mA (FP)");
  });
  it("a split row: each module its own frame / gas / MCB + ELCB ('38HP (20+18)' -> 63 A and 40 A)", () => {
    const v = one({ items: [ODU({ capacity: "38HP (20+18)", ...ALL })] });
    expect([val(byId(v, "acc_mcb", 0), "item"), val(byId(v, "acc_mcb", 1), "item")]).toEqual(["63A FP MCB C CURVE", "40A FP MCB C CURVE"]);
    expect([val(byId(v, "acc_gas", 0), "qty"), val(byId(v, "acc_gas", 1), "qty")]).toEqual(["20", "18"]);
  });
  it("'isolator' -> this MCB + ELCB set, noted; a frame quoted per Nos (00210 r29) prices on the frame / stand item", () => {
    const v = one({ items: [ODU({ capacity: "20 HP", includes_mccb: "Yes", includes_mccb_where: "Row" })], text: "20 HP ODU with isolator" });
    expect(byId(v, "acc_mcb")!.working.join(" ")).toMatch(/isolator - priced as this MCB \+ ELCB set/);
    const w = one({ items: [{ item: "MS Angle Base Frame Structure", capacity: "6HP" }], unit: "Nos" });
    expect([w.rowPriced, w.totals?.supply_rate, w.totals?.install_rate]).toEqual([true, 5600, 0]);
  });
  it("NEGATIVE: an indoor unit never gets gas / frame lines; v61's accessories -> the Kg frame and the MCCB", () => {
    const v = one({ items: [CAS(ALL)] });
    expect(lines(v).map((l) => l.id)).toEqual([]);
    const old = one({ items: [ODU({ capacity: "26 HP", ...ALL })] }, vrf6(["accessories"]));
    expect(lines(old).map((l) => l.id)).toEqual(["acc_frame", "acc_gas", "acc_mccb"]);
  });
});

describe("VRF-6 Q1 / Q5 / installation-only / Q6 / Q7 / Q-pre", () => {
  it("Q1: a built-in drain pump is added with the review point; NEGATIVE: no 'built-in' -> no point", () => {
    const v = one({ items: [CAS({ includes_drain_pump: "Yes", includes_drain_pump_where: "Row" })], text: "cassette with built-in drain pump" });
    expect(byId(v, "acc_drain_pump")).toBeDefined();
    expect(review(v)).toMatch(/built-in drain pump - added as a separate pump/);
    expect(review(one({ items: [CAS({ includes_drain_pump: "Yes", includes_drain_pump_where: "Row" })] }))).not.toMatch(/built-in/);
  });
  it("Q5: 'Supply of' under 'rates ... include ... installation', no installation row -> supply + installation, noted (00370 r4)", () => {
    const v = one({ items: [ODU({ capacity: "16 HP", scope: "Supply only" })], headingNotes: ["9.The unit rate for all Items shall include all costs - packing, storage, installation, testing"] });
    expect(v.totals?.install_rate).toBeGreaterThan(0);
    expect(v.scope?.note).toMatch(/no installation row for it - priced as supply \+ installation/);
  });
  it("Q5: the same with an installation-only row of that kind on the sheet -> supply only, the row named", () => {
    const v = sheet({ 4: { items: [ODU({ capacity: "16 HP", scope: "Supply only" })], headingNotes: ["The unit rate shall include installation"] },
      40: { items: [ODU({ capacity: "16 HP", scope: "Installation only" })] } })(4);
    expect(v.totals?.install_rate).toBe(0);
    expect(v.scope?.note).toMatch(/quotes installation on its own row \(row 40\)/);
  });
  it("installation-only: a supply row of that kind on the sheet -> the normal install (no uplift), named; none -> x 1.5", () => {
    const rows = { 6: { items: [ODU({ capacity: "6 HP", discharge: "Side", scope: "Supply only" })] }, 22: { items: [ODU({ capacity: "6 HP", discharge: "Side", scope: "Installation only" })] } };
    const v = sheet(rows)(22);
    const solo = sheet({ 22: rows[22] })(22);
    expect(v.scope?.note).toMatch(/normal installation rate applies.*row 6/);
    expect(solo.totals!.install_rate!).toBe(Math.ceil(v.totals!.install_rate! * 1.5 - 1e-9));
  });
  it("Q6: the row's 'Cooling Type' wins over a grandparent's '(HEAT PUMP)' (00114 r24), noted", () => {
    const v = one({ items: [ODU({ capacity: "20 HP", cooling: "Heat Pump" })], text: "20 HP outdoor unit (Cooling Type)", ancestorNotes: ["(HEAT PUMP)"] });
    expect(v.items[0].fields.find((f) => f.id === "cooling")?.value).toBe("Cool Only");
    expect(review(v)).toMatch(/the row wins: priced as Cool Only/);
  });
  it("Q7: a note 'cabling ... quantified separately' wins over the heading (00350 r100) -> no cable lines, the note quoted", () => {
    const v = one({ items: [CAS({ capacity: "1.6TR", includes_power: "Yes", includes_power_where: "Heading", includes_comm: "Yes", includes_comm_where: "Heading" })],
      headingNotes: ["Note: cabling & ODU stands quantified separately"] });
    expect(byId(v, "power")).toBeUndefined();
    expect(byId(v, "comm")).toBeUndefined();
    expect(review(v)).toMatch(/the BoQ note says "cabling & ODU stands quantified separately"/);
  });
  it("Q-pre 4 / 7 / 11: ON/OFF controller -> Touch Screen + note; CSU -> Ductable; 600x600 -> compact; '1 way' heading -> one-way; control wiring -> comm", () => {
    expect(review(one({ items: [{ item: "Touch Screen Central Controller" }], text: "Only ON/OFF Type Centralised Remote Controller system" }))).toMatch(/no ON\/OFF controller/);
    expect(one({ items: [{ capacity: "3.0 TR" }], headings: ["CSU type indoor units"] }).items[0].family).toBe("Ductable");
    expect(one({ items: [CAS({ capacity: "1.0 TR" })], text: "1.0 TR (600mm X 600mm only)" }).items[0].fields.find((f) => f.id === "way")?.value).toBe("FOUR-WAY COMPACT");
    expect(one({ items: [CAS({ capacity: "2.0 TR" })], headings: ["1 Way Cassette units"] }).items[0].fields.find((f) => f.id === "way")?.value).toBe("ONE-WAY");
    const cw = one({ items: [{ item: "Ductable", capacity: "3.2 TR" }], headings: ["Ductable units with control wiring"] });
    expect(byId(cw, "comm")).toBeDefined();
    expect(review(cw)).toMatch(/control wiring/);
  });
  it("two capacities (00352 r150) -> 'two capacities stated (2.6 TR / 1.3 TR) - pick one'; '6 .3TR' reads 6.3 (next size up 8 TR)", () => {
    const v = one({ items: [CAS({ capacity: "" })], text: "Cassette Type- 2.6 Tr Capacity | Supply of CEILING CASSETTE ... capacity below 1.3 TR capacity" });
    expect(v.reason).toBe("two capacities stated (2.6 TR / 1.3 TR) - pick one");
    const w = one({ items: [{ item: "Ductable", capacity: "6 .3TR" }] });
    expect(w.items[0].fields.find((f) => f.id === "capacity")?.value).toBe("8");
  });
  it("NEGATIVE: the config without these keys -> the row's scope / cooling / text as stored (no notes, 'no capacity stated', '6 .3TR' refuses)", () => {
    const old = vrf6(["prepare", "two", "scope"]);
    expect(one({ items: [ODU({ capacity: "16 HP", scope: "Supply only" })], headingNotes: ["The unit rate shall include installation"] }, old).totals?.install_rate).toBe(0);
    expect(one({ items: [CAS({ capacity: "" })], text: "2.6 Tr Capacity ... 1.3 TR capacity" }, old).reason).toBe("no capacity stated");
    expect(one({ items: [{ item: "Ductable", capacity: "6 .3TR" }] }, old).rowPriced).toBe(false);
  });
});

describe("VRF-6 -- a config without the keys is byte-identical", () => {
  it("v61's hvac_vrf prices the same rows the same way under this code (one row per mechanism)", () => {
    const rows: Row[] = [
      { items: [ODU({ capacity: "26 HP", includes_frame: "Yes", includes_frame_where: "Row", includes_mccb: "Yes", includes_mccb_where: "Row" })] },
      { items: [CAS({ includes_remote: "Yes", includes_remote_where: "Row", remote_type: "Wired" })] },
      { items: [ODU({ capacity: "24HP (12HP x 2NOS)" })] },
    ];
    for (const r of rows) {
      const a = allText(one(r, V61()));
      expect(a).not.toMatch(/owner Q|owner F|team rule/);
    }
  });
});

describe("VRF-6 QR-1 Q3 -- coveringSets (every covering pair: least excess, then cheapest)", () => {
  it("covering only, at most maxUnits units; ranked least excess first", () => {
    const s = coveringSets(22, [6, 8, 20], 2);
    expect(s.map((x) => x.layers)).toEqual([[20, 6], [20, 8], [20, 20]]);
    expect(s.every((x) => x.layers.reduce((a, b) => a + b, 0) >= 22)).toBe(true);
    expect(coveringSets(22, [6, 8, 20], 3)[0]).toEqual({ layers: [8, 8, 6], excess: 0, cost: null });
  });
  it("least excess ranks before cost (a cheaper pair with more excess comes later)", () => {
    const cost: Record<number, number> = { 20: 1, 10: 50, 12: 50, 14: 50 };
    expect(coveringSets(24, [10, 12, 14, 20], 2, (r) => cost[r] ?? null)[0].layers).toEqual([14, 10]);
  });
  it("an equal excess goes to the cheaper; an unknown cost ranks after a known one", () => {
    const cost: Record<number, number> = { 12: 100, 14: 1, 10: 1 };
    expect(coveringSets(24, [10, 12, 14], 2, (r) => cost[r] ?? null).slice(0, 2).map((x) => x.layers)).toEqual([[14, 10], [12, 12]]);
    expect(coveringSets(26, [10, 12, 14, 13], 2, (r) => cost[r] ?? null).filter((x) => x.excess === 0).map((x) => x.cost)).toEqual([101, null]);
  });
  it("NEGATIVE: nothing covers -> empty; fewer than two units allowed -> empty", () => {
    expect(coveringSets(100, [6, 8], 2)).toEqual([]);
    expect(coveringSets(10, [6], 1)).toEqual([]);
  });
});

describe("VRF-6 U11 -- the helper's pick <-> the next best (owner 18:52 / 19:32; K1d 23:51: exactly two)", () => {
  const cap = (v: ItemListView) => v.items.map((b) => b.fields.find((f) => f.id === "capacity")?.value);
  const row24 = { 9: { items: [ODU({ brand: "Daikin", cooling: "Heat Pump", capacity: "24 HP" })] } };
  const step = (v: ItemListView, option: number, er = 9, rows: Record<number, Row> = row24) =>
    sheet(rows)(er, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(applyItemEdit(v.editState, { op: "cover_option", index: 0, option })) });
  it("24 HP Daikin heat pump (00131 r16): exactly two options - the helper's pick 20 + 6 and the next best; no 'of n' anywhere", () => {
    const v = sheet(row24)(9);
    expect(cap(v)).toEqual(["20", "6"]);
    expect(v.items[0].cover).toMatchObject({ option: 1, of: 2, userChosen: false, next: 1 });
    expect(v.items[0].cover!.label).toBe("The helper's pick: 20 + 6 HP for the BoQ's 24 HP");
    expect(allText(v)).not.toMatch(/Option \d+ of \d+/);
    expect(v.items[1].cover).toBeUndefined();
  });
  it("the toggle goes to the next best (re-priced, the note names it, its excess and the helper's pick) and back = the automatic price", () => {
    const v = sheet(row24)(9);
    const s2 = step(v, 1);
    expect(cap(s2)).toEqual(["20", "8"]);
    expect(s2.split?.note).toMatch(/^Next-best option \(chosen by the user\): 20 \+ 8 HP = 28 HP, 4 HP over the BoQ's 24 HP; the helper's pick was 20 \+ 6 HP\./);
    expect(s2.items[0].cover).toMatchObject({ option: 2, of: 2, userChosen: true, next: 0, label: "Next-best option (chosen by you): 20 + 8 HP for the BoQ's 24 HP" });
    expect(s2.items[0].helperLine).toMatch(/^From the next-best option you chose for 24 HP -> 20 HP/);
    expect(s2.totals).not.toEqual(v.totals);
    const back = step(s2, 0);
    expect(cap(back)).toEqual(["20", "6"]);
    expect(back.totals).toEqual(v.totals);
    expect(back.items[0].cover).toMatchObject({ option: 1, userChosen: false, next: 1 });
    expect(back.items[0].helperLine).toMatch(/^From the helper's split/);
  });
  it("NEGATIVE: an option beyond the second is never offered (a stored 4 falls back to the next best)", () => {
    const s4 = step(sheet(row24)(9), 4);
    expect(cap(s4)).toEqual(["20", "8"]);
    expect(s4.items[0].cover).toMatchObject({ option: 2, of: 2 });
  });
  it("a single helper pick (30 HP -> 34) toggles to the next best, a pair (no larger single)", () => {
    const rows = { 9: { items: [ODU({ brand: "Daikin", cooling: "Heat Pump", capacity: "30 HP" })] } };
    const v = sheet(rows)(9);
    expect(cap(v)).toEqual(["34"]);
    expect(v.items[0].cover).toMatchObject({ option: 1, of: 2, userChosen: false });
    const s2 = step(v, 1, 9, rows);
    expect(cap(s2).length).toBe(2);
    expect(s2.split?.note).toMatch(/^Next-best option \(chosen by the user\): .* the helper's pick was 34 HP\./);
  });
  it("the calculator shows the same two options", () => {
    const panel = sheet(row24)(9);
    const c = calc([{ base: null, family: "Outdoor Unit", attrs: { brand: "Daikin", cooling: "Heat Pump", capacity: "24" }, other: ["capacity"] }]);
    expect(c.items[0].cover?.label).toBe(panel.items[0].cover?.label);
    expect(c.items[0].cover?.of).toBe(2);
  });
  it("rankCover offers at most two; one covering option -> one (and the pricer then shows no control)", () => {
    expect(rankCover(24, [6, 8, 20, 34], [{ layers: [20, 6], excess: 2, cost: 1 }, { layers: [20, 8], excess: 4, cost: 2 }], () => 5)).toHaveLength(2);
    expect(rankCover(30, [34], [], () => 5)).toEqual([{ layers: [34], excess: 4, cost: 5 }]);
  });
  it("NEGATIVE: an exact stocked size, an indoor unit and v61's config carry no toggle", () => {
    expect(sheet({ 9: { items: [ODU({ brand: "Daikin", cooling: "Heat Pump", capacity: "20 HP" })] } })(9).items[0].cover).toBeUndefined();
    expect(one({ items: [CAS()] }).items[0].cover).toBeUndefined();
    expect(sheet(row24, V61())(9).items.every((b) => !b.cover)).toBe(true);
  });
  it("NEGATIVE: Reset to the helper's split drops a chosen option", () => {
    const s2 = step(sheet(row24)(9), 1);
    const r = sheet(row24)(9, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(applyItemEdit(s2.editState, { op: "reset_split" })) });
    expect(cap(r)).toEqual(["20", "6"]);
  });
});
