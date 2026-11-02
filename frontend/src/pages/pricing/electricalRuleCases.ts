/**
 * ELR-4c (owner R-39, standing block 39, 2026-10-08 "yes approved"; the P6 answer 2026-10-30 "Q6 a") -- ONE NAMED CASE PER
 * ELECTRICAL DERIVATION LINE, THROUGH THE PANEL'S ENTRY POINT, AND ONE CALCULATOR = PANEL CASE PER LINE.
 *
 * R-39: (1) a rule is "done" only when tested from the panel's entry point (`makePricingSheetHelper(...).compute`), not only
 * in the inner pricer; (3) each rule keeps one permanent calculator = panel case. The HVAC item-list categories have had
 * this since 12d-8 (`ruleReachability.test.ts`, `calculatorPanelParity.test.ts`); ELR-R2 G6 found 0 Electrical lines with
 * a case. These are the Electrical twins, pinned the same way: the set of lines the cases name must EQUAL the set
 * `attributeRuleOrder` generates from the LIVE asset's configs, so a new line without a case -- or a case naming a dead
 * line -- fails (`electricalGuardDiff`).
 *
 * THE CASES (one positive and one negative per line, plus the named extras): each runs a row through the panel's entry
 * point on the live asset and asserts the figures exactly (today's product output) and the line's OWN effect on screen --
 * a working-bill line, a field note, a computed value, the amber default mark or the refusal.
 *   stored      a real stored row (the replay dump, `__fixtures__/electricalRuleRows.json`, its cells verbatim), or that
 *               row with one answer changed
 *   synthetic   no stored row reaches the line (P3): a stored row with the answers that reach it, or a typed cell
 *   model-read  the line says how the AI READS the BoQ (owner Q6 a): the case feeds the AI's answer through the panel and
 *               asserts it prices on it and shows it; its partner gives the other answer. The reading itself stays tied to
 *               its config rule by the ELR-4a / 4b tie tests and to the Python extraction tests. Nothing is excluded.
 *
 * The figures were measured on the live asset (Electrical, v70 at ELR-4c, v71 at ELR-4d, v72 at ELR-5); a mint that moves one fails here by name.
 */
import type { RateCategoryConfig, RateMasterItem } from "./rate-master/rateMasterTypes";
import { attributeRuleOrder } from "./rate-master/itemListRuleOrder";
import { makePricingSheetHelper } from "@/pages/boq-wizard/rate-helper/pricingSheetHelper";
import { attrNoteText, isSuggestion, type ExtractedAttr, type HelperResult } from "@/pages/boq-wizard/rate-helper/rateHelperTypes";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { PANEL_ROW, panelCtx, readJsonFixture, type ParityCase } from "./calculatorPanelParity.harness";

/** Located by path, not by `import.meta.url`, so the jsdom tests can load it too (jsdom's module URL is not a file URL). */
const readJson = <T,>(...parts: string[]): T => readJsonFixture<T>(pathToFileURL(path.resolve(__dirname, ...parts)));

export interface ElectricalAsset {
  discipline: string;
  items: Array<Omit<RateMasterItem, "discipline">>;
  category_configs: RateCategoryConfig[];
}
/** The live Electrical asset (v72, ELR-5; v71 at ELR-4d; v70 at ELR-4c). */
export const ELECTRICAL_ASSET = readJson<ElectricalAsset>("../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v72.json");
export const ELECTRICAL_CONFIGS = new Map<string, RateCategoryConfig>(ELECTRICAL_ASSET.category_configs.map((c) => [c.category_id, c]));
export const ELECTRICAL_ITEMS: RateMasterItem[] = ELECTRICAL_ASSET.items.map((it) => ({ ...it, discipline: ELECTRICAL_ASSET.discipline } as RateMasterItem));

/** A stored row as the replay dump holds it: the cells verbatim (value, confidence, the defaulted mark, a pole-ladder stamp). */
export interface StoredRow { cat: string; unit: string; desc: string; headings: string[]; cells: Record<string, ExtractedAttr> }
export const ELECTRICAL_RULE_ROWS = readJson<Record<string, StoredRow>>("__fixtures__", "electricalRuleRows.json");

export type CaseHow = "stored" | "synthetic" | "model-read";
export interface ElectricalRuleCase {
  id: string;
  cat: string;
  /** the Derivation line this case fires -- its exact generated TITLE (the guard matches on it) */
  line: string;
  /** pos: the line's effect shows; neg: the case the line excludes, or the other answer */
  kind: "pos" | "neg";
  how: CaseHow;
  /** the stored row (a key of `ELECTRICAL_RULE_ROWS`) */
  row: string;
  /** answers changed on that row, as a pricer or the AI would give them (null = left blank) */
  set?: Record<string, string | number | null>;
  /** whole cells replaced (a stamp only the server writes, such as the pole ladder's) */
  cell?: Record<string, ExtractedAttr>;
  desc?: string;
  /** [supply, install] exactly (null = that figure is absent, e.g. LMS has no install), or null when the row does not price */
  fig: [number | null, number | null] | null;
  /** every string must be on screen (`panelText`); none of `not` may be */
  re: string[];
  not?: string[];
}

/** The row's cells after the case's changes -- what the panel's extraction map holds. */
export function caseCells(c: ElectricalRuleCase): Record<string, ExtractedAttr> {
  const cells: Record<string, ExtractedAttr> = { ...ELECTRICAL_RULE_ROWS[c.row].cells };
  for (const [k, v] of Object.entries(c.set ?? {})) cells[k] = { value: v, confidence: 1 };
  for (const [k, v] of Object.entries(c.cell ?? {})) cells[k] = v;
  return cells;
}

/** The same row as the parity driver takes it (values only; a key present with null stays distinct from an absent key). */
export function parityCaseOf(c: ElectricalRuleCase): ParityCase {
  const r = ELECTRICAL_RULE_ROWS[c.row];
  const attrs: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(caseCells(c))) attrs[k] = v?.value ?? null;
  return { cat: c.cat, unit: r.unit, desc: c.desc ?? r.desc, attrs, headings: r.headings };
}

/** The panel's entry point: `makePricingSheetHelper(...).compute`, with the row's stored cells in the extraction map. */
export function panelResult(c: ElectricalRuleCase, configs: Map<string, RateCategoryConfig> = ELECTRICAL_CONFIGS): HelperResult {
  const pc = parityCaseOf(c);
  const helper = makePricingSheetHelper({
    configsByCategory: configs, items: ELECTRICAL_ITEMS,
    extractionByRow: new Map([[PANEL_ROW, { excelRow: PANEL_ROW, description: pc.desc, attributes: caseCells(c) }]]),
  });
  return helper.compute(panelCtx(pc));
}

/** Everything the panel shows for a result, one string per thing: "<field>=<value>", "<field>~<computed value>",
 *  "<field>:default" (the amber mark), "<field>: <note>", each derivation line, each working-bill line as "[<block>] <line>",
 *  and a refusal's reason. */
export function panelText(r: HelperResult): string[] {
  if (!isSuggestion(r)) return [r.reason];
  const out: string[] = [];
  for (const a of r.workings.attributes) {
    out.push(`${a.id}=${a.value}`);
    if (a.derivedValue !== undefined) out.push(`${a.id}~${a.derivedValue}`);
    if (a.defaulted) out.push(`${a.id}:default`);
    for (const n of a.notes ?? []) out.push(`${a.id}: ${attrNoteText(n)}`);
  }
  out.push(...r.workings.derivation);
  for (const g of r.workings.sections ?? []) {
    out.push(`[${g.label}] `);
    for (const m of g.matchedRows ?? []) out.push(`[${g.label}] ${m}`);
  }
  return out;
}

