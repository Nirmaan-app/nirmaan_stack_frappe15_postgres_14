/**
 * THE IMPACT PANEL'S FIGURES, COMPUTED BY THE PRODUCT'S OWN PIPELINE.
 *
 * ⚠️ WHY THIS EXISTS, AND WHY IT DOES NOT RE-IMPLEMENT ANYTHING (owner ruling, 2026-09-29).
 * The panel used to price a SKU as `stored rate x the multiplier the input contributes`. That is the
 * same arithmetic the pipeline performs for a PAIR input and no rounding intervenes, so it agreed to
 * the rupee there — and it was WRONG for the other two shapes, measured end to end on a live BoQ row:
 *
 *   * an INSTALLATION SHARE read 13 -> 32.5 where the product quoted 10 -> 30. The pipeline applies the
 *     share to the COMPUTED SUPPLY rate (`supply_per_mtr`), not to a stored install column, and then
 *     rounds UP TO TENS (`roundup digits:-1`). The panel had the wrong BASE and no ROUNDING.
 *   * a FLAT ADDER read +44 where the product quoted +64. The addend is one `component` inside the SUM
 *     that the supply markup then multiplies (`sum_components` -> `scale base*(1+markup)`), so its real
 *     effect is the addend x 1.45. The panel added it AFTER the multiplier.
 *   * and a `conduit` DISCOUNT moved that row's INSTALL rate too, because install is a share OF supply.
 *     The panel named only the leg its own input moves.
 *
 * The owner's ruling is that the panel FOLLOWS the pipeline — not that the figures be relabelled
 * indicative. Re-deriving the pipeline's arithmetic in a second place is exactly how the first
 * disagreement happened, so this module does not do that: it runs `runPipeline`, the interpreter the
 * product itself prices with, ONCE over the catalogue as it stands and ONCE over the catalogue with the
 * edited pricing input patched in, and reports the two sets of outputs. It therefore CANNOT drift — a
 * change to a pipeline, a rounding or an order of operations is picked up for free.
 *
 * Measured: 0.18 ms per run, so a 450-SKU before-and-after is ~166 ms. The caller memoises it.
 *
 * PURE: no React, no DOM, no fetch. Unit-testable against a real asset.
 */
import { runPipeline } from "./ratePipelineInterpreter";
import type { Pipeline, PipelineResult, RateMasterItem } from "./rateMasterTypes";
import type { AdderSpec, InputReach } from "./pricingInputReach";
// ACCEPTANCE 23: the rate-helper panel's own pricer. See the block at the foot of this file for why
// this import edge exists and why a copy was not an option.
import { itemListPricingSpec, priceItemList, projectUnitClass } from "../../boq-wizard/rate-helper/itemListPricing";

/** a pipeline the panel can price a SKU through */
export interface ExactPipelineRef {
  category: string;
  pipelineId: string;
  pipeline: Pipeline;
}

/** one output of one pipeline, before and after */
export interface ExactLeg {
  /** the pipeline output key, e.g. `supply_per_mtr` */
  output: string;
  pipelineId: string;
  now: number;
  becomes: number;
  moved: boolean;
}

export interface ExactSkuResult {
  itemUid: string;
  legs: ExactLeg[];
  /** true when every pipeline priced; a SKU the pipeline refuses is reported, never silently dropped */
  ok: boolean;
  note?: string;
}

/**
 * The attribute selection that makes a pipeline match THIS SKU.
 *
 * ⚠️ IT IS THE SKU'S OWN ATTRIBUTES, plus the conditions the pipeline branches on. A SKU carries the
 * facts that identify it (`tray_type`, `material`, `width_mm`); a BoQ ROW carries the facts a branch
 * asks about (`installation_type`, `cover`, `floor_cutting`). The panel has no row, so the branch facts
 * are ASSUMPTIONS and the caller is given them back to state on screen — an unstated assumption is how
 * a figure becomes a promise the product will not keep.
 */
