// @vitest-environment jsdom
//
// DU-1 R2 (owner 2026-11-15 14:42, verbatim: "the supply install and combined prices shown at the bottom needs to be copyable. this
// is also a general requiremnt for all helpers" / "use the same c opy icon we use in other helpers"; signed-off mockup: the green row
// total "Supply / Install / Combined each on its own line WITH the copy icon"). The REAL `RateHelperPanel` on the LATEST HVAC asset:
// a priced row's green row total carries THREE copy controls -- the same `CopyFigureButton` the BoQ-rates lines use (same aria
// label, same title) -- one per figure, each figure on its own line; a refused row's total has none (nothing to copy). The
// calculator mounts the same `ItemListBlocks` (one row-total render in the file), pinned at the source seam below.
// R1 (owner 14:42 "use this valkue also has a text box where the user can enter the rate they want to use"): the final-value box
// beside "Use this value" is present on the same panel (the generic RHP control, every helper).
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { RateHelperPanel } from "./RateHelperPanel";
import { makePricingSheetHelper } from "./pricingSheetHelper";
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

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

function boqPanel(cat: string, unit: string, model: Array<Record<string, string>>): HTMLElement {
  const cell = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { value: v, confidence: 0.9 }]));
  const ext = new Map<number, ExtractionRow>([[7, { excelRow: 7, description: "", attributes: {}, items: model.map((a) => ({ attributes: cell(a) })) } as unknown as ExtractionRow]]);
  const helper = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: ext });
  const ctx = { excelRow: 7, description: "", nodeType: "Line Item", category: cat, discipline: "HVAC", rateKinds: RATE_KINDS, headings: [], ownNotes: [], unit } as RateHelperRowContext;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<RateHelperPanel variant="embedded" excelRow={7} col="F" kind="supply_rate" ctx={ctx} helpers={[helper]} onUse={() => undefined} />));
  const header = [...host.querySelectorAll("button")].find((b) => !b.getAttribute("aria-label") && b.querySelector(".text-sm.font-medium"));
  act(() => header!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  return host;
}
const copyLabels = (scope: Element) => [...scope.querySelectorAll("button[aria-label^='Copy ']")].map((b) => b.getAttribute("aria-label"));

const PRICED: Array<[string, string, string, Array<Record<string, string>>]> = [
  ["Piping (copper 22.2)", "hvac_piping", "Rmt", [{ pipe_type: "Copper", size_mm: "22.2", insulated: "No" }]],
  ["Valve Package (butterfly 150)", "hvac_valve_package", "Nos", [{ valve_type: "Butterfly Valve", size_mm: "150", scope: "Supply + installation" }]],
  ["Insulation (nitrile 13 mm on a 25 mm pipe)", "hvac_insulation", "Rmt", [{ item: "Nitrile Rubber Insulation", thickness_mm: "13", pipe_size_mm: "25", cladding: "None" }]],
];

describe("DU-1 R2 -- the green row total's Supply / Install / Combined each carry the copy icon (panel)", () => {
  for (const [title, cat, unit, model] of PRICED) {
    it(`${title}: three copy controls in the row total, the SAME control as the BoQ-rates lines, one figure per line`, () => {
      const el = boqPanel(cat, unit, model);
      const total = el.querySelector("[data-testid='item-row-total']")!;
      expect(total, "row total rendered").toBeTruthy();
      expect(total.className).toContain("emerald");   // priced (green)
      expect(copyLabels(total)).toEqual(["Copy supply figure", "Copy install figure", "Copy combined figure"]);
      // the same component: the item's own BoQ-rates line carries the identical labels / titles
      const all = [...el.querySelectorAll("button[aria-label^='Copy ']")];
      const outside = all.filter((b) => !total.contains(b));
      expect(outside.length).toBeGreaterThanOrEqual(3);
      const inTotal = [...total.querySelectorAll("button[aria-label^='Copy ']")];
      expect(inTotal.map((b) => b.getAttribute("title"))).toEqual(outside.slice(0, 3).map((b) => b.getAttribute("title")));
      expect(inTotal.map((b) => b.className)).toEqual(outside.slice(0, 3).map((b) => b.className));
      // each figure on its own line (the stacked figures row)
      const fig = total.querySelector("[data-testid='row-total-figures']")!;
      expect(fig.className).toContain("flex-col");
      expect(fig.children.length).toBe(3);
      // R1: the editable final-value box beside "Use this value" and Revert
      const use = [...el.querySelectorAll("button")].find((b) => /Use this value/.test(b.textContent ?? ""));
      expect(use, "Use this value").toBeTruthy();
      const box = el.querySelector("input[aria-label='Final value']") as HTMLInputElement | null;
      expect(box, "the final-value box").toBeTruthy();
      expect(box!.value, "pre-filled with the helper's figure").toMatch(/^\d/);
      expect([...el.querySelectorAll("button")].some((b) => /^\s*Revert\s*$/.test(b.textContent ?? "")), "Revert").toBe(true);
    });
  }
  it("NEGATIVE: a refused row's total (red) carries no copy control -- there is no figure to copy", () => {
    const el = boqPanel("hvac_valve_package", "Nos", [{ valve_type: "Butterfly Valve", size_mm: "900", scope: "Supply + installation" }]);
    const total = el.querySelector("[data-testid='item-row-total']")!;
    expect(total.className).toContain("red");
    expect(copyLabels(total)).toEqual([]);
  });
});

describe("DU-1 R2 -- the calculator and every category mount the same row total (source seam)", () => {
  const src = readFileSync(path.join(__dirname, "RateHelperPanel.tsx"), "utf-8");
  it("ONE row total in the panel, inside ItemListBlocks, mounting the one figures renderer with copy ON", () => {
    expect((src.match(/data-testid="item-row-total"/g) ?? []).length).toBe(1);
    const blocks = src.slice(src.indexOf("function ItemListBlocks("));
    expect(blocks).toContain("<FiguresRow figures={rowTotals(view)} muted stacked unit={view.rateUnit ?? view.unit} />");
    expect(src).not.toContain("copy={false}");
    expect((src.match(/<CopyFigureButton /g) ?? []).length).toBe(1);   // the same icon everywhere: one component
  });
  it("the calculator renders the panel (variant=calculator), whose item-list categories all go through ItemListBlocks", () => {
    const calc = readFileSync(path.join(__dirname, "../../pricing/PricingCalculator.tsx"), "utf-8");
    expect(calc).toMatch(/<RateHelperPanel[\s\S]{0,400}variant="calculator"/);
    expect((src.match(/<ItemListBlocks\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
