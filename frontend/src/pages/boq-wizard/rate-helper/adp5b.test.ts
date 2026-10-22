/**
 * ADP-5b (owner R1, 2026-10-22 10:49 "ok with 1 to3 and 5 to 8") -- ADP's "none of these" refusal NAMES THE THING THE ROW
 * BUYS. The config gains a text answer `item_as_written` and `list_spec.pricing.no_sku_named_by: "item_as_written"` --
 * the Insulation mechanism of 12d-1b (T5), used as it is: NO pricer code changes for ADP. This file proves that on the
 * ADP config AS IT IS TODAY (HVAC v51) with only that one config line and that one definition added, through the panel's
 * own entry point (`makePricingSheetHelper(...).compute`), on REAL stored rows (the replay dump, ADP-5b START):
 *
 *   positive  a "none of these" answer WITH the item as written -> "No SKU in the catalogue for <the item> - price this
 *             row by hand" (BOQ-26-00096 r56 Hit & Miss Damper; BOQ-26-00122 r160 Bird Screens with GI wire mesh);
 *   negative  the same answer WITHOUT it (absent, "None", blank) -> today's sentence, word for word -- so every stored
 *             answer keeps its wording until it is re-read;
 *   negative  any other family never shows it: a priced row given an item as written keeps its family, figures, fields
 *             and every working line (BOQ-26-00096 r49, 1972 / 576 / 2548), and no panel box carries it;
 *   generic   none of the pricer's other readers of `no_sku_named_by` (the XLPE, RPUF, alternative-material and
 *             "none of these" demotion paths) can act on ADP: ADP declares none of the keys they need.
 * The asset itself (HVAC v52: the definition, the note texts, the question's shas) is pinned in
 * `nirmaan_stack/services/boq_rate_master/test_adp5b_question.py`.
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { pathToFileURL } from "url";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { itemListPricingSpec, namedMaterialRefusal } from "./itemListPricing";
import { mergeItemsByName } from "./rateHelperPlumbing";
import { isSuggestion, type ExtractionRow, type HelperResult } from "./rateHelperTypes";
import { CONFIGS as LIVE_CONFIGS } from "./adp3a.harness";

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const V51 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v51.json")));
const ADP = "hvac_adp", INS = "hvac_insulation", PIP = "hvac_piping";
const cfgOf = (a: Asset, id: string) => a.category_configs.find((c) => c.category_id === id)!;
const R1_NOTE = "When the family is 'none of these', the item the row buys, in the BoQ's own words (one continuous piece, the shortest that names it: 'Hit & Miss Damper', 'Bird Screens with GI wire mesh'). Leave it out for every other family.";

/** v51's ADP config with ONLY R1 added: the definition (last) and the one pricing key. `named` false = the definition only. */
function withR1(named = true): RateCategoryConfig {
  const c = structuredClone(cfgOf(V51, ADP)) as RateCategoryConfig & { list_spec: { attribute_definitions: unknown[]; pricing: Record<string, unknown> } };
  c.list_spec.attribute_definitions.push({ id: "item_as_written", label: "Item as written", type: "text", note: R1_NOTE });
  if (named) c.list_spec.pricing.no_sku_named_by = "item_as_written";
  return c;
}
const configs = (adp: RateCategoryConfig) => {
  const m = new Map<string, RateCategoryConfig>(LIVE_CONFIGS);
  for (const id of [INS, PIP]) m.set(id, cfgOf(V51, id));
  m.set(ADP, adp);
  return m;
};
const ITEMS: RateMasterItem[] = mergeItemsByName(V51.items.map((it) => ({ ...it, discipline: V51.discipline } as RateMasterItem)));
const RK = ["supply_rate", "install_rate", "combined_rate"];
const must = (r: HelperResult): ItemListSuggestion => { if (!isSuggestion(r)) throw new Error("expected a suggestion"); return r as ItemListSuggestion; };
const cells = (a: Record<string, string | null>) =>
  Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
interface Row { unit: string; description: string; headings: string[]; headingNotes?: string[]; items: Array<Record<string, string | null>> }
function panel(row: Row, adp: RateCategoryConfig): ItemListSuggestion {
  const ext = new Map<number, ExtractionRow>([[1, { excelRow: 1, description: row.description, attributes: {}, items: row.items.map((a) => ({ attributes: cells(a) })) } as unknown as ExtractionRow]]);
  return must(makePricingSheetHelper({ configsByCategory: configs(adp), items: ITEMS, extractionByRow: ext })
    .compute({ excelRow: 1, description: row.description, nodeType: "Line Item", category: ADP, discipline: "HVAC", rateKinds: RK,
      headings: row.headings, ownNotes: [], headingNotes: row.headingNotes ?? [], unit: row.unit } as never, {}));
}
const view = (s: ItemListSuggestion) => ({
  values: s.values, reason: s.itemList!.reason,
  items: s.itemList!.items.map((b) => ({ family: b.family, state: b.state, reason: b.reason, figures: b.figures, working: b.working,
                                         fields: b.fields.map((f) => [f.id, f.label, f.value]) })),
});

// ── the stored rows (replay dump, ADP-5b START; the model's stored answers verbatim) ────────────────────────────────────
const NULLS = { insulated: null, neck_mm: null, size_mm: null, dia_mm: null, slot_count: null, torque: null, panel_ratio: null,
                thickness_mm: null, insulation_thickness_mm: null, area_band: null, variant: null };
