/**
 * SLICE 12e-6 Part 1 (owner rulings 2026-10-16) -- THE PRICER'S SHARE OF THE STAGE B FIXES. No model is asked here.
 * Every model answer is one a run stored (copied as stored, row named) or a hand-built answer in the same shape,
 * marked SYNTHETIC. Rules are tested from the PANEL'S ENTRY POINT (`makePricingSheetHelper(...).compute`).
 *
 * Owner addendum 2026-10-16 14:43: every insulation fix (AC1, AC2, AC4, AC5, AC6, AC8, AC9 a / c) is tested on BOTH
 * paths -- the Insulation category's OWN row and the insulation SECTION inside a Piping row -- positive and negative.
 * AC3 and AC7 are Piping-only; AC9 b is the Piping section's.
 *
 *   AC1 (R7 "mm = NB")  the cladding girth on the MATCHED size unless the size is an outside diameter (OD / inch / copper)
 *   AC2 (12d-1a)        "none of these" with NO material named -> the row-kind default, amber
 *   AC3 (D1b / D5b)     "Insulated: Yes" with no insulation item -> the section on Insulation's defaults
 *   AC4                 fixings and duct material are not a cladding word
 *   AC5                 Nitrile Rubber per sq.m -> Thermal Nitrile (and the reverse), with "(row is per ...)"
 *   AC6 (R1 R3 R8 R5 R4) alternatives; XLPE aliases; a coating with no glass cloth
 *   AC7 (R2, amended 14:22) two stocked pipe types: CPVC with PVC / uPVC -> CPVC; any other pair -> the lower cost
 *   AC8 (R10)           a thickness range -> the higher, in the or / slash rule's words
 *   AC9                 (a) composed cladding "No"; (b) a pipe above its largest -> the section repeats it; (c) the cladding line
 *
 * Priced against the v42 asset (live on dev until v43, which changes notes only).
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper,
  type ItemBlockView, type ItemListEditState, type ItemListSuggestion, type ItemListView, type SectionBlockView,
} from "./pricingSheetHelper";
import {
  alternativeMaterials, cheaperAlternatives, claddingLabel, coatingOnlyRefusal, itemListPricingSpec, listSpecDefs, priceItemList,
  readNumber, sizeIsOutsideDiameter, withoutFixingWords, xlpeAliasRefusal, type NumberReader,
} from "./itemListPricing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const V42 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v42.json`, import.meta.url));
const ITEMS: RateMasterItem[] = V42.items.map((it) => ({ ...it, discipline: V42.discipline } as RateMasterItem));
const CONFIGS = new Map<string, RateCategoryConfig>(V42.category_configs.map((c) => [c.category_id, c]));
const INS = "hvac_insulation", PIP = "hvac_piping";
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
const NR = "Nitrile Rubber Insulation", THM = "Thermal Nitrile Insulation", ACO = "Acoustic Nitrile Insulation";
const FGB = " Fiberglass Rigid Board Insulation, Density 48Kg/m3";
const SEC = "insulation";
const INS_SPEC = itemListPricingSpec(CONFIGS.get(INS)!)!;
const PIP_SPEC = itemListPricingSpec(CONFIGS.get(PIP)!)!;

type Answer = Record<string, string | null>;
function stored(category: string, a: Answer): { attributes: ExtractionRow["attributes"]; section?: string } {
  const { section, ...given } = a;
  const own = section ? listSpecDefs(CONFIGS.get(INS)!) : listSpecDefs(CONFIGS.get(category)!);
  const attributes: Record<string, { value: string | null; confidence: number }> = {};
  for (const d of own) attributes[d.id] = { value: null, confidence: 0 };
  for (const [k, v] of Object.entries(given)) attributes[k] = { value: v, confidence: 0.9 };
  return { attributes: attributes as ExtractionRow["attributes"], ...(section ? { section } : {}) };
}
type Shown = { v: ItemListView; values: ItemListSuggestion["values"] };
function panel(category: string, answer: Answer[], unit: string, desc = "", headings: string[] = [], ownNotes: string[] = []): Shown {
  const row = { excelRow: 1, description: desc, attributes: {}, items: answer.map((a) => stored(category, a)) } as unknown as ExtractionRow;
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx = { excelRow: 1, description: desc, nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS], unit, headings, ownNotes } as RateHelperRowContext & { unit?: string };
  const r = h.compute(ctx, {});
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { v: s.itemList!, values: s.values };
}
function calc(category: string, state: ItemListEditState, unit = "mts"): Shown {
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
  const ctx: RateHelperRowContext = { excelRow: 1, description: "", nodeType: "Line Item", category, discipline: "HVAC", rateKinds: [...KINDS] };
  const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: unit });
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { v: s.itemList!, values: s.values };
}
/** The Insulation row's own figures through the PURE pricer, over the same answer (the panel must equal it). */
function pure(answer: Answer, unit: string, desc = "", headings: string[] = [], ownNotes: string[] = []): [number | undefined, number | undefined] {
  const r = priceItemList(INS_SPEC, ITEMS, unit, [{ attributes: stored(INS, answer).attributes }] as never,
    [desc, ...headings].join(" | "), [desc, ...ownNotes].join(" | "));
  return r.priced ? [r.supply, r.install] : [undefined, undefined];
}
const field = (b: ItemBlockView, id: string) => b.fields.find((f) => f.id === id)!;
const fig = (values: Partial<Record<string, number>> | undefined): [number | undefined, number | undefined] => [values?.supply_rate, values?.install_rate];
const attached = (v: ItemListView, at = 0): SectionBlockView => v.items[at].sections![0];
const secBlock = (sv: SectionBlockView): ItemBlockView => sv.view.items[0];
const working = (b: ItemBlockView): string[] => b.working.map((w) => w.trim());
const allWorking = (v: ItemListView): string[] => v.items.flatMap((b) => [...working(b), ...(b.sections ?? []).flatMap((sv) => sv.view.items.flatMap(working))]);

