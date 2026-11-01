/**
 * ELR-4a (owner R-PW-BLANK / R-KEEP, 2026-10-29; Q1 (A)) -- THE ENTRY POINTS THE BLANK-PLATE TESTS DRIVE. NOT product
 * code. The live Electrical asset, and the same asset with point wiring's "Blank plate" hidden (`panel: false`, what v70
 * carries), through the panel's construction (an extraction map holding the row) and the calculator's (an EMPTY map).
 */
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { calculatorCtx } from "@/pages/pricing/PricingCalculator";
import { makePricingSheetHelper } from "./pricingSheetHelper";
import { mergeItemsByName } from "./rateHelperPlumbing";
import type { ExtractionRow, HelperResult, RateHelperRowContext } from "./rateHelperTypes";

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[] };
const DATA_DIR = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
export const ASSET_FILE = "rate_master_electrical_all_v69.json";
const ELEC = readJsonFixture<Asset>(pathToFileURL(path.join(DATA_DIR, ASSET_FILE)));
export const ITEMS: RateMasterItem[] = mergeItemsByName(
  ELEC.items.map((i) => ({ ...i, attributes: { ...i.attributes, ...(i.brand ? { brand: i.brand } : {}) }, discipline: "Electrical" } as RateMasterItem)));
export const LIVE = new Map<string, RateCategoryConfig>(ELEC.category_configs.map((c) => [c.category_id, c]));
/** the live configs with point wiring's "Blank plate" hidden on both screens -- v70's one functional change */
export const HIDDEN = new Map<string, RateCategoryConfig>([...LIVE].map(([k, c]) => {
  if (k !== "point_wiring") return [k, c];
  const copy = structuredClone(c);
  const d = (copy.attribute_definitions ?? []).find((x) => x.id === "blank_item") as (Record<string, unknown> | undefined);
  if (!d) throw new Error("point_wiring carries no blank_item");
  d.panel = false;
  return [k, copy];
}));

export const N1 = "Blank plates are worked out, not chosen: the plate's modules less the modules its switches and sockets use " +
  "(a socket takes 2, a switch 1). Each spare module gets a '1M Blanker'. 'Blank plate qty' can lower that count but never raise it above the spare.";

/** A point wiring row as a stored read carries it (BOQ-26-00184 / Electrical Est / 20's shape); `blank_item` as given --
 *  null is what the 21 rows of Q1 (A) hold: the AI was asked and left it blank (an ABSENT key would be "never asked",
 *  which the panel defaults to "None"). */
export function pwRow(blankItem: string | null): Record<string, string | null> {
  return {
    wire1_core: "1", wire1_runs: "3", wire1_thickness_sqmm: "2.5", wire2_thickness_sqmm: "None", points: "1",
    conduit_type: "MS", conduit_handoff: "No", circuit_wire_included: "No",
    switch_item: "16A 1 WAY SWITCH", switch_qty: "1", socket_item: "6A/16A 3-Pin Socket", socket_qty: "1",
    plate_qty: "1", colour: "White", back_box: "Yes",
    blank_item: blankItem,
  };
}

const RATE_KINDS = ["supply_rate", "install_rate", "combined_rate"];
export function boqResult(configs: Map<string, RateCategoryConfig>, cat: string, attrs: Record<string, string | null>): HelperResult {
  const cell = Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
  const ext = new Map<number, ExtractionRow>([[7, { excelRow: 7, description: "", attributes: cell } as unknown as ExtractionRow]]);
  const helper = makePricingSheetHelper({ configsByCategory: configs, items: ITEMS, extractionByRow: ext });
  return helper.compute({ excelRow: 7, description: "", nodeType: "Line Item", category: cat, discipline: "Electrical", rateKinds: RATE_KINDS, headings: [], ownNotes: [], unit: "" } as RateHelperRowContext, {});
}
export function calcResult(configs: Map<string, RateCategoryConfig>, cat: string, answers: Record<string, string> = {}): HelperResult {
  const helper = makePricingSheetHelper({ configsByCategory: configs, items: ITEMS, extractionByRow: new Map() });
  return helper.compute(calculatorCtx("Electrical", cat), answers);
}
