/**
 * ELR-3a (owner R-9, R-18, Q5, Q7) -- THE WORKED EXAMPLES for a Pricing Input that moves no SKU's own rate.
 *
 * The four point-wiring numbers (first-point length, per-further-point length, circuit stretch, conduit fills) build
 * an ASSEMBLY: they scale no catalogue rate, so the impact panel's SKU list is empty for them. R-9: "if they dont
 * directly impact the price of any sku, we can just tell the impact on the assemblies it has...with a few common
 * examples worked out to show before and after and change". The examples are real stored row shapes, kept in the
 * category's own config as `impact_examples` (owner Q5) -- data, minted with the asset, never code.
 *
 * ⚠️ EVERY FIGURE COMES FROM THE PRODUCT (owner R-18). "before" is `makePricingSheetHelper(...).compute(row)` over the
 * catalogue as stored; "after" is the SAME call over the catalogue with the edited value patched into the input
 * (`itemsWithInput`, the panel's existing patch). This module adds no arithmetic of its own: the change and the % come
 * from `exampleLegChange` in pricingInputImpact.ts, where the panel's arithmetic lives. A source pin holds it.
 */
import type { RateMasterItem } from "./rateMasterTypes";
import type { InputReach } from "./pricingInputReach";
import { itemsWithInput } from "./pricingInputExact";
import { exampleLegChange, type ExampleLegChange } from "./pricingInputImpact";
import { makePricingSheetHelper } from "../../boq-wizard/rate-helper/pricingSheetHelper";

/** One worked example as the config stores it. */
export interface ImpactExample {
  id: string;
  /** what the example is, in the pricer's words */
  name: string;
  /** the stored BoQ row this shape was taken from (shown as provenance, never priced from) */
  source?: string;
  /** the row's attribute values -- exactly what a stored extraction holds */
  attrs: Record<string, string | number>;
  /** why an edit leaves this example unmoved, when the config knows ("a stated length is kept") */
  no_change_reason?: string;
}

/** The three figures an example shows, in this order (owner: supply, install, total). */
export const EXAMPLE_LEGS = ["supply_rate", "install_rate", "combined_rate"] as const;
export type ExampleLeg = (typeof EXAMPLE_LEGS)[number];
export const EXAMPLE_LEG_LABEL: Record<ExampleLeg, string> = { supply_rate: "Supply", install_rate: "Install", combined_rate: "Total" };

export type ExampleFigures = { ok: true; values: Record<ExampleLeg, number> } | { ok: false; reason: string };

export interface ExampleImpact {
  category: string;
  example: ImpactExample;
  before: ExampleFigures;
  after: ExampleFigures;
  /** per leg, once both sides price: before, after, change, % (from `exampleLegChange`) */
  legs: Array<{ leg: ExampleLeg } & ExampleLegChange>;
  /** true when any leg moved -- false is shown as "no change", with the example's reason where it has one */
  moved: boolean;
}

type ConfigLike = { discipline?: string; impact_examples?: unknown; pipelines?: Record<string, unknown> } & Record<string, unknown>;

/** A config's examples, shape-checked: a malformed entry is dropped here and refused by the validator at save. */
export function impactExamplesOf(cfg: ConfigLike | null | undefined): ImpactExample[] {
  const raw = Array.isArray(cfg?.impact_examples) ? (cfg!.impact_examples as unknown[]) : [];
  return raw.filter((e): e is ImpactExample => {
    const x = e as Partial<ImpactExample> | null;
    return !!x && typeof x.id === "string" && typeof x.name === "string" && !!x.attrs && typeof x.attrs === "object";
  });
}

/** The examples an input's panel shows: those of every category whose rules read it, in category order. */
export function examplesForInput(
  reach: InputReach | null | undefined,
  configs: Record<string, ConfigLike | undefined> | null | undefined,
): Array<{ category: string; example: ImpactExample }> {
  const out: Array<{ category: string; example: ImpactExample }> = [];
  for (const category of reach?.readByCategories ?? []) {
    for (const example of impactExamplesOf(configs?.[category])) out.push({ category, example });
  }
  return out;
}

/** One example priced by the PRODUCT's compute, the same call the BoQ panel and the calculator make (R-18). */
export function priceExample(
  category: string,
  example: ImpactExample,
  configs: Record<string, ConfigLike | undefined>,
  items: readonly RateMasterItem[],
): ExampleFigures {
  const ROW = 1;
  const attributes = Object.fromEntries(Object.entries(example.attrs).map(([k, v]) => [k, { value: v }]));
  const helper = makePricingSheetHelper({
    configsByCategory: new Map(Object.entries(configs).filter(([, c]) => !!c) as Array<[string, never]>),
    items: items as RateMasterItem[],
    extractionByRow: new Map([[ROW, { excelRow: ROW, description: example.name, attributes }]]),
  } as never);
  const res = helper.compute({
    excelRow: ROW, description: example.name, nodeType: "Line Item", category,
    discipline: String(configs[category]?.discipline ?? ""), rateKinds: [...EXAMPLE_LEGS], unit: "",
  } as never, {}) as { kind?: string; values?: Partial<Record<ExampleLeg, number>>; reason?: string };
  const v = res?.values ?? {};
  if (EXAMPLE_LEGS.every((l) => typeof v[l] === "number" && Number.isFinite(v[l]))) {
    return { ok: true, values: { supply_rate: v.supply_rate!, install_rate: v.install_rate!, combined_rate: v.combined_rate! } };
  }
  return { ok: false, reason: res?.reason || "does not price" };
}

/**
 * Every example the input's panel shows, before and after the (unsaved) edit. `patch` is the input's edited values,
 * exactly what `computeImpact` patches with; an empty patch is the no-edit view (after === before, nothing moved).
 */
export function computeExampleImpacts(
  inputItemKey: string,
  patch: Record<string, number>,
  reach: InputReach | null | undefined,
  configs: Record<string, ConfigLike | undefined>,
  items: readonly RateMasterItem[],
): ExampleImpact[] {
  const found = examplesForInput(reach, configs);
  if (!found.length) return [];
  const itemsNext = itemsWithInput(items, inputItemKey, patch);
  return found.map(({ category, example }) => {
    const before = priceExample(category, example, configs, items);
    const after = itemsNext === items ? before : priceExample(category, example, configs, itemsNext);
    const legs = before.ok && after.ok
      ? EXAMPLE_LEGS.map((leg) => ({ leg, ...exampleLegChange(before.values[leg], after.values[leg]) }))
      : [];
    return { category, example, before, after, legs, moved: legs.some((l) => l.moved) || before.ok !== after.ok };
  });
}
