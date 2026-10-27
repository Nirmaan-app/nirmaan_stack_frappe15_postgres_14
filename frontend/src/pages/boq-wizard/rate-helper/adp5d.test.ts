/**
 * ADP-5d (owner rulings 2026-10-23 22:20-23:48; Phase A rulings Q1-Q8, 2026-10-24) -- FOUR PRICER MECHANISMS, proved on the
 * ADP config AS IT IS TODAY (HVAC v53) with ONLY these keys added, through the panel's own entry point
 * (`makePricingSheetHelper(...).compute`), on REAL stored rows (the replay dump, ADP-5d START; stored answers verbatim):
 *
 *   `stream_heading_default` (R6b, Q1 (B)): the heading directly above names supply and return air, the row names neither
 *             stream and no damper, and the heading does not give its damper to both streams (nor name one for no
 *             stream) -> the model's damper answer is set aside for the family's ruled default, shown on the field;
 *   `companion_items` (R4, Q3): a cross-talk item whose row's OWN text says "return air baffle" also pays for one 300 x 300
 *             return air grille without damper, on the per-number path (515), one per row unit;
 *   `text_notes` (R9 / R13, Q4): a working line drawn from the row's text -- the motorised VCD's "not included" line where
 *             a heading names a control panel; the square diffuser's shape note on a per-sq.m row whose shape is not
 *             settled;
 *   `number_defaults.rule_by_family` (R21, Q5 (b)): the floor grille's 300 x 300 default says its own line; the
 *             cross-talk rows keep theirs byte for byte.
 * Every mechanism reads the row's text, so none fires in the calculator. The v54 asset's own copy of these keys is pinned
 * in `nirmaan_stack/services/boq_rate_master/test_adp5d_question.py`.
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { headingTexts, streamHeadingUndecided, textNoteLines, itemListPricingSpec } from "./itemListPricing";
import { mergeItemsByName } from "./rateHelperPlumbing";
import { isSuggestion, type ExtractionRow, type HelperResult } from "./rateHelperTypes";
import { CONFIGS as LIVE_CONFIGS } from "./adp3a.harness";

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const V53 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v53.json")));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const cfgOf = (a: Asset, id: string) => a.category_configs.find((c) => c.category_id === id)!;

// ── the ruled forms -- the same text as `test_config_validation_adp5d.py` and HVAC v54 ─────────────────────────────────
const DAMPER_FAMILIES = ["curved grille", "floor grille", "linear grille", "round diffuser", "slot diffuser", "square diffuser"];
export const STREAM_HEADING_DEFAULT = [{
  attr: "damper", streams_attr: "air", families: DAMPER_FAMILIES, words: ["damper", "vcd", "volume control"],
  line: "heading names supply and return air, this row names neither -> damper as default ({value})",
  rule: "R6b: the heading directly above names supply and return air, the row names neither and no damper, and the heading does not give its damper to both streams or to no stream -> the damper as the family default (owner 2026-10-23 23:24; ring fence Q1 (B) 2026-10-24)",
}];
export const COMPANION_ITEMS = [{
  families: ["cross-talk"], words: ["return air baffle"], unit_class: "count",
  item: { family: "linear grille", damper: "without", air: "return", size_mm: "300 x 300" },
  line: "return air baffle -> one return air grille added (linear grille, without damper, 300 x 300: no grille size stated)",
  rule: "R4: a return air baffle is a Z-piece plus one return air grille without damper, 300 x 300 where no size is stated, one per row unit (owner 2026-10-23 23:28 / 23:29; Q3 2026-10-24)",
}];
export const TEXT_NOTES = [
  { families: ["VCD"], from_text: "headings", pattern: "control\\s+panel", when: { attr: "variant", equals: "motorised" },
    line: "control panel, actuator and cabling named in the heading: not included - add by hand",
    rule: "R9 option (c): a motorised VCD prices alone; the heading's control panel, actuator and cabling are not included (owner 2026-10-23 23:32; reach Q4 tight 2026-10-24)" },
  { families: ["square diffuser"], from_text: "own_and_headings", unit_classes: ["area"],
    pattern: "^(?![\\s\\S]*\\b(?:square|rectangular|round|circular)\\b)|\\b(?:round|circular)\\b[\\s\\S]*\\b(?:square|rectangular)\\b|\\b(?:square|rectangular)\\b[\\s\\S]*\\b(?:round|circular)\\b",
    line: "shape not stated (or round/square offered): priced as square diffuser - change if round",
    rule: "R13: a per-sq.m diffuser whose shape is not settled prices as a square diffuser, with this note (owner 2026-10-23 23:37)" },
];
export const FLOOR_GRILLE_LINE = "size not stated: priced at 300 x 300 - change if different (owner 2026-10-23 23:43)";

/** v53's ADP config with ONLY this slice's keys added; `which` picks them, so each mechanism is proved on its own. */
function withAdp5d(which: { streams?: boolean; companion?: boolean; notes?: boolean; floor?: boolean } = { streams: true, companion: true, notes: true, floor: true }): RateCategoryConfig {
  const c = structuredClone(cfgOf(V53, ADP)) as RateCategoryConfig & { list_spec: { pricing: Record<string, any> } };
  const pr = c.list_spec.pricing;
  if (which.streams) pr.stream_heading_default = structuredClone(STREAM_HEADING_DEFAULT);
  if (which.companion) pr.companion_items = structuredClone(COMPANION_ITEMS);
  if (which.notes) pr.text_notes = structuredClone(TEXT_NOTES);
  if (which.floor) {
    for (const a of ["face_w_mm", "face_h_mm"]) {
      pr.number_defaults[a] = { ...pr.number_defaults[a], families: [...pr.number_defaults[a].families, "floor grille"],
        rule_by_family: { "floor grille": FLOOR_GRILLE_LINE } };
    }
  }
  return c;
}
const V53ADP = cfgOf(V53, ADP);
const configs = (adp: RateCategoryConfig) => {
  const m = new Map<string, RateCategoryConfig>(LIVE_CONFIGS);
  for (const id of [INS, PIP]) m.set(id, cfgOf(V53, id));
  m.set(ADP, adp);
  return m;
};
const ITEMS: RateMasterItem[] = mergeItemsByName(V53.items.map((it) => ({ ...it, discipline: V53.discipline } as RateMasterItem)));
const RK = ["supply_rate", "install_rate", "combined_rate"];
const must = (r: HelperResult): ItemListSuggestion => { if (!isSuggestion(r)) throw new Error("expected a suggestion"); return r as ItemListSuggestion; };
const cells = (a: Record<string, string | null>) =>
  Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
