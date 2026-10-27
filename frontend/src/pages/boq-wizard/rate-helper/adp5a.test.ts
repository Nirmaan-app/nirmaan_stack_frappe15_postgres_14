/**
 * ADP-5a (owner rulings 2026-10-22; SCOPE-5a-1 / SCOPE-5a-2 / HN-2 / HN-3) -- ADP RULES IN CODE AND CONFIG, ON HVAC v51.
 * The model's question is unchanged (the stub proof is in the mint; this file reads no extraction request). Every row
 * below is a REAL stored row -- its items, unit, text, headings and heading notes as the replay dump holds them -- with
 * the figures the replay gives, before and after.
 *
 *   AC1  a spigot whose row carries a butterfly damper item, or whose text / heading / heading note names a butterfly
 *        damper or says "spigot damper" / "spicot damper", prices as ONE Butterfly Damper With Spigot at the spigot's
 *        diameter; the absorbed damper item leaves the block list AND the edit state; a plain spigot stays a spigot;
 *   AC2  a curved grille whose damper is not mentioned takes "with" (its own amber line); a stated "without" wins; the
 *        other damper families keep "without" and their line, word for word;
 *   AC3  "SA / RA" and "supply cum return air" name both air streams; the note of the heading DIRECTLY above the row
 *        counts (HN-3) -- a farther heading's note does not;
 *   AC4  "A x B-C depth" is three box sides;
 *   AC5  the dead top-level depth_mm column definition is gone from v51; nothing in the pricing block moved.
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture, runParity } from "@/pages/pricing/calculatorPanelParity.harness";
import { DERIVATION_RULINGS, itemListRuleOrder } from "@/pages/pricing/rate-master/itemListRuleOrder";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, applyItemEdit, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { airStreamsNamed, applyFamilyMerge, itemListPricingSpec, readBoxSides, ruledDefaultValue } from "./itemListPricing";
import { mergeItemsByName } from "./rateHelperPlumbing";
import { isSuggestion, type ExtractionRow, type HelperResult } from "./rateHelperTypes";
import { rowHeadingNotes } from "./rateSuggestionModel";
import { CONFIGS as LIVE_CONFIGS } from "./adp3a.harness";
import type { PricedRow } from "../boqTypes";

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[]; intentional_removals?: string[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const V50 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v50.json")));
const V51 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v51.json")));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const cfgOf = (a: Asset, id: string) => a.category_configs.find((c) => c.category_id === id)!;
const configs = (a: Asset) => {
  const m = new Map<string, RateCategoryConfig>(LIVE_CONFIGS);
  for (const id of [ADP, INS, PIP]) m.set(id, cfgOf(a, id));
  return m;
};
const CFG51 = configs(V51), CFG50 = configs(V50);
const ITEMS: RateMasterItem[] = mergeItemsByName(V51.items.map((it) => ({ ...it, discipline: V51.discipline } as RateMasterItem)));
const RK = ["supply_rate", "install_rate", "combined_rate"];
const SPEC51 = itemListPricingSpec(cfgOf(V51, ADP))!;
const SPEC50 = itemListPricingSpec(cfgOf(V50, ADP))!;

const must = (r: HelperResult): ItemListSuggestion => { if (!isSuggestion(r)) throw new Error("expected a suggestion"); return r as ItemListSuggestion; };
const cells = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
interface Row { unit: string; description: string; headings?: string[]; ownNotes?: string[]; headingNotes?: string[]; items: Array<Record<string, string>> }
function panel(row: Row, cfg = CFG51, overrides: Record<string, string> = {}): ItemListSuggestion {
  const ext = new Map<number, ExtractionRow>([[1, { excelRow: 1, description: row.description, attributes: {}, items: row.items.map((a) => ({ attributes: cells(a) })) } as unknown as ExtractionRow]]);
  return must(makePricingSheetHelper({ configsByCategory: cfg, items: ITEMS, extractionByRow: ext })
    .compute({ excelRow: 1, description: row.description, nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: RK,
      headings: row.headings ?? [], ownNotes: row.ownNotes ?? [], headingNotes: row.headingNotes ?? [], unit: row.unit } as never, overrides));
}
function calculator(unit: string, blocks: Array<{ family: string; attrs: Record<string, string> }>): ItemListSuggestion {
  return must(makePricingSheetHelper({ configsByCategory: CFG51, items: ITEMS, extractionByRow: new Map() })
    .compute({ excelRow: 1, description: "", nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: RK } as never,
      { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: blocks.map((b) => ({ base: null, family: b.family, attrs: b.attrs })) }), [ROW_UNIT_OVERRIDE_KEY]: unit }));
}
const figs = (s: ItemListSuggestion) => [s.values.supply_rate, s.values.install_rate];
const fams = (s: ItemListSuggestion) => s.itemList!.items.map((b) => b.family);
const damperField = (s: ItemListSuggestion) => s.itemList!.items[0].fields.find((f) => f.id === "damper")!;

// ── the stored rows (replay dump, ADP-5a START; figures: replay before -> after) ──────────────────────────────────────
const R00341_103: Row = {   // 1,311 -> 1,015: the model returned a spigot AND a butterfly damper
  unit: "Nos.", description: "a) Supply & installation of 200 mm dia Spigot & Butterfly damper for rectangular duct. It should be of 22G.(120 GSM)",
  headings: ["AIR DISTRIBUTION"],
  items: [{ family: "spigot", damper: "None", air: "None", dia_mm: "200 mm dia", ul: "None", thickness_mm: "22G", variant: "None", qty_per_row_unit: "None" },
          { family: "butterfly damper", damper: "None", air: "None", dia_mm: "200 mm dia", ul: "None", thickness_mm: "22G", variant: "None", qty_per_row_unit: "None" }],
};
const R00231_257: Row = {   // 275 -> 725: a butterfly-damper HEADING (class ii)
  unit: "No", description: "Ø 150 mm dia",
  headings: ["AIR DISTRIBUTION", "SITC of round spigot with Butterfly Dampers as per the specifications & the sizes are as following below."],
  items: [{ family: "spigot", damper: "with", air: "None", dia_mm: "Ø 150 mm dia", ul: "None" }],
};
const R00278_71: Row = {   // 275 -> 725: "Spigot Damper" heading (class iii)
  unit: "Nos", description: "150 mm dia", headings: ["AIR DISTRUBTION SYSTEM", "Spigot Damper"],
  headingNotes: ["SITC of Spigot damper shall be installed from take off collar to diffuser/plenum boxes and at plenum boxes (low leakage) made out of 0.8mm galvanized sheet steel frame"],
  items: [{ family: "spigot", damper: "with", insulated: "None", air: "None", dia_mm: "150 mm dia", ul: "None", variant: "None", qty_per_row_unit: "None" }],
};
const R00313_94: Row = {   // 296 -> 1,015: "spicot damper" (the BoQ's spelling)
  unit: "Nos", description: "200 mm dia", headings: ["Supply & Fixing of GI round spicot damper for flexible duct connection"],
  items: [{ family: "spigot", damper: "with", air: "None", dia_mm: "200 mm dia", ul: "None", qty_per_row_unit: "None" }],
};
const R00341_62: Row = {   // 340 -> 340: a plain spigot ("dropper"); the "Spigot & Butterfly damper" note sits TWO levels up (HN-3)
  unit: "Nos.", description: "300Dia Dropper of length 150/200mm for round diffuser connection . Its should of 24G and Match Elliptical duct color.",
  headings: ["AIR DISTRIBUTION", "Supply, Installation, Testing and balancing of square type extruded aluminium powder coated diffusers for supply air"],
  headingNotes: ["Extruded Aluminium diffusers powder coated"],
  items: [{ family: "spigot", air: "None", size_mm: "length 150/200mm", dia_mm: "300Dia", ul: "None", thickness_mm: "24G" }],
};
const R00185_29: Row = {   // 6,390 -> 13,530: a curved grille, damper and air not mentioned
  unit: "Sqm", description: "The supply & installation of higher grade Aluminum Extruded powder coated grilles with blade deflection of 0 & 15 deg",
  headings: ["AIR DISTRIBUTION SYSTEM", "GRILLES - Al. CURVED"],
  items: [{ family: "curved grille", damper: "None", air: "None", ul: "None", qty_per_row_unit: "None" }],
};
const R00140_168: Row = {   // 6,390 -> 6,390: a curved grille the model answered "without" (the heading: "without Collar damper")
  unit: "Sqm", description: "100 mm wide",
  headings: ["SITC of the following items", "Return air Curved grilles with Zero deflection type of Powder coated high quality extruded aluminium construction without Collar damper of aluminium mounted directly on grilles."],
  items: [{ family: "curved grille", damper: "without", insulated: "None", air: "return", size_mm: "100 mm wide", ul: "None", variant: "None", qty_per_row_unit: "None" }],
};
const R00113_78: Row = {   // 12,428 -> 5,709: "SA / RA" in the row's own text
  unit: "Sqm", description: "Powder coated extruded Extruded Aluminium - linear grille for SA / RA - 100mm width Make: Air master / Caryaire / Ravistar",
  headings: ["AIR TERMINALS"],
  items: [{ family: "linear grille", damper: "None", insulated: "None", air: "supply", size_mm: "100mm width", ul: "None", qty_per_row_unit: "None" }],
};
const R00122_65: Row = {   // 12,428 -> 5,709: "supply cum return air" in the note of the heading directly above
  unit: "SqM", description: "i. 100/150/200/250 mm/600mmx600mm Grilles", headings: ["DUCTWORK/AIR TERMINALS", "LINEAR GRILLES"],
  headingNotes: ["Supply, Installation, Testing and Balancing of one way blow linear supply cum return air grilles complete with fixed core as per approved shop drawings and specifications. The grilles shall be of approved colour & shade.",
                 "Powder coated aluminium grilles of extruded sections with integral flanges on both sides & ends as required complete with corner pieces."],
  items: [{ family: "linear grille", damper: "None", air: "supply", size_mm: "100/150/200/250 mm/600mmx600mm", ul: "None" }],
};
const R00247_92: Row = {   // refused -> 2,306: "1200x150-300 depth"
  unit: "Nos", description: "GSS plenum boxes for fiing the diffusers along with openings for flexible ducts 1200x150-300 depth all the nescessary supports to be considered in the rate",
  headings: ["HVAC SYSTEM"],
  items: [{ family: "mixing box / LP plenum", damper: "None", air: "None", size_mm: "1200x150-300 depth", ul: "None", qty_per_row_unit: "None" }],
};
const R00247_94: Row = { ...R00247_92, description: R00247_92.description.replace("1200x150-300", "600x600-300"),
  items: [{ ...R00247_92.items[0], size_mm: "600x600-300 depth" }] };   // refused -> 2,787

describe("AC1 -- a spigot with a butterfly damper is ONE Butterfly Damper With Spigot, at the spigot's diameter", () => {
  const LINE = "spigot with butterfly damper named -> priced as one Butterfly Damper With Spigot";
  it("(a) the model returned both items (00341 r103): one block, 1,015 / 0, the line with the size; v50 priced two items, 1,247 / 64", () => {
    const s = panel(R00341_103);
    expect(fams(s)).toEqual(["butterfly damper"]);
    expect(figs(s)).toEqual([1015, 0]);
    const b = s.itemList!.items[0];
    expect(b.familyLine).toBe(`${LINE}, 200 mm`);
    expect(b.working[0]).toBe(`${LINE}, 200 mm`);
    expect(b.skuLine).toBe("Butterfly Damper With SPIGOT / 200 MM DIA (Nos)");
    // the absorbed item left the EDIT STATE too: the panel's one block is edit index 0, the spigot's own model item
    expect(s.itemList!.editState.items).toEqual([{ base: 0, family: null, attrs: {} }]);
    const before = panel(R00341_103, CFG50);
    expect(fams(before)).toEqual(["spigot", "butterfly damper"]);
    expect(figs(before)).toEqual([1247, 64]);
  });
  it("(a) the damper item's own size is not read: only the spigot's diameter prices", () => {
    const row = { ...R00341_103, items: [R00341_103.items[0], { ...R00341_103.items[1], dia_mm: "350 mm dia" }] };
    expect(figs(panel(row))).toEqual([1015, 0]);
  });
  it("(b) a butterfly-damper heading (00231 r257), 'Spigot Damper' (00278 r71), 'spicot damper' (00313 r94)", () => {
    expect(figs(panel(R00231_257))).toEqual([725, 0]);
    expect(figs(panel(R00231_257, CFG50))).toEqual([211, 64]);
    expect(figs(panel(R00278_71))).toEqual([725, 0]);
    expect(figs(panel(R00278_71, CFG50))).toEqual([211, 64]);
    expect(figs(panel(R00313_94))).toEqual([1015, 0]);
    expect(figs(panel(R00313_94, CFG50))).toEqual([232, 64]);
    expect(panel(R00313_94).itemList!.items[0].familyLine).toBe(`${LINE}, 200 mm`);
  });
  it("(b) the words are read from the note of the heading directly above too (HN-2 / HN-3)", () => {
    const row: Row = { ...R00278_71, headings: ["AIR DISTRUBTION SYSTEM", "Dampers"] };   // the heading's words moved into its note only
    expect(figs(panel(row))).toEqual([725, 0]);
    expect(figs(panel({ ...row, headingNotes: [] }))).toEqual([211, 64]);   // NEGATIVE: no words anywhere -> a plain spigot
  });
  it("NEGATIVE: a plain spigot stays a spigot (00341 r62, 340), its heading two levels up is not read", () => {
    const s = panel(R00341_62);
    expect(fams(s)).toEqual(["spigot"]);
    expect(figs(s)).toEqual([276, 64]);
    expect(s.itemList!.items[0].familyLine).toBeUndefined();
  });
  it("NEGATIVE: above the largest stocked diameter it still refuses (00144 r229, 400 mm)", () => {
    const s = panel({ unit: "Nos", description: "400 mm dia", headings: ["AIR TRANSFER GRILLES", "GI Spigot and Butterfly Dampers"], items: [{ family: "spigot", damper: "None", dia_mm: "400 mm dia" }] });
    expect(fams(s)).toEqual(["butterfly damper"]);
    expect(s.values.supply_rate).toBeUndefined();
    expect(s.itemList!.reason).toBe("diameter 400 is above the largest size on the sheet (350)");
  });
  it("the calculator: a spigot and a butterfly damper added by the pricer price as the same one item, the same sentence", () => {
    const c = calculator("nos", [{ family: "spigot", attrs: { dia_mm: "200" } }, { family: "butterfly damper", attrs: { dia_mm: "200" } }]);
    expect(fams(c)).toEqual(["butterfly damper"]);
    expect(figs(c)).toEqual([1015, 0]);
    expect(c.itemList!.items[0].familyLine).toBe(`${LINE}, 200 mm`);
    // NEGATIVE: a spigot alone in the calculator has no row text, so it stays a spigot
    expect(figs(calculator("nos", [{ family: "spigot", attrs: { dia_mm: "200" } }]))).toEqual([232, 64]);
  });
  it("an edit on the merged block reaches that block (the edit state the panel holds has no absorbed entry)", () => {
    const s = panel(R00341_103);
    const next = applyItemEdit(s.itemList!.editState, { op: "set_attr", index: 0, id: "dia_mm", value: "250" });
    const s2 = panel(R00341_103, CFG51, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(next) });
    expect(fams(s2)).toEqual(["butterfly damper"]);
    expect(figs(s2)).toEqual([1305, 0]);   // 900 x 1.45
  });
  it("PURE: applyFamilyMerge -- null without the key (v50) or without a match; the kept indices", () => {
    const it = (f: string) => ({ attributes: { family: { value: f } } });
    expect(applyFamilyMerge(SPEC50, [it("spigot"), it("butterfly damper")], "")).toBeNull();
    expect(applyFamilyMerge(SPEC51, [it("spigot")], "Supply of spigots")).toBeNull();
    expect(applyFamilyMerge(SPEC51, [it("butterfly damper")], "spigot damper")).toBeNull();
    const m = applyFamilyMerge(SPEC51, [it("linear grille"), it("butterfly damper"), it("spigot")], "")!;
    expect(m.kept).toEqual([0, 2]);
    expect(m.items.map((x) => x.attributes.family.value)).toEqual(["linear grille", "butterfly damper"]);
    expect(m.items[1].merged).toEqual({ from: "spigot", line: "spigot with butterfly damper named -> priced as one Butterfly Damper With Spigot", at: "dia_mm" });
    expect(applyFamilyMerge(SPEC51, [it("spigot")], "GI round SPICOT  DAMPER")!.kept).toEqual([0]);   // case and spacing
  });
});

describe("AC2 -- a curved grille takes a damper unless the BoQ says without; the other families are unchanged", () => {
  it("00185 r29: damper and air not mentioned -> with, amber, its own line; 13,530 (v50: without, 6,390)", () => {
    const s = panel(R00185_29);
    expect(figs(s)).toEqual([10730, 2800]);
    const f = damperField(s);
    expect(f.value).toBe("with");
    expect(f.defaulted).toBe(true);
    expect(f.rule).toBe("damper not mentioned (or not answered) on a curved grille = with");
    expect(figs(panel(R00185_29, CFG50))).toEqual([5510, 880]);
  });
  it("00302 r67 per number (576 -> 1,218)", () => {
    const s = panel({ unit: "Nos", description: "Powder coated extruded Extruded Aluminium - Curved linear grille for SA / RA-600(L)X150mm width Make: Air master / CleanAir / Ravistar",
      headings: ["AIR TERMINALS"], items: [{ family: "curved grille", damper: "None", air: "None", size_mm: "600(L)X150mm width", ul: "None", qty_per_row_unit: "None" }] });
    expect(figs(s)).toEqual([966, 252]);
  });
  it("NEGATIVE: the model's 'without' wins (00140 r168, the heading 'without Collar damper'): 6,390", () => {
    const s = panel(R00140_168);
    expect(figs(s)).toEqual([5510, 880]);
    expect(damperField(s).value).toBe("without");
    expect(damperField(s).defaulted).toBe(false);
  });
  it("NEGATIVE: a curved grille under return air no longer derives 'without' -- but a linear grille still does, with its line", () => {
    const cg = panel({ unit: "Sqm", description: "Curved grilles", items: [{ family: "curved grille", damper: "None", air: "return" }] });
    expect(damperField(cg).value).toBe("with");
    const lg = panel({ unit: "Sqm", description: "Linear grilles", items: [{ family: "linear grille", damper: "None", air: "return" }] });
    expect(damperField(lg).value).toBe("without");
    expect(figs(lg)).toEqual([4829, 880]);
  });
  it("NEGATIVE: every other damper family keeps 'without' and the line it always had, word for word", () => {
    for (const fam of ["linear grille", "floor grille", "slot diffuser", "square diffuser", "round diffuser"]) {
      expect({ fam, v: ruledDefaultValue(SPEC51, "damper", fam) }).toEqual({ fam, v: "without" });
      expect({ fam, v: ruledDefaultValue(SPEC50, "damper", fam) }).toEqual({ fam, v: "without" });
    }
    const lg = panel({ unit: "Sqm", description: "Linear grilles", items: [{ family: "linear grille", damper: "None", air: "None" }] });
    expect(damperField(lg).rule).toBe("damper not mentioned (or not answered) = without");
    expect(ruledDefaultValue(SPEC51, "damper", "curved grille")).toBe("with");
    expect(ruledDefaultValue(SPEC50, "damper", "curved grille")).toBe("without");
  });
});

describe("AC3 -- 'SA / RA', 'supply cum return air' and the immediate heading's note name both air streams", () => {
  const STREAMS = ["supply", "return", "exhaust", "fresh"];
  it("PURE: the two new spellings; 'Supply and installation' still names none", () => {
    expect([...airStreamsNamed("linear grille for SA / RA - 100mm width", STREAMS)].sort()).toEqual(["return", "supply"]);
    expect([...airStreamsNamed("one way blow linear supply cum return air grilles", STREAMS)].sort()).toEqual(["return", "supply"]);
    expect([...airStreamsNamed("Supply and installation of grilles", STREAMS)]).toEqual([]);
    expect([...airStreamsNamed("VISA / RATE", STREAMS)]).toEqual([]);   // capitals inside words are not the abbreviation
  });
  // a CODE rule: it reads v50's config the same way (the replay's START figure for this row, 12,428, is the code before it)
  it("00113 r78 ('SA / RA' in the row): the damper stays as read -- not mentioned -> without, 5,709 (START: with, 12,428)", () => {
    const s = panel(R00113_78);
    expect(figs(s)).toEqual([4829, 880]);
    expect(s.itemList!.items[0].working).toContain("BoQ names supply and return air -> damper as read (not mentioned -> without)");
    // NEGATIVE: the same row without "SA / RA" derives "with" from its supply air, 12,428
    expect(figs(panel({ ...R00113_78, description: R00113_78.description.replace(" for SA / RA", "") }))).toEqual([9628, 2800]);
  });
  it("00122 r65 (the note of the heading directly above): 5,709; NEGATIVE: without that note, 12,428", () => {
    expect(figs(panel(R00122_65))).toEqual([4829, 880]);
    expect(figs(panel({ ...R00122_65, headingNotes: [] }))).toEqual([9628, 2800]);
  });
  it("NEGATIVE: a row naming one stream keeps its derived damper, whatever the heading's note says", () => {
    const s = panel({ ...R00122_65, description: "Supply air linear grilles" });
    expect(figs(s)).toEqual([9628, 2800]);
  });
  // CERT-C5 / C5c (owner 2026-10-22): the page's rows carry NO `attached_notes` field -- a heading's note is its own committed
  // row, classified "note", whose effective parent is the heading. BEFORE (the C5 failure): the notes were read from the
  // parent's `attached_notes` field, which the live page never receives, so the live page saw none
  it("PURE: rowHeadingNotes reads the immediate parent only -- its appended values, its row note, then its note rows in row order", () => {
    const row = (i: number, p: number | null, cls: string, extra: Record<string, unknown> = {}) =>
      ({ row_index: i, effective_parent_index: p, effective_classification: cls, description: `r${i}`, ...extra }) as unknown as PricedRow;
    const rows = [
      row(1, null, "preamble"),
      row(2, 1, "note", { description: "the section's note: supply air, return air" }),   // two levels up from row 7: not read
      row(3, 1, "preamble", { row_notes: " own ", attached_notes: ["a field the page never receives"], append_notes_raw: { Remarks: "appended", Blank: "" } }),
      row(6, 3, "note", { description: " second note " }),
      row(4, 3, "note", { description: "first note" }),
      row(5, 3, "note", { description: "   " }),
      row(8, 3, "line_item", { description: "a sibling item is no note" }),
      row(7, 3, "line_item"),
    ];
    expect(rowHeadingNotes(rows[7], rows)).toEqual(["appended", "own", "first note", "second note"]);
    expect(rowHeadingNotes(rows[2], rows)).toEqual(["the section's note: supply air, return air"]);
    expect(rowHeadingNotes(rows[0], rows)).toEqual([]);
  });
  it("the live shape of BOQ-26-00122 'HVAC BOQ' r65: the note is committed row 62 under LINEAR GRILLES (row 60)", () => {
    const rows = [
      { row_index: 54, source_row_number: 60, effective_parent_index: 20, effective_classification: "preamble", description: "LINEAR GRILLES", row_notes: null, append_notes_raw: null },
      { row_index: 56, source_row_number: 62, effective_parent_index: 54, effective_classification: "note", description: R00122_65.headingNotes![0], row_notes: null, append_notes_raw: null },
      { row_index: 57, source_row_number: 63, effective_parent_index: 54, effective_classification: "note", description: R00122_65.headingNotes![1], row_notes: null, append_notes_raw: null },
      { row_index: 59, source_row_number: 65, effective_parent_index: 54, effective_classification: "line_item", description: R00122_65.description, row_notes: null, append_notes_raw: null },
    ] as unknown as PricedRow[];
    const notes = rowHeadingNotes(rows[3], rows);
    expect(notes).toEqual(R00122_65.headingNotes);
    expect(figs(panel({ ...R00122_65, headingNotes: notes }))).toEqual([4829, 880]);
  });
});

describe("AC4 -- 'A x B-C depth' is three box sides", () => {
  it("PURE: readBoxSides splits the depth off the second part; a plain two-part size reads as before", () => {
    expect(readBoxSides("1200x150-300 depth")).toEqual({ length: { part: "1200", how: "by position" }, width: { part: "150", how: "by position" }, height: { part: "300 depth", how: "as written" } });
    expect(readBoxSides("600x600-300 depth")?.height).toEqual({ part: "300 depth", how: "as written" });
    expect(readBoxSides("600 x 450")).toEqual({ length: { part: "600", how: "by position" }, width: { part: "450", how: "by position" } });
    expect(readBoxSides("1200x150-300")?.height).toBeUndefined();   // NEGATIVE: no height label -- not split, read as before
  });
  it("00247 r92 / r94 price (refused at START): 2,306 and 2,787, the three boxes filled", () => {
    const s = panel(R00247_92);
    expect(figs(s)).toEqual([2306, 0]);
    const f = (id: string) => s.itemList!.items[0].fields.find((x) => x.id === id);
    expect([f("plenum_length_mm")?.value, f("plenum_width_mm")?.value, f("plenum_height_mm")?.value]).toEqual(["1200", "150", "300"]);
    expect(figs(panel(R00247_94))).toEqual([2787, 0]);
    // NEGATIVE: a range with no height label is not split -- the row still refuses for want of a width
    const r = panel({ ...R00247_92, items: [{ ...R00247_92.items[0], size_mm: "1200x150-300" }] });
    expect(r.values.supply_rate).toBeUndefined();
  });
});

describe("AC5 -- the dead depth_mm column definition is gone; the pricing block did not move", () => {
  const adp50 = cfgOf(V50, ADP) as any, adp51 = cfgOf(V51, ADP) as any;
  it("v51 drops only depth_mm from the top-level definitions, and declares the removal", () => {
    expect(adp50.attribute_definitions.map((d: any) => d.id).filter((id: string) => id !== "depth_mm")).toEqual(adp51.attribute_definitions.map((d: any) => d.id));
    expect(adp51.attribute_definitions.map((d: any) => d.id)).not.toContain("depth_mm");
    expect(V51.intentional_removals).toEqual([...(V50.intentional_removals ?? []), "attr:hvac_adp:depth_mm"]);
    expect(V51.items.filter((i) => "depth_mm" in (i.attributes ?? {}))).toEqual([]);
  });
  it("NEGATIVE: the model's definitions are byte-equal, and the pricing block differs only by the three ADP-5a keys", () => {
    expect(JSON.stringify(adp51.list_spec.attribute_definitions)).toBe(JSON.stringify(adp50.list_spec.attribute_definitions));
    const p50 = { ...adp50.list_spec.pricing }, p51 = { ...adp51.list_spec.pricing };
    for (const k of ["defaults", "derive_when_none", "family_merge"]) { delete p50[k]; delete p51[k]; }
    expect(JSON.stringify(p51)).toBe(JSON.stringify(p50));
    for (const id of [INS, PIP]) expect(JSON.stringify(cfgOf(V51, id))).toBe(JSON.stringify(cfgOf(V50, id)));
  });
});

describe("AC8 -- parity: the calculator, fed the panel's own blocks, gives the same price and the same lines", () => {
  const P = (name: string, row: Row) => [name, { cat: ADP, unit: row.unit, desc: row.description, attrs: {}, items: row.items, headings: row.headings ?? [], ownNotes: row.ownNotes ?? [] }] as const;
  it.each([
    P("AC1 (a) 00341 r103", R00341_103), P("AC1 (b) 00231 r257", R00231_257), P("AC1 (b) 00313 r94", R00313_94),
    P("AC2 00185 r29", R00185_29), P("AC2 neg 00140 r168", R00140_168), P("AC3 00113 r78", R00113_78), P("AC4 00247 r92", R00247_92),
  ])("%s: no divergence", (_n, c) => {
    const r = runParity(CFG51, ITEMS, c, "full");
    expect(r.divergences).toEqual([]);
    expect(isSuggestion(r.panel) && isSuggestion(r.calculator)).toBe(true);
  });
  it("the same two items typed in the calculator give the panel's one item, price and sentence (00341 r103)", () => {
    // the harness feeds the calculator the panel's RESOLVED block (one butterfly damper), so it has no spigot to merge; the
    // case a pricer types is the two items the BoQ named
    const p = panel(R00341_103);
    const c = calculator("nos", [{ family: "spigot", attrs: { dia_mm: "200" } }, { family: "butterfly damper", attrs: { dia_mm: "200" } }]);
    expect(figs(c)).toEqual(figs(p));
    expect(c.itemList!.items.map((b) => b.familyLine)).toEqual(p.itemList!.items.map((b) => b.familyLine));
    expect(c.itemList!.items[0].skuLine).toBe(p.itemList!.items[0].skuLine);
  });
});

describe("AC8 -- the Derivation tab says each rule, with its reason", () => {
  const tab = itemListRuleOrder(cfgOf(V51, ADP), ITEMS);
  const line = (t: string) => tab.find((l) => l.title === t);
  it("the spigot line is new and LAST, with its rulings quoted; v50's tab lacks it", () => {
    const t = "A spigot named with a butterfly damper is priced as one butterfly damper";
    expect(tab[tab.length - 1].title).toBe(t);
    expect(line(t)!.reason).toBe(DERIVATION_RULINGS.hvac_adp_item.family_merge);
    expect(line(t)!.detail).toContain("'butterfly damper', 'spigot damper', 'spicot damper'");
    expect(line(t)!.detail).toContain("priced at the spigot's diameter");
    expect(itemListRuleOrder(cfgOf(V50, ADP), ITEMS).map((l) => l.title)).not.toContain(t);
  });
  it("the defaults line names the curved grille's 'with' and its reason; v50's says no such thing", () => {
    const d = line("A fact the row does not mention takes its ruled value")!;
    expect(d.detail).toContain("fresh -> without (not on curved grille)");
    expect(d.detail).toContain("on every other kind -> without (curved grille: with)");
    expect(d.reason).toBe(DERIVATION_RULINGS.hvac_adp_item.defaults_by_family);
    const d50 = itemListRuleOrder(cfgOf(V50, ADP), ITEMS).find((l) => l.title === "A fact the row does not mention takes its ruled value")!;
    expect(d50.detail).not.toContain("curved grille: with");
    expect(d50.reason).toBe(DERIVATION_RULINGS.hvac_adp_item.defaults);
  });
  it("the both-streams line and the sizes line carry the new words and reasons", () => {
    expect(tab.find((l) => l.title.startsWith("A row naming supply and return air"))!.detail).toContain("'supply cum return air' and 'SA / RA' name both streams");
    expect(tab.find((l) => l.title.startsWith("The sizes are typed"))!.detail).toContain("'1200x150-300 depth' -> 1200 / 150 / 300");
  });
});
