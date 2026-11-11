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
  ITEM_LIST_OVERRIDE_KEY, ROW_QTY_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, EXTRAS_INCLUDES_KEY, applyItemEdit, assembleItems, buildExtractionByRow, decodeItemEdits, makePricingSheetHelper,
  type ItemEditOp, type ItemListSuggestion,
} from "./pricingSheetHelper";
import { applyFamilyMerge, familyAttr, itemListPricingSpec, priceItemList } from "./itemListPricing";
import { applyAdp1 } from "./adp1.harness";
import { applyAdp2 } from "./adp2.harness";
import { applyAdp3b } from "./adp3b.harness";

const ASSET = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
  new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v38.json", import.meta.url),   // 12e-4b: v37 -> v38 (Insulation, ADP and every item carried; Piping gains its model questions, the as-written rule and the second opinion; Insulation one key). BEFORE: v37. 12e-2: v33 -> v36 (Insulation and ADP carried byte-equal; Piping gains its rules); 12e-3b: v36 -> v37 (Piping gains its insulation section; Insulation and ADP byte-equal)
);
const CFG: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET.category_configs.map((c) => [c.category_id, c]));
// SLICE 12e-6 (AC14): the LIVE asset, for the rules whose config keys v38 does not carry (R4 `choice_text`, R7
// `compose.outer_surface`); a case marked `v42` runs on it, on the panel's entry point and the pure pricer alike
const ASSET42 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
  new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v42.json", import.meta.url),
);
const CFG42: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET42.category_configs.map((c) => [c.category_id, c]));
const CONFIGS42 = new Map<string, RateCategoryConfig>(Object.entries(CFG42));
const ITEMS42: RateMasterItem[] = ASSET42.items.map((it) => ({ ...it, discipline: ASSET42.discipline } as RateMasterItem));
// SLICE 12e-6c: the LIVE asset, for the rules whose config keys only it carries (O3 / O4 read `choice_text`, v40+; U1 reads
// Insulation's `typed_entry`, v46); a case marked `live` runs on it, on the panel's entry point and the pure pricer alike
const ASSET_LIVE = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
  new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v46.json", import.meta.url),   // 12e-6c AC7: v46 (BEFORE, commit 1: v45)
);
const CFG_LIVE: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET_LIVE.category_configs.map((c) => [c.category_id, c]));
const CONFIGS_LIVE = new Map<string, RateCategoryConfig>(Object.entries(CFG_LIVE));
const ITEMS_LIVE: RateMasterItem[] = ASSET_LIVE.items.map((it) => ({ ...it, discipline: ASSET_LIVE.discipline } as RateMasterItem));
// ADP-1 (owner rulings 2026-10-19): v46 + this slice's changes (`applyAdp1`; the asset commit pins it EQUAL to v47); a case
// marked `adp1` runs on it, on the panel's entry point and the pure pricer alike
const ASSET_ADP1 = applyAdp1(ASSET_LIVE as any) as typeof ASSET_LIVE;
const CFG_ADP1: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET_ADP1.category_configs.map((c) => [c.category_id, c]));
const CONFIGS_ADP1 = new Map<string, RateCategoryConfig>(Object.entries(CFG_ADP1));
const ITEMS_ADP1: RateMasterItem[] = ASSET_ADP1.items.map((it) => ({ ...it, discipline: ASSET_ADP1.discipline } as RateMasterItem));
// ADP-2 (owner rulings H5 / H7 / B3): the ADP-1 config + this slice's changes (`applyAdp2`; the asset commit pins it EQUAL to
// v48); a case marked `adp2` runs on it, on the panel's entry point and the pure pricer alike
const ASSET_ADP2 = applyAdp2(ASSET_ADP1 as any) as typeof ASSET_LIVE;
const CFG_ADP2: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET_ADP2.category_configs.map((c) => [c.category_id, c]));
const CONFIGS_ADP2 = new Map<string, RateCategoryConfig>(Object.entries(CFG_ADP2));
const ITEMS_ADP2: RateMasterItem[] = ASSET_ADP2.items.map((it) => ({ ...it, discipline: ASSET_ADP2.discipline } as RateMasterItem));
// ADP-3b (owner B1; D1-D4): the ADP-2 config (= v48) + this slice's changes (`applyAdp3b`; the asset commit pins it EQUAL to
// v49); a case marked `adp3b` runs on it, on the panel's entry point and the pure pricer alike. No item changes.
const ASSET_ADP3B = applyAdp3b(ASSET_ADP2 as any) as typeof ASSET_LIVE;
const CFG_ADP3B: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET_ADP3B.category_configs.map((c) => [c.category_id, c]));
const CONFIGS_ADP3B = new Map<string, RateCategoryConfig>(Object.entries(CFG_ADP3B));
// ADP-4a (owner AC5; D10): HVAC v50 itself (v49 + the five "Other..." fields); a case marked `adp4a` runs on it, on the panel's
// entry point and the pure pricer alike
const ASSET_V50 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
  new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v50.json", import.meta.url),
);
const CFG_V50: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET_V50.category_configs.map((c) => [c.category_id, c]));
const CONFIGS_V50 = new Map<string, RateCategoryConfig>(Object.entries(CFG_V50));
const ITEMS_V50: RateMasterItem[] = ASSET_V50.items.map((it) => ({ ...it, discipline: ASSET_V50.discipline } as RateMasterItem));
// ADP-5a (owner rulings 2026-10-22): HVAC v51 itself (v50 + the curved grille default, `family_merge`, the depth_mm column gone); a
// case marked `adp5a` runs on it, on the panel's entry point and the pure pricer alike
const ASSET_V51 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] }>(
  new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v51.json", import.meta.url),
);
const CFG_V51: Record<string, RateCategoryConfig> = Object.fromEntries(ASSET_V51.category_configs.map((c) => [c.category_id, c]));
const CONFIGS_V51 = new Map<string, RateCategoryConfig>(Object.entries(CFG_V51));
const ITEMS_V51: RateMasterItem[] = ASSET_V51.items.map((it) => ({ ...it, discipline: ASSET_V51.discipline } as RateMasterItem));
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
  /** ADP-5a (HN-2 / HN-3): the notes of the heading directly above the row, as the panel's row context carries them */
  headingNotes?: string[];
  /** the rule's OWN line(s): every regex must appear in the panel's lines; none of `not` may */
  re: Array<string | RegExp>; not?: Array<string | RegExp>;
  /** lines that must appear in a block's WORKING -- the pricer's own output, never a display note (F-2: the reader's line must reach the pricer) */
  working?: Array<string | RegExp>;
  priced?: boolean;
  /** compare the panel's figures to the pure pricer's over the same assembled inputs (default true) */
  pure?: boolean;
  /** SLICE 12e-6: run on the live v42 asset (configs and items) instead of v38 */
  v42?: boolean;
  /** SLICE 12e-6c: run on the LIVE asset (v45, then v46) instead of v38 */
  live?: boolean;
  /** ADP-1: run on the ADP-1 config (v46 + `applyAdp1`, = v47) instead of v38 */
  adp1?: boolean;
  /** ADP-2: run on the ADP-2 config (the ADP-1 config + `applyAdp2`, = v48) instead of v38 */
  adp2?: boolean;
  /** ADP-3b: run on the ADP-2 config + ADP-3b (= v49) */
  adp3b?: boolean;
  /** ADP-4a: run on HVAC v50 (configs and items) */
  adp4a?: boolean;
  /** ADP-5a: run on HVAC v51 (configs and items) */
  adp5a?: boolean;
  /** ADP-4a (AC5): the family this case is named for, read by the family guard (default: the first item's family) */
  family?: string;
  /** ADP-4a (AC5): the row's figures, supply and install, exactly (the replay's own figures for the stored row) */
  figures?: [number, number];
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
  // ── SLICE 12e-4b (owner F-3): a bare number that could be an inch size refuses ──
  noUnit: "A pipe size written as a bare number that could be inches refuses",
  // ── SLICE 12e-4b (owner D-3 / F-1), generated from the two keys HVAC v38 adds ──
  asWritten: "A pipe type left unanswered is read from 'Pipe type as written'",
  nearPipe: "A pipe size within 0.1 mm of a stocked size counts as that size",
  // INVERTED at ADP-4a (owner AC1 generic fix: a full list, never "and N more"; U6 Piping line 17) by mechanical authority:
  // BEFORE "A Copper, MS and 2 more row stating its own figure in the class / wall thickness carries a line saying what was priced"
  readClass: "A Copper, MS, PVC, CPVC row stating its own figure in the class / wall thickness carries a line saying what was priced",
  // ── SLICE 12e-6 (U9, owner 2026-10-16 14:49): the lines AC14 adds -- one per new rule ──
  noneNamed: "A 'none of these' answer where the BoQ names no material takes the kind its row implies",
  altMaterial: "A material written with an alternative prices the stocked one",
  xlpe: "Cross-linked polyethylene, XPE, FR-XPE and a co-extruded jacket or covering are XLPE and refuse by name",
  rowKindSwap: "A row-kind material on the other row kind prices as the one for the row's unit",
  thkRange: "A thickness range takes the higher value",
  mmNb: "A pipe size in mm or NB is one size: the cladding is measured on the matched size",
  fixings: "Fixings and duct material in the row are not a cladding",
  coating: "A cladding written as a coating with no glass cloth refuses by name",
  twoTypes: "One pipe type written as two stocked kinds prices one of them",
  secDefaults: "Insulated Yes with no insulation facts opens the insulation section on Insulation's defaults",
  // ── SLICE 12e-6b (owner R1; U2): the one line it adds ──
  drainCpvc: "A drain pipe whose material the BoQ does not name prices as CPVC",
  // ── SLICE 12e-6c (owner rulings 2026-10-18): the lines it adds (U2's F-3 line on Insulation is `noUnit`; U1's is `typedSize`) ──
  rpuf: "RPUF with no material answered prices as Tubular Puf Insulation",
  giMap: "A cladding written as 'gi', 'g.i' with none answered is priced as the stocked one of its gauge",
  cloth: "A glass or fibre cloth facing copied as the cladding with none answered prices as the glass cloth cladding",
  // ── ADP-1 (owner rulings 2026-10-19; U6): the lines it adds. F4's is generated wherever the RPUF line is (code over keys
  // v38 carries); F3's wherever `choice_text` is (v40+); the rest from v47's keys ──
  rpufSheet: "RPUF on a per-sq.m row refuses by name",
  giFramework: "A GI frame or framework with perforated aluminium sheet, with no cladding answered, prices as GI Framework with perforated Al sheet",
  f1Above: "A pipe size written as a bare number whose inch reading is above the largest refuses",
  slotNos: "A per-number slot diffuser is priced from the per-metre rate",
  slotMissing: "A per-number slot diffuser without slot count refuses, naming what is missing",
  mixNos: "A per-number mixing box / LP plenum is priced from the per-sq.m rate",
  mixMissing: "A per-number mixing box / LP plenum without width, height, depth refuses, naming what is missing",
  slotsStock: "A slot count the catalogue does not stock refuses",
  pieceLen: "A piece length is typed in 'Piece length (m)', else read from the size",
  // INVERTED at ADP-4a (AC1: a title starts with a capital) by mechanical authority: BEFORE "without as the damper on a ..."
  slotSqm: "Without as the damper on a per-sq.m row of slot diffuser refuses",
  // ── ADP-2 (owner rulings H5 / H7 / B3; U6): the lines it adds; ADP-1's `mixMissing` is replaced by `mixEither` ──
  h5Air: "A damper not mentioned is decided by the air stream",
  mixArea: "A per-number mixing box / LP plenum with an area is priced from the per-sq.m rate",
  mixEither: "A per-number mixing box / LP plenum without an area, or length + width + height refuses, naming what is missing",
  boxSides: "The length, width and height are typed in their own boxes, else read from the size",
  areaFill: "An area is typed in 'Area (sq.m)', else read from the area band, at its largest value",
  neckOther: "A neck size the catalogue does not stock can be typed in 'Other...'",
  // ADP-2 H5 fix (a) (owner 2026-10-20): generated wherever a derive rule reads an air stream (v47's R13 too)
  h5Both: "A row naming supply and return air leaves the damper as read",
  // ── ADP-3a (owner 13:35 unit refusals / B6 / H2; AC6): the lines it adds, LAST on the tab, generated by the code from keys
  // every version carries -- the unstocked-combination line only where a category has a choice attribute (not Piping) ──
  a3Unit: "A kind not stocked in the row's unit refuses, naming the units it is stocked in",
  a3Unstocked: "An unstocked combination names only the facts the kind's products vary on",
  a3Either: "A per-number item needs Size (W x H), or Area band; with neither stated it refuses, naming both",
  // ── ADP-3b (owner B1; D1 / D2): the lines it adds, LAST on ADP's tab, generated from `face_side` (v49) ──
  faceBoxes: "The width and height are typed in their own boxes, else read from the size",
  faceThird: "A third part of a size never displaces the face",
  faceD2: "A kind that reads only the height, sized by one dimension written as a width, takes it as the height",
  // ADP-3a's either-or line, worded by the group the v49 boxes form
  a3EitherFace: "A per-number item needs Width + Height, or Area band; with neither stated it refuses, naming both",
  // ── ADP-3c (owner 2026-10-21 01:31 / 01:55): the one line it adds, LAST on ADP's tab, generated where a config has BOTH
  // face sides (v49 -- no config change; its cases run on the ADP-3b config, = v49) ──
  faceAny: "A two-part size on a Width + Height item is the face, whatever its parts are called",
  // ── ADP-4a (owner D1 / D2 / D3; AC1): ADP's tab in plain words. Renamed: the no-match line names an ITEM. Merged: the five
  // fitting lines (and ADP-2's neck "Other..." line) into one; the boxes / face / two-part lines (ADP-2 / ADP-3b / ADP-3c)
  // into one sizes line; ADP-2's air-stream line into the defaults line; line 5 (the unit not offered) into ADP-3a's unit
  // line. New: one line per rule the config already ran that the tab never named (each with a positive and a negative case) ──
  noSkuAdp: "An item the model could not match to any kind refuses",
  fitAdp: "Fitting the stated diameter, neck size, torque, panel ratio or plenum thickness to the catalogue",
  sizesAdp: "The sizes are typed in their own boxes, else read from the size as written",
  convWH: "Per-number row: per-sq.m rate x W x H",
  convBand: "Area band: per-sq.m rate x the band's maximum area",
  convGrille: "Per-metre grille: per-sq.m rate x height in metres",
  convPiece38: "Per piece: per-metre rate x 2.5 m standard length",
  convPiece: "Per piece: per-metre rate x the flexible duct length per piece",
  convMix38: "Per-number mixing box at any size: per-sq.m cost x 2(WH + HD + WD) + 150, rounded up, then the markup",
  crossTalk: "A per-number cross-talk is priced by its own formula",
  ratio: "A panel ratio is read from '1:N' as N",
  gauge: "A plenum thickness below 5 mm is a sheet gauge, not a thickness, and refuses",
  sqft: "An area written in square feet refuses",
  // ADP-5a (owner 2026-10-22, SCOPE-5a-1): the one line v51 adds, LAST on the ADP tab
  mergeSpigot: "A spigot named with a butterfly damper is priced as one butterfly damper",
  mcm: "A size written in metres or centimetres is read in millimetres",
};
/** Tab lines that are NOT panel-path rules (a catalogue / rate-master rule the pricer never reads), by name. */
const NOT_PANEL_RULES: Record<string, string> = {
  [T.derived]: "config.derived_rates is consumed by csv_exporter / the loader / RateMasterDataViewer, never by priceItemList",
};

