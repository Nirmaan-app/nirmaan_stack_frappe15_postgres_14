/**
 * DU-1 PART B (feature standard v1.1, R-39 / T1 for Ducting; DU-2 adds the v72 lines' cases) -- EVERY DERIVATION-TAB RULE OF DUCTING FIRES FROM THE PANEL'S ENTRY POINT
 * (`makePricingSheetHelper(...).compute`), with the calculator where the rule is a typed one; each rule has a positive and a negative
 * case, on the newest HVAC asset.
 *
 *   THE GUARD: the rules this file names EQUAL the top-level lines `itemListRuleOrder` generates from the Ducting config. A new rule with
 *   no case fails here; a case naming a rule that no longer exists fails too. The lines NESTED under the Insulation and Misc section lines
 *   are those categories' own rules, proven where they live (Insulation's ruleReachability, VP-1's Misc cases, du1MiscUnits).
 */
import { chai, describe, expect, it } from "vitest"; chai.config.truncateThreshold = 0;
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, SCOPE_OVERRIDE_KEY, buildExtractionByRow, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { itemListRuleOrder } from "../../pricing/rate-master/itemListRuleOrder";
import { CFG, ITEMS, LATEST } from "./du1Duct.harness";

const DUCT = "hvac_ducting";
const KINDS = ["supply_rate", "install_rate", "combined_rate"];
type Item = Record<string, string | null> & { _section?: string };
const mi = (a: Item) => {
  const { _section, ...attrs } = a;
  return { ...(_section ? { section: _section } : {}), attributes: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) };
};
/** item 1 of a duct row: its kind, gauge as written, and anything else */
const D = (type: string | null, gauge: string | null, more: Item = {}): Item => ({ duct_type: type, duct_type_as_written: type, gauge_as_written: gauge, insulated: "No", ...more });
const RECT = "Rectangular (GI)", SPIRAL = "Spiral / Oval (GI)", ROUND = "Round (GI) - per metre", PIR = "PIR (Pre Insulated Duct)";
type Opts = { headings?: string[]; ownNotes?: string[]; ov?: Record<string, string>; others?: Array<{ row: number; text: string; items: Item[]; category?: string; unit?: string; heading?: string }>; quantities?: Record<number, number> };
const panel = (items: Item[], unit = "Sqm", text = "duct row", o: Opts = {}): ItemListView => {
  const rows = [{ excel_row: 9, description: text, category_id: DUCT, attributes: {}, items: items.map(mi) },
    ...(o.others ?? []).map((r) => ({ excel_row: r.row, description: r.text, category_id: r.category ?? DUCT, attributes: {}, items: r.items.map(mi) }))];
  const h = makePricingSheetHelper({ configsByCategory: CFG as never, items: ITEMS as never, extractionByRow: buildExtractionByRow(rows as never) });
  const sheet = o.others ? {
    sheetLines: [{ row: 9, text, unit }, ...o.others.map((r) => ({ row: r.row, text: r.text, unit: r.unit ?? unit, ...(r.heading ? { heading: r.heading } : {}) }))],
    sheetCategories: Object.fromEntries([[9, DUCT], ...o.others.map((r) => [r.row, r.category ?? DUCT])]), rowQuantities: o.quantities ?? {},
  } : {};
  return (h.compute({ excelRow: 9, description: text, nodeType: "Line Item", category: DUCT, discipline: "HVAC", rateKinds: KINDS, unit,
    headings: o.headings ?? [], ownNotes: o.ownNotes ?? [], headingNotes: [], ...sheet } as never, o.ov ?? {}) as unknown as ItemListSuggestion).itemList!;
};
const calc = (blocks: unknown[], unit = "sqm", ov: Record<string, string> = {}): ItemListView => {
  const h = makePricingSheetHelper({ configsByCategory: CFG as never, items: ITEMS as never, extractionByRow: new Map() });
  return (h.compute(calculatorCtx("HVAC", DUCT), { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: blocks }), [ROW_UNIT_OVERRIDE_KEY]: unit, ...ov }) as unknown as ItemListSuggestion).itemList!;
};
const txt = (v: ItemListView) => JSON.stringify(v);
const tot = (v: ItemListView) => [v.totals?.supply_rate, v.totals?.install_rate];
/** a row the model read as not a duct ('none of these'), with what it is as written */
const NOT = (asWritten: string): Item => ({ duct_type: "none of these", duct_type_as_written: asWritten, insulated: null });
const INS = (more: Item = {}): Item => ({ _section: "insulation", item: "Thermal Nitrile Insulation", thickness_mm: "9 mm", cladding: "None", ...more });

