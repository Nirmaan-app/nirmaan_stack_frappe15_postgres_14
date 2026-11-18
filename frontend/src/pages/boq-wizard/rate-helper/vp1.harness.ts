/**
 * VP-1 (2026-11-13) -- HVAC v65 + THE VP-1 FIXTURE = what HVAC v66 is, built in memory from the ONE fixture
 * (`pricing/__fixtures__/valveModel.json`) the mint reads too (`scripts/_instruments/mint_hvac_v66_valve.py`; test_valve_v66
 * proves the asset equals it). PURE. The fixture's items carry no `item_uid` (the mint mints them); here each gets a stable
 * synthetic one. `_boq` (the ruled sheet's BoQ supply / install) is kept for the identity proof and stripped from the items.
 */
import type { RateCategoryConfig, RateMasterItem } from "@/pages/pricing/rate-master/rateMasterTypes";
import { readJsonFixture } from "@/pages/pricing/calculatorPanelParity.harness";

export type Vp1Item = Omit<RateMasterItem, "discipline" | "item_uid"> & { brand?: string | null; source?: unknown; _boq?: [number, number] };
export interface Vp1Fixture {
  valve_config: RateCategoryConfig;
  misc_config: RateCategoryConfig;
  valve_items: Vp1Item[];
  misc_items: Vp1Item[];
  pricing_input: Vp1Item;
  piping_sheet_heading_notes: unknown[];
}
type Asset = { discipline: string; items: Array<Record<string, unknown>>; category_configs: RateCategoryConfig[] };

export const VP1: Vp1Fixture = readJsonFixture<Vp1Fixture>(new URL("../../pricing/__fixtures__/valveModel.json", import.meta.url));
export const VALVE = "hvac_valve_package";
export const MISC = "hvac_misc";

/** v65 (or any HVAC asset before v66) + the VP-1 additions: the two configs appended, the Piping note entry, the 137 items. */
export function applyVp1<A extends Asset>(base: A): A {
  const strip = (it: Vp1Item, uid: string) => { const { _boq: _b, ...rest } = it; return { ...rest, item_uid: uid }; };
  const items = [
    ...base.items,
    ...VP1.valve_items.map((it, n) => strip(it, `vp1-valve-${String(n + 1).padStart(3, "0")}`)),
    ...VP1.misc_items.map((it, n) => strip(it, `vp1-misc-${String(n + 1).padStart(2, "0")}`)),
    strip(VP1.pricing_input, "vp1-input-valve-uplift"),
  ];
  type WithPricing = { list_spec: { pricing: Record<string, unknown> } & Record<string, unknown> };
  const configs = base.category_configs.map((c) => {
    if (c.category_id !== "hvac_piping") return c;
    const ls = (c as unknown as WithPricing).list_spec;
    return { ...c, list_spec: { ...ls, pricing: { ...ls.pricing, sheet_heading_notes: VP1.piping_sheet_heading_notes } } } as unknown as RateCategoryConfig;
  });
  return { ...base, items, category_configs: [...configs, VP1.valve_config, VP1.misc_config] };
}