/** BOTH PATHS for one insulation answer: the Insulation row (per metre) and the same answer as the section of an MS pipe. */
function both(ins: Answer, pipe: Answer = { pipe_type: "MS", pipe_type_as_written: "MS", size_mm: "50", insulated: "Yes" }, desc = "", headings: string[] = [], ownNotes: string[] = []) {
  const own = panel(INS, [ins], "RMT", desc, headings, ownNotes);
  const sec = panel(PIP, [pipe, { section: SEC, ...ins }], "RMT", desc, headings, ownNotes);
  return { own, ownB: own.v.items[0], sec, secB: secBlock(attached(sec.v)), secV: attached(sec.v).view };
}
const NIT = (over: Answer = {}): Answer => ({ item: NR, cladding: "26G Aluminium", cladding_as_written: null, thickness_mm: "19 mm", pipe_size_mm: "50 mm", brand: null, material_as_written: "nitrile rubber", ...over });

// =====================================================================================================
// AC1 -- R7 "mm = NB": the cladding girth on the MATCHED size; an outside diameter keeps the size as read
// =====================================================================================================
describe("AC1 one size treatment for mm / NB / mm dia / mm NB (owner R7)", () => {
  // BOQ-26-00169 / HVAC rows 81-84, AS STORED (Insulation rows): "50 mm NB" etc., 25 mm nitrile, foil -> 26G
  const R169 = (pipe: string): Answer => ({ item: NR, cladding: "Aluminium Foil", cladding_as_written: "aluminum foiled laminated", thickness_mm: "25 mm", pipe_size_mm: pipe, brand: null, material_as_written: "closed Cell Factory aluminum foiled laminated Nitrile rubber (class-0)" });
  const H169 = ["CHILLED WATER WORKS", "Supply & Installation of 25 mm thick insulation using closed Cell Factory aluminum foiled laminated Nitrile rubber (class-0) with insulation in pipe sections stuck to the pipe & fixtures using manufacturer approved cold adhesive on both outerface of the pipe and inner face of the pipe section"];
  it("00169 rows 81-84 (\"50 mm NB\" ...): the matched size; 633 -> 643, 572 -> 574, 538 -> 545, 500 -> 510; panel = pure", () => {
    for (const [nb, matched, supply] of [["50 mm NB", 53.98, 643], ["40 mm NB", 41.28, 574], ["32 mm NB", 34.93, 545], ["25 mm NB", 28.58, 510]] as Array<[string, number, number]>) {
      const r = panel(INS, [R169(nb)], "Rmt", nb, H169);
      expect(fig(r.values), nb).toEqual([supply, 224]);
      expect(fig(r.values), nb).toEqual(pure(R169(nb), "Rmt", nb, H169));
      expect(working(r.v.items[0]), nb).toContain(`cladding: measured on the matched size ${matched} (mm = NB: the size as read, ${parseFloat(nb)}, is not an outside diameter)`);
    }
  });
  it("BOTH PATHS: '50 mm dia' (Insulation row) and an MS 50 pipe's section -- the matched size, the same line", () => {
    const b = both(NIT({ pipe_size_mm: "50 mm dia" }));
    const line = "cladding: measured on the matched size 53.98 (mm = NB: the size as read, 50, is not an outside diameter)";
    expect(working(b.ownB)).toContain(line);
    expect(working(b.secB)).toContain(line);
    expect(fig(b.own.values)).toEqual(fig(b.secV.totals));
  });
  it("NEGATIVE BOTH PATHS: an OUTSIDE diameter keeps the size as read -- 'O.D.' on the row, a Copper pipe above the section", () => {
    const own = panel(INS, [NIT({ pipe_size_mm: "50 mm O.D." })], "RMT");
    expect(working(own.v.items[0])).toContain("cladding: measured on the pipe size as read 50 (not the 53.98 it was priced at) + 2 x 19 (the thickness) = 88 mm");
    const sec = panel(PIP, [{ pipe_type: "Copper", size_mm: "40", insulated: "Yes" }, { section: SEC, ...NIT({ pipe_size_mm: null }) }], "RMT");
    expect(working(secBlock(attached(sec.v)))).toContain("cladding: measured on the pipe size as read 40 (not the 41.28 it was priced at) + 2 x 19 (the thickness) = 78 mm");
    // ... and an Insulation row of its own under a copper / refrigerant heading, and an inch size
    expect(working(panel(INS, [NIT({ pipe_size_mm: "40 mm" })], "RMT", "", ["REFRIGERANT PIPING"]).v.items[0]).some((w) => w.includes("as read 40"))).toBe(true);
    expect(sizeIsOutsideDiameter('1-1/2"')).toBe(true);
    expect(sizeIsOutsideDiameter("22.3 mm OD")).toBe(true);
    for (const t of ["50 mm", "50 NB", "50 mm NB", "50mm. Dia", "50 mm dia", "65 nb"]) expect(sizeIsOutsideDiameter(t), t).toBe(false);
  });
  it("NEGATIVE: an exact match and a size within 0.1 mm say nothing -- the config's own girth step", () => {
    for (const p of ["53.98 mm", "54 mm"]) {
      const r = panel(INS, [NIT({ pipe_size_mm: p })], "RMT");
      expect(working(r.v.items[0]).some((w) => w.startsWith("cladding: measured")), p).toBe(false);
    }
  });
});