interface Row { unit: string; description: string; headings: string[]; ownNotes?: string[]; headingNotes?: string[]; items: Array<Record<string, string | null>> }
function panel(row: Row, adp: RateCategoryConfig, overrides: Record<string, string> = {}): ItemListSuggestion {
  const ext = new Map<number, ExtractionRow>([[1, { excelRow: 1, description: row.description, attributes: {}, items: row.items.map((a) => ({ attributes: cells(a) })) } as unknown as ExtractionRow]]);
  return must(makePricingSheetHelper({ configsByCategory: configs(adp), items: ITEMS, extractionByRow: ext })
    .compute({ excelRow: 1, description: row.description, nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: RK,
      headings: row.headings, ownNotes: row.ownNotes ?? [], headingNotes: row.headingNotes ?? [], unit: row.unit } as never, overrides));
}
function calculator(adp: RateCategoryConfig, family: string, attrs: Record<string, string>, unit: string): ItemListSuggestion {
  return must(makePricingSheetHelper({ configsByCategory: configs(adp), items: ITEMS, extractionByRow: new Map() })
    .compute({ excelRow: 1, description: "", nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: RK, headings: [], ownNotes: [] } as never,
      { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs, other: Object.keys(attrs) }] }), [ROW_UNIT_OVERRIDE_KEY]: unit }));
}
const view = (s: ItemListSuggestion) => ({
  values: s.values, reason: s.itemList!.reason,
  items: s.itemList!.items.map((b) => ({ family: b.family, state: b.state, reason: b.reason, figures: b.figures, working: b.working,
                                         fields: b.fields.map((f) => [f.id, f.value, f.note ?? null]) })),
});
const fig = (s: ItemListSuggestion) => [s.values.supply_rate ?? null, s.values.install_rate ?? null, s.values.combined_rate ?? null];
const working = (s: ItemListSuggestion) => s.itemList!.items.flatMap((b) => b.working);
const field = (s: ItemListSuggestion, id: string) => s.itemList!.items[0].fields.find((f) => f.id === id);

