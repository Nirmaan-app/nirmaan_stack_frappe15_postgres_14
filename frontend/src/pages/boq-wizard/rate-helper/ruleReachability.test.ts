/**
 * SLICE 12d-8 / T1 + T3 (owner standing rules 1 and 3, approved 2026-10-08; built in 12d-7 Phase 1, made
 * permanent here) -- EVERY RULE FIRES FROM THE PANEL'S ENTRY POINT.
 *
 * 12d-6 found a rule (the double-layer reader) that worked in the inner pricer and in its tests and never
 * fired on the panel, because an EARLIER step on the path (option matching) rewrote the wording first. So:
 *
 *   T1  one named case per Derivation-tab rule of Insulation and ADP -- model-read, typed where a control
 *       exists, and its negative -- run through `makePricingSheetHelper(...).compute` on the LIVE asset
 *       (v33 at 12d-8; v36 since 12e-2, which adds the Piping rules P1-P5 -- read at runtime). PASS = the rule's OWN line / note / refusal appears AND the figure equals the
 *       pure pricer's over the same assembled inputs. EXCLUDED = an owner ruling forbids it on that path
 *       (T6 / U4 for a typed layered or slash thickness; R4 for a cladding the family does not offer).
 *
 *   THE GUARD: the set of rules this file names must EQUAL the set `itemListRuleOrder` generates from the
 *   config at runtime. A new rule with no case fails the suite; a case naming a rule that no longer exists
 *   fails it too. Two tab lines are declared NOT panel-path rules by name (the derived catalogue cells) and
 *   are checked to exist.
 *
 *   T3  the rewriter x rule matrix (12d-7 S4) kept as tests, with the 12d-7 findings F-1 / F-2 / F-3 as
 *       regression pins.
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { itemListRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, assembleItems, decodeItemEdits, makePricingSheetHelper,
  type ItemListSuggestion,
} from "./pricingSheetHelper";
import { familyAttr, itemListPricingSpec, priceItemList } from "./itemListPricing";

const ASSET = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
  new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v37.json", import.meta.url),   // 12e-2: v33 -> v36 (Insulation and ADP carried byte-equal; Piping gains its rules); 12e-3b: v36 -> v37 (Piping gains its insulation section; Insulation and ADP byte-equal)
);
const CFG: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET.category_configs.map((c) => [c.category_id, c]));
const CONFIGS = new Map<string, RateCategoryConfig>(Object.entries(CFG));
const ITEMS: RateMasterItem[] = ASSET.items.map((it) => ({ ...it, discipline: ASSET.discipline } as RateMasterItem));
const INS = "hvac_insulation";
const ADP = "hvac_adp";
const PIP = "hvac_piping";   // 12e-2
// 12e-3b: the v36 Piping config, for the "the 14 lines before the section's are unchanged" pin only
const V36_PIPING = readJsonFixture<{ category_configs: RateCategoryConfig[] }>(
  new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v36.json", import.meta.url),
).category_configs.find((c) => c.category_id === "hvac_piping")!;

// ── the cases ───────────────────────────────────────────────────────────────────────────────────────
type Edit = { base: number | null; family: string | null; attrs: Record<string, string>; other?: string[]; qty?: string };
interface Case {
  id: string;
  /** the Derivation-tab line this case fires -- its exact generated TITLE (the guard matches on it) */
  rule: string;
  cat: string;
  path: "panel" | "calc" | "ptyped";
  kind: "pos" | "neg" | "excluded";
  excludedBy?: string;
  unit?: string;                              // the row's unit (panel); undefined => pickable
  rowUnit?: string;                           // the calculator's unit pick
  model?: Array<Record<string, string>>;      // the stored extraction's items (panel / ptyped)
  edits?: Edit[];                             // session edits (calc / ptyped)
  description?: string; headings?: string[]; ownNotes?: string[];
  /** the rule's OWN line(s): every regex must appear in the panel's lines; none of `not` may */
  re: Array<string | RegExp>; not?: Array<string | RegExp>;
  /** lines that must appear in a block's WORKING -- the pricer's own output, never a display note (F-2: the reader's line must reach the pricer) */
  working?: Array<string | RegExp>;
  priced?: boolean;
  /** compare the panel's figures to the pure pricer's over the same assembled inputs (default true) */
  pure?: boolean;
}
const NR = "Nitrile Rubber Insulation", PUF = "Tubular Puf Insulation", THM = "Thermal Nitrile Insulation",
  ACO = "Acoustic Nitrile Insulation", FGB = " Fiberglass Rigid Board Insulation, Density 48Kg/m3", CLO = "Cladding Only";