// =====================================================================================================
// AC2 -- "none of these" with NO material named -> the row-kind default
// =====================================================================================================
describe("AC2 'none of these' where the BoQ names no material (12d-1a)", () => {
  // BOQ-26-00261 / HVAC HIGH SIDE Works row 38, AS STORED: 'none of these', no material, no thickness, "50 mm dia"
  const R261: Answer = { item: "none of these", cladding: "None", cladding_as_written: null, thickness_mm: null, pipe_size_mm: "50 mm dia", brand: null, material_as_written: null };
  it("00261 row 38: priced as Nitrile Rubber (default, amber, its line) at 9 -> 13 mm, no cladding: 348 / 14; panel = pure", () => {
    const r = panel(INS, [R261], "Rmt", "50 mm dia", ["CHILLED WATER PIPING WORKS"]);
    expect(r.v.items[0].family).toBe(NR);
    expect(r.v.items[0].familyDefaulted?.value).toBe(NR);
    expect(fig(r.values)).toEqual([348, 14]);
    expect(fig(r.values)).toEqual(pure(R261, "Rmt", "50 mm dia", ["CHILLED WATER PIPING WORKS"]));
  });
  it("BOTH PATHS: the section inside a Piping row takes the same default (00185 / 00281 row 66 shape)", () => {
    const b = both({ ...R261, pipe_size_mm: null });
    expect([b.ownB.family, b.secB.family]).toEqual([NR, NR]);
    expect(b.secB.familyDefaulted?.value).toBe(NR);
  });
  it("NEGATIVE BOTH PATHS: a material NAMED keeps the refusal -- copied as written, or an unstocked word in the row or its headings", () => {
    const b = both({ ...R261, material_as_written: "rockwool slab" });
    expect(b.ownB.reason).toBe("No SKU in the catalogue for rockwool slab - price this row by hand");
    expect(b.secB.reason).toBe("No SKU in the catalogue for rockwool slab - price this row by hand");
    const h = both(R261, undefined, "", ["EPDM insulation"]);
    expect(h.ownB.reason).toBe("no SKU in the catalogue for 'none of these' -- the user decides");
    expect(h.secB.reason).toBe("no SKU in the catalogue for 'none of these' -- the user decides");
  });
});

// =====================================================================================================
// AC3 -- "Insulated: Yes" with no insulation item -> the section on Insulation's defaults (Piping only)
// =====================================================================================================
describe("AC3 the defaulted section (owner D1b / D5b)", () => {
  // BOQ-26-00273 / (CHW BOQ) AHU & Low Side row 202, AS STORED: GI class 'B' 50 mm dia, Insulated Yes, no insulation item
  const P273: Answer = { pipe_type: null, pipe_type_as_written: "GI", size_mm: "50 mm dia", pipe_class: "class 'B'", insulated: "Yes" };
  it("00273 row 202: the section prices on its defaults -- Nitrile (amber), 9 -> 13 mm (amber), cladding No (amber); row 1,332 / 294", () => {
    const r = panel(PIP, [P273], "Rmt", "50 mm dia", ["CHILLED WATER PIPING WORKS", "GI class 'B' Pipes with 9mm thick insulation"]);
    const sb = secBlock(attached(r.v));
    expect(sb.familyDefaulted?.value).toBe(NR);
    expect(field(sb, "cladding")).toMatchObject({ value: "No", defaulted: true });
    expect(field(sb, "thickness_mm").defaulted).toBe(true);
    expect(working(sb)).toContain("cladding not mentioned -> No (without cladding)");
    expect(JSON.stringify(r.v)).not.toContain("could not tell cladding");
    expect(fig(r.values)).toEqual([1332, 294]);
  });
  it("NEGATIVE: the calculator keeps 'choose the material' (D1b), and a model 'No' opens no section", () => {
    const c = calc(PIP, { items: [{ base: null, family: "MS", attrs: { size_mm: "50", insulated: "Yes" }, other: ["size_mm"] }] } as unknown as ItemListEditState);
    expect(attached(c.v).view.pickFamily).toBe(true);
    const no = panel(PIP, [{ ...P273, insulated: "No" }], "Rmt");
    expect(no.v.items[0].sections).toBeUndefined();
  });
});