export function skuSelection(
  item: RateMasterItem,
  conditions: Record<string, unknown>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries((item.attributes ?? {}) as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number") out[k] = v;
  }
  for (const [k, v] of Object.entries(conditions)) {
    if (typeof v === "string" || typeof v === "number") out[k] = v;
  }
  return out;
}

/**
 * The branch conditions to price under: the ENABLING branch of the input's own adder where it has one,
 * and the branch that contributes NOTHING for every other conditional component in the pipeline.
 *
 * ⚠️ THE NEUTRAL CHOICE IS DELIBERATE. Pricing a ceiling tray as though it also had its floor trench
 * refilled would fold two unrelated options into one figure, and the reader could not tell which part
 * moved. The panel shows the input's OWN condition and holds everything else off.
 */
export function conditionsFor(reach: InputReach | null | undefined): Record<string, unknown> {
  const spec: AdderSpec | undefined = reach?.adder;
  const out: Record<string, unknown> = {};
  if (!spec) return out;
  // the enabling branch is the one that BINDS this input from ctx -- the other fixes a literal 0
  const enabling = (spec.branches ?? []).find((b) => Object.keys(b.ctxBinds ?? {}).length > 0
    && Object.keys(b.literals ?? {}).length === 0)
    ?? (spec.branches ?? []).find((b) => Object.keys(b.ctxBinds ?? {}).length > 0);
  for (const [k, v] of Object.entries(enabling?.when ?? {})) out[k] = v;
  return out;
}

/** the catalogue with ONE pricing input's rates overridden -- what the panel is proposing */
export function itemsWithInput(
  items: readonly RateMasterItem[],
  inputItemKey: string,
  rates: Record<string, number>,
): RateMasterItem[] {
  if (!inputItemKey || !Object.keys(rates).length) return items as RateMasterItem[];
  return items.map((i) => {
    const attrs = (i.attributes ?? {}) as Record<string, unknown>;
    if (!String(i.kind ?? "").endsWith("_pricing_input") || String(attrs.item ?? "") !== inputItemKey) {
      return i;
    }
    return { ...i, rates: { ...(i.rates ?? {}), ...rates } } as RateMasterItem;
  });
}

const EPS = 1e-9;

/**
 * Price ONE SKU through every pipeline that reads the input, before and after.
 *
 * ⚠️ EVERY OUTPUT THAT MOVES IS REPORTED, not only the leg the input nominally belongs to. A conduit
 * DISCOUNT moves `supply_per_mtr` AND `install_per_mtr`, because install is a share of supply; the
 * pipeline returns both, so showing both costs nothing and stops a pricer being surprised by a rate
 * that moved without being mentioned (owner ruling, gap (c)).
 */
export function priceSkuExact(
  item: RateMasterItem,
  refs: readonly ExactPipelineRef[],
  itemsNow: readonly RateMasterItem[],
  itemsNext: readonly RateMasterItem[],
  conditions: Record<string, unknown>,
): ExactSkuResult {
  const sel = skuSelection(item, conditions);
  const legs: ExactLeg[] = [];
  let ok = false;
  let note: string | undefined;

  for (const ref of refs) {
    let a: PipelineResult;
    let b: PipelineResult;
    try {
      a = runPipeline(ref.pipelineId, ref.pipeline, itemsNow as RateMasterItem[], sel);
      b = runPipeline(ref.pipelineId, ref.pipeline, itemsNext as RateMasterItem[], sel);
    } catch {
      ok = false; note = note ?? "the pipeline could not price this SKU";
      continue;
    }
    /**
     * ⚠️ A `no_match` IS NORMAL AND MUST NOT BE READ AS A FAILURE. An input is read by every pipeline
     * that mentions it, and those span kinds -- `conduit` is read by the conduit, point-wiring and
     * cable pipelines, and only one of them prices a conduit SKU. Counting the others as failures made
     * the whole result "not ok" while every figure in it was right.
     */
    if (a.status !== "ok" || b.status !== "ok") {
      if (a.status !== "no_match" && b.status !== "no_match") {
        note = note ?? (a.note || b.note || a.status);
      }
      continue;
    }
    // ⚠️ the run must have matched THIS SKU. A `catalog_fit` ladder can land on a neighbouring rung,
    // and a figure attributed to the wrong row is worse than no figure.
    if (a.matchedItem && item.item_uid && a.matchedItem.item_uid !== item.item_uid) continue;

    for (const out of Object.keys(a.finals ?? {})) {
      const now = a.finals[out];
      const becomes = b.finals?.[out];
      if (typeof now !== "number" || typeof becomes !== "number") continue;
      legs.push({ output: out, pipelineId: ref.pipelineId, now, becomes,
                  moved: Math.abs(becomes - now) > EPS });
    }
  }
  legs.sort((x, y) => x.output.localeCompare(y.output));
  // ok means AT LEAST ONE pipeline priced this SKU; a SKU no pipeline prices is reported, never dropped
  ok = legs.length > 0;
  return { itemUid: String(item.item_uid ?? ""), legs, ok, note: ok ? undefined : (note ?? "no pipeline priced this SKU") };
}