/** [supply, install] of a result (null = that figure is absent), or null when it does not price. A -0 (a row with no part
 *  matched, priced at 0 today) reads as the 0 the screen shows. */
export function figuresOf(r: HelperResult): [number | null, number | null] | null {
  if (!isSuggestion(r) || Object.keys(r.values).length === 0) return null;
  const f = (v: number | undefined) => (v === undefined ? null : v === 0 ? 0 : v);
  return [f(r.values.supply_rate), f(r.values.install_rate)];
}

/** Every Electrical category with a rules list, and its lines' titles, from `attributeRuleOrder` -- the Derivation tab's builder. */
export function electricalGeneratedLines(configs: Map<string, RateCategoryConfig> = ELECTRICAL_CONFIGS): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [cat, cfg] of configs) {
    const lines = attributeRuleOrder(cfg, ELECTRICAL_ITEMS);
    if (lines.length) out[cat] = lines.map((l) => l.title);
  }
  return out;
}

/** THE GUARD, PURE: per category, the generated lines no case names (uncovered) and the named lines not generated (dead).
 *  Only categories with a gap appear; {} = every line has a case and every case names a live line. */
export function electricalGuardDiff(generated: Record<string, string[]>, cases: readonly ElectricalRuleCase[]): Record<string, { uncovered: string[]; dead: string[] }> {
  const out: Record<string, { uncovered: string[]; dead: string[] }> = {};
  const cats = new Set([...Object.keys(generated), ...cases.map((c) => c.cat)]);
  for (const cat of cats) {
    const gen = new Set(generated[cat] ?? []);
    const named = new Set(cases.filter((c) => c.cat === cat).map((c) => c.line));
    const uncovered = [...gen].filter((t) => !named.has(t));
    const dead = [...named].filter((t) => !gen.has(t));
    if (uncovered.length || dead.length) out[cat] = { uncovered, dead };
  }
  return out;
}

/** The 17 lines that say how the AI READS the BoQ (P3; owner Q6 a: model-read cases, nothing excluded), by category. */
export const MODEL_READ_LINES: Readonly<Record<string, readonly string[]>> = {
  point_wiring: ["The wires", "Three conductors", "Points covered", "Switch", "Back box and colour"],
  switches_sockets: ["Switch", "Back box and colour"],
  wiring_cabling: ["Insulation: the BoQ's answer", "Runs and cores: as the BoQ states them"],
  db_switchgear: ["The DB is split into its parts", "Board size", "Breakers", "RCCB / RCBO and ELCB", "Outgoings per phase"],
  industrial_sockets: ["Enclosure"],
  cabletray_raceway: ["Material", "Where unstated"],
};