const NIT = { item: NR, cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" };
const PUFI = { item: PUF, cladding: "No", thickness_mm: "25", pipe_size_mm: "100" };
const THMI = { item: THM, cladding: "No", thickness_mm: "19" };
const m = (base: Record<string, string>, over: Record<string, string | undefined>): Record<string, string> => {
  const d: Record<string, string> = { ...base };
  for (const [k, v] of Object.entries(over)) { if (v === undefined) delete d[k]; else d[k] = v; }
  return d;
};
const calc = (family: string, attrs: Record<string, string>, other: string[] = [], qty?: string): Edit[] => [{ base: null, family, attrs, other, ...(qty !== undefined ? { qty } : {}) }];
const ptyped = (attrs: Record<string, string>, other: string[] = [], qty?: string): Edit[] => [{ base: 0, family: null, attrs, other, ...(qty !== undefined ? { qty } : {}) }];
// 12e-2: a pipe type TYPED through the family field's "Other..." box (the family id rides in `other`, as a size field's does)
const typedType = (text: string, attrs: Record<string, string>, other: string[] = []): Edit[] => [{ base: null, family: text, attrs, other: ["pipe_type", ...other] }];
const MS50 = { pipe_type: "MS", size_mm: "50" };
const INCH = '"';

// the exact TITLES `itemListRuleOrder` generates (verified by the guard below; a typo here fails the suite)
const T = {
  unit: "The row's unit decides which kind of rate applies",
  kind: "The item's own kind decides which products can price it",
  famNone: "A row that names no material takes the kind its row implies",
  noSku: "A material the model could not match to any kind refuses",
  unstocked: "A material the catalogue does not stock refuses by name, whatever kind was picked",
  ruleForUnit: "That kind's rule for that unit",
  notOffered: "A kind the catalogue does not price in the row's unit",
  needs: "The facts that rule needs before it can price",
  layers: "A thickness the model writes as layers is priced as those layers",
  several: "Several thickness values stated take the highest",
  inches: "A pipe size written in inches is converted to millimetres",
  defaults: "A fact the row does not mention takes its ruled value",
  override: "A ruling that replaces a value the row DID state",
  foilPipe: "Aluminium Foil as the cladding on Nitrile Rubber Insulation, Tubular Puf Insulation is priced as 26G Aluminium",
  foilAco: "Aluminium Foil as the cladding on Acoustic Nitrile Insulation refuses",
  glassSheet: "Glass Cloth as the cladding on a per-sq.m row of Thermal Nitrile Insulation, Acoustic Nitrile Insulation, Fiberglass Rigid Board Insulation, Density 48Kg/m3 refuses",
  namedInRow: "A cladding named in the row's own text but read as not mentioned refuses",
  readNotes: "A Fiberglass Rigid Board Insulation, Density 48Kg/m3 row stating its own figure in the insulation material as written carries a line saying what was priced",
  outer: "A stated outer size is matched beside the neck size on square diffuser",
  fitPipe: "Fitting the stated pipe size to the catalogue",
  fitThk: "Fitting the stated thickness to the catalogue",
  fitDia: "Fitting the stated diameter to the catalogue",
  fitNeck: "Fitting the stated neck size to the catalogue",
  fitTorque: "Fitting the stated torque to the catalogue",
  fitRatio: "Fitting the stated panel ratio to the catalogue",
  fitPlenum: "Fitting the stated plenum thickness to the catalogue",
  steps: "Then the priced steps below, in their own order",
  crossRow: "A rate read live from another catalogue row",
  computed: "A cost the rules compute from the Pricing Inputs and the row's own geometry is shown greyed, never typed",
  derived: "A catalogue cell derived from another row's cell follows its base",
  convert: "The rate converts to the unit the row is written in",
  qty: "Multiplied by how many of the item one unit of the row pays for",
  // ── SLICE 12e-2: the Piping rules P1-P5 (the shared titles above cover P4 unit / P5 steps / the needs / qty) ──
  pipeMap: "A pipe type written as GI, uPVC, HDPE is priced as the kind it means",
  // ── SLICE 12e-3b (AC6): the delegated section's lines on Piping, generated from the v37 config ──
  secToggle: "Each pipe says whether it has insulation: Insulated Yes opens the insulation section under that pipe",
  secRules: "The insulation section is priced by Insulation's rules",
  secMirror: "The insulation section takes the pipe size its pipe priced as",
  secTotal: "The row total adds every pipe and every section",
  // ── SLICE 12e-3c (owner F10, U6): the section's quantity follows its pipe ──
  secQty: "The insulation section's quantity is its pipe's until the pricer types their own",
  pipeRefuse: "A pipe type the catalogue does not stock refuses by name",
  pipeRow: "A row naming one pipe type prices as it; two different ones with none chosen refuse",
  typedSize: "A typed pipe size is one size, in mm or inches",
  readClass: "A Copper, MS and 2 more row stating its own figure in the class / wall thickness carries a line saying what was priced",
};
/** Tab lines that are NOT panel-path rules (a catalogue / rate-master rule the pricer never reads), by name. */
const NOT_PANEL_RULES: Record<string, string> = {
  [T.derived]: "config.derived_rates is consumed by csv_exporter / the loader / RateMasterDataViewer, never by priceItemList",
};

const CASES: Case[] = [
  // ── INSULATION ──────────────────────────────────────────────────────────────────────────────────
  { id: "I1a", rule: T.unit, cat: INS, path: "panel", kind: "pos", unit: "sqft", model: [THMI], re: ["per sq.ft: sq.m rate x 0.0929"], priced: true },
  { id: "I1a-calc", rule: T.unit, cat: INS, path: "calc", kind: "pos", edits: calc(THM, { cladding: "No", thickness_mm: "19" }), rowUnit: "sqft", re: ["per sq.ft: sq.m rate x 0.0929"], priced: true },
  { id: "I1b", rule: T.unit, cat: INS, path: "panel", kind: "pos", unit: "", model: [NIT], re: ["No unit on the BoQ row -> priced per metre"], priced: true },
  { id: "I1c", rule: T.unit, cat: INS, path: "panel", kind: "pos", unit: "R/O", model: [NIT], re: ["BoQ says R/O (rate only) -> priced per metre"], priced: true },
  { id: "I1d", rule: T.unit, cat: INS, path: "panel", kind: "pos", unit: "QRO - Sqm.", model: [THMI], re: ["BoQ says QRO - Sqm. (rate only) -> priced per sq.m"], priced: true },
  { id: "I1e", rule: T.unit, cat: INS, path: "panel", kind: "pos", unit: "", model: [{ item: CLO, cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" }], re: ["No unit on the BoQ row - this item is priced per metre or per sq.m; set the unit"], priced: false },
  { id: "I1f-neg", rule: T.unit, cat: INS, path: "panel", kind: "neg", unit: "nos", model: [NIT], re: ["unit 'nos' is not a count, area or length unit"], priced: false },
  { id: "I2a", rule: T.kind, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [NIT], re: [], priced: true },
  { id: "I2b-neg", rule: T.kind, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { item: "Foo Insulation" })], re: ["no SKU in the catalogue for 'Foo Insulation' -- the user decides"], priced: false },
  { id: "I3a", rule: T.famNone, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { item: "None" })], re: ["item not mentioned -> Nitrile Rubber Insulation ("], priced: true },
  { id: "I3b", rule: T.famNone, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [m(THMI, { item: "None" })], re: ["item not mentioned -> Thermal Nitrile Insulation ("], priced: true },
  { id: "I3c", rule: T.famNone, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [m(THMI, { item: "None" })], headings: ["Acoustic lining of AHU room"], re: ["item not mentioned -> Acoustic Nitrile Insulation ("], priced: true },
  { id: "I3c-neg", rule: T.famNone, cat: INS, path: "panel", kind: "neg", unit: "sqm", model: [THMI], headings: ["Acoustic lining"], re: ["family:Thermal Nitrile Insulation"], not: ["not mentioned ->"], priced: true },
  { id: "I3a-calc", rule: T.famNone, cat: INS, path: "calc", kind: "pos", edits: [{ base: null, family: null, attrs: { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" }, other: ["pipe_size_mm"] }], rowUnit: "mts", re: ["item not mentioned -> Nitrile Rubber Insulation ("] },
  { id: "I4a", rule: T.noSku, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { item: "none of these", material_as_written: "XLPE foam" })], re: ["No SKU in the catalogue for XLPE foam - price this row by hand"], priced: false },
  { id: "I4b-neg", rule: T.noSku, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { item: "none of these" })], re: ["no SKU in the catalogue for 'none of these' -- the user decides"], not: ["price this row by hand"], priced: false },
  { id: "I5a", rule: T.unstocked, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { material_as_written: "EPDM closed cell" })], re: ["No SKU in the catalogue for EPDM closed cell - price this row by hand"], priced: false },
  { id: "I5b", rule: T.unstocked, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [NIT], ownNotes: ["Rockwool as per spec"], re: ["No SKU in the catalogue for ROCKWOOL - price this row by hand"], priced: false },
  { id: "I5c-neg", rule: T.unstocked, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [NIT], headings: ["Rockwool section"], re: [], not: ["No SKU in the catalogue"], priced: true },
  { id: "I6a", rule: T.ruleForUnit, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [NIT], re: ["no SKU per sq.m for Nitrile Rubber Insulation"], priced: false },
  { id: "I6b-neg", rule: T.ruleForUnit, cat: INS, path: "panel", kind: "neg", unit: "sqm", model: [{ item: CLO, cladding: "26G Aluminium" }], re: [], not: ["no SKU per"], priced: true },
  { id: "I7a", rule: T.needs, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: undefined })], re: ["no pipe size stated"], priced: false },
  { id: "I7b-neg", rule: T.needs, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [NIT], re: [], not: [/no (pipe size|thickness|cladding) stated/], priced: true },
  { id: "I7a-calc", rule: T.needs, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19" }), rowUnit: "mts", re: ["no pipe size stated"], priced: false },
  { id: "I8a", rule: T.layers, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { thickness_mm: "Double layer of 19mm thick" })], re: ["priced as two layers, 19 + 19 mm (38 mm); cladding on the outer layer only", "Layer 1 of 2", "Layer 2 of 2"], priced: true },
  { id: "I8b", rule: T.layers, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { thickness_mm: "13 + 19 mm" })], re: ["priced as two layers, 13 + 19 mm (32 mm)"], priced: true },
  { id: "I8c", rule: T.layers, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(PUFI, { thickness_mm: "25 mm - 2 Layers" })], re: ["priced as two layers, 25 + 25 mm (50 mm)"], priced: true },
  { id: "I8e-neg", rule: T.layers, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { thickness_mm: "19 mm" })], re: [], not: ["priced as two layers", "Layer 1 of"], priced: true },
  { id: "I8x-calc", rule: T.layers, cat: INS, path: "calc", kind: "excluded", excludedBy: "T6 (12d-1b) + U4 (12d-6): a typed thickness is never parsed as layers; a non-number typed thickness refuses", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "Double layer of 19 mm", pipe_size_mm: "50" }, ["thickness_mm", "pipe_size_mm"]), rowUnit: "mts", re: ["Type the thickness as a single number in mm"], priced: false },
  { id: "I8x-ptyped", rule: T.layers, cat: INS, path: "ptyped", kind: "excluded", excludedBy: "T6 + U4", unit: "RMT", model: [NIT], edits: ptyped({ thickness_mm: "Double layer of 19 mm" }, ["thickness_mm"]), re: ["Type the thickness as a single number in mm"], priced: false },
  { id: "I9a", rule: T.several, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { thickness_mm: "13 / 19 / 25" })], re: ["states several values -- the highest, 25, is taken", "BoQ says 13 / 19 / 25 -> 25 mm (states several values -- the highest, 25, is taken)"], not: ["own spelling"], priced: true },
  { id: "I9b-neg", rule: T.several, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { thickness_mm: "13, 19, 25" })], re: ["several values stated for thickness"], priced: false },
  { id: "I9c-neg", rule: T.several, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { thickness_mm: "25 +/- 2" })], re: ["several values stated for thickness"], priced: false },
  { id: "I9d", rule: T.several, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(PUFI, { thickness_mm: "25 to 50" })], re: ["range '25 to 50' -> its top value 50", "BoQ says 25 to 50 -> 50 mm (range"], priced: true },
  { id: "I9x-calc", rule: T.several, cat: INS, path: "calc", kind: "excluded", excludedBy: "U4", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "13 / 19 / 25", pipe_size_mm: "50" }, ["thickness_mm", "pipe_size_mm"]), rowUnit: "mts", re: ["Type the thickness as a single number in mm"], priced: false },
  { id: "I10a", rule: T.inches, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: '5/8"' })], re: ["15.88"], priced: true },
  { id: "I10b", rule: T.inches, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: '1-1/4"' })], re: ["31.75", "34.93"], priced: true },
  { id: "I10u", rule: T.inches, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "1¼\"" })], re: ["31.75", "34.93"], priced: true },
  { id: "I10b-calc", rule: T.inches, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: '1-1/4"' }, ["pipe_size_mm"]), rowUnit: "mts", re: ["31.75", "34.93"], priced: true },
  { id: "I10c-neg", rule: T.inches, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { thickness_mm: '3/4"' })], re: ["thickness stated in inches"], priced: false },
  { id: "I11a", rule: T.defaults, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { cladding: "None" })], re: ["cladding not mentioned -> No ("], priced: true },
  { id: "I11b", rule: T.defaults, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { thickness_mm: undefined })], re: ["thickness not mentioned -> 9 (" /* 12e-3c (F7): BEFORE "thickness_mm not mentioned -> 9 (" */, "thickness 9 is not on the sheet -> 13"], not: ["thickness_mm not mentioned"], priced: true },
  { id: "I11c-neg", rule: T.defaults, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { thickness_mm: "as per specification" })], re: ["no number in 'as per specification' for thickness"], not: ["not mentioned -> 9"], priced: false },
  { id: "I11a-calc", rule: T.defaults, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "None", thickness_mm: "19", pipe_size_mm: "50" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["cladding not mentioned -> No ("], priced: true },
  { id: "I11b-calc", rule: T.defaults, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", pipe_size_mm: "50" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["thickness not mentioned -> 9 (" /* 12e-3c (F7): BEFORE "thickness_mm not mentioned -> 9 (" */], not: ["thickness_mm not mentioned"], priced: true },
  { id: "I12a", rule: T.foilPipe, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { cladding: "Aluminium Foil" })], re: ["foil on a pipe is priced as 26G cladding"], priced: true },
  { id: "I12a-calc", rule: T.foilPipe, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "Aluminium Foil", thickness_mm: "19", pipe_size_mm: "50" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["foil on a pipe is priced as 26G cladding"], not: ["not stocked with the other answers"], priced: true },
  { id: "I12b-neg", rule: T.foilPipe, cat: INS, path: "panel", kind: "neg", unit: "sqm", model: [m(THMI, { cladding: "Aluminium Foil" })], re: [], not: ["foil on a pipe"], priced: true },
  { id: "I13a", rule: T.foilAco, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [{ item: ACO, cladding: "Aluminium Foil", thickness_mm: "19" }], re: ["foil on an acoustic row"], priced: false },
  { id: "I13a-calc", rule: T.foilAco, cat: INS, path: "calc", kind: "excluded", excludedBy: "not offered by design - owner R4, 2026-10-09", edits: calc(ACO, { cladding: "Aluminium Foil", thickness_mm: "19" }), rowUnit: "sqm", re: ["Aluminium Foil is not stocked with the other answers on this item -- choose again", "choose again: cladding"], not: ["foil on a pipe"], priced: false, pure: false },
  { id: "I13b-neg", rule: T.foilAco, cat: INS, path: "panel", kind: "neg", unit: "sqm", model: [{ item: ACO, cladding: "No", thickness_mm: "19" }], re: [], not: ["foil on an acoustic row"], priced: true },
  { id: "I14a", rule: T.glassSheet, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [m(THMI, { cladding: "Glass Cloth with paint" })], re: ["glass cloth is not offered on sheet insulation"], priced: false },
  { id: "I14b", rule: T.glassSheet, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [m(THMI, { cladding: "None" })], description: "Thermal insulation with glass cloth finish", re: ["glass cloth is not offered on sheet insulation"], priced: false },
  { id: "I14c-neg", rule: T.glassSheet, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { cladding: "Glass Cloth with paint" })], re: [], not: ["glass cloth is not offered"], priced: true },
  { id: "I14d-neg", rule: T.glassSheet, cat: INS, path: "panel", kind: "neg", unit: "sqm", model: [m(THMI, { cladding: "None" })], headings: ["Glass cloth finish section"], re: [], not: ["glass cloth is not offered"], priced: true },
  { id: "I14a-calc", rule: T.glassSheet, cat: INS, path: "calc", kind: "excluded", excludedBy: "not offered by design - owner R4, 2026-10-09", edits: calc(THM, { cladding: "Glass Cloth with paint", thickness_mm: "19" }), rowUnit: "sqm", re: ["Glass Cloth with paint is not stocked with the other answers on this item -- choose again"], priced: false, pure: false },
  { id: "I15a", rule: T.namedInRow, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { cladding: "None" })], description: "Nitrile insulation with 26G aluminium cladding", re: ["cladding named in this row but not read - set the cladding"], priced: false },
  { id: "I15b-neg", rule: T.namedInRow, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { cladding: "None" })], headings: ["Aluminium cladding section"], re: ["cladding not mentioned -> No ("], not: ["cladding named in this row"], priced: true },
  { id: "I15c-neg", rule: T.namedInRow, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [NIT], description: "with 26G aluminium cladding", re: [], not: ["cladding named in this row"], priced: true },
  { id: "I16a", rule: T.readNotes, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [{ item: FGB, cladding: "No", thickness_mm: "25", material_as_written: "Fiberglass rigid board 32 kg/m3" }], re: ["BoQ says 32 kg/m3 -> priced as the 48 kg/m3 board"], priced: true },
  { id: "I16b-neg", rule: T.readNotes, cat: INS, path: "panel", kind: "neg", unit: "sqm", model: [{ item: FGB, cladding: "No", thickness_mm: "25", material_as_written: "Fiberglass board 48 kg/m3" }], re: [], not: ["priced as the 48 kg/m3 board"], priced: true },
  { id: "I17a", rule: T.fitPipe, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [NIT], re: ["pipe size 50 is not on the sheet -> 53.98 (next size up"], priced: true },
  { id: "I17a-calc", rule: T.fitPipe, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["pipe size 50 is not on the sheet -> 53.98 (next size up"], priced: true },
  { id: "I17b", rule: T.fitPipe, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "22.2" })], re: ["pipe size 22.2 is 22.23 on the sheet"], priced: true },
  { id: "I17c-neg", rule: T.fitPipe, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { pipe_size_mm: "65" })], re: ["pipe size 65 is above the largest size on the sheet (53.98)"], priced: false },
  { id: "I18a", rule: T.fitThk, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "19.05", thickness_mm: "20" })], re: ["thickness 20 is not on the sheet -> 25 (next size up"], priced: true },
  { id: "I18b", rule: T.fitThk, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "19.05", thickness_mm: "30" })], re: ["-> priced as 13 + 19 mm (32 mm, +2) -- above the largest stocked size (25 mm)"], priced: true },
  { id: "I18b-calc", rule: T.fitThk, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "30", pipe_size_mm: "19.05" }, ["thickness_mm"]), rowUnit: "mts", re: ["You typed 30 mm -> priced as 13 + 19 mm (32 mm, +2) -- above the largest stocked size (25 mm)"], priced: true },
  { id: "I18c-neg", rule: T.fitThk, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { pipe_size_mm: "19.05", thickness_mm: "200" })], re: ["thickness 200 is above the largest size on the sheet (25)"], priced: false },
  { id: "I19a", rule: T.steps, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [NIT], re: ["supply: pricing input: Aluminium sheet 26G (rate) = 450"], priced: true },
  { id: "I19b-neg", rule: T.steps, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { pipe_size_mm: "65" })], re: [], not: ["supply: pricing input"], priced: false },
  { id: "I20a", rule: T.crossRow, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [{ item: CLO, cladding: "26G Aluminium" }], re: ["the cladding-only SKU's own"], priced: true },
  { id: "I20b-neg", rule: T.crossRow, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [NIT], re: [], not: ["cladding-only SKU's own"], priced: true },
  { id: "I21a", rule: T.computed, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [NIT], re: ["supply: cladding: (aluminium sheet x overlap + glass cloth) x girth ="], priced: true },
  { id: "I21b-neg", rule: T.computed, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { cladding: "No" })], re: ["supply: cladding: (aluminium sheet x overlap + glass cloth) x girth = 0"], priced: true },
  { id: "I23a", rule: T.convert, cat: INS, path: "panel", kind: "pos", unit: "sqft", model: [THMI], re: ["per sq.ft: sq.m rate x 0.0929"], priced: true },
  { id: "I23b-neg", rule: T.convert, cat: INS, path: "panel", kind: "neg", unit: "sqm", model: [THMI], re: [], not: ["per sq.ft"], priced: true },
  { id: "I24a-ptyped", rule: T.qty, cat: INS, path: "ptyped", kind: "pos", unit: "RMT", model: [NIT], edits: ptyped({}, [], "2"), re: ["x 2 per row unit"], priced: true },
  { id: "I24b-ptyped-neg", rule: T.qty, cat: INS, path: "ptyped", kind: "neg", unit: "RMT", model: [NIT], edits: ptyped({}, [], "0"), re: ["quantity per row unit '0' is not a positive number"], priced: false },
  { id: "I24a-calc", rule: T.qty, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" }, ["pipe_size_mm"], "2"), rowUnit: "mts", re: ["x 2 per row unit"], priced: true },

  // ── ADP ─────────────────────────────────────────────────────────────────────────────────────────
  { id: "A1a", rule: T.unit, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "VCD", variant: "GI rectangular", size_mm: "600x600" }], re: ["per-number row: per-sq.m rate x W x H"], priced: true },
  { id: "A1b", rule: T.unit, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "VCD", variant: "GI rectangular", area_band: "0.5 to 1 sqm" }], re: ["area band: per-sq.m rate x the band's maximum area"], priced: true },
  { id: "A1c", rule: T.unit, cat: ADP, path: "panel", kind: "pos", unit: "", model: [{ family: "VCD", variant: "GI rectangular", size_mm: "600x600" }], re: ["No unit on the BoQ row - this item is priced per sq.m or per number; set the unit"], priced: false },
  { id: "A1d", rule: T.unit, cat: ADP, path: "panel", kind: "pos", unit: "", model: [{ family: "actuator", ul: "no", torque: "10" }], re: ["No unit on the BoQ row -> priced per number"], priced: true },
  { id: "A1f-neg", rule: T.unit, cat: ADP, path: "panel", kind: "neg", unit: "kg", model: [{ family: "actuator", ul: "no", torque: "10" }], re: ["unit 'kg' is not a count, area or length unit"], priced: false },
  { id: "A1a-calc", rule: T.unit, cat: ADP, path: "calc", kind: "pos", edits: calc("VCD", { variant: "GI rectangular", size_mm: "600x600" }), rowUnit: "nos", re: ["per-number row: per-sq.m rate x W x H"], priced: true },
  { id: "A1h", rule: T.unit, cat: ADP, path: "panel", kind: "pos", unit: "rmt", model: [{ family: "linear grille", damper: "with", size_mm: "600x150" }], re: ["per-metre grille: per-sq.m rate x height in metres"], priced: true },
  { id: "A1i", rule: T.unit, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "flexible duct", insulated: "with", dia_mm: "200" }], re: ["per piece: per-metre rate x 2.5 m standard length"], priced: true },
  { id: "A1j", rule: T.unit, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "mixing box / LP plenum", insulated: "with", size_mm: "750x150x350" }], re: ["per-number mixing box at any size"], priced: true },
  { id: "A2a", rule: T.kind, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "grille, type not stated", damper: "with", size_mm: "600x150" }], re: ["'grille, type not stated' prices as linear grille"], priced: true },
  { id: "A2b-neg", rule: T.kind, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "linear grille", damper: "with", size_mm: "600x150" }], re: [], not: ["prices as"], priced: true },
  { id: "A3a", rule: T.noSku, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "none of these", damper: "with", dia_mm: "200" }], re: ["no SKU in the catalogue for 'none of these' -- the user decides"], priced: false },
  { id: "A3b-neg", rule: T.noSku, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "200" }], re: [], not: ["the user decides"], priced: true },
  { id: "A4a", rule: T.ruleForUnit, cat: ADP, path: "panel", kind: "pos", unit: "rmt", model: [{ family: "spigot", dia_mm: "200" }], re: ["no SKU per metre for spigot"], priced: false },
  { id: "A4b-neg", rule: T.ruleForUnit, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "spigot", dia_mm: "200" }], re: [], not: ["no SKU per"], priced: true },
  { id: "A6a", rule: T.needs, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "actuator", ul: "no" }], re: ["no torque stated"], priced: false },
  { id: "A6b", rule: T.needs, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "round diffuser", damper: "with" }], re: ["no diameter stated"], priced: false },
  { id: "A6c-neg", rule: T.needs, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "actuator", ul: "no", torque: "10" }], re: [], not: [/no (torque|diameter|neck size|size) stated/], priced: true },
  { id: "A6a-calc", rule: T.needs, cat: ADP, path: "calc", kind: "pos", edits: calc("actuator", { ul: "no" }), rowUnit: "nos", re: ["no torque stated"], priced: false },
  { id: "A7a", rule: T.defaults, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "round diffuser", damper: "None", dia_mm: "200" }], re: ["damper not mentioned -> without ("], priced: true },
  { id: "A7b", rule: T.defaults, cat: ADP, path: "panel", kind: "pos", unit: "rmt", model: [{ family: "flexible duct", dia_mm: "200" }], re: ["insulated not mentioned -> with ("], priced: true },
  { id: "A7c", rule: T.defaults, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "actuator", torque: "10" }], re: ["ul not mentioned -> no ("], priced: true },
  { id: "A7d", rule: T.defaults, cat: ADP, path: "panel", kind: "pos", unit: "sqm", model: [{ family: "VCD" }], re: ["variant not mentioned -> GI rectangular ("], priced: true },
  { id: "A7e", rule: T.defaults, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "linear grille", damper: "None", air: "supply", size_mm: "600x150" }], re: ["damper not mentioned -> with (supply-air linear / plain grille = with damper)"], priced: true },
  { id: "A7e-neg", rule: T.defaults, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "linear grille", damper: "None", air: "return", size_mm: "600x150" }], re: ["damper not mentioned -> without ("], not: ["supply-air linear"], priced: true },
  { id: "A7f-neg", rule: T.defaults, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "200" }], re: [], not: ["damper not mentioned"], priced: true },
  { id: "A7a-calc", rule: T.defaults, cat: ADP, path: "calc", kind: "pos", edits: calc("round diffuser", { damper: "None", dia_mm: "200" }), rowUnit: "nos", re: ["damper not mentioned -> without ("], priced: true },
  { id: "A8a", rule: T.override, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "fire damper", variant: "motorised", ul: "yes", size_mm: "600x600" }], re: ["UL stated, so the UL 555 SKU is used"], priced: true },
  { id: "A8b-neg", rule: T.override, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "fire damper", variant: "motorised", ul: "no", size_mm: "600x600" }], re: [], not: ["UL stated, so"], priced: true },
  // INVERTED at 12e-2b (owner D1 (a) + D2, "UL wins" on both paths). BEFORE: kind "excluded" by owner R1 (12d-8),
  // re ["yes is not stocked with the other answers on this item -- choose again", "choose again: whether it is UL
  // listed"], priced false. UL listed is two-way, the pick is kept, and the override prices the UL 555 SKU.
  { id: "A8a-calc", rule: T.override, cat: ADP, path: "calc", kind: "pos", edits: calc("fire damper", { variant: "motorised", ul: "yes", size_mm: "600x600" }), rowUnit: "nos", re: ["UL stated, so the UL 555 SKU is used"], not: ["ul not mentioned -> no", "choose again"], priced: true },
  { id: "A10c", rule: T.outer, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "square diffuser", damper: "with", size_mm: "595x595" }], re: ["matched on the outer size 595x595; largest neck size behind it is 450"], priced: true },
  { id: "A10d", rule: T.outer, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "square diffuser", damper: "with", size_mm: "600x600" }], re: ["the outer size 600x600 is the sheet's 595x595"], priced: true },
  { id: "A10e", rule: T.outer, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "square diffuser", damper: "with", neck_mm: "300", size_mm: "700x700" }], re: ["did not match the catalogue -- matched on the neck size instead"], priced: true },
  { id: "A10f-neg", rule: T.outer, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "square diffuser", damper: "with", neck_mm: "300" }], re: [], not: ["outer size"], priced: true },
  { id: "A9a", rule: T.fitDia, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "220" }], re: ["diameter 220 is not on the sheet -> 250 (next size up"], priced: true },
  { id: "A9b-neg", rule: T.fitDia, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "500" }], re: ["diameter 500 is above the largest size on the sheet (400)"], priced: false },
  { id: "A9a-calc", rule: T.fitDia, cat: ADP, path: "calc", kind: "pos", edits: calc("round diffuser", { damper: "with", dia_mm: "220" }, ["dia_mm"]), rowUnit: "nos", re: ["diameter 220 is not on the sheet -> 250 (next size up"], priced: true },
  { id: "A10a", rule: T.fitNeck, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "square diffuser", damper: "with", neck_mm: "320" }], re: ["neck size 320 is not on the sheet -> 375 (next size up"], priced: true },
  { id: "A10b-neg", rule: T.fitNeck, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "square diffuser", damper: "with", neck_mm: "500" }], re: ["neck size 500 is above the largest size on the sheet (450)"], priced: false },
  { id: "A11a", rule: T.fitTorque, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "actuator", ul: "no", torque: "12" }], re: ["torque 12 is not on the sheet -> 20 (next size up"], priced: true },
  { id: "A11b-neg", rule: T.fitTorque, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "actuator", ul: "no", torque: "25" }], re: ["torque 25 is above the largest size on the sheet (20)"], priced: false },
  { id: "A12a", rule: T.fitRatio, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "control panel", panel_ratio: "5" }], re: ["panel ratio 5 is not on the sheet -> 6 (next size up"], priced: true },
  { id: "A12b-neg", rule: T.fitRatio, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "control panel", panel_ratio: "13" }], re: ["panel ratio 13 is above the largest size on the sheet (12)"], priced: false },
  { id: "A13a", rule: T.fitPlenum, cat: ADP, path: "panel", kind: "pos", unit: "sqm", model: [{ family: "double-skin plenum", thickness_mm: "30" }], re: ["plenum thickness 30 is not on the sheet -> 50 (next size up"], priced: true },
  { id: "A13b-neg", rule: T.fitPlenum, cat: ADP, path: "panel", kind: "neg", unit: "sqm", model: [{ family: "double-skin plenum", thickness_mm: "60" }], re: ["plenum thickness 60 is above the largest size on the sheet (50)"], priced: false },
  { id: "A13a-calc", rule: T.fitPlenum, cat: ADP, path: "calc", kind: "pos", edits: calc("double-skin plenum", { thickness_mm: "30" }, ["thickness_mm"]), rowUnit: "sqm", re: ["plenum thickness 30 is not on the sheet -> 50 (next size up"], priced: true },
  { id: "A14a", rule: T.steps, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "200" }], re: ["item supply:"], priced: true },
  { id: "A14b-neg", rule: T.steps, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "500" }], re: [], not: ["item supply:"], priced: false },
  { id: "A16a", rule: T.convert, cat: ADP, path: "panel", kind: "pos", unit: "sqft", model: [{ family: "VCD", variant: "GI rectangular" }], re: ["per sq.ft: sq.m rate x 0.0929"], priced: true },
  { id: "A16b-neg", rule: T.convert, cat: ADP, path: "panel", kind: "neg", unit: "sqm", model: [{ family: "VCD", variant: "GI rectangular" }], re: [], not: ["per sq.ft"], priced: true },
  { id: "A17a", rule: T.qty, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "200", qty_per_row_unit: "2" }], re: ["x 2 per row unit"], priced: true },
  { id: "A17b-neg", rule: T.qty, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "200", qty_per_row_unit: "None" }], re: [], not: ["per row unit"], priced: true },
  { id: "A17c-ptyped", rule: T.qty, cat: ADP, path: "ptyped", kind: "pos", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "200", qty_per_row_unit: "2" }], edits: ptyped({}, [], "3"), re: ["x 3 per row unit"], not: ["x 2 per row unit"], priced: true },

  // ── PIPING (SLICE 12e-2, owner option 1; the rules P1-P5 on the live v36 asset) ─────────────────────
  // P4 the unit
  { id: "P4a", rule: T.unit, cat: PIP, path: "panel", kind: "pos", unit: "", model: [MS50], re: ["No unit on the BoQ row -> priced per metre"], priced: true },
  { id: "P4b", rule: T.unit, cat: PIP, path: "panel", kind: "pos", unit: "R/O", model: [MS50], re: ["BoQ says R/O (rate only) -> priced per metre"], priced: true },
  { id: "P4c-neg", rule: T.unit, cat: PIP, path: "panel", kind: "neg", unit: "nos", model: [MS50], re: ["unit 'nos' is not a length unit"], not: ["count, area or length"], priced: false },
  { id: "P4a-calc", rule: T.unit, cat: PIP, path: "calc", kind: "pos", edits: calc("MS", { size_mm: "50" }), rowUnit: "mts", re: [], priced: true },
  // P1 the kind: stocked, mapped, refused, read off the row
  { id: "P1a", rule: T.kind, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [MS50], re: ["family:MS"], priced: true },
  { id: "P1b-neg", rule: T.kind, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "ABC", size_mm: "50" }], re: ["no SKU in the catalogue for 'ABC' -- the user decides"], priced: false },
  { id: "P1c", rule: T.pipeMap, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "GI", size_mm: "50" }], re: ["BoQ says GI -> priced as MS", "family:MS"], priced: true },
  { id: "P1c-calc", rule: T.pipeMap, cat: PIP, path: "calc", kind: "pos", edits: typedType("GI", { size_mm: "50" }), rowUnit: "mts", re: ["BoQ says GI -> priced as MS", "family:MS"], priced: true },
  { id: "P1c2-calc", rule: T.pipeMap, cat: PIP, path: "calc", kind: "pos", edits: typedType("uPVC", { size_mm: "110" }, ["size_mm"]), rowUnit: "mts", re: ["BoQ says uPVC -> priced as PVC", "You typed 110 -> priced as 150 mm (next size up)"], priced: true },
  { id: "P1c3-calc", rule: T.pipeMap, cat: PIP, path: "calc", kind: "pos", edits: typedType("HDPE", { size_mm: "50" }), rowUnit: "mts", re: ["BoQ says HDPE -> priced as PVC", "family:PVC"], priced: true },
  { id: "P1d-neg", rule: T.pipeMap, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [MS50], re: ["family:MS"], not: ["priced as MS", "BoQ says"], priced: true },
  { id: "P1e", rule: T.pipeRefuse, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "SS", size_mm: "50" }], re: ["No SKU in the catalogue for SS pipe - price this row by hand"], priced: false },
  { id: "P1e-calc", rule: T.pipeRefuse, cat: PIP, path: "calc", kind: "pos", edits: typedType("SS", { size_mm: "50" }), rowUnit: "mts", re: ["No SKU in the catalogue for SS pipe - price this row by hand"], priced: false },
  { id: "P1e2-calc", rule: T.pipeRefuse, cat: PIP, path: "calc", kind: "pos", edits: typedType("ABC", { size_mm: "50" }), rowUnit: "mts", re: ["no SKU in the catalogue for 'ABC' -- the user decides"], priced: false },
  { id: "P1f-neg", rule: T.pipeRefuse, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "PVC", size_mm: "50" }], re: ["family:PVC"], not: ["No SKU in the catalogue", "the user decides"], priced: true },
  { id: "P1g", rule: T.pipeRow, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "None", size_mm: "50" }], description: "MS / GI pipe 50 mm dia with fittings", re: ["BoQ names MS / GI -> priced as MS", "family:MS"], priced: true },
  { id: "P1h", rule: T.pipeRow, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "None", size_mm: "50" }], description: "copper or PVC drain pipe 50 mm", re: ["two pipe types are named in this row (Copper, PVC) - pick the type"], priced: false },
  { id: "P1i-neg", rule: T.pipeRow, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "None", size_mm: "50" }], description: "pipe 50 mm dia", headings: ["MS piping"], re: ["no pipe type could be told for this item"], not: ["BoQ names", "two pipe types"], priced: false },
  // the rule for the unit, and the needs
  { id: "P6a", rule: T.ruleForUnit, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [MS50], re: ["family:MS"], priced: true },
  { id: "P6b-neg", rule: T.ruleForUnit, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "Copper", size_mm: "15.9" }], re: [], not: ["no SKU per"], priced: true },
  { id: "P7a", rule: T.needs, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "MS" }], re: ["no pipe size stated"], priced: false },
  { id: "P7b-neg", rule: T.needs, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [MS50], re: [], not: ["no pipe size stated"], priced: true },
  { id: "P7a-calc", rule: T.needs, cat: PIP, path: "calc", kind: "pos", edits: calc("MS", {}), rowUnit: "mts", re: ["no pipe size stated"], priced: false },
  // P2 the size: inches (both conversions), one size typed, the ladder
  { id: "P2a", rule: T.inches, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}` }], re: [`BoQ says 5/8${INCH} -> 15.875 mm -> priced as 15.9 mm (the sheet's own spelling of this size)`], priced: true },
  { id: "P2a-calc", rule: T.inches, cat: PIP, path: "calc", kind: "pos", edits: calc("Copper", { size_mm: `5/8${INCH}` }, ["size_mm"]), rowUnit: "mts", re: [`You typed 5/8${INCH} -> 15.875 mm -> priced as 15.9 mm (the sheet's own spelling of this size)`], priced: true },
  { id: "P2b-calc", rule: T.inches, cat: PIP, path: "calc", kind: "pos", edits: calc("MS", { size_mm: "4 inch" }, ["size_mm"]), rowUnit: "mts", re: ["You typed 4 inch -> 101.6 mm / 100 mm -> priced as 100 mm"], priced: true },
  { id: "P2c-calc", rule: T.inches, cat: PIP, path: "calc", kind: "pos", edits: calc("Copper", { size_mm: `1-1/4${INCH}` }, ["size_mm"]), rowUnit: "mts", re: [`You typed 1-1/4${INCH} -> 31.75 mm -> priced as 31.7 mm (the sheet's own spelling of this size)`], priced: true },
  { id: "P2d-neg", rule: T.inches, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [MS50], re: [], not: ["-> 50.8", "/ 50 mm"], priced: true },
  // INVERTED at 12e-2b (AC6): a slash that cannot be an inch fraction states two sizes. BEFORE: re ["Type one pipe size, in mm or inches"].
  // INVERTED AGAIN at 12e-3b (owner 2026-10-11): two sizes price the higher. BEFORE: re ["You typed 40/50: pipe size states two sizes (40 / 50) - pick one"], priced false.
  { id: "P2e-ptyped", rule: T.typedSize, cat: PIP, path: "ptyped", kind: "pos", unit: "mts", model: [MS50], edits: ptyped({ size_mm: "40/50" }, ["size_mm"]), re: ["You typed 40/50: states two sizes (40 / 50) - the higher, 50, is taken", "pipe size states two sizes (40 / 50) - the higher, 50, is taken"], not: ["Type one pipe size", "pick one"], priced: true },
  { id: "P2e-calc", rule: T.typedSize, cat: PIP, path: "calc", kind: "pos", edits: calc("MS", { size_mm: "two inch" }, ["size_mm"]), rowUnit: "mts", re: ["Type one pipe size, in mm or inches"], priced: false },
  // INVERTED at 12e-2b (AC6; 12e-2 cert finding 7). BEFORE: re ["pipe size 20.32 is not on the sheet -> 25 (next size up", "BoQ says 40/50
  // -> 20.32 mm -> priced as 25 mm (next size up)"], priced TRUE -- a model "40/50" read as 0.8 of an inch and priced a 25 mm pipe.
  // It now refuses on the model path too; the near-miss kept: the TYPED-only message is still never said of a model cell.
  // INVERTED AGAIN at 12e-3b: BEFORE re ["BoQ says 40/50: pipe size states two sizes (40 / 50) - pick one"], priced false. The model's
  // two sizes price the higher; the near-miss kept: the TYPED-only message is never said of a model cell, and never the 25 mm pipe.
  { id: "P2f-neg", rule: T.typedSize, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "MS", size_mm: "40/50" }], re: ["BoQ says 40/50: states two sizes (40 / 50) - the higher, 50, is taken"], not: ["Type one pipe size", "priced as 25", "pick one"], priced: true },
  { id: "P2g-neg", rule: T.typedSize, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "MS", size_mm: "1 1/4 inch" }], re: ["BoQ says 1 1/4 inch -> 31.75 mm -> priced as 32 mm (next size up)"], not: ["states two sizes", "Type one pipe size"], priced: true },
  { id: "P2g", rule: T.fitPipe, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "PVC", size_mm: "110" }], re: ["pipe size 110 is not on the sheet -> 150 (next size up", "BoQ says 110 -> priced as 150 mm (next size up)"], priced: true },
  { id: "P2h", rule: T.fitPipe, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "MS", size_mm: "15" }], re: ["BoQ says 15 -> priced as 19 mm (the smallest size)"], priced: true },
  { id: "P2i", rule: T.fitPipe, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "Copper", size_mm: "31.75" }], re: ["pipe size 31.75 is 31.7 on the sheet", "BoQ says 31.75 -> priced as 31.7 mm (the sheet's own spelling of this size)"], priced: true },
  { id: "P2j-neg", rule: T.fitPipe, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "MS", size_mm: "350" }], re: ["pipe size 350 is above the largest size on the sheet (300)"], priced: false },
  { id: "P2g-calc", rule: T.fitPipe, cat: PIP, path: "calc", kind: "pos", edits: calc("PVC", { size_mm: "110" }, ["size_mm"]), rowUnit: "mts", re: ["You typed 110 -> priced as 150 mm (next size up)"], priced: true },
  { id: "P2h-calc", rule: T.fitPipe, cat: PIP, path: "calc", kind: "pos", edits: calc("MS", { size_mm: "15" }, ["size_mm"]), rowUnit: "mts", re: ["You typed 15 -> priced as 19 mm (the smallest size)"], priced: true },
  // P3 the class
  { id: "P3a", rule: T.readClass, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ ...MS50, pipe_class: "Class C" }], re: ["Class C stated -> priced at the one MS rate (the sheet has no class rates)"], priced: true },
  { id: "P3a-calc", rule: T.readClass, cat: PIP, path: "calc", kind: "pos", edits: calc("MS", { size_mm: "50", pipe_class: "Class C" }), rowUnit: "mts", re: ["Class C stated -> priced at the one MS rate (the sheet has no class rates)"], priced: true },
  { id: "P3b-neg", rule: T.readClass, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [MS50], re: [], not: ["stated -> priced at the one"], priced: true },
  // P5 the priced steps, and the quantity
  { id: "P5a", rule: T.steps, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [MS50], re: ["supply: pricing input: Piping accessories - MS (factor) = 0.6", "supply: BCS pipe x (1 + the accessories share) = 656", "supply: ROUNDUP(supply, 0) = 984", "install: ROUNDUP(install, 0) = 280"], priced: true },
  { id: "P5b-neg", rule: T.steps, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "MS", size_mm: "350" }], re: [], not: ["supply: pricing input"], priced: false },
  { id: "P5c-ptyped", rule: T.qty, cat: PIP, path: "ptyped", kind: "pos", unit: "mts", model: [MS50], edits: ptyped({}, [], "2"), re: ["x 2 per row unit"], priced: true },
  { id: "P5d-ptyped-neg", rule: T.qty, cat: PIP, path: "ptyped", kind: "neg", unit: "mts", model: [MS50], edits: ptyped({}, [], "0"), re: ["quantity per row unit '0' is not a positive number"], priced: false },
  // ── SLICE 12e-3b (AC6): the insulation section on Piping (v37). The section's lines are read with a "sec." lead; the
  //    pure pricer prices a pipe only, so the figure comparison is the section tests' (slice12e3a / slice12e3b). ──
  { id: "S1a", rule: T.secToggle, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}`, insulated: "Yes" }], re: ["section:Insulation - priced by Insulation's rules", "sec.family:Nitrile Rubber Insulation", "sec.default:material not mentioned -> Nitrile by row kind"], not: ["sec.pick:"], priced: false, pure: false },
  { id: "S1b-neg", rule: T.secToggle, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}` }], re: ["insulated:insulation not mentioned -> No"], not: ["section:"], priced: true },
  { id: "S1c-neg", rule: T.secToggle, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}`, insulated: "No" }], re: [], not: ["section:", "insulation not mentioned"], priced: true },
  { id: "S1a-calc", rule: T.secToggle, cat: PIP, path: "calc", kind: "pos", edits: calc("Copper", { size_mm: `5/8${INCH}`, insulated: "Yes" }, ["size_mm"]), rowUnit: "mts", re: ["section:Insulation - priced by Insulation's rules", "sec.pick:Choose the insulation material"], not: ["not mentioned -> Nitrile"], priced: false, pure: false },
  { id: "S2a", rule: T.secRules, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}` }, { item: NR, cladding: "26G Aluminium", thickness_mm: "13" }], re: ["section:Insulation - priced by Insulation's rules", "sec.family:Nitrile Rubber Insulation", "sec.figures:324/224"], priced: true, pure: false },
  { id: "S2b-neg", rule: T.secRules, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}` }, { item: NR, cladding: "26G Aluminium", thickness_mm: "abc" }], re: ["sec.thickness_mm:"], not: ["sec.figures:"], priced: false, pure: false },
  { id: "S3a", rule: T.secMirror, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "MS", size_mm: "25/32" }, { item: NR, cladding: "No", thickness_mm: "13" }], re: ["BoQ says 25/32: states two sizes (25 / 32) - the higher, 32, is taken", "sec.pipe_size_mm:tag=from pipe", "sec.pipe_size_mm:From pipe: 32 mm"], priced: true, pure: false },
  { id: "S3b-neg", rule: T.secMirror, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "Copper", insulated: "Yes" }, { item: NR, cladding: "No", thickness_mm: "13", pipe_size_mm: "41.28" }], re: ["no pipe size stated"], not: ["tag=from pipe", "From pipe:"], priced: false, pure: false },
  { id: "S4a", rule: T.secTotal, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}` }, { item: NR, cladding: "26G Aluminium", thickness_mm: "13" }], re: ["total:1622/444", "lines:2 bad:0"], priced: true, pure: false },
  // SLICE 12e-3c (F10): the pricer's pipe quantity (2) reaches the model's insulation, tagged; a section with no pipe keeps its own amber 1
  { id: "S5a", rule: T.secQty, cat: PIP, path: "ptyped", kind: "pos", unit: "mts", model: [{ pipe_type: "MS", size_mm: "32" }, { item: NR, cladding: "26G Aluminium", thickness_mm: "13" }], edits: ptyped({}, [], "2"), re: ["sec.qty:2 tag:from pipe", "x 2 per row unit"], not: ["sec.qty:1"], priced: true, pure: false },
  { id: "S5b-neg", rule: T.secQty, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "MS", size_mm: "32" }, { item: NR, cladding: "No", thickness_mm: "13" }, { item: NR, cladding: "No", thickness_mm: "13", pipe_size_mm: "41.28" }], edits: undefined, re: ["sec.qty:1 tag:from pipe amber:false", "sec.qty:1 tag:none amber:true"], priced: true, pure: false },
  { id: "S5c-neg", rule: T.secQty, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "MS", size_mm: "32" }], re: [], not: ["sec.qty:", "tag:from pipe"], priced: true },
  { id: "S4b-neg", rule: T.secTotal, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "MS", size_mm: "100" }, { item: NR, cladding: "26G Aluminium", thickness_mm: "32" }], re: ["lines:2 bad:1"], not: ["total:"], priced: false, pure: false },
];

