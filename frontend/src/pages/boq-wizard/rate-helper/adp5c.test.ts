/**
 * ADP-5c (owner 2026-10-23 10:14 / 12:07 / 12:08; Q1 (b) 2026-10-23) -- WORK ON EXISTING ITEMS AND THE CROSS-TALK DEFAULT.
 * Two config keys on ADP, proved on the ADP config AS IT IS TODAY (HVAC v52) with ONLY these two added, through the panel's
 * own entry point (`makePricingSheetHelper(...).compute`), on REAL stored rows (the replay dump, ADP-5c START):
 *
 *   `number_defaults` face_w_mm / face_h_mm = 300 for cross-talk (the ADP-1 mechanism, no code): a cross-talk silencer
 *             with no size prices as 300 x 300 (836 / 288 / 1,124), marked as assumed; a stated size always wins;
 *   `existing_work` (new, `existingWorkOf` + step (6c) of `priceOneItem`): a row whose OWN text removes existing work
 *             prices the matched SKU at supply 0 and its install; removal and refixing, refixing alone and shifting
 *             existing at supply 0 and twice the install; the working line says so in plain words and quotes the row.
 *   negatives  a row with no SKU match still refuses as today; "removable core" and a bare "removing" move nothing; a
 *             phrase only in a HEADING moves nothing (owner Q1 (b): own text only); the calculator has no row text, so
 *             the removal rule never fires there while the default does.
 * The v53 asset's own copy of both keys is pinned in `nirmaan_stack/services/boq_rate_master/test_adp5c_question.py`.
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { existingWorkOf, itemListPricingSpec } from "./itemListPricing";
import { mergeItemsByName } from "./rateHelperPlumbing";
import { isSuggestion, type ExtractionRow, type HelperResult } from "./rateHelperTypes";
import { CONFIGS as LIVE_CONFIGS } from "./adp3a.harness";

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const V52 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v52.json")));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const cfgOf = (a: Asset, id: string) => a.category_configs.find((c) => c.category_id === id)!;

/** The ruled forms (owner 12:07 / 12:08; 10:14) -- the same text as `test_config_validation_adp5c.py` and HVAC v53. */
export const EXISTING_WORK = [
  { words: ["refixing of existing", "refixing existing", "re-fixing of existing", "re-fixing existing", "shifting of existing", "shifting existing"],
    install_times: 2, line: "removal and refixing of existing",
    rule: "removal and refixing, refixing or shifting of existing work: supply 0, install 2 x the matched SKU's install (owner 2026-10-23 12:07 / 12:08)" },
  { words: ["removing of existing", "removing existing", "removal of existing", "removal existing"],
    install_times: 1, line: "removal of existing",
    rule: "removal of existing work: supply 0, install = the matched SKU's install (owner 2026-10-23 12:07)" },
];
export const CROSS_TALK_DEFAULT = { value: 300, families: ["cross-talk"], rule: "no size stated - a cross-talk silencer is priced at 300 x 300 (owner 2026-10-23 10:14 / 12:08)" };

/** v52's ADP config with ONLY this slice's keys added; `which` picks them, so each mechanism is proved on its own. */
function withAdp5c(which: { work?: boolean; dflt?: boolean } = { work: true, dflt: true }): RateCategoryConfig {
  const c = structuredClone(cfgOf(V52, ADP)) as RateCategoryConfig & { list_spec: { pricing: Record<string, any> } };
  const pr = c.list_spec.pricing;
  if (which.work) pr.existing_work = structuredClone(EXISTING_WORK);
  if (which.dflt) pr.number_defaults = { ...pr.number_defaults, face_w_mm: { ...CROSS_TALK_DEFAULT }, face_h_mm: { ...CROSS_TALK_DEFAULT } };
  return c;
}
const configs = (adp: RateCategoryConfig) => {
  const m = new Map<string, RateCategoryConfig>(LIVE_CONFIGS);
  for (const id of [INS, PIP]) m.set(id, cfgOf(V52, id));
  m.set(ADP, adp);
  return m;
};
const ITEMS: RateMasterItem[] = mergeItemsByName(V52.items.map((it) => ({ ...it, discipline: V52.discipline } as RateMasterItem)));
const RK = ["supply_rate", "install_rate", "combined_rate"];
const must = (r: HelperResult): ItemListSuggestion => { if (!isSuggestion(r)) throw new Error("expected a suggestion"); return r as ItemListSuggestion; };
const cells = (a: Record<string, string | null>) =>
  Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
