/**
 * VP-1 (B5 (vi), R-39 / T1 for the new categories) -- EVERY DERIVATION-TAB RULE OF VALVE PACKAGE AND MISC FIRES FROM THE PANEL'S
 * ENTRY POINT (`makePricingSheetHelper(...).compute`), with the calculator where the rule is a typed one; each rule has a
 * positive and a negative case. Misc's rules run where they run in the product: inside a Valve Package row, through the
 * borrowed section (Misc has no panel of its own -- borrow-only).
 *
 *   THE GUARD: the rules this file names EQUAL the rules `itemListRuleOrder` generates from each config (v65 + the VP-1 fixture
 *   = v66). A new rule with no case fails here; a case naming a rule that no longer exists fails too.
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { type ExtractedListItem } from "./itemListPricing";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, SCOPE_OVERRIDE_KEY, buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";
import { MISC, VALVE, applyVp1 } from "./vp1.harness";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
const h65 = readJsonFixture<Asset>(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v65.json", import.meta.url));
const h66 = applyVp1(h65 as never) as unknown as Asset;
const ITEMS: RateMasterItem[] = h66.items.map((it) => ({ ...it, discipline: h66.discipline, attributes: { ...it.attributes } } as RateMasterItem));
const CFG = new Map<string, RateCategoryConfig>(h66.category_configs.map((c) => [c.category_id, c]));
const KINDS = ["supply_rate", "install_rate", "combined_rate"];

type Item = Record<string, string | null> & { _section?: string };
const mi = (a: Item): ExtractedListItem => {
  const { _section, ...attrs } = a;
  return { ...(_section ? { section: _section } : {}), attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) } as never;
};
const V = (fam: string, size: string | null, more: Item = {}): Item => ({ valve_type: fam, valve_type_as_written: fam, size_mm: size, ...more });
const M = (item: string, more: Item = {}): Item => ({ _section: "misc", item, item_as_written: item, size_mm: null, ...more });
const panel = (items: Item[], unit = "Nos", text = "valve row", ov: Record<string, string> = {}): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS,
    extractionByRow: buildExtractionByRow([{ excel_row: 9, description: text, category_id: VALVE, attributes: {}, items: items.map(mi) }] as never) });
  return (h.compute({ excelRow: 9, description: text, nodeType: "Line Item", category: VALVE, discipline: "HVAC", rateKinds: KINDS, unit, headings: [], ownNotes: [], headingNotes: [] } as never, ov) as unknown as ItemListSuggestion).itemList!;
};
// DU-1: a panel row whose sheet holds other line items the run read (the pair rule reads each one's item 1 family and scope answer
// from the run -- `compute` rebuilds `sheetLines` from the extraction map)
const panelSheet = (items: Item[], text: string, others: Array<{ row: number; text: string; items: Item[] }>): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS,
    extractionByRow: buildExtractionByRow([{ excel_row: 9, description: text, category_id: VALVE, attributes: {}, items: items.map(mi) },
      ...others.map((o) => ({ excel_row: o.row, description: o.text, category_id: VALVE, attributes: {}, items: o.items.map(mi) }))] as never) });
  const sheetLines = [{ row: 9, text }, ...others.map((o) => ({ row: o.row, text: o.text }))];
  return (h.compute({ excelRow: 9, description: text, nodeType: "Line Item", category: VALVE, discipline: "HVAC", rateKinds: KINDS, unit: "Nos", headings: [], ownNotes: [], headingNotes: [], sheetLines } as never, {}) as unknown as ItemListSuggestion).itemList!;
};
const calc = (blocks: unknown[], ov: Record<string, string> = {}): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: CFG, items: ITEMS, extractionByRow: new Map() });
  return (h.compute(calculatorCtx("HVAC", VALVE), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: blocks }), [ROW_UNIT_OVERRIDE_KEY]: "Nos", ...ov }) as unknown as ItemListSuggestion).itemList!;
};
const txt = (v: ItemListView) => JSON.stringify(v);
const tot = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];

type Case = { rule: string; kind: "pos" | "neg"; run: () => ItemListView; re?: Array<string | RegExp>; not?: Array<string | RegExp>; priced?: boolean; figures?: [number, number] };
const R = {
  unit: "The row's unit decides which kind of rate applies",
  kind: "The item's own kind decides which products can price it",
  none: "A material the model could not match to any kind refuses",
  bySize: "A 'valve', 'valves', 'isolation', 'isolating', 'isolator', 'isolative' with no type the catalogue stocks is priced by its size",
  unstocked: "A material the catalogue does not stock refuses by name, whatever kind was picked",
  ruleForUnit: "That kind's rule for that unit",
  needs: "The facts that rule needs before it can price",
  inchesV: "A valve size written in inches is converted to millimetres",
  typedV: "A typed valve size is one size, in mm or inches",
  defaults: "A fact the row does not mention takes its ruled value",
  operator: "A butterfly valve row naming its operator (lever, gear) carries a line: the size decides the sheet's butterfly valve, the operator is noted, never refused",
  pibcv: "Every PIBCV row is priced as the sheet's one PIBCV item, with a line naming that item",
  fitV: "Fitting the stated valve size to the catalogue",
  bareV: "A valve size written as a bare number that could be inches refuses",
  steps: "Then the priced steps below, in their own order",
  qty: "Multiplied by how many of the item one unit of the row pays for",
  misc: "The misc item section is priced by Misc item's rules",
  rowTotal: "The row total adds every valve and every section",
  a3Unit: "A kind not stocked in the row's unit refuses, naming the units it is stocked in",
  a3Unstocked: "An unstocked combination names only the facts the kind's products vary on",
  set: "A row priced per Set takes one Set as one piece",
  lot: "A row priced per Lot is not priced",
  scope: "The BoQ scope: supply + installation unless the row says otherwise",
  // DU-1 FIX-1 / FIX-2 (owner 2026-11-15 13:30-13:41 + QR-1 Q1 (a)): the lines the tab now generates for rules that already ran
  drain: "A 'drain' in the valve type as written with no type the catalogue stocks is priced as the Ball Valve",
  noteFlange: "A Butterfly Valve, Motorised Butterfly Valve, Balancing Valve, PIBCV, Sluice / Gate Valve, Strainer, Ball Valve, BTU Meter, 2-Way Valve, Test & Drain Valve, Automatic Air Vent row whose own words or its headings call for it carries a note",
  noteBalancing: "A Balancing Valve row whose own words or its headings call for it carries a note",
  noteInsulation: "A row whose own words or its headings call for it carries a note",
  pair: "A 'Supply of' row whose installation is quoted on its own row of the sheet is priced supply only",
  noteThermowell: "A Temperature Gauge / Thermometer row whose own words or its headings call for it carries a note",
  noteGaugeFittings: "A Pressure Gauge row whose own words or its headings call for it carries a note",
  // Misc's own tab
  inchesM: "A size written in inches is converted to millimetres",
  typedM: "A typed size is one size, in mm or inches",
  fitM: "Fitting the stated size to the catalogue",
  bareM: "A size written as a bare number that could be inches refuses",
};
const BELLOWS = (size: string | null) => M("Rubber Bellows / Expansion Joint", { size_mm: size });

const VALVE_CASES: Case[] = [
  { rule: R.unit, kind: "pos", run: () => panel([V("Ball Valve", "25 mm")], ""), re: ["no unit on this row"], priced: false },
  { rule: R.unit, kind: "neg", run: () => panel([V("Ball Valve", "25 mm")], "Nos"), not: ["no unit on this row"], priced: true, figures: [682, 1000] },
  { rule: R.kind, kind: "pos", run: () => panel([V("Ball Valve", "25 mm")]), re: ['"family":"Ball Valve"'], priced: true },
  { rule: R.kind, kind: "neg", run: () => panel([V("ABC", "25 mm")]), re: ["no SKU in the catalogue for 'ABC' -- the user decides"], priced: false },
  { rule: R.none, kind: "pos", run: () => panel([V("none of these", "50 mm", { valve_type_as_written: "Globe valve" })]), re: ["No SKU in the catalogue for Globe valve - price this row by hand"], priced: false },
  { rule: R.none, kind: "neg", run: () => panel([V("Strainer", "50 mm", { strainer_type: "Y-Type" })]), not: ["No SKU in the catalogue"], priced: true, figures: [3141, 1000] },
  { rule: R.bySize, kind: "pos", run: () => panel([V("none of these", "40 mm", { valve_type_as_written: "Isolation valve" })]), re: ["does not say which valve type"], priced: true, figures: [1470, 1000] },
  { rule: R.bySize, kind: "neg", run: () => panel([V("none of these", "40 mm", { valve_type_as_written: "Pressure reducing valve" })]), not: ["does not say which valve type"], priced: false },
  { rule: R.unstocked, kind: "pos", run: () => panel([V("Ball Valve", "50 mm")], "Nos", "Ball valve with flow meter"), re: ["No SKU in the catalogue for"], priced: false },
  { rule: R.unstocked, kind: "neg", run: () => panel([V("Ball Valve", "50 mm")], "Nos", "Ball valve 50 mm"), not: ["No SKU in the catalogue for"], priced: true },
  { rule: R.ruleForUnit, kind: "pos", run: () => panel([V("Ball Valve", "32 mm")]), re: ["Ball Valve / (Nos)"], priced: true },
  { rule: R.ruleForUnit, kind: "neg", run: () => panel([V("Ball Valve", "32 mm")], "Kg"), re: ["is not stocked per 'Kg'"], priced: false },
  { rule: R.needs, kind: "pos", run: () => panel([V("BTU Meter", null)]), re: ["no valve size stated"], priced: false },
  { rule: R.needs, kind: "neg", run: () => panel([V("BTU Meter", "50 mm")]), not: ["no valve size stated"], priced: true },
  { rule: R.inchesV, kind: "pos", run: () => panel([V("Ball Valve", "1 inch")]), re: [/1 inch -> /], priced: true, figures: [682, 1000] },
  { rule: R.inchesV, kind: "neg", run: () => panel([V("Ball Valve", "25 mm")]), not: [/ inch -> /], priced: true, figures: [682, 1000] },
  { rule: R.typedV, kind: "pos", run: () => calc([{ base: null, family: "Ball Valve", attrs: { size_mm: "40-50" }, other: ["size_mm"] }]), re: ["Type one valve size, in mm or inches"], priced: false },
  { rule: R.typedV, kind: "neg", run: () => calc([{ base: null, family: "Ball Valve", attrs: { size_mm: "DN 40" }, other: ["size_mm"] }]), not: ["Type one valve size"], priced: true, figures: [1470, 1000] },
  { rule: R.defaults, kind: "pos", run: () => panel([V("Motorised Butterfly Valve", "250 mm", { actuation: "None" })]), re: ["actuator duty not stated - priced as On-Off"], priced: true, figures: [178009, 3000] },
  { rule: R.defaults, kind: "neg", run: () => panel([V("Motorised Butterfly Valve", "250 mm", { actuation: "Modulating" })]), not: ["actuator duty not stated"], priced: true },
  { rule: R.operator, kind: "pos", run: () => panel([V("Butterfly Valve", "150 mm", { operator_as_written: "gear operated" })]), re: ["BoQ says gear operated - the size decides the sheet's butterfly valve"], priced: true, figures: [5708, 1000] },
  { rule: R.operator, kind: "neg", run: () => panel([V("Butterfly Valve", "150 mm")]), not: ["the operator is noted"], priced: true, figures: [5708, 1000] },
  { rule: R.pibcv, kind: "pos", run: () => panel([V("PIBCV", "32 mm", { valve_type_as_written: "PICV" })]), re: ["priced as the sheet's one PIBCV item"], priced: true, figures: [28093, 1000] },
  { rule: R.pibcv, kind: "neg", run: () => panel([V("Ball Valve", "32 mm", { valve_type_as_written: "PICV" })]), not: ["priced as the sheet's one PIBCV item"], priced: true },
  { rule: R.fitV, kind: "pos", run: () => panel([V("Butterfly Valve", "140 mm")]), re: ["next size up"], priced: true, figures: [5708, 1000] },
  { rule: R.fitV, kind: "neg", run: () => panel([V("Butterfly Valve", "400 mm")]), re: ["valve size 400 is above the largest size on the sheet (300)"], priced: false },
  { rule: R.bareV, kind: "pos", run: () => panel([V("Butterfly Valve", "2")]), re: ["size 2 has no unit - price this row by hand"], priced: false },
  { rule: R.bareV, kind: "neg", run: () => panel([V("Butterfly Valve", "2 inch")]), not: ["has no unit"], priced: true },
  { rule: R.steps, kind: "pos", run: () => panel([V("Ball Valve", "40 mm")]), re: ["ROUNDUP"], priced: true, figures: [1470, 1000] },
  { rule: R.steps, kind: "neg", run: () => panel([V("Ball Valve", null)]), not: ["ROUNDUP"], priced: false },
  { rule: R.qty, kind: "pos", run: () => calc([{ base: null, family: "Ball Valve", attrs: { size_mm: "40" }, other: ["size_mm"], qty: "2" }]), re: ["x 2 per row unit"], priced: true, figures: [2940, 2000] },
  { rule: R.qty, kind: "neg", run: () => calc([{ base: null, family: "Ball Valve", attrs: { size_mm: "40" }, other: ["size_mm"] }]), not: ["per row unit"], priced: true, figures: [1470, 1000] },
  { rule: R.misc, kind: "pos", run: () => panel([M("Temperature Gauge / Thermometer")]), re: ["Temperature Gauge / Thermometer"], priced: true, figures: [2175, 500] },
  { rule: R.misc, kind: "neg", run: () => panel([V("Ball Valve", "25 mm")]), not: ['"independent":[{'], priced: true, figures: [682, 1000] },
  { rule: R.rowTotal, kind: "pos", run: () => panel([V("Ball Valve", "25 mm"), M("Pressure Gauge")]), priced: true, figures: [2857, 1500] },
  { rule: R.rowTotal, kind: "neg", run: () => panel([V("Ball Valve", "25 mm"), V("none of these", "25 mm", { valve_type_as_written: "3-way valve" })]), re: ["No SKU in the catalogue for 3-way valve"], priced: false },
  { rule: R.a3Unit, kind: "pos", run: () => panel([V("Ball Valve", "25 mm")], "Sqm"), re: ["Ball Valve is not stocked per 'Sqm' (stocked per Nos)"], priced: false },
  { rule: R.a3Unit, kind: "neg", run: () => panel([V("Ball Valve", "25 mm")], "nos"), not: ["is not stocked per"], priced: true },
  { rule: R.a3Unstocked, kind: "pos", run: () => panel([V("2-Way Valve", "25 mm", { operation: "On-Off" })]), re: ["No SKU for 2-Way Valve"], priced: false },
  { rule: R.a3Unstocked, kind: "neg", run: () => panel([V("2-Way Valve", "25 mm", { operation: "Modulating" })]), not: ["No SKU for 2-Way Valve"], priced: true },
  { rule: R.set, kind: "pos", run: () => panel([V("Ball Valve", "32 mm")], "Set"), re: ["PRICED PER SET - CHECK WHAT ONE SET HOLDS."], priced: true },
  { rule: R.set, kind: "neg", run: () => panel([V("Ball Valve", "32 mm")], "Nos"), not: ["PRICED PER SET"], priced: true },
  { rule: R.lot, kind: "pos", run: () => panel([V("Ball Valve", "32 mm")], "Lot"), re: ['Unit \\"Lot\\" is not a valve unit'], priced: false },
  { rule: R.lot, kind: "neg", run: () => panel([V("Ball Valve", "32 mm")], "Nos"), not: ["is not a valve unit"], priced: true },
  { rule: R.scope, kind: "pos", run: () => panel([V("Ball Valve", "25 mm")], "Nos", "valve row", { [SCOPE_OVERRIDE_KEY]: "Supply only" }), re: ["Scope changed by user"], priced: true, figures: [682, 0] },
  { rule: R.scope, kind: "neg", run: () => panel([V("Ball Valve", "25 mm")]), not: ["Scope changed by user"], priced: true, figures: [682, 1000] },
  // DU-1 FIX-1 / FIX-2: each new line with a positive and a negative case from the panel's entry point
  { rule: R.drain, kind: "pos", run: () => panel([V("none of these", "25 mm", { valve_type_as_written: "Drain valve" })]), re: ["BoQ says a drain valve -> priced as the Ball Valve of the same size"], priced: true, figures: [682, 1000] },
  { rule: R.drain, kind: "neg", run: () => panel([V("none of these", "25 mm", { valve_type_as_written: "Globe valve" })]), not: ["drain valve"], priced: false },
  { rule: R.noteFlange, kind: "pos", run: () => panel([V("Butterfly Valve", "150 mm")], "Nos", "Butterfly valve 150 mm with flanges"), re: ["flanges, nuts, bolts and gaskets are part of fitting the valve"], priced: true, figures: [5708, 1000] },
  { rule: R.noteFlange, kind: "neg", run: () => panel([V("Butterfly Valve", "150 mm")], "Nos", "Butterfly valve 150 mm"), not: ["flanges, nuts, bolts"], priced: true, figures: [5708, 1000] },
  { rule: R.noteBalancing, kind: "pos", run: () => panel([V("Balancing Valve", "50 mm")], "Nos", "Balancing valve 50 mm"), re: ["the only balancing valve on our sheet"], priced: true },
  { rule: R.noteBalancing, kind: "neg", run: () => panel([V("Ball Valve", "50 mm")], "Nos", "Ball valve 50 mm"), not: ["the only balancing valve on our sheet"], priced: true },
  { rule: R.noteInsulation, kind: "pos", run: () => panel([V("Ball Valve", "25 mm")], "Nos", "Ball valve 25 mm with insulation"), re: ["Valve insulation is not on our sheets"], priced: true, figures: [682, 1000] },
  { rule: R.noteInsulation, kind: "neg", run: () => panel([V("Ball Valve", "25 mm")], "Nos", "Ball valve 25 mm"), not: ["Valve insulation is not on our sheets"], priced: true, figures: [682, 1000] },
  { rule: R.pair, kind: "pos", run: () => panelSheet([V("Ball Valve", "25 mm")], "Supply of ball valve 25 mm", [{ row: 12, text: "Installation of ball valve 25 mm", items: [V("Ball Valve", "25 mm", { scope: "Installation only" })] }]), re: ["Installation is quoted on its own row on this sheet, so priced supply only here"], priced: true, figures: [682, 0] },
  { rule: R.pair, kind: "neg", run: () => panelSheet([V("Ball Valve", "25 mm")], "Supply of ball valve 25 mm", []), not: ["Installation is quoted on its own row"], priced: true, figures: [682, 1000] },
];
const MISC_CASES: Case[] = [
  { rule: R.unit, kind: "pos", run: () => panel([M("Pressure Gauge")], ""), re: ["no unit on this row"], priced: false },
  { rule: R.unit, kind: "neg", run: () => panel([M("Pressure Gauge")], "Nos"), not: ["no unit on this row"], priced: true, figures: [2175, 500] },
  { rule: R.kind, kind: "pos", run: () => panel([M("Pressure Gauge")]), re: ['"family":"Pressure Gauge"'], priced: true },
  { rule: R.kind, kind: "neg", run: () => panel([M("Flow indicator")]), re: ["no SKU in the catalogue for 'Flow indicator' -- the user decides"], priced: false },
  { rule: R.none, kind: "pos", run: () => panel([M("none of these", { item_as_written: "gauge cock" })]), re: ["No SKU in the catalogue for gauge cock - price this row by hand"], priced: false },
  { rule: R.none, kind: "neg", run: () => panel([M("Test Plug / Thermowell")]), not: ["No SKU in the catalogue"], priced: true, figures: [720, 100] },
  { rule: R.unstocked, kind: "pos", run: () => panel([M("Pressure Gauge", { item_as_written: "Flow meter" })]), re: ["No SKU in the catalogue for"], priced: false },
  { rule: R.unstocked, kind: "neg", run: () => panel([M("Pressure Gauge", { item_as_written: "Pressure gauge with gauge cock" })]), not: ["No SKU in the catalogue for"], priced: true },
  { rule: R.ruleForUnit, kind: "pos", run: () => panel([M("Pressure Gauge")]), re: ["Pressure Gauge / (Nos)"], priced: true },
  { rule: R.ruleForUnit, kind: "neg", run: () => panel([M("Pressure Gauge")], "Set"), re: ["is not stocked per 'Set'"], priced: false },
  { rule: R.needs, kind: "pos", run: () => panel([BELLOWS(null)]), re: ["no size stated"], priced: false },
  { rule: R.needs, kind: "neg", run: () => panel([BELLOWS("100 mm")]), not: ["no size stated"], priced: true, figures: [8888, 1200] },
  { rule: R.inchesM, kind: "pos", run: () => panel([BELLOWS("4 inch")]), re: [/4 inch -> /], priced: true, figures: [8888, 1200] },
  { rule: R.inchesM, kind: "neg", run: () => panel([BELLOWS("100 mm")]), not: [/ inch -> /], priced: true },
  { rule: R.typedM, kind: "pos", run: () => calc([], { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [], sections: { misc: [{ base: null, family: "Rubber Bellows / Expansion Joint", attrs: { size_mm: "40-50" }, other: ["size_mm"] }] } }) }), re: ["Type one size, in mm or inches"], priced: false },
  { rule: R.typedM, kind: "neg", run: () => calc([], { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [], sections: { misc: [{ base: null, family: "Rubber Bellows / Expansion Joint", attrs: { size_mm: "100" }, other: ["size_mm"] }] } }) }), not: ["Type one size"], priced: true, figures: [8888, 1200] },
  { rule: R.fitM, kind: "pos", run: () => panel([BELLOWS("90 mm")]), re: ["next size up"], priced: true, figures: [8888, 1200] },
  { rule: R.fitM, kind: "neg", run: () => panel([BELLOWS("350 mm")]), re: ["size 350 is above the largest size on the sheet (300)"], priced: false },
  { rule: R.bareM, kind: "pos", run: () => panel([BELLOWS("2")]), re: ["size 2 has no unit - price this row by hand"], priced: false },
  { rule: R.bareM, kind: "neg", run: () => panel([BELLOWS("2 inch")]), not: ["has no unit"], priced: true },
  { rule: R.steps, kind: "pos", run: () => panel([M("Pressure Gauge")]), re: ["ROUNDUP"], priced: true, figures: [2175, 500] },
  { rule: R.steps, kind: "neg", run: () => panel([BELLOWS(null)]), not: ["ROUNDUP"], priced: false },
  { rule: R.qty, kind: "pos", run: () => calc([], { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [], sections: { misc: [{ base: null, family: "Pressure Gauge", attrs: {}, qty: "2" }] } }) }), re: ["x 2 per row unit"], priced: true, figures: [4350, 1000] },
  { rule: R.qty, kind: "neg", run: () => calc([], { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [], sections: { misc: [{ base: null, family: "Pressure Gauge", attrs: {} }] } }) }), not: ["per row unit"], priced: true, figures: [2175, 500] },
  { rule: R.a3Unit, kind: "pos", run: () => panel([M("Pressure Gauge")], "Sqm"), re: ["Pressure Gauge is not stocked per 'Sqm' (stocked per Nos)"], priced: false },
  { rule: R.a3Unit, kind: "neg", run: () => panel([M("Pressure Gauge")], "nos"), not: ["is not stocked per"], priced: true },
  // DU-1 FIX-1: Misc's text_notes lines (nested under the Valve Package's Misc line), each positive and negative
  { rule: R.noteThermowell, kind: "pos", run: () => panel([M("Temperature Gauge / Thermometer")], "Nos", "Thermometer with thermowell"), re: ["thermowell with the thermometer"] },
  { rule: R.noteThermowell, kind: "neg", run: () => panel([M("Temperature Gauge / Thermometer")], "Nos", "Thermometer"), not: ["thermowell with the thermometer"] },
  { rule: R.noteGaugeFittings, kind: "pos", run: () => panel([M("Pressure Gauge")], "Nos", "Pressure gauge with syphon"), re: ["gauge's own fittings"], priced: true, figures: [2175, 500] },
  { rule: R.noteGaugeFittings, kind: "neg", run: () => panel([M("Pressure Gauge")], "Nos", "Pressure gauge"), not: ["gauge's own fittings"], priced: true, figures: [2175, 500] },
];

const run = (c: Case, label: string) => it(`${label} ${c.kind.toUpperCase()}: ${c.rule}`, () => {
  const v = c.run();
  const t = txt(v);
  for (const r of c.re ?? []) expect(t, String(r)).toMatch(typeof r === "string" ? new RegExp(r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : r);
  for (const r of c.not ?? []) expect(t, String(r)).not.toMatch(typeof r === "string" ? new RegExp(r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : r);
  if (c.priced !== undefined) expect(v.rowPriced, "priced").toBe(c.priced);
  if (c.figures) expect(tot(v)).toEqual(c.figures);
});

describe("VP-1 R-39 -- every Valve Package rule fires from the panel's entry point (positive + negative)", () => { VALVE_CASES.forEach((c) => run(c, "VALVE")); });
describe("VP-1 R-39 -- every Misc rule fires inside a Valve Package row, by Misc's own config (positive + negative)", () => { MISC_CASES.forEach((c) => run(c, "MISC")); });
describe("VP-1 THE GUARD -- the rules this file names EQUAL the rules each config generates", () => {
  const titles = (id: string) => itemListRuleOrder(CFG.get(id)!, ITEMS as never).map((l: { title: string }) => l.title);
  it("Valve Package: named = generated (each with a positive and a negative case)", () => {
    expect([...new Set(VALVE_CASES.map((c) => c.rule))].sort()).toEqual([...titles(VALVE)].sort());
    for (const t of titles(VALVE)) expect(["pos", "neg"].every((k) => VALVE_CASES.some((c) => c.rule === t && c.kind === k)), t).toBe(true);
  });
  it("Misc: named = generated (each with a positive and a negative case)", () => {
    expect([...new Set(MISC_CASES.map((c) => c.rule))].sort()).toEqual([...titles(MISC)].sort());
    for (const t of titles(MISC)) expect(["pos", "neg"].every((k) => MISC_CASES.some((c) => c.rule === t && c.kind === k)), t).toBe(true);
  });
});