// ── the stored rows (replay dump, ADP-5d START; answers verbatim, null cells left out) ────────────────────────────────────
const LINEAR_NOTES = [
  "Supply, Installation, Testing and Balancing of one way blow linear supply air grilles with VCD complete with fixed core as per approved shop drawings and specifications. The grilles shall be of approved colour & shade.",
  "Powder coated aluminium grilles of extruded sections with integral flanges on both sides & ends as required complete with corner pieces.",
  "Supply, Installation, Testing and Balancing of one way blow linear return air grilles without VCD complete with fixed core as per approved shop drawings and specifications. The grilles shall be of approved colour & shade.",
  "Powder coated aluminium grilles of extruded sections with integral flanges on both sides & ends as required complete with corner pieces.",
];
const R00066_638: Row = { unit: "SqM", description: "100/150/200/250 mm/600mmx600mm High grilles", headings: ["TOTAL (SECTION B)", "DUCTWORK/AIR TERMINALS", "LINEAR GRILLES"],
  headingNotes: LINEAR_NOTES, items: [{ family: "linear grille", damper: "with", air: "supply", size_mm: "100/150/200/250 mm/600mmx600mm High", ul: "None", qty_per_row_unit: "None" }] };
const R00148_65: Row = { unit: "SqM", description: "100/150/200/250 mm/600mmx600mm High grilles", headings: ["DUCTWORK/AIR TERMINALS", "LINEAR GRILLES"],
  headingNotes: [LINEAR_NOTES[0], LINEAR_NOTES[1], "Both SA & RA grilles shall be constructed using 1.2 mm thick extruded aluminium frame. The louver / grille blade shall be atleast 1mm for both the grille & the collar damper.", LINEAR_NOTES[2], LINEAR_NOTES[3]],
  items: [{ family: "linear grille", damper: "with", air: "None", size_mm: "100/150/200/250 mm/600mmx600mm High", ul: "None", qty_per_row_unit: "None" }] };
const R00073_15: Row = { unit: "SqM", description: "Powder coated extruded aluminium diffusers of approved colour & shade.",
  headings: ["DIFFUSER", "Supply, Installation, Testing and Balancing of square Supply & Return Air diffusers, supply diffusers with removable key operated Square Diffuser with opposed blades as per the approved shop drawings and specifications.The diffusers shall be anti-smudge ring type/flat type as approved by the interior designer. Diffusers shall be with removable core for the following neck sizes. The diffusers shall be suitable for fixing in the gypsum/grid ceiling. The diffusers shall be of regular type and with outer dimension of 600 mm x 600 mm"],
  items: [{ family: "square diffuser", damper: "with", air: "supply", size_mm: "600 mm x 600 mm", ul: "None", qty_per_row_unit: "None" }] };
const R00114_193: Row = { unit: "SqM", description: "100/150/200 mm High/wide grilles", headings: ["DUCTWORK/AIR TERMINALS", "LINEAR GRILLES"],
  headingNotes: ["Supply, Installation , Testing and Balancing of supply & return air grilles with vcd complete with fixed core as per approved shop drawings and specifications. The grilles shall be of approved colour & shade.", LINEAR_NOTES[1]],
  items: [{ family: "linear grille", damper: "with", air: "None", size_mm: "100/150/200 mm High/wide", ul: "None", qty_per_row_unit: "None" }] };
const R00192_180: Row = { unit: "Nos", description: "300 x 150 mm - Electrical Room",
  headings: ["SECTION P-VENTILATION SYSTEM", "Supply, installation, testing and balancing of Aluminium Powder Coated Supply / Return Air Grille with all the necessary flanges & aluminium collar damper etc."],
  items: [{ family: "grille, type not stated", damper: "with", air: "None", size_mm: "300 x 150 mm", ul: "None", qty_per_row_unit: "None" }] };
const R00247_104: Row = { unit: "No", description: "900X150",
  headings: ["HVAC SYSTEM", "Aluminium factory extruded, powder coated discrete grille with end flanges for supply and return air of the sizes mentioned below. Groove for Screw fixing on the grille to be counter sunk. damper should be operable through screw head"],
  items: [{ family: "grille, type not stated", damper: "with", air: "None", size_mm: "900X150", ul: "None", qty_per_row_unit: "None" }] };