/**
 * Which leg a pipeline OUTPUT belongs to. The outputs are named by convention across every category
 * (`supply_per_mtr`, `install_per_rmt`, `bcs_supply`), and there is no declared metadata for it — so
 * this is a READING of the name and is kept in ONE place rather than spread across the panel. A name
 * it cannot classify falls to the supply leg, which is what the panel headlines.
 */
export function legClassOf(output: string): "bcs" | "install" | "supply" {
  const o = output.toLowerCase();
  if (o.includes("bcs")) return "bcs";
  if (o.includes("install")) return "install";
  return "supply";
}

/** the human name of a leg, for the panel's "and this also moves" line */
export const LEG_CLASS_LABEL: Record<"bcs" | "install" | "supply", string> = {
  supply: "BoQ supply rate",
  install: "BoQ install rate",
  bcs: "BCS rate",
};

/**
 * The NEUTRAL branch of every OTHER conditional component in the pipelines: the one whose params are
 * all literals, which is how these configs express "this option is not taken" (a zero rate, a factor
 * of 0). Without them a pipeline that branches on `cover`, `floor_refilling` and `floor_cutting` never
 * resolves, the run is not `ok`, and the panel silently falls back to the approximate arithmetic — the
 * exact path looks wired and does nothing, which is worse than not having it.
 *
 * ⚠️ The input's OWN component is skipped, so `conditionsFor` keeps deciding that one: its enabling
 * branch is the whole point of the panel. Everything else is held OFF, so two unrelated options are
 * never folded into one figure.
 */