/** ADP line 5 (`units_not_offered`) acts on the CALCULATOR'S UNIT PICKER, not on a row's price: it is covered
 *  by the unit-choices check below (a BoQ row arriving in a hidden unit prices exactly as before, by design). */
const PICKER_CASES: Array<{ rule: string; family: string; offered: string[]; notOffered: string[] }> = [
  { rule: T.notOffered, family: "double-skin plenum", offered: ["sqm"], notOffered: ["nos"] },
  { rule: T.notOffered, family: "VCD", offered: ["nos", "sqm"], notOffered: [] },
];

// ── the runner: the panel's entry point on each path, beside the pure pricer ────────────────────────
const cells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
function run(c: Case) {
  const modelItems = (c.model ?? []).map((a) => ({ attributes: cells(a) }));
  const ext = new Map<number, ExtractionRow>();
  if (c.path !== "calc") ext.set(1, { excelRow: 1, description: c.description ?? "", attributes: {}, items: modelItems } as unknown as ExtractionRow);
  const overrides: Record<string, string> = {};
  if (c.edits) overrides[ITEM_LIST_OVERRIDE_KEY] = JSON.stringify({ items: c.edits });
  if (c.rowUnit !== undefined) overrides[ROW_UNIT_OVERRIDE_KEY] = c.rowUnit;
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: ext });
  const ctx: RateHelperRowContext & { unit?: string } = {
    excelRow: 1, description: c.path === "calc" ? "" : (c.description ?? ""), nodeType: "Line Item", category: c.cat, discipline: "HVAC",
    rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: c.path === "calc" ? [] : (c.headings ?? []), ownNotes: c.path === "calc" ? [] : (c.ownNotes ?? []),
  };
  // 12e-2: the family CONTROL's line reaches the lines read here, exactly as the panel shows it
  if (c.path !== "calc" && c.unit !== undefined) ctx.unit = c.unit;
  const r = h.compute(ctx, overrides);
  if (!isSuggestion(r)) throw new Error(`${c.id}: expected a suggestion`);
  const s = r as ItemListSuggestion;
  const v = s.itemList!;
  const lines: string[] = [];
  if (v.reason) lines.push(v.reason);
  if (v.unitNote) lines.push(v.unitNote);
  lines.push(...(s.workings.derivation ?? []));
  for (const b of v.items) {
    if (b.family) lines.push(`family:${b.family}`);
    if (b.reason) lines.push(b.reason);
    if (b.skuLine) lines.push(b.skuLine);
    if (b.familyDefaulted) lines.push(b.familyDefaulted.rule);
    if (b.familyLine) lines.push(b.familyLine);
    lines.push(...b.working);
    for (const f of b.fields) {
      if (f.note) lines.push(`${f.id}:${f.note}`);
      if (f.rule) lines.push(`${f.id}:${f.rule}`);
      if (f.otherMode) lines.push(`${f.id}:otherMode=true typed=${f.typedValue}`);
    }
  }
  // 12e-3b: a delegated section's lines, each with a "sec." lead -- the heading, the picker, the block as above, the mirror
  for (const sv of [...v.items.flatMap((b) => b.sections ?? []), ...(v.sections?.independent ?? [])]) {
    lines.push(`section:${sv.heading}`);
    if (sv.view.pickFamily) lines.push(`sec.pick:${sv.view.reason}`);
    for (const b of sv.view.items) {
      if (b.family) lines.push(`sec.family:${b.family}`);
      if (b.reason) lines.push(`sec.${b.reason}`);
      if (b.familyDefaulted) lines.push(`sec.default:${b.familyDefaulted.rule}`);
      if (b.state === "priced") lines.push(`sec.figures:${b.figures.supply_rate}/${b.figures.install_rate}`);
      lines.push(`sec.qty:${b.qty} tag:${b.qtyMirrorTag ?? "none"} amber:${b.qtyDefaulted}`);   // 12e-3c (F10)
      lines.push(...b.working.map((w) => `sec.${w}`));
      for (const f of b.fields) {
        if (f.note) lines.push(`sec.${f.id}:${f.note}`);
        if (f.mirrorTag) lines.push(`sec.${f.id}:tag=${f.mirrorTag}`);
        if (f.mirrorLine) lines.push(`sec.${f.id}:${f.mirrorLine}`);
      }
    }
  }
  if (v.sections) {
    lines.push(`lines:${v.sections.lines} bad:${v.sections.bad}`);
    if (v.rowPriced) lines.push(`total:${s.values.supply_rate}/${s.values.install_rate}`);
  }
  // the pure pricer over the SAME assembled inputs
  const spec = itemListPricingSpec(CFG[c.cat])!;
  const edits = decodeItemEdits(overrides[ITEM_LIST_OVERRIDE_KEY], modelItems.length);
  const assembled = assembleItems(edits, modelItems, familyAttr(spec));
  const unitForPure = c.path === "calc" ? v.unit : (c.unit ?? v.unit);
  const rowText = c.path === "calc" ? "" : [c.description ?? "", ...(c.headings ?? [])].join(" | ");
  const ownText = c.path === "calc" ? "" : [c.description ?? "", ...(c.ownNotes ?? [])].join(" | ");
  const pure = priceItemList(spec, ITEMS, unitForPure, assembled, rowText, ownText);
  const working = v.items.flatMap((b) => b.working);
  // 12e-3c (AC2): the strings exactly as a pricer reads them -- no test-side lead -- for the field-id sweep
  const raw: string[] = [...(v.reason ? [v.reason] : []), ...(v.unitNote ? [v.unitNote] : []), ...(s.workings.derivation ?? [])];
  const rawBlock = (b: (typeof v.items)[number]) => {
    if (b.reason) raw.push(b.reason);
    if (b.skuLine) raw.push(b.skuLine);
    if (b.familyDefaulted) raw.push(b.familyDefaulted.rule);
    if (b.familyLine) raw.push(b.familyLine);
    raw.push(...b.working);
    for (const f of b.fields) { if (f.note) raw.push(f.note); if (f.rule) raw.push(f.rule); if (f.mirrorLine) raw.push(f.mirrorLine); raw.push(...(f.matchHelp ?? [])); }
  };
  for (const b of v.items) { rawBlock(b); for (const sv of b.sections ?? []) { if (sv.view.reason) raw.push(sv.view.reason); sv.view.items.forEach(rawBlock); } }
  for (const sv of v.sections?.independent ?? []) { if (sv.view.reason) raw.push(sv.view.reason); sv.view.items.forEach(rawBlock); }
  return { s, v, lines, text: lines.join("\n"), working, pure, raw };
}
const matches = (text: string, p: string | RegExp) => (typeof p === "string" ? text.includes(p) : p.test(text));