const R00137_83: Row = { unit: "Nos", description: "Neck - 150 mm -",
  headings: ["AIR DISTRIBUTION SYSTEM", "Supply & installation of Supply and Return Air grilles", "Aluminium Round Diffuser Powder Coated with Collar damper"],
  items: [{ family: "round diffuser", damper: "with", air: "None", dia_mm: "150 mm", ul: "None", variant: "None", qty_per_row_unit: "None" }] };
const BAFFLE = "Supply, Fabrication, Installation and Testing of return air baffles made of 24 G GS sheet metal (class VIII-120GSM Zinc Coaing) ducts with 12 mm open cell Nitrile Rubber foam within 160-180 Kg/m3 density acoustic insulation , hanging arrangements in accordance with the approved shop drawings and specifications. Grille should be consider wherever placed toward exposed ceiling";
/** 00144 r224 as stored (curved grille, 13,530) and as the R4 question would answer it (cross-talk). */
const R00144_224: Row = { unit: "SqM", description: BAFFLE, headings: ["AIR TRANSFER GRILLES", "Return Air Baffles"],
  items: [{ family: "curved grille", damper: "None", insulated: "with", air: "return", ul: "None", thickness_mm: "24 G", insulation_thickness_mm: "12 mm", qty_per_row_unit: "None" }] };
const asCrossTalk = (row: Row): Row => ({ ...row, items: [{ ...row.items[0], family: "cross-talk", damper: "None" }] });
const R00218_121: Row = { unit: "Nos",
  description: "SITC of factory fabricated Z shape Cross talk silencer made out of 1 mm thick Micro-Perforated Plate having a perforation percentage of less than 1% and having an NRC value of 0.7 – 0.9, the length of the Silencer shall be designed in such a way to diffuse the noise and shall be as per the manufacturers recommendation and shall be selected as per standards.",
  headings: ["AIR DISTRUBTION SYSTEM", "Cross Talk Silencer"],
  items: [{ family: "cross-talk", damper: "None", insulated: "None", air: "None", ul: "None", thickness_mm: "1 mm", variant: "None", qty_per_row_unit: "None" }] };
const MVCD_HEADING = "SITC of aerofoil blade low leakage aluminium motorised volume control dampers with necessary control panel, actuator, power cabling and control cabling near to the damper.";
const R00243_214: Row = { unit: "No", description: "Up to 0.5 Sqmt", headings: ["AIR DISTRIBUTION", MVCD_HEADING],
  items: [{ family: "VCD", damper: "None", air: "None", ul: "None", area_band: "Up to 0.5 Sqmt", variant: "motorised", qty_per_row_unit: "None" },
          { family: "control panel", air: "None", ul: "None", variant: "None", qty_per_row_unit: "None" },
          { family: "actuator", air: "None", ul: "None", variant: "None", qty_per_row_unit: "None" }] };
const vcdAlone = (row: Row): Row => ({ ...row, items: [row.items[0]] });
const R00003_55: Row = { unit: "Nos", description: "Up to 0.5 Sqmt",
  headings: ["VOLUME CONTROL DAMPERS AND COLLAR DAMPERS", "SITC of GSS construction of 18G Motorized Volume Control Dampers (MVCD) with actuators (on / off) for duct/ branches in accordance with the approved shop drawings and specifications. Necessary cabling for interlocking shall be included."],
  items: [{ family: "VCD", damper: "None", insulated: "None", air: "None", ul: "None", thickness_mm: "18G", area_band: "Up to 0.5 Sqmt", variant: "motorised", qty_per_row_unit: "None" }] };
const R00100_94: Row = { unit: "SQM",
  description: "Supplying, Fixing, installation, testing and commissioning of supply air diffusers (round/square flat plate type)of powder coated aluminium with aluminium volume control dampers with anti smudge ring & removable core in confirmation to SMACNA/IS and as per specifications complete etc. as required. Colour as per site requirement.",
  headings: ["AIR DISTRIBUTION PRODUCTS"], items: [{ family: "round diffuser", damper: "with", air: "supply", ul: "None" }] };
