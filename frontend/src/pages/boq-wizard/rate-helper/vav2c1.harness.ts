/**
 * VAV-2c1: HVAC v82's edits (ONE file, `__fixtures__/vav2c1Edits.json`, also read by scripts/_instruments/mint_hvac_v82_vav2c1.py) applied to
 * SCRATCH COPIES of the v81 FILE (read by name, sha256 2713477f...), so the vav2c1* tests run the same before the v82 mint and after it. The
 * asset files are never written. Plus a generic calculator over ANY HVAC category, for the scope tests (T2: every kind of each category).
 */
import type { RateCategoryConfig, RateMasterItem } from "../../pricing/rate-master/rateMasterTypes";
import { calculatorCtx } from "../../pricing/PricingCalculator";
import { ITEM_LIST_OVERRIDE_KEY, ROW_UNIT_OVERRIDE_KEY, SCOPE_OVERRIDE_KEY, makePricingSheetHelper, type ItemListSuggestion, type ItemListView } from "./pricingSheetHelper";
import { surfaceMap } from "./vav1Vav.harness";
import { assetByName } from "./v78ByName.harness";
import { SHARES_OVERRIDE_KEY, type SharesEditState } from "./vavSheetShares";
import { EDITS, applyConfig, type ConfigEdit } from "./vav2c1Edits.harness";

type Json = Record<string, unknown>;
export { EDITS, applyConfig, type ConfigEdit };

/** the v81 FILE by name -- the base of v82 */
export const V81 = assetByName("rate_master_hvac_all_v81.json", "2713477f");
export const VAV = "hvac_vav_box";
/** the items as the app hands them on: a brand sits among the item's attributes too */
export const ITEMS81: RateMasterItem[] = V81.items.map((i) => (i.brand ? { ...i, attributes: { ...i.attributes, brand: i.brand } } as RateMasterItem : i));

const editsOf = (cat: string, drop: (e: ConfigEdit) => boolean = () => false) => EDITS.configs.filter((e) => e.c === cat && !drop(e));
/** a category's v82 config; `drop` leaves edits out (vacuity) */
export const cfg82 = (cat: string = VAV, drop?: (e: ConfigEdit) => boolean): RateCategoryConfig => applyConfig(V81.byId.get(cat)!, editsOf(cat, drop));
export const byId82 = (): Map<string, RateCategoryConfig> => new Map([...V81.byId.keys()].map((k) => [k, cfg82(k)]));
/** v82's items; `over` sets a Pricing Input's factor (null removes the input) for a test */
export function items82(over: Record<string, number | null> = {}): RateMasterItem[] {
  return V81.items.flatMap((i) => {
    const t = EDITS.pricing_inputs[String(i.item_uid)];
    const it = t ? { ...i, unit: t.unit?.[1] ?? i.unit, attributes: { ...i.attributes, ...(t.remarks ? { remarks: t.remarks[1] } : {}), ...(t.name ? { name: t.name[1] } : {}) } } as RateMasterItem : i;
    const id = /_pricing_input$/.test(String(i.kind)) ? String(i.attributes?.item ?? "") : "";
    if (!(id in over)) return [it];
    return over[id] === null ? [] : [{ ...it, rates: { ...(it.rates as Json), factor: over[id] } } as unknown as RateMasterItem];
  });
}

/** where a category's scope config sits (VRF's under `extras`, every other at pricing level) */
export function scopeOf(cfg: RateCategoryConfig): Json {
  const pr = (cfg as unknown as { list_spec: { pricing: { scope?: Json; extras?: { scope?: Json } } } }).list_spec.pricing;
  return (pr.extras?.scope ?? pr.scope)!;
}
/** a copy whose lines follow the scope (or not: the key taken out) */
export function followed(cfg: RateCategoryConfig, on: boolean): RateCategoryConfig {
  const c = structuredClone(cfg);
  if (on) scopeOf(c).lines_follow = { word: "not in scope" }; else delete scopeOf(c).lines_follow;
  return c;
}

export type CalcIn = { state: Json; unit: string; scope?: string; shares?: SharesEditState; more?: Record<string, string> };
/** the calculator's own construction (PricingCalculator.tsx) on ANY HVAC category, with one config replaced */
export function calcOf(cat: string, cfg: RateCategoryConfig, input: CalcIn, items: RateMasterItem[] = ITEMS81): ItemListView | undefined {
  const map = surfaceMap([], V81.byId);
  map.set(cat, cfg);
  const h = makePricingSheetHelper({ configsByCategory: map, items, extractionByRow: new Map() });
  return (h.compute(calculatorCtx("HVAC", cat), {
    [ITEM_LIST_OVERRIDE_KEY]: JSON.stringify(input.state), [ROW_UNIT_OVERRIDE_KEY]: input.unit,
    ...(input.scope ? { [SCOPE_OVERRIDE_KEY]: input.scope } : {}), ...(input.shares ? { [SHARES_OVERRIDE_KEY]: JSON.stringify(input.shares) } : {}), ...(input.more ?? {}),
  }) as unknown as ItemListSuggestion).itemList;
}

type Def = { id: string };
type Spec = { family_attribute_id: string; attribute_definitions: Def[]; pricing: { families: Record<string, unknown>; numbers?: Json } };
/** every kind (family) of a category that the calculator prices from its OWN catalogue facts alone: family -> one calculator input each,
 *  found by trying the family's catalogue items with each of the calculator's row units. The count is asserted by the test. */
export function pricedKinds(cat: string, cfg: RateCategoryConfig, tries = 12): Map<string, CalcIn> {
  const spec = (cfg as unknown as { list_spec: Spec }).list_spec;
  const fa = spec.family_attribute_id;
  const units = calcOf(cat, cfg, { state: { items: [] }, unit: "" })?.unitChoices ?? ["Nos"];
  const out = new Map<string, CalcIn>();
  for (const fam of Object.keys(spec.pricing.families)) {
    const its = V81.items.filter((i) => i.attributes?.[fa] === fam).slice(0, tries);
    for (const it of its) {
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(it.attributes ?? {})) if (k !== fa && v !== null && v !== "" && v !== "None") attrs[k] = String(v);
      // what a person types into the boxes of these categories (the sizes as written), beside the catalogue's own facts
      if (attrs.thickness_mm) attrs.gauge_as_written = attrs.thickness_mm;
      if (attrs.cfm_range) attrs.airflow_cfm = String(Number(attrs.cfm_range.split("-")[1] ?? "700") - 1);
      const unit = units.find((u) => calcOf(cat, cfg, { state: { items: [{ base: null, family: fam, attrs: { ...(it.brand ? { brand: String(it.brand) } : {}), ...attrs } }] }, unit: u })?.rowPriced);
      if (unit) { out.set(fam, { state: { items: [{ base: null, family: fam, attrs: { ...(it.brand ? { brand: String(it.brand) } : {}), ...attrs } }] }, unit }); break; }
    }
  }
  return out;
}
