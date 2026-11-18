// @vitest-environment jsdom
/**
 * DU-1 FIX-4, RENDERED (owner 2026-11-15 13:34 "the derivation tab is part of rat emaster screen. it needs to be buiult there only"):
 * Rate Master > HVAC > Valve Package > Derivation nests Misc's OWN rules (Misc is borrow-only, `fetch_only`: no page of its own)
 * under the Misc section line; Piping's Insulation section is NOT nested (Insulation has its own page). On the committed v69 asset.
 */
import path from "path";
import { pathToFileURL } from "url";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it } from "vitest";
import { RateMasterDerivation, delegatedSectionIds } from "./RateMasterDerivation";
import { itemListRuleOrder } from "./itemListRuleOrder";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";
import { readJsonFixture } from "../calculatorPanelParity.harness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Asset = { discipline: string; items: RateMasterItem[]; category_configs: RateCategoryConfig[] };
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const V69 = readJsonFixture<Asset>(pathToFileURL(path.join(DATA, "rate_master_hvac_all_v69.json")));
const cfg = (id: string) => V69.category_configs.find((c) => c.category_id === id)!;
const ITEMS = V69.items.map((i) => ({ ...i, discipline: "HVAC" })) as RateMasterItem[];

function render(config: RateCategoryConfig, sectionConfigs: Record<string, RateCategoryConfig>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(createElement(RateMasterDerivation, { items: ITEMS, config, calculatorPage: "HVAC Pricing", sectionConfigs })); });
  return { host, cleanup: () => { act(() => root.unmount()); host.remove(); } };
}

describe("DU-1 FIX-4 -- the borrowed category's own rules, nested on the tab", () => {
  it("delegatedSectionIds: the Valve Package borrows Misc (fetch_only); Piping's Insulation section has its own page -> none", () => {
    expect(delegatedSectionIds(cfg("hvac_valve_package"))).toEqual(["hvac_misc"]);
    expect(delegatedSectionIds(cfg("hvac_piping"))).toEqual([]);
    expect(delegatedSectionIds(cfg("hvac_insulation"))).toEqual([]);
  });
  it("POSITIVE: the Valve Package tab shows Misc's own lines, numbered under the section line, generated from Misc's config", () => {
    const { host, cleanup } = render(cfg("hvac_valve_package"), { hvac_misc: cfg("hvac_misc") });
    try {
      const nested = host.querySelector('[data-testid="rate-master-section-rules"]');
      expect(nested).toBeTruthy();
      const misc = itemListRuleOrder(cfg("hvac_misc"), ITEMS);
      expect(nested!.querySelectorAll("li").length).toBe(misc.length);
      expect(nested!.textContent).toContain(misc[0].title);
      expect(nested!.closest("li")!.textContent).toContain("The misc item section is priced by Misc item's rules");
    } finally { cleanup(); }
  });
  it("NEGATIVE: Piping's tab (its Insulation section) nests nothing", () => {
    const { host, cleanup } = render(cfg("hvac_piping"), {});
    try {
      expect(host.querySelector('[data-testid="rate-master-section-rules"]')).toBeNull();
      expect(host.querySelectorAll('[data-testid="rate-master-item-list-order"] > div li').length).toBe(itemListRuleOrder(cfg("hvac_piping"), ITEMS).length);
    } finally { cleanup(); }
  });
});