const asSquare = (row: Row): Row => ({ ...row, items: [{ ...row.items[0], family: "square diffuser" }] });
const R00329_215: Row = { unit: "Sq. m",
  description: "Supplying, fixing testing commissioning of Square/Round supply air diffusers of powder coated aluminium as per approved shade with aluminium volume control dampers with anti smudge ring & removable core. Colour: Approval shall be obtained from Interior consultant. As per specification/drawings.",
  headings: ["PART- B - AIR DISTRIBUTION"], items: [{ family: "square diffuser", damper: "with", air: "supply", ul: "None", qty_per_row_unit: "None" }] };
const R00315_42: Row = { unit: "Nos.",
  description: "Supply & Installation of Al. powder coated rigid grille with Al. Opposed Blade dampers to moudlating the air flow . The tile should be of 80% opening. As it is been served for the data rack room, it should be rigid tile type and should be procured from the floor tile vendor.",
  headings: ["FOR HUB ROOM"], items: [{ family: "floor grille", damper: "with", air: "None", ul: "None", qty_per_row_unit: "None" }] };
const R00215_40: Row = { unit: "Nos.", description: "Supply & Installation of Al. powder coated rigid floor grilles of 200X200 with Al. Opposed Blade dampers.",
  headings: ["FOR HUB ROOM"], items: [{ family: "floor grille", damper: "with", air: "None", size_mm: "200X200", ul: "None", qty_per_row_unit: "None" }] };
const said = (row: Row, description: string): Row => ({ ...row, description });

const R6B_LINE = "heading names supply and return air, this row names neither -> damper as default (without)";

describe("ADP-5d R6b -- stream_heading_default (the four approved movers, Q1 (B))", () => {
  it("00066 r638: the AI's 'with' is set aside -> without, 12,428 -> 4,829 / 880 / 5,709; the field shows what priced, with the line", () => {
    expect(fig(panel(R00066_638, V53ADP))).toEqual([9628, 2800, 12428]);
    const s = panel(R00066_638, withAdp5d({ streams: true }));
    expect(fig(s)).toEqual([4829, 880, 5709]);
    expect(field(s, "damper")?.value).toBe("without");
    expect(field(s, "damper")?.note).toBe(R6B_LINE);
  });
  it("00148 6.HVAC r65 (a stream-less 'collar damper' sentence beside the two stream-specific ones) -> 5,709", () => {
    expect(fig(panel(R00148_65, withAdp5d({ streams: true })))).toEqual([4829, 880, 5709]);
  });
  it("00073 r15 (the heading names both streams and no damper word) -> square diffuser without, 9,285 -> 6,195", () => {
    expect(fig(panel(R00073_15, V53ADP))).toEqual([7685, 1600, 9285]);
    expect(fig(panel(R00073_15, withAdp5d({ streams: true })))).toEqual([5075, 1120, 6195]);
  });
});