// =====================================================================================================
// AC4 -- fixings and duct material are not a cladding word
// =====================================================================================================
describe("AC4 the 'cladding named in this row but not read' words", () => {
  // BOQ-26-00117 / HVAC BOQ row 189, AS STORED (Acoustic, "GI strip as at a grid distance of 1m X 1 m")
  const D117 = "Supply & fixing of Acoustic insulation for wall acoustics using Open cell with 30 mm thick class 1 rating open cell nitrile rubber with density of 140 - 180 kg / m³. Adhesive should be of low VOC level . The Insulation to be provided with GI strip as at a grid distance of 1m X 1 m .Material should be Antimicrobial";
  const A117: Answer = { item: ACO, cladding: "None", cladding_as_written: null, thickness_mm: "30 mm", pipe_size_mm: null, brand: null, material_as_written: "open cell nitrile rubber" };
  it("00117 row 189: priced, cladding No (amber): 2,742 / 308; panel = pure", () => {
    const r = panel(INS, [A117], "Sqm", D117, ["INSULATION WORKS"]);
    expect(r.v.rowPriced).toBe(true);
    expect(fig(r.values)).toEqual([2742, 308]);
    expect(fig(r.values)).toEqual(pure(A117, "Sqm", D117, ["INSULATION WORKS"]));
  });
  it("BOTH PATHS: a pipe row whose own text names GI clamps, a 'C' shape GI frame and an aluminium duct -- the section prices", () => {
    const desc = "50 mm dia with GI clamps, 'C' shape GI frame, near the aluminium and GI duct";
    const b = both(NIT({ cladding: "None", pipe_size_mm: null }), undefined, desc);
    expect(b.secV.rowPriced).toBe(true);
    const own = panel(INS, [NIT({ cladding: "None" })], "RMT", desc);
    expect(own.v.rowPriced).toBe(true);
    expect(withoutFixingWords(desc)).not.toMatch(/gi frame|aluminium and gi duct|gi clamps/i);
  });
  it("NEGATIVE BOTH PATHS: a word that names a cladding still refuses -- aluminium sheet, glass cloth, a perforated sheet, 'cladding'", () => {
    for (const desc of ["with 26G aluminium sheet", "with glass cloth", "GI framework with perforated sheet", "with cladding"]) {
      const b = both(NIT({ cladding: "None", pipe_size_mm: null }), undefined, desc);
      expect(b.secB.reason, desc).toBe("cladding named in this row but not read - set the cladding");
      expect(panel(INS, [NIT({ cladding: "None" })], "RMT", desc).v.items[0].reason, desc).toBe("cladding named in this row but not read - set the cladding");
    }
  });
});

// =====================================================================================================
// AC5 -- a row-kind family on the other row kind
// =====================================================================================================
describe("AC5 Nitrile Rubber per sq.m -> Thermal Nitrile, and the reverse", () => {
  // BOQ-26-00140 / PAC Works row 70, AS STORED: Nitrile Rubber Insulation on a per-Sqm row, 13 mm, factory laminated foil
  const A140: Answer = { item: NR, cladding: "Aluminium Foil", cladding_as_written: "factory laminated Aluminium foil", thickness_mm: "13 mm", pipe_size_mm: null, brand: null, material_as_written: "Class 'O' Elastomeric Nitrile rubber insulation" };
  it("00140 PAC Works row 70: priced as Thermal Nitrile Insulation with the line: 581 / 154; panel = pure", () => {
    const r = panel(INS, [A140], "Sqm");
    expect(r.v.items[0].family).toBe(THM);
    expect(r.v.items[0].familyLine).toBe("priced as Thermal Nitrile Insulation (row is per sq.m)");
    expect(fig(r.values)).toEqual([581, 154]);
    expect(fig(r.values)).toEqual(pure(A140, "Sqm"));
  });
  it("BOTH PATHS (the reverse, per metre): Thermal Nitrile on an Insulation row per metre and in a pipe's section -> Nitrile Rubber", () => {
    const b = both(NIT({ item: THM }));
    expect([b.ownB.family, b.secB.family]).toEqual([NR, NR]);
    expect([b.ownB.familyLine, b.secB.familyLine]).toEqual(["priced as Nitrile Rubber Insulation (row is per metre)", "priced as Nitrile Rubber Insulation (row is per metre)"]);
  });
  it("NEGATIVE BOTH PATHS: a family OUTSIDE the row-kind pair is untouched (Acoustic per metre still has no SKU)", () => {
    const b = both(NIT({ item: ACO }));
    expect(b.ownB.reason).toBe("no SKU per metre for Acoustic Nitrile Insulation");
    expect(b.secB.reason).toBe("no SKU per metre for Acoustic Nitrile Insulation");
  });
});

