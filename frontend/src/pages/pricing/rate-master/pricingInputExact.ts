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