describe("ADP-5d R6b -- the ring fence: rows the rule must NOT move", () => {
  const same = (row: Row) => expect(view(panel(row, withAdp5d({ streams: true })))).toEqual(view(panel(row, V53ADP)));
  it("the heading gives the damper to BOTH streams ('supply & return air grilles with vcd'): 00114 r193 stays 12,428", () => {
    same(R00114_193);
    expect(fig(panel(R00114_193, withAdp5d({ streams: true })))).toEqual([9628, 2800, 12428]);
  });
  it("'Supply / Return Air Grille with ... aluminium collar damper': 00192 r180 stays 560", () => {
    same(R00192_180);
    expect(fig(panel(R00192_180, withAdp5d({ streams: true })))[2]).toBe(560);
  });
  it("a damper named for NO stream ('damper should be operable through screw head'): 00247 r104 stays 1,678", () => {
    same(R00247_104);
  });
  it("both streams only in a GRANDPARENT (the parent says 'with Collar damper'): 00137 r83 stays 1,676", () => {
    same(R00137_83);
  });
  it("the row's own text names a stream ('supply air grilles'), or a damper ('with VCD'): unchanged", () => {
    same(said(R00066_638, "100/150/200/250 mm/600mmx600mm High supply air grilles"));
    same(said(R00066_638, "100/150/200/250 mm/600mmx600mm High grilles with VCD"));
  });
  it("the model already answered the default ('without'), or 'not mentioned': nothing to set aside", () => {
    same({ ...R00066_638, items: [{ ...R00066_638.items[0], damper: "without" }] });
    same({ ...R00066_638, items: [{ ...R00066_638.items[0], damper: "None" }] });
  });
  it("a pricer's own pick stands: 'with' chosen on the panel prices with", () => {
    const pick = { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: 0, family: null, attrs: { damper: "with" } }] }) };
    expect(fig(panel(R00066_638, withAdp5d({ streams: true }), pick))).toEqual([9628, 2800, 12428]);
  });
  it("the calculator has no heading: never fires", () => {
    expect(fig(calculator(withAdp5d(), "linear grille", { damper: "with" }, "sqm"))).toEqual(fig(calculator(V53ADP, "linear grille", { damper: "with" }, "sqm")));
  });
  it("the pure test, sentence by sentence (streamHeadingUndecided)", () => {
    const rule = STREAM_HEADING_DEFAULT[0];
    const S = ["supply", "return", "exhaust", "fresh"];
    const both = "Supply & return air grilles";
    expect(streamHeadingUndecided(rule, S, "grilles", `${both}.`)).toBe(true);
    expect(streamHeadingUndecided(rule, S, "grilles", `supply air grilles with VCD. return air grilles without VCD`)).toBe(true);
    expect(streamHeadingUndecided(rule, S, "grilles", `${both} with vcd`)).toBe(false);
    expect(streamHeadingUndecided(rule, S, "grilles", `${both}. damper operable through screw head`)).toBe(false);
    expect(streamHeadingUndecided(rule, S, "grilles", "Supply air grilles with VCD")).toBe(false);
    expect(headingTexts(["A", "B"], "n1 | n2")).toEqual({ parent: "B | n1 | n2", all: "A | B | n1 | n2" });
  });
});

describe("ADP-5d R4 -- companion_items (the return air baffle's grille, Q3)", () => {
  it("00144 r224 as cross-talk, per sq.m: 3,120 + one 300 x 300 grille 515 = 2,755 / 880 / 3,635, with the line", () => {
    const s = panel(asCrossTalk(R00144_224), withAdp5d({ companion: true }));
    expect(fig(s)).toEqual([2755, 880, 3635]);
    expect(working(s)).toContain(`${COMPANION_ITEMS[0].line}: supply 435 + install 80 = 515`);
  });
  it("negative: without the key the same answer is the Z-piece alone, 3,120 (the key is the mechanism)", () => {
    expect(fig(panel(asCrossTalk(R00144_224), V53ADP))).toEqual([2320, 800, 3120]);
  });
  it("per number: one Z-piece (300 x 300 default, 1,124) + one grille 515 = 1,271 / 368 / 1,639", () => {
    const perNo: Row = { ...asCrossTalk(R00144_224), unit: "Nos" };
    expect(fig(panel(perNo, withAdp5d({ companion: true })))).toEqual([1271, 368, 1639]);
  });
  it("negative: a cross-talk row that does not say 'return air baffle' (00218 r121) stays 1,124", () => {
    expect(view(panel(R00218_121, withAdp5d({ companion: true })))).toEqual(view(panel(R00218_121, V53ADP)));
  });
  it("negative: the words only in a HEADING ('Return Air Baffles' above a Z-piece row) add nothing", () => {
    const zp: Row = { ...asCrossTalk(R00144_224), description: "Z-piece of 24 G GS sheet metal" };
    expect(fig(panel(zp, withAdp5d({ companion: true })))).toEqual([2320, 800, 3120]);
  });
  it("negative: the stored answer (curved grille) is not a cross-talk item -- unchanged 13,530", () => {
    expect(view(panel(R00144_224, withAdp5d({ companion: true })))).toEqual(view(panel(R00144_224, V53ADP)));
  });
  it("the calculator has no row text: a cross-talk prices alone", () => {
    expect(fig(calculator(withAdp5d(), "cross-talk", {}, "nos"))).toEqual([836, 288, 1124]);
  });
});