// =====================================================================================================
// AC6 -- R1 / R3 alternatives; R8 / R5 XLPE; R4 a coating with no glass cloth
// =====================================================================================================
describe("AC6 (a) R1: an unstocked material beside a stocked one prices the stocked one", () => {
  it("BOOK ROW 00086 / High side row 104 (copper 15.9 O.D., 'nitrile rubber/XLPE'): the section prices with the R1 line -- 1,595 / 304", () => {
    const pipe: Answer = { pipe_type: "Copper", pipe_type_as_written: "COPPER", size_mm: "15.9 mm O.D.", pipe_class: null, insulated: "Yes" };
    const ins: Answer = { section: SEC, item: NR, cladding: "Glass Cloth with paint", cladding_as_written: "two coats of 500 micron (0.5 mm) WFT Flame Retardant coating", thickness_mm: "19mm", pipe_size_mm: "15.9 mm O.D.", brand: null, material_as_written: "closed cell elastomeric nitrile rubber/XLPE tubular insulation" };
    const r = panel(PIP, [pipe, ins], "RM", "15.9 mm O.D. (with 19mm insulation)", ["COPPER REFRIGERANT PIPING"]);
    expect(secBlock(attached(r.v)).familyLine).toBe("BoQ says closed cell elastomeric nitrile rubber/XLPE tubular insulation -> priced as Nitrile Rubber Insulation");
    expect(fig(r.values)).toEqual([1595, 304]);
  });
  it("BOTH PATHS: 'XLPE / nitrile' and 'rockwool/glasswool' price the stocked one", () => {
    const b = both(NIT({ material_as_written: "XLPE / nitrile" }));
    expect([b.ownB.familyLine, b.secB.familyLine]).toEqual(["BoQ says XLPE / nitrile -> priced as Nitrile Rubber Insulation", "BoQ says XLPE / nitrile -> priced as Nitrile Rubber Insulation"]);
    const g = panel(INS, [{ item: "none of these", cladding: "No", thickness_mm: "25 mm", material_as_written: "rockwool/glasswool" }], "Sqm");
    expect(g.v.items[0].family).toBe(FGB);
    expect(g.v.rowPriced).toBe(true);
  });
  it("NEGATIVE BOTH PATHS: an unstocked material with no stocked alternative still refuses by name", () => {
    const b = both(NIT({ material_as_written: "XLPE tubular insulation" }));
    expect(b.ownB.reason).toBe("No SKU in the catalogue for XLPE tubular insulation - price this row by hand");
    expect(b.secB.reason).toBe("No SKU in the catalogue for XLPE tubular insulation - price this row by hand");
    // a slash inside a density is not an alternative ("80 Kg / cub mt. density rock wool")
    expect(alternativeMaterials(INS_SPEC, "80 Kg / cub mt. density rock wool with RP tissue", "area")).toBeNull();
  });
});

describe("AC6 (b) R3: two stocked materials -> the lower cost", () => {
  // BOQ-26-00285 / HVAC row 19, AS STORED: "Open-cell acoustic foam / 32 kg/m³ fiberglass board", 25 mm, perforated sheet
  const A285: Answer = { item: ACO, cladding: "GI Framework with perforated Al sheet", cladding_as_written: "24G perforated aluminum sheet casing", thickness_mm: "25 mm thick", pipe_size_mm: null, brand: null, material_as_written: "Open-cell acoustic foam / 32 kg/m³ fiberglass board" };
  it("00285 row 19: the fiberglass board is cheaper: 3,146 / 518 -> 1,346 / 385, with the line; panel = pure", () => {
    const r = panel(INS, [A285], "Sqm");
    expect(r.v.items[0].family).toBe(FGB);
    expect(r.v.items[0].familyLine).toBe("BoQ allows Open-cell acoustic foam / 32 kg/m³ fiberglass board -> priced as Fiberglass Rigid Board Insulation, Density 48Kg/m3, the lower cost");
    expect(fig(r.values)).toEqual([1346, 385]);
    expect(fig(r.values)).toEqual(pure(A285, "Sqm"));
  });
  it("BOTH PATHS: two stocked pipe materials (nitrile / PUF) on a pipe row and in a section -> the lower cost, the same family", () => {
    const b = both(NIT({ thickness_mm: "50 mm", material_as_written: "nitrile rubber / PUF" }));
    expect(b.ownB.familyLine).toMatch(/^BoQ allows nitrile rubber \/ PUF -> priced as .*, the lower cost$/);
    expect(b.secB.family).toBe(b.ownB.family);
  });
  it("NEGATIVE: one stocked material named twice is not two alternatives (no line)", () => {
    expect(alternativeMaterials(INS_SPEC, "Closed cell Nitrile rubber based /Site Adhesive elastomeric insulation", "area")).toBeNull();
    const b = both(NIT({ material_as_written: "nitrile rubber / elastomeric" }));
    expect([b.ownB.familyLine ?? null, b.secB.familyLine ?? null]).toEqual([null, null]);
  });
});