type Case = { rule: string; kind: "pos" | "neg"; run: () => ItemListView; re?: Array<string | RegExp>; not?: Array<string | RegExp>; priced?: boolean; figures?: [number, number] };
const T = (n: number) => LINES[n - 1];
const cfg = CFG.get(DUCT) as never;
const LINES = itemListRuleOrder(cfg, ITEMS as never, { hvac_insulation: CFG.get("hvac_insulation"), hvac_misc: CFG.get("hvac_misc") } as never).map((l) => l.title);
const title = (re: RegExp) => { const t = LINES.find((l) => re.test(l)); if (!t) throw new Error(`no line ${re}`); return t; };

const R = {
  unit: title(/^The row's unit decides/),
  kind: title(/^The item's own kind decides/),
  msText: title(/^A duct type written as MS/),
  unstocked: title(/^A duct type the catalogue does not stock/),
  asWritten: title(/left unanswered is read from/),
  noMaterial: title(/^A row that names no material/),
  noMatch: title(/^A material the model could not match/),
  noneOfThese: title(/^A 'none of these' answer/),
  ruleForUnit: title(/^That kind's rule for that unit/),
  rowKind: title(/^A row-kind material on the other row kind/),
  needs: title(/^The facts that rule needs/),
  dia: title(/^A diameter is picked/),
  flanges: title(/flanges or TDF joints/),
  extras: title(/access doors, dampers/),
  rDamper: title(/^A row whose words name 'damper'/),
  rPlenum: title(/^A row whose words name 'plenum'/),
  rGrille: title(/^A row whose words name 'grille'/),
  rAtten: title(/^A row whose words name 'attenuator'/),
  rFlex: title(/^A row whose words name 'flexible'/),
  rCanvas: title(/^A row whose words name 'canvas'/),
  rVane: title(/^A row whose words name 'vane'/),
  rIns: title(/^A row whose words name 'insulation'/),
  exBoth: title(/is priced as removal and refixing of existing ducts$/),
  exRefix: title(/is priced as refixing of existing ducts$/),
  exRemoval: title(/is priced as removal of existing ducts$/),
  sheetIns: title(/^On a sheet that quotes duct insulation/),
  dr3: title(/^A gauge written in the BoQ wins/),
  dr12: title(/^Several gauges in one row/),
  dr4: title(/^No gauge in the BoQ/),
  dr2: title(/^A gauge not stocked takes the next THICKER/),
  dr7: title(/^Duct insulation quoted on its own row/),
  g3: title(/^The quantity check beside it/),
  g1: title(/^A borrowed section never reads/),
  dr14: title(/^Removal 0.5 x and refixing/),
  o10: title(/^Installation only follows the Valve rule/),
  fit: title(/^Fitting the stated gauge/),
  steps: title(/^Then the priced steps/),
  converts: title(/^The rate converts to the unit/),
  qty: title(/^Multiplied by how many/),
  insToggle: title(/^Each duct says whether it has insulation/),
  insDefaults: title(/^Insulated Yes with no insulation facts/),
  insRules: title(/^The insulation section is priced by Insulation's rules/),
  insQty: title(/^The insulation section's quantity/),
  misc: title(/^The misc item section is priced/),
  rowTotal: title(/^The row total adds/),
  a3Unit: title(/^A kind not stocked in the row's unit/),
  perMetre: title(/^A per-metre item needs/),
  faceTyped: title(/^The width and height are typed/),
  thirdPart: title(/^A third part of a size/),
  twoPart: title(/^A two-part size on a Width/),
  lot: title(/^A row priced per Lot/),
  scope: title(/^The BoQ scope/),
  pair: title(/^A 'Supply of' row/),
  // DU-2 (v72): the owner's 23:57 row rulings + the DU-1 cert finding a
  aliasNeeds: title(/reads only its/),
  rValve: title(/^A row whose words name 'valve'/),
  rCopper: title(/^A row whose words name 'copper'/),
  rUnit: title(/^A row whose words name 'outdoor unit'/),
  refileDefault: title(/^A row read as none of the kinds/),
  plenumNote: title(/^A duct row naming plenum boxes/),
  noteOrder: title(/^A row read as not a duct refuses with its re-file sentence/),
};

const C: Case[] = [
  // the unit
  { rule: R.unit, kind: "pos", run: () => panel([D(RECT, "24G")], "Sqft"), priced: true, figures: [Math.ceil(1080 * 0.0929), Math.ceil(260 * 0.0929)] },
  { rule: R.unit, kind: "neg", run: () => panel([D(RECT, "24G")], ""), priced: false, re: ["no unit on this row"] },
  // the kind
  { rule: R.kind, kind: "pos", run: () => panel([D(SPIRAL, "24G")]), priced: true, figures: [1240, 280] },
  { rule: R.kind, kind: "neg", run: () => panel([D(RECT, "24G")]), priced: true, figures: [1080, 260] },
  { rule: R.msText, kind: "pos", run: () => panel([D("none of these", "18G", { duct_type_as_written: "MS welded duct" })], "Sqm", "MS welded duct 18G"), priced: true, figures: [3390, 490] },
  { rule: R.msText, kind: "neg", run: () => panel([D(RECT, "18G", { duct_type_as_written: "GI duct" })], "Sqm", "GI duct 18G"), priced: true, figures: [1800, 260] },
  { rule: R.unstocked, kind: "pos", run: () => panel([D("none of these", "22G", { duct_type_as_written: "aluminium duct" })], "Sqm", "aluminium duct 22G"), priced: false, re: ["Aluminium duct is not on our sheet"] },
  { rule: R.unstocked, kind: "neg", run: () => panel([D(RECT, "22G", { duct_type_as_written: "GI duct" })], "Sqm", "GI duct 22G"), priced: true, figures: [1310, 260] },
  { rule: R.asWritten, kind: "pos", run: () => panel([D(null, "24G", { duct_type_as_written: "Spiral / Oval (GI)" })], "Sqm", "spiral duct 24G"), priced: true, figures: [1240, 280] },
  { rule: R.asWritten, kind: "neg", run: () => panel([D(RECT, "24G", { duct_type_as_written: "Spiral / Oval (GI)" })], "Sqm", "duct 24G"), priced: true, figures: [1080, 260] },
  { rule: R.noMaterial, kind: "pos", run: () => panel([D(null, "24G", { duct_type_as_written: null })], "Sqm", "duct 24G"), priced: true, figures: [1080, 260], re: ["shape not stated - priced as rectangular"] },
  { rule: R.noMaterial, kind: "neg", run: () => panel([D(SPIRAL, "24G")], "Sqm", "duct 24G"), not: ["shape not stated"], priced: true },
  { rule: R.noMatch, kind: "pos", run: () => panel([D("none of these", "24G", { duct_type_as_written: "fabric duct" })], "Sqm", "fabric duct 24G"), priced: false },
  { rule: R.noMatch, kind: "neg", run: () => panel([D(RECT, "24G", { duct_type_as_written: "GI duct" })], "Sqm", "GI duct 24G"), priced: true },
  { rule: R.noneOfThese, kind: "pos", run: () => panel([D("none of these", "24G", { duct_type_as_written: null })], "Sqm", "duct 24G"), priced: true, figures: [1080, 260] },
  { rule: R.noneOfThese, kind: "neg", run: () => panel([D("none of these", "24G", { duct_type_as_written: "fabric duct" })], "Sqm", "fabric duct 24G"), priced: false },
  // the rule per unit, and the facts it needs
  { rule: R.ruleForUnit, kind: "pos", run: () => panel([D(ROUND, "24G", { size_as_written: "150 mm dia" })], "Mts", "round duct 150 mm 24G"), priced: true, figures: [670, 130] },
  { rule: R.ruleForUnit, kind: "neg", run: () => panel([D(SPIRAL, "24G")], "Sqm"), priced: true, figures: [1240, 280] },
  { rule: R.rowKind, kind: "pos", run: () => panel([D(null, "24G", { duct_type_as_written: null, size_as_written: "600 x 400" })], "Mts", "duct per metre 24G"), priced: true, re: [/rectangular/i] },
  { rule: R.rowKind, kind: "neg", run: () => panel([D(SPIRAL, "24G", { size_as_written: "150 mm dia" })], "Mts", "spiral per metre"), priced: true, not: ["shape not stated"] },
  { rule: R.needs, kind: "pos", run: () => panel([D(SPIRAL, null)], "Sqm", "spiral duct"), priced: false, re: ["Gauge not stated and no size to read it from"] },
  { rule: R.needs, kind: "neg", run: () => panel([D(SPIRAL, "26G")], "Sqm", "spiral duct"), priced: true, figures: [1080, 280] },
  { rule: R.dia, kind: "pos", run: () => calc([{ base: null, family: ROUND, attrs: { gauge_as_written: "0.6", dia_mm: "150", insulated: "No" }, other: [] }], "mts"), priced: true, figures: [670, 130] },
  { rule: R.dia, kind: "neg", run: () => calc([{ base: null, family: ROUND, attrs: { gauge_as_written: "0.6", insulated: "No" }, other: [] }], "mts"), priced: false },
  // notes and refusals by the row's words
  { rule: R.flanges, kind: "pos", run: () => panel([D(RECT, "24G")], "Sqm", "GI duct 24G with flanges and TDF joints"), priced: true, re: ["Also names flanges / TDF joints"] },
  { rule: R.flanges, kind: "neg", run: () => panel([D(RECT, "24G")], "Sqm", "GI duct 24G"), priced: true, not: ["Also names flanges"] },
  { rule: R.extras, kind: "pos", run: () => panel([D(RECT, "24G")], "Sqm", "GI duct 24G including access doors"), priced: true, re: ["Also names access doors"] },
  { rule: R.extras, kind: "neg", run: () => panel([D(RECT, "24G")], "Sqm", "GI duct 24G"), priced: true, not: ["Also names access doors"] },
  ...([["rDamper", "fire damper"], ["rPlenum", "plenum"], ["rGrille", "supply air grille"], ["rAtten", "sound attenuator"], ["rFlex", "flexible duct"], ["rCanvas", "canvas connection"], ["rVane", "turning vanes"], ["rIns", "duct insulation"]] as const)
    .flatMap(([k, words]): Case[] => [
      { rule: R[k], kind: "pos", run: () => panel([D("none of these", null, { duct_type_as_written: words })], "Sqm", words), priced: false, re: [/re-file this row/] },
      { rule: R[k], kind: "neg", run: () => panel([D(RECT, "24G", { duct_type_as_written: "GI duct" })], "Sqm", "GI duct 24G"), priced: true, not: [/re-file this row/] },
    ]),
  // removal / refixing (DR14)
  { rule: R.exBoth, kind: "pos", run: () => panel([D(RECT, null)], "Sqm", "Removal and refixing of existing GI duct"), priced: true, figures: [0, Math.ceil(260 * 1.5)] },
  { rule: R.exBoth, kind: "neg", run: () => panel([D(RECT, "24G")], "Sqm", "GI duct 24G"), priced: true, figures: [1080, 260] },
  { rule: R.exRefix, kind: "pos", run: () => panel([D(RECT, null)], "Sqm", "Refixing of existing GI duct"), priced: true, figures: [0, 260] },
  { rule: R.exRefix, kind: "neg", run: () => panel([D(RECT, "24G")], "Sqm", "GI duct 24G"), priced: true, figures: [1080, 260] },
  { rule: R.exRemoval, kind: "pos", run: () => panel([D(RECT, null)], "Sqm", "Removal of existing GI duct"), priced: true, figures: [0, 130] },
  { rule: R.exRemoval, kind: "neg", run: () => panel([D(RECT, "24G")], "Sqm", "GI duct 24G"), priced: true, figures: [1080, 260] },
  { rule: R.dr14, kind: "pos", run: () => panel([D(RECT, "18G")], "Sqm", "Removal of existing GI duct 18G"), priced: true, figures: [0, 130], re: [/removal of existing ducts/i] },
  { rule: R.dr14, kind: "neg", run: () => panel([D(RECT, "18G")], "Sqm", "GI duct 18G"), priced: true, figures: [1800, 260] },
  // the sheet's insulation (DR7 / G-3)
  ...([R.sheetIns, R.dr7] as const).flatMap((rule): Case[] => [
    { rule, kind: "pos", run: () => panel([D(SPIRAL, "24G", { insulated: "Yes" }), INS()], "Sqm", "spiral duct 24G with 9 mm insulation",
        { others: [{ row: 40, text: "Thermal insulation of duct 9 mm", category: "hvac_insulation", items: [] }] }), priced: true, figures: [1240, 280],
      re: ["Duct insulation is quoted on its own row on this sheet (rows 40) - not priced in this row."] },
    { rule, kind: "neg", run: () => panel([D(SPIRAL, "24G", { insulated: "Yes" }), INS()], "Sqm", "spiral duct 24G with 9 mm insulation", { others: [] }), priced: true,
      not: ["Duct insulation is quoted on its own row"] },
  ]),
  { rule: R.g3, kind: "pos", run: () => panel([D(SPIRAL, "24G", { insulated: "Yes" }), INS()], "Sqm", "spiral duct 24G with 9 mm insulation",
      { others: [{ row: 40, text: "Thermal insulation of duct 9 mm", category: "hvac_insulation", items: [], heading: "AHU room" }], quantities: { 9: 100, 40: 10 } }),
    priced: true, re: ["cover only about 10% of the insulated duct area"] },
  { rule: R.g3, kind: "neg", run: () => panel([D(SPIRAL, "24G", { insulated: "Yes" }), INS()], "Sqm", "spiral duct 24G with 9 mm insulation",
      { others: [{ row: 40, text: "Thermal insulation of duct 9 mm", category: "hvac_insulation", items: [] }], quantities: { 9: 100, 40: 10 } }),
    priced: true, not: ["cover only about"], figures: [1240, 280] },
  // the gauge (DR3 / DR12 / DR4 / DR2)
  { rule: R.dr3, kind: "pos", run: () => panel([D(RECT, "24G / 1.0 mm")]), priced: true, figures: [1080, 260], re: ["the gauge wins over the 1 mm also written"] },
  { rule: R.dr3, kind: "neg", run: () => panel([D(RECT, "1.0 mm")]), priced: true, figures: [1520, 260], not: ["the gauge wins"] },
  { rule: R.dr12, kind: "pos", run: () => panel([D(RECT, "24G up to 750 mm, 22G 751 to 1500 mm", { size_as_written: "1000 x 500" })]), priced: true, figures: [1310, 260] },
  { rule: R.dr12, kind: "neg", run: () => panel([D(RECT, "24G up to 750 mm, 22G 751 to 1500 mm", { size_as_written: "600 x 300" })]), priced: true, figures: [1080, 260] },
  { rule: R.dr4, kind: "pos", run: () => panel([D(RECT, null, { size_as_written: "1600 x 400" })]), priced: true, figures: [1520, 260], re: ["taken from the standard size table"] },
  { rule: R.dr4, kind: "neg", run: () => panel([D(RECT, null)]), priced: false, re: ["Gauge not stated and no size to read it from"] },
  { rule: R.dr2, kind: "pos", run: () => panel([D(RECT, "28G")]), priced: true, figures: [970, 260], re: ["28G is thinner than the thinnest gauge on the sheet - priced as 26G"] },
  { rule: R.dr2, kind: "neg", run: () => panel([D(RECT, "16G")]), priced: false, re: ["thicker than the thickest gauge on the sheet"] },
  { rule: R.fit, kind: "pos", run: () => panel([D(RECT, "0.7 mm")]), priced: true, figures: [1310, 260] },
  // B4 preview fixes (each found on real rows): 0.83 mm is not 0.8 -> the next thicker (20G, DR3); a round duct per metre with its
  // diameter and no gauge takes the size table (DR4); "20G / 22G" with no band words is no band (DR12); a removal row prices no insulation
  { rule: R.fit, kind: "pos", run: () => panel([D(RECT, "0.83 mm")]), priced: true, figures: [1520, 260] },
  { rule: R.dr4, kind: "pos", run: () => panel([D(ROUND, null, { size_as_written: "150 mm dia" })], "Mts", "round duct 150 mm dia"), priced: true, figures: [670, 130], re: ["taken from the standard size table"] },
  { rule: R.dr12, kind: "neg", run: () => panel([D(RECT, "20G / 22G", { size_as_written: "751 - 1500 mm" })]), priced: false, re: ["none matches its size band"] },
  { rule: R.dr14, kind: "pos", run: () => panel([D(RECT, null, { insulated: "Yes" }), INS()], "Sqm", "Removal of existing rect duct with insulation"), priced: true, figures: [0, 130],
    re: ["the insulation is not priced"] },
  { rule: R.fit, kind: "neg", run: () => panel([D(RECT, "0.8 mm")]), priced: true, figures: [1310, 260], not: ["next thicker"] },
  { rule: R.g1, kind: "pos", run: () => panel([D(SPIRAL, "24G", { insulated: "Yes" }), INS()], "Sqm", "GI spiral duct 24G with 9 mm thermal insulation"), priced: true },
  { rule: R.g1, kind: "neg", run: () => panel([D(SPIRAL, "24G", { insulated: "No" })], "Sqm", "GI spiral duct 24G"), priced: true, figures: [1240, 280] },
  // scope (O10) and the pair rule
  { rule: R.o10, kind: "pos", run: () => panel([D(RECT, "24G", { scope: "Installation only" })], "Sqm", "Installation of GI duct 24G",
      { others: [{ row: 12, text: "Supply of GI duct 24G", items: [D(RECT, "24G", { scope: "Supply only" })] }] }), priced: true, figures: [0, 260], re: ["Ducting installation-only uplift"] },
  { rule: R.o10, kind: "neg", run: () => panel([D(RECT, "24G")], "Sqm", "GI duct 24G"), priced: true, figures: [1080, 260] },
  { rule: R.scope, kind: "pos", run: () => panel([D(RECT, "24G")], "Sqm", "GI duct 24G", { ov: { [SCOPE_OVERRIDE_KEY]: "Supply only" } }), priced: true, figures: [1080, 0] },
  { rule: R.scope, kind: "neg", run: () => panel([D(RECT, "24G")], "Sqm", "GI duct 24G"), priced: true, figures: [1080, 260] },
  { rule: R.pair, kind: "pos", run: () => panel([D(RECT, "24G")], "Sqm", "Supply of GI duct 24G",
      { others: [{ row: 12, text: "Installation of GI duct 24G", items: [D(RECT, "24G", { scope: "Installation only" })] }] }), priced: true, figures: [1080, 0],
    re: ["Installation is quoted on its own row on this sheet, so priced supply only here"] },
  { rule: R.pair, kind: "neg", run: () => panel([D(RECT, "24G")], "Sqm", "Supply of GI duct 24G", { others: [] }), priced: true, not: ["Installation is quoted on its own row"] },
  // steps, conversion, quantity
  { rule: R.steps, kind: "pos", run: () => panel([D(RECT, "24G")]), priced: true, re: ["ROUNDUP to tens, as the sheet"] },
  { rule: R.steps, kind: "neg", run: () => panel([D(RECT, "24G")], "Set"), priced: false, not: ["ROUNDUP to tens"] },
  { rule: R.converts, kind: "pos", run: () => panel([D(SPIRAL, "24G")], "Sq.ft"), priced: true, figures: [Math.ceil(1240 * 0.0929), Math.ceil(280 * 0.0929)], re: ["x 0.0929"] },
  { rule: R.converts, kind: "neg", run: () => panel([D(SPIRAL, "24G")], "Sqm"), priced: true, figures: [1240, 280], not: ["x 0.0929"] },
  { rule: R.qty, kind: "pos", run: () => calc([{ base: null, family: RECT, attrs: { gauge_as_written: "0.6", insulated: "No" }, other: [], qty: "2" }]), priced: true, figures: [2160, 520], re: ["x 2 per row unit"] },
  { rule: R.qty, kind: "neg", run: () => calc([{ base: null, family: RECT, attrs: { gauge_as_written: "0.6", insulated: "No" }, other: [] }]), priced: true, figures: [1080, 260], not: ["per row unit"] },
  // the insulation section
  { rule: R.insToggle, kind: "pos", run: () => panel([D(SPIRAL, "24G", { insulated: "Yes" }), INS()]), priced: true, re: ["Insulation - priced by"] },
  { rule: R.insToggle, kind: "neg", run: () => panel([D(SPIRAL, "24G", { insulated: "No" })]), priced: true, not: ["Insulation - priced by"], figures: [1240, 280] },
  { rule: R.insDefaults, kind: "pos", run: () => panel([D(SPIRAL, "24G", { insulated: "Yes" })]), priced: true, re: ["Insulation - priced by"] },
  { rule: R.insDefaults, kind: "neg", run: () => calc([{ base: null, family: SPIRAL, attrs: { gauge_as_written: "0.6", insulated: "Yes" }, other: [] }]), priced: false, re: ["Choose the insulation material"] },
  { rule: R.insRules, kind: "pos", run: () => panel([D(SPIRAL, "24G", { insulated: "Yes" }), INS({ thickness_mm: "13 mm" })]), priced: true, figures: [1240 + 464, 280 + 154] },
  { rule: R.insRules, kind: "neg", run: () => panel([D(SPIRAL, "24G", { insulated: "Yes" }), INS({ thickness_mm: "9 mm" })]), priced: true, figures: [1240 + 383, 280 + 154] },
  { rule: R.insQty, kind: "pos", run: () => calc([{ base: null, family: SPIRAL, attrs: { gauge_as_written: "0.6", insulated: "Yes" }, other: [], qty: "2",
      sections: { insulation: { base: null, family: "Thermal Nitrile Insulation", attrs: { thickness_mm: "9", cladding: "None" } } } }]), priced: true, figures: [2 * (1240 + 383), 2 * (280 + 154)] },
  { rule: R.insQty, kind: "neg", run: () => calc([{ base: null, family: SPIRAL, attrs: { gauge_as_written: "0.6", insulated: "Yes" }, other: [],
      sections: { insulation: { base: null, family: "Thermal Nitrile Insulation", attrs: { thickness_mm: "9", cladding: "None" } } } }]), priced: true, figures: [1240 + 383, 280 + 154] },
  // the misc section, the row total
  { rule: R.misc, kind: "pos", run: () => panel([{ _section: "misc", item: "Paint", item_as_written: "Painting" }], "Sqm", "Painting of ducts"), priced: true, figures: [196, 140] },
  { rule: R.misc, kind: "neg", run: () => panel([{ _section: "misc", item: "Paint", item_as_written: "Painting" }], "Rmt", "Painting of ducts"), priced: false },
  { rule: R.rowTotal, kind: "pos", run: () => panel([D(SPIRAL, "24G", { insulated: "Yes" }), INS()]), priced: true, figures: [1240 + 383, 280 + 154] },
  { rule: R.rowTotal, kind: "neg", run: () => panel([D(SPIRAL, "24G", { insulated: "Yes" }), INS(), D(RECT, "16G")]), priced: false },
  // units not stocked; per-metre facts; the face
  { rule: R.a3Unit, kind: "pos", run: () => panel([D(PIR, "30 mm")], "CFM", "PIR duct"), priced: false, re: [/is not stocked per/] },
  { rule: R.a3Unit, kind: "neg", run: () => panel([D(PIR, "30 mm")], "Sqm", "PIR duct"), priced: true, figures: [1560, 340] },
  { rule: R.perMetre, kind: "pos", run: () => panel([D(SPIRAL, "24G")], "Mts", "spiral duct per metre"), priced: false, re: ["Width / major axis and Height / minor axis not stated - price this row by hand"] },
  { rule: R.perMetre, kind: "neg", run: () => panel([D(SPIRAL, "24G", { size_as_written: "150 mm dia" })], "Mts", "spiral duct per metre"), priced: true, figures: [670, 130] },
  { rule: R.faceTyped, kind: "pos", run: () => panel([D(RECT, "24G", { size_as_written: "600 x 400" })], "Mts", "GI duct per metre"), priced: true, re: ["width 600", "height 400"] },
  { rule: R.faceTyped, kind: "neg", run: () => panel([D(RECT, "24G", { size_as_written: "600 x 400" })], "Sqm", "GI duct"), priced: true, figures: [1080, 260], not: ["width 600"] },
  { rule: R.thirdPart, kind: "pos", run: () => panel([D(RECT, "24G", { size_as_written: "300 x 300 x 450 mm Height" })], "Mts", "GI duct per metre"), priced: true, re: ["width 300"] },
  { rule: R.thirdPart, kind: "neg", run: () => panel([D(RECT, "24G", { size_as_written: "300 x 300" })], "Mts", "GI duct per metre"), priced: true, not: ["450"] },
  { rule: R.twoPart, kind: "pos", run: () => panel([D(RECT, "24G", { size_as_written: "600 x 400 mm High" })], "Mts", "GI duct per metre"), priced: true, re: ["height 400"] },
  { rule: R.twoPart, kind: "neg", run: () => panel([D(RECT, "24G", { size_as_written: "600 mm" })], "Mts", "GI duct per metre"), priced: false },
  { rule: R.lot, kind: "pos", run: () => panel([D(RECT, "24G")], "Lot", "GI ducting complete"), priced: false, re: [/WHOLE LOT/i] },
  { rule: R.lot, kind: "neg", run: () => panel([D(RECT, "24G")], "Sqm", "GI ducting"), priced: true, not: [/WHOLE LOT/i] },
  // DU-2 (v72) -- finding a: the round alias reads its gauge and diameter only
  { rule: R.aliasNeeds, kind: "pos", run: () => panel([D(ROUND, "24G", { size_as_written: "600 x 400" })], "Rmt", "round duct per metre"), priced: false, not: ["width 600"] },
  { rule: R.aliasNeeds, kind: "neg", run: () => panel([D(ROUND, "24G", { size_as_written: "150 mm dia" })], "Rmt", "round duct per metre"), priced: true, figures: [670, 130] },
  // R-NOTE-ORDER: the re-file entries, the default sentence, and the order before the unit check
  { rule: R.rValve, kind: "pos", run: () => panel([NOT("Butterfly valves-100 mm NB")], "Nos", "Butterfly valves-100 mm NB"), priced: false, re: ["re-file this row under Valve Package"] },
  { rule: R.rValve, kind: "neg", run: () => panel([NOT("Volume control damper")], "Sqm", "VCD"), priced: false, not: ["re-file this row under Valve Package"], re: ["Reads as a damper"] },
  { rule: R.rCopper, kind: "pos", run: () => panel([NOT("34.9 mm dia (hard drawn) copper pipe with 19 mm thick insulation")], "Rmt", "34.9 mm dia (hard drawn)"), priced: false, re: ["re-file this row under Piping"], not: ["re-file this row under Insulation"] },
  { rule: R.rCopper, kind: "neg", run: () => panel([NOT("Thermal insulation of ducts")], "Sqm", "duct insulation"), priced: false, re: ["re-file this row under Insulation"], not: ["Piping"] },
  { rule: R.rUnit, kind: "pos", run: () => panel([NOT("4 HP-side discharge outdoor unit")], "Nos", "4 HP-side discharge outdoor unit"), priced: false, re: ["re-file this row under VRF"] },
  { rule: R.rUnit, kind: "neg", run: () => panel([NOT("Plenum box")], "Sqm", "plenum box"), priced: false, not: ["re-file this row under VRF"], re: ["Reads as a plenum"] },
  { rule: R.refileDefault, kind: "pos", run: () => panel([NOT("Electronic Thermostat")], "Lot", "Electronic Thermostat BMS compatible"), priced: false, re: ["Reads as 'Electronic Thermostat', not a duct - re-file this row under its own category"] },
  { rule: R.refileDefault, kind: "neg", run: () => panel([NOT("Volume control damper")], "Sqm", "VCD"), priced: false, not: ["under its own category"] },
  { rule: R.noteOrder, kind: "pos", run: () => panel([NOT("2.0 TR cassette unit")], "Nos", "2.0 TR cassette unit"), priced: false, re: ["re-file this row under VRF"], not: ["is not a duct unit", /WHOLE LOT/i] },
  { rule: R.noteOrder, kind: "neg", run: () => panel([D(RECT, "24G")], "Nos", "GI duct"), priced: false, re: ["is not a duct unit", /WHOLE LOT/i] },
  // R-DUCT (Q6 / QR-1 Q2 (a)): a duct row naming plenum boxes / attenuators prices the duct with the note
  { rule: R.plenumNote, kind: "pos", run: () => panel([D(RECT, "24G")], "Sqm", "GI duct connected to plenum boxes and cross talk attenuators"), priced: true, figures: [1080, 260], re: ["Also names plenum boxes / attenuators / silencers / flexible duct"] },
  { rule: R.plenumNote, kind: "neg", run: () => panel([D(RECT, "24G")], "Sqm", "GI duct"), priced: true, figures: [1080, 260], not: ["Also names plenum boxes"] },
];

describe(`DU-1 Ducting rule reachability on ${LATEST}: every Derivation line fires, positive and negative`, () => {
  it("THE GUARD: the cases name exactly the tab's top-level lines (each with a positive and a negative case)", () => {
    const named = [...new Set(C.map((c) => c.rule))].sort();
    expect(named).toEqual([...new Set(LINES)].sort());
    for (const r of named) expect(C.filter((c) => c.rule === r).map((c) => c.kind).sort(), r).toEqual(expect.arrayContaining(["neg", "pos"]));
    expect(T(1)).toBe(R.unit);
  });
  C.forEach((c, i) => {
    it(`${c.kind} #${i}: ${c.rule.slice(0, 110)}`, () => {
      const v = c.run();
      const s = txt(v);
      if (c.priced !== undefined) expect(v.rowPriced, `${v.reason ?? ""}`).toBe(c.priced);
      if (c.figures) expect(tot(v)).toEqual(c.figures);
      for (const r of c.re ?? []) expect(s).toMatch(typeof r === "string" ? new RegExp(r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : r);
      for (const r of c.not ?? []) expect(s).not.toMatch(typeof r === "string" ? new RegExp(r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : r);
    });
  });
});