describe("ADP-5d R9 / R13 -- text_notes (Q4)", () => {
  const R9_LINE = TEXT_NOTES[0].line, R13_LINE = TEXT_NOTES[1].line;
  it("R9: 00243 r214's motorised VCD alone (the question's answer) prices 7,123 with the 'not included' line", () => {
    const s = panel(vcdAlone(R00243_214), withAdp5d({ notes: true }));
    expect(fig(s)).toEqual([6163, 960, 7123]);
    expect(working(s)).toContain(R9_LINE);
  });
  it("R9 negative (tight reach): a heading naming actuators and cabling but no control panel (00003 r55) -> no line, same figures", () => {
    expect(view(panel(R00003_55, withAdp5d({ notes: true })))).toEqual(view(panel(R00003_55, V53ADP)));
  });
  it("R9 negative: an aluminium (not motorised) VCD under the control-panel heading -> no line", () => {
    const alu: Row = { ...vcdAlone(R00243_214), items: [{ ...R00243_214.items[0], variant: "aluminium" }] };
    expect(working(panel(alu, withAdp5d({ notes: true })))).not.toContain(R9_LINE);
  });
  it("R9: the stored three-item answer still refuses on the control panel (the question, not the pricer, fixes it)", () => {
    expect(fig(panel(R00243_214, withAdp5d({ notes: true })))).toEqual([null, null, null]);
  });
  it("R13: 00100 r94 as square diffuser (round/square offered) prices 9,285 with the shape note", () => {
    const s = panel(asSquare(R00100_94), withAdp5d({ notes: true }));
    expect(fig(s)).toEqual([7685, 1600, 9285]);
    expect(working(s)).toContain(R13_LINE);
  });
  it("R13: 00329 r215 ('Square/Round') keeps 9,285 and gains the note; a row naming no shape gains it too", () => {
    expect(fig(panel(R00329_215, withAdp5d({ notes: true })))).toEqual([7685, 1600, 9285]);
    expect(working(panel(R00329_215, withAdp5d({ notes: true })))).toContain(R13_LINE);
    expect(working(panel(said(R00329_215, "Supply air diffusers of powder coated aluminium with volume control dampers"), withAdp5d({ notes: true })))).toContain(R13_LINE);
  });
  it("R13 negatives: a row that says square only -> no note; a per-number row -> no note; the stored round answer still refuses", () => {
    expect(working(panel(said(R00329_215, "Square supply air diffusers with volume control dampers"), withAdp5d({ notes: true })))).not.toContain(R13_LINE);
    const perNo: Row = { ...R00329_215, unit: "Nos" };
    expect(working(panel(perNo, withAdp5d({ notes: true })))).not.toContain(R13_LINE);
    expect(view(panel(R00100_94, withAdp5d({ notes: true })))).toEqual(view(panel(R00100_94, V53ADP)));
  });
  it("the calculator has no row text: no line (textNoteLines on empty texts)", () => {
    const spec = itemListPricingSpec(withAdp5d())!;
    expect(textNoteLines(spec, "square diffuser", "area", { attributes: {} }, "", { parent: "", all: "" })).toEqual([]);
    expect(working(calculator(withAdp5d(), "square diffuser", { damper: "with" }, "sqm"))).not.toContain(R13_LINE);
  });
});

describe("ADP-5d R21 -- number_defaults.rule_by_family (Q5 (b))", () => {
  it("00315 r42 (floor grille, no size, per number) prices 300 x 300 = 1,824 with the floor grille's own line on the size", () => {
    expect(fig(panel(R00315_42, V53ADP))).toEqual([null, null, null]);
    const s = panel(R00315_42, withAdp5d({ floor: true }));
    expect(fig(s)).toEqual([1651, 173, 1824]);
    expect(s.itemList!.items[0].fields.filter((f) => (f as { defaulted?: boolean }).defaulted).map((f) => [f.id, f.value, (f as { rule?: string }).rule]))
      .toEqual([["face_w_mm", "300", "size not stated: priced at 300 x 300 - change if different"],
                ["face_h_mm", "300", "size not stated: priced at 300 x 300 - change if different"]]);
  });
  it("the cross-talk rows keep their line byte for byte (00218 r121 identical with and without the change)", () => {
    expect(view(panel(R00218_121, withAdp5d({ floor: true })))).toEqual(view(panel(R00218_121, V53ADP)));
  });
  it("a stated size wins: 00215 r40 (200X200) stays 811", () => {
    expect(view(panel(R00215_40, withAdp5d({ floor: true })))).toEqual(view(panel(R00215_40, V53ADP)));
    expect(fig(panel(R00215_40, withAdp5d({ floor: true })))[2]).toBe(811);
  });
});
