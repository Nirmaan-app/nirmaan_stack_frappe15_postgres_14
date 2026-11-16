/**
 * DU-3 K1b: the Ducting + Valve Package config data HVAC v75 carries for R3 (pair_note), R4 / R6 / R7 (gauge lines), R5 (units), R7 (shape
 * words) and Case 8 (paint_row), applied to the newest asset's configs -- for tests that run before / beside the asset. The v75 asset test
 * pins the minted configs equal to these, so the two never drift (scripts/_instruments/mint_hvac_v75_du3.py holds the same values).
 */
import { CFG } from "./du1Duct.harness";
import { SI_V75 } from "./du3Insulation.harness";

export const GAUGE_LINES_NEW = {
  bare_number: "BoQ says {said} -> {gauge}G (a bare number in the gauge field is the gauge)",
  labour_any_gauge: "Labour row: the duct's installation does not vary by gauge, so the duct type decides",
  own_row: "This row's own words say \"{said}\" -> {gauge}G (the answer lists several gauges; this row's band)",
};
export const PAIR_NOTE_DUCT = "Installation not priced in this row - this sheet quotes the installation of this duct on its own {rows}";
export const PAIR_NOTE_VALVE = "Installation not priced in this row - this sheet quotes the installation of this valve on its own {rows}";
export const R5_UNITS = ["sm", "sq mt", "sqm/ro"];
const RECT = "Rectangular (GI)", SPIRAL = "Spiral / Oval (GI)";
export const R7_WHEN_WORDS = [
  ...(["area"] as const).map((cls) => ({ unit_class: cls, words: ["rectangular/round", "rectangular/ round", "rectangular / round", "rect/round",
    "round/rectangular", "round / rectangular", "rectangular and round", "rectangular & round"], family: RECT,
    rule: "BoQ says rectangular/round - priced as rectangular (unit sq.m)" })),
  ...(["area", "length"] as const).map((cls) => ({ unit_class: cls, words: ["rectangular"], family: RECT })),
  ...(["area", "length"] as const).map((cls) => ({ unit_class: cls, words: ["round", "spiral", "oval", "circular", "elliptical"], family: SPIRAL,
    rule: "BoQ says round / spiral / oval with no duct type - priced as Spiral / Oval (owner 2026-11-16 15:00 / QR-5 (a))" })),
];
export const PAINT_ROW = {
  words: "paint\\s*finish|enamel\\s*paint|painting\\s+of\\s+(?:the\\s+)?ducts?|synthetic\\s+enamel",
  section: "misc", family: "Paint", tolerance: 0.2,
  line: "Reads as painting of the ducts in {rows} - priced as Paint",
  miss_line: "Reads as painting of ducts, but {why} - price this row by hand",
};

const DUCT_FAMS = [RECT, SPIRAL, "PIR (Pre Insulated Duct)", "Fire Rated (MS)"];
export const K1C_TEXT_NOTES = [
  { families: ["Fire Rated (MS)"], from_text: "own_and_headings", pattern: "^(?=.*fire\\s*rat)(?=.*(?:\\bGI\\b|galvani[sz]|zinc\\s*coat))",
    line: "GI fire-rated duct - priced as our Fire Rated duct item", rule: "R8-C2",
    rule_line: "A GI duct the BoQ calls fire rated is priced as our Fire Rated duct item, with a note" },
  { families: DUCT_FAMS, from_text: "headings", pattern: "alumini?um",
    line: "heading says Aluminium - check the material before quoting", rule: "R8-C3",
    rule_line: "A heading naming aluminium over a row of another material carries a check-the-material note" },
];
export const SS_REFUSE = [
  { from: "stainless steel", refuse: "Reads as butterfly valves (stainless steel), not a duct - re-file this row",
    rule: "DR11 stainless steel rows are butterfly valves (owner 2026-11-13 20:57)", unless: "\\bduct" },
  { from: "stainless steel", refuse: "Stainless-steel duct is not on our sheet - price this row by hand",
    rule: "Case 12 a stainless-steel duct row is priced by hand (owner 2026-11-16 16:38)" },
];
export const ROW_REFUSALS = [{ pattern: "double[\\s-]*skin|sandwich\\s+type|sandwich\\s+(?:duct|panel)", line: "double-skin duct - not on our sheet, price by hand",
  rule_line: "A double-skin duct row (inner + outer skin, or a sandwich with PUF) is not priced" }];