const R00096_56: Row = {   // stored: "none of these" -> "no SKU in the catalogue for 'none of these' -- the user decides"
  unit: "Sqm", description: "Hit & Miss Damper for above size",
  headings: ["AIR CONDITIONING WORKS", "Air Terminal Devices", "Linear Slot Diffusers", "2- Slot Linear Diffuser (16 mm wide Slot) - 110 mm wide"],
  items: [{ ...NULLS, family: "none of these", damper: "with", air: null, ul: "None", qty_per_row_unit: "None" }],
};
const R00122_160: Row = {
  unit: "SqM",
  description: "Supply, Installation and Testing of Bird Screens with GI wire mesh to be installed at the suction of fresh air/discharge of Exhaust air as per the specifications and shop drawings. Sample of bird screen to be got approved from consultants and Clients prior to procurement.",
  headings: ["DUCTWORK/AIR TERMINALS", "Supply and fixing of actuators of suitable rating of torque complete with control panel, copper wiring from the junction box and actuator associated with the above VCDs."],
  headingNotes: ["TOTAL ITEM NO.2 (Ducting & Air Terminals)"],
  items: [{ ...NULLS, family: "none of these", damper: null, air: "None", ul: "None", qty_per_row_unit: "None" }],
};
const R00096_49: Row = {   // stored and priced: 1972 / 576 / 2548 (the cert's standing row)
  unit: "Nos", description: "225 x 225 MM (Neck Size)",
  headings: ["AIR CONDITIONING WORKS", "Air Terminal Devices", "Powder coated, extruded aluminium, removable center core type, square tegular type diffusers of aluminium construction of the following neck sizes. The diffuser shall be mounted in the GI box (not in scope), with inlet connector suitable for flexible duct. Damper, GI mixing Box & Flexible duct quantified seperately for supply air diffusers. ( colour of the diffuser to be matched with grid ceiling colour and shall be approved by Arch/ PMC team before placing the order)"],
  headingNotes: ["(All are of 600 x 600 MM Outer to Outer Size)"],
  items: [{ ...NULLS, family: "square diffuser", damper: "None", air: "supply", neck_mm: "225 x 225 MM", size_mm: "600 x 600 MM", ul: "None", qty_per_row_unit: "None" }],
};
const withItem = (row: Row, v: string | null): Row => ({ ...row, items: [{ ...row.items[0], item_as_written: v }] });
const TODAY = "no SKU in the catalogue for 'none of these' -- the user decides";

describe("ADP-5b R1 -- the 'none of these' refusal names the item as written (the Insulation mechanism, no code)", () => {
  it("positive: a filled item as written gives the named refusal, on the row and on its block; no figure", () => {
    for (const [row, named] of [[R00096_56, "Hit & Miss Damper"], [R00122_160, "Bird Screens with GI wire mesh"]] as const) {
      const s = view(panel(withItem(row, named), withR1()));
      const want = `No SKU in the catalogue for ${named} - price this row by hand`;
      expect({ reason: s.reason, block: s.items[0].reason, state: s.items[0].state, figures: s.items[0].figures })
        .toEqual({ reason: want, block: want, state: "blank", figures: s.items[0].figures });
      expect(s.values.combined_rate ?? null).toBeNull();
    }
  });

  it("negative: absent, 'None' or blank keeps TODAY's sentence word for word (every stored answer before its re-read)", () => {
    for (const row of [R00096_56, R00122_160]) {
      const before = view(panel(row, cfgOf(V51, ADP)));
      expect(before.reason).toBe(TODAY);
      for (const v of [null, "None", "  "]) expect(view(panel(withItem(row, v), withR1()))).toEqual(before);
      expect(view(panel(row, withR1()))).toEqual(before);
    }
  });

  it("negative: the config line is what names it -- the definition alone (no `no_sku_named_by`) keeps today's sentence", () => {
    expect(view(panel(withItem(R00096_56, "Hit & Miss Damper"), withR1(false))).reason).toBe(TODAY);
  });

  it("negative: any other family never shows it -- a priced row given an item as written is unchanged, field for field", () => {
    const before = view(panel(R00096_49, cfgOf(V51, ADP)));
    expect([before.values.supply_rate, before.values.install_rate, before.values.combined_rate]).toEqual([1972, 576, 2548]);
    const after = view(panel(withItem(R00096_49, "225 x 225 MM (Neck Size)"), withR1()));
    expect(after).toEqual(before);
    expect(after.items.flatMap((b) => b.fields.map((f) => f[0]))).not.toContain("item_as_written");
  });

  it("generic: ADP declares none of the keys the pricer's other `no_sku_named_by` readers need", () => {
    const pr = (withR1() as unknown as { list_spec: { pricing: Record<string, unknown> } }).list_spec.pricing;
    for (const k of ["unstocked_materials", "family_when_none", "material_text", "choice_text", "family_text"]) expect(pr).not.toHaveProperty(k);
    const fams = Object.keys(pr.families as Record<string, unknown>);
    expect(fams.filter((f) => /puf|fib(?:re|er)\s*glass/i.test(f))).toEqual([]);
    // the one function both the panel and the calculator read, called directly
    const spec = itemListPricingSpec(withR1())!;
    const item = { attributes: cells({ family: "none of these", item_as_written: "Hit & Miss Damper" }) } as never;
    expect(namedMaterialRefusal(spec, item, "")).toBe("No SKU in the catalogue for Hit & Miss Damper - price this row by hand");
    expect(namedMaterialRefusal(itemListPricingSpec(cfgOf(V51, ADP))!, item, "")).toBe("no SKU in the catalogue for 'none of these' -- the user decides (R18)");
  });
});
