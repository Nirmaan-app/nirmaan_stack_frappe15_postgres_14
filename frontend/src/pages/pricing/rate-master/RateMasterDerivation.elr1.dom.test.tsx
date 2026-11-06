// @vitest-environment jsdom
//
// ELR-1 AC6 / Q4 (owner 2026-10-27): the Derivation TAB as rendered -- wiring & cabling shows its rules list and NO
// extraction Rules card (no raw ids); the other eleven Electrical categories keep today's pointer line and card.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it } from "vitest";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import { RateMasterDerivation } from "./RateMasterDerivation";
import type { RateCategoryConfig, RateMasterItem } from "./rateMasterTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DATA = path.resolve(__dirname, "../../../../../nirmaan_stack/services/boq_rate_master/data");
const asset = readJsonFixture<never>(pathToFileURL(path.join(DATA, "rate_master_electrical_all_v67.json"))) as
  { items: RateMasterItem[]; category_configs: RateCategoryConfig[] };
const PAGE = "Electrical Pricing";

function tab(categoryId: string): HTMLElement {
  const host = document.createElement("div");
  const root = createRoot(host);
  const config = asset.category_configs.find((c) => c.category_id === categoryId)!;
  act(() => { root.render(<StrictMode><RateMasterDerivation items={asset.items} config={config} calculatorPage={PAGE} /></StrictMode>); });
  return host;
}

describe("ELR-1: the Derivation tab", () => {
  // ELR-4b (owner P6 WC-b / WC-c, 2026-10-29) INVERTED: WAS thirteen lines; NOW fifteen
  it("wiring_cabling: 'How a row is priced', fifteen lines (WAS thirteen), no pointer line, no extraction Rules card", () => {
    const host = tab("wiring_cabling");
    expect(host.querySelector('[data-testid="rate-master-item-list-order"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="rate-master-item-list-order"] li').length).toBe(15);
    expect(host.querySelector('[data-testid="rate-master-derivation-notice"]')).toBeNull();
    expect(host.querySelector('[data-testid="rate-master-rules-panel"]')).toBeNull();
    // NEGATIVE: the card's raw ids and field names are gone from the tab
    for (const raw of ["R10", "R11", "conduit_included", "size_mm", "applies_to"]) expect(host.textContent, raw).not.toContain(raw);
  });

  // ELR-4a (owner R-APPROVE + R-Q4, 2026-10-29) INVERTED: WAS the eleven other categories all kept the pointer line and
  // card; NOW point wiring, switches & sockets and pop-up boxes show their rules list, no pointer line and no card,
  // and the other eight are unchanged (the negative half below)
  it("ELR-4a: point wiring, switches & sockets and pop-up boxes show 'How a row is priced', no pointer line, no extraction Rules card", () => {
    for (const id of ["point_wiring", "switches_sockets", "popup_boxes"]) {
      const host = tab(id);
      expect(host.querySelectorAll('[data-testid="rate-master-item-list-order"] li').length, id).toBeGreaterThan(0);
      expect(host.querySelector('[data-testid="rate-master-derivation-notice"]'), id).toBeNull();
      expect(host.querySelector('[data-testid="rate-master-rules-panel"]'), id).toBeNull();
      for (const raw of ["R9", "R12", "R13", "S4", "P1", "applies_to", "blank_item", "conduit_handoff"]) expect(host.textContent, `${id} ${raw}`).not.toContain(raw);
    }
  });

  // ELR-4b (owner R-APPROVE + R-Q4; the P6 answer, 2026-10-29) INVERTED: WAS the other eight Electrical categories kept
  // the pointer line and their card; NOW they list their rules, with no pointer line and no card (the WAS pointer line is
  // asserted absent); the Pricing Inputs category keeps its own line (unchanged)
  it("NOW every Electrical category but the Pricing Inputs lists its rules: no pointer line, no extraction Rules card", () => {
    const line = `This category's rules are not listed yet. To see how a row is priced, open ${PAGE} -> Calculator.`;
    for (const c of asset.category_configs) {
      const host = tab(c.category_id);
      const notice = host.querySelector('[data-testid="rate-master-derivation-notice"]')?.textContent ?? null;
      expect(notice, c.category_id).not.toBe(line);
      if (c.category_id === "electrical_pricing_inputs") {
        expect(notice, c.category_id).toContain("Pricing Inputs hold shared numbers");
        expect(host.querySelector('[data-testid="rate-master-item-list-order"]'), c.category_id).toBeNull();
        continue;
      }
      expect(host.querySelectorAll('[data-testid="rate-master-item-list-order"] li').length, c.category_id).toBeGreaterThan(0);
      expect(notice, c.category_id).toBeNull();
      expect(host.querySelector('[data-testid="rate-master-rules-panel"]'), c.category_id).toBeNull();
    }
  });
});
