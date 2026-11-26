// @vitest-environment jsdom
//
// VAV-2c1 R5 c (owner 2026-11-22 20:04 "optoin a. just need to confirm that all 3 options iwll be in drop down for all categories"): the REAL
// `RateHelperPanel` -- the Scope box first in the card, all three choices in the drop-down, red for supply + installation and amber for the
// others with its one line, the pick re-pricing the lines ("- not in scope" beside the side left out) -- on the Calculator for each of the
// four categories that have a scope choice, and NO box on one that has none. jsdom does no layout: what is pinned is the DOM and the clicks.
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { RateHelperPanel } from "./RateHelperPanel";
import { makePricingSheetHelper } from "./pricingSheetHelper";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonFixture } from "../../pricing/calculatorPanelParity.harness";
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { EDITS, applyConfig } from "./vav2c1Edits.harness";

// the v81 FILE by name with v82's edits applied (vav2c1.harness does the same; a jsdom test cannot read through its file URLs)
type Asset = { items: RateMasterItem[]; category_configs: RateCategoryConfig[] };
const A = readJsonFixture<Asset>(pathToFileURL(path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v81.json")));
const ITEMS = A.items.map((i) => ({ ...i, discipline: "HVAC", attributes: { ...i.attributes, ...(i.brand ? { brand: i.brand } : {}) } } as RateMasterItem));
const CFGS = A.category_configs.map((c) => [c.category_id, applyConfig(c, EDITS.configs.filter((e) => e.c === c.category_id))] as [string, RateCategoryConfig]);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class StubResizeObserver { observe() { /* no layout */ } unobserve() { /* no layout */ } disconnect() { /* no layout */ } }
if (!(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver) (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => { /* no layout */ };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

function mount(cat: string): HTMLElement {
  const helper = makePricingSheetHelper({ configsByCategory: new Map(CFGS), items: ITEMS, extractionByRow: new Map() });
  const ctx = calculatorCtx("HVAC", cat);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<RateHelperPanel variant="calculator" excelRow={ctx.excelRow} col="calculator" kind="supply_rate" ctx={ctx} helpers={[helper]} calculatorBlocks={[]} fieldColumns={1} blockColumns={1} onUse={() => { /* none */ }} />));
  return host;
}
const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const pick = (el: HTMLElement, value: string) => {
  const s = q(el, "item-scope-picker")!.querySelector("select")!;
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => { set.call(s, value); s.dispatchEvent(new Event("change", { bubbles: true })); });
};
const clickText = (el: HTMLElement, re: RegExp) => {
  const b = [...el.querySelectorAll("button")].find((x) => re.test(x.textContent ?? ""));
  if (!b) throw new Error(`no button ${String(re)}`);
  act(() => { b.click(); });
};

describe("R5 c the Scope box", () => {
  const four = "Installation only (supply quoted on another row)";
  const CATS: Array<[string, string[]]> = [["hvac_vav_box", []], ["hvac_ducting", [four]], ["hvac_valve_package", [four]], ["hvac_vrf", [four]]];
  for (const [cat, more] of CATS) {
    it(`${cat}: first in the card, the three choices (and the Calculator's fourth where it had one), red then amber, its line`, () => {
      const el = mount(cat);
      const box = q(el, "item-scope-picker")!;
      expect(q(el, "item-list-blocks")!.firstElementChild).toBe(box);
      expect(box.textContent).toContain("Scope of this rate");
      expect([...box.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Supply + installation", "Supply only", "Installation only", ...more]);
      expect([box.dataset.scope, q(el, "item-scope-line")!.textContent]).toEqual(["both", "What this rate covers. Every line below follows it."]);
      expect(box.className).toContain("border-primary");
      pick(el, "Installation only");
      expect([q(el, "item-scope-picker")!.dataset.scope, q(el, "item-scope-line")!.textContent]).toEqual(["one", "Supply is not in scope: 0 on every line below."]);
      expect(q(el, "item-scope-picker")!.className).toContain("border-amber-500");
      pick(el, "Supply only");
      expect(q(el, "item-scope-line")!.textContent).toBe("Installation is not in scope: 0 on every line below.");
    });
  }
  it("NEGATIVE: a category with no scope choice has no box (Piping)", () => {
    expect(q(mount("hvac_piping"), "item-scope-picker")).toBeNull();
  });
  it("the lines under the pick: a valve's figures read 'not in scope' on the side left out, and not under supply + installation", () => {
    const el = mount("hvac_valve_package");
    clickText(el, /Add valve/);
    clickText(el, /^BTU Meter/);
    const size = q(el, "item-block")!.querySelector("select") as HTMLSelectElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(size, "80"); size.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(q(el, "figure-not-in-scope")).toBeNull();
    pick(el, "Installation only");
    expect([...el.querySelectorAll('[data-testid="figure-not-in-scope"]')].map((x) => x.textContent)).toEqual(["- not in scope"]);
    expect(q(el, "item-block")!.textContent).toContain("supply: 0 - not in scope");
    // the Calculator states the scope itself: the valve's installation-only uplift (50%) applies, as before this slice
    expect(q(el, "item-block")!.textContent).toContain("install: 3000 x (1 + 50%) = 4500");
    expect(q(el, "item-row-total")!.textContent).toContain("4500");
  });
});

