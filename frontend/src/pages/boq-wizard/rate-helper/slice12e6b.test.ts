/**
 * SLICE 12e-6b Part 1 (owner R1, 2026-10-16 23:43 IST: "for drain pipes consider CPVC if no material is mentioned").
 * No model is asked here. Every model answer is one a run stored (copied as stored, row named) or a hand-built answer
 * in the same shape, marked SYNTHETIC. Rules are tested from the PANEL'S ENTRY POINT (`makePricingSheetHelper(...).compute`)
 * and, for the figure, beside the PURE pricer (`priceItemList`) and the calculator's own CPVC pick.
 *
 *   R1   a pipe whose type was not told (nothing answered, or only the drain's service copied as written: "DRAIN"),
 *        whose row or heading calls it a drain, and whose text names NO pipe material -> CPVC, amber, with the line
 *        "drain pipe, no material stated -> priced as CPVC"; the person can switch it.
 *   NOT  a material the BoQ names keeps today's rules (uPVC -> PVC, GI -> MS, CPVC with uPVC -> CPVC, PPRC refuses);
 *        an ANSWERED type is never touched (00281 / 66 "PVC" moves only when it is re-read); a non-drain pipe with no
 *        type still refuses; the calculator has no row text and is unchanged.
 *
 * Priced against the v43 asset (live on dev; v45 changes one Piping note only).
 */
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import { isSuggestion } from "./rateHelperTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import {
  ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper,
  type ItemBlockView, type ItemListEditState, type ItemListSuggestion, type ItemListView,
} from "./pricingSheetHelper";
import { drainPipeDefault, itemListPricingSpec, listSpecDefs, priceItemList } from "./itemListPricing";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const DATA = "../../../../../nirmaan_stack/services/boq_rate_master/data/";
const V43 = readJsonFixture<Asset>(new URL(`${DATA}rate_master_hvac_all_v43.json`, import.meta.url));
const ITEMS: RateMasterItem[] = V43.items.map((it) => ({ ...it, discipline: V43.discipline } as RateMasterItem));
const CONFIGS = new Map<string, RateCategoryConfig>(V43.category_configs.map((c) => [c.category_id, c]));
const INS = "hvac_insulation", PIP = "hvac_piping";
const KINDS = ["supply_rate", "install_rate", "combined_rate"] as const;
const SEC = "insulation";
const PIP_SPEC = itemListPricingSpec(CONFIGS.get(PIP)!)!;
const R1_LINE = "drain pipe, no material stated -> priced as CPVC";

type Answer = Record<string, string | null>;
function stored(a: Answer): { attributes: ExtractionRow["attributes"]; section?: string } {
  const { section, ...given } = a;
  const own = listSpecDefs(CONFIGS.get(section ? INS : PIP)!);
  const attributes: Record<string, { value: string | null; confidence: number }> = {};
  for (const d of own) attributes[d.id] = { value: null, confidence: 0 };
  for (const [k, v] of Object.entries(given)) attributes[k] = { value: v, confidence: 0.9 };
  return { attributes: attributes as ExtractionRow["attributes"], ...(section ? { section } : {}) };
}
type Shown = { v: ItemListView; values: ItemListSuggestion["values"] };
function panel(answer: Answer[], desc = "", headings: string[] = [], ownNotes: string[] = [], edits?: ItemListEditState): Shown {
  const row = { excelRow: 1, description: desc, attributes: {}, items: answer.map(stored) } as unknown as ExtractionRow;
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map([[1, row]]) });
  const ctx = { excelRow: 1, description: desc, nodeType: "Line Item", category: PIP, discipline: "HVAC", rateKinds: [...KINDS], unit: "Rmt", headings, ownNotes } as RateHelperRowContext & { unit?: string };
  const r = h.compute(ctx, edits ? { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(edits) } : {});
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { v: s.itemList!, values: s.values };
}
function calc(state: ItemListEditState): Shown {
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map() });
  const ctx: RateHelperRowContext = { excelRow: 1, description: "", nodeType: "Line Item", category: PIP, discipline: "HVAC", rateKinds: [...KINDS] };
  const r = h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(state), [ROW_UNIT_OVERRIDE_KEY]: "mts" });
  if (!isSuggestion(r)) throw new Error("expected a suggestion");
  const s = r as ItemListSuggestion;
  return { v: s.itemList!, values: s.values };
}
const pipeFig = (b: ItemBlockView): [number | undefined, number | undefined] => [b.figures.supply_rate, b.figures.install_rate];
const said = (b: ItemBlockView): string[] => [b.familyLine ?? "", ...b.working.map((w) => w.trim())];