describe("AC6 (c) / (d) R8 / R5: XLPE aliases refuse by name, before the closed-cell-polyethylene map", () => {
  it("BOTH PATHS: 'closed cell cross-linked polyethylene', 'FR-XPE', a 'co-extruded polymer jacket' refuse by name as XLPE", () => {
    for (const [attr, said, want] of [
      ["material_as_written", "closed cell cross-linked polyethylene", "No SKU in the catalogue for closed cell cross-linked polyethylene (XLPE) - price this row by hand"],
      ["material_as_written", "Cross Linked Closed Cell Polyethylene FR-XPE", "No SKU in the catalogue for Cross Linked Closed Cell Polyethylene FR-XPE (XLPE) - price this row by hand"],
      ["cladding_as_written", "co-extruded polymer jacket", "No SKU in the catalogue for co-extruded polymer jacket (XLPE) - price this row by hand"],
    ] as const) {
      const b = both(NIT({ item: "none of these", [attr]: said }));
      expect([b.ownB.reason, b.secB.reason], said).toEqual([want, want]);
    }
  });
  it("NEGATIVE BOTH PATHS: plain 'closed cell polyethylene' keeps the 12e-5b R5 map to nitrile", () => {
    const b = both(NIT({ item: "none of these", material_as_written: "closed cell polyethylene" }));
    expect([b.ownB.familyLine, b.secB.familyLine]).toEqual(["BoQ says closed cell polyethylene -> priced as Nitrile Rubber Insulation", "BoQ says closed cell polyethylene -> priced as Nitrile Rubber Insulation"]);
    expect(xlpeAliasRefusal(INS_SPEC, { attributes: { material_as_written: { value: "nitrile / XPE" } } } as never, "")).toBeNull();
  });
});

describe("AC6 (e) R4: a coating with no glass cloth refuses by name", () => {
  // BOQ-26-00336 / HVAC row 207, AS STORED: copper, the section's cladding "None" with "polyshield coating" as written
  it("00336 row 207 (section) and an Insulation row: 'No SKU in the catalogue for polyshield coating - price this row by hand'", () => {
    const pipe: Answer = { pipe_type: "Copper", pipe_type_as_written: "Copper", size_mm: "34.5 mm dia", pipe_class: "18G", insulated: "Yes" };
    const ins: Answer = { item: NR, cladding: "None", cladding_as_written: "polyshield coating", thickness_mm: "19mm", pipe_size_mm: "34.5 mm dia", brand: null, material_as_written: "elastomeric nitrile rubber" };
    const r = panel(PIP, [pipe, { section: SEC, ...ins }], "Rmt", "34.5 mm dia");
    expect(secBlock(attached(r.v)).reason).toBe("No SKU in the catalogue for polyshield coating - price this row by hand");
    expect(panel(INS, [ins], "Rmt").v.items[0].reason).toBe("No SKU in the catalogue for polyshield coating - price this row by hand");
  });
  it("NEGATIVE BOTH PATHS: a coating WITH glass cloth, an answered 'Glass Cloth with paint', and a sheet are not refused", () => {
    expect(coatingOnlyRefusal("fire retardant coating sandwiched with glass cloth")).toBeNull();
    expect(coatingOnlyRefusal("aluminium sheet with protective coating")).toBeNull();
    expect(coatingOnlyRefusal("protective coating")).toBe("No SKU in the catalogue for protective coating - price this row by hand");
    // the model answered the cladding (00086 High side: the payload's coating IS sandwiched with glass cloth)
    const b = both(NIT({ cladding: "Glass Cloth with paint", cladding_as_written: "two coats of 500 micron (0.5 mm) WFT Flame Retardant coating" }));
    expect([b.own.v.rowPriced, b.secV.rowPriced]).toEqual([true, true]);
    // an inner composed layer's "No" (outer_only) is never read as "not answered"
    const c = both(NIT({ cladding: "Glass Cloth with paint", cladding_as_written: "two coats of fire retardant coating", thickness_mm: "32 mm" }));
    expect([c.own.v.rowPriced, c.secV.rowPriced]).toEqual([true, true]);
  });
});