interface Row { unit: string; description: string; headings: string[]; ownNotes?: string[]; items: Array<Record<string, string | null>> }
function panel(row: Row, adp: RateCategoryConfig): ItemListSuggestion {
  const ext = new Map<number, ExtractionRow>([[1, { excelRow: 1, description: row.description, attributes: {}, items: row.items.map((a) => ({ attributes: cells(a) })) } as unknown as ExtractionRow]]);
  return must(makePricingSheetHelper({ configsByCategory: configs(adp), items: ITEMS, extractionByRow: ext })
    .compute({ excelRow: 1, description: row.description, nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: RK,
      headings: row.headings, ownNotes: row.ownNotes ?? [], headingNotes: [], unit: row.unit } as never, {}));
}
function calculator(adp: RateCategoryConfig, family: string, attrs: Record<string, string>, unit: string): ItemListSuggestion {
  return must(makePricingSheetHelper({ configsByCategory: configs(adp), items: ITEMS, extractionByRow: new Map() })
    .compute({ excelRow: 1, description: "", nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: RK, headings: [], ownNotes: [] } as never,
      { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify({ items: [{ base: null, family, attrs, other: Object.keys(attrs) }] }), [ROW_UNIT_OVERRIDE_KEY]: unit }));
}
const view = (s: ItemListSuggestion) => ({
  values: s.values, reason: s.itemList!.reason,
  items: s.itemList!.items.map((b) => ({ family: b.family, state: b.state, reason: b.reason, figures: b.figures, working: b.working,
                                         fields: b.fields.map((f) => [f.id, f.label, f.value]) })),
});
const fig = (s: ItemListSuggestion) => [s.values.supply_rate ?? null, s.values.install_rate ?? null, s.values.combined_rate ?? null];
const working = (s: ItemListSuggestion) => s.itemList!.items.flatMap((b) => b.working);

// ── the stored rows (replay dump, ADP-5c START; the model's stored answers verbatim, the null cells left out) ──────────────
const CT = { family: "cross-talk", air: "None", ul: "None", qty_per_row_unit: "None" };
const R00239_272: Row = { unit: "Sets", description: "Removing Existing cross talk silencers", headings: [], items: [CT] };
const R00239_274: Row = { unit: "Sets", description: "Refixing of Existing cross talk silencers", headings: [], items: [CT] };
const R00239_270: Row = {   // stored: "linear grille needs W + H or area band" -- no SKU match, refuses today
  unit: "Sets", description: "Removing and Refixing of Existing Return air Grilles", headings: [],
  items: [{ family: "grille, type not stated", damper: "None", air: "return", ul: "None", qty_per_row_unit: "None" }],
};
const R00218_2F_121: Row = {   // stored: cross-talk, "no width and height stated"
  unit: "Nos",
  description: "SITC of factory fabricated Z shape Cross talk silencer made out of 1 mm thick Micro-Perforated Plate having a perforation percentage of less than 1% and having an NRC value of 0.7 – 0.9, the length of the Silencer shall be designed in such a way to diffuse the noise and shall be as per the manufacturers recommendation and shall be selected as per standards.",
  headings: ["AIR DISTRUBTION SYSTEM", "Cross Talk Silencer"],
  items: [{ family: "cross-talk", damper: "None", insulated: "None", air: "None", ul: "None", thickness_mm: "1 mm", variant: "None", qty_per_row_unit: "None" }],
};
const R00100_94: Row = {   // stored and priced: a square diffuser per sq.m whose text says "removable core"
  unit: "SQM",
  description: "Supplying, Fixing, installation, testing and commissioning of supply air diffusers (round/square flat plate type)of powder coated aluminium with aluminium volume control dampers with anti smudge ring & removable core in confirmation to SMACNA/IS and as per specifications complete etc. as required. Colour as per site requirement.",
  headings: ["AIR DISTRIBUTION PRODUCTS"],
  items: [{ family: "square diffuser", damper: "with", insulated: "None", air: "supply", ul: "None", variant: "None", qty_per_row_unit: "None" }],
};
const said = (row: Row, description: string): Row => ({ ...row, description });
const sized = (row: Row, size: string): Row => ({ ...row, items: [{ ...row.items[0], size_mm: size }] });