// BOQ-26-00185 / HVAC row 66, AS STORED: the model left the type out and copied the service word "DRAIN" as written
const P185: Answer[] = [
  { pipe_type: null, pipe_type_as_written: "DRAIN", size_mm: "25MM DIA", pipe_class: null, insulated: "Yes" },
  { section: SEC, item: null, cladding: "None", cladding_as_written: null, thickness_mm: "6 MM", pipe_size_mm: "25MM DIA", brand: null, material_as_written: null }];
const D185 = "DRAIN PIPE 25MM DIA WITH 6 MM INSULATION";
// BOQ-26-00281 / HVAC row 66, AS STORED (same text): the model GUESSED "PVC" -- a type the payload does not write
const P281: Answer[] = [
  { pipe_type: "PVC", pipe_type_as_written: null, size_mm: "25MM DIA", pipe_class: null, insulated: "Yes" },
  { section: SEC, item: null, cladding: "None", cladding_as_written: null, thickness_mm: "6 MM", pipe_size_mm: "25MM DIA", brand: null, material_as_written: null }];
// the calculator's own CPVC 25 pick -- the independent figure for a CPVC 25 pipe
const CPVC25 = () => pipeFig(calc({ items: [{ base: null, family: "CPVC", attrs: { size_mm: "25" }, other: ["size_mm"] }] } as unknown as ItemListEditState).v.items[0]);

describe("R1 an untold drain pipe prices as CPVC", () => {
  it("00185 row 66 (as stored, 'DRAIN' as written): CPVC with the amber line, priced at the calculator's CPVC 25 figure", () => {
    const r = panel(P185, D185);
    const b = r.v.items[0];
    expect(b.family).toBe("CPVC");
    expect(b.familyLine).toBe(R1_LINE);
    expect(b.working).toContain(R1_LINE);
    expect(pipeFig(b)).toEqual(CPVC25());
    expect(pipeFig(b)[0]).toBeGreaterThan(0);
    expect(r.v.rowPriced).toBe(true);
    // the as-written word is still shown beside the family it did not decide
    expect(b.readOnly.map((x) => x.value)).toContain("DRAIN");
  });
  it("SYNTHETIC: nothing answered, the drain named only in a HEADING ('CONDENSATE DRAIN PIPING') -> CPVC", () => {
    const r = panel([{ pipe_type: null, pipe_type_as_written: null, size_mm: "32 mm dia", insulated: null }], "32 mm dia", ["CONDENSATE DRAIN PIPING"]);
    expect([r.v.items[0].family, r.v.items[0].familyLine]).toEqual(["CPVC", R1_LINE]);
    expect(r.v.rowPriced).toBe(true);
  });
  it("SYNTHETIC: 'drainage' and 'condensate' count; 'drain' in the row's own note counts", () => {
    expect(drainPipeDefault(PIP_SPEC, "Drainage piping 25 mm", "")).toEqual({ family: "CPVC", line: R1_LINE });
    expect(drainPipeDefault(PIP_SPEC, "Condensate line 25 mm", "")).toEqual({ family: "CPVC", line: R1_LINE });
    expect(drainPipeDefault(PIP_SPEC, "25 mm", "25 mm | for AC drain")).toEqual({ family: "CPVC", line: R1_LINE });
  });
  it("the panel figure equals the PURE pricer's for the same answer and text", () => {
    const one: Answer[] = [{ pipe_type: null, pipe_type_as_written: null, size_mm: "25 mm", insulated: null }];
    const r = panel(one, "Drain pipe 25 mm");
    const p = priceItemList(PIP_SPEC, ITEMS, "Rmt", [{ attributes: stored(one[0]).attributes }] as never, "Drain pipe 25 mm", "Drain pipe 25 mm");
    expect(p.priced).toBe(true);
    expect([r.values?.supply_rate, r.values?.install_rate]).toEqual([p.supply, p.install]);
  });
  it("the person can switch it: a PICK of PVC on the same row prices PVC, with no R1 line", () => {
    const r = panel(P185, D185, [], [], { items: [{ base: 0, family: "PVC", attrs: {} }, { base: 1, family: null, attrs: {} }] } as unknown as ItemListEditState);
    expect(r.v.items[0].family).toBe("PVC");
    expect(said(r.v.items[0])).not.toContain(R1_LINE);
  });
});