// prettier-ignore
export const ELECTRICAL_RULE_CASES: readonly ElectricalRuleCase[] = [
  { id: "PW1+", cat: "point_wiring", line: "The wires", kind: "pos", how: "model-read", row: "BOQ-26-00174|Electrical |251", fig: [1775, 358], re: ["wire1_runs=3", "[Point Wiring — Supply] Wire 1: COPPER UNARMOURED 1 1.5 x 15 = 1,500"] },
  // ELR-4d (owner R-3C-CALC) INVERTED: WAS set wire1_runs 1, fig [659, 331], "wire1_runs=1", "Wire 1: ... x 15 = 510" -- a typed count below three is now raised
  { id: "PW1-", cat: "point_wiring", line: "The wires", kind: "neg", how: "model-read", row: "BOQ-26-00174|Electrical |251", set: {"wire1_runs": 4}, fig: [2396, 685], re: ["wire1_runs=4", "[Point Wiring — Supply] Wire 1: COPPER UNARMOURED 1 1.5 x 15 = 1,995"] },
  { id: "PW2+", cat: "point_wiring", line: "Three conductors", kind: "pos", how: "model-read", row: "BOQ-26-00174|Electrical |251", fig: [1775, 358], re: ["wire1_runs=3", "wire1_core=1", "Wire 1: COPPER UNARMOURED 1 1.5 x 15 = 1,500"] },
  // ELR-4d (owner R-3C-CALC) INVERTED: WAS set wire1_runs 1 + wire1_core 1, fig [659, 331] priced as typed; that entry is now PW2t, and the excluded case is a count stating more
  { id: "PW2-", cat: "point_wiring", line: "Three conductors", kind: "neg", how: "model-read", row: "BOQ-26-00174|Electrical |251", set: {"wire1_runs": 4, "wire1_core": 1}, fig: [2396, 685], re: ["wire1_runs=4", "wire1_core=1"], not: ["wire1_runs: Raised to three conductors.", "wire1_runs~4"] },
  { id: "PW2t", cat: "point_wiring", line: "Three conductors", kind: "pos", how: "synthetic", row: "BOQ-26-00174|Electrical |251", set: {"wire1_runs": 1, "wire1_core": 1}, fig: [1775, 358], re: ["wire1_runs=3", "wire1_runs~3", "wire1_runs: Raised to three conductors.", "Wire 1: COPPER UNARMOURED 1 1.5 x 15 = 1,500"] },
  { id: "PW3+", cat: "point_wiring", line: "Points covered", kind: "pos", how: "model-read", row: "BOQ-26-00174|Electrical |251", fig: [1775, 358], re: ["points=1", "circuit_length_m: Worked out: 15 + (1 - 1) x 5 = 15 m"] },
  { id: "PW3-", cat: "point_wiring", line: "Points covered", kind: "neg", how: "model-read", row: "BOQ-26-00174|Electrical |251", set: {"points": 3}, fig: [2943, 594], re: ["points=3", "circuit_length_m: Worked out: 15 + (3 - 1) x 5 = 25 m"] },
  { id: "PW4+", cat: "point_wiring", line: "Switch", kind: "pos", how: "model-read", row: "BOQ-26-00190|Sheet1|170", fig: [4877, 629.8], re: ["[Point Wiring — Supply] Switch: Switch 10A 1 WAY SWITCH - With Indicator White x 1 = 124"] },
  { id: "PW4-", cat: "point_wiring", line: "Switch", kind: "neg", how: "model-read", row: "BOQ-26-00190|Sheet1|170", set: {"switch_item": "None"}, fig: [4779, 611], re: ["switch_item=None"], not: ["Switch: Switch"] },
  { id: "PW5+", cat: "point_wiring", line: "Quantities left blank", kind: "pos", how: "stored", row: "BOQ-26-00190|Sheet1|170", set: {"plate_item": null}, fig: [4877, 629.8], re: ["plate_item~3M", "[Point Wiring — Supply] Frame/Face plate: Grid and Face Plates 3M White x 1 = 84"] },
  { id: "PW5-", cat: "point_wiring", line: "Quantities left blank", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |251", set: {"plate_item": null, "plate_qty": null}, fig: null, re: ["Missing to price: Plate qty"] },
  { id: "PW6+", cat: "point_wiring", line: "Back box and colour", kind: "pos", how: "model-read", row: "BOQ-26-00174|Electrical |251", fig: [1775, 358], re: ["back_box:default", "colour:default", "[Point Wiring — Supply] Back box: Back Box 3M x 1 = 65"] },
  { id: "PW6-", cat: "point_wiring", line: "Back box and colour", kind: "neg", how: "model-read", row: "BOQ-26-00174|Electrical |251", set: {"back_box": "No"}, fig: [1710, 345], re: ["back_box=No", "[Point Wiring — Supply] Back box: Back Box 3M x 0 = 0"] },
  { id: "PW7+", cat: "point_wiring", line: "Circuit length", kind: "pos", how: "stored", row: "BOQ-26-00174|Electrical |251", set: {"points": 3}, fig: [2943, 594], re: ["circuit_length_m: Worked out: 15 + (3 - 1) x 5 = 25 m", "Wire 1: COPPER UNARMOURED 1 1.5 x 25 = 2,500"] },
  { id: "PW7-", cat: "point_wiring", line: "Circuit length", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |251", set: {"circuit_length_m": 12}, fig: [1433, 289], re: ["circuit_length_m=12", "circuit_length_m: As the row states", "Wire 1: COPPER UNARMOURED 1 1.5 x 12 = 1,200"], not: ["Worked out"] },
  { id: "PW7s", cat: "point_wiring", line: "Circuit length", kind: "pos", how: "stored", row: "BOQ-26-00241|BOQ | Electircal|145", fig: [719, 151], re: ["circuit_length_m: Point type Secondary read as 5", "x 5 = 570"] },
  { id: "PW7p", cat: "point_wiring", line: "Circuit length", kind: "pos", how: "stored", row: "BOQ-26-00241|BOQ | Electircal|146", fig: [1985, 418], re: ["circuit_length_m: Point type Primary read as 15"] },
  { id: "PW7n", cat: "point_wiring", line: "Circuit length", kind: "pos", how: "synthetic", row: "BOQ-26-00241|BOQ | Electircal|145", set: {"circuit_length_m": 15}, fig: [1985, 418], re: ["circuit_length_m=15", "circuit_length_m: As the row states"], not: ["Secondary read as"] },
  { id: "PW8+", cat: "point_wiring", line: "Conduit included", kind: "pos", how: "stored", row: "BOQ-26-00174|Electrical |251", set: {"conduit_handoff": "Yes"}, fig: [1565, 313], re: ["conduit_type~None"], not: ["Conduit: PVC"] },
  { id: "PW8-", cat: "point_wiring", line: "Conduit included", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |251", fig: [1775, 358], re: ["[Point Wiring — Supply] Conduit: PVC 25 x 5 = 210"] },
  { id: "PW8o", cat: "point_wiring", line: "Conduit included", kind: "neg", how: "synthetic", row: "BOQ-26-00174|Electrical |251", set: {"conduit_handoff": "Yes", "other_conduit": "Normal"}, fig: [1775, 358], re: ["[Point Wiring — Supply] Conduit: PVC 25 x 5 = 210"] },
  { id: "PW8e", cat: "point_wiring", line: "Conduit included", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |251", set: {"conduit_handoff": "Either"}, fig: [1775, 358], re: ["[Point Wiring — Supply] Conduit: PVC 25 x 5 = 210"] },
  { id: "PW8x", cat: "point_wiring", line: "Conduit included", kind: "pos", how: "stored", row: "BOQ-26-00348|Ele-BOQ|19", fig: [1879, 394.8], re: ["conduit_type~None"], not: ["Conduit: "] },
  { id: "PW9+", cat: "point_wiring", line: "Conduit type", kind: "pos", how: "stored", row: "BOQ-26-00174|Electrical |251", set: {"conduit_type": null}, fig: [1775, 358], re: ["conduit_type: Not stated - the rule's default: PVC", "Conduit: PVC 25 x 5 = 210"] },
  { id: "PW9-", cat: "point_wiring", line: "Conduit type", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |251", set: {"conduit_handoff": "Yes", "conduit_type": null}, fig: [1565, 313], re: ["conduit_type~None"], not: ["Conduit: PVC"] },
  { id: "PW10+", cat: "point_wiring", line: "Circuit wiring", kind: "pos", how: "stored", row: "BOQ-26-00245|ELECTRICAL BOQ|221", fig: [18020, 1048], re: ["circuit_wire_length_m: Not stated - the rule's default: 30", "[Point Wiring — Supply] Circuit wire 1: COPPER UNARMOURED 1 6 x 30 = 11,550"] },
  { id: "PW10-", cat: "point_wiring", line: "Circuit wiring", kind: "neg", how: "stored", row: "BOQ-26-00245|ELECTRICAL BOQ|221", set: {"circuit_wire_included": "No"}, fig: [6470, 448], re: ["circuit_wire_length_m: Circuit wiring included No read as 0", "Circuit wire 1: COPPER UNARMOURED 1 6 x 0 = 0"] },
  { id: "PW10s", cat: "point_wiring", line: "Circuit wiring", kind: "pos", how: "stored", row: "BOQ-26-00245|ELECTRICAL BOQ|223", fig: [2627, 187], re: ["circuit_wire_length_m~30", "Circuit wire 1: COPPER UNARMOURED 1 6 x 0 = 0"] },
  { id: "PW11+", cat: "point_wiring", line: "Conduit size and length", kind: "pos", how: "stored", row: "BOQ-26-00232|Internal  office|87", fig: [6425, 628], re: ["[Point Wiring — Supply] Conduit: MS 32 x 15 = 1,260"] },
  { id: "PW11-", cat: "point_wiring", line: "Conduit size and length", kind: "neg", how: "synthetic", row: "BOQ-26-00174|Electrical |251", set: {"wire1_runs": 40}, fig: null, re: ["wire1_runs=40", "No Point Wiring — Supply rate row matches"] },
  { id: "PW12+", cat: "point_wiring", line: "Plate, back box and blanks", kind: "pos", how: "stored", row: "BOQ-26-00190|Sheet1|167", fig: [6274, 913.8], re: ["plate_item: 8M holds 8 modules; contents occupy 14 — using 16M.", "Blank plate: Switch 1M Blanker White x 2 = 52", "Back box: Back Box 18M x 1 = 201"] },
  { id: "PW12-", cat: "point_wiring", line: "Plate, back box and blanks", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |251", fig: [1775, 358], re: ["Back box: Back Box 3M x 1 = 65"], not: ["Frame/Face plate:", "Blank plate:"] },
  { id: "PW13+", cat: "point_wiring", line: "Supply", kind: "pos", how: "stored", row: "BOQ-26-00174|Electrical |251", fig: [1775, 358], re: ["[Point Wiring — Supply] Wire 1: COPPER UNARMOURED 1 1.5 x 15 = 1,500", "[Point Wiring — Supply] Conduit: PVC 25 x 5 = 210", "[Point Wiring — Supply] Back box: Back Box 3M x 1 = 65"] },
  { id: "PW13-", cat: "point_wiring", line: "Supply", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |251", set: {"conduit_handoff": "Yes"}, fig: [1565, 313], re: ["conduit_type~None"], not: ["Conduit: PVC"] },
  { id: "PW14+", cat: "point_wiring", line: "Install", kind: "pos", how: "stored", row: "BOQ-26-00174|Electrical |251", fig: [1775, 358], re: ["[Point Wiring — Install] Wire 1: COPPER UNARMOURED 1 1.5 x 15 = 300", "[Point Wiring — Install] Conduit: PVC 25 x 5 = 45", "[Point Wiring — Install] Back box: Back Box 3M x 1 = 13"] },
  { id: "PW14-", cat: "point_wiring", line: "Install", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |251", set: {"back_box": "No"}, fig: [1710, 345], re: ["[Point Wiring — Install] Back box: Back Box 3M x 0 = 0"] },
  { id: "SS1+", cat: "switches_sockets", line: "Switch", kind: "pos", how: "model-read", row: "BOQ-26-00183|Electrical Works|25", fig: [320, 70], re: ["Switch: Switch 10A 1 WAY SWITCH White x 1 = 162"] },
  { id: "SS1-", cat: "switches_sockets", line: "Switch", kind: "neg", how: "model-read", row: "BOQ-26-00183|Electrical Works|25", set: {"switch_item": "None"}, fig: [230, 50], re: ["switch_item=None"], not: ["Switch: Switch"] },
  { id: "SS2+", cat: "switches_sockets", line: "Back box size (a bare box)", kind: "pos", how: "stored", row: "BOQ-26-00174|Electrical |240", fig: [70, 20], re: ["box_item: No module size stated — assumed 3M. Check it.", "Back box: Back Box 3M x 1 = 178"] },
  { id: "SS2-", cat: "switches_sockets", line: "Back box size (a bare box)", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |240", set: {"box_modules_stated": 8}, fig: [140, 30], re: ["Back box: Back Box 8M x 1 = 362"], not: ["assumed"] },
  { id: "SS3+", cat: "switches_sockets", line: "Quantities left blank", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|12", set: {"plate_item": null}, fig: [170, 40], re: ["plate_item~1M", "Frame/Face plate: Grid and Face Plates 1M White x 1 = 182"] },
  { id: "SS3-", cat: "switches_sockets", line: "Quantities left blank", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|12", set: {"switch_item": "None", "plate_item": null, "plate_qty": null}, fig: null, re: ["Missing to price: Plate qty"] },
  { id: "SS4+", cat: "switches_sockets", line: "Back box and colour", kind: "pos", how: "model-read", row: "BOQ-26-00183|Electrical Works|12", fig: [170, 40], re: ["back_box:default", "colour:default", "Back box: Back Box 1M x 1 = 121"] },
  { id: "SS4-", cat: "switches_sockets", line: "Back box and colour", kind: "neg", how: "model-read", row: "BOQ-26-00183|Electrical Works|12", set: {"back_box": "No"}, fig: [130, 30], re: ["back_box=No", "Back box: Back Box 1M x 0 = 0"] },
  { id: "SS5+", cat: "switches_sockets", line: "Plate, back box and blanks", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|28", fig: [580, 120], re: ["Blank plate: Switch 1M Blanker White x 1 = 70", "plate_item: The smallest that holds the contents (5 modules)"] },
  { id: "SS5-", cat: "switches_sockets", line: "Plate, back box and blanks", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|12", fig: [170, 40], re: ["blank_qty: No spare modules on this plate; 1 will not fit — pricing 0."], not: ["Blank plate: Switch"] },
  // ELR-5 (owner "Q1 a, Q2 c, Q3 b"): line 5's refusal. SS5z WAS Rs 0 on v71; SS5y, a blanker named alone, WAS Rs 0 too; SS5x, the box on, keeps its figure
  { id: "SS5z", cat: "switches_sockets", line: "Plate, back box and blanks", kind: "pos", how: "stored", row: "BOQ-26-00298|ELECTRICAL BOQ |603", fig: null, re: ["No part of this row matched the catalogue - price it by hand."], not: ["Back box: Back Box"] },
  { id: "SS5y", cat: "switches_sockets", line: "Plate, back box and blanks", kind: "pos", how: "stored", row: "BOQ-26-00102|Electrical|112", fig: null, re: ["No part of this row matched the catalogue - price it by hand.", "blank_item=1M Blanker"] },
  { id: "SS5x", cat: "switches_sockets", line: "Plate, back box and blanks", kind: "neg", how: "stored", row: "BOQ-26-00298|ELECTRICAL BOQ |603", set: {"back_box": "Yes"}, fig: [70, 20], re: ["Back box: Back Box 3M x 1 = 178"], not: ["No part of this row matched"] },
  { id: "SS6+", cat: "switches_sockets", line: "Supply", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|12", fig: [170, 40], re: ["Switch: Switch 10A 1 WAY SWITCH White x 1 = 162", "Frame/Face plate: Grid and Face Plates 1M White x 1 = 182", "Back box: Back Box 1M x 1 = 121"] },
  { id: "SS6-", cat: "switches_sockets", line: "Supply", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|12", set: {"switch_qty": 2}, fig: [230, 50], re: ["Switch: Switch 10A 1 WAY SWITCH White x 2 = 324"] },
  { id: "SS7+", cat: "switches_sockets", line: "Install", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|12", fig: [170, 40], re: ["Switch & socket installation share = 20%"] },
  { id: "SS7-", cat: "switches_sockets", line: "Install", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|12", set: {"switch_qty": 2}, fig: [230, 50], re: ["Switch: Switch 10A 1 WAY SWITCH White x 2 = 324"] },
  { id: "SS4s", cat: "switches_sockets", line: "Back box and colour", kind: "pos", how: "model-read", row: "BOQ-26-00183|Electrical Works|12", set: {"socket4_item": "6A/16A 3-Pin Socket", "socket4_qty": 1}, fig: [380, 80], re: ["Socket 4: Socket 6A/16A 3-Pin Socket White x 1 = 464"] },
  { id: "PB1+", cat: "popup_boxes", line: "Includes modules", kind: "pos", how: "stored", row: "BOQ-26-00139|RFQ|732", set: {"has_modules": "No"}, fig: [7200, 800], re: ["has_modules=No"], not: ["Socket 1: Socket"] },
  { id: "PB1-", cat: "popup_boxes", line: "Includes modules", kind: "neg", how: "stored", row: "BOQ-26-00139|RFQ|732", fig: [7800, 920], re: ["has_modules=Yes", "Socket 1: Socket 6A/16A 3-Pin Socket White x 2 = 928"] },
  { id: "PB1b", cat: "popup_boxes", line: "Includes modules", kind: "neg", how: "stored", row: "BOQ-26-00139|RFQ|732", set: {"has_modules": null}, fig: null, re: ["Missing to price: Includes modules"] },
  { id: "PB2+", cat: "popup_boxes", line: "The box", kind: "pos", how: "stored", row: "BOQ-26-00139|RFQ|732", fig: [7800, 920], re: ["module_count=8"] },
  { id: "PB2-", cat: "popup_boxes", line: "The box", kind: "neg", how: "stored", row: "BOQ-26-00139|RFQ|732", set: {"module_count": 12}, fig: [11400, 1320], re: ["module_count=12"] },
  { id: "PB3+", cat: "popup_boxes", line: "Quantities left blank", kind: "pos", how: "stored", row: "BOQ-26-00139|RFQ|732", set: {"plate_item": null}, fig: [7640, 890], re: ["plate_item~4M", "plate_item: The smallest that holds the contents (4 modules)", "Frame/Face plate: Grid and Face Plates 4M White x 1 = 265"] },
  { id: "PB3-", cat: "popup_boxes", line: "Quantities left blank", kind: "neg", how: "stored", row: "BOQ-26-00139|RFQ|732", set: {"socket1_item": "None", "plate_item": null, "plate_qty": null}, fig: null, re: ["Missing to price: Plate qty"] },
  { id: "PB4+", cat: "popup_boxes", line: "The plate and blanks", kind: "pos", how: "stored", row: "BOQ-26-00139|RFQ|732", fig: [7800, 920], re: ["Blank plate: Switch 1M Blanker White x 4 = 280"] },
  { id: "PB4-", cat: "popup_boxes", line: "The plate and blanks", kind: "neg", how: "stored", row: "BOQ-26-00139|RFQ|732", set: {"socket1_qty": 4}, fig: [8040, 970], re: ["Socket 1: Socket 6A/16A 3-Pin Socket White x 4 = 1,856"], not: ["Blank plate: Switch"] },
  { id: "PB5+", cat: "popup_boxes", line: "The modules' price", kind: "pos", how: "stored", row: "BOQ-26-00139|RFQ|732", fig: [7800, 920], re: ["Socket 1: Socket 6A/16A 3-Pin Socket White x 2 = 928", "Switch & socket discount = 75%"] },
  { id: "PB5-", cat: "popup_boxes", line: "The modules' price", kind: "neg", how: "stored", row: "BOQ-26-00139|RFQ|732", set: {"has_modules": "No"}, fig: [7200, 800], re: ["has_modules=No"], not: ["Socket 1: Socket"] },
  { id: "PB6+", cat: "popup_boxes", line: "Totals", kind: "pos", how: "stored", row: "BOQ-26-00139|RFQ|732", fig: [7800, 920], re: ["Socket 1: Socket 6A/16A 3-Pin Socket White x 2 = 928"] },
  { id: "PB6-", cat: "popup_boxes", line: "Totals", kind: "neg", how: "stored", row: "BOQ-26-00139|RFQ|732", set: {"has_modules": "No"}, fig: [7200, 800], re: ["has_modules=No"], not: ["Socket 1: Socket"] },
  { id: "PB3s", cat: "popup_boxes", line: "Quantities left blank", kind: "pos", how: "synthetic", row: "BOQ-26-00139|RFQ|732", set: {"socket3_item": "6A/16A 3-Pin Socket", "socket3_qty": 1}, fig: [7920, 950], re: ["Socket 3: Socket 6A/16A 3-Pin Socket White x 1 = 464"] },
  { id: "PB4s", cat: "popup_boxes", line: "The plate and blanks", kind: "pos", how: "synthetic", row: "BOQ-26-00139|RFQ|732", set: {"socket4_item": "6A/16A 3-Pin Socket", "socket4_qty": 1}, fig: [7920, 950], re: ["Socket 4: Socket 6A/16A 3-Pin Socket White x 1 = 464"] },
  { id: "W1+", cat: "wiring_cabling", line: "Every row shows both blocks, Cable and Termination", kind: "pos", how: "stored", row: "BOQ-26-00190|Sheet1|69", fig: [2120, 530], re: ["[Cable — per Mtr] ", "[Termination — per Set] "] },
  { id: "W1-", cat: "wiring_cabling", line: "Every row shows both blocks, Cable and Termination", kind: "neg", how: "stored", row: "BOQ-26-00190|Sheet1|69", desc: "cable", fig: [1000, 90], re: ["[Cable — per Mtr] ", "[Termination — per Set] "] },
  { id: "W2+", cat: "wiring_cabling", line: "The cable and the termination are each matched in the catalogue", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|19", fig: [120, 24], re: ["Matched cable rate row for Material = COPPER, Insulation = UNARMOURED, Core = 3, Runs = 1, Thickness (sqmm) = 1.5."] },
  { id: "W2-", cat: "wiring_cabling", line: "The cable and the termination are each matched in the catalogue", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|19", set: {"thickness_sqmm": 7}, fig: null, re: ["No cable rate row matches Material = COPPER, Insulation = UNARMOURED, Core = 3, Thickness (sqmm) = 7."] },
  { id: "W3+", cat: "wiring_cabling", line: "Insulation: the BoQ's answer", kind: "pos", how: "model-read", row: "BOQ-26-00183|Electrical Works|19", fig: [120, 24], re: ["insulation=UNARMOURED", "insulation:default"] },
  { id: "W3-", cat: "wiring_cabling", line: "Insulation: the BoQ's answer", kind: "neg", how: "model-read", row: "BOQ-26-00183|Electrical Works|80", set: {"insulation": "UNARMOURED"}, fig: [350, 44], re: ["insulation=UNARMOURED"], not: ["insulation:default"] },
  { id: "W4+", cat: "wiring_cabling", line: "Runs and cores: as the BoQ states them", kind: "pos", how: "model-read", row: "BOQ-26-00183|Electrical Works|19", fig: [120, 24], re: ["runs=1", "runs:default"] },
  { id: "W4-", cat: "wiring_cabling", line: "Runs and cores: as the BoQ states them", kind: "neg", how: "model-read", row: "BOQ-26-00183|Electrical Works|19", set: {"runs": 2, "core": 1}, fig: [80, 20], re: ["runs=2", "core=1"], not: ["runs:default"] },
  { id: "W5+", cat: "wiring_cabling", line: "Conduit included: the BoQ's answer", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|19", fig: [120, 24], re: ["conduit_included: Not stated - the rule's default: No"] },
  { id: "W5-", cat: "wiring_cabling", line: "Conduit included: the BoQ's answer", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|19", set: {"conduit_included": "Yes", "conduit_type": "PVC"}, fig: [162, 34], re: ["conduit_included=Yes", "size_mm: Conduit type PVC read as 25"] },
  { id: "W6+", cat: "wiring_cabling", line: "Conduit type: the BoQ's answer, never assumed", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|19", set: {"conduit_included": "Yes", "conduit_type": "None"}, fig: [120, 24], re: ["conduit_included=Yes", "conduit_type=None"] },
  { id: "W6-", cat: "wiring_cabling", line: "Conduit type: the BoQ's answer, never assumed", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|19", set: {"conduit_included": "Yes", "conduit_type": "PVC"}, fig: [162, 34], re: ["conduit_type=PVC", "size_mm~25"] },
  { id: "W7+", cat: "wiring_cabling", line: "Conduit size (mm)", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|19", set: {"conduit_included": "Yes", "conduit_type": "PVC"}, fig: [162, 34], re: ["size_mm: Conduit type PVC read as 25"] },
  { id: "W7-", cat: "wiring_cabling", line: "Conduit size (mm)", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|19", set: {"conduit_included": "Yes", "conduit_type": "PVC", "size_mm": 32}, fig: [190, 44], re: ["size_mm=32", "size_mm: As the row states"] },
  { id: "W8+", cat: "wiring_cabling", line: "Cable supply per metre = list price x (1 - discount) x (1 + supply markup), rounded up to the next 10", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|80", fig: [200, 44], re: ["insulation=ARMOURED"] },
  { id: "W8-", cat: "wiring_cabling", line: "Cable supply per metre = list price x (1 - discount) x (1 + supply markup), rounded up to the next 10", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|80", set: {"insulation": "UNARMOURED"}, fig: [350, 44], re: ["insulation=UNARMOURED"] },
  { id: "W9+", cat: "wiring_cabling", line: "Parallel runs multiply the rounded supply", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|19", set: {"runs": 2}, fig: [240, 24], re: ["runs=2"] },
  { id: "W9-", cat: "wiring_cabling", line: "Parallel runs multiply the rounded supply", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|19", fig: [120, 24], re: ["runs=1"] },
  { id: "W10+", cat: "wiring_cabling", line: "Cable install per metre = install base x (1 + 'Cable installation markup'), rounded up to the rupee", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|19", set: {"runs": 4}, fig: [480, 48], re: ["runs=4"] },
  { id: "W10-", cat: "wiring_cabling", line: "Cable install per metre = install base x (1 + 'Cable installation markup'), rounded up to the rupee", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|19", set: {"runs": 3}, fig: [360, 24], re: ["runs=3"] },
  { id: "W11+", cat: "wiring_cabling", line: "The conduit is priced at its catalogue rate: list price x (1 - discount) x (1 + supply markup), from 'Conduit discount & supply markup', not rounded", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|19", set: {"conduit_included": "Yes", "conduit_type": "PVC", "size_mm": 25}, fig: [162, 34], re: ["conduit_included=Yes", "size_mm=25"] },
  { id: "W11-", cat: "wiring_cabling", line: "The conduit is priced at its catalogue rate: list price x (1 - discount) x (1 + supply markup), from 'Conduit discount & supply markup', not rounded", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|19", fig: [120, 24], re: ["conduit_included: Not stated - the rule's default: No"] },
  { id: "W12+", cat: "wiring_cabling", line: "The conduit install = its supply x 'Conduit installation share', rounded up to the next 10", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|19", set: {"conduit_included": "Yes", "conduit_type": "PVC", "size_mm": 25}, fig: [162, 34], re: ["conduit_included=Yes", "size_mm=25"] },
  { id: "W12-", cat: "wiring_cabling", line: "The conduit install = its supply x 'Conduit installation share', rounded up to the next 10", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|19", fig: [120, 24], re: ["conduit_included~No"] },
  { id: "W13+", cat: "wiring_cabling", line: "Supply = the cable supply + the conduit supply, rounded up to the rupee", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|19", set: {"conduit_included": "Yes", "conduit_type": "PVC", "size_mm": 25}, fig: [162, 34], re: ["conduit_included=Yes", "size_mm=25"] },
  { id: "W13-", cat: "wiring_cabling", line: "Supply = the cable supply + the conduit supply, rounded up to the rupee", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|19", fig: [120, 24], re: ["conduit_included~No"] },
  { id: "W14+", cat: "wiring_cabling", line: "Termination supply per set = the lug + the gland, each list price x (1 - discount) x (1 + supply markup), rounded up to the next 10, x runs", kind: "pos", how: "stored", row: "BOQ-26-00190|Sheet1|69", fig: [2120, 530], re: ["runs=2", "[Termination — per Set] "] },
  { id: "W14-", cat: "wiring_cabling", line: "Termination supply per set = the lug + the gland, each list price x (1 - discount) x (1 + supply markup), rounded up to the next 10, x runs", kind: "neg", how: "stored", row: "BOQ-26-00190|Sheet1|69", set: {"runs": 1}, fig: [1060, 270], re: ["runs=1", "[Termination — per Set] "] },
  { id: "W15+", cat: "wiring_cabling", line: "Termination install = its supply (already x runs) x 'Termination installation share', rounded up to the next 10", kind: "pos", how: "stored", row: "BOQ-26-00190|Sheet1|69", fig: [2120, 530], re: ["runs=2"] },
  { id: "W15-", cat: "wiring_cabling", line: "Termination install = its supply (already x runs) x 'Termination installation share', rounded up to the next 10", kind: "neg", how: "stored", row: "BOQ-26-00190|Sheet1|69", set: {"runs": 1}, fig: [1060, 270], re: ["runs=1"] },
  // ELR-4d (owner R-W6) INVERTED: WAS size 40, kind neg, fig null, "size_mm=40", "size_mm: As the row states", "No cable rate row matches" -- the fit takes it to 50; the refusal is now W11v, above the largest
  { id: "W11u", cat: "wiring_cabling", line: "The conduit is priced at its catalogue rate: list price x (1 - discount) x (1 + supply markup), from 'Conduit discount & supply markup', not rounded", kind: "pos", how: "synthetic", row: "BOQ-26-00183|Electrical Works|19", set: {"conduit_included": "Yes", "conduit_type": "PVC", "size_mm": 40}, fig: [260, 54], re: ["size_mm=40", "size_mm~50", "size_mm: The row states 40 — using 50, the next size stocked."] },
  { id: "W11v", cat: "wiring_cabling", line: "The conduit is priced at its catalogue rate: list price x (1 - discount) x (1 + supply markup), from 'Conduit discount & supply markup', not rounded", kind: "neg", how: "synthetic", row: "BOQ-26-00183|Electrical Works|19", set: {"conduit_included": "Yes", "conduit_type": "PVC", "size_mm": 63}, fig: null, re: ["size_mm=63", "No cable rate row matches"], not: ["size_mm~"] },
  { id: "DB1+", cat: "db_switchgear", line: "The DB is split into its parts", kind: "pos", how: "model-read", row: "BOQ-26-00183|Electrical Works|68", fig: [5930, 1190], re: ["DB (shell): SPN DB 8WAY x 1 = 3,597", "MCB 1: 40A RCCB 30mA (DP) Switchgear x 1 = 4,670", "MCB 2: 10A SP MCB D CURVE Switchgear x 6 = 3,696"] },
  { id: "DB1-", cat: "db_switchgear", line: "The DB is split into its parts", kind: "neg", how: "model-read", row: "BOQ-26-00183|Electrical Works|68", set: {"mcb2_item": "None", "mcb2_qty": null}, fig: [4100, 820], re: ["mcb2_item=None"], not: ["MCB 2:"] },
  { id: "DB2+", cat: "db_switchgear", line: "Board size", kind: "pos", how: "model-read", row: "BOQ-26-00183|Electrical Works|68", fig: [5930, 1190], re: ["DB (shell): SPN DB 8WAY x 1 = 3,597"] },
  { id: "DB2-", cat: "db_switchgear", line: "Board size", kind: "neg", how: "model-read", row: "BOQ-26-00183|Electrical Works|68", set: {"db_shell_item": "SPN DB 12WAY"}, fig: [6290, 1260], re: ["DB (shell): SPN DB 12WAY x 1 = 4,322"] },
  { id: "DB3+", cat: "db_switchgear", line: "Breakers", kind: "pos", how: "model-read", row: "BOQ-26-00183|Electrical Works|68", fig: [5930, 1190], re: ["MCB 2: 10A SP MCB D CURVE Switchgear x 6 = 3,696"] },
  { id: "DB3-", cat: "db_switchgear", line: "Breakers", kind: "neg", how: "model-read", row: "BOQ-26-00183|Electrical Works|68", set: {"mcb2_item": "10A SP MCB C CURVE"}, fig: [5430, 1090], re: ["MCB 2: 10A SP MCB C CURVE Switchgear x 6 = 2,694"] },
  { id: "DB4+", cat: "db_switchgear", line: "Four-pole and SP+N breakers", kind: "pos", how: "synthetic", row: "BOQ-26-00183|Electrical Works|77", cell: {"mcb1_item": {"value": "63A FP MCB C CURVE", "confidence": 0.9, "pole_ladder": {"to": "63A FP MCB C CURVE", "amp_moved_up": {"from": 50, "to": 63}}}}, fig: [39940, 7990], re: ["mcb1_item: No 4 pole MCB at 50A on the C curve — using 63A."] },
  { id: "DB4-", cat: "db_switchgear", line: "Four-pole and SP+N breakers", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|77", fig: [39940, 7990], re: ["MCB 1: 63A FP MCB C CURVE Switchgear x 1 = 4,012"], not: ["No 4 pole MCB"] },
  { id: "DB5+", cat: "db_switchgear", line: "RCCB / RCBO and ELCB", kind: "pos", how: "model-read", row: "BOQ-26-00183|Electrical Works|68", fig: [5930, 1190], re: ["MCB 1: 40A RCCB 30mA (DP) Switchgear x 1 = 4,670"] },
  { id: "DB5-", cat: "db_switchgear", line: "RCCB / RCBO and ELCB", kind: "neg", how: "model-read", row: "BOQ-26-00183|Electrical Works|68", set: {"mcb1_item": "None", "mcb1_qty": null}, fig: [3620, 730], re: ["mcb1_item=None"], not: ["MCB 1:"] },
  { id: "DB6+", cat: "db_switchgear", line: "Outgoings per phase", kind: "pos", how: "model-read", row: "BOQ-26-00183|Electrical Works|77", fig: [39940, 7990], re: ["MCB 3: 16A SP MCB C CURVE Switchgear x 36 = 16,164"] },
  { id: "DB6-", cat: "db_switchgear", line: "Outgoings per phase", kind: "neg", how: "model-read", row: "BOQ-26-00183|Electrical Works|77", set: {"mcb3_qty": 12}, fig: [34610, 6930], re: ["mcb3_qty=12"], not: ["x 36 ="] },
  { id: "DB7+", cat: "db_switchgear", line: "Quantities and missing parts", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|68", fig: [5930, 1190], re: ["db_shell_qty:default", "mcb3_item=None"], not: ["MCB 3:"] },
  { id: "DB7-", cat: "db_switchgear", line: "Quantities and missing parts", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|68", set: {"mcb3_item": null}, fig: null, re: ["Missing to price: MCB 3, MCB 3 qty"] },
  // ELR-4d (owner R-DB-MANUAL) INVERTED: WAS fig [0, 0] (a row with no part matched priced at 0)
  { id: "DB7z", cat: "db_switchgear", line: "Quantities and missing parts", kind: "pos", how: "stored", row: "BOQ-26-00174|Electrical |104", fig: null, re: ["No part of this DB matched the catalogue - price it by hand."], not: ["DB (shell):"] },
  { id: "DB8+", cat: "db_switchgear", line: "Supply", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|68", fig: [5930, 1190], re: ["Switchgear discount = 70%", "Switchgear supply markup = 65%"] },
  { id: "DB8-", cat: "db_switchgear", line: "Supply", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|68", set: {"mcb2_qty": 8}, fig: [6540, 1310], re: ["MCB 2: 10A SP MCB D CURVE Switchgear x 8 = 4,928"] },
  { id: "DB9+", cat: "db_switchgear", line: "Install", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|68", fig: [5930, 1190], re: ["DB installation share = 20%"] },
  { id: "DB9-", cat: "db_switchgear", line: "Install", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|68", set: {"mcb2_qty": 8}, fig: [6540, 1310], re: ["MCB 2: 10A SP MCB D CURVE Switchgear x 8 = 4,928"] },
  { id: "IS1+", cat: "industrial_sockets", line: "Paired MCB", kind: "pos", how: "stored", row: "BOQ-26-00194|ELE|197", fig: [8214, 2880], re: ["Paired MCB: Switchgear 20A SP MCB D CURVE x 1 = 305"] },
  { id: "IS1-", cat: "industrial_sockets", line: "Paired MCB", kind: "neg", how: "stored", row: "BOQ-26-00194|ELE|197", set: {"mcb_present": "No"}, fig: [7909, 2770], re: ["paired_mcb~None"], not: ["Paired MCB: Switchgear"] },
  { id: "IS2+", cat: "industrial_sockets", line: "MCB pole", kind: "pos", how: "synthetic", row: "BOQ-26-00194|ELE|197", set: {"mcb_pole_stated": null}, fig: [8214, 2880], re: ["paired_mcb~20A SP MCB D CURVE"] },
  { id: "IS2-", cat: "industrial_sockets", line: "MCB pole", kind: "neg", how: "stored", row: "BOQ-26-00194|ELE|197", set: {"mcb_pole_stated": "TPN"}, fig: [9295, 3260], re: ["paired_mcb: No 4 pole MCB at 20A on the D curve — using 25A."] },
  { id: "IS3+", cat: "industrial_sockets", line: "MCB curve", kind: "pos", how: "synthetic", row: "BOQ-26-00194|ELE|197", set: {"mcb_curve_stated": null}, fig: [8132, 2850], re: ["paired_mcb~20A SP MCB C CURVE"] },
  { id: "IS3-", cat: "industrial_sockets", line: "MCB curve", kind: "neg", how: "stored", row: "BOQ-26-00194|ELE|197", set: {"mcb_curve_stated": "D"}, fig: [8214, 2880], re: ["paired_mcb~20A SP MCB D CURVE"] },
  { id: "IS4+", cat: "industrial_sockets", line: "MCB rating", kind: "pos", how: "stored", row: "BOQ-26-00194|ELE|197", fig: [8214, 2880], re: ["paired_mcb: Fitted to 20A SP MCB D CURVE from 20"] },
  { id: "IS4-", cat: "industrial_sockets", line: "MCB rating", kind: "neg", how: "synthetic", row: "BOQ-26-00194|ELE|197", set: {"mcb_amp_a": 200}, fig: null, re: ["No Industrial Socket — Supply rate row matches"] },
  { id: "IS4s", cat: "industrial_sockets", line: "MCB rating", kind: "pos", how: "stored", row: "BOQ-26-00194|ELE|197", set: {"mcb_amp_a": null}, fig: [7909, 2770], re: ["paired_mcb~None"], not: ["Paired MCB: Switchgear"] },
  { id: "IS5+", cat: "industrial_sockets", line: "Interlocked socket", kind: "pos", how: "stored", row: "BOQ-26-00217|ELE-2F|69", fig: [13426, 4700], re: ["Socket: Industrial Socket with Socket Outlet Interlocked"], not: ["Paired MCB: Switchgear"] },
  { id: "IS5-", cat: "industrial_sockets", line: "Interlocked socket", kind: "neg", how: "stored", row: "BOQ-26-00194|ELE|197", fig: [8214, 2880], re: ["Paired MCB: Switchgear 20A SP MCB D CURVE x 1 = 305"] },
  { id: "IS6+", cat: "industrial_sockets", line: "Enclosure", kind: "pos", how: "model-read", row: "BOQ-26-00194|ELE|197", fig: [8214, 2880], re: ["enclosure=IP44/54 - Splash Proof"] },
  { id: "IS6-", cat: "industrial_sockets", line: "Enclosure", kind: "neg", how: "model-read", row: "BOQ-26-00194|ELE|197", set: {"enclosure": "IP67 - Water Proof"}, fig: [8430, 2960], re: ["enclosure=IP67 - Water Proof"] },
  { id: "IS7+", cat: "industrial_sockets", line: "Supply", kind: "pos", how: "stored", row: "BOQ-26-00194|ELE|197", fig: [8214, 2880], re: ["Socket: Industrial Socket with MCB IP44/54 - Splash Proof 16/20A 3 Pin / 2P+E x 1 = 7,909", "Paired MCB: Switchgear 20A SP MCB D CURVE x 1 = 305"] },
  { id: "IS7-", cat: "industrial_sockets", line: "Supply", kind: "neg", how: "stored", row: "BOQ-26-00194|ELE|197", set: {"mcb_present": "No"}, fig: [7909, 2770], re: ["paired_mcb~None"], not: ["Paired MCB: Switchgear"] },
  { id: "IS8+", cat: "industrial_sockets", line: "Install", kind: "pos", how: "stored", row: "BOQ-26-00194|ELE|197", fig: [8214, 2880], re: ["Industrial socket installation share = 35%"] },
  { id: "IS8-", cat: "industrial_sockets", line: "Install", kind: "neg", how: "stored", row: "BOQ-26-00194|ELE|197", set: {"mcb_present": "No"}, fig: [7909, 2770], re: ["paired_mcb~None"] },
  { id: "EA1+", cat: "earthing", line: "The earthing item", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|88", fig: [216.04999999999998, 29], re: ["material=CU", "type=8 SWG Wire"] },
  { id: "EA1-", cat: "earthing", line: "The earthing item", kind: "neg", how: "stored", row: "BOQ-26-00171|Electrical|297", fig: null, re: ["No EARTHING rate row matches Material = CU, Type = Bus bar."] },
  { id: "EA2+", cat: "earthing", line: "With Bus bar", kind: "pos", how: "stored", row: "BOQ-26-00174|Electrical |470", fig: [4690.75, 79.75], re: ["[EARTHING] Bus bar = 3,000"] },
  { id: "EA2-", cat: "earthing", line: "With Bus bar", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|88", fig: [216.04999999999998, 29], re: ["[EARTHING] Bus bar: not included"], not: ["Bus bar = "] },
  { id: "EA3+", cat: "earthing", line: "Supply and install", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|88", fig: [216.04999999999998, 29], re: ["Earthing supply markup = 45%", "Earthing installation markup = 45%"] },
  { id: "EA3-", cat: "earthing", line: "Supply and install", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|88", set: {"with_busbar": "With"}, fig: [4566.05, 29], re: ["[EARTHING] Bus bar = 3,000"] },
  { id: "CP1+", cat: "conduit_piping", line: "Conduit type", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|102", fig: [59.49999999999999, 20], re: ["conduit_type=MS"] },
  { id: "CP1g", cat: "conduit_piping", line: "Conduit type", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|98", set: {"conduit_type": "GI"}, fig: null, re: ["No Electrical Conduit rate row matches Conduit Type = GI"] },
  { id: "CP1-", cat: "conduit_piping", line: "Conduit type", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|98", set: {"conduit_type": "PVC"}, fig: [35, 10], re: ["conduit_type=PVC"] },
  { id: "CP2+", cat: "conduit_piping", line: "Size", kind: "pos", how: "stored", row: "BOQ-26-00184|Electrical Est|63", fig: [140, 30], re: ["size_mm: The row states 40 — using 50, the next size stocked."] },
  { id: "CP2-", cat: "conduit_piping", line: "Size", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|98", set: {"size_mm": 63}, fig: null, re: ["size_mm: The row states 63 — nothing stocked matches for Size (mm)"] },
  { id: "CP3+", cat: "conduit_piping", line: "Supply and install", kind: "pos", how: "stored", row: "BOQ-26-00183|Electrical Works|98", fig: [45.5, 10], re: ["Conduit discount = 50%", "Conduit installation share = 20%"] },
  { id: "CP3-", cat: "conduit_piping", line: "Supply and install", kind: "neg", how: "stored", row: "BOQ-26-00183|Electrical Works|98", set: {"size_mm": 25}, fig: [59.49999999999999, 20], re: ["size_mm=25"] },
  { id: "CT1+", cat: "cabletray_raceway", line: "Material", kind: "pos", how: "model-read", row: "BOQ-26-00174|Electrical |309", fig: [1504, 380], re: ["material=MS POWDER COATED"] },
  { id: "CT1-", cat: "cabletray_raceway", line: "Material", kind: "neg", how: "model-read", row: "BOQ-26-00174|Electrical |309", set: {"material": "uPVC"}, fig: null, re: ["No CableTray & Raceway — Supply rate row matches Type = Perforated, Material = uPVC"] },
  { id: "CT2+", cat: "cabletray_raceway", line: "Thickness", kind: "pos", how: "stored", row: "BOQ-26-00196|ELECTRICAL|353", fig: [1629, 630], re: ["thickness_mm: Thickness gauge (SWG) 16 read as 1.6"] },
  { id: "CT2-", cat: "cabletray_raceway", line: "Thickness", kind: "neg", how: "stored", row: "BOQ-26-00201|Electrical BOQ|167", fig: null, re: ["nothing stocked matches for Thickness (mm)"] },
  { id: "CT3+", cat: "cabletray_raceway", line: "Width", kind: "pos", how: "stored", row: "BOQ-26-00174|Electrical |321", fig: [540, 120], re: ["width_mm: The row states 80 — using 100, the next size stocked."] },
  { id: "CT3-", cat: "cabletray_raceway", line: "Width", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |309", set: {"width_mm": 1200}, fig: null, re: ["width_mm: The row states 1200 — nothing stocked matches for Width (mm)"] },
  { id: "CT4+", cat: "cabletray_raceway", line: "Where unstated", kind: "pos", how: "model-read", row: "BOQ-26-00174|Electrical |309", fig: [1504, 380], re: ["installation_type:default", "cover:default"] },
  { id: "CT4-", cat: "cabletray_raceway", line: "Where unstated", kind: "neg", how: "model-read", row: "BOQ-26-00174|Electrical |309", set: {"installation_type": "Floor"}, fig: [1350, 380], re: ["installation_type=Floor"] },
  { id: "CT5+", cat: "cabletray_raceway", line: "Supply per metre", kind: "pos", how: "stored", row: "BOQ-26-00174|Electrical |309", fig: [1504, 380], re: ["cover=No"] },
  { id: "CT5-", cat: "cabletray_raceway", line: "Supply per metre", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |309", set: {"cover": "Yes"}, fig: [2719, 380], re: ["cover=Yes"] },
  { id: "CT6+", cat: "cabletray_raceway", line: "Install per metre", kind: "pos", how: "stored", row: "BOQ-26-00184|Electrical Est|103", fig: [1098, 470], re: ["floor_cutting=Yes"] },
  { id: "CT6-", cat: "cabletray_raceway", line: "Install per metre", kind: "neg", how: "stored", row: "BOQ-26-00184|Electrical Est|103", set: {"floor_cutting": "No"}, fig: [1098, 180], re: ["floor_cutting=No"] },
  { id: "JB1+", cat: "junction_box_raceway", line: "Face size", kind: "pos", how: "stored", row: "BOQ-26-00194|ELE|328", fig: [1120, 230], re: ["face_mm=350"] },
  { id: "JB1-", cat: "junction_box_raceway", line: "Face size", kind: "neg", how: "stored", row: "BOQ-26-00194|ELE|328", set: {"face_mm": 375}, fig: null, re: ["No Junction Box for Raceway rate row matches Face size (mm) = 375."] },
  { id: "JB2+", cat: "junction_box_raceway", line: "Supply and install", kind: "pos", how: "stored", row: "BOQ-26-00194|ELE|328", fig: [1120, 230], re: ["Junction box installation share = 20%"] },
  { id: "JB2-", cat: "junction_box_raceway", line: "Supply and install", kind: "neg", how: "stored", row: "BOQ-26-00194|ELE|328", set: {"face_mm": 300}, fig: [920, 190], re: ["face_mm=300"] },
  { id: "LM1+", cat: "lighting_mgmt_system", line: "One catalogue item per row", kind: "pos", how: "stored", row: "BOQ-26-00256|ELECTRICAL|667", fig: [510, null], re: ["brand=Lutron"] },
  { id: "LM1-", cat: "lighting_mgmt_system", line: "One catalogue item per row", kind: "neg", how: "stored", row: "BOQ-26-00256|ELECTRICAL|667", set: {"brand": null}, fig: null, re: ["Missing to price: Brand"] },
  { id: "LM2+", cat: "lighting_mgmt_system", line: "Supply", kind: "pos", how: "stored", row: "BOQ-26-00256|ELECTRICAL|667", fig: [510, null], re: ["Lighting management system supply markup = 30%"] },
  { id: "LM2-", cat: "lighting_mgmt_system", line: "Supply", kind: "neg", how: "stored", row: "BOQ-26-00328|BOQ|583", fig: [16640, null], re: ["brand=Lutron"] },
  { id: "MI1+", cat: "miscellaneous", line: "One catalogue item per row, by name", kind: "pos", how: "stored", row: "BOQ-26-00174|Electrical |488", fig: [165, 35], re: ["description=MS Fabricated Items"] },
  { id: "MI1-", cat: "miscellaneous", line: "One catalogue item per row, by name", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |488", set: {"description": "MS Fabricated Items XX"}, fig: null, re: ["No Miscellaneous rate row matches Item = MS Fabricated Items XX."] },
  { id: "MI2+", cat: "miscellaneous", line: "Supply and install", kind: "pos", how: "stored", row: "BOQ-26-00174|Electrical |488", fig: [165, 35], re: ["Miscellaneous supply BCS ratio = 80%"] },
  { id: "MI2-", cat: "miscellaneous", line: "Supply and install", kind: "neg", how: "stored", row: "BOQ-26-00174|Electrical |488", set: {"description": "Danger Board"}, fig: [1500, 500], re: ["description=Danger Board"] },
];