describe("ADP-5c -- the cross-talk 300 x 300 default (number_defaults, no code)", () => {
  it("positive: a stored no-size cross-talk prices at 300 x 300 -- 836 / 288 / 1,124 -- with the size shown as assumed", () => {
    const s = panel(R00218_2F_121, withAdp5c({ dflt: true }));
    expect(fig(s)).toEqual([836, 288, 1124]);
    const v = view(s);
    expect(v.items[0].state).toBe("priced");
    expect(s.itemList!.items[0].fields.filter((f) => (f as { defaulted?: boolean }).defaulted)
      .map((f) => [f.id, f.value, (f as { rule?: string }).rule])).toEqual([   // the screen drops the "(owner ...)" citation
      ["face_w_mm", "300", "no size stated - a cross-talk silencer is priced at 300 x 300"],
      ["face_h_mm", "300", "no size stated - a cross-talk silencer is priced at 300 x 300"]]);
  });
  it("negative: without the default the same row refuses as it does today (the default is the mechanism)", () => {
    const s = panel(R00218_2F_121, cfgOf(V52, ADP));
    expect(fig(s)).toEqual([null, null, null]);
    expect(view(s).reason).toMatch(/no width and height stated/);
  });
  it("negative: a stated size always wins over the default (650 x 250 -> 1,253 / 432 / 1,685)", () => {
    expect(fig(panel(sized(R00218_2F_121, "650 X 250"), withAdp5c()))).toEqual([1253, 432, 1685]);
    expect(fig(panel(sized(R00218_2F_121, "650 X 250"), cfgOf(V52, ADP)))).toEqual([1253, 432, 1685]);
  });
  it("negative: the default is the cross-talk family's only -- a per-number VCD with no size still refuses as today", () => {
    const vcd: Row = { unit: "Nos", description: "Volume control damper", headings: [], items: [{ family: "VCD", variant: "GI rectangular", qty_per_row_unit: "None" }] };
    expect(view(panel(vcd, withAdp5c()))).toEqual(view(panel(vcd, cfgOf(V52, ADP))));
    expect(fig(panel(vcd, withAdp5c()))).toEqual([null, null, null]);
  });
  it("calculator = panel: a cross-talk picked with no size takes the same default and figures", () => {
    expect(fig(calculator(withAdp5c(), "cross-talk", {}, "nos"))).toEqual([836, 288, 1124]);
  });
});