describe("NEGATIVE: a material the BoQ names, an answered type, a non-drain pipe, the calculator", () => {
  it("drain ... uPVC -> PVC (as written, and in the row's own words)", () => {
    const w = panel([{ pipe_type: null, pipe_type_as_written: "uPVC", size_mm: "25 mm" }], "Drain pipe 25 mm");
    expect([w.v.items[0].family, w.v.items[0].familyLine]).toEqual(["PVC", "BoQ says uPVC -> priced as PVC"]);
    const own = panel([{ pipe_type: null, pipe_type_as_written: null, size_mm: "25 mm" }], "uPVC drain pipe 25 mm");
    expect(own.v.items[0].family).toBe("PVC");
    expect(said(own.v.items[0])).not.toContain(R1_LINE);
  });
  it("drain ... GI -> MS", () => {
    const w = panel([{ pipe_type: null, pipe_type_as_written: "GI", size_mm: "25 mm" }], "Drain pipe 25 mm");
    expect([w.v.items[0].family, w.v.items[0].familyLine]).toEqual(["MS", "BoQ says GI -> priced as MS"]);
    const own = panel([{ pipe_type: null, pipe_type_as_written: "GI", size_mm: "25 mm" }], "GI drain pipe 25 mm");
    expect([own.v.items[0].family, own.v.items[0].familyLine]).toEqual(["MS", "BoQ names GI -> priced as MS"]);
  });
  it("00003 row 371 (as stored, heading 'DRAIN PIPE'): 'CPVC / UPVC' -> CPVC by the 12e-6 rule, its own line", () => {
    const r = panel([{ pipe_type: null, pipe_type_as_written: "CPVC / UPVC", size_mm: "25mm dia", pipe_class: null, insulated: null }], "25mm dia", ["DRAIN PIPE -with necessary supports and fittings."]);
    expect([r.v.items[0].family, r.v.items[0].familyLine]).toEqual(["CPVC", "BoQ allows CPVC or uPVC -> priced as CPVC"]);
  });
  it("00162 Water Side row 75 (as stored): 'UPVC' copied from text the pricer does not see -> PVC, never R1", () => {
    const r = panel([{ pipe_type: null, pipe_type_as_written: "UPVC", size_mm: "40mm. Dia", pipe_class: null, insulated: null }], "40mm. Dia", ["CONDENSATE DRAIN PIPE FOR AHU'S."]);
    expect(r.v.items[0].family).toBe("PVC");
    expect(said(r.v.items[0])).not.toContain(R1_LINE);
  });
  it("a material named only in a HEADING with nothing answered keeps today's refusal; 'PPRC' as written refuses by name", () => {
    const h = panel([{ pipe_type: null, pipe_type_as_written: null, size_mm: "25 mm" }], "25 mm", ["uPVC drain piping"]);
    expect(h.v.items[0].reason).toBe("no pipe type could be told for this item");
    const pprc = panel([{ pipe_type: null, pipe_type_as_written: "PPRC", size_mm: "25 mm" }], "25 mm", ["Drain piping"]);
    expect(pprc.v.items[0].reason).toBe("no SKU in the catalogue for 'PPRC' -- the user decides");
  });
  it("00281 row 66 (as stored): the model's ANSWERED 'PVC' stands until the row is re-read", () => {
    const r = panel(P281, D185);
    expect(r.v.items[0].family).toBe("PVC");
    expect(said(r.v.items[0])).not.toContain(R1_LINE);
  });
  it("a NON-drain pipe with no type is unchanged: 'no pipe type could be told'", () => {
    const r = panel([{ pipe_type: null, pipe_type_as_written: null, size_mm: "25 mm" }], "pipe 25 mm dia", ["Chilled water piping"]);
    expect(r.v.items[0].reason).toBe("no pipe type could be told for this item");
  });
  it("the CALCULATOR (no row text) is unchanged: no type chosen still asks for one", () => {
    const r = calc({ items: [{ base: null, family: null, attrs: { size_mm: "25" }, other: ["size_mm"] }] } as unknown as ItemListEditState);
    expect(r.v.items[0].family ?? null).toBeNull();
    expect(said(r.v.items[0])).not.toContain(R1_LINE);
    expect(r.v.rowPriced).toBe(false);
  });
  it("a typed 'drain' in the Other box is the pricer's word: refused by name, never R1", () => {
    const r = calc({ items: [{ base: null, family: "drain", attrs: { size_mm: "25" }, other: ["pipe_type", "size_mm"] }] } as unknown as ItemListEditState);
    expect(said(r.v.items[0])).not.toContain(R1_LINE);
    expect(r.v.items[0].family).not.toBe("CPVC");
  });
  it("PURE: material words are WHOLE words ('giving' is not GI, 'MS' is); only Piping's config fires", () => {
    expect(drainPipeDefault(PIP_SPEC, "drain pipe giving slope", "")).not.toBeNull();
    expect(drainPipeDefault(PIP_SPEC, "MS drain pipe", "")).toBeNull();
    expect(drainPipeDefault(PIP_SPEC, "drain pipe, P V C", "")).toBeNull();
    expect(drainPipeDefault(PIP_SPEC, "drainer 25 mm", "")).toBeNull();
    expect(drainPipeDefault(itemListPricingSpec(CONFIGS.get(INS)!)!, "drain pipe", "")).toBeNull();
  });
});