export const PARTIAL_INSULATION = {
  pattern: "(?<kind>acoustic|thermal)\\b[^|]{0,160}?\\b(?<span>(?:first|initial)\\s+\\d+(?:\\.\\d+)?\\s*(?:m|mtr|mtrs|meters?|metres?|rmt)\\b(?:\\s+from\\s+(?:the\\s+)?[A-Za-z]+)?)",
  line: "{kind} insulation asked only for the {span} - add by hand",
};
export const TWO_INSULATIONS = { section: "insulation", keep_words: "thermal", second_words: "acc?oustic", line: "second insulation (acoustic {t} mm) - add by hand" };
export const C6_WHEN_WORDS = (["area", "length"] as const).map((cls) => ({ unit_class: cls,
  words: ["rectangular and flat oval", "rectangular & flat oval", "rectangular and oval", "rectangular & oval"], family: SPIRAL,
  rule: "removal of mixed shapes - priced at the higher (oval) rate" }));

type Pricing = {
  [k: string]: unknown;
  sheet_insulation?: { threshold_input?: string } | unknown;
  numbers: { thickness_mm: { gauge: { lines: Record<string, unknown> } } };
  scope: { supply_row: Record<string, unknown> };
  unit_classes: Record<string, string[]>;
  family_when_none: Record<string, unknown> & { when_words?: Array<{ words: string[] }> };
  text_notes: unknown[];
  family_text: Record<string, unknown> & { refuse: Array<{ from: string }> };
};
type Cfg = { list_spec: { pricing: Pricing } };
/** the newest asset's configs with Ducting and the Valve Package carrying the K1 + K1b v75 data (a no-op once v75 is the asset) */
export function cfgK1b(): Map<string, unknown> {
  const m = new Map<string, unknown>(CFG as Map<string, unknown>);
  const d = structuredClone(m.get("hvac_ducting")) as Cfg;
  const pr = d.list_spec.pricing;
  if (!(pr.sheet_insulation as { threshold_input?: string } | undefined)?.threshold_input) {
    pr.sheet_insulation = SI_V75;
    Object.assign(pr.numbers.thickness_mm.gauge.lines, GAUGE_LINES_NEW);
    pr.scope.supply_row.pair_note = PAIR_NOTE_DUCT;
    pr.unit_classes.area = [...pr.unit_classes.area, ...R5_UNITS];
    pr.family_when_none = { ...pr.family_when_none, when_words: R7_WHEN_WORDS };
    pr.paint_row = PAINT_ROW;
    pr.text_notes = [...pr.text_notes, ...K1C_TEXT_NOTES];
    const k = pr.family_text.refuse.findIndex((r: { from: string }) => r.from === "stainless steel");
    pr.family_text = { ...pr.family_text, refuse: [...pr.family_text.refuse.slice(0, k), ...SS_REFUSE, ...pr.family_text.refuse.slice(k + 1)] };
    pr.row_refusals = ROW_REFUSALS;
    pr.partial_insulation = PARTIAL_INSULATION;
    pr.two_insulations = TWO_INSULATIONS;
    const ww = pr.family_when_none.when_words as Array<{ words: string[] }>;
    const at = ww.findIndex((w) => w.words.length === 1 && w.words[0] === "rectangular");
    pr.family_when_none.when_words = [...ww.slice(0, at), ...C6_WHEN_WORDS, ...ww.slice(at)];
  }
  m.set("hvac_ducting", d);
  const v = structuredClone(m.get("hvac_valve_package")) as Cfg;
  if (!v.list_spec.pricing.scope.supply_row.pair_note) v.list_spec.pricing.scope.supply_row.pair_note = PAIR_NOTE_VALVE;
  m.set("hvac_valve_package", v);
  return m;
}
