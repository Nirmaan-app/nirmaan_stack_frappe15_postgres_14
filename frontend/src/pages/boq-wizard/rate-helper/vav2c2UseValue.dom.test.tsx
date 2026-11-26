// @vitest-environment jsdom
//
// VAV-2c2 R4 / T6 (chat-Claude under the owner's 2026-11-23 13:46 word; VAV-2c1 review D6): "Use this value" takes the figure of the COLUMN
// the panel was opened from (the owner's reading 23 Nov 00:59; RateHelperPanel.tsx `result.values[kind]`). Shown here on the REAL panel for
// a VAV box row the BoQ reads as Installation only and one it reads as Supply only: the final-value box beside "Use this value" holds the
// supply, the installation or the combined figure by the cell the panel was opened for -- 0 from the side the scope leaves out.
import path from "path";
import { readdirSync } from "fs";
import { pathToFileURL } from "url";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { RateHelperPanel } from "./RateHelperPanel";
import { makePricingSheetHelper, type ItemListSuggestion } from "./pricingSheetHelper";
import { mergeItemsByName } from "./rateHelperPlumbing";
import type { ExtractionRow, RateHelperRowContext } from "./rateHelperTypes";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class StubResizeObserver { observe() { /* no layout */ } unobserve() { /* no layout */ } disconnect() { /* no layout */ } }
if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => { /* no layout */ };

type Asset = { discipline: string; items: Array<RateMasterItem & { brand?: string }>; category_configs: RateCategoryConfig[] };
const DATA_DIR = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
// the latest HVAC asset by version number (a latest-asset reader by file prefix: rate_master_hvac_all_v)
const latestHvac = readdirSync(DATA_DIR).filter((f) => /^rate_master_hvac_all_v\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/v(\d+)/)![1]) - Number(b.match(/v(\d+)/)![1])).pop()!;
const HVAC = readJsonFixture<Asset>(pathToFileURL(path.join(DATA_DIR, latestHvac)));
const ITEMS: RateMasterItem[] = mergeItemsByName(HVAC.items.map((i) => ({ ...i, discipline: HVAC.discipline } as RateMasterItem)));
const CONFIGS = new Map<string, RateCategoryConfig>(HVAC.category_configs.map((c) => [c.category_id, c]));
const RATE_KINDS = ["supply_rate", "install_rate", "combined_rate"];
type Kind = "supply_rate" | "install_rate" | "combined_rate";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

/** a VAV box the BoQ reads with `scope`: the helper, its context and its own result */
function setup(scope: string) {
  const cell = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
  const box = { vav_item: "VAV box", shape: "Rectangular", vav_type: "Nothing specific mentioned", integrator_included: "No", airflow_cfm: "700", scope };
  const ext = new Map<number, ExtractionRow>([[7, { excelRow: 7, description: "", attributes: {}, items: [{ attributes: cell(box) }] } as unknown as ExtractionRow]]);
  const helper = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: ext });
  const ctx = { excelRow: 7, description: "VAV box 700 CFM", nodeType: "Line Item", category: "hvac_vav_box", discipline: "HVAC", rateKinds: RATE_KINDS, headings: [], ownNotes: [], unit: "Nos" } as RateHelperRowContext;
  return { helper, ctx, values: (helper.compute(ctx, {}) as ItemListSuggestion).values as Record<Kind, number> };
}

/** the final-value box of the panel opened from the cell of `kind` */
function boxFor(scope: string, kind: Kind): string {
  const { helper, ctx } = setup(scope);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const col = { supply_rate: "F", install_rate: "G", combined_rate: "H" }[kind];
  act(() => root!.render(<RateHelperPanel variant="embedded" excelRow={7} col={col} kind={kind} ctx={ctx} helpers={[helper]} onUse={() => undefined} />));
  const header = [...host.querySelectorAll("button")].find((b) => !b.getAttribute("aria-label") && b.querySelector(".text-sm.font-medium"));
  act(() => header!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const box = host.querySelector("input[aria-label='Final value']") as HTMLInputElement | null;
  expect(box, "the final-value box beside 'Use this value'").toBeTruthy();
  const v = box!.value;
  act(() => root?.unmount()); host.remove(); root = null; host = null;
  return v;
}

describe("R4 / T6: 'Use this value' takes the figure of the column the panel was opened from, under a scope", () => {
  it("Installation only: supply cell 0, installation cell the installation, combined cell = 0 + the installation", () => {
    const v = setup("Installation only").values;
    expect(v.supply_rate).toBe(0);
    expect(v.install_rate).toBeGreaterThan(0);
    expect(boxFor("Installation only", "supply_rate")).toBe("0");
    expect(boxFor("Installation only", "install_rate")).toBe(String(v.install_rate));
    expect(boxFor("Installation only", "combined_rate")).toBe(String(v.install_rate));
  });
  it("Supply only: supply cell the supply, installation cell 0, combined cell = the supply + 0", () => {
    const v = setup("Supply only").values;
    expect(v.install_rate).toBe(0);
    expect(v.supply_rate).toBeGreaterThan(0);
    expect(boxFor("Supply only", "supply_rate")).toBe(String(v.supply_rate));
    expect(boxFor("Supply only", "install_rate")).toBe("0");
    expect(boxFor("Supply only", "combined_rate")).toBe(String(v.supply_rate));
  });
  it("NEGATIVE: Supply + installation -- each cell its own side, never the other side's figure", () => {
    const v = setup("Supply + installation").values;
    expect(v.supply_rate).toBeGreaterThan(0);
    expect(v.install_rate).toBeGreaterThan(0);
    expect(boxFor("Supply + installation", "supply_rate")).toBe(String(v.supply_rate));
    expect(boxFor("Supply + installation", "install_rate")).toBe(String(v.install_rate));
    expect(boxFor("Supply + installation", "combined_rate")).toBe(String(v.supply_rate + v.install_rate));
    expect(boxFor("Supply + installation", "install_rate")).not.toBe(String(v.supply_rate));
  });
});