export function neutralConditions(
  refs: readonly ExactPipelineRef[],
  ownComponent?: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const ref of refs) {
    const steps: any[] = (ref.pipeline as any)?.steps ?? [];
    for (const st of steps) {
      if (st?.step !== "component" && st?.step !== "component_band") continue;
      if (ownComponent && st?.name === ownComponent) continue;
      const conds: any[] = st?.conditions ?? [];
      if (conds.length < 2) continue;
      /**
       * ⚠️ THE TEST IS "EVERY LITERAL IS ZERO", NOT "EVERY PARAM IS A LITERAL". The cable-tray `cover`
       * component's off-branch is `{factor: 0.0, discount_from_ctx: ...}` — a zero literal BESIDE a ctx
       * bind — so the stricter test rejected it, `cover` was left unset, the pipeline never resolved
       * and the exact path silently fell back to the approximate arithmetic on every tray. A branch
       * carrying no literal at all is the ENABLING one and is never neutral.
       */
      const neutral = conds.find((c) => {
        const params = c?.params ?? {};
        const literals = Object.keys(params).filter((k) => typeof params[k] === "number");
        return literals.length > 0 && literals.every((k) => params[k] === 0);
      });
      for (const [k, v] of Object.entries(neutral?.when ?? {})) {
        if (!(k in out)) out[k] = v;
      }
    }
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 12c, ACCEPTANCE ITEM 23 -- ONE PRICING PATH FOR AN ITEM-LIST CATEGORY
//
// Owner: "for the pricing input sheet panel, we need to use the same pipeline for pricing impact
// calculation as the rate helper panel. just like we did for electrical."
//
// For a category-level category that is `runPipeline`, which `priceSkuExact` above already calls. An
// ITEM-LIST category does NOT price a row by running one pipeline: `priceItemList` resolves the
// family, the unit class, the ladders, the defaults, the overrides and the per-row conditions FIRST,
// and only then runs the pipeline that combination selects. So pricing such a SKU by picking a
// pipeline out of `list_spec` and running it directly would be a SECOND IMPLEMENTATION of all of that
// -- the precise bet that failed once already and produced an install share of 32.5 against the
// product's 30.
//
// ⚠️ AND IT WOULD BE WRONG IN A SPECIFIC, PLAUSIBLE WAY HERE. Insulation's cladding is one component
// with six branches keyed on the row's OWN `cladding`; `conditionsFor` can only pick ONE enabling
// branch, so a 26G input would be priced as though every one of the 224 rows were clad in 26G. The
// figures would look right and the row count would be 224 instead of the 68 that actually move.
// Going through `priceItemList` resolves each SKU's branch from its own attributes, so the count and
// every figure fall out of the product's own code.
//
// THE ONE IMPORT EDGE this creates (rate-master -> rate-helper) is deliberate and is the point: the
// alternative is a copy. `itemListPricing` imports the interpreter and the types from THIS folder and
// nothing from this file, so there is no cycle.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Price ONE SKU of an ITEM-LIST category before and after, through `priceItemList` -- the exact
 * function the rate-helper panel and the calculator price a BoQ row with.
 *
 * The "row" is built from the SKU's own attributes, which is what makes this a statement about that
 * SKU: a perfectly-stated row for it. Its unit is the SKU's own unit, resolved through the same
 * `unit_classes` the read-time projection uses.
 */
export function priceSkuExactItemList(
  item: RateMasterItem,
  config: unknown,
  itemsNow: readonly RateMasterItem[],
  itemsNext: readonly RateMasterItem[],
): ExactSkuResult {
  const uid = String(item.item_uid ?? "");
  const spec = itemListPricingSpec(config as never);
  if (!spec) return { itemUid: uid, legs: [], ok: false, note: "this category has no item-list pricing rules" };

  const attributes: Record<string, { value: string | number | null }> = {};
  for (const [k, v] of Object.entries((item.attributes ?? {}) as Record<string, unknown>)) {
    // the projected unit class is not a stated fact -- the ROW's unit carries that
    if (k === spec.unit_class_attr) continue;
    if (v === null || v === undefined || v === "") continue;
    attributes[k] = { value: String(v) };
  }
  const rowUnit = String(item.unit ?? "");
  const ext = [{ attributes } as never];

  let a: ReturnType<typeof priceItemList>;
  let b: ReturnType<typeof priceItemList>;
  try {
    a = priceItemList(spec, itemsNow as RateMasterItem[], rowUnit, ext);
    b = priceItemList(spec, itemsNext as RateMasterItem[], rowUnit, ext);
  } catch {
    return { itemUid: uid, legs: [], ok: false, note: "the pricing rules could not price this SKU" };
  }
  if (!a.priced || !b.priced) {
    // a SKU the rules refuse is REPORTED with its own reason, never silently dropped
    return { itemUid: uid, legs: [], ok: false, note: a.reason ?? b.reason ?? "not priced" };
  }

  const legs: ExactLeg[] = [];
  // EVERY output that moves, exactly as the category-level path: an input that moves supply may move
  // install too, and a rate that moves unmentioned is how a pricer is surprised.
  for (const [output, now, becomes] of [
    ["supply", a.supply, b.supply] as const,
    ["install", a.install, b.install] as const,
  ]) {
    if (typeof now !== "number" || typeof becomes !== "number") continue;
    legs.push({ output, pipelineId: "item_list", now, becomes, moved: Math.abs(becomes - now) > EPS });
  }
  legs.sort((x, y) => x.output.localeCompare(y.output));
  return { itemUid: uid, legs, ok: legs.length > 0,
           note: legs.length ? undefined : "the rules returned no figure for this SKU" };
}

/** True when this config prices a row through `priceItemList` rather than one named pipeline. */
export function isItemListConfig(config: unknown): boolean {
  return !!itemListPricingSpec(config as never);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// SLICE 12c, OWNER RULING 2 / U9 -- SAMPLE GEOMETRIES FOR A SKU WITH NO GEOMETRY OF ITS OWN
//
// Owner: "show 2-3 sample impact calculations based on sizes stored in SKU."
//
// A CLADDING-ONLY SKU is a row that prices a cladding and nothing else, so it carries no pipe size
// and no thickness -- and a cladding cost is proportional to the girth, which is made of exactly
// those two. One figure for such a row would therefore be a figure for a geometry nobody named. The
// ruling is to show a FEW, at sizes the catalogue actually stocks.
//
// THE RULE, fixed and documented so no sample is ever a hand-picked number: take the DISTINCT tuples
// of the category's LADDER attributes across the family's active SKUs, order them, and take the
// SMALLEST, the MIDDLE and the LARGEST. Three samples show the range and its middle, which is what a
// reader needs to judge a per-girth rate; fewer than three distinct tuples yields however many exist.
// No size is written in code and no category is named -- the axes come from `spec.ladders` and the
// values from the catalogue.
//
// ⚠️ THIS FUNCTION IS SHIPPED AND TESTED BUT IS NOT RENDERED, because THERE ARE NO CLADDING-ONLY SKUs
// IN THE CATALOGUE. Design question O1 put the two shapes to the owner -- (i) one SKU per cladding
// type per geometry, 200 new rows, or (ii) one SKU per cladding type, 5 new rows -- and that choice is
// still open, as is Q7's PROVISIONAL rider about whether a per-sq.m cladding-only row takes the
// overlap factor. Minting the rows is the step this is waiting on; the picker is ready for it.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/** One sample geometry: the ladder attribute values a sample calculation is run at. */
export type SampleGeometry = Record<string, number>;

/**
 * Up to `want` sample geometries for a family, taken from the catalogue's own stocked combinations.
 * PURE. Returns [] when the category has no ladders or the family has no stocked tuple.
 */
export function sampleGeometries(
  spec: Parameters<typeof projectUnitClass>[0],
  items: readonly RateMasterItem[],
  /**
   * The family whose stocked geometries to sample, or NULL for "any family of this kind and unit
   * class". ⚠️ NULL IS WHAT A CLADDING-ONLY SKU NEEDS: its own family deliberately stores no pipe
   * size and no thickness (that is the whole point of its shape), so the sizes can only come from
   * the rows that DO store them. The owner's words are "based on sizes stored in SKU" -- stored in
   * the catalogue, not stored on that one row.
   */
  family: string | null,
  unitClass: string,
  want = 3,
): SampleGeometry[] {
  const famAttr = spec.family_attribute_id ?? "family";
  const axes = (spec.ladders ?? []).filter((a) => typeof a === "string" && a);
  if (!axes.length) return [];

  // ⚠️ THROUGH THE REAL PROJECTOR. The unit class is NOT stored on a catalogue row -- it is projected
  // at READ TIME from the row's `unit` through `unit_classes`, so a raw item carries no such attribute
  // and filtering on it found nothing at all. Calling `projectUnitClass` rather than re-deriving the
  // mapping is the same single-definition rule the rest of this file follows.
  const seen = new Map<string, SampleGeometry>();
  for (const it of projectUnitClass(spec, items as RateMasterItem[])) {
    if (it.kind !== spec.kind) continue;
    const at = (it.attributes ?? {}) as Record<string, unknown>;
    if (family !== null && String(at[famAttr] ?? "") !== family) continue;
    if (String(at[spec.unit_class_attr] ?? "") !== unitClass) continue;
    const tuple: SampleGeometry = {};
    let complete = true;
    for (const a of axes) {
      const n = typeof at[a] === "number" ? (at[a] as number) : Number(at[a]);
      if (!Number.isFinite(n)) { complete = false; break; }
      tuple[a] = n;
    }
    // a row that does not carry every axis is not a stocked GEOMETRY and cannot be a sample
    if (!complete) continue;
    seen.set(axes.map((a) => tuple[a]).join("\u0000"), tuple);
  }
  const all = Array.from(seen.values()).sort((x, y) => {
    for (const a of axes) if (x[a] !== y[a]) return x[a] - y[a];
    return 0;
  });
  if (all.length <= want) return all;
  if (want <= 1) return [all[0]];
  if (want === 2) return [all[0], all[all.length - 1]];
  // SMALLEST, MIDDLE, LARGEST -- and then evenly spaced for a larger `want`, so the rule stays one rule
  const picks: SampleGeometry[] = [];
  for (let i = 0; i < want; i++) {
    const idx = Math.round((i * (all.length - 1)) / (want - 1));
    if (!picks.includes(all[idx])) picks.push(all[idx]);
  }
  return picks;
}


/** One priced sample: the geometry it was run at, and the figures the rules returned there. */
export interface SampleImpact {
  geometry: SampleGeometry;
  result: ExactSkuResult;
}

/**
 * Does this SKU carry every geometry axis the rules ladder on? A row that does not cannot be priced
 * on its own -- it needs a geometry from somewhere, which is what the samples supply. PURE.
 */
export function skuCarriesGeometry(config: unknown, item: RateMasterItem): boolean {
  const spec = itemListPricingSpec(config as never);
  const axes = ((spec?.ladders ?? []) as unknown[]).filter(
    (a): a is string => typeof a === "string" && !!a,
  );
  if (!spec || !axes.length) return true;        // nothing to carry; the SKU is self-sufficient
  const at = (item.attributes ?? {}) as Record<string, unknown>;
  return axes.every((a) =>
    Number.isFinite(typeof at[a] === "number" ? (at[a] as number) : Number(at[a])),
  );
}

/**
 * OWNER F3: "show 2-3 sample impact calculations based on sizes stored in SKU."
 *
 * Up to `want` priced samples for a SKU that carries no geometry of its own. Each one runs the SAME
 * `priceSkuExactItemList` -- the product's own pricer -- over the SKU's attributes PLUS one stocked
 * geometry, so a sample cannot drift from what the panel would quote for a real row of that size.
 *
 * ⚠️ IT NEVER MUTATES THE CATALOGUE ROW: the geometry goes into a shallow COPY whose `attributes` is
 * a fresh object. Writing it onto the row would persist a geometry the SKU deliberately does not
 * have -- the read-time-projection rule, one level down.
 *
 * Empty when the SKU already carries its geometry (it is priced directly, no samples needed) or when
 * the catalogue stocks no complete geometry to sample. PURE.
 */
export function priceSkuExactSamples(
  item: RateMasterItem,
  config: unknown,
  itemsNow: readonly RateMasterItem[],
  itemsNext: readonly RateMasterItem[],
  want = 3,
): SampleImpact[] {
  const spec = itemListPricingSpec(config as never);
  if (!spec || skuCarriesGeometry(config, item)) return [];
  const unitClass = String(
    ((projectUnitClass(spec, [item])[0]?.attributes ?? {}) as Record<string, unknown>)[
      spec.unit_class_attr
    ] ?? "",
  );
  // family NULL: the sizes come from whatever this kind + unit class actually stocks
  const geometries = sampleGeometries(spec, itemsNow, null, unitClass, want);
  const out: SampleImpact[] = [];
  for (const geometry of geometries) {
    const probe = {
      ...item,
      attributes: { ...((item.attributes ?? {}) as Record<string, unknown>), ...geometry },
    } as RateMasterItem;
    out.push({ geometry, result: priceSkuExactItemList(probe, config, itemsNow, itemsNext) });
  }
  return out;
}