// ── T1 ──────────────────────────────────────────────────────────────────────────────────────────────
describe("T1 -- every Derivation-tab rule of Insulation and ADP fires from the panel's entry point (live v33)", () => {
  const titles = (cat: string) => itemListRuleOrder(CFG[cat], ITEMS).map((l) => l.title);

  it("THE GUARD: the rules this file names EQUAL the rules the config generates (Insulation 24, ADP 18, Piping 19 -- 14 before 12e-3b, four section lines then, the quantity line at 12e-3c); a new rule without a case, or a case naming a dead rule, fails here", () => {
    for (const cat of [INS, ADP, PIP]) {
      const generated = new Set(titles(cat));
      const named = new Set([...CASES.filter((c) => c.cat === cat).map((c) => c.rule), ...PICKER_CASES.filter(() => cat === ADP).map((p) => p.rule), ...Object.keys(NOT_PANEL_RULES).filter((t) => generated.has(t))]);
      const uncovered = [...generated].filter((t) => !named.has(t));
      const dead = [...named].filter((t) => !generated.has(t));
      expect({ cat, uncovered, dead }).toEqual({ cat, uncovered: [], dead: [] });
    }
    expect(titles(INS)).toHaveLength(24);
    expect(titles(ADP)).toHaveLength(18);
    // INVERTED at 12e-3b (AC6): BEFORE `toHaveLength(14)` on v36. v37 declares the insulation section, which adds the four
    // lines named here; the 14 before them are unchanged, in the same order.
    // INVERTED at 12e-3c (owner F10 / U6): BEFORE `toHaveLength(18)` and `slice(14)` equal to the four section lines.
    expect(titles(PIP)).toHaveLength(19);
    expect(titles(PIP).slice(14)).toEqual([T.secToggle, T.secRules, T.secMirror, T.secQty, T.secTotal]);
    expect(titles(PIP).slice(0, 14)).toEqual(itemListRuleOrder(V36_PIPING, ITEMS).map((l) => l.title));
    // every NOT-panel rule is a REAL tab line (never a stale excuse)
    for (const t of Object.keys(NOT_PANEL_RULES)) expect(titles(INS).includes(t) || titles(ADP).includes(t)).toBe(true);
  });

  it("every panel-path rule has a POSITIVE model-read case and a NEGATIVE (near-miss) case", () => {
    for (const cat of [INS, ADP, PIP]) {
      for (const t of titles(cat)) {
        if (t in NOT_PANEL_RULES || t === T.notOffered) continue;
        const mine = CASES.filter((c) => c.cat === cat && c.rule === t);
        expect({ cat, rule: t, positive: mine.some((c) => c.kind === "pos" && c.path !== "calc") }).toEqual({ cat, rule: t, positive: true });
        expect({ cat, rule: t, negative: mine.some((c) => c.kind === "neg") }).toEqual({ cat, rule: t, negative: true });
      }
    }
  });

  it.each(CASES.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const { s, v, text, pure } = run(c);
    if (c.cat === PIP && c.path !== "calc") expect(v.items[0]?.familyControl?.id).toBe("pipe_type");   // 12e-2: the family is a CONTROL on Piping
    for (const p of c.re) expect({ id: c.id, has: p, text }).toMatchObject({ has: p, text: expect.stringMatching(typeof p === "string" ? new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : p) });
    for (const p of c.not ?? []) expect({ id: c.id, forbidden: p, hit: matches(text, p) }).toEqual({ id: c.id, forbidden: p, hit: false });
    if (c.priced !== undefined) expect({ id: c.id, priced: v.rowPriced }).toEqual({ id: c.id, priced: c.priced });
    if (c.pure !== false) {
      if (v.rowPriced) {
        expect({ id: c.id, panel: [s.values.supply_rate, s.values.install_rate], pure: [pure.supply, pure.install] })
          .toEqual({ id: c.id, panel: [pure.supply, pure.install], pure: [pure.supply, pure.install] });
      } else {
        expect({ id: c.id, pureRefuses: !pure.priced }).toEqual({ id: c.id, pureRefuses: true });
      }
    }
  });

  it("12e-3c AC2 (F7): across EVERY case of this file -- Insulation, ADP and Piping, panel, typed and calculator paths -- no line a pricer reads holds a field id written with an underscore", () => {
    const SNAKE = /(?<![A-Za-z0-9_])[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+(?![A-Za-z0-9_])/;
    const hits: string[] = [];
    const perCat: Record<string, number> = {};
    let lines = 0;
    for (const c of CASES) {
      perCat[c.cat] = (perCat[c.cat] ?? 0) + 1;
      for (const line of run(c).raw) { lines++; if (SNAKE.test(line)) hits.push(`${c.id}: ${line}`); }
    }
    expect(hits).toEqual([]);
    expect(Object.keys(perCat).sort()).toEqual([ADP, INS, PIP].sort());
    expect(CASES.length).toBe(perCat[INS] + perCat[ADP] + perCat[PIP]);
    expect(lines).toBeGreaterThan(2000);
  });

  it("every EXCLUDED case cites its ruling", () => {
    for (const c of CASES.filter((c) => c.kind === "excluded")) expect({ id: c.id, excludedBy: c.excludedBy ?? "" }).not.toEqual({ id: c.id, excludedBy: "" });
    expect(CASES.filter((c) => c.kind === "excluded").map((c) => c.id).sort()).toEqual(["I13a-calc", "I14a-calc", "I8x-calc", "I8x-ptyped", "I9x-calc"]);   // 12e-2b: "A8a-calc" left the list (D2) -- BEFORE it was the sixth
  });

  it.each(PICKER_CASES)("ADP line 5: the calculator's unit picker for $family offers $offered and not $notOffered", ({ family, offered, notOffered }) => {
    const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
    const r = h.compute({ excelRow: 1, description: "", nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"] },
      { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs: {}, other: [] }] }) });
    const choices = (r as ItemListSuggestion).itemList!.unitChoices;
    for (const u of offered) expect(choices).toContain(u);
    for (const u of notOffered) expect(choices).not.toContain(u);
  });

  it("a fake rule in an in-memory config copy is reported as UNCOVERED (the guard is not vacuous)", () => {
    const fake = { ...CFG[INS], list_spec: { ...(CFG[INS] as any).list_spec, pricing: { ...(CFG[INS] as any).list_spec.pricing,
      value_map: [...(CFG[INS] as any).list_spec.pricing.value_map, { attr: "cladding", families: [NR], from: "Canvas", refuse: "a fake rule for the vacuity proof" }] } } } as RateCategoryConfig;
    const generated = itemListRuleOrder(fake, ITEMS).map((l) => l.title);
    const named = new Set([...CASES.filter((c) => c.cat === INS).map((c) => c.rule), ...Object.keys(NOT_PANEL_RULES)]);
    const uncovered = generated.filter((t) => !named.has(t));
    expect(uncovered).toEqual(["Canvas as the cladding on Nitrile Rubber Insulation refuses"]);
  });
});