describe("ADP-5c -- work on existing items (existing_work: supply 0, install x 1 or x 2)", () => {
  it("removal only: 'Removing Existing cross talk silencers' -> 0 / 288 / 288, the line quoting the row", () => {
    const s = panel(R00239_272, withAdp5c());
    expect(fig(s)).toEqual([0, 288, 288]);
    expect(working(s)).toContain("removal of existing -> supply 0, install 1 x 288 = 288 (the row's own text says 'Removing Existing')");
  });
  it("refixing alone: 'Refixing of Existing cross talk silencers' -> 0 / 576 / 576", () => {
    const s = panel(R00239_274, withAdp5c());
    expect(fig(s)).toEqual([0, 576, 576]);
    expect(working(s)).toContain("removal and refixing of existing -> supply 0, install 2 x 288 = 576 (the row's own text says 'Refixing of Existing')");
  });
  it("removal and refixing reads as the doubled entry (listed first), and shifting existing counts as refixing", () => {
    const both = panel(said(R00239_272, "Removing and Refixing of Existing cross talk silencers"), withAdp5c());
    expect(fig(both)).toEqual([0, 576, 576]);
    expect(working(both)).toContain("removal and refixing of existing -> supply 0, install 2 x 288 = 576 (the row's own text says 'Refixing of Existing')");
    const shift = panel(said(R00239_272, "Shifting existing cross talk silencers to the new location"), withAdp5c());
    expect(fig(shift)).toEqual([0, 576, 576]);
    expect(working(shift)).toContain("removal and refixing of existing -> supply 0, install 2 x 288 = 576 (the row's own text says 'Shifting existing')");
  });
  it("a stated size prices its own SKU's install: removal of a 650 x 250 silencer -> 0 / 432 / 432", () => {
    expect(fig(panel(sized(R00239_272, "650 X 250"), withAdp5c()))).toEqual([0, 432, 432]);
  });
  it("negative: no SKU match refuses exactly as today (a removal row of a grille with no size)", () => {
    const after = view(panel(R00239_270, withAdp5c()));
    expect(after).toEqual(view(panel(R00239_270, cfgOf(V52, ADP))));
    expect(fig(panel(R00239_270, withAdp5c()))).toEqual([null, null, null]);
  });
  it("negative: 'removable core' and a bare 'removing' move nothing -- the phrases need 'existing'", () => {
    expect(view(panel(R00100_94, withAdp5c()))).toEqual(view(panel(R00100_94, cfgOf(V52, ADP))));
    const bare = panel(sized(said(R00239_272, "Removing old cross talk silencers and disposal"), "300 X 300"), withAdp5c());
    expect(fig(bare)).toEqual([836, 288, 1124]);
    expect(working(bare).some((l) => l.startsWith("removal"))).toBe(false);
  });
  it("negative (owner Q1 (b)): a phrase in a HEADING only moves nothing -- the row's own text decides", () => {
    const s = panel({ ...R00218_2F_121, headings: ["Removing and refixing of existing works", "Cross Talk Silencer"] }, withAdp5c());
    expect(fig(s)).toEqual([836, 288, 1124]);
    expect(working(s).some((l) => l.startsWith("removal"))).toBe(false);
  });
  it("negative: the calculator has no row text, so the rule never fires there", () => {
    const c = calculator(withAdp5c(), "cross-talk", { size_mm: "300 X 300" }, "nos");
    expect(fig(c)).toEqual([836, 288, 1124]);
    expect(working(c).some((l) => l.startsWith("removal"))).toBe(false);
  });
  it("negative: without the key the same removal rows price as plain items (the key is the mechanism)", () => {
    expect(fig(panel(R00239_272, withAdp5c({ dflt: true })))).toEqual([836, 288, 1124]);
    expect(fig(panel(R00239_274, withAdp5c({ dflt: true })))).toEqual([836, 288, 1124]);
  });
});

describe("ADP-5c -- existingWorkOf (pure)", () => {
  const spec = itemListPricingSpec(withAdp5c())!;
  it("the first entry whose phrase is at a word start wins, quoting the row's spelling", () => {
    expect(existingWorkOf(spec, "Removing and Refixing of Existing Return air Grilles")).toEqual({ work: EXISTING_WORK[0], said: "Refixing of Existing" });
    expect(existingWorkOf(spec, "Removal of existing ducting | note")).toEqual({ work: EXISTING_WORK[1], said: "Removal of existing" });
    expect(existingWorkOf(spec, "Re-fixing existing grilles")?.work.install_times).toBe(2);
  });
  it("no phrase, a phrase inside a word, or no key -> null", () => {
    for (const t of ["", "removable core", "Removing old silencers", "prefixing existing", "removal of the existing"]) expect(existingWorkOf(spec, t)).toBeNull();
    expect(existingWorkOf(itemListPricingSpec(cfgOf(V52, ADP))!, "Removing Existing cross talk silencers")).toBeNull();
  });
});