// =====================================================================================================
// AC7 -- R2 (amended 14:22): two stocked pipe types (Piping only)
// =====================================================================================================
describe("AC7 one pipe whose type reads as two stocked types", () => {
  // BOQ-26-00003 / PUNE HVAC BOQ row 371, AS STORED
  const P003: Answer[] = [
    { pipe_type: null, pipe_type_as_written: "CPVC / UPVC", size_mm: "25mm dia", pipe_class: null, insulated: "Yes" },
    { section: SEC, item: NR, cladding: "None", cladding_as_written: null, thickness_mm: "9 mm", pipe_size_mm: null, brand: null, material_as_written: "nitrile foam" }];
  it("00003 row 371: CPVC (owner 14:22: CPVC with PVC or uPVC -> CPVC), its line, and the insulation prices on the pipe's size", () => {
    const r = panel(PIP, P003, "Rmt", "25mm dia", ["DRAIN PIPE -with necessary supports and fittings."]);
    expect(r.v.items[0].family).toBe("CPVC");
    expect(r.v.items[0].familyLine).toBe("BoQ allows CPVC or uPVC -> priced as CPVC");
    expect(r.v.rowPriced).toBe(true);
  });
  it("any other pair of stocked types -> the lower cost ('MS / Copper' at 25 is MS)", () => {
    const r = panel(PIP, [{ pipe_type: null, pipe_type_as_written: "MS / Copper", size_mm: "25", insulated: null }], "Rmt");
    expect(r.v.items[0].familyLine).toBe("BoQ allows MS or Copper -> priced as MS, the lower cost");
    expect(cheaperAlternatives(PIP_SPEC, { attributes: { pipe_type: { value: null }, pipe_type_as_written: { value: "MS / Copper" } } } as never, "", "length")).toMatchObject({ families: ["MS", "Copper"] });
  });
  it("the person can switch it: a PICK of the other type prices that type, no line; a typed 'uPVC/ CPVC' reads as the BoQ's", () => {
    const pick = calc(PIP, { items: [{ base: null, family: "PVC", attrs: { size_mm: "25" }, other: ["size_mm"] }] } as unknown as ItemListEditState);
    expect([pick.v.items[0].family, pick.v.items[0].familyLine ?? null]).toEqual(["PVC", null]);
    const typed = calc(PIP, { items: [{ base: null, family: "uPVC/ CPVC", attrs: { size_mm: "25" }, other: ["pipe_type", "size_mm"] }] } as unknown as ItemListEditState);
    expect([typed.v.items[0].family, typed.v.items[0].familyLine]).toEqual(["CPVC", "You typed uPVC or CPVC -> priced as CPVC"]);
  });
  it("NEGATIVE: a row with TWO pipes stays two items, each its own type; 'MS / GI' is one type", () => {
    const two = panel(PIP, [{ pipe_type: "CPVC", pipe_type_as_written: "CPVC", size_mm: "25" }, { pipe_type: "PVC", pipe_type_as_written: "uPVC", size_mm: "25" }], "Rmt", "CPVC and uPVC pipes 25 mm");
    expect(two.v.items.map((b) => b.family)).toEqual(["CPVC", "PVC"]);
    expect(two.v.items.every((b) => !(b.familyLine ?? "").startsWith("BoQ allows"))).toBe(true);
    const one = panel(PIP, [{ pipe_type: null, pipe_type_as_written: "MS / GI", size_mm: "25" }], "Rmt");
    expect(one.v.items[0].familyLine).toBe("BoQ names MS / GI -> priced as MS");
  });
});

// =====================================================================================================
// AC8 -- R10: a thickness range -> the higher, in the or / slash rule's words
// =====================================================================================================
describe("AC8 a thickness range", () => {
  const THK = INS_SPEC.numbers.thickness_mm as NumberReader;
  const PIPE = INS_SPEC.numbers.pipe_size_mm as NumberReader;
  it("BOTH PATHS: '25-50mm' (00093 shape) and '13–19 mm' (en dash) -> the higher, with 'states a range'", () => {
    expect(readNumber("25-50mm", THK)).toEqual({ value: 50, note: "'25-50mm' states a range - the higher, 50, is taken" });
    expect(readNumber("13–19 mm", THK)).toEqual({ value: 19, note: "'13–19 mm' states a range - the higher, 19, is taken" });
    const b = both(NIT({ thickness_mm: "13-19 mm" }));
    expect(working(b.ownB)).toContain("thickness: '13-19 mm' states a range - the higher, 19, is taken");
    expect(working(b.secB)).toContain("thickness: '13-19 mm' states a range - the higher, 19, is taken");
    // BOQ-26-00093 / Option 1 row 172, AS STORED: the value was already the top one -- 941 / 154 unchanged
    const r = panel(INS, [{ item: FGB, cladding: "None", thickness_mm: "25-50mm", material_as_written: "fiberglass wool" }], "SQM");
    expect(fig(r.values)).toEqual([941, 154]);
  });
  it("NEGATIVE: a pipe SIZE range keeps its own line, and its value", () => {
    expect(readNumber("40-50", PIPE)).toEqual({ value: 50, note: "range '40-50' -> its top value 50 (R6)" });
  });
});