// ── T3: the rewriter x rule matrix (12d-7 S4), with F-1 / F-2 / F-3 as regression pins ───────────────
describe("T3 -- rewriter x rule: no step between a stored value / a typed entry and the pricer discards what a rule needs or shows", () => {
  const MATRIX: Case[] = [
    { id: "R4xLayers", rule: "matchStatedToOption x compose (12d-6 guard)", cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { thickness_mm: "Double layer of 19mm thick" })], re: ["priced as two layers"], priced: true },
    { id: "R4xSeveral (F-2)", rule: "matchStatedToOption x several=highest", cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { thickness_mm: "13 / 19 / 25" })], re: ["the highest, 25, is taken"], not: ["own spelling"], working: ["states several values -- the highest, 25, is taken"], priced: true },
    { id: "R4xCm (F-2)", rule: "matchStatedToOption x the cm reader", cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(PUFI, { pipe_size_mm: "20 cm" })], re: ["20 cm read as 200 mm"], not: ["own spelling"], working: ["20 cm read as 200 mm"], priced: true },
    { id: "R4xRange (F-2)", rule: "matchStatedToOption x the range reader", cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(PUFI, { thickness_mm: "25 to 50" })], re: ["-> its top value 50"], working: ["its top value 50"], priced: true },
    { id: "R4xInch", rule: "matchStatedToOption x inches (not an option: left alone)", cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: '5/8"' })], re: ["15.88"], priced: true },
    { id: "R4xSizeMatch", rule: "matchStatedToOption x size_match", cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "22.2" })], re: ["pipe size 22.2 is 22.23 on the sheet"], priced: true },
    { id: "R4xText", rule: "matchStatedToOption x a choice spelled differently (the intended rewrite)", cat: ADP, path: "panel", kind: "pos", unit: "sqm", model: [{ family: "VCD", variant: "gi rectangular" }], re: ["BoQ says gi rectangular -> GI rectangular (the sheet's own spelling of this value)"], priced: true, pure: false },
    // INVERTED at 12e-2b (AC13: a LADDER field's stale pick ladders). BEFORE: re ["25 mm is not stocked with the other answers on this
    // item -- choose again", "choose again: thickness"], priced false. The 12d-7 F-1 half is kept: the 9 mm default never fills it.
    { id: "R5xDefault (F-1)", rule: "unstockedPicks x number_defaults", cat: INS, path: "calc", kind: "pos", edits: calc(PUF, { cladding: "No", pipe_size_mm: "100", thickness_mm: "25" }), rowUnit: "mts", re: ["thickness_mm:25 mm is not stocked with pipe size 100 -> priced as 65 mm (next size up)", "thickness 25 is not on the sheet -> 65 (next size up"], not: ["not mentioned -> 9", "choose again"], priced: true },
    // INVERTED at 12e-2b (AC13). BEFORE: rule "... (a cleared pick must not price EITHER way)", re ["choose again: thickness"], priced false.
    { id: "R5xCompose (F-1)", rule: "unstockedPicks x composition (a ladder pick composes exactly as the same value typed)", cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", pipe_size_mm: "6.35", thickness_mm: "25" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["25 mm is not stocked with pipe size 6.35 -> priced as 13 + 13 mm (26 mm, +1) -- above the largest stocked size (19 mm)"], not: ["not mentioned -> 9", "choose again"], priced: true },
    // INVERTED at 12e-2b (D1 (a) + D2). BEFORE: re ["choose again: whether it is UL listed"], priced false. The F-1 half is kept: no UL default fires.
    { id: "R5xAbsentAsNone (F-1)", rule: "unstockedPicks x absent_as_none + override_when", cat: ADP, path: "calc", kind: "pos", edits: calc("fire damper", { variant: "motorised", ul: "yes", size_mm: "600x600" }), rowUnit: "nos", re: ["UL stated, so the UL 555 SKU is used"], not: ["ul not mentioned -> no", "choose again"], priced: true },
    // 12e-2b (AC13): one named case per LADDER field kind a block's other answer can unstock -- and the choice-field negative
    { id: "R5xLadderTorque (AC13)", rule: "unstockedPicks x a ladder pick (torque under UL): laddered, never cleared", cat: ADP, path: "calc", kind: "pos", edits: calc("actuator", { torque: "6", ul: "yes" }), rowUnit: "nos", re: ["torque:6 Nm is not stocked with UL listed yes -> priced as 8 Nm (next size up)" /* 12e-3b (Q13): BEFORE "torque:6 nm ... priced as 8 nm (next size up)" */, "torque 6 is not on the sheet -> 8 (next size up"], not: ["choose again"], priced: true },
    { id: "R5xChoiceStillClears (AC13 neg)", rule: "unstockedPicks x a CHOICE pick (no ladder): still cleared, never refilled", cat: INS, path: "calc", kind: "neg", edits: calc(ACO, { cladding: "Aluminium Foil", thickness_mm: "19" }), rowUnit: "sqm", re: ["Aluminium Foil is not stocked with the other answers on this item -- choose again", "choose again: cladding"], not: ["priced as", "cladding not mentioned"], priced: false, pure: false },
    { id: "R5xOther", rule: "unstockedPicks x a value typed through Other... (never cleared)", cat: INS, path: "calc", kind: "pos", edits: calc(PUF, { cladding: "No", pipe_size_mm: "100", thickness_mm: "25" }, ["thickness_mm"]), rowUnit: "mts", re: ["thickness 25 is not on the sheet -> 65 (next size up"], priced: true },
    { id: "R5xModel", rule: "unstockedPicks x a model value (never cleared)", cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(PUFI, { thickness_mm: "25" })], re: ["thickness 25 is not on the sheet -> 65 (next size up"], priced: true },
    { id: "R5xModelOpenedBox (F-3)", rule: "unstockedPicks x a size typed into a MODEL-opened Other... box", cat: INS, path: "ptyped", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "250 NB" })], edits: ptyped({ pipe_size_mm: "50" }), re: ["pipe size 50 is not on the sheet -> 53.98", "pipe_size_mm:otherMode=true typed=50"], not: ["not stocked with the other answers"], priced: true },
    { id: "R5xFoil (R4b)", rule: "unstockedPicks x value_map (an offered mapped value is a stocked pick)", cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "Aluminium Foil", thickness_mm: "19", pipe_size_mm: "50" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["foil on a pipe is priced as 26G cladding"], not: ["not stocked"], priced: true },
    { id: "R2xU4decimal", rule: "assembleItems typed marker x U4 (a decimal typed thickness is accepted)", cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "12.5", pipe_size_mm: "50" }, ["thickness_mm", "pipe_size_mm"]), rowUnit: "mts", re: ["thickness 12.5 is not on the sheet -> 13 (next size up"], priced: true },
    { id: "R2xU4pipe", rule: "assembleItems typed marker x U4 (the pipe-size box is untouched)", cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50 NB" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["53.98"], priced: true },
    { id: "R2xAdded", rule: "assembleItems x needs (an added item starts from its family alone)", cat: INS, path: "ptyped", kind: "pos", unit: "RMT", model: [NIT], edits: [{ base: 0, family: null, attrs: {}, other: [] }, { base: null, family: PUF, attrs: {}, other: [] }], re: ["could not tell cladding"], priced: false },
    { id: "R1xBadBase", rule: "decodeItemEdits x family_when_none (an out-of-range base is dropped, never priced silently)", cat: INS, path: "ptyped", kind: "pos", unit: "RMT", model: [NIT], edits: [{ base: 5, family: null, attrs: {}, other: [] }], re: ["could not tell cladding"], priced: false },
    { id: "R3xUnitStale", rule: "the row-unit override x unit rules (a pick no longer offered falls to the first offered class)", cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" }, ["pipe_size_mm"]), rowUnit: "sqm", re: [], priced: true },
    { id: "R6xHeadings", rule: "row text x family_when_none (headings reach it) and x named_in_row (headings never do)", cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [m(THMI, { item: "None", cladding: "None" })], headings: ["Acoustic lining with aluminium cladding"], re: ["item not mentioned -> Acoustic Nitrile Insulation (", "cladding not mentioned -> No ("], not: ["cladding named in this row"], priced: true },
    { id: "R8xUnshowable", rule: "fieldCannotShowValue x the pricer (the pricer refuses an unshowable value first)", cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "round diffuser", damper: "yes", dia_mm: "200" }], re: ["No SKU for round diffuser: damper yes - price this row by hand"], priced: false },   // INVERTED at 12e-2b (D3): BEFORE "no SKU for this combination (round diffuser: damper yes)"
  ];
  it("the matrix names every rewriter x rule pair it covers", () => {
    expect(MATRIX.map((c) => c.id)).toEqual([
      "R4xLayers", "R4xSeveral (F-2)", "R4xCm (F-2)", "R4xRange (F-2)", "R4xInch", "R4xSizeMatch", "R4xText",
      "R5xDefault (F-1)", "R5xCompose (F-1)", "R5xAbsentAsNone (F-1)",
      "R5xLadderTorque (AC13)", "R5xChoiceStillClears (AC13 neg)",   // 12e-2b: the ladder-on-picks pair, added by name
      "R5xOther", "R5xModel", "R5xModelOpenedBox (F-3)", "R5xFoil (R4b)",
      "R2xU4decimal", "R2xU4pipe", "R2xAdded", "R1xBadBase", "R3xUnitStale", "R6xHeadings", "R8xUnshowable",
    ]);
  });
  it.each(MATRIX.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const { s, v, text, working, pure } = run(c);
    for (const p of c.re) expect({ id: c.id, has: p, hit: matches(text, p) }).toEqual({ id: c.id, has: p, hit: true });
    for (const p of c.working ?? []) expect({ id: c.id, inWorking: p, hit: working.some((w) => matches(w, p)) }).toEqual({ id: c.id, inWorking: p, hit: true });
    for (const p of c.not ?? []) expect({ id: c.id, forbidden: p, hit: matches(text, p) }).toEqual({ id: c.id, forbidden: p, hit: false });
    if (c.priced !== undefined) expect({ id: c.id, priced: v.rowPriced }).toEqual({ id: c.id, priced: c.priced });
    if (c.pure !== false && v.rowPriced) expect([s.values.supply_rate, s.values.install_rate]).toEqual([pure.supply, pure.install]);
  });
});