const CASES: Case[] = [
  // ── INSULATION ──────────────────────────────────────────────────────────────────────────────────
  // 12e-4b (owner F-1, "option B"): Insulation's own pipe-size match takes a stocked size within 0.1 mm. Positive on
  // the model path and the calculator; negative: 0.11 away still takes the next size up, and says nothing of 0.1 mm.
  { id: "I15a", rule: T.nearPipe, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "22.3" })], re: ["pipe size 22.3 is 22.23 on the sheet (within 0.1 mm)"], priced: true },
  { id: "I15a-calc", rule: T.nearPipe, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "22.3" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["pipe size 22.3 is 22.23 on the sheet (within 0.1 mm)"], priced: true },
  { id: "I15b-neg", rule: T.nearPipe, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { pipe_size_mm: "22.34" })], re: ["pipe_size_mm:BoQ says 22.34 mm -> priced as 28.58 mm (next size up)"], not: ["within 0.1 mm"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["pipe size 22.34 is not on the sheet -> 28.58 (next size up"]
  { id: "I1a", rule: T.unit, cat: INS, path: "panel", kind: "pos", unit: "sqft", model: [THMI], re: ["per sq.ft: sq.m rate x 0.0929"], priced: true },
  { id: "I1a-calc", rule: T.unit, cat: INS, path: "calc", kind: "pos", edits: calc(THM, { cladding: "No", thickness_mm: "19" }), rowUnit: "sqft", re: ["per sq.ft: sq.m rate x 0.0929"], priced: true },
  { id: "I1b", rule: T.unit, cat: INS, path: "panel", kind: "pos", unit: "", model: [NIT], re: ["No unit on the BoQ row -> priced per metre"], priced: true },
  { id: "I1c", rule: T.unit, cat: INS, path: "panel", kind: "pos", unit: "R/O", model: [NIT], re: ["BoQ says R/O (rate only) -> priced per metre"], priced: true },
  { id: "I1d", rule: T.unit, cat: INS, path: "panel", kind: "pos", unit: "QRO - Sqm.", model: [THMI], re: ["BoQ says QRO - Sqm. (rate only) -> priced per sq.m"], priced: true },
  { id: "I1e", rule: T.unit, cat: INS, path: "panel", kind: "pos", unit: "", model: [{ item: CLO, cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" }], re: ["No unit on the BoQ row - this item is priced per metre or per sq.m; set the unit"], priced: false },
  { id: "I1f-neg", rule: T.unit, cat: INS, path: "panel", kind: "neg", unit: "nos", model: [NIT], // INVERTED at ADP-3a (owner 13:35, U5: a unit the kind is not stocked in names the unit and the stocked ones) by mechanical authority: BEFORE re ["unit 'nos' is not a count, area or length unit"]
    re: ["Nitrile Rubber Insulation is not stocked per 'nos' (stocked per metre) - price this row by hand"], priced: false },
  { id: "I2a", rule: T.kind, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [NIT], re: [], priced: true },
  { id: "I2b-neg", rule: T.kind, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { item: "Foo Insulation" })], re: ["no SKU in the catalogue for 'Foo Insulation' -- the user decides"], priced: false },
  { id: "I3a", rule: T.famNone, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { item: "None" })], re: ["family:Nitrile Rubber Insulation", "material not mentioned -> Nitrile by row kind" /* 12e-4b (G2 / G3): BEFORE "item not mentioned -> Nitrile Rubber Insulation (" */], not: ["item not mentioned"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field -- the heading names the kind, the rule line says why) by mechanical authority: BEFORE "insulation material not mentioned -> Nitrile Rubber Insulation (Nitrile by row kind"
  { id: "I3b", rule: T.famNone, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [m(THMI, { item: "None" })], re: ["family:Thermal Nitrile Insulation", "material not mentioned -> Nitrile by row kind" /* 12e-4b (G2 / G3): BEFORE "item not mentioned -> Thermal Nitrile Insulation (" */], not: ["item not mentioned"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field -- the heading names the kind, the rule line says why) by mechanical authority: BEFORE "insulation material not mentioned -> Thermal Nitrile Insulation (Nitrile by row kind"
  { id: "I3c", rule: T.famNone, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [m(THMI, { item: "None" })], headings: ["Acoustic lining of AHU room"], re: ["family:Acoustic Nitrile Insulation", "material not mentioned -> Nitrile by row kind" /* 12e-4b (G2 / G3): BEFORE "item not mentioned -> Acoustic Nitrile Insulation (" */], not: ["item not mentioned"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field -- the heading names the kind, the rule line says why) by mechanical authority: BEFORE "insulation material not mentioned -> Acoustic Nitrile Insulation (Nitrile by row kind"
  { id: "I3c-neg", rule: T.famNone, cat: INS, path: "panel", kind: "neg", unit: "sqm", model: [THMI], headings: ["Acoustic lining"], re: ["family:Thermal Nitrile Insulation"], not: ["not mentioned ->"], priced: true },
  { id: "I3a-calc", rule: T.famNone, cat: INS, path: "calc", kind: "pos", edits: [{ base: null, family: null, attrs: { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" }, other: ["pipe_size_mm"] }], rowUnit: "mts", re: ["family:Nitrile Rubber Insulation", "material not mentioned -> Nitrile by row kind" /* 12e-4b (G2 / G3): BEFORE "item not mentioned -> Nitrile Rubber Insulation (" */], not: ["item not mentioned"] },   // INVERTED at ADP-4a (AC3: stated once, on the field -- the heading names the kind, the rule line says why) by mechanical authority: BEFORE "insulation material not mentioned -> Nitrile Rubber Insulation (Nitrile by row kind"
  { id: "I4a", rule: T.noSku, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { item: "none of these", material_as_written: "XLPE foam" })], re: ["No SKU in the catalogue for XLPE foam - price this row by hand"], priced: false },
  // 12e-6 AC2 INVERTED by mechanical authority: BEFORE `model: [m(NIT, { item: "none of these" })]` alone -- a row naming NO
  // material now takes the row-kind default (I16*). The negative keeps its half: a material named (here in a heading) refuses.
  { id: "I4b-neg", rule: T.noSku, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { item: "none of these" })], headings: ["Rockwool insulation"], re: ["no SKU in the catalogue for 'none of these' -- the user decides"], not: ["price this row by hand"], priced: false },
  { id: "I5a", rule: T.unstocked, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { material_as_written: "EPDM closed cell" })], re: ["No SKU in the catalogue for EPDM closed cell - price this row by hand"], priced: false },
  { id: "I5b", rule: T.unstocked, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [NIT], ownNotes: ["Rockwool as per spec"], re: ["No SKU in the catalogue for ROCKWOOL - price this row by hand"], priced: false },
  { id: "I5c-neg", rule: T.unstocked, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [NIT], headings: ["Rockwool section"], re: [], not: ["No SKU in the catalogue"], priced: true },
  // 12e-6 AC5 INVERTED by mechanical authority: BEFORE `model: [NIT]` (Nitrile Rubber on a per-sq.m row) refusing "no SKU per
  // sq.m for Nitrile Rubber Insulation" -- that row now prices as Thermal Nitrile (I17a). A kind outside the row-kind pair still refuses.
  { id: "I6a", rule: T.ruleForUnit, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [PUFI], // INVERTED at ADP-3a (owner 13:35, U5: a unit the kind is not stocked in names the unit and the stocked ones) by mechanical authority: BEFORE re ["no SKU per sq.m for Tubular Puf Insulation"]
    re: ["Tubular Puf Insulation is not stocked per sq.m (stocked per metre) - price this row by hand"], priced: false },
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
  // 12e-6 AC8 INVERTED (wording only): BEFORE re ["range '25 to 50' -> its top value 50", "BoQ says 25 to 50 -> 50 mm (range"]
  { id: "I9d", rule: T.several, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(PUFI, { thickness_mm: "25 to 50" })], re: ["BoQ says 25 to 50 -> 50 mm (states a range"], not: ["its top value"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field -- the field note below carries it) by mechanical authority: BEFORE "'25 to 50' states a range - the higher, 50, is taken", 
  { id: "I9x-calc", rule: T.several, cat: INS, path: "calc", kind: "excluded", excludedBy: "U4", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "13 / 19 / 25", pipe_size_mm: "50" }, ["thickness_mm", "pipe_size_mm"]), rowUnit: "mts", re: ["Type the thickness as a single number in mm"], priced: false },
  { id: "I10a", rule: T.inches, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: '5/8"' })], re: ["15.88"], priced: true },
  { id: "I10b", rule: T.inches, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: '1-1/4"' })], re: ["31.75", "34.93"], priced: true },
  { id: "I10u", rule: T.inches, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "1¼\"" })], re: ["31.75", "34.93"], priced: true },
  { id: "I10b-calc", rule: T.inches, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: '1-1/4"' }, ["pipe_size_mm"]), rowUnit: "mts", re: ["31.75", "34.93"], priced: true },
  { id: "I10c-neg", rule: T.inches, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { thickness_mm: '3/4"' })], re: ["thickness stated in inches"], priced: false },
  { id: "I11a", rule: T.defaults, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { cladding: "None" })], re: ["cladding:cladding not mentioned -> without cladding"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["cladding not mentioned -> No ("]
  { id: "I11b", rule: T.defaults, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { thickness_mm: undefined })], re: ["thickness not mentioned -> 9 mm, then the ladder" /* 12e-3c (F7): BEFORE "thickness_mm not mentioned -> 9 ("; 12e-4b (G2): BEFORE "thickness not mentioned -> 9 (" */, "thickness_mm:Default 9 mm -> priced as 13 mm (the smallest size)"], not: ["thickness_mm not mentioned", "thickness not mentioned -> 9 ("], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE "thickness 9 is not on the sheet -> 13"]
  { id: "I11c-neg", rule: T.defaults, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { thickness_mm: "as per specification" })], re: ["no number in 'as per specification' for thickness"], not: ["not mentioned -> 9"], priced: false },
  { id: "I11a-calc", rule: T.defaults, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "None", thickness_mm: "19", pipe_size_mm: "50" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["cladding not mentioned -> No ("], priced: true },
  { id: "I11b-calc", rule: T.defaults, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", pipe_size_mm: "50" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["thickness not mentioned -> 9 mm, then the ladder" /* 12e-3c (F7): BEFORE "thickness_mm not mentioned -> 9 ("; 12e-4b (G2): BEFORE "thickness not mentioned -> 9 (" */], not: ["thickness_mm not mentioned", "thickness not mentioned -> 9 ("], priced: true },
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
  { id: "I15b-neg", rule: T.namedInRow, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { cladding: "None" })], headings: ["Aluminium cladding section"], re: ["cladding:cladding not mentioned -> without cladding"], not: ["cladding named in this row"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["cladding not mentioned -> No ("]
  { id: "I15c-neg", rule: T.namedInRow, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [NIT], description: "with 26G aluminium cladding", re: [], not: ["cladding named in this row"], priced: true },
  { id: "I16a", rule: T.readNotes, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [{ item: FGB, cladding: "No", thickness_mm: "25", material_as_written: "Fiberglass rigid board 32 kg/m3" }], re: ["BoQ says 32 kg/m3 -> priced as the 48 kg/m3 board"], priced: true },
  { id: "I16b-neg", rule: T.readNotes, cat: INS, path: "panel", kind: "neg", unit: "sqm", model: [{ item: FGB, cladding: "No", thickness_mm: "25", material_as_written: "Fiberglass board 48 kg/m3" }], re: [], not: ["priced as the 48 kg/m3 board"], priced: true },
  { id: "I17a", rule: T.fitPipe, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [NIT], re: ["pipe_size_mm:BoQ says 50 mm -> priced as 53.98 mm (next size up)"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["pipe size 50 is not on the sheet -> 53.98 (next size up"]
  { id: "I17a-calc", rule: T.fitPipe, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["pipe_size_mm:You typed 50 mm -> priced as 53.98 mm (next size up)"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["pipe size 50 is not on the sheet -> 53.98 (next size up"]
  { id: "I17b", rule: T.fitPipe, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "22.2" })], re: ["pipe size 22.2 is 22.23 on the sheet"], priced: true },
  { id: "I17c-neg", rule: T.fitPipe, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { pipe_size_mm: "65" })], re: ["pipe size 65 is above the largest size on the sheet (53.98)"], priced: false },
  { id: "I18a", rule: T.fitThk, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "19.05", thickness_mm: "20" })], re: ["thickness_mm:BoQ says 20 mm -> priced as 25 mm (next size up)"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["thickness 20 is not on the sheet -> 25 (next size up"]
  { id: "I18b", rule: T.fitThk, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "19.05", thickness_mm: "30" })], re: ["-> priced as 13 + 19 mm (32 mm, +2) -- above the largest stocked size (25 mm)"], priced: true },
  { id: "I18b-calc", rule: T.fitThk, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "30", pipe_size_mm: "19.05" }, ["thickness_mm"]), rowUnit: "mts", re: ["You typed 30 mm -> priced as 13 + 19 mm (32 mm, +2) -- above the largest stocked size (25 mm)"], priced: true },
  { id: "I18c-neg", rule: T.fitThk, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { pipe_size_mm: "19.05", thickness_mm: "200" })], re: ["thickness 200 is above the largest size on the sheet (25)"], priced: false },
  { id: "I19a", rule: T.steps, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [NIT], re: ["supply: pricing input: Aluminium sheet 26G (rate) = 450"], priced: true },
  { id: "I19b-neg", rule: T.steps, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { pipe_size_mm: "65" })], re: [], not: ["supply: pricing input"], priced: false },
  { id: "I20a", rule: T.crossRow, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [{ item: CLO, cladding: "26G Aluminium" }], re: ["the cladding-only SKU's own"], priced: true },
  { id: "I20b-neg", rule: T.crossRow, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [NIT], re: [], not: ["cladding-only SKU's own"], priced: true },
  // 12e-6 AC9 c INVERTED (wording only): BEFORE re ["supply: cladding: (aluminium sheet x overlap + glass cloth) x girth ="] on 26G Aluminium
  { id: "I21a", rule: T.computed, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [NIT], re: ["supply: cladding: aluminium sheet x overlap x girth ="], not: ["+ glass cloth) x girth"], priced: true },
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
  { id: "A1f-neg", rule: T.unit, cat: ADP, path: "panel", kind: "neg", unit: "kg", model: [{ family: "actuator", ul: "no", torque: "10" }], // INVERTED at ADP-3a (owner 13:35, U5: a unit the kind is not stocked in names the unit and the stocked ones) by mechanical authority: BEFORE re ["unit 'kg' is not a count, area or length unit"]
    re: ["actuator is not stocked per 'kg' (stocked per number) - price this row by hand"], priced: false },
  { id: "A1a-calc", rule: T.unit, cat: ADP, path: "calc", kind: "pos", edits: calc("VCD", { variant: "GI rectangular", size_mm: "600x600" }), rowUnit: "nos", re: ["per-number row: per-sq.m rate x W x H"], priced: true },
  { id: "A1h", rule: T.unit, cat: ADP, path: "panel", kind: "pos", unit: "rmt", model: [{ family: "linear grille", damper: "with", size_mm: "600x150" }], re: ["per-metre grille: per-sq.m rate x height in metres"], priced: true },
  { id: "A1i", rule: T.unit, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "flexible duct", insulated: "with", dia_mm: "200" }], re: ["per piece: per-metre rate x 2.5 m standard length"], priced: true },
  { id: "A1j", rule: T.unit, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "mixing box / LP plenum", insulated: "with", size_mm: "750x150x350" }], re: ["per-number mixing box at any size"], priced: true },
  { id: "A2a", rule: T.kind, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "grille, type not stated", damper: "with", size_mm: "600x150" }], re: ["family:linear grille"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field -- the heading shows the kind it prices as) by mechanical authority: BEFORE re: ["'grille, type not stated' prices as linear grille"]
  { id: "A2b-neg", rule: T.kind, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "linear grille", damper: "with", size_mm: "600x150" }], re: [], not: ["prices as"], priced: true },
  { id: "A3a", rule: T.noSkuAdp, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "none of these", damper: "with", dia_mm: "200" }], re: ["no SKU in the catalogue for 'none of these' -- the user decides"], priced: false },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.noSku
  { id: "A3b-neg", rule: T.noSkuAdp, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "200" }], re: [], not: ["the user decides"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.noSku
  { id: "A4a", rule: T.ruleForUnit, cat: ADP, path: "panel", kind: "pos", unit: "rmt", model: [{ family: "spigot", dia_mm: "200" }], // INVERTED at ADP-3a (owner 13:35, U5: a unit the kind is not stocked in names the unit and the stocked ones) by mechanical authority: BEFORE re ["no SKU per metre for spigot"]
    re: ["spigot is not stocked per metre (stocked per number) - price this row by hand"], priced: false },
  { id: "A4b-neg", rule: T.ruleForUnit, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "spigot", dia_mm: "200" }], re: [], not: ["no SKU per"], priced: true },
  { id: "A6a", rule: T.needs, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "actuator", ul: "no" }], re: ["no torque stated"], priced: false },
  { id: "A6b", rule: T.needs, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "round diffuser", damper: "with" }], re: ["no diameter stated"], priced: false },
  { id: "A6c-neg", rule: T.needs, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "actuator", ul: "no", torque: "10" }], re: [], not: [/no (torque|diameter|neck size|size) stated/], priced: true },
  { id: "A6a-calc", rule: T.needs, cat: ADP, path: "calc", kind: "pos", edits: calc("actuator", { ul: "no" }), rowUnit: "nos", re: ["no torque stated"], priced: false },
  { id: "A7a", rule: T.defaults, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "round diffuser", damper: "None", dia_mm: "200" }], re: ["damper:damper not mentioned (or not answered) = without"] /* 12e-4b (G2): BEFORE "damper not mentioned -> without (" */, not: ["damper not mentioned -> without ("], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["damper not mentioned -> without"]
  { id: "A7b", rule: T.defaults, cat: ADP, path: "panel", kind: "pos", unit: "rmt", model: [{ family: "flexible duct", dia_mm: "200" }], re: ["insulated:insulation not mentioned (or not answered) = insulated"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["insulated not mentioned -> with ("]
  { id: "A7c", rule: T.defaults, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "actuator", torque: "10" }], re: ["ul:UL not mentioned (or not answered) = non-UL"] /* 12e-4b (G2 / G3): BEFORE "ul not mentioned -> no (" */, not: ["ul not mentioned"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["UL listed not mentioned -> no (non-UL)"]
  { id: "A7d", rule: T.defaults, cat: ADP, path: "panel", kind: "pos", unit: "sqm", model: [{ family: "VCD" }], re: ["variant:VCD = GI rectangular; fire damper = without sleeve"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["variant not mentioned -> GI rectangular ("]
  { id: "A7e", rule: T.defaults, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "linear grille", damper: "None", air: "supply", size_mm: "600x150" }], re: ["damper:supply-air linear / plain grille = with damper"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["damper not mentioned -> with (supply-air linear / plain grille = with damper)"]
  { id: "A7e-neg", rule: T.defaults, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "linear grille", damper: "None", air: "return", size_mm: "600x150" }], re: ["damper:damper not mentioned (or not answered) = without"] /* 12e-4b (G2): BEFORE "damper not mentioned -> without (" */, not: ["supply-air linear", "damper not mentioned -> without ("], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["damper not mentioned -> without"]
  { id: "A7f-neg", rule: T.defaults, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "200" }], re: [], not: ["damper not mentioned"], priced: true },
  { id: "A7a-calc", rule: T.defaults, cat: ADP, path: "calc", kind: "pos", edits: calc("round diffuser", { damper: "None", dia_mm: "200" }), rowUnit: "nos", re: ["damper not mentioned -> without"] /* 12e-4b (G2): BEFORE "damper not mentioned -> without (" */, not: ["damper not mentioned -> without ("], priced: true },
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
  { id: "A9a", rule: T.fitAdp, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "220" }], re: ["dia_mm:BoQ says 220 mm -> priced as 250 mm (next size up)"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.fitDia   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["diameter 220 is not on the sheet -> 250 (next size up"]
  { id: "A9b-neg", rule: T.fitAdp, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "500" }], re: ["diameter 500 is above the largest size on the sheet (400)"], priced: false },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.fitDia
  { id: "A9a-calc", rule: T.fitAdp, cat: ADP, path: "calc", kind: "pos", edits: calc("round diffuser", { damper: "with", dia_mm: "220" }, ["dia_mm"]), rowUnit: "nos", re: ["dia_mm:You typed 220 mm -> priced as 250 mm (next size up)"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.fitDia   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["diameter 220 is not on the sheet -> 250 (next size up"]
  { id: "A10a", rule: T.fitAdp, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "square diffuser", damper: "with", neck_mm: "320" }], re: ["neck_mm:BoQ says 320 mm -> priced as 375 mm (next size up)"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.fitNeck   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["neck size 320 is not on the sheet -> 375 (next size up"]
  { id: "A10b-neg", rule: T.fitAdp, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "square diffuser", damper: "with", neck_mm: "500" }], re: ["neck size 500 is above the largest size on the sheet (450)"], priced: false },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.fitNeck
  { id: "A11a", rule: T.fitAdp, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "actuator", ul: "no", torque: "12" }], re: ["torque:BoQ says 12 Nm -> priced as 20 Nm (next size up)"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.fitTorque   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["torque 12 is not on the sheet -> 20 (next size up"]
  { id: "A11b-neg", rule: T.fitAdp, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "actuator", ul: "no", torque: "25" }], re: ["torque 25 is above the largest size on the sheet (20)"], priced: false },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.fitTorque
  { id: "A12a", rule: T.fitAdp, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "control panel", panel_ratio: "5" }], re: ["panel_ratio:BoQ says 5 -> priced as 6 (next size up)"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.fitRatio   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["panel ratio 5 is not on the sheet -> 6 (next size up"]
  { id: "A12b-neg", rule: T.fitAdp, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "control panel", panel_ratio: "13" }], re: ["panel ratio 13 is above the largest size on the sheet (12)"], priced: false },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.fitRatio
  { id: "A13a", rule: T.fitAdp, cat: ADP, path: "panel", kind: "pos", unit: "sqm", model: [{ family: "double-skin plenum", thickness_mm: "30" }], re: ["insulation_thickness_mm:BoQ says 30 mm -> priced as 50 mm (next size up)"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.fitPlenum   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["plenum thickness 30 is not on the sheet -> 50 (next size up"]
  { id: "A13b-neg", rule: T.fitAdp, cat: ADP, path: "panel", kind: "neg", unit: "sqm", model: [{ family: "double-skin plenum", thickness_mm: "60" }], re: ["plenum thickness 60 is above the largest size on the sheet (50)"], priced: false },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.fitPlenum
  { id: "A13a-calc", rule: T.fitAdp, cat: ADP, path: "calc", kind: "pos", edits: calc("double-skin plenum", { thickness_mm: "30" }, ["thickness_mm"]), rowUnit: "sqm", re: ["insulation_thickness_mm:BoQ says 30 mm -> priced as 50 mm (next size up)"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.fitPlenum   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["plenum thickness 30 is not on the sheet -> 50 (next size up"]
  { id: "A14a", rule: T.steps, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "200" }], re: ["supply: cost x (1 + the SKU's supply markup) = 1276, rounded up to the rupee"], priced: true },   // INVERTED at ADP-4a (AC2: no 'item supply:', no ROUNDUP) by mechanical authority: BEFORE re: ["item supply:"]
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
  { id: "P4c-neg", rule: T.unit, cat: PIP, path: "panel", kind: "neg", unit: "nos", model: [MS50], // INVERTED at ADP-3a (owner 13:35, U5: a unit the kind is not stocked in names the unit and the stocked ones) by mechanical authority: BEFORE re ["unit 'nos' is not a length unit"]
    re: ["MS is not stocked per 'nos' (stocked per metre) - price this row by hand"], not: ["count, area or length"], priced: false },
  { id: "P4a-calc", rule: T.unit, cat: PIP, path: "calc", kind: "pos", edits: calc("MS", { size_mm: "50" }), rowUnit: "mts", re: [], priced: true },
  // P1 the kind: stocked, mapped, refused, read off the row
  { id: "P1a", rule: T.kind, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [MS50], re: ["family:MS"], priced: true },
  { id: "P1b-neg", rule: T.kind, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "ABC", size_mm: "50" }], re: ["no SKU in the catalogue for 'ABC' -- the user decides"], priced: false },
  { id: "P1c", rule: T.pipeMap, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "GI", size_mm: "50" }], re: ["BoQ says GI -> priced as MS", "family:MS"], priced: true },
  { id: "P1c-calc", rule: T.pipeMap, cat: PIP, path: "calc", kind: "pos", edits: typedType("GI", { size_mm: "50" }), rowUnit: "mts", re: ["You typed GI -> priced as MS", "family:MS"], not: ["BoQ says"], priced: true }, // 12e-4c: was "BoQ says GI -> priced as MS"
  { id: "P1c2-calc", rule: T.pipeMap, cat: PIP, path: "calc", kind: "pos", edits: typedType("uPVC", { size_mm: "110" }, ["size_mm"]), rowUnit: "mts", re: ["You typed uPVC -> priced as PVC", "You typed 110 -> priced as 150 mm (next size up)"], not: ["BoQ says"], priced: true }, // 12e-4c: was "BoQ says uPVC -> priced as PVC"
  { id: "P1c3-calc", rule: T.pipeMap, cat: PIP, path: "calc", kind: "pos", edits: typedType("HDPE", { size_mm: "50" }), rowUnit: "mts", re: ["You typed HDPE -> priced as PVC", "family:PVC"], not: ["BoQ says"], priced: true }, // 12e-4c: was "BoQ says HDPE -> priced as PVC"
  { id: "P1d-neg", rule: T.pipeMap, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [MS50], re: ["family:MS"], not: ["priced as MS", "BoQ says"], priced: true },
  { id: "P1e", rule: T.pipeRefuse, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "SS", size_mm: "50" }], re: ["No SKU in the catalogue for SS pipe - price this row by hand"], priced: false },
  { id: "P1e-calc", rule: T.pipeRefuse, cat: PIP, path: "calc", kind: "pos", edits: typedType("SS", { size_mm: "50" }), rowUnit: "mts", re: ["No SKU in the catalogue for SS pipe - price this row by hand"], priced: false },
  { id: "P1e2-calc", rule: T.pipeRefuse, cat: PIP, path: "calc", kind: "pos", edits: typedType("ABC", { size_mm: "50" }), rowUnit: "mts", re: ["no SKU in the catalogue for 'ABC' -- the user decides"], priced: false },
  { id: "P1f-neg", rule: T.pipeRefuse, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "PVC", size_mm: "50" }], re: ["family:PVC"], not: ["No SKU in the catalogue", "the user decides"], priced: true },
  { id: "P1g", rule: T.pipeRow, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "None", size_mm: "50" }], description: "MS / GI pipe 50 mm dia with fittings", re: ["BoQ names MS / GI -> priced as MS", "family:MS"], priced: true },
  { id: "P1h", rule: T.pipeRow, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "None", size_mm: "50" }], description: "copper or PVC drain pipe 50 mm", re: [/BoQ allows Copper or PVC -> priced as (Copper|PVC), the lower cost/], not: ["two pipe types are named"], priced: true },
  // ^ 12e-6 R2 INVERTED by mechanical authority: BEFORE re ["two pipe types are named in this row (Copper, PVC) - pick the type"], priced: false
  { id: "P1i-neg", rule: T.pipeRow, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "None", size_mm: "50" }], description: "pipe 50 mm dia", headings: ["MS piping"], re: ["no pipe type could be told for this item"], not: ["BoQ names", "two pipe types"], priced: false },
  // 12e-4b (owner D-3): the BoQ's own word, read only when the pipe type itself is unanswered. Positive: a mapped word
  // prices with its line, a refused one refuses with its sentence; negative: an ANSWERED type wins over the word
  // (decision 3), and with neither a type nor a word the row keeps the old sentence.
  { id: "P1j", rule: T.asWritten, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type_as_written: "uPVC", size_mm: "25" }], re: ["BoQ says uPVC -> priced as PVC", "family:PVC"], priced: true },
  { id: "P1k", rule: T.asWritten, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type_as_written: "Stainless steel", size_mm: "25" }], re: ["No SKU in the catalogue for SS pipe - price this row by hand"], priced: false },
  { id: "P1l-neg", rule: T.asWritten, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "MS", pipe_type_as_written: "SS", size_mm: "50" }], re: ["family:MS"], not: ["No SKU in the catalogue for SS", "BoQ says SS"], priced: true },
  { id: "P1m-neg", rule: T.asWritten, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "None", pipe_type_as_written: "None", size_mm: "50" }], re: ["no pipe type could be told for this item"], not: ["BoQ says", "BoQ names"], priced: false },
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
  // 12e-4b (owner F-3; ruled in the run: x 25.4 OR x 25 within the type's stocked range; the size taken from a
  // unit-less pair goes through the same check). Positive on the model path, on the calculator and for a pair;
  // negative: the same number with its unit, and a bare number that cannot be an inch size (MS 13: 330 / 325 mm).
  { id: "P2k", rule: T.noUnit, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "CPVC", size_mm: "1" }], re: ["size 1 has no unit - price this row by hand"], not: ["the smallest size"], priced: false },
  { id: "P2k-calc", rule: T.noUnit, cat: PIP, path: "calc", kind: "pos", edits: calc("CPVC", { size_mm: "1" }, ["size_mm"]), rowUnit: "mts", re: ["size 1 has no unit - price this row by hand"], not: ["the smallest size"], priced: false },
  { id: "P2k-pair", rule: T.noUnit, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "MS", size_mm: "8/7" }], re: ["size 8 has no unit - price this row by hand"], priced: false },
  { id: "P2l-neg", rule: T.noUnit, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "CPVC", size_mm: "1 inch" }], re: ["BoQ says 1 inch -> 25.4 mm / 25 mm -> priced as 25 mm"], not: ["has no unit"], priced: true },
  { id: "P2m-neg", rule: T.noUnit, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "MS", size_mm: "13" }], re: ["BoQ says 13 -> priced as 19 mm (the smallest size)"], not: ["has no unit"], priced: true },
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
  { id: "S1a", rule: T.secToggle, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}`, insulated: "Yes" }], re: ["section:Insulation - priced by Insulation's rules", "sec.family:Nitrile Rubber Insulation", "sec.default:material not mentioned -> Nitrile by row kind"], not: ["sec.pick:", "could not tell cladding"], priced: true, pure: false },
  // ^ 12e-6 AC3 INVERTED by mechanical authority: BEFORE priced: false (the section refused "could not tell cladding")
  { id: "S1b-neg", rule: T.secToggle, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}` }], re: ["insulated:insulation not mentioned -> No"], not: ["section:"], priced: true },
  { id: "S1c-neg", rule: T.secToggle, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}`, insulated: "No" }], re: [], not: ["section:", "insulation not mentioned"], priced: true },
  { id: "S1a-calc", rule: T.secToggle, cat: PIP, path: "calc", kind: "pos", edits: calc("Copper", { size_mm: `5/8${INCH}`, insulated: "Yes" }, ["size_mm"]), rowUnit: "mts", re: ["section:Insulation - priced by Insulation's rules", "sec.pick:Choose the insulation material"], not: ["not mentioned -> Nitrile"], priced: false, pure: false },
  { id: "S2a", rule: T.secRules, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}` }, { section: "insulation", item: NR, cladding: "26G Aluminium", thickness_mm: "13" }], re: ["section:Insulation - priced by Insulation's rules", "sec.family:Nitrile Rubber Insulation", "sec.figures:324/224"], priced: true, pure: false },
  { id: "S2b-neg", rule: T.secRules, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}` }, { section: "insulation", item: NR, cladding: "26G Aluminium", thickness_mm: "abc" }], re: ["sec.thickness_mm:"], not: ["sec.figures:"], priced: false, pure: false },
  { id: "S3a", rule: T.secMirror, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "MS", size_mm: "25/32" }, { section: "insulation", item: NR, cladding: "No", thickness_mm: "13" }], re: ["BoQ says 25/32: states two sizes (25 / 32) - the higher, 32, is taken", "sec.pipe_size_mm:tag=from pipe", "sec.pipe_size_mm:From pipe: 32 mm"], priced: true, pure: false },
  { id: "S3b-neg", rule: T.secMirror, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "Copper", insulated: "Yes" }, { section: "insulation", item: NR, cladding: "No", thickness_mm: "13", pipe_size_mm: "41.28" }], re: ["no pipe size stated"], not: ["tag=from pipe", "From pipe:"], priced: false, pure: false },
  { id: "S4a", rule: T.secTotal, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "Copper", size_mm: `5/8${INCH}` }, { section: "insulation", item: NR, cladding: "26G Aluminium", thickness_mm: "13" }], re: ["total:1622/444", "lines:2 bad:0"], priced: true, pure: false },
  // SLICE 12e-3c (F10): the pricer's pipe quantity (2) reaches the model's insulation, tagged; a section with no pipe keeps its own amber 1
  { id: "S5a", rule: T.secQty, cat: PIP, path: "ptyped", kind: "pos", unit: "mts", model: [{ pipe_type: "MS", size_mm: "32" }, { section: "insulation", item: NR, cladding: "26G Aluminium", thickness_mm: "13" }], edits: ptyped({}, [], "2"), re: ["sec.qty:2 tag:from pipe", "x 2 per row unit"], not: ["sec.qty:1"], priced: true, pure: false },
  { id: "S5b-neg", rule: T.secQty, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "MS", size_mm: "32" }, { section: "insulation", item: NR, cladding: "No", thickness_mm: "13" }, { section: "insulation", item: NR, cladding: "No", thickness_mm: "13", pipe_size_mm: "41.28" }], edits: undefined, re: ["sec.qty:1 tag:from pipe amber:false", "sec.qty:1 tag:none amber:true"], priced: true, pure: false },
  { id: "S5c-neg", rule: T.secQty, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "MS", size_mm: "32" }], re: [], not: ["sec.qty:", "tag:from pipe"], priced: true },
  { id: "S4b-neg", rule: T.secTotal, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "MS", size_mm: "100" }, { section: "insulation", item: NR, cladding: "26G Aluminium", thickness_mm: "32" }], re: ["lines:2 bad:1"], not: ["total:"], priced: false, pure: false },
  // ── SLICE 12e-6 (AC14 / U9): one positive and one negative per new rule, on the panel's entry point ──
  { id: "I16a", rule: T.noneNamed, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { item: "none of these" })], re: ["family:Nitrile Rubber Insulation", "material not mentioned -> Nitrile by row kind"], not: ["no SKU in the catalogue"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["insulation material not mentioned -> Nitrile Rubber Insulation"]
  { id: "I16b-neg", rule: T.noneNamed, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { item: "none of these", material_as_written: "EPDM foam" })], re: ["No SKU in the catalogue for EPDM foam - price this row by hand"], priced: false },
  { id: "I16c-sec", rule: T.noneNamed, cat: PIP, path: "panel", kind: "pos", unit: "mts", v42: true, model: [{ pipe_type: "MS", size_mm: "50", insulated: "Yes" }, { section: "insulation", item: "none of these", cladding: "None", thickness_mm: "19" }], re: ["sec.family:Nitrile Rubber Insulation", "sec.default:material not mentioned -> Nitrile by row kind"], priced: true, pure: false },
  { id: "I17a", rule: T.rowKindSwap, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [m(NIT, { cladding: "No", pipe_size_mm: undefined })], re: ["priced as Thermal Nitrile Insulation (row is per sq.m)", "family:Thermal Nitrile Insulation"], priced: true },
  { id: "I17b-neg", rule: T.rowKindSwap, cat: INS, path: "panel", kind: "neg", unit: "sqm", model: [THMI], re: [], not: ["(row is per"], priced: true },
  { id: "I18a", rule: T.altMaterial, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { material_as_written: "closed cell nitrile rubber/XLPE tubular insulation" })], re: ["BoQ says closed cell nitrile rubber/XLPE tubular insulation -> priced as Nitrile Rubber Insulation"], not: ["No SKU in the catalogue"], priced: true },
  { id: "I18b", rule: T.altMaterial, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [{ item: ACO, cladding: "No", thickness_mm: "25", material_as_written: "open-cell acoustic foam / 32 kg fiberglass board" }], re: [/BoQ allows open-cell acoustic foam \/ 32 kg fiberglass board -> priced as .*, the lower cost/], priced: true },
  { id: "I18c-neg", rule: T.altMaterial, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { material_as_written: "XLPE tubular insulation" })], re: ["No SKU in the catalogue for XLPE tubular insulation - price this row by hand"], not: ["BoQ says XLPE"], priced: false },
  { id: "I19x", rule: T.xlpe, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { item: "none of these", material_as_written: "closed cell cross-linked polyethylene" })], re: ["No SKU in the catalogue for closed cell cross-linked polyethylene (XLPE) - price this row by hand"], not: ["closed cell polyethylene ->"], priced: false },
  { id: "I19y", rule: T.xlpe, cat: INS, path: "panel", kind: "pos", unit: "RMT", v42: true, model: [m(NIT, { cladding: "None", cladding_as_written: "co-extruded polymer jacket" })], re: ["No SKU in the catalogue for co-extruded polymer jacket (XLPE) - price this row by hand"], priced: false },
  { id: "I19z-neg", rule: T.xlpe, cat: INS, path: "panel", kind: "neg", unit: "RMT", v42: true, model: [m(NIT, { item: "none of these", material_as_written: "closed cell polyethylene" })], re: ["BoQ says closed cell polyethylene -> priced as Nitrile Rubber Insulation"], not: ["(XLPE)"], priced: true },
  { id: "I22a", rule: T.thkRange, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(PUFI, { thickness_mm: "25-50mm" })], re: ["thickness_mm:BoQ says 25-50mm -> 50 mm (states a range - the higher, 50, is taken)"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["'25-50mm' states a range - the higher, 50, is taken"]
  { id: "I22b-neg", rule: T.thkRange, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { pipe_size_mm: "40-50" })], re: ["pipe size: range '40-50' -> its top value 50"], not: ["states a range"], priced: true },
  { id: "I25a", rule: T.mmNb, cat: INS, path: "panel", kind: "pos", unit: "RMT", v42: true, model: [m(NIT, { pipe_size_mm: "50 mm dia" })], re: ["cladding: measured on the matched size 53.98 (mm = NB: the size as read, 50, is not an outside diameter)"], not: ["as read 50 (not the"], priced: true },
  { id: "I25b", rule: T.mmNb, cat: PIP, path: "panel", kind: "pos", unit: "mts", v42: true, model: [{ pipe_type: "MS", size_mm: "50", insulated: "Yes" }, { section: "insulation", item: NR, cladding: "26G Aluminium", thickness_mm: "19" }], re: ["sec.cladding: measured on the matched size 53.98 (mm = NB: the size as read, 50, is not an outside diameter)"], priced: true, pure: false },
  { id: "I25c-neg", rule: T.mmNb, cat: INS, path: "panel", kind: "neg", unit: "RMT", v42: true, model: [m(NIT, { pipe_size_mm: "50 mm O.D." })], re: ["cladding: measured on the pipe size as read 50 (not the 53.98 it was priced at)"], not: ["matched size"], priced: true },
  { id: "I25d-neg", rule: T.mmNb, cat: PIP, path: "panel", kind: "neg", unit: "mts", v42: true, model: [{ pipe_type: "Copper", size_mm: "40", insulated: "Yes" }, { section: "insulation", item: NR, cladding: "26G Aluminium", thickness_mm: "19" }], re: ["sec.cladding: measured on the pipe size as read 40 (not the 41.28 it was priced at)"], not: ["matched size"], priced: true, pure: false },
  { id: "I26a", rule: T.fixings, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [m(THMI, { cladding: "None" })], ownNotes: ["on aluminum and GI duct; fixed with GI strip at a 1 m grid and 'C' shape GI frame"], re: [], not: ["cladding named in this row but not read"], priced: true },
  { id: "I26b-neg", rule: T.fixings, cat: INS, path: "panel", kind: "neg", unit: "sqm", model: [m(THMI, { cladding: "None" })], ownNotes: ["with 26G aluminium sheet cladding"], re: ["cladding named in this row but not read - set the cladding"], priced: false },
  { id: "I27a", rule: T.coating, cat: INS, path: "panel", kind: "pos", unit: "RMT", v42: true, model: [m(NIT, { cladding: "None", cladding_as_written: "polyshield coating" })], re: ["No SKU in the catalogue for polyshield coating - price this row by hand"], priced: false },
  { id: "I27b-neg", rule: T.coating, cat: INS, path: "panel", kind: "neg", unit: "RMT", v42: true, model: [m(NIT, { cladding: "Glass Cloth with paint", cladding_as_written: "two coats of fire retardant coating" })], re: ["supply: cladding: glass cloth x girth ="], not: ["No SKU in the catalogue"], priced: true },
  { id: "P6a", rule: T.twoTypes, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "None", pipe_type_as_written: "CPVC / UPVC", size_mm: "25" }], re: ["BoQ allows CPVC or uPVC -> priced as CPVC", "family:CPVC"], not: ["the lower cost"], priced: true },
  { id: "P6b", rule: T.twoTypes, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "None", pipe_type_as_written: "MS / Copper", size_mm: "25" }], re: [/BoQ allows MS or Copper -> priced as (MS|Copper), the lower cost/], priced: true },
  { id: "P6c-neg", rule: T.twoTypes, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "None", pipe_type_as_written: "MS / GI", size_mm: "25" }], re: ["BoQ names MS / GI -> priced as MS"], not: ["BoQ allows"], priced: true },
  { id: "S6a", rule: T.secDefaults, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "MS", size_mm: "50", insulated: "Yes" }], re: ["sec.default:material not mentioned -> Nitrile by row kind", "sec.cladding:cladding not mentioned -> without cladding"], not: ["could not tell cladding"], priced: true, pure: false },   // INVERTED at ADP-4a (AC3: stated once, on the field -- the section's field) by mechanical authority: BEFORE "sec.cladding not mentioned -> No (without cladding)"]
  { id: "S6b-neg", rule: T.secDefaults, cat: PIP, path: "calc", kind: "neg", edits: calc("MS", { size_mm: "50", insulated: "Yes" }, ["size_mm"]), rowUnit: "mts", re: ["sec.pick:Choose the insulation material"], priced: false, pure: false },
  // ── SLICE 12e-6b (owner R1; U2): an untold drain -> CPVC; a named material keeps its rule; the calculator has no row text ──
  { id: "P8a", rule: T.drainCpvc, cat: PIP, path: "panel", kind: "pos", unit: "mts", model: [{ pipe_type: "None", pipe_type_as_written: "DRAIN", size_mm: "25MM DIA" }], description: "DRAIN PIPE 25MM DIA WITH 6 MM INSULATION", re: ["drain pipe, no material stated -> priced as CPVC", "family:CPVC"], priced: true },
  { id: "P8b-neg", rule: T.drainCpvc, cat: PIP, path: "panel", kind: "neg", unit: "mts", model: [{ pipe_type: "None", pipe_type_as_written: "uPVC", size_mm: "25" }], description: "Drain pipe 25 mm", re: ["BoQ says uPVC -> priced as PVC", "family:PVC"], not: ["no material stated"], priced: true },
  // ── SLICE 12e-6c (owner rulings 2026-10-18): one positive and one negative per rule, panel and calculator ──
  // U2: F-3 on Insulation's pipe size (every axis reading inches); a bare 4 is no inch size Nitrile stocks (101.6 > 53.98)
  { id: "C2a", rule: T.noUnit, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "1" })], re: ["size 1 has no unit - price this row by hand"], priced: false },
  { id: "C2b-calc", rule: T.noUnit, cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "2" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["size 2 has no unit - price this row by hand"], priced: false },
  { id: "C2c-neg", rule: T.noUnit, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { pipe_size_mm: "4" })], re: ["pipe_size_mm:BoQ says 4 mm -> priced as 6.35 mm (the smallest size)"], not: ["has no unit"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["pipe size 4 is not on the sheet -> 6.35 (the smallest size"]
  { id: "C2d-neg", rule: T.noUnit, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { pipe_size_mm: "1 inch" })], not: ["has no unit"], re: ["28.58"], priced: true },
  // R: RPUF with no material answered -> Tubular PUF, the next thickness up; 30 mm on a small pipe refuses; an answer stands
  { id: "C1a", rule: T.rpuf, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [{ item: "none of these", cladding: "No", thickness_mm: "40", pipe_size_mm: "100", material_as_written: "RPUF" }], re: ["BoQ says RPUF -> priced as Tubular Puf Insulation", "family:Tubular Puf Insulation"], not: ["No SKU in the catalogue for RPUF"], priced: true },
  { id: "C1b", rule: T.rpuf, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [{ item: "None", cladding: "No", thickness_mm: "40", pipe_size_mm: "100" }], description: "RPUF insulation 40 mm thick", re: ["BoQ says RPUF -> priced as Tubular Puf Insulation"], not: ["not mentioned -> Nitrile"], priced: true },
  { id: "C1c-neg", rule: T.rpuf, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [m(NIT, { material_as_written: "RPUF" })], re: ["family:Nitrile Rubber Insulation"], not: ["priced as Tubular Puf"], priced: true },
  { id: "C1d-neg", rule: T.rpuf, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [{ item: "none of these", cladding: "No", thickness_mm: "30", pipe_size_mm: "40", material_as_written: "RPUF" }], re: ["BoQ says RPUF -> priced as Tubular Puf Insulation", "thickness 30 is above the largest size on the sheet"], priced: false },
  // O3: a fixing is not a cladding, before R2's GI map reads the words; "26 G GI cladding" still maps (live: v40+ `choice_text`)
  { id: "C3a", rule: T.giMap, cat: INS, path: "panel", kind: "pos", unit: "RMT", live: true, model: [m(NIT, { cladding: "None", cladding_as_written: "26 G GI cladding" })], re: ["BoQ says 26 G GI cladding -> priced as 26G Aluminium"], priced: true },
  { id: "C3b-neg", rule: T.giMap, cat: INS, path: "panel", kind: "neg", unit: "RMT", live: true, model: [m(NIT, { cladding: "None", cladding_as_written: "GI strip at 1 m grid" })], re: ["cladding:cladding not mentioned -> without cladding"], not: ["priced as 26G Aluminium"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["cladding not mentioned -> No (without cladding)"]
  // O4: a copied cloth facing with the cladding unanswered -> the glass-cloth cladding; an answered cladding stands
  { id: "C4a", rule: T.cloth, cat: INS, path: "panel", kind: "pos", unit: "RMT", live: true, model: [m(NIT, { cladding: "None", cladding_as_written: "factory laminated fire resistant fibre cloth fabric" })], re: ["BoQ says factory laminated fire resistant fibre cloth fabric -> priced as Glass Cloth with paint"], priced: true },
  { id: "C4b", rule: T.cloth, cat: INS, path: "panel", kind: "pos", unit: "RMT", live: true, model: [m(NIT, { cladding: "None", cladding_as_written: "aluminium sheet with reinforced glass cloth" })], re: ["BoQ says aluminium sheet with reinforced glass cloth -> priced as 26G Aluminium with Glass Cloth"], priced: true },
  { id: "C4c", rule: T.cloth, cat: INS, path: "panel", kind: "pos", unit: "RMT", live: true, model: [m(NIT, { cladding: "None", cladding_as_written: "24 G aluminium with glass cloth facing" })], re: ["BoQ says 24 G aluminium with glass cloth facing -> priced as 24G Aluminium with Glass Cloth"], priced: true },
  { id: "C4d-neg", rule: T.cloth, cat: INS, path: "panel", kind: "neg", unit: "RMT", live: true, model: [m(NIT, { cladding: "26G Aluminium", cladding_as_written: "reinforced glass cloth" })], re: [], not: ["priced as Glass Cloth", "priced as 26G Aluminium with Glass Cloth"], priced: true },
  // U1 (live: v46's `typed_entry` on Insulation's pipe size): a TYPED range refuses; the model's range is read as before
  { id: "C5a", rule: T.typedSize, cat: INS, path: "ptyped", kind: "pos", unit: "RMT", live: true, model: [NIT], edits: ptyped({ pipe_size_mm: "40-50" }, ["pipe_size_mm"]), re: ["Type one pipe size, in mm or inches"], priced: false },
  { id: "C5b-calc", rule: T.typedSize, cat: INS, path: "calc", kind: "pos", live: true, edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50 mm O.D." }, ["pipe_size_mm"]), rowUnit: "mts", re: ["Type one pipe size, in mm or inches"], priced: false },
  { id: "C5c-neg", rule: T.typedSize, cat: INS, path: "panel", kind: "neg", unit: "RMT", live: true, model: [m(NIT, { pipe_size_mm: "40-50" })], re: ["pipe size: range '40-50' -> its top value 50"], not: ["Type one pipe size"], priced: true },
  // ── ADP-1 (owner rulings 2026-10-19): one positive and one negative case per new line, from the panel's entry point ──
  { id: "AD1a", rule: T.slotNos, cat: ADP, path: "panel", kind: "pos", unit: "Nos", adp1: true, model: [{ family: "slot diffuser", damper: "with", slot_count: "3", size_mm: "1500 mm long" }], re: ["per-number slot diffuser: the per-metre rate (slots and damper) x the piece length in metres", "supply: 1520 x 1.5 = 2280"], priced: true },   // INVERTED at ADP-4a (AC2: no 'H3' tag) by mechanical authority: BEFORE "H3 per-number slot diffuser: the per-metre rate
  { id: "AD1a-calc", rule: T.slotNos, cat: ADP, path: "calc", kind: "pos", adp1: true, edits: calc("slot diffuser", { damper: "with", slot_count: "3", piece_length_m: "1.5" }), rowUnit: "nos", re: ["supply: 1520 x 1.5 = 2280"], priced: true },
  { id: "AD1b-neg", rule: T.slotNos, cat: ADP, path: "panel", kind: "neg", unit: "RMT", adp1: true, model: [{ family: "slot diffuser", damper: "with", slot_count: "3", size_mm: "1500 mm long" }], re: [], not: ["x the piece length in metres", "1520 x 1.5"], priced: true },
  { id: "AD2a", rule: T.slotMissing, cat: ADP, path: "panel", kind: "pos", unit: "Nos", adp1: true, model: [{ family: "slot diffuser", damper: "with", size_mm: "600x600" }], re: ["per-number row: no slot count stated to convert the per-metre rate"], priced: false },
  { id: "AD2b-neg", rule: T.slotMissing, cat: ADP, path: "panel", kind: "neg", unit: "Nos", adp1: true, model: [{ family: "slot diffuser", damper: "with", slot_count: "2", size_mm: "600x600" }], re: [], not: ["stated to convert"], priced: true },
  { id: "AD3a", rule: T.mixNos, cat: ADP, path: "panel", kind: "pos", unit: "Nos", adp1: true, model: [{ family: "mixing box / LP plenum", insulated: "None", size_mm: "450x450x350" }], re: ["supply: 1230 x 2 x (450 x 450 + 450 x 350 + 450 x 350) / 1,000,000 + 150 = 1423.05", "supply: pricing input: Mixing box supply adder = 150"], priced: true },   // INVERTED at ADP-4a (AC2: 1,000,000, no '(amount)') by mechanical authority: BEFORE re: ["supply: 1230 x 2 x (450 x 450 + 450 x 350 + 450 x 350) / 10^6 + 150 = 1423.05", "supply: pricing input: Mixing box supply adder (amount) = 150"]
  { id: "AD3a-calc", rule: T.mixNos, cat: ADP, path: "calc", kind: "pos", adp1: true, edits: calc("mixing box / LP plenum", { insulated: "with", size_mm: "450x450x350" }, ["size_mm"]), rowUnit: "nos", re: ["/ 1,000,000 + 150 = 1423.05"], priced: true },   // INVERTED at ADP-4a (AC2: 1,000,000) by mechanical authority: BEFORE re: ["/ 10^6 + 150 = 1423.05"]
  { id: "AD3b-neg", rule: T.mixNos, cat: ADP, path: "panel", kind: "neg", unit: "sqm", adp1: true, model: [{ family: "mixing box / LP plenum", insulated: "with" }], re: [], not: ["/ 10^6 + 150", "Mixing box supply adder"], priced: true },
  { id: "AD4a", rule: T.mixMissing, cat: ADP, path: "panel", kind: "pos", unit: "EA", adp1: true, model: [{ family: "mixing box / LP plenum", insulated: "None", size_mm: "2200 mm Length" }], re: ["per-number row: no width and height stated to convert the per-sq.m rate"], priced: false },
  { id: "AD4a-calc", rule: T.mixMissing, cat: ADP, path: "calc", kind: "pos", adp1: true, edits: calc("mixing box / LP plenum", { insulated: "with", size_mm: "2200 mm length" }, ["size_mm"]), rowUnit: "nos", re: ["per-number row: no width and height stated to convert the per-sq.m rate"], priced: false },
  { id: "AD4b-neg", rule: T.mixMissing, cat: ADP, path: "panel", kind: "neg", unit: "Nos", adp1: true, model: [{ family: "mixing box / LP plenum", insulated: "with", size_mm: "600x600x400" }], re: [], not: ["stated to convert"], priced: true },
  { id: "AD5a", rule: T.slotsStock, cat: ADP, path: "panel", kind: "pos", unit: "RMT", adp1: true, model: [{ family: "slot diffuser", damper: "None", slot_count: "4 Slot" }], re: ["No SKU for a 4-slot diffuser - price this row by hand"], priced: false },
  { id: "AD5b-neg", rule: T.slotsStock, cat: ADP, path: "panel", kind: "neg", unit: "RMT", adp1: true, model: [{ family: "slot diffuser", damper: "None", slot_count: "3 Slot" }], re: [], not: ["-slot diffuser"], priced: true },
  { id: "AD6a", rule: T.pieceLen, cat: ADP, path: "panel", kind: "pos", unit: "Nos", adp1: true, model: [{ family: "slot diffuser", damper: "with", slot_count: "3", size_mm: "1000x150" }], re: ["BoQ says 1000x150 -> 1 m (the longest side)"], priced: true },
  { id: "AD6a-calc", rule: T.pieceLen, cat: ADP, path: "calc", kind: "pos", adp1: true, edits: calc("slot diffuser", { damper: "with", slot_count: "3", piece_length_m: "1500 mm" }), rowUnit: "nos", re: ["piece length: 1500 mm read as 1.5 m"], priced: true },
  { id: "AD6b-neg", rule: T.pieceLen, cat: ADP, path: "panel", kind: "neg", unit: "Nos", adp1: true, model: [{ family: "slot diffuser", damper: "with", slot_count: "3", size_mm: "75mm" }], re: ["piece_length_m:no piece length stated - priced at 1 m"], not: ["BoQ says 75mm"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["piece length not mentioned -> 1 (no piece length stated - priced at 1 m)"]
  { id: "AD7a", rule: T.slotSqm, cat: ADP, path: "panel", kind: "pos", unit: "sqm", adp1: true, model: [{ family: "slot diffuser", damper: "None" }], re: ["No SKU for a slot diffuser per sq.m without damper - price this row by hand"], priced: false },
  { id: "AD7b-neg", rule: T.slotSqm, cat: ADP, path: "panel", kind: "neg", unit: "sqm", adp1: true, model: [{ family: "slot diffuser", damper: "with" }], re: [], not: ["per sq.m without damper"], priced: true },
  // ── ADP-2 (owner rulings H5 / H7 / B3): one positive and one negative case per new line, from the panel's entry point ──
  { id: "AE1a", rule: T.defaults, cat: ADP, path: "panel", kind: "pos", unit: "Nos", adp2: true, model: [{ family: "square diffuser", air: "supply", damper: "None", neck_mm: "450 x 450" }], re: ["supply air, damper not mentioned -> with damper"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.h5Air
  { id: "AE1a-ret", rule: T.defaults, cat: ADP, path: "panel", kind: "pos", unit: "RMT", adp2: true, model: [{ family: "slot diffuser", air: "return", damper: "None", slot_count: "3" }], re: ["return air, damper not mentioned -> without damper"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.h5Air
  { id: "AE1a-calc", rule: T.defaults, cat: ADP, path: "calc", kind: "pos", adp2: true, edits: calc("slot diffuser", { air: "supply", damper: "None" }), rowUnit: "sqm", re: ["supply air, damper not mentioned -> with damper"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.h5Air
  { id: "AE1b-neg", rule: T.defaults, cat: ADP, path: "panel", kind: "neg", unit: "Nos", adp2: true, model: [{ family: "square diffuser", air: "supply", damper: "without", neck_mm: "450 x 450" }], re: [], not: ["damper not mentioned"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.h5Air
  { id: "AE1c", rule: T.h5Both, cat: ADP, path: "panel", kind: "pos", unit: "No", adp2: true, description: "Aluminium powder coated Supply / Return air diffuser of 450x450 mm neck size", model: [{ family: "square diffuser", air: "supply", damper: "None", neck_mm: "450 x 450" }], re: ["BoQ names supply and return air -> damper as read (not mentioned -> without)"], not: ["supply air, damper not mentioned"], priced: true },
  { id: "AE1c-head", rule: T.h5Both, cat: ADP, path: "panel", kind: "pos", unit: "Nos", adp2: true, description: "375 x 375mm neck size", headings: ["Supply & return air diffusers with 600 x 600mm size."], model: [{ family: "square diffuser", air: "supply", damper: "None", neck_mm: "375 x 375" }], re: ["BoQ names supply and return air -> damper as read (not mentioned -> without)"], priced: true },
  { id: "AE1d-neg", rule: T.h5Both, cat: ADP, path: "panel", kind: "neg", unit: "Nos", adp2: true, description: "Aluminium powder coated supply air diffuser 450x450", headings: ["Supply & return air diffusers"], model: [{ family: "square diffuser", air: "supply", damper: "None", neck_mm: "450 x 450" }], re: ["supply air, damper not mentioned -> with damper"], not: ["BoQ names supply and return air"], priced: true },
  { id: "AE1d-neg2", rule: T.h5Both, cat: ADP, path: "panel", kind: "neg", unit: "Nos", adp2: true, description: "Supply and installation of 450 x 450 diffuser", model: [{ family: "square diffuser", air: "supply", damper: "None", neck_mm: "450 x 450" }], re: ["supply air, damper not mentioned -> with damper"], not: ["BoQ names supply and return air"], priced: true },
  { id: "AE2a", rule: T.mixArea, cat: ADP, path: "panel", kind: "pos", unit: "Nos", adp2: true, model: [{ family: "mixing box / LP plenum", insulated: "with", area_band: "up to 0.5 sqm" }], re: ["per-number mixing box / LP plenum with an area", "supply: 1230 x 0.5 = 615"], not: ["supply adder"], priced: true },   // INVERTED at ADP-4a (AC2: no 'H7' tag) by mechanical authority: BEFORE "H7 per-number mixing box / LP plenum with an area"
  { id: "AE2a-calc", rule: T.mixArea, cat: ADP, path: "calc", kind: "pos", adp2: true, edits: calc("mixing box / LP plenum", { insulated: "with", plenum_area_sqm: "2.5" }), rowUnit: "nos", re: ["supply: 1230 x 2.5 = 3075"], not: ["supply adder"], priced: true },
  { id: "AE2b-neg", rule: T.mixArea, cat: ADP, path: "panel", kind: "neg", unit: "Nos", adp2: true, model: [{ family: "mixing box / LP plenum", insulated: "with", size_mm: "450x450x350" }], re: ["/ 1,000,000 + 150 = 1423.05"], not: ["with an area"], priced: true },   // INVERTED at ADP-4a (AC2: 1,000,000) by mechanical authority: BEFORE re: ["/ 10^6 + 150 = 1423.05"]
  { id: "AE3a", rule: T.mixEither, cat: ADP, path: "panel", kind: "pos", unit: "EA", adp2: true, model: [{ family: "mixing box / LP plenum", insulated: "None", size_mm: "3000 mm Length" }], re: ["mixing box / LP plenum needs an area, or length + width + height - width and height not stated - price this row by hand"], priced: false },
  { id: "AE3a-calc", rule: T.mixEither, cat: ADP, path: "calc", kind: "pos", adp2: true, edits: calc("mixing box / LP plenum", { insulated: "with", plenum_length_mm: "2200" }), rowUnit: "nos", re: ["needs an area, or length + width + height - width and height not stated"], priced: false },
  { id: "AE3b-neg", rule: T.mixEither, cat: ADP, path: "panel", kind: "neg", unit: "Nos", adp2: true, model: [{ family: "mixing box / LP plenum", insulated: "with", size_mm: "600x600x400" }], re: [], not: ["needs an area, or"], priced: true },
  { id: "AE4a", rule: T.sizesAdp, cat: ADP, path: "panel", kind: "pos", unit: "NOS", adp2: true, model: [{ family: "mixing box / LP plenum", insulated: "None", size_mm: "900x200x350mm Ht." }], re: ["plenum_height_mm:BoQ says 900x200x350mm Ht. -> 350 mm (the height as written)", "plenum_length_mm:BoQ says 900x200x350mm Ht. -> 900 mm (the first of length x width x height)"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.boxSides   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["height: BoQ says 900x200x350mm Ht. -> 350 mm (the height as written)", "length: BoQ says 900x200x350mm Ht. -> 900 mm (the first of length x width x height)"]
  { id: "AE4b-neg", rule: T.sizesAdp, cat: ADP, path: "calc", kind: "neg", adp2: true, edits: calc("mixing box / LP plenum", { insulated: "with", plenum_length_mm: "450", plenum_width_mm: "450", plenum_height_mm: "350" }), rowUnit: "nos", re: ["/ 1,000,000 + 150 = 1423.05"], not: ["BoQ says"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.boxSides   // INVERTED at ADP-4a (AC2: 1,000,000) by mechanical authority: BEFORE re: ["/ 10^6 + 150 = 1423.05"]
  { id: "AE5a", rule: T.areaFill, cat: ADP, path: "panel", kind: "pos", unit: "Nos", adp2: true, model: [{ family: "mixing box / LP plenum", insulated: "with", area_band: "up to 0.5 sqm" }], re: ["plenum_area_sqm:BoQ says up to 0.5 sqm -> priced at 0.5 sq.m (the largest value)"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["area: BoQ says up to 0.5 sqm -> priced at 0.5 sq.m (the largest value)"]
  { id: "AE5b-neg", rule: T.areaFill, cat: ADP, path: "calc", kind: "neg", adp2: true, edits: calc("mixing box / LP plenum", { insulated: "with", plenum_area_sqm: "2.5" }), rowUnit: "nos", re: ["supply: 1230 x 2.5 = 3075"], not: ["BoQ says"], priced: true },
  { id: "AE6a-ptyped", rule: T.fitAdp, cat: ADP, path: "ptyped", kind: "pos", unit: "Nos", adp2: true, model: [{ family: "square diffuser", damper: "without", neck_mm: "300 x 300" }], edits: ptyped({ neck_mm: "225" }, ["neck_mm"]), re: [/225 mm -> priced as 300 mm/], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.neckOther
  { id: "AE6a-calc", rule: T.fitAdp, cat: ADP, path: "calc", kind: "pos", adp2: true, edits: calc("square diffuser", { damper: "without", neck_mm: "600" }, ["neck_mm"]), rowUnit: "nos", re: ["neck size 600 is above the largest size on the sheet (450)"], priced: false },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.neckOther
  { id: "AE6b-neg", rule: T.fitAdp, cat: ADP, path: "ptyped", kind: "neg", unit: "Nos", adp2: true, model: [{ family: "square diffuser", damper: "without", neck_mm: "300 x 300" }], edits: ptyped({ neck_mm: "375" }, ["neck_mm"]), re: [], not: [/priced as/], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.neckOther
  { id: "AF1a", rule: T.f1Above, cat: INS, path: "panel", kind: "pos", unit: "RMT", adp1: true, model: [m(NIT, { pipe_size_mm: "4" })], re: ["size 4 has no unit - price this row by hand"], priced: false },
  { id: "AF1a-calc", rule: T.f1Above, cat: INS, path: "calc", kind: "pos", adp1: true, edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "4" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["size 4 has no unit - price this row by hand"], priced: false },
  { id: "AF1b-neg", rule: T.f1Above, cat: INS, path: "panel", kind: "neg", unit: "RMT", adp1: true, model: [m(NIT, { pipe_size_mm: "4 mm" })], re: [], not: ["has no unit"], priced: true },
  { id: "AF3a", rule: T.giFramework, cat: INS, path: "panel", kind: "pos", unit: "sqm", live: true, model: [{ item: ACO, cladding: "None", thickness_mm: "19", cladding_as_written: "GI frame with perforated Al sheet" }], description: "Acoustic lining with GI frame with perforated Al sheet", re: ["BoQ says GI frame with perforated Al sheet -> priced as GI Framework with perforated Al sheet"], priced: true },
  { id: "AF3a-head", rule: T.giFramework, cat: INS, path: "panel", kind: "pos", unit: "sqm", live: true, model: [{ item: ACO, cladding: "None", thickness_mm: "19" }], headings: ["Acoustic insulation with GI framework and perforated aluminium sheet"], re: ["BoQ says GI framework and perforated aluminium sheet -> priced as GI Framework with perforated Al sheet"], priced: true },
  { id: "AF3b-neg", rule: T.giFramework, cat: INS, path: "panel", kind: "neg", unit: "sqm", live: true, model: [{ item: ACO, cladding: "No", thickness_mm: "19", cladding_as_written: "GI frame with perforated Al sheet" }], re: [], not: ["priced as GI Framework"], priced: true },
  { id: "AF4a", rule: T.rpufSheet, cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [{ item: "None", cladding: "No", thickness_mm: "50", material_as_written: "RPUF" }], re: ["No SKU in the catalogue for RPUF - price this row by hand"], priced: false },
  { id: "AF4b-neg", rule: T.rpufSheet, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [{ item: "None", cladding: "No", thickness_mm: "40", pipe_size_mm: "100", material_as_written: "RPUF" }], re: ["BoQ says RPUF -> priced as Tubular Puf Insulation"], not: ["No SKU in the catalogue for RPUF"], priced: true },
  // ── ADP-3a (AC6): a positive and a near-miss case for each line it adds, on every tab that carries it ──
  { id: "N1a", rule: T.a3Unit, cat: INS, path: "panel", kind: "pos", unit: "nos", model: [NIT], re: ["Nitrile Rubber Insulation is not stocked per 'nos' (stocked per metre) - price this row by hand"], priced: false },
  { id: "N1b-neg", rule: T.a3Unit, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [NIT], re: [], not: ["is not stocked per"], priced: true },
  { id: "N1c", rule: T.a3Unit, cat: ADP, path: "panel", kind: "pos", unit: "Lot", model: [{ family: "spigot", dia_mm: "200" }], re: ["spigot is not stocked per 'Lot' (stocked per number) - price this row by hand"], priced: false },
  { id: "N1d-neg", rule: T.a3Unit, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "spigot", dia_mm: "200" }], re: [], not: ["is not stocked per"], priced: true },
  { id: "N1e", rule: T.a3Unit, cat: PIP, path: "panel", kind: "pos", unit: "Nos/Ro", model: [MS50], re: ["MS is not stocked per 'Nos/Ro' (stocked per metre) - price this row by hand"], priced: false },
  { id: "N1f-neg", rule: T.a3Unit, cat: PIP, path: "panel", kind: "neg", unit: "RMT", model: [MS50], re: [], not: ["is not stocked per"], priced: true },
  { id: "N2a", rule: T.a3Unstocked, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "fire damper", variant: "UL", ul: "no", size_mm: "600x600" }], re: ["No SKU for fire damper: UL listed no, variant UL - price this row by hand"], not: [", width 600, height 600 - price"], priced: false },
  { id: "N2b-neg", rule: T.a3Unstocked, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "fire damper", variant: "UL", ul: "yes", size_mm: "600x600" }], re: [], not: ["No SKU for"] },
  { id: "N2c", rule: T.a3Unstocked, cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(PUFI, { cladding: "Glass Cloth" })], re: ["No SKU for Tubular Puf Insulation: cladding Glass Cloth - price this row by hand"], not: ["Glass Cloth, thickness", "Glass Cloth, pipe size"], priced: false },
  { id: "N2d-neg", rule: T.a3Unstocked, cat: INS, path: "panel", kind: "neg", unit: "RMT", model: [PUFI], re: [], not: ["No SKU for"], priced: true },
  { id: "N3a", rule: T.a3Either, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "VCD" }], re: ["VCD needs Size (W x H), or Area band - neither stated - price this row by hand"], priced: false },
  { id: "N3a-calc", rule: T.a3Either, cat: ADP, path: "calc", kind: "pos", edits: calc("VCD", {}), rowUnit: "nos", re: ["VCD needs Size (W x H), or Area band - neither stated - price this row by hand"], priced: false },
  { id: "N3b-neg", rule: T.a3Either, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "VCD", size_mm: "600x300" }], re: [], not: ["neither stated"], priced: true },
  // ── ADP-3b (AC4): a positive and a near-miss case for each line it adds, on the v49-shaped config ──
  { id: "B1a", rule: T.sizesAdp, cat: ADP, path: "panel", kind: "pos", unit: "nos", adp3b: true, model: [{ family: "VCD", variant: "GI rectangular", size_mm: "550X300" }], re: ["face_w_mm:BoQ says 550X300 -> width 550 mm", "face_h_mm:BoQ says 550X300 -> height 300 mm"], not: ["size_mm:"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.faceBoxes
  { id: "B1a-calc", rule: T.sizesAdp, cat: ADP, path: "calc", kind: "pos", adp3b: true, edits: calc("VCD", { variant: "GI rectangular", face_w_mm: "600", face_h_mm: "300" }, ["face_w_mm", "face_h_mm"]), rowUnit: "nos", re: ["face_w_mm:You typed 600 -> width 600 mm"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.faceBoxes
  { id: "B1b-neg", rule: T.sizesAdp, cat: ADP, path: "panel", kind: "neg", unit: "sqm", adp3b: true, model: [{ family: "VCD", variant: "GI rectangular", size_mm: "550X300" }], re: [], not: ["-> width", "-> height"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.faceBoxes
  { id: "B2a", rule: T.faceThird, cat: ADP, path: "panel", kind: "pos", unit: "nos", adp3b: true, model: [{ family: "square diffuser", damper: "with", size_mm: "300 x 300 x 450 mm Height" }], re: ["450 mm Height (the third part) - not used as the face", "face_h_mm:BoQ says 300 x 300 x 450 mm Height -> height 300 mm"], priced: false },
  { id: "B2b-neg", rule: T.faceThird, cat: ADP, path: "panel", kind: "neg", unit: "nos", adp3b: true, model: [{ family: "square diffuser", damper: "with", size_mm: "595 x 595" }], re: [], not: ["third part"], priced: true },
  { id: "B3a", rule: T.faceD2, cat: ADP, path: "panel", kind: "pos", unit: "rmt", adp3b: true, model: [{ family: "linear grille", size_mm: "150mm width" }], re: ["face_h_mm:BoQ says 150mm width -> height 150 mm (the grille's narrow dimension)"], priced: true },
  { id: "B3b-neg", rule: T.faceD2, cat: ADP, path: "panel", kind: "neg", unit: "rmt", adp3b: true, model: [{ family: "linear grille", size_mm: "150 mm" }], re: ["per-metre row: no height stated to convert the per-sq.m rate"], not: ["narrow dimension"], priced: false },
  { id: "B4a", rule: T.a3EitherFace, cat: ADP, path: "panel", kind: "pos", unit: "nos", adp3b: true, model: [{ family: "VCD", variant: "GI rectangular" }], re: ["VCD needs Width + Height, or Area band - neither stated - price this row by hand"], priced: false },
  { id: "B4b-neg", rule: T.a3EitherFace, cat: ADP, path: "panel", kind: "neg", unit: "nos", adp3b: true, model: [{ family: "VCD", variant: "GI rectangular", size_mm: "550X300" }], re: [], not: ["neither stated"], priced: true },
  // ── ADP-3c (owner 2026-10-21): a two-part size on a W + H item is the face whatever its parts are called (v49) ──
  { id: "C1a", rule: T.sizesAdp, cat: ADP, path: "panel", kind: "pos", unit: "nos", adp3b: true, model: [{ family: "curved grille", size_mm: "600(L)X150mm width" }], re: ["face_w_mm:BoQ says 600(L)X150mm width -> width 150 mm", "face_h_mm:BoQ says 600(L)X150mm width -> height 600 mm (the other part of a two-part size)"], not: ["not used"], working: ["height: BoQ says 600(L)X150mm width -> height 600 mm (the other part of a two-part size)"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.faceAny
  { id: "C1b", rule: T.sizesAdp, cat: ADP, path: "panel", kind: "pos", unit: "nos", adp3b: true, model: [{ family: "door grille", size_mm: "900mm(L)x150mm (H)" }], re: ["face_w_mm:BoQ says 900mm(L)x150mm (H) -> width 900 mm (the other part of a two-part size)", "face_h_mm:BoQ says 900mm(L)x150mm (H) -> height 150 mm"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.faceAny
  { id: "C1c", rule: T.sizesAdp, cat: ADP, path: "panel", kind: "pos", unit: "nos", adp3b: true, model: [{ family: "VCD", variant: "GI rectangular", size_mm: "600 W x 300 W" }], re: ["face_h_mm:BoQ says 600 W x 300 W -> height 300 mm (the second part of a two-part size)"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.faceAny
  { id: "C1a-calc", rule: T.sizesAdp, cat: ADP, path: "calc", kind: "pos", adp3b: true, edits: calc("cross-talk", { size_mm: "250(L) x 500(W)" }, ["size_mm"]), rowUnit: "nos", re: ["face_h_mm:BoQ says 250(L) x 500(W) -> height 250 mm (the other part of a two-part size)"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.faceAny
  { id: "C1b-neg", rule: T.sizesAdp, cat: ADP, path: "panel", kind: "neg", unit: "rmt", adp3b: true, model: [{ family: "linear grille", size_mm: "600(L) x 150 mm (H)" }], re: ["face_h_mm:BoQ says 600(L) x 150 mm (H) -> height 150 mm; 600(L) named as a length - not used"], not: ["two-part size"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.faceAny
  { id: "C1c-neg", rule: T.sizesAdp, cat: ADP, path: "panel", kind: "neg", unit: "nos", adp3b: true, model: [{ family: "VCD", variant: "GI rectangular", size_mm: "550X300" }], re: ["face_w_mm:BoQ says 550X300 -> width 550 mm"], not: ["two-part size"], priced: true },   // ADP-4a (AC1 merge / rename): BEFORE rule: T.faceAny
  { id: "P8c-neg", rule: T.drainCpvc, cat: PIP, path: "calc", kind: "neg", edits: [{ base: null, family: null, attrs: { size_mm: "25" }, other: ["size_mm"] }], rowUnit: "mts", re: ["no pipe type could be told for this item"], not: ["no material stated", "family:CPVC"], priced: false },
  // ── ADP-4a (owner D1 / D3; AC1): one positive and one negative case for each line ADP's tab now names that it never did. The
  // rules are not new -- the config always ran them; the tab now says so. v38 (the file's base) unless flagged ──
  { id: "G1a", rule: T.convWH, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "VCD", variant: "GI rectangular", size_mm: "600x300" }], re: ["per-number row: per-sq.m rate x W x H", "area: width 600 x height 300 mm = 0.18 sq.m (from 'Size')"], priced: true },
  { id: "G1b-neg", rule: T.convWH, cat: ADP, path: "panel", kind: "neg", unit: "sqm", model: [{ family: "VCD", variant: "GI rectangular", size_mm: "600x300" }], re: [], not: ["per-number row"], priced: true },
  { id: "G2a", rule: T.convBand, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "VCD", variant: "GI rectangular", area_band: "up to 0.5 sqm" }], re: ["area band: per-sq.m rate x the band's maximum area", "area_band:BoQ says up to 0.5 sqm -> priced at 0.5 sq.m (the largest value)"], not: ["per-number row"], priced: true },
  { id: "G2b-neg", rule: T.convBand, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "VCD", variant: "GI rectangular", size_mm: "600x300" }], re: ["per-number row: per-sq.m rate x W x H"], not: ["area band:"], priced: true },
  { id: "G3a", rule: T.convGrille, cat: ADP, path: "panel", kind: "pos", unit: "rmt", model: [{ family: "linear grille", damper: "with", size_mm: "1000x150" }], re: ["per-metre grille: per-sq.m rate x height in metres", "height 150 mm = 0.15 m (from 'Size')"], priced: true },
  { id: "G3b-neg", rule: T.convGrille, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "linear grille", damper: "with", size_mm: "1000x150" }], re: ["per-number row: per-sq.m rate x W x H"], not: ["per-metre grille"], priced: true },
  { id: "G4a", rule: T.convPiece38, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "flexible duct", insulated: "with", dia_mm: "200" }], re: ["per piece: per-metre rate x 2.5 m standard length", "supply: per piece: per-metre supply cost x 2.5 m standard length = 1025"], priced: true },
  { id: "G4b-neg", rule: T.convPiece38, cat: ADP, path: "panel", kind: "neg", unit: "rmt", model: [{ family: "flexible duct", insulated: "with", dia_mm: "200" }], re: [], not: ["per piece"], priced: true },
  { id: "G4c", rule: T.convPiece, cat: ADP, path: "panel", kind: "pos", unit: "nos", adp1: true, model: [{ family: "flexible duct", insulated: "with", dia_mm: "200" }], re: ["per piece: per-metre rate x the flexible duct length per piece"], not: ["2.5 m standard length"], priced: true },
  { id: "G4d-neg", rule: T.convPiece, cat: ADP, path: "panel", kind: "neg", unit: "rmt", adp1: true, model: [{ family: "flexible duct", insulated: "with", dia_mm: "200" }], re: [], not: ["per piece"], priced: true },
  { id: "G5a", rule: T.convMix38, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "mixing box / LP plenum", insulated: "with", size_mm: "450x450x350" }], re: ["per-number mixing box at any size: per-sq.m cost x 2(WH + HD + WD) + 150, rounded up, then the markup", "+ 150 = 1423.05, rounded up to the rupee: 1424"], priced: true },
  { id: "G5b-neg", rule: T.convMix38, cat: ADP, path: "panel", kind: "neg", unit: "sqm", model: [{ family: "mixing box / LP plenum", insulated: "with", size_mm: "450x450x350" }], re: [], not: ["per-number mixing box", "+ 150"], priced: true },
  { id: "G6a", rule: T.crossTalk, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "cross-talk", size_mm: "500x250" }], re: ["supply: 2 x (W + H) x 300 mm depth / 1,000,000 (sq.mm to sq.m) x the base per-sq.m supply cost = 720"], priced: true },
  { id: "G6b-neg", rule: T.crossTalk, cat: ADP, path: "panel", kind: "neg", unit: "sqm", model: [{ family: "cross-talk", size_mm: "500x250" }], re: [], not: ["300 mm depth"], priced: true },
  { id: "G7a", rule: T.ratio, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "control panel", panel_ratio: "1:6" }], re: ["panel_ratio:BoQ says 1:6 -> 6"], priced: true },
  { id: "G7b-neg", rule: T.ratio, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "control panel", panel_ratio: "6" }], re: [], not: ["1:6 -> 6"], priced: true },
  { id: "G8a", rule: T.gauge, cat: ADP, path: "panel", kind: "pos", unit: "sqm", model: [{ family: "double-skin plenum", thickness_mm: "26G" }], re: ["plenum thickness stated as '26G' -- a gauge, not a thickness"], priced: false },
  { id: "G8b-neg", rule: T.gauge, cat: ADP, path: "panel", kind: "neg", unit: "sqm", model: [{ family: "double-skin plenum", thickness_mm: "25" }], re: ["family:double-skin plenum"], not: ["a gauge, not a thickness"], priced: true },
  { id: "G9a", rule: T.sqft, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "VCD", variant: "GI rectangular", area_band: "2 sq ft" }], re: ["area stated in square feet ('2 sq ft')"], priced: false },
  { id: "G9b-neg", rule: T.sqft, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "VCD", variant: "GI rectangular", area_band: "0.2 sqm" }], re: ["area_band:BoQ says 0.2 sqm -> priced at 0.2 sq.m"], not: ["square feet"], priced: true },
  { id: "G10a", rule: T.mcm, cat: ADP, path: "panel", kind: "pos", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "20 cm" }], re: ["dia_mm:BoQ says 20 cm -> 200 mm (20 cm read as 200 mm)"], priced: true },
  { id: "G10b-neg", rule: T.mcm, cat: ADP, path: "panel", kind: "neg", unit: "nos", model: [{ family: "round diffuser", damper: "with", dia_mm: "200 mm" }], re: [], not: ["cm read as"], priced: true },
  // ── ADP-4a (owner D10, 2026-10-21 "Yes"; AC5): one named case for each of the ten families that had none, each from a
  // REAL stored row (its items exactly as stored, its unit, the figures the replay gives), with its near miss -- on v50 ──
  { id: "F1a", rule: T.kind, family: "floor grille", cat: ADP, path: "panel", kind: "pos", unit: "Nos.", adp4a: true, model: [{ family: "floor grille", damper: "with", size_mm: "200X200" }], re: ["family:floor grille"], priced: true, figures: [734, 77] },   // BOQ-26-00315 / PAC WORKS / 40: 734 / 77
  { id: "F1b-neg", rule: T.kind, family: "floor grille", cat: ADP, path: "panel", kind: "neg", unit: "Nos.", adp4a: true, model: [{ family: "floor grille", damper: "with" }], re: ["floor grille needs Width + Height, or Area band - neither stated - price this row by hand"], priced: false },   // r42
  { id: "F2a", rule: T.kind, family: "intake louvre", cat: ADP, path: "panel", kind: "pos", unit: "Sqm", adp4a: true, model: [{ family: "intake louvre" }], re: ["family:intake louvre"], priced: true, figures: [7250, 2800] },   // BOQ-26-00131 / ESTIMATE / 155: 7250 / 2800
  { id: "F2b-neg", rule: T.kind, family: "intake louvre", cat: ADP, path: "panel", kind: "neg", unit: "NOS", adp4a: true, model: [{ family: "intake louvre", damper: "with", air: "fresh" }], re: ["intake louvre needs Width + Height, or Area band - neither stated - price this row by hand"], priced: false },   // BOQ-26-00186 / 97
  { id: "F3a", rule: T.kind, family: "jet / eyeball diffuser", cat: ADP, path: "panel", kind: "pos", unit: "No's", adp4a: true, model: [{ family: "jet / eyeball diffuser", air: "supply", dia_mm: "300 mm" }], re: ["family:jet / eyeball diffuser"], priced: true, figures: [3698, 640] },   // BOQ-26-00140 / 339: 3698 / 640
  { id: "F3b-neg", rule: T.kind, family: "jet / eyeball diffuser", cat: ADP, path: "panel", kind: "neg", unit: "No", adp4a: true, model: [{ family: "jet / eyeball diffuser" }], re: ["no diameter stated"], priced: false },   // BOQ-26-00325 / 249
  { id: "F4a", rule: T.kind, family: "butterfly damper", cat: ADP, path: "panel", kind: "pos", unit: "Nos.", adp4a: true, model: [{ family: "butterfly damper", dia_mm: "150 dia" }], re: ["family:butterfly damper"], priced: true, figures: [725, 0] },   // BOQ-26-00341 / 163: 725 / 0
  { id: "F4b-neg", rule: T.kind, family: "butterfly damper", cat: ADP, path: "panel", kind: "neg", unit: "Nos.", adp4a: true, model: [{ family: "butterfly damper", dia_mm: "10\" or 8\" dia." }], re: ["diameter stated in inches ('10\" or 8\" dia.')"], priced: false },   // BOQ-26-00137 / 167
  { id: "F5a", rule: T.kind, family: "disc valve", cat: ADP, path: "panel", kind: "pos", unit: "Nos", adp4a: true, model: [{ family: "disc valve", dia_mm: "150mm" }], re: ["family:disc valve"], priced: true, figures: [653, 176] },   // BOQ-26-00149 / 415: 653 / 176
  { id: "F5b-neg", rule: T.kind, family: "disc valve", cat: ADP, path: "panel", kind: "neg", unit: "Nos", adp4a: true, model: [{ family: "disc valve", air: "exhaust" }], re: ["no diameter stated"], priced: false },   // BOQ-26-00102 / 72
  { id: "F6a", rule: T.kind, family: "NRD", cat: ADP, path: "panel", kind: "pos", unit: "SQM", adp4a: true, model: [{ family: "NRD" }], re: ["family:NRD"], priced: true, figures: [6888, 1600] },   // BOQ-26-00100 / 108: 6888 / 1600
  { id: "F6b-neg", rule: T.kind, family: "NRD", cat: ADP, path: "panel", kind: "neg", unit: "", adp4a: true, model: [{ family: "NRD" }], re: ["No unit on the BoQ row - this item is priced per sq.m or per number; set the unit"], priced: false },   // BOQ-26-00245 / 132 (no unit)
  { id: "F7a", rule: T.kind, family: "collar damper", cat: ADP, path: "panel", kind: "pos", unit: "Sqm.", adp4a: true, model: [{ family: "collar damper" }], re: ["family:collar damper"], priced: true, figures: [5220, 800] },   // BOQ-26-00102 / 71: 5220 / 800
  { id: "F7b-neg", rule: T.kind, family: "collar damper", cat: ADP, path: "panel", kind: "neg", unit: "Nos", adp4a: true, model: [{ family: "collar damper", dia_mm: "150 mm dia" }], re: ["collar damper needs Width + Height, or Area band - neither stated - price this row by hand"], priced: false },   // BOQ-26-00239 / 239
  { id: "F8a", rule: T.kind, family: "sound attenuator", cat: ADP, path: "panel", kind: "pos", unit: "Sqm", adp4a: true, model: [{ family: "sound attenuator" }], re: ["family:sound attenuator"], priced: true, figures: [6235, 2880] },   // BOQ-26-00341 / 38: 6235 / 2880
  { id: "F8b-neg", rule: T.kind, family: "sound attenuator", cat: ADP, path: "panel", kind: "neg", unit: "Cum", adp4a: true, model: [{ family: "sound attenuator" }], re: ["sound attenuator is not stocked per 'Cum' (stocked per number or per sq.m) - price this row by hand"], priced: false },   // BOQ-26-00231 / 270
  { id: "F9a", rule: T.kind, family: "canvas connection", cat: ADP, path: "panel", kind: "pos", unit: "SQM", adp4a: true, model: [{ family: "canvas connection" }], re: ["family:canvas connection"], priced: true, figures: [1450, 1280] },   // BOQ-26-00100 / 120: 1450 / 1280
  { id: "F9b-neg", rule: T.kind, family: "canvas connection", cat: ADP, path: "panel", kind: "neg", unit: "", adp4a: true, model: [{ family: "canvas connection" }], re: ["No unit on the BoQ row - this item is priced per sq.m or per number or per metre; set the unit"], priced: false },   // BOQ-26-00245 / 101 (no unit)
  { id: "F10a", rule: T.kind, family: "access door", cat: ADP, path: "panel", kind: "pos", unit: "Nos.", adp4a: true, model: [{ family: "access door", size_mm: "450x450mm", thickness_mm: "20G" }], re: ["family:access door"], priced: true, figures: [8700, 1280] },   // BOQ-26-00149 / 327: 8700 / 1280
  { id: "F10b-neg", rule: T.kind, family: "access door", cat: ADP, path: "panel", kind: "neg", unit: "Sqm", adp4a: true, model: [{ family: "access door", insulated: "with" }], re: ["access door is not stocked per sq.m (stocked per number) - price this row by hand"], priced: false },   // BOQ-26-00234 / 577
  // the two families whose only cases were ADP-3c's positives (C1a, C1b): each its near miss, so the family guard holds
  { id: "FG1-neg", rule: T.kind, family: "curved grille", cat: ADP, path: "panel", kind: "neg", unit: "nos", adp4a: true, model: [{ family: "curved grille" }], re: ["curved grille needs Width + Height, or Area band - neither stated - price this row by hand"], priced: false },
  { id: "FG2-neg", rule: T.kind, family: "door grille", cat: ADP, path: "panel", kind: "neg", unit: "nos", adp4a: true, model: [{ family: "door grille" }], re: ["door grille needs Width + Height, or Area band - neither stated - price this row by hand"], priced: false },
  // ── ADP-5a (owner rulings 2026-10-22; AC8): a positive and a negative case for each rule this slice builds, each a REAL stored
  // row (its items, unit, text, headings and heading notes as the replay dump holds them) with the figures the replay gives -- on v51 ──
  { id: "M1a", rule: T.mergeSpigot, family: "spigot", cat: ADP, path: "panel", kind: "pos", unit: "Nos.", adp5a: true,
    description: "a) Supply & installation of 200 mm dia Spigot & Butterfly damper for rectangular duct. It should be of 22G.(120 GSM)", headings: ["AIR DISTRIBUTION"],
    model: [{ family: "spigot", damper: "None", air: "None", dia_mm: "200 mm dia", ul: "None", thickness_mm: "22G", variant: "None", qty_per_row_unit: "None" },
            { family: "butterfly damper", damper: "None", air: "None", dia_mm: "200 mm dia", ul: "None", thickness_mm: "22G", variant: "None", qty_per_row_unit: "None" }],
    re: ["spigot with butterfly damper named -> priced as one Butterfly Damper With Spigot, 200 mm", "Butterfly Damper With SPIGOT / 200 MM DIA (Nos)"], not: ["family:spigot"], working: ["spigot with butterfly damper named -> priced as one Butterfly Damper With Spigot, 200 mm"], priced: true, figures: [1015, 0] },   // BOQ-26-00341 r103: 1,247 / 64 -> 1,015 / 0
  { id: "M1b", rule: T.mergeSpigot, family: "spigot", cat: ADP, path: "panel", kind: "pos", unit: "No", adp5a: true, description: "Ø 150 mm dia",
    headings: ["AIR DISTRIBUTION", "SITC of round spigot with Butterfly Dampers as per the specifications & the sizes are as following below."],
    model: [{ family: "spigot", damper: "with", air: "None", dia_mm: "Ø 150 mm dia", ul: "None" }], re: ["spigot with butterfly damper named -> priced as one Butterfly Damper With Spigot, 150 mm"], priced: true, figures: [725, 0] },   // BOQ-26-00231 r257: 211 / 64 -> 725 / 0
  { id: "M1c", rule: T.mergeSpigot, family: "spigot", cat: ADP, path: "panel", kind: "pos", unit: "Nos", adp5a: true, description: "200 mm dia",
    headings: ["Supply & Fixing of GI round spicot damper for flexible duct connection"],
    model: [{ family: "spigot", damper: "with", air: "None", dia_mm: "200 mm dia", ul: "None", qty_per_row_unit: "None" }], re: ["spigot with butterfly damper named -> priced as one Butterfly Damper With Spigot, 200 mm"], priced: true, figures: [1015, 0] },   // BOQ-26-00313 r94: 232 / 64 -> 1,015 / 0
  { id: "M1a-calc", rule: T.mergeSpigot, family: "spigot", cat: ADP, path: "calc", kind: "pos", adp5a: true,
    edits: [{ base: null, family: "spigot", attrs: { dia_mm: "200" } }, { base: null, family: "butterfly damper", attrs: { dia_mm: "200" } }], rowUnit: "nos", re: ["spigot with butterfly damper named -> priced as one Butterfly Damper With Spigot, 200 mm"], priced: true, figures: [1015, 0] },
  { id: "M1b-neg", rule: T.mergeSpigot, family: "spigot", cat: ADP, path: "panel", kind: "neg", unit: "Nos.", adp5a: true,
    description: "300Dia Dropper of length 150/200mm for round diffuser connection . Its should of 24G and Match Elliptical duct color.",
    headings: ["AIR DISTRIBUTION", "Supply, Installation, Testing and balancing of square type extruded aluminium powder coated diffusers for supply air"], headingNotes: ["Extruded Aluminium diffusers powder coated"],
    model: [{ family: "spigot", air: "None", size_mm: "length 150/200mm", dia_mm: "300Dia", ul: "None", thickness_mm: "24G" }], re: ["family:spigot"], not: ["Butterfly Damper With Spigot"], priced: true, figures: [276, 64] },   // BOQ-26-00341 r62: unchanged
  { id: "CG1a", rule: T.defaults, family: "curved grille", cat: ADP, path: "panel", kind: "pos", unit: "Sqm", adp5a: true,
    description: "The supply & installation of higher grade Aluminum Extruded powder coated grilles with blade deflection of 0 & 15 deg", headings: ["AIR DISTRIBUTION SYSTEM", "GRILLES - Al. CURVED"],
    model: [{ family: "curved grille", damper: "None", air: "None", ul: "None", qty_per_row_unit: "None" }], re: ["damper:damper not mentioned (or not answered) on a curved grille = with"], priced: true, figures: [10730, 2800] },   // BOQ-26-00185 r29: 5,510 / 880 -> 10,730 / 2,800
  { id: "CG1b-neg", rule: T.defaults, family: "curved grille", cat: ADP, path: "panel", kind: "neg", unit: "Sqm", adp5a: true, description: "100 mm wide",
    headings: ["SITC of the following items", "Return air Curved grilles with Zero deflection type of Powder coated high quality extruded aluminium construction without Collar damper of aluminium mounted directly on grilles."],
    model: [{ family: "curved grille", damper: "without", insulated: "None", air: "return", size_mm: "100 mm wide", ul: "None", variant: "None", qty_per_row_unit: "None" }], re: [], not: ["on a curved grille = with"], priced: true, figures: [5510, 880] },   // BOQ-26-00140 r168: unchanged
  { id: "AS1a", rule: T.h5Both, family: "linear grille", cat: ADP, path: "panel", kind: "pos", unit: "Sqm", adp5a: true,
    description: "Powder coated extruded Extruded Aluminium - linear grille for SA / RA - 100mm width Make: Air master / Caryaire / Ravistar", headings: ["AIR TERMINALS"],
    model: [{ family: "linear grille", damper: "None", insulated: "None", air: "supply", size_mm: "100mm width", ul: "None", qty_per_row_unit: "None" }], re: ["BoQ names supply and return air -> damper as read (not mentioned -> without)"], priced: true, figures: [4829, 880] },   // BOQ-26-00113 r78: 9,628 / 2,800 -> 4,829 / 880
  { id: "AS1b", rule: T.h5Both, family: "linear grille", cat: ADP, path: "panel", kind: "pos", unit: "SqM", adp5a: true, description: "i. 100/150/200/250 mm/600mmx600mm Grilles", headings: ["DUCTWORK/AIR TERMINALS", "LINEAR GRILLES"],
    headingNotes: ["Supply, Installation, Testing and Balancing of one way blow linear supply cum return air grilles complete with fixed core as per approved shop drawings and specifications. The grilles shall be of approved colour & shade.", "Powder coated aluminium grilles of extruded sections with integral flanges on both sides & ends as required complete with corner pieces."],
    model: [{ family: "linear grille", damper: "None", air: "supply", size_mm: "100/150/200/250 mm/600mmx600mm", ul: "None" }], re: ["BoQ names supply and return air -> damper as read (not mentioned -> without)"], priced: true, figures: [4829, 880] },   // BOQ-26-00122 r65: 9,628 / 2,800 -> 4,829 / 880
  { id: "AS1c-neg", rule: T.h5Both, family: "square diffuser", cat: ADP, path: "panel", kind: "neg", unit: "Nos.", adp5a: true, description: "375 X 375 (Neck size) overall size 596 X 596 (Tegular type)",
    headings: ["AIR DISTRIBUTION", "Supply, Installation, Testing and balancing of square type extruded aluminium powder coated diffusers for supply air required as per the approved shop drawings."], headingNotes: ["Extruded Aluminium diffusers powder coated"],
    model: [{ family: "square diffuser", damper: "None", air: "supply", neck_mm: "375 X 375", size_mm: "596 X 596", ul: "None" }], re: [], not: ["BoQ names supply and return air"], priced: true, figures: [2248, 576] },   // BOQ-26-00341 r59: the section heading's note (two levels up) is not read (HN-3): unchanged
  { id: "BX1a", rule: T.sizesAdp, family: "mixing box / LP plenum", cat: ADP, path: "panel", kind: "pos", unit: "Nos", adp5a: true,
    description: "GSS plenum boxes for fiing the diffusers along with openings for flexible ducts 1200x150-300 depth all the nescessary supports to be considered in the rate", headings: ["HVAC SYSTEM"],
    model: [{ family: "mixing box / LP plenum", damper: "None", air: "None", size_mm: "1200x150-300 depth", ul: "None", qty_per_row_unit: "None" }],
    re: ["plenum_width_mm:BoQ says 1200x150-300 depth -> 150 mm (the second of length x width x height)", "plenum_height_mm:BoQ says 1200x150-300 depth -> 300 mm (the height as written)"], priced: true, figures: [2306, 0] },   // BOQ-26-00247 r92: refused -> 2,306 / 0
  { id: "BX1b-neg", rule: T.sizesAdp, family: "mixing box / LP plenum", cat: ADP, path: "panel", kind: "neg", unit: "NOS", adp5a: true, description: "900x200x350mm Ht.",
    headings: ["GSS SPILL AIR BOX: Supply and installation of GSS Spill air box (24G)."],
    model: [{ family: "mixing box / LP plenum", damper: "None", air: "None", size_mm: "900x200x350mm Ht.", ul: "None", thickness_mm: "24G", qty_per_row_unit: "None" }],
    re: ["plenum_length_mm:BoQ says 900x200x350mm Ht. -> 900 mm (the first of length x width x height)"], not: ["-300 depth"], priced: true, figures: [2233, 0] },   // BOQ-26-00186 r58: unchanged
];

/** ADP line 5 (`units_not_offered`) acts on the CALCULATOR'S UNIT PICKER, not on a row's price: it is covered
 *  by the unit-choices check below (a BoQ row arriving in a hidden unit prices exactly as before, by design). */
const PICKER_CASES: Array<{ rule: string; family: string; offered: string[]; notOffered: string[] }> = [
  // ADP-4a (AC1 merge D3 5+32): ADP's line 5 now speaks inside ADP-3a's unit line. BEFORE rule: T.notOffered on both
  { rule: T.a3Unit, family: "double-skin plenum", offered: ["sqm"], notOffered: ["nos"] },
  { rule: T.a3Unit, family: "VCD", offered: ["nos", "sqm"], notOffered: [] },
];

// ── the runner: the panel's entry point on each path, beside the pure pricer ────────────────────────
const cells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
function run(c: Case) {
  // 12e-4b (owner D-2): an insulation answer carries the marker the run stores, on the ITEM beside its attributes
  const modelItems = (c.model ?? []).map(({ section, ...a }) => ({ attributes: cells(a), ...(section ? { section } : {}) }));
  const ext = new Map<number, ExtractionRow>();
  if (c.path !== "calc") ext.set(1, { excelRow: 1, description: c.description ?? "", attributes: {}, items: modelItems } as unknown as ExtractionRow);
  const overrides: Record<string, string> = {};
  if (c.edits) overrides[ITEM_LIST_OVERRIDE_KEY] = JSON.stringify({ items: c.edits });
  if (c.rowUnit !== undefined) overrides[ROW_UNIT_OVERRIDE_KEY] = c.rowUnit;
  const h = makePricingSheetHelper({ configsByCategory: c.adp5a ? CONFIGS_V51 : c.adp4a ? CONFIGS_V50 : c.adp3b ? CONFIGS_ADP3B : c.adp2 ? CONFIGS_ADP2 : c.adp1 ? CONFIGS_ADP1 : c.live ? CONFIGS_LIVE : c.v42 ? CONFIGS42 : CONFIGS, items: c.adp5a ? ITEMS_V51 : c.adp4a ? ITEMS_V50 : c.adp3b ? ITEMS_ADP2 : c.adp2 ? ITEMS_ADP2 : c.adp1 ? ITEMS_ADP1 : c.live ? ITEMS_LIVE : c.v42 ? ITEMS42 : ITEMS, extractionByRow: ext });
  const ctx: RateHelperRowContext & { unit?: string } = {
    excelRow: 1, description: c.path === "calc" ? "" : (c.description ?? ""), nodeType: "Line Item", category: c.cat, discipline: "HVAC",
    rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: c.path === "calc" ? [] : (c.headings ?? []), ownNotes: c.path === "calc" ? [] : (c.ownNotes ?? []),
    ...(c.path !== "calc" && c.headingNotes ? { headingNotes: c.headingNotes } : {}),   // ADP-5a (HN-2 / HN-3)
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
        if (f.rule) lines.push(`sec.${f.id}:${f.rule}`);   // ADP-4a (AC3): a section's default is stated on its field, as a block's is
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
  const spec = itemListPricingSpec((c.adp5a ? CFG_V51 : c.adp4a ? CFG_V50 : c.adp3b ? CFG_ADP3B : c.adp2 ? CFG_ADP2 : c.adp1 ? CFG_ADP1 : c.live ? CFG_LIVE : c.v42 ? CFG42 : CFG)[c.cat])!;
  const edits = decodeItemEdits(overrides[ITEM_LIST_OVERRIDE_KEY], modelItems.length);
  const assembled0 = assembleItems(edits, modelItems, familyAttr(spec));
  const unitForPure = c.path === "calc" ? v.unit : (c.unit ?? v.unit);
  const rowText = c.path === "calc" ? "" : [c.description ?? "", ...(c.headings ?? [])].join(" | ");
  const ownText = c.path === "calc" ? "" : [c.description ?? "", ...(c.ownNotes ?? [])].join(" | ");
  // ADP-5a (SCOPE-5a-1 / HN-2): the SAME merge and the same heading notes the panel helper applies before it prices
  const headingNoteText = c.path === "calc" ? "" : (c.headingNotes ?? []).join(" | ");
  const assembled = applyFamilyMerge(spec, assembled0, [rowText, ownText, headingNoteText].join(" | "))?.items ?? assembled0;
  const pure = priceItemList(spec, c.adp5a ? ITEMS_V51 : c.adp4a ? ITEMS_V50 : c.adp3b ? ITEMS_ADP2 : c.adp2 ? ITEMS_ADP2 : c.adp1 ? ITEMS_ADP1 : c.live ? ITEMS_LIVE : c.v42 ? ITEMS42 : ITEMS, unitForPure, assembled, rowText, ownText, undefined, headingNoteText);
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
  // ADP-4a (AC3): every field's note -- where a reader's or a ladder's line is stated once, read off the panel's own pricer result
  const notes = v.items.flatMap((b) => b.fields.map((f) => f.note ?? "")).filter(Boolean);
  return { s, v, lines, text: lines.join("\n"), working, pure, raw, notes };
}
const matches = (text: string, p: string | RegExp) => (typeof p === "string" ? text.includes(p) : p.test(text));

// ── T1 ──────────────────────────────────────────────────────────────────────────────────────────────
describe("T1 -- every Derivation-tab rule of Insulation and ADP fires from the panel's entry point (live v33)", () => {
  const titles = (cat: string) => itemListRuleOrder(CFG[cat], ITEMS).map((l) => l.title);
  // SLICE 12e-6 (AC14, owner condition (a): ADD lines only): the tab WITHOUT this slice's lines is exactly the tab before
  // it, so every positional pin below reads `before12e6` -- unchanged words, unchanged order
  const NEW_12E6 = (): string[] => [T.noneNamed, T.altMaterial, T.xlpe, T.rowKindSwap, T.thkRange, T.mmNb, T.fixings, T.coating, T.twoTypes, T.secDefaults];
  // SLICE 12e-6b (owner R1; U2): ADD only, so the pins below read the tab without its one line as well
  const NEW_12E6B = (): string[] => [T.drainCpvc];
  // SLICE 12e-6c (owner U2 / R): ADD only, on Insulation (Piping's no-unit line is its own, since 12e-4b, and stays counted)
  const NEW_12E6C = (cat: string): string[] => (cat === INS ? [T.rpuf, T.noUnit] : []);
  // ADP-1 (owner F4; U6): ADD only -- the one line v38 generates (F4's, wherever the RPUF line is)
  const NEW_ADP1 = (cat: string): string[] => (cat === INS ? [T.rpufSheet] : []);
  // ADP-3a (AC6): ADD only, LAST on every tab -- set aside like the lines above
  const NEW_ADP3A = (cat: string): string[] => (cat === PIP ? [T.a3Unit] : cat === ADP ? [T.a3Unit, T.a3Unstocked, T.a3Either] : [T.a3Unit, T.a3Unstocked]);
  // ADP-4a (owner D1 / D3; AC1): the lines v38's ADP tab gains -- rules the config always ran that the tab never named
  const NEW_ADP4A_V38 = [T.convWH, T.convBand, T.convGrille, T.convPiece38, T.convMix38, T.crossTalk, T.ratio, T.gauge, T.sqft, T.mcm];
  const before12e6 = (cat: string) => titles(cat).filter((t) => !NEW_12E6().includes(t) && !NEW_12E6B().includes(t) && !NEW_12E6C(cat).includes(t) && !NEW_ADP1(cat).includes(t) && !NEW_ADP3A(cat).includes(t));

  it("THE GUARD: the rules this file names EQUAL the rules the config generates (Insulation 25, ADP 18, Piping 21 at 12e-4b / v38 -- Insulation 24 and Piping 19 before it); a new rule without a case, or a case naming a dead rule, fails here", () => {
    for (const cat of [INS, ADP, PIP]) {
      const generated = new Set(titles(cat));
      // ADP-5a: a case run on v51 (`adp5a`) is set aside like every other version-flagged case (BEFORE: the flags up to adp4a)
      const named = new Set([...CASES.filter((c) => c.cat === cat && ((!c.v42 && !c.live && !c.adp1 && !c.adp2 && !c.adp3b && !c.adp4a && !c.adp5a) || generated.has(c.rule))).map((c) => c.rule), ...PICKER_CASES.filter(() => cat === ADP).map((p) => p.rule), ...Object.keys(NOT_PANEL_RULES).filter((t) => generated.has(t))]);
      const uncovered = [...generated].filter((t) => !named.has(t));
      const dead = [...named].filter((t) => !generated.has(t));
      expect({ cat, uncovered, dead }).toEqual({ cat, uncovered: [], dead: [] });
    }
    // INVERTED at 12e-4b (owner F-1; HVAC v38): BEFORE `toHaveLength(24)`. Insulation's one new key generates one line.
    // INVERTED at 12e-6 (AC14 / U9) by mechanical authority: BEFORE `expect(titles(INS)).toHaveLength(25)` and
    // `expect(titles(PIP)).toHaveLength(21)` with the positional pins on `titles(PIP)`. The six v38-generated Insulation lines
    // and the two Piping lines this slice adds are counted here; every old pin now reads the tab without them.
    // INVERTED at 12e-6c (owner U2 / R) by mechanical authority: BEFORE `expect(titles(INS)).toHaveLength(31)`. The F-3 line and
    // the RPUF line; `before12e6` (below) reads the tab without them, so every older pin stands.
    // INVERTED at ADP-1 (owner F4, 2026-10-19) by mechanical authority: BEFORE `expect(titles(INS)).toHaveLength(33)`. The F4 line;
    // `before12e6` reads the tab without it, so every older pin stands.
    // INVERTED at ADP-3a (owner 13:35 / B6 / H2) by mechanical authority: BEFORE `expect(titles(INS)).toHaveLength(34)`,
    // `expect(titles(PIP)).toHaveLength(24)`, `expect(titles(ADP)).toHaveLength(19)`. The lines it adds sit LAST: two on
    // Insulation, one on Piping, three on ADP; `before12e6` sets them aside, so every older pin stands.
    expect(titles(INS)).toHaveLength(36);
    expect(before12e6(INS)).toHaveLength(25);
    // INVERTED at 12e-6b (owner R1 / U2) by mechanical authority: BEFORE `expect(titles(PIP)).toHaveLength(23)`. The one R1 line.
    expect(titles(PIP)).toHaveLength(25);
    expect(before12e6(PIP)).toHaveLength(21);
    expect(before12e6(INS)).toContain(T.nearPipe);
    // INVERTED at ADP-2 H5 fix (a) (owner 2026-10-20) by mechanical authority: BEFORE `expect(titles(ADP)).toHaveLength(18)`.
    // v38's R13 reads the air stream, so the both-streams line is generated there too; the 18 before it are unchanged.
    // INVERTED at ADP-4a (owner D1-D3; AC1) by mechanical authority: BEFORE `toHaveLength(22)` and the 18 below. The ten lines
    // the tab never named join (NEW_ADP4A); the five fitting lines become one and line 5 folds into ADP-3a's unit line: 18 + 10 - 4 - 1
    expect(titles(ADP)).toHaveLength(27);
    expect(titles(ADP).filter((t) => t !== T.h5Both && !NEW_ADP3A(ADP).includes(t))).toHaveLength(23);
    expect(titles(ADP).filter((t) => t !== T.h5Both && !NEW_ADP3A(ADP).includes(t) && !NEW_ADP4A_V38.includes(t))).toHaveLength(13);
    for (const cat of [INS, ADP, PIP]) expect(titles(cat).slice(-NEW_ADP3A(cat).length)).toEqual(NEW_ADP3A(cat));
    // INVERTED at 12e-3b (AC6): BEFORE `toHaveLength(14)` on v36. v37 declares the insulation section, which adds the four
    // lines named here; the 14 before them are unchanged, in the same order.
    // INVERTED at 12e-3c (owner F10 / U6): BEFORE `toHaveLength(18)` and `slice(14)` equal to the four section lines.
    // INVERTED at 12e-4b (owner F-3: the no-unit line, generated from keys v36 already carries, sits after "Fitting the
    // stated pipe size"). BEFORE: `toHaveLength(19)`, `slice(14)` the five section lines, `slice(0, 14)` v36's titles.
    // INVERTED AGAIN at 12e-4b (owner D-3; HVAC v38 names the as-written attribute, which generates one more line, sixth).
    // BEFORE (v37, this slice's code): `toHaveLength(20)`, `[11]` the no-unit line, `slice(15)` the five section lines,
    // `slice(0, 15)` v36's titles.
    expect(before12e6(PIP)[5]).toBe(T.asWritten);
    expect(before12e6(PIP)[12]).toBe(T.noUnit);
    expect(before12e6(PIP).slice(16)).toEqual([T.secToggle, T.secRules, T.secMirror, T.secQty, T.secTotal]);
    expect(before12e6(PIP).slice(0, 16).filter((t) => t !== T.asWritten)).toEqual(itemListRuleOrder(V36_PIPING, ITEMS).map((l) => l.title).filter((t) => !NEW_12E6().includes(t) && !NEW_ADP3A(PIP).includes(t)));   // ADP-3a: BEFORE the v36 tab without NEW_12E6 only -- v36 carries the ADP-3a unit line too (the code generates it)
    // INVERTED at 12e-6c (owner U2: F-3 on every axis reading inches) by mechanical authority: BEFORE
    // `for (const cat of [INS, ADP]) expect(titles(cat)).not.toContain(T.noUnit)`. ADP still never says it.
    expect(titles(INS)).toContain(T.noUnit);
    expect(titles(ADP)).not.toContain(T.noUnit);
    // every NOT-panel rule is a REAL tab line (never a stale excuse)
    for (const t of Object.keys(NOT_PANEL_RULES)) expect(titles(INS).includes(t) || titles(ADP).includes(t)).toBe(true);
  });

  // SLICE 12e-6 (AC14, owner 2026-10-16 14:49 (d)): THE 12e-6 GUARD on the LIVE asset -- every line this slice adds
  // to the Insulation and Piping tabs (two of them, R4 and R7, are generated only from v42's keys) has a positive and a
  // negative case above, run through the panel's entry point; ADP's tab gains none.
  it("12e-6: every new tab line (v42) has a positive and a negative case; ADP gains none", () => {
    const NEW = [T.noneNamed, T.altMaterial, T.xlpe, T.rowKindSwap, T.thkRange, T.mmNb, T.fixings, T.coating, T.twoTypes, T.secDefaults];
    const t42 = (cat: string) => itemListRuleOrder(CFG42[cat], ITEMS42).map((l) => l.title);
    const onTabs = NEW.filter((t) => t42(INS).includes(t) || t42(PIP).includes(t));
    expect(onTabs).toEqual(NEW);
    for (const t of NEW) {
      const mine = CASES.filter((c) => c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    for (const t of NEW) expect(t42(ADP)).not.toContain(t);
  });

  // SLICE 12e-6b (owner R1; U2): THE 12e-6b GUARD -- the ONE line this slice adds sits on the Piping tab right after the
  // as-written line, has a positive and a negative case, and Insulation and ADP do not gain it (v38 and v42 alike)
  it("12e-6b: the R1 drain line is on Piping only, right after the as-written line, with a positive and a negative case", () => {
    expect(titles(PIP).filter((t) => t === T.drainCpvc)).toHaveLength(1);
    expect(titles(PIP)[titles(PIP).indexOf(T.asWritten) + 1]).toBe(T.drainCpvc);
    const t42 = (cat: string) => itemListRuleOrder(CFG42[cat], ITEMS42).map((l) => l.title);
    expect(t42(PIP)[t42(PIP).indexOf(T.asWritten) + 1]).toBe(T.drainCpvc);
    for (const cat of [INS, ADP]) { expect(titles(cat)).not.toContain(T.drainCpvc); expect(t42(cat)).not.toContain(T.drainCpvc); }
    const mine = CASES.filter((c) => c.rule === T.drainCpvc);
    expect({ pos: mine.some((c) => c.kind === "pos"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ pos: true, neg: true });
  });

  // SLICE 12e-6c (owner rulings 2026-10-18; AC6): THE 12e-6c GUARD on the LIVE asset -- every line this slice adds to
  // Insulation's tab is generated there, has a positive and a negative case above, and ADP and Piping gain none of them
  // ADP-1 (owner rulings 2026-10-19; U6, AC8): THE ADP-1 GUARD on the ADP-1 config -- every line this slice adds is generated
  // there, has a positive model-read case and a negative one above (the calculator cases ride beside them), and Piping
  // gains none of them
  it("ADP-1: every new line (on v46 + ADP-1 = v47) has a positive and a negative case; Piping gains none", () => {
    // INVERTED at ADP-4a (AC1) by mechanical authority: BEFORE ADP's list without T.convPiece. The per-piece conversion line names
    // the ADP-1 per-piece key ("the flexible duct length per piece") where v46 says "2.5 m standard length", so it is new here
    const NEW: Record<string, string[]> = { [ADP]: [T.slotNos, T.slotMissing, T.mixNos, T.mixMissing, T.slotsStock, T.pieceLen, T.slotSqm, T.convPiece], [INS]: [T.rpufSheet, T.giFramework, T.f1Above] };
    const tA = (cat: string) => itemListRuleOrder(CFG_ADP1[cat], ITEMS_ADP1).map((l) => l.title);
    const tL = (cat: string) => itemListRuleOrder(CFG_LIVE[cat], ITEMS_LIVE).map((l) => l.title);
    for (const [cat, list] of Object.entries(NEW)) {
      expect({ cat, onTab: list.filter((t) => tA(cat).includes(t)) }).toEqual({ cat, onTab: list });
      // the tab gained exactly these lines over v46 (the F3 / F4 lines are generated on v46 too, by the code)
      expect({ cat, added: tA(cat).filter((t) => !tL(cat).includes(t)).sort() }).toEqual({ cat, added: list.filter((t) => !tL(cat).includes(t)).sort() });
      for (const t of list) {
        const mine = CASES.filter((c) => c.cat === cat && c.rule === t);
        expect({ rule: t, pos: mine.some((c) => c.kind === "pos" && c.path !== "calc"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
      }
    }
    expect(tA(PIP)).toEqual(tL(PIP));
    for (const t of [...NEW[ADP], ...NEW[INS]]) expect(tA(PIP)).not.toContain(t);
  });

  // ADP-2 (owner rulings H5 / H7 / B3; U6, AC6): THE ADP-2 GUARD on the ADP-2 config -- every line this slice adds is
  // generated there and has a positive case off the calculator and a negative one; the tab lost exactly ADP-1's plenum
  // refusal line (replaced by the either-or one); Insulation and Piping gain and lose nothing
  it("ADP-2: every new ADP line (on the ADP-1 config + ADP-2 = v48) has a positive and a negative case; Insulation and Piping unchanged", () => {
    // INVERTED at ADP-4a (owner D2 merges; AC1) by mechanical authority: BEFORE NEW = [T.h5Air, T.mixArea, T.mixEither, T.boxSides,
    // T.areaFill, T.neckOther]. The air-stream rule now speaks in the defaults line, the boxes in the one sizes line, the neck
    // "Other..." in the one fitting line -- each asserted there, below, by its words
    const NEW = [T.mixArea, T.mixEither, T.sizesAdp, T.areaFill];
    const t2 = (cat: string) => itemListRuleOrder(CFG_ADP2[cat], ITEMS_ADP2).map((l) => l.title);
    const t1 = (cat: string) => itemListRuleOrder(CFG_ADP1[cat], ITEMS_ADP1).map((l) => l.title);
    const d2 = (title: string) => itemListRuleOrder(CFG_ADP2[ADP], ITEMS_ADP2).find((l) => l.title === title)?.detail ?? "";
    expect(d2(T.defaults)).toMatch(/supply air means with damper/);
    expect(d2(T.fitAdp)).toMatch(/Other\.\.\./);
    expect(d2(T.sizesAdp)).toMatch(/a box \(length x width x height\)/);
    for (const t of [T.h5Air, T.boxSides, T.neckOther]) expect(t2(ADP)).not.toContain(t);
    expect(NEW.filter((t) => t2(ADP).includes(t))).toEqual(NEW);
    expect(t2(ADP).filter((t) => !t1(ADP).includes(t)).sort()).toEqual([...NEW].sort());
    expect(t1(ADP).filter((t) => !t2(ADP).includes(t))).toEqual([T.mixMissing]);
    for (const t of NEW) {
      const mine = CASES.filter((c) => c.cat === ADP && c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos" && c.path !== "calc"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    for (const cat of [INS, PIP]) expect(t2(cat)).toEqual(t1(cat));
  });

  // ADP-3a (owner 13:35 / B6 / H2; AC6): THE ADP-3a GUARD -- the lines it adds are the LAST lines of each tab on every
  // version (v38 here and the ADP-2 config = v48), the same titles on both (the either-or title never names the kinds),
  // and each has a positive case off the calculator and a negative one ON THAT TAB
  it("ADP-3a: the lines it adds sit last on every tab of v38 and v48 alike, each with a positive and a negative case on that tab", () => {
    const tabs = { v38: (cat: string) => titles(cat), v48: (cat: string) => itemListRuleOrder(CFG_ADP2[cat], ITEMS_ADP2).map((l) => l.title) };
    for (const [ver, t] of Object.entries(tabs)) {
      for (const cat of [INS, ADP, PIP]) {
        expect({ ver, cat, last: t(cat).slice(-NEW_ADP3A(cat).length) }).toEqual({ ver, cat, last: NEW_ADP3A(cat) });
        expect({ ver, cat, n: t(cat).filter((x) => [T.a3Unit, T.a3Unstocked, T.a3Either].includes(x)).length }).toEqual({ ver, cat, n: NEW_ADP3A(cat).length });
      }
    }
    for (const cat of [INS, ADP, PIP]) {
      for (const t of NEW_ADP3A(cat)) {
        const mine = CASES.filter((c) => c.cat === cat && c.rule === t);
        expect({ cat, rule: t, pos: mine.some((c) => c.kind === "pos" && c.path !== "calc"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ cat, rule: t, pos: true, neg: true });
      }
    }
  });

  // ADP-3b (owner B1; D1 / D2; AC4): THE ADP-3b GUARD on the ADP-2 config + ADP-3b (= v49) -- the lines it adds are generated
  // there, LAST, each with a positive case off the calculator and a negative one; the tab gained exactly them; the one
  // line that changed words is ADP-3a's either-or line (its group is now "Width + Height"); Insulation and Piping unchanged
  it("ADP-3b: every new ADP line (on the ADP-2 config + ADP-3b = v49) has a positive and a negative case; Insulation and Piping unchanged", () => {
    // ADP-4a (TSC-1): BEFORE `const NEW = [T.faceBoxes, T.faceThird, T.faceD2];` -- unread since the guard reads NEW4A below
    const t3 = (cat: string) => itemListRuleOrder(CFG_ADP3B[cat], ITEMS_ADP2).map((l) => l.title);
    const t2 = (cat: string) => itemListRuleOrder(CFG_ADP2[cat], ITEMS_ADP2).map((l) => l.title);
    // INVERTED at ADP-3c (U2: its one line, generated from the same v49 keys, is added LAST) by mechanical authority.
    // BEFORE: `t3(ADP).slice(-NEW.length)` and the gained set `[...NEW, T.a3EitherFace]`.
    // INVERTED at ADP-4a (owner D2 merge 23-27; AC1) by mechanical authority: BEFORE `slice(-NEW.length - 1, -1)` equal to NEW and
    // the gained set [...NEW, T.a3EitherFace, T.faceAny]. The boxes line and ADP-3c's line speak inside the one sizes line (on the
    // ADP-2 config already), so the tab gains the other two, LAST, and the either-or line's new words
    const NEW4A = [T.faceThird, T.faceD2];
    const d3 = (title: string) => itemListRuleOrder(CFG_ADP3B[ADP], ITEMS_ADP2).find((l) => l.title === title)?.detail ?? "";
    expect(t3(ADP).slice(-NEW4A.length)).toEqual(NEW4A);
    expect(t3(ADP).filter((t) => !t2(ADP).includes(t)).sort()).toEqual([...NEW4A, T.a3EitherFace].sort());
    expect(t2(ADP).filter((t) => !t3(ADP).includes(t))).toEqual([T.a3Either]);
    expect(d3(T.sizesAdp)).toMatch(/a face \(width x height\)/);
    expect(itemListRuleOrder(CFG_ADP2[ADP], ITEMS_ADP2).find((l) => l.title === T.sizesAdp)?.detail ?? "").not.toMatch(/a face \(width x height\)/);
    for (const t of [T.faceBoxes, T.faceAny]) expect(t3(ADP)).not.toContain(t);
    for (const t of [T.sizesAdp, ...NEW4A, T.a3EitherFace]) {
      const mine = CASES.filter((c) => c.cat === ADP && c.rule === t && c.adp3b);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos" && c.path !== "calc"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    // the named set EQUALS the generated set: every ADP-3b case names a line v49 generates
    for (const c of CASES.filter((x) => x.adp3b)) expect({ id: c.id, generated: t3(c.cat).includes(c.rule) }).toEqual({ id: c.id, generated: true });
    for (const cat of [INS, PIP]) expect(t3(cat)).toEqual(t2(cat));
  });

  // ADP-3c (owner 2026-10-21 01:31 / 01:55; AC3): THE ADP-3c GUARD on v49 (the ADP-3b config; no config change) -- its one
  // line is generated there, LAST, named by EXACTLY the C cases (C1a, C1b, C1c, C1a-calc, C1b-neg, C1c-neg), with a
  // positive case off the calculator, one on it, and a negative; v48 (no face sides) and Insulation / Piping never carry it
  it("ADP-3c: the new ADP line (v49) is LAST, named by exactly its cases (pos panel, pos calc, neg); v48, Insulation and Piping lack it", () => {
    const t3 = (cat: string) => itemListRuleOrder(CFG_ADP3B[cat], ITEMS_ADP2).map((l) => l.title);
    // INVERTED at ADP-4a (owner D2 merge 23-27; AC1) by mechanical authority: BEFORE `t3(ADP).at(-1)` toBe T.faceAny and the C cases
    // named by `rule: T.faceAny`. The rule speaks inside the one sizes line; its cases name that line, and are found by their ids
    expect(t3(ADP)).not.toContain(T.faceAny);
    // the rule's own words, before the shared reason (" -- why: "), which names the owner's rulings whatever the version
    const body = (cfg: RateCategoryConfig) => (itemListRuleOrder(cfg, ITEMS_ADP2).find((l) => l.title === T.sizesAdp)?.detail ?? "").split(" -- why: ")[0];
    expect(body(CFG_ADP3B[ADP])).toMatch(/a two-part size fills both sides whatever its parts are called/);
    const mine = CASES.filter((c) => /^C1[a-c]/.test(c.id) && c.cat === ADP);
    expect(mine.map((c) => c.id)).toEqual(["C1a", "C1b", "C1c", "C1a-calc", "C1b-neg", "C1c-neg"]);
    expect(mine.every((c) => c.cat === ADP && c.adp3b && c.rule === T.sizesAdp)).toBe(true);
    expect({ panelPos: mine.some((c) => c.kind === "pos" && c.path === "panel"), calcPos: mine.some((c) => c.kind === "pos" && c.path === "calc"), neg: mine.some((c) => c.kind === "neg") })
      .toEqual({ panelPos: true, calcPos: true, neg: true });
    expect(body(CFG_ADP2[ADP])).not.toMatch(/two-part size/);   // ADP-4a: BEFORE t2(ADP) not.toContain(T.faceAny)
    for (const cat of [INS, PIP]) expect(t3(cat)).not.toContain(T.sizesAdp);   // ADP-4a: BEFORE not.toContain(T.faceAny)
  });

  // ADP-4a (owner D1-D3; AC1 / AC5): THE ADP-4a GUARDS. (1) every line the tab now names that it never did has a positive case
  // off the calculator and a negative one, on v38 and (the per-piece line) on the ADP-1 config; (2) on v50 itself the named set
  // EQUALS the generated set; (3) every ADP family on v50 has a positive and a negative case of its own; (4) that guard is not
  // vacuous -- a fake family in an in-memory copy is reported
  it("ADP-4a: every line the ADP tab gains has a positive and a negative case; v50's tab is exactly the named set", () => {
    for (const t of [...NEW_ADP4A_V38, T.convPiece]) {
      const mine = CASES.filter((c) => c.cat === ADP && c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos" && c.path !== "calc"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    for (const t of NEW_ADP4A_V38) expect(titles(ADP)).toContain(t);
    const t50 = itemListRuleOrder(CFG_V50[ADP], ITEMS_V50).map((l) => l.title);
    expect(t50).toHaveLength(38);
    const named = new Set([...CASES.filter((c) => c.cat === ADP).map((c) => c.rule), ...PICKER_CASES.map((p) => p.rule), ...Object.keys(NOT_PANEL_RULES)]);
    expect({ uncovered: t50.filter((t) => !named.has(t)) }).toEqual({ uncovered: [] });
    // Insulation and Piping on v50: the tab of v49 exactly (ADP-4a changes ADP's config only)
    for (const cat of [INS, PIP]) expect(itemListRuleOrder(CFG_V50[cat], ITEMS_V50).map((l) => l.title)).toEqual(itemListRuleOrder(CFG_ADP3B[cat], ITEMS_ADP2).map((l) => l.title));
  });

  // ADP-5a (owner rulings 2026-10-22; AC8): THE ADP-5a GUARD on v51 -- the one line it adds is LAST; the three rules it builds on
  // existing lines (the defaults, both-streams and sizes lines) each have a positive and a negative case of their own, on v51,
  // from real stored rows with their figures; v51's ADP tab is exactly the named set; Insulation and Piping are v50's tab exactly
  it("ADP-5a: the new line is last on v51, each rule has a positive and a negative case, the named set is the tab", () => {
    const t51 = itemListRuleOrder(CFG_V51[ADP], ITEMS_V51).map((l) => l.title);
    const t50 = itemListRuleOrder(CFG_V50[ADP], ITEMS_V50).map((l) => l.title);
    expect(t51[t51.length - 1]).toBe(T.mergeSpigot);
    expect(t51.filter((t) => !t50.includes(t))).toEqual([T.mergeSpigot]);
    expect(t50.filter((t) => !t51.includes(t))).toEqual([]);
    for (const t of [T.mergeSpigot, T.defaults, T.h5Both, T.sizesAdp]) {
      const mine = CASES.filter((c) => c.cat === ADP && c.rule === t && c.adp5a);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos" && c.path !== "calc"), neg: mine.some((c) => c.kind === "neg"), figures: mine.every((c) => c.figures !== undefined) })
        .toEqual({ rule: t, pos: true, neg: true, figures: true });
    }
    const named = new Set([...CASES.filter((c) => c.cat === ADP).map((c) => c.rule), ...PICKER_CASES.map((p) => p.rule), ...Object.keys(NOT_PANEL_RULES)]);
    expect({ uncovered: t51.filter((t) => !named.has(t)) }).toEqual({ uncovered: [] });
    for (const cat of [INS, PIP]) expect(itemListRuleOrder(CFG_V51[cat], ITEMS_V51).map((l) => l.title)).toEqual(itemListRuleOrder(CFG_V50[cat], ITEMS_V50).map((l) => l.title));
  });

  const caseFamily = (c: Case): string | null => c.family ?? (c.model?.[0]?.family as string | undefined) ?? c.edits?.[0]?.family ?? null;
  const uncoveredFamilies = (families: string[]) => families.filter((f) => {
    const mine = CASES.filter((c) => c.cat === ADP && caseFamily(c) === f);
    return !(mine.some((c) => c.kind === "pos") && mine.some((c) => c.kind === "neg"));
  });
  it("ADP-4a (AC5): THE FAMILY GUARD -- every ADP family on v50 has a positive and a negative case of its own", () => {
    const families = Object.keys(itemListPricingSpec(CFG_V50[ADP])!.families);
    expect(families).toHaveLength(25);
    expect(uncoveredFamilies(families)).toEqual([]);
    // the ten families that had none before ADP-4a are named by exactly their F cases, on v50, with their figures
    const F = CASES.filter((c) => /^F\d+[ab]/.test(c.id));
    expect(F).toHaveLength(20);
    expect(F.every((c) => c.adp4a && c.cat === ADP && c.rule === T.kind && c.family)).toBe(true);
    expect(new Set(F.map((c) => c.family)).size).toBe(10);
    expect(F.filter((c) => c.kind === "pos").every((c) => c.figures !== undefined)).toBe(true);
  });
  it("ADP-4a (AC5): the family guard is not vacuous -- a fake family in an in-memory copy is reported", () => {
    const families = [...Object.keys(itemListPricingSpec(CFG_V50[ADP])!.families), "a fake kind for the vacuity proof"];
    expect(uncoveredFamilies(families)).toEqual(["a fake kind for the vacuity proof"]);
  });

  it("12e-6c: every new Insulation line (live v46) has a positive and a negative case; ADP and Piping gain none", () => {
    const NEW = [T.noUnit, T.rpuf, T.giMap, T.cloth, T.typedSize];
    const tLive = (cat: string) => itemListRuleOrder(CFG_LIVE[cat], ITEMS_LIVE).map((l) => l.title);
    expect(NEW.filter((t) => tLive(INS).includes(t))).toEqual(NEW);
    for (const t of NEW) {
      const mine = CASES.filter((c) => c.cat === INS && c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos" && c.path !== "calc"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    for (const t of [T.rpuf, T.giMap, T.cloth]) { expect(tLive(ADP)).not.toContain(t); expect(tLive(PIP)).not.toContain(t); }
    expect(tLive(ADP)).not.toContain(T.noUnit);
  });

  it("every panel-path rule has a POSITIVE model-read case and a NEGATIVE (near-miss) case", () => {
    for (const cat of [INS, ADP, PIP]) {
      for (const t of titles(cat)) {
        if (t in NOT_PANEL_RULES || t === T.notOffered) continue;   // ADP-4a: T.notOffered is no longer generated on ADP (kept for the skip's history)
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
    if (c.figures) expect({ id: c.id, figures: [s.values.supply_rate, s.values.install_rate] }).toEqual({ id: c.id, figures: c.figures });   // ADP-4a (AC5)
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
    { id: "R4xRange (F-2)", rule: "matchStatedToOption x the range reader", cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(PUFI, { thickness_mm: "25 to 50" })], re: ["the higher, 50, is taken"], working: ["25 to 50 -> 50 mm (states a range - the higher, 50, is taken)"], priced: true },   // 12e-6 AC8 INVERTED: BEFORE re ["-> its top value 50"], working ["its top value 50"]   // INVERTED at ADP-4a (AC3: the reader's line stands once, on the field's note) by mechanical authority: BEFORE working ["'25 to 50' states a range - the higher, 50, is taken"]
    { id: "R4xInch", rule: "matchStatedToOption x inches (not an option: left alone)", cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: '5/8"' })], re: ["15.88"], priced: true },
    { id: "R4xSizeMatch", rule: "matchStatedToOption x size_match", cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "22.2" })], re: ["pipe size 22.2 is 22.23 on the sheet"], priced: true },
    { id: "R4xText", rule: "matchStatedToOption x a choice spelled differently (the intended rewrite)", cat: ADP, path: "panel", kind: "pos", unit: "sqm", model: [{ family: "VCD", variant: "gi rectangular" }], re: ["BoQ says gi rectangular -> GI rectangular (the sheet's own spelling of this value)"], priced: true, pure: false },
    // INVERTED at 12e-2b (AC13: a LADDER field's stale pick ladders). BEFORE: re ["25 mm is not stocked with the other answers on this
    // item -- choose again", "choose again: thickness"], priced false. The 12d-7 F-1 half is kept: the 9 mm default never fills it.
    { id: "R5xDefault (F-1)", rule: "unstockedPicks x number_defaults", cat: INS, path: "calc", kind: "pos", edits: calc(PUF, { cladding: "No", pipe_size_mm: "100", thickness_mm: "25" }), rowUnit: "mts", re: ["thickness_mm:25 mm is not stocked with pipe size 100 -> priced as 65 mm (the smallest size)" /* 12e-4d (AC3): BEFORE "... (next size up)" */, "thickness_mm:25 mm is not stocked with pipe size 100 -> priced as 65 mm (the smallest size)"], not: ["not mentioned -> 9", "choose again"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE "thickness 25 is not on the sheet -> 65 (the smallest size" /* 12e-4d (AC3): BEFORE "... (next size up" */
    // INVERTED at 12e-2b (AC13). BEFORE: rule "... (a cleared pick must not price EITHER way)", re ["choose again: thickness"], priced false.
    { id: "R5xCompose (F-1)", rule: "unstockedPicks x composition (a ladder pick composes exactly as the same value typed)", cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", pipe_size_mm: "6.35", thickness_mm: "25" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["25 mm is not stocked with pipe size 6.35 -> priced as 13 + 13 mm (26 mm, +1) -- above the largest stocked size (19 mm)"], not: ["not mentioned -> 9", "choose again"], priced: true },
    // INVERTED at 12e-2b (D1 (a) + D2). BEFORE: re ["choose again: whether it is UL listed"], priced false. The F-1 half is kept: no UL default fires.
    { id: "R5xAbsentAsNone (F-1)", rule: "unstockedPicks x absent_as_none + override_when", cat: ADP, path: "calc", kind: "pos", edits: calc("fire damper", { variant: "motorised", ul: "yes", size_mm: "600x600" }), rowUnit: "nos", re: ["UL stated, so the UL 555 SKU is used"], not: ["ul not mentioned -> no", "choose again"], priced: true },
    // 12e-2b (AC13): one named case per LADDER field kind a block's other answer can unstock -- and the choice-field negative
    { id: "R5xLadderTorque (AC13)", rule: "unstockedPicks x a ladder pick (torque under UL): laddered, never cleared", cat: ADP, path: "calc", kind: "pos", edits: calc("actuator", { torque: "6", ul: "yes" }), rowUnit: "nos", re: ["torque:6 Nm is not stocked with UL listed yes -> priced as 8 Nm (next size up)" /* 12e-3b (Q13): BEFORE "torque:6 nm ... priced as 8 nm (next size up)" */, "torque:6 Nm is not stocked with UL listed yes -> priced as 8 Nm (next size up)"], not: ["choose again"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE "torque 6 is not on the sheet -> 8 (next size up"
    { id: "R5xChoiceStillClears (AC13 neg)", rule: "unstockedPicks x a CHOICE pick (no ladder): still cleared, never refilled", cat: INS, path: "calc", kind: "neg", edits: calc(ACO, { cladding: "Aluminium Foil", thickness_mm: "19" }), rowUnit: "sqm", re: ["Aluminium Foil is not stocked with the other answers on this item -- choose again", "choose again: cladding"], not: ["priced as", "cladding not mentioned"], priced: false, pure: false },
    { id: "R5xOther", rule: "unstockedPicks x a value typed through Other... (never cleared)", cat: INS, path: "calc", kind: "pos", edits: calc(PUF, { cladding: "No", pipe_size_mm: "100", thickness_mm: "25" }, ["thickness_mm"]), rowUnit: "mts", re: ["thickness_mm:You typed 25 mm -> priced as 65 mm (the smallest size)"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["thickness 25 is not on the sheet -> 65 (the smallest size" /* 12e-4d (AC3): BEFORE "... (next size up" */]
    { id: "R5xModel", rule: "unstockedPicks x a model value (never cleared)", cat: INS, path: "panel", kind: "pos", unit: "RMT", model: [m(PUFI, { thickness_mm: "25" })], re: ["thickness_mm:BoQ says 25 mm -> priced as 65 mm (the smallest size)"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["thickness 25 is not on the sheet -> 65 (the smallest size" /* 12e-4d (AC3): BEFORE "... (next size up" */]
    { id: "R5xModelOpenedBox (F-3)", rule: "unstockedPicks x a size typed into a MODEL-opened Other... box", cat: INS, path: "ptyped", kind: "pos", unit: "RMT", model: [m(NIT, { pipe_size_mm: "250 NB" })], edits: ptyped({ pipe_size_mm: "50" }), re: ["pipe_size_mm:You typed 50 mm -> priced as 53.98 mm (next size up)", "pipe_size_mm:otherMode=true typed=50"], not: ["not stocked with the other answers"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE "pipe size 50 is not on the sheet -> 53.98"
    { id: "R5xFoil (R4b)", rule: "unstockedPicks x value_map (an offered mapped value is a stocked pick)", cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "Aluminium Foil", thickness_mm: "19", pipe_size_mm: "50" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["foil on a pipe is priced as 26G cladding"], not: ["not stocked"], priced: true },
    { id: "R2xU4decimal", rule: "assembleItems typed marker x U4 (a decimal typed thickness is accepted)", cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "12.5", pipe_size_mm: "50" }, ["thickness_mm", "pipe_size_mm"]), rowUnit: "mts", re: ["thickness_mm:You typed 12.5 mm -> priced as 13 mm (the smallest size)"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["thickness 12.5 is not on the sheet -> 13 (the smallest size" /* 12e-4d (AC3): BEFORE "... (next size up" */]
    { id: "R2xU4pipe", rule: "assembleItems typed marker x U4 (the pipe-size box is untouched)", cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50 NB" }, ["pipe_size_mm"]), rowUnit: "mts", re: ["53.98"], priced: true },
    { id: "R2xAdded", rule: "assembleItems x needs (an added item starts from its family alone)", cat: INS, path: "ptyped", kind: "pos", unit: "RMT", model: [NIT], edits: [{ base: 0, family: null, attrs: {}, other: [] }, { base: null, family: PUF, attrs: {}, other: [] }], re: ["could not tell cladding"], priced: false },
    { id: "R1xBadBase", rule: "decodeItemEdits x family_when_none (an out-of-range base is dropped, never priced silently)", cat: INS, path: "ptyped", kind: "pos", unit: "RMT", model: [NIT], edits: [{ base: 5, family: null, attrs: {}, other: [] }], re: ["could not tell cladding"], priced: false },
    { id: "R3xUnitStale", rule: "the row-unit override x unit rules (a pick no longer offered falls to the first offered class)", cat: INS, path: "calc", kind: "pos", edits: calc(NR, { cladding: "26G Aluminium", thickness_mm: "19", pipe_size_mm: "50" }, ["pipe_size_mm"]), rowUnit: "sqm", re: [], priced: true },
    { id: "R6xHeadings", rule: "row text x family_when_none (headings reach it) and x named_in_row (headings never do)", cat: INS, path: "panel", kind: "pos", unit: "sqm", model: [m(THMI, { item: "None", cladding: "None" })], headings: ["Acoustic lining with aluminium cladding"], re: ["family:Acoustic Nitrile Insulation", "material not mentioned -> Nitrile by row kind", "cladding:cladding not mentioned -> without cladding"], not: ["cladding named in this row", "item not mentioned"], priced: true },   // INVERTED at ADP-4a (AC3: stated once, on the field) by mechanical authority: BEFORE re: ["insulation material not mentioned -> Acoustic Nitrile Insulation (" /* 12e-4b (G3): BEFORE "item not mentioned -> Acoustic Nitrile Insulation (" */, "cladding not mentioned -> No (without cladding)" /* 12e-4b (G2): BEFORE "cladding not mentioned -> No (" */]
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
    const { s, v, text, working, pure, notes } = run(c);
    for (const p of c.re) expect({ id: c.id, has: p, hit: matches(text, p) }).toEqual({ id: c.id, has: p, hit: true });
    // INVERTED at ADP-4a (owner D5 / AC3: a reader's line is stated ONCE, on its field, and its copy leaves the working) by
    // mechanical authority: BEFORE `working.some(...)`. The field's note is built from the SAME panel-path pricer result, so
    // F-2's point -- the reader's words reach the pricer and are shown -- is read from the working or that note
    for (const p of c.working ?? []) expect({ id: c.id, inWorking: p, hit: [...working, ...notes].some((w) => matches(w, p)) }).toEqual({ id: c.id, inWorking: p, hit: true });
    for (const p of c.not ?? []) expect({ id: c.id, forbidden: p, hit: matches(text, p) }).toEqual({ id: c.id, forbidden: p, hit: false });
    if (c.priced !== undefined) expect({ id: c.id, priced: v.rowPriced }).toEqual({ id: c.id, priced: c.priced });
    if (c.pure !== false && v.rowPriced) expect([s.values.supply_rate, s.values.install_rate]).toEqual([pure.supply, pure.install]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// VRF-2a (owner 2026-11-03; HVAC v56) -- R-39 FOR VRF: every Derivation-tab line of `hvac_vrf` has a positive and a negative case
// run through the panel's entry point (`makePricingSheetHelper(...).compute`), with the calculator beside it; THE VRF GUARD.
//
// The live v56 config carries `calculator_only` (owner Q1 A, temporary, removed at VRF-4): its BoQ panel declines every row.
// The panel cases therefore run on the config with the key PROJECTED OUT -- exactly what the panel runs at VRF-4 -- and every
// case is also asserted to DECLINE on the live config (no flag), so a case can never pass by reaching a live BoQ row. The
// calculator cases run on the live config with the calculator's own flag (`calculatorSurface`), as `PricingCalculator` builds it.
// The guard below is the same assertion as T1's guard (the rules this file names EQUAL the rules the config generates), on VRF.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("VRF-2a (v56) -- R-39: every VRF Derivation-tab rule fires from the panel's entry point; THE VRF GUARD", () => {
  const A56 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v56.json", import.meta.url),
  );
  const VRF = "hvac_vrf";
  const items56: RateMasterItem[] = A56.items.map((it) => ({ ...it, discipline: A56.discipline,
    attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const live = new Map<string, RateCategoryConfig>(A56.category_configs.map((c) => [c.category_id, c]));
  const projected = new Map<string, RateCategoryConfig>([...live].map(([k, c]) => {
    if (k !== VRF) return [k, c];
    const { calculator_only: _off, ...rest } = c as RateCategoryConfig & { calculator_only?: unknown };
    return [k, rest as RateCategoryConfig];
  }));
  const VT = {
    unit: T.unit, kind: T.kind, noSku: T.noSku, ruleForUnit: T.ruleForUnit, needs: T.needs, defaults: T.defaults,
    ctrl: "Daikin as the brand on Touch Screen Central Controller is priced as Blue Star",
    fit: "Fitting the stated capacity to the catalogue",
    steps: T.steps, qty: T.qty, a3Unit: T.a3Unit, a3Unstocked: T.a3Unstocked,
  };
  type VCase = { id: string; rule: string; path: "panel" | "calc"; kind: "pos" | "neg"; unit?: string; model?: Record<string, string>;
    family?: string; attrs?: Record<string, string>; other?: string[]; qty?: string; rowUnit?: string;
    re: Array<string | RegExp>; not?: Array<string | RegExp>; priced?: boolean; figures?: [number, number] };
  const OD16 = { item: "Outdoor Unit", capacity: "16" };
  const VCASES: VCase[] = [
    // 1. the row's unit
    { id: "V1a", rule: VT.unit, path: "panel", kind: "pos", unit: "", model: OD16, re: ["No unit on the BoQ row -> priced per Nos, the catalogue's unit for this item"], priced: true, figures: [436920, 16000] },
    { id: "V1b", rule: VT.unit, path: "panel", kind: "pos", unit: "R/O", model: OD16, re: ["BoQ says R/O (rate only) -> priced per Nos, the catalogue's unit for this item"], priced: true },
    { id: "V1c-neg", rule: VT.unit, path: "panel", kind: "neg", unit: "Nos", model: OD16, re: ["family:Outdoor Unit"], not: ["No unit on the BoQ row", "rate only"], priced: true },
    // 2. the item's own kind
    { id: "V2a", rule: VT.kind, path: "panel", kind: "pos", unit: "Nos", model: OD16, re: ["family:Outdoor Unit", "Top Discharge / (Nos)"], priced: true },
    { id: "V2b-neg", rule: VT.kind, path: "panel", kind: "neg", unit: "Nos", model: { item: "ABC", capacity: "16" }, re: ["no SKU in the catalogue for 'ABC' -- the user decides"], priced: false },
    // 3. "none of these" is a person's call
    { id: "V3a", rule: VT.noSku, path: "panel", kind: "pos", unit: "Nos", model: { item: "none of these" }, re: ["no SKU in the catalogue for 'none of these' -- the user decides"], priced: false },
    { id: "V3b-neg", rule: VT.noSku, path: "panel", kind: "neg", unit: "Nos", model: { item: "Ductable", brand: "Blue Star", capacity: "8" }, re: ["family:Ductable"], not: ["the user decides"], priced: true, figures: [62280, 7500] },
    // 4. that kind's rule for that unit
    { id: "V4a", rule: VT.ruleForUnit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Verticool", brand: "Blue Star", capacity: "2" }, re: ["Verticool / (Nos)"], priced: true, figures: [41040, 3500] },
    { id: "V4b-neg", rule: VT.ruleForUnit, path: "panel", kind: "neg", unit: "Set", model: OD16, re: ["Outdoor Unit is not stocked per 'Set' (stocked per Nos) - price this row by hand"], not: ["/ (Nos)"], priced: false },
    // 5. the facts the rule needs
    { id: "V5a", rule: VT.needs, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit" }, re: ["no capacity stated"], priced: false },
    { id: "V5a-calc", rule: VT.needs, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: {}, re: ["no capacity stated"], priced: false },
    { id: "V5b-neg", rule: VT.needs, path: "panel", kind: "neg", unit: "Nos", model: OD16, re: [], not: ["no capacity stated"], priced: true },
    // 6. a fact the row does not mention takes its ruled value (amber)
    { id: "V6a", rule: VT.defaults, path: "panel", kind: "pos", unit: "Nos", model: OD16, priced: true,
      re: ["brand:no brand stated - priced as Blue Star", "cooling:cooling not stated - priced as Cool Only (team default: heat pump only when the BoQ mentions it)",
           "discharge:discharge not stated - priced as Top discharge (team default)", "compressor:compressor not stated - priced as Standard (team default)"] },
    { id: "V6a-calc", rule: VT.defaults, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "16" }, re: ["brand:no brand stated - priced as Blue Star"], priced: true, figures: [436920, 16000] },
    { id: "V6b-neg", rule: VT.defaults, path: "panel", kind: "neg", unit: "Nos", model: { item: "Outdoor Unit", brand: "Daikin", cooling: "Heat Pump", capacity: "8" }, priced: true, figures: [253743, 12800],
      re: [], not: ["brand:no brand stated", "cooling:cooling not stated"] },
    // 7. the controller map
    { id: "V7a", rule: VT.ctrl, path: "panel", kind: "pos", unit: "Nos", model: { item: "Touch Screen Central Controller", brand: "Daikin" }, priced: true, figures: [42000, 1500],
      re: ["brand:the central controller is Blue Star only on the sheet - a Daikin pick is priced as Blue Star (R-SMALL)"] },
    { id: "V7a-calc", rule: VT.ctrl, path: "calc", kind: "pos", family: "Touch Screen Central Controller", attrs: { brand: "Daikin" }, priced: true, figures: [42000, 1500],
      re: ["the central controller is Blue Star only on the sheet - a Daikin pick is priced as Blue Star (R-SMALL)"] },
    { id: "V7b-neg", rule: VT.ctrl, path: "panel", kind: "neg", unit: "Nos", model: { item: "Touch Screen Central Controller", brand: "Blue Star" }, priced: true, re: [], not: ["a Daikin pick is priced as Blue Star"] },
    // 8. fitting the stated capacity
    { id: "V8a", rule: VT.fit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", capacity: "15" }, re: ["capacity:BoQ says 15 -> priced as 16 (next size up)"], priced: true, figures: [436920, 16000] },
    { id: "V8b", rule: VT.fit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", capacity: "2" }, re: ["capacity:BoQ says 2 -> priced as 7 (the smallest size)"], priced: true, figures: [264240, 7000] },
    { id: "V8c", rule: VT.fit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Ductable", brand: "Blue Star", capacity: "11" }, re: ["capacity 11 is above the largest size on the sheet (8)"], priced: false },
    { id: "V8a-calc", rule: VT.fit, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "15" }, other: ["capacity"], re: ["capacity:You typed 15 -> priced as 16 (next size up)"], priced: true },
    { id: "V8d-neg", rule: VT.fit, path: "panel", kind: "neg", unit: "Nos", model: OD16, re: [], not: ["next size up", "the smallest size", "above the largest"], priced: true },
    // 9. the priced steps
    { id: "V9a", rule: VT.steps, path: "panel", kind: "pos", unit: "Nos", model: OD16, priced: true,
      re: ["supply: BCS supply x (1 + the SKU's supply markup) = 436920", "supply: ROUNDUP(supply, 0) (R-ROUND) = 436920", "install: the SKU's BOQ installation, as the sheet gives it (R-INSTALL) = 16000", "install: ROUNDUP(install, 0) (R-ROUND) = 16000"] },
    { id: "V9b-neg", rule: VT.steps, path: "panel", kind: "neg", unit: "Nos", model: { item: "Outdoor Unit", capacity: "40" }, re: ["capacity 40 is above the largest size on the sheet (28)"], not: ["ROUNDUP(supply, 0)"], priced: false },
    // 10. how many of the item one unit of the row pays for
    { id: "V10a-calc", rule: VT.qty, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "16" }, qty: "2", re: ["x 2 per row unit"], priced: true, figures: [873840, 32000] },
    { id: "V10b-neg", rule: VT.qty, path: "calc", kind: "neg", family: "Outdoor Unit", attrs: { capacity: "16" }, re: [], not: ["per row unit"], priced: true, figures: [436920, 16000] },
    // 11. a kind not stocked in the row's unit
    { id: "V11a", rule: VT.a3Unit, path: "panel", kind: "pos", unit: "Lot", model: OD16, re: ["Outdoor Unit is not stocked per 'Lot' (stocked per Nos) - price this row by hand"], priced: false },
    { id: "V11b", rule: VT.a3Unit, path: "panel", kind: "pos", unit: "Kg", model: OD16, re: ["Outdoor Unit is not stocked per 'Kg' (stocked per Nos) - price this row by hand"], priced: false },
    { id: "V11c-neg", rule: VT.a3Unit, path: "panel", kind: "neg", unit: "Nos/Ro", model: OD16, re: ["family:Outdoor Unit"], not: ["is not stocked per"], priced: true, figures: [436920, 16000] },
    // 12. an unstocked combination names only the facts the kind's products vary on
    { id: "V12a", rule: VT.a3Unstocked, path: "panel", kind: "pos", unit: "Nos", model: { item: "Verticool", brand: "Daikin", capacity: "2" }, re: ["No SKU for Verticool: brand Daikin - price this row by hand"], not: ["capacity 2"], priced: false },
    { id: "V12a-calc", rule: VT.a3Unstocked, path: "calc", kind: "pos", family: "Verticool", attrs: { brand: "Daikin", capacity: "2" }, re: ["No SKU for Verticool: brand Daikin - price this row by hand"], priced: false },
    { id: "V12b-neg", rule: VT.a3Unstocked, path: "panel", kind: "neg", unit: "Nos", model: { item: "Verticool", brand: "Blue Star", capacity: "2" }, re: ["family:Verticool"], not: ["No SKU for Verticool"], priced: true },
  ];
  const vcells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
  function vrun(c: VCase, cfgs: Map<string, RateCategoryConfig> = c.path === "calc" ? live : projected) {
    const ext = new Map<number, ExtractionRow>();
    if (c.path === "panel") ext.set(1, { excelRow: 1, description: "", attributes: {}, items: [{ attributes: vcells(c.model ?? {}) }] } as unknown as ExtractionRow);
    const h = makePricingSheetHelper({ configsByCategory: cfgs, items: items56, extractionByRow: ext });
    const ctx: RateHelperRowContext & { unit?: string } = { excelRow: c.path === "calc" ? 0 : 1, description: "", nodeType: c.path === "calc" ? "" : "Line Item",
      category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: [], ownNotes: [] };
    if (c.path === "panel" && c.unit !== undefined) ctx.unit = c.unit;
    const overrides: Record<string, string> = {};
    if (c.path === "calc") {
      overrides[ITEM_LIST_OVERRIDE_KEY] = JSON.stringify({ items: [{ base: null, family: c.family ?? null, attrs: c.attrs ?? {}, other: c.other ?? [], ...(c.qty !== undefined ? { qty: c.qty } : {}) }] });
      overrides[ROW_UNIT_OVERRIDE_KEY] = c.rowUnit ?? "Nos";
    }
    return h.compute(ctx, overrides);
  }
  function vlines(r: ReturnType<typeof vrun>) {
    if (!isSuggestion(r)) return { priced: false, text: `declined:${(r as { reason?: string }).reason ?? ""}`, s: null };
    const s = r as ItemListSuggestion;
    const v = s.itemList!;
    const out: string[] = [];
    if (v.reason) out.push(v.reason);
    if (v.unitNote) out.push(v.unitNote);
    out.push(...(s.workings.derivation ?? []));
    for (const b of v.items) {
      if (b.family) out.push(`family:${b.family}`);
      if (b.reason) out.push(b.reason);
      if (b.skuLine) out.push(b.skuLine);
      if (b.familyLine) out.push(b.familyLine);
      out.push(...b.working);
      for (const f of b.fields) { if (f.note) out.push(`${f.id}:${f.note}`); if (f.rule) out.push(`${f.id}:${f.rule}`); }
    }
    return { priced: v.rowPriced, text: out.join("\n"), s };
  }
  const vmatch = (text: string, p: string | RegExp) => (typeof p === "string" ? text.includes(p) : p.test(text));
  const titles = () => itemListRuleOrder(live.get(VRF), items56).map((l) => l.title);

  it("THE VRF GUARD: the rules this block names EQUAL the rules v56's VRF config generates (12); each has a positive AND a negative case", () => {
    const generated = new Set(titles());
    expect(titles()).toHaveLength(12);
    const named = new Set(VCASES.map((c) => c.rule));
    expect({ uncovered: [...generated].filter((t) => !named.has(t)), dead: [...named].filter((t) => !generated.has(t)) }).toEqual({ uncovered: [], dead: [] });
    for (const t of generated) {
      const mine = VCASES.filter((c) => c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    expect(VCASES).toHaveLength(33);
    // the projected config generates the same tab (the key changes who may price, never which rules exist)
    expect(itemListRuleOrder(projected.get(VRF), items56).map((l) => l.title)).toEqual(titles());
  });

  it.each(VCASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const { priced, text, s } = vlines(vrun(c));
    for (const p of c.re) expect({ id: c.id, want: p, hit: vmatch(text, p), text }).toEqual({ id: c.id, want: p, hit: true, text });
    for (const p of c.not ?? []) expect({ id: c.id, forbidden: p, hit: vmatch(text, p) }).toEqual({ id: c.id, forbidden: p, hit: false });
    if (c.priced !== undefined) expect({ id: c.id, priced }).toEqual({ id: c.id, priced: c.priced });
    if (c.figures) expect([s!.values.supply_rate, s!.values.install_rate]).toEqual(c.figures);
    // INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; D-10) by mechanical authority: BEFORE `expect(vrun(c, live).kind).toBe("none")` (the live
    // frozen config, `calculator_only` on, declined on a BoQ row). The key is read by nothing now: the BoQ row prices exactly as the projection
    if (c.path === "panel") expect(JSON.stringify(vrun(c, live))).toBe(JSON.stringify(vrun(c)));
  });
});

/**
 * VRF-2b (owner 2026-11-03, QR-1 U7 A) -- R-39 ON v57: VRF-2a's guard copied onto the v57 asset, with a case (positive AND
 * negative) for every line v57 adds -- the conversion line and the brand line -- and the 2b paths of the lines that
 * stayed (the Misc four per Nos / Kg, "Nos/Ro" read as Nos, Kg now a known unit). VRF-2a's v56 block above is kept as
 * it was (it pins v56).
 */
describe("VRF-2b (v57) -- R-39: every VRF Derivation-tab rule fires from the panel's entry point; THE VRF GUARD", () => {
  const A57 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v57.json", import.meta.url),
  );
  const VRF = "hvac_vrf";
  const items57: RateMasterItem[] = A57.items.map((it) => ({ ...it, discipline: A57.discipline,
    attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const live = new Map<string, RateCategoryConfig>(A57.category_configs.map((c) => [c.category_id, c]));
  const projected = new Map<string, RateCategoryConfig>([...live].map(([k, c]) => {
    if (k !== VRF) return [k, c];
    const { calculator_only: _off, ...rest } = c as RateCategoryConfig & { calculator_only?: unknown };
    return [k, rest as RateCategoryConfig];
  }));
  const VT = {
    unit: T.unit, kind: T.kind, noSku: T.noSku, ruleForUnit: T.ruleForUnit, needs: T.needs, defaults: T.defaults,
    ctrl: "Daikin as the brand on Touch Screen Central Controller is priced as Blue Star",
    fit: "Fitting the stated capacity to the catalogue",
    brand: "Several brands, or one brand not on the sheet, are priced as Blue Star, naming the row's words",
    conv: "A capacity in TR, HP or kW that is not the item's own unit is converted first",
    steps: T.steps, qty: T.qty, a3Unit: T.a3Unit, a3Unstocked: T.a3Unstocked,
  };
  type VCase = { id: string; rule: string; path: "panel" | "calc"; kind: "pos" | "neg"; unit?: string; model?: Record<string, string>;
    family?: string; attrs?: Record<string, string>; other?: string[]; qty?: string; rowUnit?: string;
    re: Array<string | RegExp>; not?: Array<string | RegExp>; priced?: boolean; figures?: [number, number] };
  const OD16 = { item: "Outdoor Unit", capacity: "16" };
  const VCASES: VCase[] = [
    // 1. the row's unit
    { id: "V1a", rule: VT.unit, path: "panel", kind: "pos", unit: "", model: OD16, re: ["No unit on the BoQ row -> priced per Nos, the catalogue's unit for this item"], priced: true, figures: [436920, 16000] },
    { id: "V1b", rule: VT.unit, path: "panel", kind: "pos", unit: "R/O", model: OD16, re: ["BoQ says R/O (rate only) -> priced per Nos, the catalogue's unit for this item"], priced: true },
    { id: "V1c-neg", rule: VT.unit, path: "panel", kind: "neg", unit: "Nos", model: OD16, re: ["family:Outdoor Unit"], not: ["No unit on the BoQ row", "rate only"], priced: true },
    // 2. the item's own kind
    { id: "V2a", rule: VT.kind, path: "panel", kind: "pos", unit: "Nos", model: OD16, re: ["family:Outdoor Unit", "Top Discharge / (Nos)"], priced: true },
    { id: "V2b-neg", rule: VT.kind, path: "panel", kind: "neg", unit: "Nos", model: { item: "ABC", capacity: "16" }, re: ["no SKU in the catalogue for 'ABC' -- the user decides"], priced: false },
    // 3. "none of these" is a person's call
    { id: "V3a", rule: VT.noSku, path: "panel", kind: "pos", unit: "Nos", model: { item: "none of these" }, re: ["no SKU in the catalogue for 'none of these' -- the user decides"], priced: false },
    { id: "V3b-neg", rule: VT.noSku, path: "panel", kind: "neg", unit: "Nos", model: { item: "Ductable", brand: "Blue Star", capacity: "8" }, re: ["family:Ductable"], not: ["the user decides"], priced: true, figures: [62280, 7500] },
    // 4. that kind's rule for that unit
    { id: "V4a", rule: VT.ruleForUnit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Verticool", brand: "Blue Star", capacity: "2" }, re: ["Verticool / (Nos)"], priced: true, figures: [41040, 3500] },
    { id: "V4b-neg", rule: VT.ruleForUnit, path: "panel", kind: "neg", unit: "Set", model: OD16, re: ["Outdoor Unit is not stocked per 'Set' (stocked per Nos) - price this row by hand"], not: ["/ (Nos)"], priced: false },
    // 5. the facts the rule needs
    { id: "V5a", rule: VT.needs, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit" }, re: ["no capacity stated"], priced: false },
    { id: "V5a-calc", rule: VT.needs, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: {}, re: ["no capacity stated"], priced: false },
    { id: "V5b-neg", rule: VT.needs, path: "panel", kind: "neg", unit: "Nos", model: OD16, re: [], not: ["no capacity stated"], priced: true },
    // 6. a fact the row does not mention takes its ruled value (amber)
    { id: "V6a", rule: VT.defaults, path: "panel", kind: "pos", unit: "Nos", model: OD16, priced: true,
      re: ["brand:no brand stated - priced as Blue Star", "cooling:cooling not stated - priced as Cool Only (team default: heat pump only when the BoQ mentions it)",
           "discharge:discharge not stated - priced as Top discharge (team default)", "compressor:compressor not stated - priced as Standard (team default)"] },
    { id: "V6a-calc", rule: VT.defaults, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "16" }, re: ["brand:no brand stated - priced as Blue Star"], priced: true, figures: [436920, 16000] },
    { id: "V6b-neg", rule: VT.defaults, path: "panel", kind: "neg", unit: "Nos", model: { item: "Outdoor Unit", brand: "Daikin", cooling: "Heat Pump", capacity: "8" }, priced: true, figures: [253743, 12800],
      re: [], not: ["brand:no brand stated", "cooling:cooling not stated"] },
    // 7. the controller map
    { id: "V7a", rule: VT.ctrl, path: "panel", kind: "pos", unit: "Nos", model: { item: "Touch Screen Central Controller", brand: "Daikin" }, priced: true, figures: [42000, 1500],
      re: ["brand:the central controller is Blue Star only on the sheet - a Daikin pick is priced as Blue Star (R-SMALL)"] },
    { id: "V7a-calc", rule: VT.ctrl, path: "calc", kind: "pos", family: "Touch Screen Central Controller", attrs: { brand: "Daikin" }, priced: true, figures: [42000, 1500],
      re: ["the central controller is Blue Star only on the sheet - a Daikin pick is priced as Blue Star (R-SMALL)"] },
    { id: "V7b-neg", rule: VT.ctrl, path: "panel", kind: "neg", unit: "Nos", model: { item: "Touch Screen Central Controller", brand: "Blue Star" }, priced: true, re: [], not: ["a Daikin pick is priced as Blue Star"] },
    // 8. fitting the stated capacity
    { id: "V8a", rule: VT.fit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", capacity: "15" }, re: ["capacity:BoQ says 15 -> priced as 16 (next size up)"], priced: true, figures: [436920, 16000] },
    { id: "V8b", rule: VT.fit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", capacity: "2" }, re: ["capacity:BoQ says 2 -> priced as 7 (the smallest size)"], priced: true, figures: [264240, 7000] },
    { id: "V8c", rule: VT.fit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Ductable", brand: "Blue Star", capacity: "11" }, re: ["capacity 11 is above the largest size on the sheet (8)"], priced: false },
    { id: "V8a-calc", rule: VT.fit, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "15" }, other: ["capacity"], re: ["capacity:You typed 15 -> priced as 16 (next size up)"], priced: true },
    { id: "V8d-neg", rule: VT.fit, path: "panel", kind: "neg", unit: "Nos", model: OD16, re: [], not: ["next size up", "the smallest size", "above the largest"], priced: true },
    // 9. the priced steps
    { id: "V9a", rule: VT.steps, path: "panel", kind: "pos", unit: "Nos", model: OD16, priced: true,
      re: ["supply: BCS supply x (1 + the SKU's supply markup) = 436920", "supply: ROUNDUP(supply, 0) (R-ROUND) = 436920", "install: the SKU's BOQ installation, as the sheet gives it (R-INSTALL) = 16000", "install: ROUNDUP(install, 0) (R-ROUND) = 16000"] },
    { id: "V9b-neg", rule: VT.steps, path: "panel", kind: "neg", unit: "Nos", model: { item: "Outdoor Unit", capacity: "40" }, re: ["capacity 40 is above the largest size on the sheet (28)"], not: ["ROUNDUP(supply, 0)"], priced: false },
    // 10. how many of the item one unit of the row pays for
    { id: "V10a-calc", rule: VT.qty, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "16" }, qty: "2", re: ["x 2 per row unit"], priced: true, figures: [873840, 32000] },
    { id: "V10b-neg", rule: VT.qty, path: "calc", kind: "neg", family: "Outdoor Unit", attrs: { capacity: "16" }, re: [], not: ["per row unit"], priced: true, figures: [436920, 16000] },
    // 11. a kind not stocked in the row's unit
    { id: "V11a", rule: VT.a3Unit, path: "panel", kind: "pos", unit: "Lot", model: OD16, re: ["Outdoor Unit is not stocked per 'Lot' (stocked per Nos) - price this row by hand"], priced: false },
    { id: "V11b", rule: VT.a3Unit, path: "panel", kind: "pos", unit: "Kg", model: OD16, re: ["Outdoor Unit is not stocked per Kg (stocked per Nos) - price this row by hand"], priced: false },
    { id: "W11d", rule: VT.a3Unit, path: "panel", kind: "pos", unit: "Nos", model: { item: "MS Angle Base Frame Structure" }, re: ["MS Angle Base Frame Structure is not stocked per Nos (stocked per Kg) - price this row by hand"], priced: false },
    { id: "V11c-neg", rule: VT.a3Unit, path: "panel", kind: "neg", unit: "Nos/Ro", model: OD16, re: ["family:Outdoor Unit"], not: ["is not stocked per"], priced: true, figures: [436920, 16000] },
    // 12. an unstocked combination names only the facts the kind's products vary on
    { id: "V12a", rule: VT.a3Unstocked, path: "panel", kind: "pos", unit: "Nos", model: { item: "Verticool", brand: "Daikin", capacity: "2" }, re: ["No SKU for Verticool: brand Daikin - price this row by hand"], not: ["capacity 2"], priced: false },
    { id: "V12a-calc", rule: VT.a3Unstocked, path: "calc", kind: "pos", family: "Verticool", attrs: { brand: "Daikin", capacity: "2" }, re: ["No SKU for Verticool: brand Daikin - price this row by hand"], priced: false },
    // VRF-2b: the brand note (R-BRAND (a))
    { id: "W13a", rule: VT.brand, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", brand: "Toshiba", capacity: "16" }, re: ["brand:brand Toshiba is not on the sheet - priced as Blue Star"], priced: true, figures: [436920, 16000] },
    { id: "W13b", rule: VT.brand, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", brand: "Daikin / Toshiba", capacity: "16" }, re: ["brand:several brands stated (Daikin / Toshiba) - priced as Blue Star"], priced: true, figures: [436920, 16000] },
    { id: "W13c-neg", rule: VT.brand, path: "panel", kind: "neg", unit: "Nos", model: { item: "Outdoor Unit", brand: "Daikin", cooling: "Heat Pump", capacity: "8" }, re: [], not: ["is not on the sheet", "several brands stated"], priced: true, figures: [253743, 12800] },
    // VRF-2b: the conversion line (R-CONV / CFM / RECON)
    { id: "W14a", rule: VT.conv, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", capacity: "16 TR" }, re: ["capacity:16 TR x 1.25 (HP per TR, Pricing Inputs) = 20 HP"], priced: true, figures: [476040, 20000] },
    { id: "W14b", rule: VT.conv, path: "panel", kind: "pos", unit: "Nos", model: { item: "Hi-Wall", brand: "Blue Star", capacity: "5 kW" }, re: ["capacity:5 kW / 3.517 (kW per TR, Pricing Inputs) = 1.42 TR"], priced: true, figures: [20760, 1800] },
    { id: "W14c", rule: VT.conv, path: "panel", kind: "pos", unit: "Nos", model: { item: "Concealed Split", capacity: "670 CFM" }, re: ["capacity is stated only as an airflow (670 CFM) - an airflow is not converted to HP / TR - price this row by hand"], priced: false },
    { id: "W14d", rule: VT.conv, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", capacity: "22.5 TR / 18 HP" }, re: ["capacity:the row states 18 HP and 22.5 TR - 18 HP is used (Outdoor Unit is stocked in HP); 22.5 TR is not read"], priced: true },
    { id: "W14a-calc", rule: VT.conv, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "16", capacity__unit: "TR" }, other: ["capacity"], re: ["capacity:16 TR x 1.25 (HP per TR, Pricing Inputs) = 20 HP"], priced: true, figures: [476040, 20000] },
    // VRF-2b K5 (owner 2026-11-04): an airflow-only text reads the capacity given in brackets; two refuse; none refuses as today
    { id: "W14f", rule: VT.conv, path: "panel", kind: "pos", unit: "Nos", model: { item: "Hi-Wall", brand: "Blue Star", capacity: "670Cfm Wall Mounted Type (2.0 TR)" }, re: ["capacity:670 CFM is an airflow - not read; (2.0 TR) in brackets is read -> 2 TR"], priced: true, figures: [23520, 1800] },
    { id: "W14f-calc", rule: VT.conv, path: "calc", kind: "pos", family: "Hi-Wall", attrs: { brand: "Blue Star", capacity: "670Cfm (2.0 TR)" }, other: ["capacity"], re: ["capacity:670 CFM is an airflow - not read; (2.0 TR) in brackets is read -> 2 TR"], priced: true, figures: [23520, 1800] },
    { id: "W14g-neg", rule: VT.conv, path: "panel", kind: "neg", unit: "Nos", model: { item: "Hi-Wall", brand: "Blue Star", capacity: "670 CFM (2.0 TR) (2.5 TR)" }, re: ["several values stated for capacity ('670 CFM (2.0 TR) (2.5 TR)')"], not: ["in brackets is read"], priced: false },
    { id: "W14h", rule: VT.conv, path: "panel", kind: "pos", unit: "Nos", model: { item: "Cassette", way: "ONE-WAY", capacity: "610Cfm Cassette Type (2.0TR) - 1-way" }, re: ["capacity:610 CFM is an airflow - not read; 1 outside the brackets is not read; (2.0TR) in brackets is read -> 2 TR"], priced: true },
    { id: "W14e-neg", rule: VT.conv, path: "panel", kind: "neg", unit: "Nos", model: OD16, re: [], not: ["Pricing Inputs", "airflow"], priced: true, figures: [436920, 16000] },
    // VRF-2b: the 2b paths of lines that stayed -- Nos/Ro's line (1), the Misc four (4), seventeen kinds (2)
    { id: "W1d", rule: VT.unit, path: "panel", kind: "pos", unit: "Nos/Ro", model: OD16, re: ["unit 'Nos/Ro' read as Nos"], priced: true, figures: [436920, 16000] },
    { id: "W4c", rule: VT.ruleForUnit, path: "panel", kind: "pos", unit: "Kg", model: { item: "Refrigerant Gas Filling (R-410)" }, re: ["family:Refrigerant Gas Filling (R-410)"], priced: true, figures: [1020, 350] },
    { id: "W4d", rule: VT.ruleForUnit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Drain Pump" }, re: ["family:Drain Pump"], priced: true, figures: [3500, 750] },
    { id: "W4e-calc", rule: VT.ruleForUnit, path: "calc", kind: "pos", family: "MS Angle Base Frame Structure", attrs: {}, rowUnit: "Kg", re: ["family:MS Angle Base Frame Structure"], priced: true, figures: [140, 40] },
    { id: "W2c", rule: VT.kind, path: "panel", kind: "pos", unit: "Nos", model: { item: "BACnet Integration Controller for VRF Units" }, re: ["family:BACnet Integration Controller for VRF Units"], priced: true, figures: [50000, 4500] },
    { id: "V12b-neg", rule: VT.a3Unstocked, path: "panel", kind: "neg", unit: "Nos", model: { item: "Verticool", brand: "Blue Star", capacity: "2" }, re: ["family:Verticool"], not: ["No SKU for Verticool"], priced: true },
  ];
  const vcells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
  function vrun(c: VCase, cfgs: Map<string, RateCategoryConfig> = c.path === "calc" ? live : projected) {
    const ext = new Map<number, ExtractionRow>();
    if (c.path === "panel") ext.set(1, { excelRow: 1, description: "", attributes: {}, items: [{ attributes: vcells(c.model ?? {}) }] } as unknown as ExtractionRow);
    const h = makePricingSheetHelper({ configsByCategory: cfgs, items: items57, extractionByRow: ext });
    const ctx: RateHelperRowContext & { unit?: string } = { excelRow: c.path === "calc" ? 0 : 1, description: "", nodeType: c.path === "calc" ? "" : "Line Item",
      category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: [], ownNotes: [] };
    if (c.path === "panel" && c.unit !== undefined) ctx.unit = c.unit;
    const overrides: Record<string, string> = {};
    if (c.path === "calc") {
      overrides[ITEM_LIST_OVERRIDE_KEY] = JSON.stringify({ items: [{ base: null, family: c.family ?? null, attrs: c.attrs ?? {}, other: c.other ?? [], ...(c.qty !== undefined ? { qty: c.qty } : {}) }] });
      overrides[ROW_UNIT_OVERRIDE_KEY] = c.rowUnit ?? "Nos";
    }
    return h.compute(ctx, overrides);
  }
  function vlines(r: ReturnType<typeof vrun>) {
    if (!isSuggestion(r)) return { priced: false, text: `declined:${(r as { reason?: string }).reason ?? ""}`, s: null };
    const s = r as ItemListSuggestion;
    const v = s.itemList!;
    const out: string[] = [];
    if (v.reason) out.push(v.reason);
    if (v.unitNote) out.push(v.unitNote);
    out.push(...(s.workings.derivation ?? []));
    for (const b of v.items) {
      if (b.family) out.push(`family:${b.family}`);
      if (b.reason) out.push(b.reason);
      if (b.skuLine) out.push(b.skuLine);
      if (b.familyLine) out.push(b.familyLine);
      out.push(...b.working);
      for (const f of b.fields) { if (f.note) out.push(`${f.id}:${f.note}`); if (f.rule) out.push(`${f.id}:${f.rule}`); }
    }
    return { priced: v.rowPriced, text: out.join("\n"), s };
  }
  const vmatch = (text: string, p: string | RegExp) => (typeof p === "string" ? text.includes(p) : p.test(text));
  const titles = () => itemListRuleOrder(live.get(VRF), items57).map((l) => l.title);

  it("THE VRF GUARD: the rules this block names EQUAL the rules v57's VRF config generates (14); each has a positive AND a negative case", () => {
    const generated = new Set(titles());
    expect(titles()).toHaveLength(14);
    const named = new Set(VCASES.map((c) => c.rule));
    expect({ uncovered: [...generated].filter((t) => !named.has(t)), dead: [...named].filter((t) => !generated.has(t)) }).toEqual({ uncovered: [], dead: [] });
    for (const t of generated) {
      const mine = VCASES.filter((c) => c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    expect(VCASES).toHaveLength(33 + 15 + 4);   // + K5's W14f / W14f-calc / W14g-neg / W14h (QR-K5a B)
    // the projected config generates the same tab (the key changes who may price, never which rules exist)
    expect(itemListRuleOrder(projected.get(VRF), items57).map((l) => l.title)).toEqual(titles());
  });

  it.each(VCASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const { priced, text, s } = vlines(vrun(c));
    for (const p of c.re) expect({ id: c.id, want: p, hit: vmatch(text, p), text }).toEqual({ id: c.id, want: p, hit: true, text });
    for (const p of c.not ?? []) expect({ id: c.id, forbidden: p, hit: vmatch(text, p) }).toEqual({ id: c.id, forbidden: p, hit: false });
    if (c.priced !== undefined) expect({ id: c.id, priced }).toEqual({ id: c.id, priced: c.priced });
    if (c.figures) expect([s!.values.supply_rate, s!.values.install_rate]).toEqual(c.figures);
    // INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; D-10) by mechanical authority: BEFORE `expect(vrun(c, live).kind).toBe("none")` (the live
    // frozen config, `calculator_only` on, declined on a BoQ row). The key is read by nothing now: the BoQ row prices exactly as the projection
    if (c.path === "panel") expect(JSON.stringify(vrun(c, live))).toBe(JSON.stringify(vrun(c)));
  });
});

describe("VRF-3a (v58) -- R-39: every VRF Derivation-tab rule fires from the panel's entry point; THE VRF GUARD", () => {
  const A58 = readJsonFixture<{ discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] }>(
    new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v58.json", import.meta.url),
  );
  const VRF = "hvac_vrf";
  const items58: RateMasterItem[] = A58.items.map((it) => ({ ...it, discipline: A58.discipline,
    attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const live = new Map<string, RateCategoryConfig>(A58.category_configs.map((c) => [c.category_id, c]));
  const projected = new Map<string, RateCategoryConfig>([...live].map(([k, c]) => {
    if (k !== VRF) return [k, c];
    const { calculator_only: _off, ...rest } = c as RateCategoryConfig & { calculator_only?: unknown };
    return [k, rest as RateCategoryConfig];
  }));
  const VT = {
    unit: T.unit, kind: T.kind, noSku: T.noSku, ruleForUnit: T.ruleForUnit, needs: T.needs, defaults: T.defaults,
    ctrl: "Daikin as the brand on Touch Screen Central Controller is priced as Blue Star",
    fit: "Fitting the stated capacity to the catalogue",
    brand: "Several brands, or one brand not on the sheet, are priced as Blue Star, naming the row's words",
    conv: "A capacity in TR, HP or kW that is not the item's own unit is converted first",
    steps: T.steps, qty: T.qty, a3Unit: T.a3Unit, a3Unstocked: T.a3Unstocked,
    // VRF-3a (U8): the six lines v58 adds
    stated: "A split the row writes is priced as one Outdoor Unit per module",
    cond: "A condition the row states about the split is quoted in an amber note",
    kept: "A split the pricer has changed is never split again",
    set: "A row priced per Set takes one Set as one piece (every kind but Refnet/Y-Joint)",
    refnet: "A Refnet/Y-Joint on a Set row holds the pieces the system's unit counts give",
    lot: "A row priced per Lot is not priced",
  };
  type VCase = { id: string; rule: string; path: "panel" | "calc"; kind: "pos" | "neg"; unit?: string; model?: Record<string, string>;
    family?: string; attrs?: Record<string, string>; other?: string[]; qty?: string; rowUnit?: string; rowQty?: number; desc?: string;
    blocks?: Array<Record<string, unknown>>; op?: "edit3" | "remove3" | "reset";
    re: Array<string | RegExp>; not?: Array<string | RegExp>; priced?: boolean; figures?: [number, number] };
  const OD16 = { item: "Outdoor Unit", capacity: "16" };
  const WHOLE = "Whole system (indoor + outdoor)";
  const VCASES: VCase[] = [
    // 1. the row's unit
    { id: "V1a", rule: VT.unit, path: "panel", kind: "pos", unit: "", model: OD16, re: ["No unit on the BoQ row -> priced per Nos, the catalogue's unit for this item"], priced: true, figures: [436920, 16000] },
    { id: "V1c-neg", rule: VT.unit, path: "panel", kind: "neg", unit: "Nos", model: OD16, re: ["family:Outdoor Unit"], not: ["No unit on the BoQ row", "rate only"], priced: true },
    { id: "W1d", rule: VT.unit, path: "panel", kind: "pos", unit: "Nos/Ro", model: OD16, re: ["unit 'Nos/Ro' read as Nos"], priced: true, figures: [436920, 16000] },
    { id: "X1e", rule: VT.unit, path: "panel", kind: "pos", unit: "Mtr", model: OD16, re: ["Outdoor Unit is not stocked per 'Mtr' (stocked per Nos) - price this row by hand"], priced: false },
    // 2. the item's own kind
    { id: "V2a", rule: VT.kind, path: "panel", kind: "pos", unit: "Nos", model: OD16, re: ["family:Outdoor Unit", "Top Discharge / (Nos)"], priced: true },
    { id: "V2b-neg", rule: VT.kind, path: "panel", kind: "neg", unit: "Nos", model: { item: "ABC", capacity: "16" }, re: ["no SKU in the catalogue for 'ABC' -- the user decides"], priced: false },
    // 3. "none of these"
    { id: "V3a", rule: VT.noSku, path: "panel", kind: "pos", unit: "Nos", model: { item: "none of these" }, re: ["no SKU in the catalogue for 'none of these' -- the user decides"], priced: false },
    { id: "V3b-neg", rule: VT.noSku, path: "panel", kind: "neg", unit: "Nos", model: { item: "Ductable", brand: "Blue Star", capacity: "8" }, re: ["family:Ductable"], not: ["the user decides"], priced: true, figures: [62280, 7500] },
    // 4. that kind's rule for that unit
    { id: "V4a", rule: VT.ruleForUnit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Verticool", brand: "Blue Star", capacity: "2" }, re: ["Verticool / (Nos)"], priced: true, figures: [41040, 3500] },
    { id: "X4b-neg", rule: VT.ruleForUnit, path: "panel", kind: "neg", unit: "Kg", model: OD16, re: ["Outdoor Unit is not stocked per Kg (stocked per Nos) - price this row by hand"], not: ["/ (Nos)"], priced: false },
    { id: "W4c", rule: VT.ruleForUnit, path: "panel", kind: "pos", unit: "Kg", model: { item: "Refrigerant Gas Filling (R-410)" }, re: ["family:Refrigerant Gas Filling (R-410)"], priced: true, figures: [1020, 350] },
    // 5. the facts the rule needs
    { id: "V5a", rule: VT.needs, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit" }, re: ["no capacity stated"], priced: false },
    { id: "V5b-neg", rule: VT.needs, path: "panel", kind: "neg", unit: "Nos", model: OD16, re: [], not: ["no capacity stated"], priced: true },
    // 6. defaults
    { id: "V6a", rule: VT.defaults, path: "panel", kind: "pos", unit: "Nos", model: OD16, priced: true, re: ["brand:no brand stated - priced as Blue Star"] },
    { id: "V6b-neg", rule: VT.defaults, path: "panel", kind: "neg", unit: "Nos", model: { item: "Outdoor Unit", brand: "Daikin", cooling: "Heat Pump", capacity: "8" }, priced: true, figures: [253743, 12800], re: [], not: ["brand:no brand stated", "cooling:cooling not stated"] },
    // 7. the controller map
    { id: "V7a", rule: VT.ctrl, path: "panel", kind: "pos", unit: "Nos", model: { item: "Touch Screen Central Controller", brand: "Daikin" }, priced: true, figures: [42000, 1500], re: ["brand:the central controller is Blue Star only on the sheet - a Daikin pick is priced as Blue Star (R-SMALL)"] },
    { id: "V7b-neg", rule: VT.ctrl, path: "panel", kind: "neg", unit: "Nos", model: { item: "Touch Screen Central Controller", brand: "Blue Star" }, priced: true, re: [], not: ["a Daikin pick is priced as Blue Star"] },
    // 8. fitting the stated capacity -- VRF-3a: above the largest the Outdoor Unit SPLITS (AC2); every other family refuses
    { id: "V8a", rule: VT.fit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", capacity: "15" }, re: ["capacity:BoQ says 15 -> priced as 16 (next size up)"], priced: true, figures: [436920, 16000] },
    { id: "X8s", rule: VT.fit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", capacity: "54" }, re: ["split:54 HP is bigger than the largest unit (28 HP), so the helper split it: 28 + 26 HP", "helper:From the helper's split of 54 HP -> 28 HP"], priced: true, figures: [1116360, 54000] },
    { id: "X8s-calc", rule: VT.fit, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "54" }, other: ["capacity"], re: ["split:54 HP is bigger than the largest unit (28 HP)"], priced: true, figures: [1116360, 54000] },
    { id: "X8t", rule: VT.fit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", capacity: "60" }, re: ["split:60 HP is bigger than the largest unit (28 HP), so the helper split it: 24 + 24 + 12 HP"], priced: true, figures: [1335600, 60000] },
    { id: "V8c", rule: VT.fit, path: "panel", kind: "pos", unit: "Nos", model: { item: "Ductable", brand: "Blue Star", capacity: "11" }, re: ["capacity 11 is above the largest size on the sheet (8)"], not: ["split:"], priced: false },
    { id: "V8d-neg", rule: VT.fit, path: "panel", kind: "neg", unit: "Nos", model: OD16, re: [], not: ["next size up", "above the largest", "split:"], priced: true },
    // 9. the priced steps
    { id: "V9a", rule: VT.steps, path: "panel", kind: "pos", unit: "Nos", model: OD16, priced: true, re: ["supply: ROUNDUP(supply, 0) (R-ROUND) = 436920", "install: ROUNDUP(install, 0) (R-ROUND) = 16000"] },
    { id: "X9b-neg", rule: VT.steps, path: "panel", kind: "neg", unit: "Nos", model: { item: "Ductable", brand: "Blue Star", capacity: "11" }, re: ["capacity 11 is above the largest size on the sheet (8)"], not: ["ROUNDUP(supply, 0)"], priced: false },
    // 10. the quantity
    { id: "V10a-calc", rule: VT.qty, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "16" }, qty: "2", re: ["x 2 per row unit"], priced: true, figures: [873840, 32000] },
    { id: "V10b-neg", rule: VT.qty, path: "calc", kind: "neg", family: "Outdoor Unit", attrs: { capacity: "16" }, re: [], not: ["per row unit"], priced: true, figures: [436920, 16000] },
    // 11. a kind not stocked in the row's unit
    { id: "V11b", rule: VT.a3Unit, path: "panel", kind: "pos", unit: "Kg", model: OD16, re: ["Outdoor Unit is not stocked per Kg (stocked per Nos) - price this row by hand"], priced: false },
    { id: "W11d", rule: VT.a3Unit, path: "panel", kind: "pos", unit: "Nos", model: { item: "MS Angle Base Frame Structure" }, re: ["MS Angle Base Frame Structure is not stocked per Nos (stocked per Kg) - price this row by hand"], priced: false },
    { id: "V11c-neg", rule: VT.a3Unit, path: "panel", kind: "neg", unit: "Nos/Ro", model: OD16, re: ["family:Outdoor Unit"], not: ["is not stocked per"], priced: true, figures: [436920, 16000] },
    // 12. an unstocked combination
    { id: "V12a", rule: VT.a3Unstocked, path: "panel", kind: "pos", unit: "Nos", model: { item: "Verticool", brand: "Daikin", capacity: "2" }, re: ["No SKU for Verticool: brand Daikin - price this row by hand"], priced: false },
    { id: "V12b-neg", rule: VT.a3Unstocked, path: "panel", kind: "neg", unit: "Nos", model: { item: "Verticool", brand: "Blue Star", capacity: "2" }, re: ["family:Verticool"], not: ["No SKU for Verticool"], priced: true },
    // 13. the brand note
    { id: "W13a", rule: VT.brand, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", brand: "Toshiba", capacity: "16" }, re: ["brand:brand Toshiba is not on the sheet - priced as Blue Star"], priced: true, figures: [436920, 16000] },
    { id: "W13c-neg", rule: VT.brand, path: "panel", kind: "neg", unit: "Nos", model: { item: "Outdoor Unit", brand: "Daikin", cooling: "Heat Pump", capacity: "8" }, re: [], not: ["is not on the sheet", "several brands stated"], priced: true, figures: [253743, 12800] },
    // 14. the conversion line -- VRF-3a R1: an airflow range is one airflow (board 10)
    { id: "W14a", rule: VT.conv, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", capacity: "16 TR" }, re: ["capacity:16 TR x 1.25 (HP per TR, Pricing Inputs) = 20 HP"], priced: true, figures: [476040, 20000] },
    { id: "X14r", rule: VT.conv, path: "panel", kind: "pos", unit: "Nos", model: { item: "Single Skin Treated Fresh Air", capacity: "1700-1800cfm" }, re: ["capacity is stated only as an airflow (1700-1800 CFM) - an airflow is not converted to HP / TR - price this row by hand"], not: ["1700 is above"], priced: false },
    { id: "X14r-calc", rule: VT.conv, path: "calc", kind: "pos", family: "Single Skin Treated Fresh Air", attrs: { capacity: "1700-1800cfm" }, other: ["capacity"], re: ["capacity is stated only as an airflow (1700-1800 CFM)"], priced: false },
    { id: "X14s", rule: VT.conv, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", capacity: "43.2 TR" }, re: ["split:43.2 TR x 1.25 (HP per TR, Pricing Inputs) = 54 HP. 54 HP is bigger than the largest unit (28 HP)"], priced: true, figures: [1116360, 54000] },
    { id: "W14e-neg", rule: VT.conv, path: "panel", kind: "neg", unit: "Nos", model: OD16, re: [], not: ["Pricing Inputs", "airflow"], priced: true, figures: [436920, 16000] },
    // VRF-3a: the stated split (R-SPLIT (a), D-2)
    { id: "X15a", rule: VT.stated, path: "panel", kind: "pos", unit: "Nos", model: { item: "Outdoor Unit", capacity: "60 HP (18+18+24)" }, re: ["split:The row states a split: 18 + 18 + 24 HP (total 60 HP) -> one line per module, each priced on its own."], priced: true, figures: [1415640, 60000] },
    { id: "X15a-calc", rule: VT.stated, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "26(14+12)HP" }, other: ["capacity"], re: ["split:You typed a split: 14 + 12 HP (total 26 HP)"], priced: true, figures: [717720, 26000] },
    { id: "X15b", rule: VT.stated, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "60 HP (30+30)" }, other: ["capacity"], re: ["Module 30 HP is above the largest size on the sheet (28 HP) - this row is not priced; price it by hand"], priced: false },
    { id: "X15c-neg", rule: VT.stated, path: "panel", kind: "neg", unit: "Nos", model: { item: "Outdoor Unit", capacity: "2# 12 HP" }, re: [], not: ["a split:"], priced: false },
    // VRF-3a D-3
    { id: "X16a", rule: VT.cond, path: "panel", kind: "pos", unit: "Nos", desc: "18 HP (Single module)", model: { item: "Outdoor Unit", discharge: "Side", capacity: "18 HP" }, re: ["condition:The row says \"Single module\""], priced: true },
    { id: "X16b-neg", rule: VT.cond, path: "panel", kind: "neg", unit: "Nos", model: { item: "Outdoor Unit", capacity: "54" }, re: [], not: ["condition:"], priced: true },
    // VRF-3a: the hidden tag (an edit never re-splits)
    { id: "X17a", rule: VT.kept, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "60" }, other: ["capacity"], op: "edit3", re: ["changed:You changed the helper's split.", "lines:The lines add up to 62 HP; the BoQ says 60 HP."], priced: true, figures: [1428360, 62000] },
    { id: "X17b", rule: VT.kept, path: "calc", kind: "pos", family: "Outdoor Unit", attrs: { capacity: "60" }, other: ["capacity"], op: "remove3", re: ["changed:You changed the helper's split."], priced: true, figures: [1023120, 48000] },
    { id: "X17c-neg", rule: VT.kept, path: "calc", kind: "neg", family: "Outdoor Unit", attrs: { capacity: "60" }, other: ["capacity"], op: "reset", re: ["split:60 HP is bigger than the largest unit"], not: ["changed:"], priced: true, figures: [1335600, 60000] },
    // VRF-3a: Set = 1 piece (owner 17:00)
    { id: "X18a", rule: VT.set, path: "panel", kind: "pos", unit: "Set", model: { item: "Touch Screen Central Controller" }, re: ["bar:PRICED PER SET - CHECK WHAT ONE SET HOLDS."], priced: true, figures: [42000, 1500] },
    { id: "X18a-calc", rule: VT.set, path: "calc", kind: "pos", family: "Touch Screen Central Controller", attrs: {}, qty: "2", rowUnit: "Set", re: ["bar:PRICED PER SET"], priced: true, figures: [84000, 3000] },
    { id: "X18b-neg", rule: VT.set, path: "panel", kind: "neg", unit: "Nos", model: { item: "Touch Screen Central Controller" }, re: [], not: ["bar:"], priced: true, figures: [42000, 1500] },
    // VRF-3a: the refnet count (owner 17:00 / 17:37 / 17:39 / 18:49)
    { id: "X19a", rule: VT.refnet, path: "panel", kind: "pos", unit: "Set", rowQty: 2, model: { item: "Refnet/Y-Joint", set_covers: WHOLE, set_odu: "3", set_idu: "24" }, re: ["setcount:ROUNDED UP to 13 pieces in one Set. 2 Sets x 13 = 26 pieces, 1 more than the 25 expected - check."], priced: true, figures: [54600, 10400] },
    { id: "X19a-calc", rule: VT.refnet, path: "calc", kind: "pos", family: "Refnet/Y-Joint", attrs: { set_covers: WHOLE, set_odu: "3", set_idu: "24" }, rowUnit: "Set", rowQty: 1, re: ["setcount:The BoQ quantity (1) is below the 25 refnets expected: 25 pieces in one Set (1 Sets x 25 = 25)."], priced: true, figures: [105000, 20000] },
    { id: "X19b", rule: VT.refnet, path: "calc", kind: "pos", family: "Refnet/Y-Joint", attrs: { set_covers: WHOLE, set_odu: "3", set_idu: "24" }, rowUnit: "Set", rowQty: 20, re: ["The BoQ quantity (20) does not fit the 25 refnets expected - not priced: type the pieces in one Set."], priced: false },
    { id: "X19c-neg", rule: VT.refnet, path: "panel", kind: "neg", unit: "Nos", rowQty: 2, model: { item: "Refnet/Y-Joint", set_covers: WHOLE, set_odu: "3", set_idu: "24" }, re: [], not: ["setcount:"], priced: true, figures: [4200, 800] },
    // VRF-3a: Lot (owner "Refuse + review list")
    { id: "X20a", rule: VT.lot, path: "panel", kind: "pos", unit: "Lot", model: OD16, re: ["Unit \"Lot\" is not a VRF unit: VRF is priced per Nos, per Set or per Kg. What a Lot holds is read at VRF-4. Price this row by hand.", "bar:PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND."], priced: false },
    { id: "X20b", rule: VT.lot, path: "panel", kind: "pos", unit: "per HP", model: OD16, re: ["Unit \"per HP\" is not a VRF unit"], priced: false },
    { id: "X20c-neg", rule: VT.lot, path: "panel", kind: "neg", unit: "Nos", model: OD16, re: [], not: ["is not a VRF unit", "bar:"], priced: true },
  ];
  const vcells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
  function vrun(c: VCase, cfgs: Map<string, RateCategoryConfig> = c.path === "calc" ? live : projected) {
    const ext = new Map<number, ExtractionRow>();
    // the refnet's three fields are typed per item on the panel too (VRF-4 asks the model): they ride the panel's edit state
    const setKeys = ["set_covers", "set_odu", "set_idu"];
    const model = Object.fromEntries(Object.entries(c.model ?? {}).filter(([k]) => !setKeys.includes(k)));
    const typedSet = Object.fromEntries(Object.entries(c.model ?? {}).filter(([k]) => setKeys.includes(k)));
    if (c.path === "panel") ext.set(1, { excelRow: 1, description: c.desc ?? "", attributes: {}, items: [{ attributes: vcells(model) }] } as unknown as ExtractionRow);
    const h = makePricingSheetHelper({ configsByCategory: cfgs, items: items58, extractionByRow: ext });
    const ctx: RateHelperRowContext & { unit?: string; quantity?: number } = { excelRow: c.path === "calc" ? 0 : 1, description: c.desc ?? "", nodeType: c.path === "calc" ? "" : "Line Item",
      category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: [], ownNotes: [] };
    if (c.path === "panel" && c.unit !== undefined) ctx.unit = c.unit;
    if (c.path === "panel" && c.rowQty !== undefined) ctx.quantity = c.rowQty;
    const overrides: Record<string, string> = {};
    if (c.path === "panel" && Object.keys(typedSet).length) overrides[ITEM_LIST_OVERRIDE_KEY] = JSON.stringify({ items: [{ base: 0, family: null, attrs: typedSet }] });
    if (c.path === "calc") {
      overrides[ITEM_LIST_OVERRIDE_KEY] = JSON.stringify({ items: [{ base: null, family: c.family ?? null, attrs: c.attrs ?? {}, other: c.other ?? [], ...(c.qty !== undefined ? { qty: c.qty } : {}) }] });
      overrides[ROW_UNIT_OVERRIDE_KEY] = c.rowUnit ?? "Nos";
      if (c.rowQty !== undefined) overrides[ROW_QTY_OVERRIDE_KEY] = String(c.rowQty);
    }
    let r = h.compute(ctx, overrides);
    if (c.op && isSuggestion(r)) {
      const v = (r as ItemListSuggestion).itemList!;
      const op: ItemEditOp = c.op === "edit3" ? { op: "set_attr", index: 2, id: "capacity", value: "14" } : c.op === "remove3" ? { op: "remove", index: 2 } : { op: "reset_split" };
      let st = applyItemEdit(v.editState, c.op === "reset" ? { op: "remove", index: 2 } : op);
      if (c.op === "reset") st = applyItemEdit(st, op);
      r = h.compute(ctx, { ...overrides, [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(st) });
    }
    return r;
  }
  function vlines(r: ReturnType<typeof vrun>) {
    if (!isSuggestion(r)) return { priced: false, text: `declined:${(r as { reason?: string }).reason ?? ""}`, s: null };
    const s = r as ItemListSuggestion;
    const v = s.itemList!;
    const out: string[] = [];
    if (v.reason) out.push(v.reason);
    if (v.unitNote) out.push(v.unitNote);
    if (v.split) {
      out.push(`split:${v.split.note}`);
      if (v.split.condition) out.push(`condition:${v.split.condition}`);
      if (v.split.sumNote) out.push(`sum:${v.split.sumNote}`);
      if (v.split.changed) out.push(`changed:${v.split.changed}`);
      if (v.split.linesNote) out.push(`lines:${v.split.linesNote}`);
    }
    if (v.unitBar) out.push(`bar:${v.unitBar.title}`, ...v.unitBar.lines.map((l) => `bar:${l}`));
    out.push(...(s.workings.derivation ?? []));
    for (const b of v.items) {
      if (b.family) out.push(`family:${b.family}`);
      if (b.reason) out.push(b.reason);
      if (b.skuLine) out.push(b.skuLine);
      if (b.familyLine) out.push(b.familyLine);
      if (b.helperLine) out.push(`helper:${b.helperLine}`);
      if (b.setCount) out.push(`setcount:${b.setCount.sentence}`);
      out.push(...b.working);
      for (const f of b.fields) { if (f.note) out.push(`${f.id}:${f.note}`); if (f.rule) out.push(`${f.id}:${f.rule}`); }
    }
    return { priced: v.rowPriced, text: out.join("\n"), s };
  }
  const vmatch = (text: string, p: string | RegExp) => (typeof p === "string" ? text.includes(p) : p.test(text));
  const titles = () => itemListRuleOrder(live.get(VRF), items58).map((l) => l.title);

  it("THE VRF GUARD: the rules this block names EQUAL the rules v58's VRF config generates (20); each has a positive AND a negative case", () => {
    const generated = new Set(titles());
    expect(titles()).toHaveLength(20);
    const named = new Set(VCASES.map((c) => c.rule));
    expect({ uncovered: [...generated].filter((t) => !named.has(t)), dead: [...named].filter((t) => !generated.has(t)) }).toEqual({ uncovered: [], dead: [] });
    for (const t of generated) {
      const mine = VCASES.filter((c) => c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    expect(VCASES).toHaveLength(58);   // VRF-2b's cases carried onto v58 (the Set / Lot / above-largest ones re-pointed) + the VRF-3a cases X*
    expect(itemListRuleOrder(projected.get(VRF), items58).map((l) => l.title)).toEqual(titles());
  });

  it.each(VCASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const { priced, text, s } = vlines(vrun(c));
    for (const p of c.re) expect({ id: c.id, want: p, hit: vmatch(text, p), text }).toEqual({ id: c.id, want: p, hit: true, text });
    for (const p of c.not ?? []) expect({ id: c.id, forbidden: p, hit: vmatch(text, p) }).toEqual({ id: c.id, forbidden: p, hit: false });
    if (c.priced !== undefined) expect({ id: c.id, priced }).toEqual({ id: c.id, priced: c.priced });
    if (c.figures) expect([s!.values.supply_rate, s!.values.install_rate]).toEqual(c.figures);
    // INVERTED at VRF-4 (owner Q1 A "removed at VRF-4"; D-10) by mechanical authority: BEFORE `expect(vrun(c, live).kind).toBe("none")` (the live
    // frozen config, `calculator_only` on, declined on a BoQ row). The key is read by nothing now: the BoQ row prices exactly as the projection
    if (c.path === "panel") expect(JSON.stringify(vrun(c, live))).toBe(JSON.stringify(vrun(c)));
  });
});


describe("VRF-3b (v59) -- R-39: every VRF Derivation-tab rule v59 adds fires from the calculator's entry point; THE VRF GUARD", () => {
  type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
  const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
  const A59 = rd("rate_master_hvac_all_v59.json");
  const A58 = rd("rate_master_hvac_all_v58.json");
  const E72 = rd("rate_master_electrical_all_v72.json");
  const VRF = "hvac_vrf";
  const asItems = (a: A) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const items59 = [...asItems(A59), ...asItems(E72)];
  const cfgs = new Map<string, RateCategoryConfig>([...A59.category_configs, ...E72.category_configs].map((c) => [c.category_id, c]));
  const XT = {
    carry: "A unit's price can include its copper, insulation, power cable and communication cable, each as its own line",
    band: "An extra's size comes from the Pricing Inputs table by the unit's size, after conversion",
    rate: "Each extra is priced per metre by its own sheet's rules, then per Nos of the row",
    blank: "An extra with no size, spec or length holds the row",
    removed: "A removed extra stays removed",
  };
  type XCase = { id: string; rule: string; kind: "pos" | "neg"; family: string; cap: string; inc: string; extras?: Record<string, unknown>; drop?: string;
    re: Array<string | RegExp>; not?: Array<string | RegExp>; priced?: boolean; figures?: [number, number] };
  const XCASES: XCase[] = [
    { id: "E1a", rule: XT.carry, kind: "pos", family: "Outdoor Unit", cap: "10", inc: "copper,insulation,power,comm", re: ["line:copper_supply", "line:copper_return", "line:ins_supply", "line:ins_return", "line:power", "line:comm", "Item 7 · extra the BoQ includes · from Electrical"], priced: true, figures: [441210, 25960] },
    { id: "E1b-neg", rule: XT.carry, kind: "neg", family: "Remote Controller", cap: "", inc: "copper,insulation,power,comm", re: [], not: ["line:"] },
    { id: "E1c-neg", rule: XT.carry, kind: "neg", family: "Outdoor Unit", cap: "10", inc: "", re: [], not: ["line:"], priced: true, figures: [301560, 10000] },
    { id: "E2a", rule: XT.band, kind: "pos", family: "Outdoor Unit", cap: "14", inc: "copper,power", re: ["Copper pipe - supply line 28.6 mm", "Power cable 4C x 10"], priced: true },
    { id: "E2b", rule: XT.band, kind: "pos", family: "Outdoor Unit", cap: "8 TR", inc: "copper", re: ["Copper pipe - supply line 22.2 mm"], priced: true },
    { id: "E2c-neg", rule: XT.band, kind: "neg", family: "Outdoor Unit", cap: "12", inc: "copper", re: ["Copper pipe - supply line 22.2 mm"], not: ["28.6 mm"], priced: true },
    { id: "E3a", rule: XT.rate, kind: "pos", family: "Hi-Wall", cap: "1.5", inc: "copper", re: ["per metre by Piping's rules, supply 936 + install 220", "Per Nos: 30 m x 936 = 28080 supply; 30 m x 220 = 6600 install (rounded up)"], priced: true },
    { id: "E3b-neg", rule: XT.rate, kind: "neg", family: "Hi-Wall", cap: "1.5", inc: "comm", re: ["per metre by Electrical's rules, supply 80 + install 24"], not: ["Piping's rules"], priced: true },
    { id: "E4a", rule: XT.blank, kind: "pos", family: "Packaged Unit", cap: "10", inc: "power", re: ["No default for this size (10 TR) - pick a cable spec."], priced: false },
    // INVERTED at VRF-4 K2 (owner BORROWED 2026-11-05 22:18 "option a": a borrowed field is priced by its SOURCE's own rules) by mechanical authority: BEFORE re: ["3C x 400 copper unarmoured cable is not stocked - pick a spec."] (VRF's stocked pre-check, deleted)
    { id: "E4b", rule: XT.blank, kind: "pos", family: "Outdoor Unit", cap: "10", inc: "power", extras: { set: { power: { spec: "3C x 400" } } }, re: ["no match for these attributes"], not: ["is not stocked - pick a spec"], priced: false },
    { id: "E4c-neg", rule: XT.blank, kind: "neg", family: "Outdoor Unit", cap: "10", inc: "power", re: [], not: ["pick a spec", "Size needed"], priced: true },
    { id: "E5a", rule: XT.removed, kind: "pos", family: "Outdoor Unit", cap: "10", inc: "copper,insulation", extras: { removed: ["copper_supply"] }, re: ["removed:copper_supply", "removednote:The helper will not add removed extras back on its own. The row prices without them."], not: ["line:copper_supply", "line:ins_supply"], priced: true },
    { id: "E5b-neg", rule: XT.removed, kind: "neg", family: "Outdoor Unit", cap: "10", inc: "copper,insulation", re: ["line:copper_supply", "line:ins_supply"], not: ["removed:"], priced: true },
  ];
  function xrun(c: XCase) {
    const h = makePricingSheetHelper({ configsByCategory: cfgs, items: items59, extractionByRow: new Map() });
    const ctx = { excelRow: 0, description: "", nodeType: "", category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"], headings: [], ownNotes: [] } as RateHelperRowContext;
    const attrs: Record<string, string> = { brand: "Blue Star", ...(c.cap ? { capacity: c.cap } : {}), ...(c.family === "Remote Controller" ? { remote_type: "Wired" } : {}) };
    const r = h.compute(ctx, {
      [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family: c.family, attrs, other: c.cap ? ["capacity"] : [], ...(c.extras ? { extras: c.extras } : {}) }] }),
      [ROW_UNIT_OVERRIDE_KEY]: "Nos", [EXTRAS_INCLUDES_KEY]: c.inc,
    });
    const s = r as ItemListSuggestion;
    const v = s.itemList!;
    const out: string[] = [];
    if (v.reason) out.push(v.reason);
    for (const b of v.items) {
      for (const l of b.extras?.lines ?? []) { out.push(`line:${l.id}`, l.heading, ...l.working); if (l.reason) out.push(l.reason); }
      for (const x of b.extras?.removed ?? []) out.push(`removed:${x.id}`);
      if (b.extras?.removedNote) out.push(`removednote:${b.extras.removedNote}`);
    }
    return { priced: v.rowPriced, text: out.join("\n"), s };
  }
  const xmatch = (text: string, p: string | RegExp) => (typeof p === "string" ? text.includes(p) : p.test(text));
  const titles = (a: A) => itemListRuleOrder(a.category_configs.find((c) => c.category_id === VRF), asItems(a)).map((l) => l.title);

  it("THE VRF GUARD: v59's VRF rules = v58's 20 (the v58 block covers them, the same code) + the 5 extras lines this block names; each has a positive AND a negative case", () => {
    const t59 = titles(A59);
    expect(t59).toHaveLength(25);
    expect(t59.slice(0, 20)).toEqual(titles(A58));
    expect(t59.slice(20)).toEqual(Object.values(XT));
    for (const t of Object.values(XT)) {
      const mine = XCASES.filter((c) => c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    expect(XCASES).toHaveLength(13);
  });

  it.each(XCASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const { priced, text, s } = xrun(c);
    for (const p of c.re) expect({ id: c.id, want: p, hit: xmatch(text, p), text }).toEqual({ id: c.id, want: p, hit: true, text });
    for (const p of c.not ?? []) expect({ id: c.id, forbidden: p, hit: xmatch(text, p) }).toEqual({ id: c.id, forbidden: p, hit: false });
    if (c.priced !== undefined) expect({ id: c.id, priced }).toEqual({ id: c.id, priced: c.priced });
    if (c.figures) expect([s.values.supply_rate, s.values.install_rate]).toEqual(c.figures);
  });
});

/*
 * VRF-4 (owner 2026-11-06 q1 / q2; R-WS / D-5 "option D" / D-9; D-10) -- R-39 ON v60: the one line v60 adds (working + standby) and
 * the lines whose detail v60 changes (the includes read per item, the refnet count from the sheet, what a Lot holds) each fire
 * from the PANEL's entry point on a BoQ row the model read, positive AND negative. THE VRF GUARD: v60's titles = v59's 25 + 1.
 */
describe("VRF-4 (v60) -- R-39: every VRF Derivation-tab rule v60 adds or changes fires from the panel's entry point; THE VRF GUARD", () => {
  type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
  const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
  const A60 = rd("rate_master_hvac_all_v60.json");
  const A59 = rd("rate_master_hvac_all_v59.json");
  const E72 = rd("rate_master_electrical_all_v72.json");
  const VRF = "hvac_vrf";
  const asItems = (a: A) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const items60 = [...asItems(A60), ...asItems(E72)];
  const cfgs = new Map<string, RateCategoryConfig>([...A60.category_configs, ...E72.category_configs].map((c) => [c.category_id, c]));
  const titles = (a: A) => itemListRuleOrder(a.category_configs.find((c) => c.category_id === VRF), asItems(a)).map((l) => l.title);
  const VT = {
    ws: "A row the BoQ says is working + standby is priced as ONE unit, under a red bar",
    carry: "A unit's price can include its copper, insulation, power cable and communication cable, each as its own line",
    counted: "A Refnet/Y-Joint on a Set row holds the pieces the system's unit counts give",
    lot: "A row priced per Lot is not priced",
  };
  type Row = { items: Array<Record<string, string>>; unit?: string; qty?: number };
  type VCase = { id: string; rule: string; kind: "pos" | "neg"; rows: Record<number, Row>; at: number; re: Array<string | RegExp>; not?: Array<string | RegExp>; priced?: boolean };
  const WHOLE = "Whole system (indoor + outdoor)";
  const OD = (more: Record<string, string> = {}) => ({ item: "Outdoor Unit", brand: "Blue Star", capacity: "12 HP", ...more });
  const VCASES: VCase[] = [
    { id: "F1a", rule: VT.ws, kind: "pos", rows: { 36: { items: [OD({ working_standby_as_written: "2# (WORKING + STANDBY)" })], qty: 2 } }, at: 36,
      re: ["standby:WORKING + STANDBY - THIS RATE IS FOR 1 UNIT ONLY.", "check that the quantity covers both", "ring:Unit Nos · Qty 2"], priced: true },
    { id: "F1b-neg", rule: VT.ws, kind: "neg", rows: { 28: { items: [OD({ working_standby_as_written: "(Standby)" })] } }, at: 28, re: [], not: ["standby:"], priced: true },
    { id: "F2a", rule: VT.carry, kind: "pos", rows: { 9: { items: [OD({ includes_copper: "Yes", includes_power: "Yes" })] } }, at: 9,
      re: ["line:copper_supply", "line:power", "boqnote:The BoQ says this unit's price includes copper piping, power cable (read by the model)."], not: ["line:comm"], priced: true },
    { id: "F2b-neg", rule: VT.carry, kind: "neg", rows: { 9: { items: [OD({ includes_copper: "None", includes_power: "No" })] } }, at: 9, re: [], not: ["line:", "boqnote:"], priced: true },
    { id: "F3a", rule: VT.counted, kind: "pos", at: 115, rows: {
      14: { items: [OD({ capacity: "20 HP" })], qty: 2 }, 20: { items: [{ item: "Hi-Wall", brand: "Blue Star", capacity: "1 TR" }], qty: 10 },
      115: { items: [{ item: "Refnet/Y-Joint", brand: "Blue Star", set_covers: WHOLE }], unit: "Set", qty: 10 } },
      re: ["count:set_odu=2", "count:set_idu=10", "Counted from this sheet: 2 outdoor units (row 14 x 2)"], priced: true },
    { id: "F3b-neg", rule: VT.counted, kind: "neg", at: 115, rows: { 115: { items: [{ item: "Refnet/Y-Joint", brand: "Blue Star", set_covers: WHOLE }], unit: "Set", qty: 10 } },
      re: ["No outdoor unit was read on this sheet - type the count."], not: ["Counted from this sheet"], priced: false },
    { id: "F4a", rule: VT.lot, kind: "pos", rows: { 138: { items: [OD()], unit: "Lot" } }, at: 138, re: ["bar:PRICED PER LOT - NOT PRICED. PRICE THIS ROW BY HAND."], priced: false },
    { id: "F4b-neg", rule: VT.lot, kind: "neg", rows: { 138: { items: [OD()], unit: "Nos" } }, at: 138, re: [], not: ["bar:PRICED PER LOT"], priced: true },
  ];
  function vrun(c: VCase) {
    const ext = new Map<number, ExtractionRow>();
    for (const [er, r] of Object.entries(c.rows)) {
      ext.set(Number(er), { excelRow: Number(er), description: "", attributes: {}, category: VRF,
        items: r.items.map((a) => ({ attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) })) } as unknown as ExtractionRow);
    }
    const rowQuantities = Object.fromEntries(Object.entries(c.rows).map(([er, r]) => [Number(er), r.qty ?? 1]));
    const h = makePricingSheetHelper({ configsByCategory: cfgs, items: items60, extractionByRow: ext });
    const r = c.rows[c.at];
    const res = h.compute({ excelRow: c.at, description: "", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"],
      headings: [], ownNotes: [], unit: r.unit ?? "Nos", quantity: r.qty ?? 1, rowQuantities } as RateHelperRowContext);
    const v = (res as ItemListSuggestion).itemList!;
    const out: string[] = [];
    if (v.reason) out.push(v.reason);
    if (v.standbyBar) out.push(`standby:${v.standbyBar.title}`, ...v.standbyBar.lines, `ring:${v.standbyBar.ring}`);
    if (v.unitBar) out.push(`bar:${v.unitBar.title}`, ...v.unitBar.lines);
    for (const b of v.items) {
      for (const l of b.extras?.lines ?? []) out.push(`line:${l.id}`);
      if (b.extras?.boqNote) out.push(`boqnote:${b.extras.boqNote}`);
      for (const f of b.setCount?.fields ?? []) { out.push(`count:${f.id}=${f.value}`); if (f.note) out.push(f.note); }
    }
    return { priced: v.rowPriced, text: out.join("\n") };
  }
  const vmatch = (text: string, p: string | RegExp) => (typeof p === "string" ? text.includes(p) : p.test(text));

  it("THE VRF GUARD: v60's VRF rules = v59's 25 (the v59 block and the v58 / v57 / v56 blocks cover them) + the working + standby line; each line this block names has a positive AND a negative case", () => {
    const t60 = titles(A60);
    expect(t60).toHaveLength(26);
    expect(t60.slice(0, 25)).toEqual(titles(A59));
    expect(t60[25]).toBe(VT.ws);
    for (const t of Object.values(VT)) {
      expect(t60).toContain(t);
      const mine = VCASES.filter((c) => c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    expect(VCASES).toHaveLength(8);
  });

  it.each(VCASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const { priced, text } = vrun(c);
    for (const p of c.re) expect({ id: c.id, want: p, hit: vmatch(text, p), text }).toEqual({ id: c.id, want: p, hit: true, text });
    for (const p of c.not ?? []) expect({ id: c.id, forbidden: p, hit: vmatch(text, p) }).toEqual({ id: c.id, forbidden: p, hit: false });
    if (c.priced !== undefined) expect({ id: c.id, priced }).toEqual({ id: c.id, priced: c.priced });
  });
});

/*
 * VRF-5 (owner R1 18:14-18:21 + SAFEGUARD; F2; R2; R5; R4-R8; ANSWER 4-6, 9) -- R-39 ON v61: the seven lines v61 adds each fire from the
 * PANEL's entry point on a BoQ row the model read, positive AND negative. THE VRF GUARD: v61's titles = v60's 26 + 7.
 */
describe("VRF-5 (v61) -- R-39: every VRF Derivation-tab rule v61 adds fires from the panel's entry point; THE VRF GUARD", () => {
  type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
  const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
  const A61 = rd("rate_master_hvac_all_v61.json");
  const A60 = rd("rate_master_hvac_all_v60.json");
  const E72 = rd("rate_master_electrical_all_v72.json");
  const VRF = "hvac_vrf";
  const asItems = (a: A) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const items61 = [...asItems(A61), ...asItems(E72)];
  const cfgs = new Map<string, RateCategoryConfig>([...A61.category_configs, ...E72.category_configs].map((c) => [c.category_id, c]));
  const titles = (a: A) => itemListRuleOrder(a.category_configs.find((c) => c.category_id === VRF), asItems(a)).map((l) => l.title);
  const VT = {
    acc: "A unit's price can include its accessories, each as its own line",
    folded: "Any other item listed with a unit is a note, not a line",
    guard: "Where the BoQ states an inclusion decides whether it is added",
    words: "A cable the BoQ names without a size takes the default size",
    side: "Discharge not stated, below the smallest Top unit -> Side",
    makes: "Several makes stated -> Blue Star if it is one, else the first stocked make",
    scope: "Supply only / installation only, from the BoQ",
  };
  type Row = { items?: Array<Record<string, string>>; unit?: string; qty?: number; text?: string; category?: string };
  type VCase = { id: string; rule: string; kind: "pos" | "neg"; rows: Record<number, Row>; at: number; re: Array<string | RegExp>; not?: Array<string | RegExp>; priced?: boolean };
  const OD = (more: Record<string, string> = {}) => ({ item: "Outdoor Unit", brand: "Blue Star", capacity: "10 HP", ...more });
  const CAS = (more: Record<string, string> = {}) => ({ item: "Cassette", brand: "Blue Star", capacity: "2 TR", ...more });
  const VCASES: VCase[] = [
    { id: "G1a", rule: VT.acc, kind: "pos", rows: { 9: { items: [OD({ includes_frame: "Yes", includes_frame_where: "Row", includes_gas: "Yes", includes_gas_where: "Row" })] } }, at: 9,
      re: ["line:acc_frame", "line:acc_gas"], priced: true },
    { id: "G1b-neg", rule: VT.acc, kind: "neg", rows: { 9: { items: [OD({ includes_frame: "No", includes_gas: "None" })] } }, at: 9, re: [], not: ["line:acc_"], priced: true },
    { id: "G2a", rule: VT.folded, kind: "pos", rows: { 12: { items: [OD(), { item: "none of these" }] } }, at: 12,
      re: ["notes:An item the catalogue does not identify (not identified in the catalogue)"], priced: true },
    { id: "G2b-neg", rule: VT.folded, kind: "neg", rows: { 12: { items: [{ item: "Remote Controller" }, { item: "none of these" }] } }, at: 12, re: [], not: ["notes:"], priced: false },
    { id: "G3a", rule: VT.guard, kind: "pos", rows: { 24: { items: [CAS({ includes_refnet: "Yes", includes_refnet_where: "Heading" })] }, 134: { items: [{ item: "Refnet/Y-Joint" }], text: "Refnet joints" } }, at: 24,
      re: ["review:This row may include extras - please review", "NOT added: the BoQ quotes it on its own row (row 134)"], not: ["line:acc_refnet"], priced: true },
    { id: "G3b-neg", rule: VT.guard, kind: "neg", rows: { 24: { items: [CAS({ includes_refnet: "Yes", includes_refnet_where: "Row" })] }, 134: { items: [{ item: "Refnet/Y-Joint" }], text: "Refnet joints" } }, at: 24,
      re: ["line:acc_refnet"], not: ["review:"], priced: true },
    { id: "G4a", rule: VT.words, kind: "pos", rows: { 233: { items: [OD({ capacity: "18 HP", includes_power: "Yes", includes_power_where: "Row", extra_cable_spec_as_written: "multicore copper cables about 5-10 Rmt" })] } }, at: 233,
      re: ["line:power", "spec:BoQ says \"multicore copper cables about 5-10 Rmt\" - no size stated"], not: ["Size needed"], priced: true },
    { id: "G4b-neg", rule: VT.words, kind: "neg", rows: { 9: { items: [OD({ includes_power: "Yes", includes_power_where: "Row", extra_cable_spec_as_written: "4C x 10 sqmm" })] } }, at: 9,
      re: ["line:power"], not: ["spec:BoQ says"], priced: true },
    { id: "G5a", rule: VT.side, kind: "pos", rows: { 12: { items: [OD({ capacity: "6 HP" })] } }, at: 12, re: ["discharge:Side", /the smallest Top unit is 7 HP/], priced: true },
    { id: "G5b-neg", rule: VT.side, kind: "neg", rows: { 12: { items: [OD({ capacity: "6 HP", discharge: "Top" })] } }, at: 12, re: ["discharge:Top"], not: [/smallest Top unit/], priced: true },
    { id: "G6a", rule: VT.makes, kind: "pos", rows: { 9: { items: [OD({ brand: "None", brand_as_written: "Toshiba / Daikin" })] } }, at: 9, re: ["brand:Daikin", "the first stated make the catalogue stocks"], priced: true },
    { id: "G6b-neg", rule: VT.makes, kind: "neg", rows: { 9: { items: [OD({ brand: "None", brand_as_written: "Daikin" })] } }, at: 9, re: [], not: [/several brands|none of the stated makes/], priced: true },
    { id: "G7a", rule: VT.scope, kind: "pos", rows: { 147: { items: [CAS({ scope: "Supply only" })] } }, at: 147, re: ["scope:BoQ says supply only - no installation", "install:0"], priced: true },
    { id: "G7b-neg", rule: VT.scope, kind: "neg", rows: { 147: { items: [CAS({ scope: "Supply + installation" })] } }, at: 147, re: [], not: ["scope:", "install:0"], priced: true },
  ];
  function vrun(c: VCase) {
    const results = Object.entries(c.rows).filter(([, r]) => r.items).map(([er, r]) => ({ excel_row: Number(er), description: r.text ?? "", category_id: r.category ?? VRF, attributes: {},
      items: r.items!.map((a) => ({ attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) })) }));
    const rowQuantities = Object.fromEntries(Object.entries(c.rows).map(([er, r]) => [Number(er), r.qty ?? 1]));
    const sheetLines = Object.entries(c.rows).map(([er, r]) => ({ row: Number(er), text: r.text ?? "" }));
    const h = makePricingSheetHelper({ configsByCategory: cfgs, items: items61, extractionByRow: buildExtractionByRow(results as never) });
    const r = c.rows[c.at];
    const res = h.compute({ excelRow: c.at, description: r.text ?? "", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"],
      headings: [], ownNotes: [], unit: r.unit ?? "Nos", quantity: r.qty ?? 1, rowQuantities, sheetLines } as RateHelperRowContext);
    const v = (res as ItemListSuggestion).itemList!;
    const out: string[] = [];
    if (v.reason) out.push(v.reason);
    if (v.scope?.note) out.push(`scope:${v.scope.note}`);
    if (typeof v.totals?.install_rate === "number") out.push(`install:${v.totals.install_rate}`);
    for (const b of v.items) {
      for (const f of b.fields) { if (f.id === "discharge" || f.id === "brand") out.push(`${f.id}:${f.value}`); if (f.rule) out.push(f.rule); }
      for (const l of b.extras?.lines ?? []) { out.push(`line:${l.id}`); for (const f of l.fields) if (f.id === "spec" && f.note) out.push(`spec:${f.note}`); if (l.reason) out.push(l.reason); }
      if (b.extras?.review) out.push(`review:${b.extras.review.title}`, ...b.extras.review.points);
      if (b.extras?.notes) out.push(...b.extras.notes.points.map((p) => `notes:${p}`));
    }
    return { priced: v.rowPriced, text: out.join("\n") };
  }
  const vmatch = (text: string, p: string | RegExp) => (typeof p === "string" ? text.includes(p) : p.test(text));

  it("THE VRF GUARD: v61's VRF rules = v60's 26 + the seven VRF-5 lines; each line this block names has a positive AND a negative case", () => {
    const t61 = titles(A61);
    expect(t61).toHaveLength(33);
    expect(t61.slice(0, 26)).toEqual(titles(A60));
    expect(t61.slice(26)).toEqual([VT.acc, VT.folded, VT.guard, VT.words, VT.side, VT.makes, VT.scope]);
    for (const t of Object.values(VT)) {
      const mine = VCASES.filter((c) => c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    expect(VCASES).toHaveLength(14);
  });

  it.each(VCASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const { priced, text } = vrun(c);
    for (const p of c.re) expect({ id: c.id, want: p, hit: vmatch(text, p), text }).toEqual({ id: c.id, want: p, hit: true, text });
    for (const p of c.not ?? []) expect({ id: c.id, forbidden: p, hit: vmatch(text, p) }).toEqual({ id: c.id, forbidden: p, hit: false });
    if (c.priced !== undefined) expect({ id: c.id, priced }).toEqual({ id: c.id, priced: c.priced });
  });
});

/*
 * VRF-6 (owner rulings 2026-11-08 / 09; team 10:41-10:45; pre-VRF-6 13:02-13:45) -- R-39 ON v62: the thirteen lines v62 adds each fire
 * from the PANEL's entry point on a BoQ row the model read, positive AND negative. THE VRF GUARD: v62's titles = v61's 33 + 13.
 */
describe("VRF-6 (v62) -- R-39: every VRF Derivation-tab rule v62 adds fires from the panel's entry point; THE VRF GUARD", () => {
  type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
  const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
  const A62 = rd("rate_master_hvac_all_v62.json");
  const A61 = rd("rate_master_hvac_all_v61.json");
  const E72 = rd("rate_master_electrical_all_v72.json");
  const VRF = "hvac_vrf";
  const asItems = (a: A) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const items62 = [...asItems(A62), ...asItems(E72)];
  const cfgs = new Map<string, RateCategoryConfig>([...A62.category_configs, ...E72.category_configs].map((c) => [c.category_id, c]));
  const titles = (a: A) => itemListRuleOrder(a.category_configs.find((c) => c.category_id === VRF), asItems(a)).map((l) => l.title);
  const VT = {
    remote: "The remote's type follows the BoQ",
    said: "Every included extra that is not added says why",
    cat: "The own-row check reads each row's category first",
    split: "Written splits, and a module above the largest unit",
    pair: "A single that covers, unless a pair is cheaper",
    cable: "A cable or pipe fact reaches only the item it describes",
    make: "Accessories take the unit's make",
    team: "Frame / stand, gas by HP, MCB + ELCB by HP (team rule)",
    builtin: "A built-in drain pump is still added, with a review point",
    scope: "Supply / installation settled by the sheet's own rows",
    wiring: "'Control wiring' and 'quantified separately'",
    words: "The BoQ's own words settle some answers before pricing",
    two: "Two capacities in one row refuse, naming both",
  };
  type Row = { items?: Array<Record<string, string>>; unit?: string; text?: string; category?: string; node?: string; headings?: string[]; headingNotes?: string[]; ownNotes?: string[] };
  type VCase = { id: string; rule: string; kind: "pos" | "neg"; rows: Record<number, Row>; at: number; re: Array<string | RegExp>; not?: Array<string | RegExp>; priced?: boolean };
  const OD = (more: Record<string, string> = {}) => ({ item: "Outdoor Unit", brand: "Blue Star", capacity: "10 HP", ...more });
  const CAS = (more: Record<string, string> = {}) => ({ item: "Cassette", brand: "Blue Star", capacity: "2 TR", way: "FOUR-WAY", ...more });
  const W = (ids: string[], where = "Row") => Object.fromEntries(ids.flatMap((id) => [[`includes_${id}`, "Yes"], [`includes_${id}_where`, where]]));
  const VCASES: VCase[] = [
    { id: "H1a", rule: VT.remote, kind: "pos", rows: { 9: { items: [CAS({ ...W(["remote"]), remote_type: "Wired" })] } }, at: 9, re: ["remote_type:Wired"], priced: true },
    { id: "H1b-neg", rule: VT.remote, kind: "neg", rows: { 9: { items: [CAS(W(["remote"]))] } }, at: 9, re: ["remote_type:Cordless"], not: ["remote_type:Wired"], priced: true },
    { id: "H2a", rule: VT.said, kind: "pos", rows: { 9: { items: [CAS(W(["gas"], "Heading"))] } }, at: 9, re: [/Gas charge: .*NOT added: applies to outdoor units only/], priced: true },
    { id: "H2b-neg", rule: VT.said, kind: "neg", rows: { 9: { items: [OD(W(["gas"]))] } }, at: 9, re: ["line:acc_gas"], not: [/outdoor units only/], priced: true },
    { id: "H3a", rule: VT.cat, kind: "pos", rows: { 9: { items: [OD(W(["copper"], "Note"))] }, 287: { items: [{ item: "Copper" }], category: "hvac_piping", text: "5/8 dia" } }, at: 9,
      re: [/NOT added: the BoQ quotes it on its own row \(row 287\)/], not: ["line:copper_supply"], priced: true },
    { id: "H3b-neg", rule: VT.cat, kind: "neg", rows: { 9: { items: [OD(W(["copper"], "Note"))] }, 38: { items: [{ item: "Refnet/Y-Joint" }], text: "joints to connect copper piping" } }, at: 9,
      re: ["line:copper_supply"], priced: true },
    { id: "H4a", rule: VT.split, kind: "pos", rows: { 9: { items: [OD({ capacity: "24HP (12HP x 2NOS)" })] } }, at: 9, re: ["capacity:12", "split:The row states a split: 12 + 12"], priced: true },
    { id: "H4b-neg", rule: VT.split, kind: "neg", rows: { 9: { items: [OD({ capacity: "24 HP" })] } }, at: 9, re: ["capacity:24"], not: ["split:"], priced: true },
    { id: "H5a", rule: VT.pair, kind: "pos", rows: { 9: { items: [OD({ brand: "Daikin", cooling: "Heat Pump", capacity: "26 HP" })] } }, at: 9, re: [/split:26 HP is not a stocked size: the pair 20 \+ 6 HP \(0 HP over, cost \d+\) is cheaper than the 34 HP single/], priced: true },
    { id: "H5b-neg", rule: VT.pair, kind: "neg", rows: { 9: { items: [OD({ capacity: "9 HP", discharge: "Top" })] } }, at: 9, re: ["capacity:10"], not: ["split:"], priced: true },
    { id: "H6a", rule: VT.cable, kind: "pos", rows: { 9: { items: [OD({ capacity: "8 HP", ...W(["power"]), extra_cable_spec_as_written: "power cable (FRLS, XLPE, AL Armoured)" })] } }, at: 9, re: ["conductor:ALUMINIUM"], priced: true },
    { id: "H6b-neg", rule: VT.cable, kind: "neg", rows: { 9: { items: [OD({ capacity: "8 HP", ...W(["power"]), extra_cable_spec_as_written: "armoured copper cable" })] } }, at: 9, re: ["conductor:COPPER"], priced: true },
    { id: "H7a", rule: VT.make, kind: "pos", rows: { 9: { items: [CAS({ brand: "Daikin", capacity: "1 TR", ...W(["remote"]) })] } }, at: 9, re: [/item:Cordless Remote controller \(Daikin\)/], priced: true },
    { id: "H7b-neg", rule: VT.make, kind: "neg", rows: { 9: { items: [CAS(W(["remote"]))] } }, at: 9, re: [/item:Cordless Remote controller \(Blue Star\)/], not: [/no Blue Star/], priced: true },
    { id: "H8a", rule: VT.team, kind: "pos", rows: { 9: { items: [OD({ capacity: "26 HP", cooling: "Heat Pump", ...W(["frame", "gas", "mccb"]) })] } }, at: 9,
      re: ["item:MS frame / stand for ODU", "qty:26", "item:63A FP MCB C CURVE", "item:63A RCCB 300mA(FP)"], priced: true },
    { id: "H8b-neg", rule: VT.team, kind: "neg", rows: { 9: { items: [CAS(W(["frame", "gas", "mccb"]))] } }, at: 9, re: [], not: ["line:acc_frame", "line:acc_mcb"], priced: true },
    { id: "H9a", rule: VT.builtin, kind: "pos", rows: { 9: { items: [CAS(W(["drain_pump"]))], text: "cassette with built-in drain pump" } }, at: 9, re: [/built-in drain pump - added as a separate pump/], priced: true },
    { id: "H9b-neg", rule: VT.builtin, kind: "neg", rows: { 9: { items: [CAS(W(["drain_pump"]))] } }, at: 9, re: ["line:acc_drain_pump"], not: [/built-in/], priced: true },
    { id: "H10a", rule: VT.scope, kind: "pos", rows: { 22: { items: [OD({ capacity: "6 HP", discharge: "Side", scope: "Installation only" })] }, 6: { items: [OD({ capacity: "6 HP", discharge: "Side", scope: "Supply only" })] } }, at: 22,
      re: [/scope:.*normal installation rate applies.*row 6/], priced: true },
    { id: "H10b-neg", rule: VT.scope, kind: "neg", rows: { 22: { items: [OD({ capacity: "6 HP", discharge: "Side", scope: "Installation only" })] } }, at: 22, re: [/scope:.*installation-only uplift applies/], priced: true },
    { id: "H11a", rule: VT.wiring, kind: "pos", rows: { 9: { items: [{ item: "Ductable", brand: "Blue Star", capacity: "3.2 TR" }], headings: ["Ductable units with control wiring"] } }, at: 9, re: ["line:comm", /control wiring/], priced: true },
    { id: "H11b-neg", rule: VT.wiring, kind: "neg", rows: { 9: { items: [{ item: "Ductable", brand: "Blue Star", capacity: "3.2 TR" }] } }, at: 9, re: [], not: ["line:comm"], priced: true },
    { id: "H12a", rule: VT.words, kind: "pos", rows: { 9: { items: [{ capacity: "3.0 TR" }], headings: ["CSU type indoor units"] } }, at: 9, re: ["family:Ductable", /CSU/], priced: true },
    { id: "H12b-neg", rule: VT.words, kind: "neg", rows: { 9: { items: [{ capacity: "3.0 TR" }] } }, at: 9, re: [], not: ["family:Ductable"], priced: false },
    { id: "H13a", rule: VT.two, kind: "pos", rows: { 9: { items: [CAS({ capacity: "" })], text: "Cassette 2.6 Tr Capacity ... 1.3 TR capacity" } }, at: 9, re: ["two capacities stated (2.6 TR / 1.3 TR) - pick one"], priced: false },
    { id: "H13b-neg", rule: VT.two, kind: "neg", rows: { 9: { items: [CAS({ capacity: "" })], text: "Cassette unit" } }, at: 9, re: ["no capacity stated"], not: ["two capacities"], priced: false },
  ];
  function vrun(c: VCase) {
    const results = Object.entries(c.rows).filter(([, r]) => r.items).map(([er, r]) => ({ excel_row: Number(er), description: r.text ?? "", category_id: r.category ?? VRF, attributes: {},
      items: r.items!.map((a) => ({ attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) })) }));
    const rowQuantities = Object.fromEntries(Object.entries(c.rows).map(([er]) => [Number(er), 1]));
    const sheetLines = Object.entries(c.rows).map(([er, r]) => ({ row: Number(er), text: r.text ?? "", ...(r.node === "Preamble" ? { preamble: true } : {}) }));
    const h = makePricingSheetHelper({ configsByCategory: cfgs, items: items62, extractionByRow: buildExtractionByRow(results as never) });
    const r = c.rows[c.at];
    const res = h.compute({ excelRow: c.at, description: r.text ?? "", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"],
      headings: r.headings ?? [], ownNotes: r.ownNotes ?? [], headingNotes: r.headingNotes ?? [], unit: r.unit ?? "Nos", quantity: 1, rowQuantities, sheetLines } as RateHelperRowContext);
    const v = (res as ItemListSuggestion).itemList!;
    const out: string[] = [];
    if (v.reason) out.push(v.reason);
    if (v.scope?.note) out.push(`scope:${v.scope.note}`);
    if (v.split?.note) out.push(`split:${v.split.note}`);
    for (const b of v.items) {
      if (b.family) out.push(`family:${b.family}`);
      if (b.reason) out.push(b.reason);
      for (const f of b.fields) if (["capacity", "brand", "way"].includes(f.id)) out.push(`${f.id}:${f.value}`);
      for (const l of b.extras?.lines ?? []) {
        out.push(`line:${l.id}`);
        for (const f of l.fields) if (["item", "qty", "remote_type", "conductor"].includes(f.id)) out.push(`${f.id}:${f.value}`);
        out.push(...l.working);
      }
      if (b.extras?.review) out.push(...b.extras.review.points);
    }
    return { priced: v.rowPriced, text: out.join("\n") };
  }
  const vmatch = (text: string, p: string | RegExp) => (typeof p === "string" ? text.includes(p) : p.test(text));

  it("THE VRF GUARD: v62's VRF rules = v61's 33 + the thirteen VRF-6 lines; each line this block names has a positive AND a negative case", () => {
    const t62 = titles(A62);
    expect(t62).toHaveLength(46);
    expect(t62.slice(0, 33)).toEqual(titles(A61));
    expect(t62.slice(33)).toEqual(Object.values(VT));
    for (const t of Object.values(VT)) {
      const mine = VCASES.filter((c) => c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    expect(VCASES).toHaveLength(26);
  });

  it.each(VCASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const { priced, text } = vrun(c);
    for (const p of c.re) expect({ id: c.id, want: p, hit: vmatch(text, p), text }).toEqual({ id: c.id, want: p, hit: true, text });
    for (const p of c.not ?? []) expect({ id: c.id, forbidden: p, hit: vmatch(text, p) }).toEqual({ id: c.id, forbidden: p, hit: false });
    if (c.priced !== undefined) expect({ id: c.id, priced }).toEqual({ id: c.id, priced: c.priced });
  });
});

/*
 * VRF-7 (owner rulings 2026-11-10 01:30-01:53, from the VRF-6 review) -- R-39 ON v63: the ten lines v63 adds (and the one it rewords:
 * the control-wiring key is gone, so that line names only 'quantified separately') each fire from the PANEL's entry point on a BoQ row
 * the model read, positive AND negative. THE VRF GUARD: v63's titles = v62's 46 with line 44 reworded + the ten VRF-7 lines.
 */
describe("VRF-7 (v63) -- R-39: every VRF Derivation-tab rule v63 adds or rewords fires from the panel's entry point; THE VRF GUARD", () => {
  type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
  const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
  const A63 = rd("rate_master_hvac_all_v63.json");
  const A62 = rd("rate_master_hvac_all_v62.json");
  const E72 = rd("rate_master_electrical_all_v72.json");
  const VRF = "hvac_vrf";
  const asItems = (a: A) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const items63 = [...asItems(A63), ...asItems(E72)];
  const cfgs = new Map<string, RateCategoryConfig>([...A63.category_configs, ...E72.category_configs].map((c) => [c.category_id, c]));
  const titles = (a: A) => itemListRuleOrder(a.category_configs.find((c) => c.category_id === VRF), asItems(a)).map((l) => l.title);
  const VT = {
    discharge: "A discharge type the BoQ states wins",
    heat: "Cooling-and-heating wordings are a heat pump",
    armour: "A cable is armoured only when the BoQ says so",
    length: "A length belongs to the item it is written for",
    ownrow: "Every extra: added only when the sheet has no row of its own for it, always with a note",
    stepup: "A breaker step-up is noted",
    setup: "A module setup the BoQ states comes first",
    remote: "An optional remote and an individual controller include the remote",
    tfa: "A treated fresh air unit is priced as the fresh-air unit",
    notes: "Starter-panel and wired-remote notes",
  };
  const REWORDED = "'Quantified separately' wins";
  type Row = { items?: Array<Record<string, string>>; text?: string; category?: string; headings?: string[]; headingNotes?: string[]; ownNotes?: string[] };
  type VCase = { id: string; rule: string; kind: "pos" | "neg"; rows: Record<number, Row>; at: number; re: Array<string | RegExp>; not?: Array<string | RegExp>; priced?: boolean };
  const OD = (more: Record<string, string> = {}) => ({ item: "Outdoor Unit", brand: "Blue Star", capacity: "10 HP", ...more });
  const DU = (more: Record<string, string> = {}) => ({ item: "Ductable", brand: "Blue Star", capacity: "8.0 TR", ...more });
  const W = (ids: string[], where = "Row") => Object.fromEntries(ids.flatMap((id) => [[`includes_${id}`, "Yes"], [`includes_${id}_where`, where]]));
  const ARM = "Price includes armoured copper conductor cabling with end termination from Switch to ODU";
  const VCASES: VCase[] = [
    { id: "J1a", rule: VT.discharge, kind: "pos", rows: { 9: { items: [OD({ capacity: "6 HP" })], headings: ["VRF ODU - top discharge"] } }, at: 9, re: ["discharge:Top", "capacity:7", /priced as Top discharge/], priced: true },
    { id: "J1b-neg", rule: VT.discharge, kind: "neg", rows: { 9: { items: [OD({ capacity: "3 TR", remote_type: "Wired" })] } }, at: 9, re: ["discharge:Side", "capacity:4"], not: [/a type the BoQ states wins/], priced: true },
    { id: "J2a", rule: VT.heat, kind: "pos", rows: { 9: { items: [OD()], headings: ["VRF outdoor units suitable for cooling/heating"] } }, at: 9, re: ["cooling:Heat Pump", /priced as Heat Pump \(owner A5\)/], priced: true },
    { id: "J2b-neg", rule: VT.heat, kind: "neg", rows: { 9: { items: [OD()], headings: ["VRF outdoor units"] } }, at: 9, re: ["cooling:Cool Only"], not: [/owner A5/], priced: true },
    { id: "J3a", rule: VT.armour, kind: "pos", rows: { 9: { items: [OD({ capacity: "6 HP", ...W(["power"], "Note") })], headingNotes: [ARM] } }, at: 9, re: ["armour:ARMOURED", /Power cable: armoured - the BoQ says/], priced: true },
    { id: "J3b-neg", rule: VT.armour, kind: "neg", rows: { 9: { items: [OD({ capacity: "6 HP", ...W(["power"], "Note") })] } }, at: 9, re: ["armour:UNARMOURED"], not: [/armoured -/], priced: true },
    { id: "J4a", rule: VT.length, kind: "pos", rows: { 9: { items: [OD({ ...W(["power", "comm"], "Note"), extra_power_length_as_written: "around a distance of 5m" })] } }, at: 9,
      re: ["power length:5", "comm length:30", "no length stated for communication cable - 30 m default used (owner A3)"], priced: true },
    { id: "J4b-neg", rule: VT.length, kind: "neg", rows: { 9: { items: [OD({ ...W(["power"], "Note"), extra_power_length_as_written: "5 m" })] } }, at: 9, re: ["power length:5"], not: [/no length stated/], priced: true },
    { id: "J5a", rule: VT.ownrow, kind: "pos", rows: { 9: { items: [OD({ ...W(["frame"]), includes_frame_words: "including MS frame" })], text: "10 HP including MS frame" }, 60: { items: [{ item: "MS frame / stand for ODU" }], text: "MS stand for ODU" } }, at: 9,
      re: [/MS frame \/ stand: the BoQ says "including MS frame" \(this row\) - NOT added: the BoQ quotes it on its own row \(row 60\)/], not: ["line:acc_frame"], priced: true },
    { id: "J5b-neg", rule: VT.ownrow, kind: "neg", rows: { 9: { items: [OD({ ...W(["frame"]), includes_frame_words: "including MS frame" })], text: "10 HP including MS frame" } }, at: 9,
      re: ["line:acc_frame", /- added \(the BoQ has no row of its own for it\)/], priced: true },
    { id: "J6a", rule: VT.stepup, kind: "pos", rows: { 9: { items: [OD({ capacity: "6 HP", ...W(["mccb"], "Note") })] } }, at: 9, re: ["MCB - 6 HP: schedule says 20 A - not stocked; 25 A used (owner A6)"], priced: true },
    { id: "J6b-neg", rule: VT.stepup, kind: "neg", rows: { 9: { items: [OD({ capacity: "20 HP", ...W(["mccb"], "Note") })] } }, at: 9, re: ["item:63A FP MCB C CURVE"], not: [/schedule says/], priced: true },
    { id: "J7a", rule: VT.setup, kind: "pos", rows: { 9: { items: [OD({ capacity: "40 HP (in a combination of minimum 2 units of at least 20 HP each)", cooling: "Heat Pump" })] } }, at: 9,
      re: [/The BoQ states the modules: "minimum 2 units of at least 20 HP each"/, "capacity:20"], not: ["capacity:28"], priced: true },
    { id: "J7b-neg", rule: VT.setup, kind: "neg", rows: { 9: { items: [OD({ capacity: "40 HP", cooling: "Heat Pump" })] } }, at: 9, re: ["capacity:28", "capacity:12"], not: [/The BoQ states the modules/], priced: true },
    { id: "J8a", rule: VT.remote, kind: "pos", rows: { 9: { items: [DU()], headingNotes: ["Units to be supplied with/without wired remote controller as per the requirement of the client."] } }, at: 9,
      re: ["line:acc_remote", "remote_type:Wired", /optional in the BoQ, owner B10/], priced: true },
    { id: "J8b-neg", rule: VT.remote, kind: "neg", rows: { 9: { items: [DU()] } }, at: 9, re: [], not: ["line:acc_remote"], priced: true },
    { id: "J9a", rule: VT.tfa, kind: "pos", rows: { 9: { items: [DU({ capacity: "6.8 TR" })], headings: ["Supply of CSU type VRF / VRV treated fresh air unit"] } }, at: 9, re: ["family:Single Skin Treated Fresh Air", /owner B11/], priced: true },
    { id: "J9b-neg", rule: VT.tfa, kind: "neg", rows: { 9: { items: [DU({ capacity: "3 TR" })], headings: ["Supply of CSU type indoor unit"] } }, at: 9, re: ["family:Ductable"], not: [/owner B11/], priced: true },
    { id: "J10a", rule: VT.notes, kind: "pos", rows: { 9: { items: [OD({ capacity: "6 HP", ...W(["mccb"], "Note") })], headingNotes: ["unit mounted starter panel with power disconnecting switches with fuses"] } }, at: 9,
      re: ["line:acc_mcb", /MCB \+ ELCB still added, please check \(owner D1\)/], priced: true },
    // VRF-7 K1c (BEFORE: the same case WITH headingNotes ["wired remote"] -- the priced type's own words now decide the D2 note, so
    // that case is a real conflict and is noted; the negative keeps its point: a type no BoQ words name gets no note)
    { id: "J10b-neg", rule: VT.notes, kind: "neg", rows: { 9: { items: [DU({ capacity: "2 TR", ...W(["remote"], "Heading"), remote_type: "Wired" })], headings: ["coreded/cordless remotes"] } }, at: 9,
      re: ["remote_type:Wired"], not: [/owner D2/, /owner D1/], priced: true },
    { id: "J11a", rule: REWORDED, kind: "pos", rows: { 9: { items: [{ item: "Cassette", brand: "Blue Star", capacity: "1.6TR", way: "FOUR-WAY", ...W(["power", "comm"], "Heading") }], headingNotes: ["cabling & ODU stands quantified separately"] } }, at: 9,
      re: [/NOT added - the BoQ note says/], not: ["line:power"], priced: true },
    { id: "J11b-neg", rule: REWORDED, kind: "neg", rows: { 9: { items: [DU({ capacity: "3.2 TR" })], headings: ["Ductable units with control wiring"] } }, at: 9, re: [], not: ["line:comm", /control wiring/], priced: true },
  ];
  function vrun(c: VCase) {
    const results = Object.entries(c.rows).filter(([, r]) => r.items).map(([er, r]) => ({ excel_row: Number(er), description: r.text ?? "", category_id: r.category ?? VRF, attributes: {},
      items: r.items!.map((a) => ({ attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) })) }));
    const rowQuantities = Object.fromEntries(Object.entries(c.rows).map(([er]) => [Number(er), 1]));
    const sheetLines = Object.entries(c.rows).map(([er, r]) => ({ row: Number(er), text: r.text ?? "" }));
    const h = makePricingSheetHelper({ configsByCategory: cfgs, items: items63, extractionByRow: buildExtractionByRow(results as never) });
    const r = c.rows[c.at];
    const res = h.compute({ excelRow: c.at, description: r.text ?? "", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"],
      headings: r.headings ?? [], ownNotes: r.ownNotes ?? [], headingNotes: r.headingNotes ?? [], unit: "Nos", quantity: 1, rowQuantities, sheetLines } as RateHelperRowContext);
    const v = (res as ItemListSuggestion).itemList!;
    const out: string[] = [];
    if (v.reason) out.push(v.reason);
    for (const b of v.items) {
      if (b.family) out.push(`family:${b.family}`);
      if (b.reason) out.push(b.reason);
      for (const f of b.fields) if (["capacity", "brand", "discharge", "cooling"].includes(f.id)) out.push(`${f.id}:${f.value}`);
      for (const l of b.extras?.lines ?? []) {
        out.push(`line:${l.id}`);
        for (const f of l.fields) {
          if (["item", "qty", "remote_type", "armour"].includes(f.id)) out.push(`${f.id}:${f.value}`);
          if (f.id === "length") out.push(`${l.id} length:${f.value}`);
          if (f.note) out.push(f.note);
        }
        out.push(...l.working);
      }
      if (b.extras?.review) out.push(...b.extras.review.points);
    }
    return { priced: v.rowPriced, text: out.join("\n") };
  }
  const vmatch = (text: string, p: string | RegExp) => (typeof p === "string" ? text.includes(p) : p.test(text));

  it("THE VRF GUARD: v63's VRF rules = v62's 46 with line 44 reworded + the ten VRF-7 lines; each line this block names has a positive AND a negative case", () => {
    const t63 = titles(A63);
    const t62 = titles(A62);
    expect(t63).toHaveLength(56);
    // VRF-8 K2 (R-F4, owner 13:56) -- MOVED UNDER MECHANICAL AUTHORITY, nothing deleted. BEFORE: `expect(t63.slice(0, 43)).toEqual(t62.slice(0, 43))`.
    // Line 42 (index 41) now states its condition on a config with VRF-7's own-row check (v63 has it, v62 does not); every other
    // line of the first 43 is unchanged.
    const L42 = t62.indexOf("A built-in drain pump is still added, with a review point");
    expect(L42).toBe(41);
    expect(t63[L42]).toBe("A built-in drain pump is added only when the sheet has no pump row of its own, with a review point");
    expect([...t63.slice(0, L42), ...t63.slice(L42 + 1, 43)]).toEqual([...t62.slice(0, L42), ...t62.slice(L42 + 1, 43)]);
    expect(t62[43]).toBe("'Control wiring' and 'quantified separately'");
    expect(t63[43]).toBe(REWORDED);
    expect(t63.slice(44, 46)).toEqual(t62.slice(44, 46));
    expect(t63.slice(46)).toEqual(Object.values(VT));
    for (const t of [...Object.values(VT), REWORDED]) {
      const mine = VCASES.filter((c) => c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    expect(VCASES).toHaveLength(22);
  });

  it.each(VCASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const { priced, text } = vrun(c);
    for (const p of c.re) expect({ id: c.id, want: p, hit: vmatch(text, p), text }).toEqual({ id: c.id, want: p, hit: true, text });
    for (const p of c.not ?? []) expect({ id: c.id, forbidden: p, hit: vmatch(text, p) }).toEqual({ id: c.id, forbidden: p, hit: false });
    if (c.priced !== undefined) expect({ id: c.id, priced }).toEqual({ id: c.id, priced: c.priced });
  });
});

/*
 * VRF-8 (owner rulings 2026-11-10 13:56-15:05, from the VRF-7 review) -- R-39 ON v64: the 17 lines v64 adds each fire from the PANEL's
 * entry point on a BoQ row the model read, positive AND negative. THE VRF GUARD: v64's titles = v63's 56 (line 42 states its condition,
 * K2) + the 17 VRF-8 lines.
 */
describe("VRF-8 (v64) -- R-39: every VRF Derivation-tab rule v64 adds fires from the panel's entry point; THE VRF GUARD", () => {
  type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
  const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
  const A64 = rd("rate_master_hvac_all_v64.json");
  const A63 = rd("rate_master_hvac_all_v63.json");
  const E72 = rd("rate_master_electrical_all_v72.json");
  const VRF = "hvac_vrf";
  const asItems = (a: A) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const items64 = [...asItems(A64), ...asItems(E72)];
  const cfgs = new Map<string, RateCategoryConfig>([...A64.category_configs, ...E72.category_configs].map((c) => [c.category_id, c]));
  const titles = (a: A) => itemListRuleOrder(a.category_configs.find((c) => c.category_id === VRF), asItems(a)).map((l) => l.title);
  const VT = {
    setup: "A written module setup that is not stocked -> the split rule on the total",
    nets: "Starter-panel breakers, ODU supports and plug-top power cable",
    qs: "'Quantified separately' is always said",
    remote: "Remote notes read only this unit's own words",
    supply: "A 'Supply of' heading with an installation note stays supply + installation",
    feeder: "A feeder within N m of the ODU sets the power cable length",
    breaker: "'Breaker (if required)' includes the MCB + ELCB",
    drain: "Drain-pump cabling is never the unit's power cable",
    inter: "'Interconnections with power supply' are connection work",
    mode: "The nearer heading wins on cooling / heating",
    install: "An installation-only row follows its supply row",
    repeated: "A capacity stated twice wins",
    types: "Several unit types under one heading refuse",
    missing: "An extra the model left unanswered follows the BoQ's words",
    tfa: "A fresh-air unit complete with its outdoor unit",
    make: "A stated make with no size close enough gives way",
    quotes: "Only verified BoQ quotes are shown",
  };
  // VRF-8: a case may also carry every heading's notes above the row (`ancestorNotes`, what the page builds) -- a note two levels up
  type Row = { items?: Array<Record<string, string | null>>; text?: string; category?: string; headings?: string[]; headingNotes?: string[]; ownNotes?: string[]; ancestorNotes?: string[] };
  type VCase = { id: string; rule: string; kind: "pos" | "neg"; rows: Record<number, Row>; at: number; re: Array<string | RegExp>; not?: Array<string | RegExp>; priced?: boolean };
  const OD = (more: Record<string, string | null> = {}) => ({ item: "Outdoor Unit", brand: "Blue Star", capacity: "10 HP", ...more });
  const W = (ids: string[], where = "Row") => Object.fromEntries(ids.flatMap((id) => [[`includes_${id}`, "Yes"], [`includes_${id}_where`, where]]));
  const SP = "The unit mouted starter panel shall be complete with IP-55 protection consisting of power disconnecting switches with fuses";
  const EC = "MCCB / MCB isolator & incoming power supply for VRV/VRF ODU unit will be in Electrical contractor scope of work";
  const TYPES = ["Hi-Wall Split Units", "4 Way Compact Cassette Units", "4 Way Cassette Units", "Ceiling Suspended Ductable Units"];
  const TFA = "Supply of 741 CFM (6 HP) Treated Fresh Air (TFA) Unit complete with suitable Outdoor unit";
  const VCASES: VCase[] = [
    { id: "K1a", rule: VT.setup, kind: "pos", rows: { 9: { items: [OD({ brand: "Daikin", cooling: "Cool Only", capacity: "60.0 HP (18+18+24)" })] } }, at: 9, re: [/could not be followed/, "capacity:20"], not: ["capacity:12"], priced: true },
    { id: "K1b-neg", rule: VT.setup, kind: "neg", rows: { 9: { items: [OD({ brand: "Daikin", cooling: "Cool Only", capacity: "40HP (20+20)" })] } }, at: 9, re: ["capacity:20"], not: [/could not be followed/], priced: true },
    { id: "K2a", rule: VT.nets, kind: "pos", rows: { 9: { items: [OD({ capacity: "6 HP" })], headingNotes: [SP] } }, at: 9, re: ["line:acc_mcb", "line:acc_elcb", /owner D1/], priced: true },
    { id: "K2b-neg", rule: VT.nets, kind: "neg", rows: { 9: { items: [OD({ capacity: "6 HP", includes_mccb: "No" })], headingNotes: [SP] } }, at: 9, re: [], not: ["line:acc_mcb"], priced: true },
    { id: "K3a", rule: VT.qs, kind: "pos", rows: { 9: { items: [{ item: "Cassette", brand: "Blue Star", capacity: "1.6TR", ...W(["remote"], "Heading") }], headingNotes: ["All piping, cabling & ODU stands quantified separately."] } }, at: 9,
      re: [/Power cable: not added - the BoQ note says/], not: ["line:power"], priced: true },
    { id: "K3b-neg", rule: VT.qs, kind: "neg", rows: { 9: { items: [{ item: "Cassette", brand: "Blue Star", capacity: "1.6TR", ...W(["remote"], "Heading") }] } }, at: 9, re: [], not: [/quantified separately/], priced: true },
    { id: "K4a", rule: VT.remote, kind: "pos", rows: { 9: { items: [{ item: "Cassette", brand: "Blue Star", capacity: "1.28 TR", remote_type: "Wired", ...W(["remote"], "Heading") }],
      headings: ["VRF SYSTEM", "Indoor Units (Cassette): Supply of Cassette units with wall mounted corded remote with LCD display"], ancestorNotes: ["The system should be complete with controls, cordless/ Corded remote, power and control wiring"] } }, at: 9,
      // the plain words that decided are quoted from where they sit as plain words (the unit heading), never the "Corded" inside the pair
      re: ["remote_type:Wired", /owner W7/, /the BoQ says "[^"]*wall mounted corded remote with LCD display[^"]*" and also "[^"]*cordless\/ Corded remote/], priced: true },
    { id: "K4b-neg", rule: VT.remote, kind: "neg", rows: { 9: { items: [{ item: "Hi-Wall", brand: "Blue Star", capacity: "1.0TR", remote_type: "Cordless", ...W(["remote"], "Note") }], text: "Hi wall unit type 1 -1.0TR",
      headings: ["VRF LOW SIDE WORKS"], headingNotes: ["Ductable Unit -SITC of Ceiling Suspended Ductable unit with corded remote controller", "Hi wall Unit- SITC of Hi wall Type VRV Indoor Unit with cordless remote controller to be considered"] } }, at: 9,
      re: ["remote_type:Cordless"], not: [/owner D2/, /owner W7/], priced: true },
    { id: "K5a", rule: VT.supply, kind: "pos", rows: { 9: { items: [OD({ capacity: "18 HP", scope: "Supply + installation" })], headings: ["Supply of VRV ODU System"], headingNotes: ["Installation, testing and commissioning of VRV Condensor Units"] } }, at: 9,
      re: [/priced as supply \+ installation \(owner D1\)/], priced: true },
    { id: "K5b-neg", rule: VT.supply, kind: "neg", rows: { 9: { items: [OD({ capacity: "18 HP", scope: "Supply + installation" })], headings: ["SITC of VRV ODU System"], headingNotes: ["Installation, testing and commissioning of VRV Condensor Units"] } }, at: 9,
      re: [], not: [/owner D1\)/], priced: true },
    { id: "K6a", rule: VT.feeder, kind: "pos", rows: { 9: { items: [OD(W(["power"], "Heading"))], headingNotes: ["Note: Single feeder shall be provided for all VRF ODU within 5 mtr distance from ODU."] } }, at: 9, re: ["power length:5", /owner D4/], priced: true },
    { id: "K6b-neg", rule: VT.feeder, kind: "neg", rows: { 9: { items: [OD(W(["power"], "Heading"))] } }, at: 9, re: ["power length:30"], not: [/owner D4/], priced: true },
    { id: "K7a", rule: VT.breaker, kind: "pos", rows: { 9: { items: [OD({ capacity: "12 HP", includes_mccb: "No" })], headingNotes: ["The cost of the unit shall include cabling, gland, cable tray and breaker (if required) to distribute power", EC] } }, at: 9,
      re: ["line:acc_mcb", /added as the safe choice \(owner D5\)/], priced: true },
    { id: "K7b-neg", rule: VT.breaker, kind: "neg", rows: { 9: { items: [OD({ capacity: "12 HP", includes_mccb: "No" })], headingNotes: [EC] } }, at: 9, re: [/NOT added - the BoQ says/], not: ["line:acc_mcb"], priced: true },
    { id: "K8a", rule: VT.drain, kind: "pos", rows: { 9: { items: [{ item: "Hi-Wall", brand: "Blue Star", capacity: "1.6 TR", ...W(["remote"], "Note") }], headingNotes: ["Necessary cabling including plug top from nearest power point for the drain pump."] } }, at: 9,
      re: [/is for the drain pump/], not: ["line:power"], priced: true },
    { id: "K8b-neg", rule: VT.drain, kind: "neg", rows: { 9: { items: [{ item: "Hi-Wall", brand: "Blue Star", capacity: "1.6 TR", includes_power: "None" }], headingNotes: ["Quoted price shall be inclusive of Plug Top & necessary power cable."] } }, at: 9,
      re: ["line:power"], not: [/drain pump/], priced: true },
    { id: "K9a", rule: VT.inter, kind: "pos", rows: { 9: { items: [{ item: "Ductable", brand: "Blue Star", capacity: "3.0 TR", ...W(["power"], "Heading"), includes_power_words: "necessary interconnections with Power supply / earthing / Refrigerant Connections" }],
      headings: ["The scope includes necessary interconnections with Power supply / earthing / Refrigerant Connections Complete as required"] } }, at: 9, re: [/connection work only \(owner D8\)/], not: ["line:power"], priced: true },
    { id: "K9b-neg", rule: VT.inter, kind: "neg", rows: { 9: { items: [{ item: "Ductable", brand: "Blue Star", capacity: "3.0 TR", ...W(["power"], "Heading"), includes_power_words: "power cable from the DB" }], headings: ["Indoor units with power cable from the DB"] } }, at: 9,
      re: ["line:power"], not: [/owner D8/], priced: true },
    { id: "K10a", rule: VT.mode, kind: "pos", rows: { 9: { items: [OD({ capacity: "18 HP" })], headings: ["VRV SYSTEM with individual controller for cooling & heating application", "OUTDOOR UNITS"], headingNotes: ["The condensing units shall be suitable to work on cooling mode even during peak winter season"] } }, at: 9,
      re: ["cooling:Cool Only", /the nearer heading wins: priced as Cool Only \(owner D9\)/], priced: true },
    { id: "K10b-neg", rule: VT.mode, kind: "neg", rows: { 9: { items: [OD({ capacity: "18 HP" })], headings: ["OUTDOOR UNITS"], headingNotes: ["The condensing units shall be suitable to work on cooling mode even during peak winter season"] } }, at: 9,
      re: ["cooling:Cool Only"], not: [/owner D9/], priced: true },
    { id: "K11a", rule: VT.install, kind: "pos", rows: { 7: { items: [{ item: "Outdoor Unit", brand: "Daikin", brand_as_written: "Daikin", discharge: "Side", capacity: "12HP", scope: "Supply only" }], text: "12HP Side" },
      9: { items: [{ item: "Outdoor Unit", discharge: "Side", capacity: "12HP", scope: "Installation only" }], text: "12HP Side" } }, at: 9, re: ["brand:Daikin", "capacity:6", /quoted on row 7 as Daikin/], priced: true },
    { id: "K11b-neg", rule: VT.install, kind: "neg", rows: { 9: { items: [{ item: "Outdoor Unit", discharge: "Side", capacity: "8HP", scope: "Installation only" }], text: "8HP Side" } }, at: 9, re: ["brand:Blue Star"], not: [/owner D10/], priced: true },
    { id: "K12a", rule: VT.repeated, kind: "pos", rows: { 9: { items: [{ item: "Ductable", remote_type: "Wired", capacity: "5.5TR" }], text: "CSU ductable indoor-4.0 TR capacity | as per the capacity belo5.5 TR capacity 4.0TR capacity" } }, at: 9,
      re: ["capacity:4", /twice and 5.5 TR once/], priced: true },
    { id: "K12b-neg", rule: VT.repeated, kind: "neg", rows: { 9: { items: [{ item: "Ductable", remote_type: "Wired", capacity: "4.0TR" }], text: "CSU ductable indoor-4.0 TR capacity" } }, at: 9, re: ["capacity:4"], not: [/owner D11/], priced: true },
    { id: "K13a", rule: VT.types, kind: "pos", rows: { 9: { items: [{ item: null, capacity: "2.0 TR" }], text: "2.0 TR", headings: ["VRF indoor units"], headingNotes: TYPES } }, at: 9, re: [/several unit types under this heading/], priced: false },
    { id: "K13b-neg", rule: VT.types, kind: "neg", rows: { 9: { items: [{ item: "Cassette", capacity: "2.0 TR" }], text: "2.0 TR 4 way cassette", headings: ["VRF indoor units"], headingNotes: TYPES } }, at: 9, re: [], not: [/several unit types/], priced: true },
    { id: "K14a", rule: VT.missing, kind: "pos", rows: { 9: { items: [{ item: "Cassette", brand: "Blue Star", capacity: "3.0TR", includes_drain_pump: null }], headings: ["VRF Indoor units with drain pumps for cassette, ductable & TFA units"] } }, at: 9,
      re: ["line:acc_drain_pump", /- added \(the BoQ has no row of its own for it\)/], priced: true },
    { id: "K14b-neg", rule: VT.missing, kind: "neg", rows: { 9: { items: [{ item: "Cassette", brand: "Blue Star", capacity: "3.0TR", includes_drain_pump: "None" }], headings: ["VRF Indoor units with drain pumps for cassette, ductable & TFA units"] } }, at: 9,
      re: [], not: ["line:acc_drain_pump"], priced: true },
    { id: "K15a", rule: VT.tfa, kind: "pos", rows: { 9: { items: [{ item: "Single Skin Treated Fresh Air", capacity: "741 CFM (6 HP)" }, { item: "Outdoor Unit" }], text: TFA } }, at: 9, re: [/owner D14-1/, "capacity:6"], priced: true },
    { id: "K15b-neg", rule: VT.tfa, kind: "neg", rows: { 9: { items: [{ item: "Single Skin Treated Fresh Air", capacity: "741 CFM (6 HP)" }, { item: "Outdoor Unit" }], text: "741 CFM (6 HP) TFA unit" } }, at: 9, re: [/no capacity stated/], not: [/owner D14-1/], priced: false },
    { id: "K16a", rule: VT.make, kind: "pos", rows: { 9: { items: [{ item: "Ductable", brand_as_written: "TOSHIBA / DAIKIN / PANASONIC", capacity: "1.59 TR" }] } }, at: 9, re: [/Daikin's smallest is 4 TR/], not: ["brand:Daikin"], priced: true },
    { id: "K16b-neg", rule: VT.make, kind: "neg", rows: { 9: { items: [{ item: "Ductable", brand_as_written: "TOSHIBA / DAIKIN / PANASONIC", capacity: "4 TR" }] } }, at: 9, re: ["brand:Daikin"], not: [/owner D14-2/], priced: true },
    { id: "K17a", rule: VT.quotes, kind: "pos", rows: { 9: { items: [OD({ ...W(["frame"], "Note"), includes_frame_words: "The cost of the unit ... MS plate structure" })], headingNotes: ["The cost of the unit shall include a necessary MS angle base frame and an MS plate structure"] } }, at: 9,
      re: [/MS frame \/ stand: stated in note/], not: [/the BoQ says "The cost of the unit \.\.\./], priced: true },
    { id: "K17b-neg", rule: VT.quotes, kind: "neg", rows: { 9: { items: [OD({ ...W(["frame"], "Note"), includes_frame_words: "a necessary MS angle base frame" })], headingNotes: ["The cost of the unit shall include a necessary MS angle base frame and an MS plate structure"] } }, at: 9,
      re: [/the BoQ says "a necessary MS angle base frame"/], priced: true },
  ];
  function vrun(c: VCase) {
    const results = Object.entries(c.rows).filter(([, r]) => r.items).map(([er, r]) => ({ excel_row: Number(er), description: r.text ?? "", category_id: r.category ?? VRF, attributes: {},
      items: r.items!.map((a) => ({ attributes: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: v === null ? 0 : 0.9 }])) })) }));
    const rowQuantities = Object.fromEntries(Object.entries(c.rows).map(([er]) => [Number(er), 1]));
    const sheetLines = Object.entries(c.rows).map(([er, r]) => ({ row: Number(er), text: r.text ?? "" }));
    const h = makePricingSheetHelper({ configsByCategory: cfgs, items: items64, extractionByRow: buildExtractionByRow(results as never) });
    const r = c.rows[c.at];
    const res = h.compute({ excelRow: c.at, description: r.text ?? "", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"],
      headings: r.headings ?? [], ownNotes: r.ownNotes ?? [], headingNotes: r.headingNotes ?? [], ...(r.ancestorNotes ? { ancestorNotes: r.ancestorNotes } : {}),
      unit: "Nos", quantity: 1, rowQuantities, sheetLines } as RateHelperRowContext);
    const v = (res as ItemListSuggestion).itemList!;
    const out: string[] = [];
    if (v.reason) out.push(v.reason);
    if (v.split?.note) out.push(v.split.note);
    if (v.scope?.note) out.push(v.scope.note);
    for (const b of v.items) {
      if (b.family) out.push(`family:${b.family}`);
      if (b.reason) out.push(b.reason);
      for (const f of b.fields) if (["capacity", "brand", "discharge", "cooling"].includes(f.id)) out.push(`${f.id}:${f.value}`);
      for (const l of b.extras?.lines ?? []) {
        out.push(`line:${l.id}`);
        for (const f of l.fields) {
          if (["item", "qty", "remote_type", "armour"].includes(f.id)) out.push(`${f.id}:${f.value}`);
          if (f.id === "length") out.push(`${l.id} length:${f.value}`);
          if (f.note) out.push(f.note);
        }
        out.push(...l.working);
      }
      if (b.extras?.review) out.push(...b.extras.review.points);
    }
    return { priced: v.rowPriced, text: out.join("\n") };
  }
  const vmatch = (text: string, p: string | RegExp) => (typeof p === "string" ? text.includes(p) : p.test(text));

  it("THE VRF GUARD: v64's VRF rules = v63's 56 + the 17 VRF-8 lines; each line this block names has a positive AND a negative case", () => {
    const t64 = titles(A64);
    const t63 = titles(A63);
    expect(t63).toHaveLength(56);
    expect(t64).toHaveLength(73);
    expect(t64.slice(0, 56)).toEqual(t63);
    expect(t64.slice(56)).toEqual(Object.values(VT));
    for (const t of Object.values(VT)) {
      const mine = VCASES.filter((c) => c.rule === t);
      expect({ rule: t, pos: mine.some((c) => c.kind === "pos"), neg: mine.some((c) => c.kind === "neg") }).toEqual({ rule: t, pos: true, neg: true });
    }
    expect(VCASES).toHaveLength(34);
  });

  it.each(VCASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const { priced, text } = vrun(c);
    for (const p of c.re) expect({ id: c.id, want: p, hit: vmatch(text, p), text }).toEqual({ id: c.id, want: p, hit: true, text });
    for (const p of c.not ?? []) expect({ id: c.id, forbidden: p, hit: vmatch(text, p) }).toEqual({ id: c.id, forbidden: p, hit: false });
    if (c.priced !== undefined) expect({ id: c.id, priced }).toEqual({ id: c.id, priced: c.priced });
  });
});

/**
 * VRF-9 (v65) -- R-39 on the MINTED asset: every Derivation-tab rule v65 adds fires from the panel's entry point (the calculator's for
 * the calculator rules), positive AND negative. THE VRF GUARD (QR-3 4b): v65's titles = v64's 73 + the 13 VRF-9 lines.
 */
describe("VRF-9 (v65) -- R-39: every VRF Derivation-tab rule v65 adds fires from the panel's entry point; THE VRF GUARD", () => {
  type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
  type V = NonNullable<ItemListSuggestion["itemList"]>;
  const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
  const A65 = rd("rate_master_hvac_all_v65.json");
  const A64 = rd("rate_master_hvac_all_v64.json");
  const E72 = rd("rate_master_electrical_all_v72.json");
  const VRF = "hvac_vrf";
  const asItems = (a: A) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const titles = (a: A) => itemListRuleOrder(a.category_configs.find((c) => c.category_id === VRF), asItems(a)).map((l) => l.title);
  type R = { items: Array<Record<string, string | null>>; unit?: string; text?: string; headings?: string[]; headingNotes?: string[]; ancestorNotes?: string[]; qty?: number };
  const on = (a: A) => {
    const items = [...asItems(a), ...asItems(E72)];
    const cfgs = new Map<string, RateCategoryConfig>([...a.category_configs, ...E72.category_configs].map((c) => [c.category_id, c]));
    const panel = (r: R): V => {
      const results = [{ excel_row: 9, description: r.text ?? "", category_id: VRF, attributes: {}, items: r.items.map((x) => ({ attributes: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) })) }];
      const h = makePricingSheetHelper({ configsByCategory: cfgs, items, extractionByRow: buildExtractionByRow(results as never) });
      return (h.compute({ excelRow: 9, description: r.text ?? "", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"],
        unit: r.unit ?? "Nos", quantity: r.qty ?? 1, headings: r.headings ?? [], ownNotes: [], headingNotes: r.headingNotes ?? [], ...(r.ancestorNotes ? { ancestorNotes: r.ancestorNotes } : {}) } as never, {}) as unknown as ItemListSuggestion).itemList!;
    };
    const calc = (unit: string, family: string, attrs: Record<string, string> = {}): V => {
      const h = makePricingSheetHelper({ configsByCategory: cfgs, items, extractionByRow: new Map() });
      return (h.compute({ excelRow: 1, description: "", nodeType: "", category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"] } as never,
        { [ROW_UNIT_OVERRIDE_KEY]: unit, [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs }] }) }) as unknown as ItemListSuggestion).itemList!;
    };
    return { panel, calc };
  };
  const v65 = on(A65);
  const v64 = on(A64);
  const pts = (v: V) => v.items.flatMap((b) => b.extras?.review?.points ?? []).join("\n");
  const line = (v: V, id: string) => v.items[0]?.extras?.lines.find((l) => l.id === id);
  const D12N = ["Hi-Wall Split Units", "4 Way Compact Cassette Units", "4 Way Cassette Units", "Ceiling Suspended Ductable Units"];
  const SP = ["The unit mouted starter panel shall be complete with IP-55 protection consisting of power disconnecting switches with fuses, soft starters, for compressor motors"];
  const VT = {
    types: "Several unit types: only when the row names none",
    note: "A 'Supply of' row with installation said above: the scope note always",
    level: "Installation said at any level wins over a supply-only reading",
    quotes: "The panel's own notes quote the BoQ word for word, with their rows",
    feeder: "The feeder-length note on every module",
    tfa: "A fresh-air unit with no capacity read takes the row's",
    hp: "A per-HP row refuses in the calculator too",
    gas: "A first / factory charge of refrigerant is the gas charge",
    not: "BMS-interface cables and civil supports are not extras",
    fcu: "A Fan Coil Unit with no type told is refused",
    set: "A Set the BoQ defines is one refnet",
    both: "Gas charging is always supply + installation",
    rowfam: "A gas-charging or ODU-frame row with no item read",
  };
  type C = { rule: string; kind: "pos" | "neg"; ok: () => boolean };
  const wm = (s: typeof v65) => s.panel({ items: [{ item: "Hi-Wall", capacity: "2.0TR" }], text: "Wall Mounted Type (2.0TR)", headings: ["SITC of indoor units"], headingNotes: D12N });
  const sup = (s: typeof v65) => s.panel({ items: [{ item: "Outdoor Unit", capacity: "16 HP" }], text: "VRV - 50HP | Supply of VRV outdoor unit", headings: ["The unit rate for all items shall include installation, testing, commissioning"] });
  const lvl = (s: typeof v65, text = "14 HP ODU") => s.panel({ items: [{ item: "Outdoor Unit", capacity: "14 HP", scope: "Supply only" }], text, headings: ["VRV HIGHSIDE", "OUTDOOR UNITS"], ancestorNotes: ["Supply, port clearance, transport of units", "Supply, Installation, testing & commissioning of the VRV system"] });
  const fdr = (s: typeof v65) => s.panel({ items: [{ item: "Outdoor Unit", capacity: "38HP (20+18)", cooling: "Heat Pump", includes_power: "Yes", includes_power_where: "Heading" }], headingNotes: ["Single feeder shall be provided for all VRF ODU within 5 mtr distance from ODU"] });
  const tfa = (s: typeof v65) => s.panel({ items: [{ item: "Single Skin Treated Fresh Air", capacity: null }, { item: "Outdoor Unit", capacity: "6 HP" }], text: "741 CFM (6 HP) Treated Fresh Air (TFA) Unit complete with suitable Outdoor unit" });
  const gas = (s: typeof v65) => s.panel({ items: [{ item: "Outdoor Unit", capacity: "12 HP", includes_gas: "No" }], headingNotes: ["factory charged with first charge of refrigerant"] });
  const bms = (s: typeof v65) => s.panel({ items: [{ item: "Outdoor Unit", capacity: "8 HP", includes_comm: "Yes", includes_comm_where: "Note", includes_comm_words: "provision for BMS interface bacnet / Modbus, communication cables" }], headingNotes: ["provision for BMS interface bacnet / Modbus, communication cables"] });
  const civ = (s: typeof v65) => s.panel({ items: [{ item: "Outdoor Unit", capacity: "8HP", includes_frame: "Yes", includes_frame_where: "Note", includes_frame_words: "Including Civil pedestal supports for outdoor units" }], headingNotes: ["Including Civil pedestal supports for outdoor units"] });
  const fcu = (s: typeof v65) => s.panel({ items: [{ capacity: "1.0 TR" }], text: "1.0 TR", headings: ["VRF SYSTEM", "Fan Coil Units"] });
  const set = (s: typeof v65) => s.panel({ items: [{ item: "Refnet/Y-Joint", set_contents_as_written: "Liquid and Gas considered as a one Set", set_covers: "Indoor side only", set_idu: "8" }], unit: "Set", qty: 2 });
  const chg = (s: typeof v65) => s.panel({ items: [{ item: "Refrigerant Gas Filling (R-410)", scope: "Installation only" }], unit: "kg", text: "Installation of refrigerant gas including topping up of Refrigerant R-410A" });
  const frm = (s: typeof v65) => s.panel({ items: [{ scope: "Supply + installation" }], text: "Supply and installation of MS base frames for outdoor units" });
  const CASES: C[] = [
    { rule: VT.types, kind: "pos", ok: () => wm(v65).rowPriced === true && v65.calc("Nos", "Hi-Wall / Cassette / Ductable", { capacity: "2" }).reason === "several unit types under this heading - fix the headings or pick the type (owner D12)" },
    { rule: VT.types, kind: "neg", ok: () => wm(v64).rowPriced === false },
    { rule: VT.note, kind: "pos", ok: () => /owner R-D1/.test(sup(v65).scope?.note ?? "") },
    { rule: VT.note, kind: "neg", ok: () => !sup(v64).scope?.note },
    { rule: VT.level, kind: "pos", ok: () => lvl(v65).scope?.value === "Supply + installation" },
    { rule: VT.level, kind: "neg", ok: () => lvl(v65, "14 HP ODU - supply only").scope?.value === "Supply only" && lvl(v64).scope?.value === "Supply only" },
    { rule: VT.quotes, kind: "pos", ok: () => { const q = pts(v65.panel({ items: [{ item: "Outdoor Unit", capacity: "6HP" }], headingNotes: SP })); return /MCB \+ ELCB: the BoQ says "[^"]*fuses" \(/.test(q) && !/\.\.\."/.test(q); } },
    { rule: VT.quotes, kind: "neg", ok: () => /\.\.\."/.test(pts(v64.panel({ items: [{ item: "Outdoor Unit", capacity: "6HP" }], headingNotes: SP }))) },
    { rule: VT.feeder, kind: "pos", ok: () => { const v = fdr(v65); return v.items.length === 2 && v.items.every((b) => (b.extras?.review?.points ?? []).some((q) => /owner D4/.test(q))); } },
    { rule: VT.feeder, kind: "neg", ok: () => !(fdr(v64).items[1]?.extras?.review?.points ?? []).some((q) => /owner D4/.test(q)) },
    { rule: VT.tfa, kind: "pos", ok: () => tfa(v65).rowPriced === true },
    { rule: VT.tfa, kind: "neg", ok: () => tfa(v64).rowPriced === false },
    { rule: VT.hp, kind: "pos", ok: () => /^Unit "per HP" is not a VRF unit/.test(v65.calc("per HP", "Outdoor Unit", { capacity: "10" }).reason ?? "") },
    { rule: VT.hp, kind: "neg", ok: () => !/^Unit "per HP"/.test(v64.calc("per HP", "Outdoor Unit", { capacity: "10" }).reason ?? "") },
    { rule: VT.gas, kind: "pos", ok: () => line(gas(v65), "acc_gas")?.state === "priced" },
    { rule: VT.gas, kind: "neg", ok: () => line(gas(v64), "acc_gas") === undefined },
    { rule: VT.not, kind: "pos", ok: () => line(bms(v65), "comm") === undefined && line(civ(v65), "acc_frame") === undefined },
    { rule: VT.not, kind: "neg", ok: () => line(bms(v64), "comm")?.state === "priced" && line(civ(v64), "acc_frame")?.state === "priced" },
    { rule: VT.fcu, kind: "pos", ok: () => fcu(v65).reason === "Fan Coil Unit - pick the indoor type" && v65.calc("Nos", "Fan Coil Units", { capacity: "1" }).reason === "Fan Coil Unit - pick the indoor type" },
    { rule: VT.fcu, kind: "neg", ok: () => /no item could be told/.test(fcu(v64).reason ?? "") },
    { rule: VT.set, kind: "pos", ok: () => set(v65).items[0].qty === "1" },
    { rule: VT.set, kind: "neg", ok: () => set(v64).items[0].qty === "4" },
    { rule: VT.both, kind: "pos", ok: () => chg(v65).totals?.supply_rate === 1020 },
    { rule: VT.both, kind: "neg", ok: () => chg(v64).totals?.supply_rate === 0 },
    { rule: VT.rowfam, kind: "pos", ok: () => frm(v65).totals?.supply_rate === 5600 },
    { rule: VT.rowfam, kind: "neg", ok: () => frm(v64).rowPriced === false },
  ];
  it("every VRF-9 rule fires on v65 and not on v64 (positive AND negative per Derivation line)", () => {
    expect(CASES.filter((c) => !c.ok()).map((c) => `${c.rule} (${c.kind})`)).toEqual([]);
    for (const t of Object.values(VT)) {
      expect({ t, pos: CASES.some((c) => c.rule === t && c.kind === "pos"), neg: CASES.some((c) => c.rule === t && c.kind === "neg") }).toEqual({ t, pos: true, neg: true });
    }
    expect(CASES).toHaveLength(26);
  });
  it("THE VRF GUARD: v65's VRF rules = v64's 73 + the 13 VRF-9 lines", () => {
    const t65 = titles(A65);
    const t64 = titles(A64);
    expect(t64).toHaveLength(73);
    // VRF-10 (mechanical authority, this slice's own ruling: its 3 Derivation lines ride v65's `scope.panel_pick`, 13l) -- BEFORE:
    // expect(t65).toHaveLength(86); expect(t65.slice(73)).toEqual(Object.values(VT)). The 13 VRF-9 lines still follow v64's 73.
    expect(t65).toHaveLength(89);
    expect(t65.slice(0, 73)).toEqual(t64);
    expect(t65.slice(73, 86)).toEqual(Object.values(VT));
  });
});

/**
 * VRF-10 (v65, no mint) -- R-39: the 3 Derivation-tab lines VRF-10 adds (13l, on v65's `scope.panel_pick`) and the changed unit line
 * (F1) fire from the panel's entry point, positive AND negative (v64 = VRF-9). THE VRF GUARD: v65's titles = 73 + 13 + these 3.
 */
describe("VRF-10 (v65) -- R-39: every Derivation-tab line VRF-10 adds or changes fires from the panel's entry point; THE VRF GUARD", () => {
  type A = { discipline: string; items: Array<Omit<RateMasterItem, "discipline"> & { brand?: string | null }>; category_configs: RateCategoryConfig[] };
  type V = NonNullable<ItemListSuggestion["itemList"]>;
  const rd = (n: string) => readJsonFixture<A>(new URL(`../../../../../nirmaan_stack/services/boq_rate_master/data/${n}`, import.meta.url));
  const A65 = rd("rate_master_hvac_all_v65.json");
  const A64 = rd("rate_master_hvac_all_v64.json");
  const E72 = rd("rate_master_electrical_all_v72.json");
  const VRF = "hvac_vrf";
  const asItems = (a: A) => a.items.map((it) => ({ ...it, discipline: a.discipline, attributes: it.brand ? { ...it.attributes, brand: it.brand } : { ...it.attributes } } as RateMasterItem));
  const rules = (a: A) => itemListRuleOrder(a.category_configs.find((c) => c.category_id === VRF), asItems(a));
  type R = { items: Array<Record<string, string | null>>; unit?: string; text?: string; headings?: string[]; ancestorNotes?: string[] };
  const on = (a: A) => (r: R): V => {
    const items = [...asItems(a), ...asItems(E72)];
    const cfgs = new Map<string, RateCategoryConfig>([...a.category_configs, ...E72.category_configs].map((c) => [c.category_id, c]));
    const results = [{ excel_row: 9, description: r.text ?? "", category_id: VRF, attributes: {}, items: r.items.map((x) => ({ attributes: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, { value: v, confidence: 0.9 }])) })) }];
    const h = makePricingSheetHelper({ configsByCategory: cfgs, items, extractionByRow: buildExtractionByRow(results as never) });
    return (h.compute({ excelRow: 9, description: r.text ?? "", nodeType: "Line Item", category: VRF, discipline: "HVAC", rateKinds: ["supply_rate", "install_rate", "combined_rate"],
      unit: r.unit ?? "Nos", quantity: 1, headings: r.headings ?? [], ownNotes: [], headingNotes: [], ...(r.ancestorNotes ? { ancestorNotes: r.ancestorNotes } : {}) } as never, {}) as unknown as ItemListSuggestion).itemList!;
  };
  const v65 = on(A65);
  const v64 = on(A64);
  const VT = {
    dflt: "Supply + installation is the default scope",
    frame: "An MS frame / stand row is supply + installation",
    both: "Installation said higher up beats any supply-type wording: the note quotes both",
  };
  const hw = (s: typeof v65) => s({ items: [{ item: "Hi-Wall", capacity: "1.0 TR", scope: "Supply only" }], text: "1.0 TR - Hi-Wall", headings: ["Supply of HI-WALL TYPE indoor unit"] });
  const fr = (s: typeof v65) => s({ items: [{ item: "MS Angle Base Frame Structure", scope: "Supply only" }], unit: "Kg", text: "Supply & providing of MS stand for VRV ODU" });
  const f2 = (s: typeof v65) => s({ items: [{ item: "Outdoor Unit", capacity: "14 HP", scope: "Supply + installation" }], text: "38 HP ODU", headings: ["VRV HIGHSIDE", "OUTDOOR UNITS"],
    ancestorNotes: ["Supply, port clearance, transport of units", "Supply, Installation, testing & commissioning of the VRV system"] });
  const nu = (s: typeof v65) => s({ items: [{ item: "Outdoor Unit", capacity: "16 HP" }], unit: "", text: "16 hp" });
  const CASES: Array<{ rule: string; kind: "pos" | "neg"; ok: () => boolean }> = [
    { rule: VT.dflt, kind: "pos", ok: () => hw(v65).scope?.value === "Supply + installation" && /owner F6/.test(hw(v65).scope?.note ?? "") },
    { rule: VT.dflt, kind: "neg", ok: () => hw(v64).scope?.value === "Supply only" },
    { rule: VT.frame, kind: "pos", ok: () => fr(v65).totals?.install_rate === 40 },
    { rule: VT.frame, kind: "neg", ok: () => fr(v64).totals?.install_rate === 0 },
    { rule: VT.both, kind: "pos", ok: () => /owner F2/.test(f2(v65).scope?.note ?? "") },
    { rule: VT.both, kind: "neg", ok: () => !f2(v64).scope?.note },
    { rule: "unit", kind: "pos", ok: () => nu(v65).reason === "no unit on this row" },
    { rule: "unit", kind: "neg", ok: () => nu(v64).rowPriced === true },
  ];
  it("every VRF-10 line fires on v65 and not on v64 (positive AND negative)", () => {
    expect(CASES.filter((c) => !c.ok()).map((c) => `${c.rule} (${c.kind})`)).toEqual([]);
    expect(CASES).toHaveLength(8);
  });
  it("THE VRF GUARD: v65 = 86 + the 3 VRF-10 lines, last; the unit line says a blank unit refuses on v65 only", () => {
    const t65 = rules(A65).map((l) => l.title);
    expect(t65).toHaveLength(89);
    expect(t65.slice(86)).toEqual(Object.values(VT));
    const unitLine = (a: A) => rules(a).find((l) => l.title === "The row's unit decides which kind of rate applies")?.detail ?? "";
    expect(unitLine(A65)).toContain("a row with no unit is refused 'no unit on this row'");
    expect(unitLine(A64)).toContain("a row with no unit, or a rate-only unit (R/O, QRO), is priced in the item's own unit");
  });
});