// =====================================================================================================
// AC9 -- (a) composed "No"; (b) a pipe above its largest; (c) the cladding working line
// =====================================================================================================
describe("AC9 display", () => {
  it("(a) BOTH PATHS: a composed thickness shows cladding 'No' (amber), never 'None' -- 00231 row 325 and a section", () => {
    // BOQ-26-00231 / HVAC BOQ row 325, AS STORED
    const r = panel(INS, [{ item: ACO, cladding: "None", thickness_mm: "25 mm", brand: "None", material_as_written: "open cell nitrile rubber" }], "Sq.m");
    expect(field(r.v.items[0], "cladding")).toMatchObject({ value: "No", defaulted: true });
    const b = both(NIT({ cladding: "None", thickness_mm: "32 mm" }));
    expect(field(b.ownB, "cladding")).toMatchObject({ value: "No", defaulted: true });
    expect(field(b.secB, "cladding")).toMatchObject({ value: "No", defaulted: true });
  });
  it("(a) NEGATIVE: one layer is untouched; a composed row whose cladding was ANSWERED shows the answer", () => {
    expect(field(panel(INS, [NIT({ cladding: "None" })], "RMT").v.items[0], "cladding")).toMatchObject({ value: "No", defaulted: true });
    expect(field(panel(INS, [NIT({ thickness_mm: "32 mm" })], "RMT").v.items[0], "cladding")).toMatchObject({ value: "26G Aluminium", defaulted: false });
  });
  it("(b) a pipe ABOVE its largest size: its section repeats the pipe's sentence (copper 54.1), no figure", () => {
    const r = panel(PIP, [{ pipe_type: "Copper", size_mm: "54.1 mm", insulated: "Yes" }, { section: SEC, ...NIT({ pipe_size_mm: null }) }], "Rmt");
    const pipeSaid = r.v.items[0].reason!;
    expect(pipeSaid).toMatch(/^pipe size 54\.1 is above the largest size on the sheet/);
    const sv = attached(r.v);
    expect([sv.view.rowPriced, sv.view.reason, secBlock(sv).figures]).toEqual([false, pipeSaid, {}]);
    expect(field(secBlock(sv), "pipe_size_mm")).toMatchObject({ value: "", note: `From pipe: ${pipeSaid}` });
  });
  it("(b) NEGATIVE: a pipe that prices still mirrors; a pipe refused for its TYPE leaves the section on its own cell", () => {
    expect(field(secBlock(attached(panel(PIP, [{ pipe_type: "Copper", size_mm: "15.9", insulated: "Yes" }, { section: SEC, ...NIT({ pipe_size_mm: null }) }], "Rmt").v)), "pipe_size_mm").mirrorTag).toBe("from pipe");
    const ss = panel(PIP, [{ pipe_type: null, pipe_type_as_written: "SS", size_mm: "50", insulated: "Yes" }, { section: SEC, ...NIT() }], "Rmt");
    expect(attached(ss.v).view.rowPriced).toBe(true);
  });
  it("(c) BOTH PATHS: the cladding line names only the parts priced -- glass cloth alone, the sheet alone, both", () => {
    for (const [cladding, line] of [["Glass Cloth with paint", "supply: cladding: glass cloth x girth ="], ["26G Aluminium", "supply: cladding: aluminium sheet x overlap x girth ="], ["26G Aluminium with Glass Cloth", "supply: cladding: (aluminium sheet x overlap + glass cloth) x girth ="]] as const) {
      const b = both(NIT({ cladding }));
      expect(working(b.ownB).some((w) => w.startsWith(line)), cladding).toBe(true);
      expect(working(b.secB).some((w) => w.startsWith(line)), cladding).toBe(true);
    }
  });
  it("(c) NEGATIVE: no cladding keeps the config's label; a step that is not the cladding is never renamed", () => {
    expect(working(panel(INS, [NIT({ cladding: "No" })], "RMT").v.items[0]).some((w) => w.startsWith("supply: cladding: (aluminium sheet x overlap + glass cloth) x girth = 0"))).toBe(true);
    expect(claddingLabel({ step: "scale", label: "cladding: (aluminium sheet x overlap + glass cloth) x girth", params: { al: 0, gc_from_ctx: "gc" } })).toBe("cladding: (aluminium sheet x overlap + glass cloth) x girth");
  });
});

// =====================================================================================================
// AC10 -- the two negative assertions that were vacuous
// =====================================================================================================
describe("AC10 the 0x08 regexes of pricingSheetHelper.test.ts", () => {
  it("a word-boundary regex finds a rule code the backspace-character one never could", () => {
    const fixed = /\b[RDTS]-?\d/;
    const broken = new RegExp(String.fromCharCode(8) + "[RDTS]-?\\d");
    expect("R14 / S6 UL not mentioned").toMatch(fixed);
    expect("R14 / S6 UL not mentioned").not.toMatch(broken);   // the vacuity: it passed whatever the rule said
    expect("UL not mentioned (or not answered) = non-UL").not.toMatch(fixed);
  });
});

describe("the whole-row figures stay the pure pricer's on both paths (a sample)", () => {
  // an inch pipe is left out on purpose: the section takes the size its PIPE priced as (12e-3a D3b, 2" -> MS 50), not 50.8
  it.each([["50 mm dia"], ["50 NB"], ["50 mm O.D."], ["65 mm"]])("pipe %s: the section's totals equal the Insulation row's", (size) => {
    const b = both(NIT({ pipe_size_mm: size }), { pipe_type: "MS", size_mm: size, insulated: "Yes" });
    expect(fig(b.secV.totals)).toEqual(fig(b.own.values));
  });
});
