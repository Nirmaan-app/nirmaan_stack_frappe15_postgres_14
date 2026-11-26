// #1741 -- MACHINE READ (pricingSheetHelper Deps.machineRead): a helper whose caller reads only the figures (the server's
// driving-field measure) skips the display text pass (`say`, plainItemListView). The figures are the same; the text is
// the pricer's own; a helper without the flag, made after or beside it, is untouched.
import { describe, expect, it } from "vitest";
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";
import type { RateHelperRowContext } from "./rateHelperTypes";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, makePricingSheetHelper, type ItemListEditState, type ItemListSuggestion } from "./pricingSheetHelper";

type Asset = { discipline: string; items: Array<Omit<RateMasterItem, "discipline">>; category_configs: RateCategoryConfig[] };
const ASSET = readJsonFixture<Asset>(new URL("../../../../../nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v37.json", import.meta.url));
const CONFIGS = new Map<string, RateCategoryConfig>(ASSET.category_configs.map((c) => [c.category_id, c]));
const ITEMS: RateMasterItem[] = ASSET.items.map((it) => ({ ...it, discipline: ASSET.discipline } as RateMasterItem));
const STATE: ItemListEditState = { items: [{ base: null, family: "Nitrile Rubber Insulation", attrs: { cladding: "26G Aluminium", pipe_size_mm: "50" }, other: ["pipe_size_mm"] }] };

function price(machineRead?: boolean) {
  const h = makePricingSheetHelper({ configsByCategory: CONFIGS, items: ITEMS, extractionByRow: new Map(), ...(machineRead ? { machineRead } : {}) });
  const ctx: RateHelperRowContext = { excelRow: 1, description: "", nodeType: "Line Item", category: "hvac_insulation", discipline: "HVAC",
    rateKinds: ["supply_rate", "install_rate", "combined_rate"] };
  return h.compute(ctx, { [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(STATE), [ROW_UNIT_OVERRIDE_KEY]: "mts" }) as ItemListSuggestion;
}

describe("#1741 machine read", () => {
  it("prices the same figures, and keeps the pricer's own text (no field label rewriting)", () => {
    const shown = price(), machine = price(true);
    expect(machine.values).toEqual(shown.values);
    expect(machine.itemList!.rowPriced).toBe(shown.itemList!.rowPriced);
    expect(shown.itemList!.items[0].working.join("\n")).not.toContain("thickness_mm");
    expect(JSON.stringify(machine.itemList)).not.toBe(JSON.stringify(shown.itemList));
  });

  it("a helper without the flag, after one with it, shows the plain text again", () => {
    const before = JSON.stringify(price());
    price(true);
    expect(JSON.stringify(price())).toBe(before);
  });
});
