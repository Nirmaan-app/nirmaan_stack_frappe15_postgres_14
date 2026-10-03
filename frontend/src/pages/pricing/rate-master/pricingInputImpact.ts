/**
 * SLICE 12b(B) -- WHAT A PRICING-INPUT EDIT DOES TO EVERY SKU IT REACHES. PURE: no React, no fetch.
 *
 * The panel's whole arithmetic lives here so it is testable without a DOM (this repo has no DOM test
 * environment -- see `frontend/CLAUDE.md`).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * OWNER RULING N-1 -- WHAT A SKU'S RATE MEANS, AND IT IS NOT A ROW TOTAL.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * "the system quotes assemblies, but assemblies are priced from SKUs. we need to see the impact on SKU
 * price." So the figure per SKU is **its own stored rate times the multiplier chain, UNROUNDED** -- and
 * it is labelled "SKU rate", NEVER "the quote".
 *
 * ⚠️ WHY UNROUNDED IS A DECISION, NOT LAZINESS. The product rounds the ROW, once, at the end: a
 * db_switchgear assembly is `ROUNDUP(sum x 0.495, tens)`. A per-SKU figure therefore cannot carry the
 * row's rounding -- the rounding does not belong to any one SKU. The recon measured what that costs: the
 * naive multiplier change on the switchgear discount is a flat +16.667%, while the real ROW-level figures
 * span **13.04% to 17.81% with 84 distinct values over 136 SKUs**, purely from that one roundup. Both
 * numbers are true of different things, so the panel shows the unrounded SKU rate per row AND the
 * measured rounded ROW range as the group summary (`rowRangeNote`). Never present one as the other.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIVE PANEL SHAPES (owner item 12, Q1-Q4 settled 2026-09-28)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *   pair                -> moves BoQ SUPPLY; BCS shown in the detail
 *   installation share  -> moves BoQ INSTALL; the supply leg is untouched
 *   installation markup -> moves BoQ INSTALL; the BCS install is untouched
 *   bcs only            -> moves BCS; "the BoQ rate is not impacted" (owner N-3)
 *   flat adder          -> rate-plus-adder, with the condition it applies under (owner N-5)
 *
 * The 35 inputs map by their stored RATE KEYS, never by name:
 *   discount+supply_markup (6) · +wastage (2, Q1) · supply_markup alone (4, Q2) · discount alone
 *   (2, Q4)  -> PAIR
 *   share (9) -> INSTALLATION SHARE · installation_markup (3) -> INSTALLATION MARKUP
 *   ratio (4) + bcs_markup (1) -> BCS ONLY · amount (3) + tray_cutting (1, Q3) -> FLAT ADDER
 */
import type { RateMasterItem } from "./rateMasterTypes";
import type { InputReach, AdderSpec } from "./pricingInputReach";
import { pipelinesOf } from "./pricingInputReach";
import { evalFormula } from "./ratePipelineInterpreter";
import {
  conditionsFor, isItemListConfig, itemsWithInput, legClassOf, neutralConditions, priceSkuExact,
  priceSkuExactItemList,
  type ExactLeg, type ExactPipelineRef,
} from "./pricingInputExact";

export type PanelShape = "pair" | "installation_share" | "installation_markup" | "bcs_only" | "flat_adder";

/** Which leg of the price this input moves -- the list's column header (owner item 10). */
export type MovedLeg = "boq_supply" | "boq_install" | "bcs";

export const LEG_LABEL: Record<MovedLeg, string> = {
  boq_supply: "SKU rate (BoQ supply)",
  boq_install: "SKU rate (BoQ install)",
  bcs: "SKU rate (BCS)",
};

/** What each shape does NOT move -- rendered verbatim, because a panel that only says what it changes
 * leaves the reader to guess the rest (owner item 12). */
export const NOT_MOVED_NOTE: Record<PanelShape, string> = {
  pair: "The BCS rate moves too — open a SKU to see both legs.",   // LIST view only
  installation_share: "The BoQ supply rate is not impacted.",
  installation_markup: "The BCS install rate is not impacted.",
  bcs_only: "The BoQ rate is not impacted.",
  flat_adder: "This is added to the row — no SKU's own rate is scaled.",
};

const PERCENT_KEYS = ["discount", "supply_markup", "installation_markup", "bcs_markup", "wastage", "ratio", "share"] as const;

/**
 * The shape of one input, from its stored RATE KEYS plus whether its reach is a flat adder.
 *
 * ⚠️ NEVER FROM THE INPUT'S NAME OR ID. `tray_cutting` carries `installation_markup` and would read as
 * an installation-markup panel, but it marks up a flat 200 and reaches ZERO SKUs -- an
 * installation-markup panel would open an empty list. Owner Q3 puts it with the flat adder, and the
 * discriminator is the REACH, which is measured, not the name.
 */
export function panelShapeOf(rates: Record<string, unknown> | null | undefined, reach: InputReach | null | undefined): PanelShape {
  const keys = new Set(Object.keys(rates ?? {}));
  if (reach?.isFlatAdder || keys.has("amount")) return "flat_adder";
  if (keys.has("share")) return "installation_share";
  if (keys.has("ratio") || keys.has("bcs_markup")) return "bcs_only";
  if (keys.has("installation_markup")) return "installation_markup";
  // discount and/or supply_markup, with or without a wastage (Q1) -- and either alone (Q2, Q4)
  return "pair";
}

export function movedLegOf(shape: PanelShape): MovedLeg {
  if (shape === "installation_share" || shape === "installation_markup") return "boq_install";
  if (shape === "bcs_only") return "bcs";
  return "boq_supply";
}

/**
 * The value fields a shape's panel offers, in the order it shows them. Only keys the input CARRIES.
 *
 * ⚠️ SLICE 12c: `rate` and `factor` are APPENDED, and the omission was not cosmetic -- it left an HVAC
 * input (whose only value IS a rate or a factor) with an EMPTY field list, so the panel rendered NO
 * edit box at all and could never be driven: every row sat at "—" under the hint "Change a value above
 * to see what it would do", with nothing to change. The owner spotted it on the live page.
 *
 * ⚠️ APPENDED RATHER THAN DERIVED FROM `PRICING_INPUT_VALUE_COLUMNS`, deliberately. This order is NOT
 * that constant's order -- `wastage` sits third here and fifth there -- so adopting it would reorder
 * the fields on Electrical's panel for no reason anyone asked for. Appending keeps every existing panel
 * byte-identical, exactly as appending the two COLUMNS did.
 */
export function editableFieldsOf(rates: Record<string, unknown> | null | undefined): string[] {
  const keys = Object.keys(rates ?? {});
  const order = ["discount", "supply_markup", "wastage", "installation_markup", "bcs_markup", "ratio",
                 "share", "amount", "rate", "factor"];
  return order.filter((k) => keys.includes(k));
}

/**
 * The multiplier a set of input values contributes to the leg it moves. PURE.
 *
 * ⚠️ THE DERIVED MULTIPLIERS ARE NEVER STORED (12b(A)'s rule, and the reason seven folds were unfolded):
 *     BoQ = (1 - discount) x (1 + markup)      BCS = (1 - discount) x (1 + wastage)
 * A missing operand contributes its identity -- an input with only a markup is `1 x (1 + markup)`, which
 * is Q2's markup-only shape, and one with only a discount is `(1 - discount)`, which is Q4's.
 *
 * Returns null where the shape has no per-SKU multiplier at all (a flat adder).
 */
export function multiplierFor(shape: PanelShape, vals: Record<string, number>, leg: MovedLeg): number | null {
  const num = (k: string) => (typeof vals[k] === "number" && Number.isFinite(vals[k]) ? vals[k] : undefined);
  if (shape === "flat_adder") return null;
  if (shape === "installation_share") return num("share") ?? null;
  if (shape === "installation_markup") return 1 + (num("installation_markup") ?? 0);
  if (shape === "bcs_only") {
    if (num("ratio") !== undefined) return num("ratio")!;
    return 1 + (num("bcs_markup") ?? 0);
  }
  // pair
  const d = num("discount") ?? 0;
  if (leg === "bcs") return (1 - d) * (1 + (num("wastage") ?? 0));
  return (1 - d) * (1 + (num("supply_markup") ?? 0));
}

export interface SkuImpactRow {
  itemUid: string;
  kind: string;
  rateKey: string;
  /** what the row is called on screen */
  label: string;
  categories: string[];
  /** the SKU's own stored rate -- the number the multiplier is applied to */
  storedRate: number;
  /** stored x the multiplier, UNROUNDED (owner N-1) */
  now: number;
  becomes: number;
  /** null when `now` is 0, so the panel shows a dash rather than a fabricated infinity */
  pctChange: number | null;
  moved: boolean;
  /**
   * ⚠️ EVERY OTHER PIPELINE OUTPUT THIS INPUT MOVES. A conduit DISCOUNT moves the INSTALL rate too,
   * because install is a share OF supply; the panel used to name only its own leg, so a pricer met a
   * rate that had moved without being mentioned (owner ruling, gap (c)). Empty on the approximate path.
   */
  otherLegs?: ExactLeg[];
  /** true when this row's figures came from the product's own pipeline rather than the multiplier */
  exact?: boolean;
}

export interface ImpactResult {
  shape: PanelShape;
  leg: MovedLeg;
  legLabel: string;
  notMovedNote: string;
  /** every reached SKU, in `byCategory` groups; a SKU in two categories appears ONCE (owner N-2) */
  rows: SkuImpactRow[];
  rowsByCategory: Record<string, SkuImpactRow[]>;
  /** true once any edited value differs from the stored one -- gates Save (owner item 10) */
  changed: boolean;
  multiplierNow: number | null;
  multiplierNext: number | null;
  /** a flat adder only: what it adds now and after the edit, and the condition it applies under */
  adderNow: number | null;
  adderNext: number | null;
  adderWhen: Record<string, unknown> | null;
}

/**
 * Price every reached SKU before and after. PURE.
 *
 * ⚠️ ONE ROW PER DISTINCT SKU (owner N-2), even where several categories reach it -- the categories ride
 * on the row. A SKU reached on TWO rate columns (a `termination` row is moved by `gland` on its band
 * columns and by `lug` on `lug_list`) yields one row PER COLUMN, because those are different numbers;
 * `distinctSkus` stays the badge.
 */

/** the column key the base-multiplier map is keyed by */
/**
 * Every pricing input's value under the ctx key a `rate_ref` publishes it as (`pi_<item>_<rate key>`),
 * with one input's values optionally overridden -- which is how the panel prices the SAME adder before
 * and after an edit without the caller having to know the key shape.
 */
export function ctxValuesOf(
  inputs: ReadonlyArray<{ attributes?: Record<string, unknown> | null; rates?: Record<string, unknown> | null }>,
  override?: { item: string; rates: Record<string, number> } | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of inputs) {
    const item = String((it.attributes ?? {}).item ?? "");
    if (!item) continue;
    const src = override && override.item === item
      ? { ...(it.rates ?? {}), ...override.rates }
      : (it.rates ?? {});
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "number" && Number.isFinite(v)) out[`pi_${item}_${k}`] = v;
    }
  }
  return out;
}

export function impactColKey(itemUid: string, rateKey: string): string {
  return `${itemUid}\u0000${rateKey}`;
}

/**
 * What an ADDITIVE component adds, under the branch that actually applies.
 *
 * ⚠️ THE ENABLING BRANCH IS THE ONE THAT ADDS SOMETHING, never a branch picked by name. The cutting
 * component binds its markup from ctx in BOTH branches and its rate in only one, so counting binds or
 * matching on "Yes" would each be a guess; taking the branch with the largest addend is the meaning.
 * The formula is evaluated by the interpreter's own `evalFormula` -- there is no second evaluator.
 */
export function adderValue(
  spec: AdderSpec | null | undefined,
  ctx: Record<string, number>,
): { value: number; when: Record<string, unknown> } | null {
  if (!spec || !spec.formula) return null;
  let best: { value: number; when: Record<string, unknown> } | null = null;
  for (const b of spec.branches ?? []) {
    const env: Record<string, number> = { ...b.literals };
    for (const [name, key] of Object.entries(b.ctxBinds)) {
      const v = ctx[String(key)];
      if (typeof v === "number" && Number.isFinite(v)) env[name] = v;
    }
    let v: number;
    try { v = evalFormula(spec.formula, env); } catch { continue; }
    if (!Number.isFinite(v)) continue;
    if (!best || v > best.value) best = { value: v, when: { ...b.when } };
  }
  return best;
}

/**
 * The multiplier the OTHER inputs apply to each column an adder lands on, so the adder's panel can
 * show a SKU's real per-unit rate rather than its bare stored rate.
 *
 * ⚠️ ADDITIVE INPUTS ARE EXCLUDED FROM THE PRODUCT. An adder does not scale the column it lands on,
 * and the markup on an adder scales the ADDER, not the tray -- folding either in would inflate every
 * base on the install pipeline by 45%.
 */
export function baseMultiplierByColumn(
  target: InputReach | null | undefined,
  others: ReadonlyArray<{ rates: Record<string, unknown> | null | undefined; reach: InputReach | null | undefined }>,
): Map<string, number> {
  const out = new Map<string, number>();
  const wanted = new Set((target?.columns ?? []).map((c) => impactColKey(c.itemUid, c.rateKey)));
  for (const k of wanted) out.set(k, 1);
  for (const o of others) {
    if (!o.reach || o.reach.isFlatAdder) continue;
    const shape = panelShapeOf(o.rates, o.reach);
    if (shape === "flat_adder") continue;
    const vals: Record<string, number> = {};
    for (const [k, v] of Object.entries(o.rates ?? {})) {
      if (typeof v === "number" && Number.isFinite(v)) vals[k] = v;
    }
    const m = multiplierFor(shape, vals, movedLegOf(shape));
    if (m === null || !Number.isFinite(m)) continue;
    for (const c of o.reach.columns ?? []) {
      const k = impactColKey(c.itemUid, c.rateKey);
      if (!wanted.has(k)) continue;
      out.set(k, (out.get(k) ?? 1) * m);
    }
  }
  return out;
}

/**
 * What the EXACT path needs: the configs to find the pipelines, the catalogue to price against, and
 * the input's own key so the "after" catalogue can be built. Absent => the approximate multiplier path,
 * which is what every unit test that predates this uses.
 */
export interface ExactContext {
  configs: Record<string, { pipelines?: Record<string, unknown> } | undefined>;
  items: readonly RateMasterItem[];
  /** the pricing input's `attributes.item` key */
  inputItemKey: string;
  /** extra branch conditions to price under, on top of the input's own enabling branch */
  conditions?: Record<string, unknown>;
}

/** what a flat-adder panel needs beyond the input's own values */
export interface AdderContext {
  /** every pricing input's ctx key -> its value AS STORED */
  ctxNow: Record<string, number>;
  /** the same, with THIS input's edited values substituted */
  ctxNext: Record<string, number>;
  /** colKey -> the product of the multipliers the other inputs apply there */
  baseMultiplier: Map<string, number>;
}

export function computeImpact(
  rates: Record<string, unknown> | null | undefined,
  edited: Record<string, number> | null | undefined,
  reach: InputReach | null | undefined,
  itemsByUid: Map<string, RateMasterItem> | null | undefined,
  adderCtx?: AdderContext | null,
  exactCtx?: ExactContext | null,
): ImpactResult {
  const shape = panelShapeOf(rates, reach);
  const leg = movedLegOf(shape);
  const stored: Record<string, number> = {};
  for (const [k, v] of Object.entries(rates ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) stored[k] = v;
  }
  const next: Record<string, number> = { ...stored, ...(edited ?? {}) };
  const changed = Object.keys(stored).some((k) => next[k] !== stored[k])
    || Object.keys(edited ?? {}).some((k) => (edited ?? {})[k] !== stored[k]);

  const mNow = multiplierFor(shape, stored, leg);
  const mNext = multiplierFor(shape, next, leg);

  /**
   * ⚠️ A FLAT ADDER MOVES A PRICE WITHOUT SCALING A RATE, so its rows are `rate + adder`, never
   * `rate x multiplier`. The base is the SKU's own rate as the other inputs leave it, which is what
   * makes the % column show the REAL spread -- a flat amount hits a small tray far harder than a
   * large one, and a panel that divided by the bare stored rate would report one flat percentage
   * for all 450 and hide exactly that.
   */
  const addNow = shape === "flat_adder" ? adderValue(reach?.adder, adderCtx?.ctxNow ?? {}) : null;
  const addNext = shape === "flat_adder" ? adderValue(reach?.adder, adderCtx?.ctxNext ?? {}) : null;

  /**
   * The exact figures, computed ONCE for every reached SKU. ~0.18 ms per pipeline run, so a 450-SKU
   * before-and-after is ~166 ms -- the caller memoises this on the edited values.
   */
  const legWanted: "bcs" | "install" | "supply" =
    leg === "bcs" ? "bcs" : leg === "boq_install" ? "install" : "supply";
  const exactRows = (() => {
    if (!exactCtx || !changed) return null;
    const refs: ExactPipelineRef[] = [];
    for (const { category, pipelineId } of reach?.pipelines ?? []) {
      // ⚠️ THROUGH `pipelinesOf`, NOT `cfg.pipelines`. An ITEM-LIST category's pipelines live inside
      // `list_spec`, and the reach walk now reports them under a `family/unit/id` key -- resolving
      // against `cfg.pipelines` alone would find NOTHING for every one of them, so the panel would
      // fall back to its approximate arithmetic on the whole category. ONE resolver, shared with the
      // walk that produced the ids, so the two can never disagree about what a pipeline id means.
      const pl = pipelinesOf(exactCtx.configs?.[category]).find(([pid]) => pid === pipelineId)?.[1];
      if (pl) refs.push({ category, pipelineId, pipeline: pl as never });
    }
    if (!refs.length) return null;
    const patch: Record<string, number> = {};
    for (const k of Object.keys(next)) if (next[k] !== stored[k]) patch[k] = next[k];
    if (!Object.keys(patch).length) return null;
    const itemsNext = itemsWithInput(exactCtx.items, exactCtx.inputItemKey, patch);
    /**
     * ⚠️ THE OWN CONDITION WINS, and every OTHER conditional component is held at its neutral branch.
     * Order matters: neutral first, then the input's own enabling branch on top, so an adder whose
     * component also appears among the neutrals is still switched ON.
     */
    const conds = {
      ...neutralConditions(refs, reach?.adder?.component),
      ...conditionsFor(reach),
      ...(exactCtx.conditions ?? {}),
    };
    const out = new Map<string, ReturnType<typeof priceSkuExact>>();
    for (const c of reach?.columns ?? []) {
      if (out.has(c.itemUid)) continue;
      const sku = itemsByUid?.get(c.itemUid);
      if (!sku) continue;
      /**
       * ACCEPTANCE 23 -- ONE PRICING PATH. An ITEM-LIST category prices a row through
       * `priceItemList`, so its SKUs are priced through `priceItemList` here too. Running one of its
       * `list_spec` pipelines directly would re-implement the family / unit / ladder / default /
       * per-row-condition resolution that function performs -- and would get Insulation's cladding
       * wrong in a plausible way, pricing every row as though it carried the input's own cladding.
       *
       * ⚠️ `conds` IS DELIBERATELY NOT PASSED on this path. There is nothing to assume: the branch
       * each SKU takes is decided by that SKU's own attributes, which is exactly what makes the moved
       * COUNT fall out of the product rather than out of a guess.
       */
      const cfgOf = exactCtx.configs?.[(c.categories ?? [])[0] ?? ""];
      out.set(c.itemUid, isItemListConfig(cfgOf)
        ? priceSkuExactItemList(sku, cfgOf, exactCtx.items, itemsNext)
        : priceSkuExact(sku, refs, exactCtx.items, itemsNext, conds));
    }
    return out;
  })();

  const rows: SkuImpactRow[] = [];
  const seen = new Set<string>();
  // OWNER 2026-10-03: labels are resolved against EACH OTHER, so a name several rows share is
  // followed by the facts that tell them apart. Built ONCE per computation, not per row.
  const labelCtx = skuLabelContext(itemsByUid?.values() ?? []);
  for (const col of reach?.columns ?? []) {
    const key = `${col.itemUid}\u0000${col.rateKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const it = itemsByUid?.get(col.itemUid);
    if (!it) continue;
    const rate = (it.rates ?? {})[col.rateKey];
    if (typeof rate !== "number" || !Number.isFinite(rate)) continue;
    let now: number;
    let becomes: number;
    /**
     * ⚠️ THE EXACT PATH RUNS THE PRODUCT'S OWN PIPELINE (owner ruling, 2026-09-29). The multiplier
     * arithmetic below agrees with the product only for the PAIR shape; for a share it used the wrong
     * base and skipped a roundup, and for an adder it applied the multiplier in the wrong order. Rather
     * than re-derive those rules here -- which is how the disagreement arose in the first place -- the
     * figures come from `runPipeline` over the catalogue as it stands and over the catalogue with this
     * input patched. The multiplier path below REMAINS as the fallback for callers with no configs.
     */
    const ex = exactRows?.get(col.itemUid);
    if (ex && ex.legs.length) {
      const primary = ex.legs.find((l) => legClassOf(l.output) === legWanted) ?? ex.legs[0];
      rows.push({
        itemUid: col.itemUid, kind: col.kind, rateKey: col.rateKey,
        label: skuLabel(it, labelCtx), categories: col.categories, storedRate: rate,
        now: primary.now, becomes: primary.becomes,
        pctChange: primary.now === 0 ? null : ((primary.becomes - primary.now) / primary.now) * 100,
        moved: primary.moved,
        otherLegs: ex.legs.filter((l) => l !== primary && l.moved),
        exact: true,
      });
      continue;
    }
    if (shape === "flat_adder") {
      const base = rate * (adderCtx?.baseMultiplier.get(impactColKey(col.itemUid, col.rateKey)) ?? 1);
      now = base + (addNow?.value ?? 0);
      becomes = base + (addNext?.value ?? 0);
    } else {
      now = mNow === null ? rate : rate * mNow;
      becomes = mNext === null ? rate : rate * mNext;
    }
    const moved = Math.abs(becomes - now) > 1e-9;
    rows.push({
      itemUid: col.itemUid,
      kind: col.kind,
      rateKey: col.rateKey,
      label: skuLabel(it, labelCtx),
      categories: col.categories,
      storedRate: rate,
      now,
      becomes,
      pctChange: now === 0 ? null : ((becomes - now) / now) * 100,
      moved,
    });
  }
  /**
   * ⚠️ A FLAT ADDER IS ONE ROW PER SKU, NOT ONE PER COLUMN. A multiplier legitimately applies to
   * every column it reaches -- a tray's body and its cover are separately priced, so `tray_supply`
   * marks up both and shows both. An ADDEND is added ONCE to the `sum_components` below it, so the
   * same 450 trays rendered twice would show "+106" twice and read as double the money. The column
   * kept is the DEAREST reached, which is the body rather than the cover strip.
   */
  if (shape === "flat_adder") {
    const best = new Map<string, SkuImpactRow>();
    for (const r of rows) {
      const prev = best.get(r.itemUid);
      if (!prev || r.storedRate > prev.storedRate) best.set(r.itemUid, r);
    }
    // ⚠️ `kept` must be a NEW array before `rows` is cleared -- aliasing it emptied every non-adder
    const kept = Array.from(best.values());
    rows.length = 0;
    rows.push(...kept);
  }
  rows.sort((a, b) => a.label.localeCompare(b.label) || a.rateKey.localeCompare(b.rateKey));

  const byCat: Record<string, SkuImpactRow[]> = {};
  for (const r of rows) {
    for (const cat of r.categories.length ? r.categories : ["—"]) (byCat[cat] ??= []).push(r);
  }
  return {
    shape, leg, legLabel: LEG_LABEL[leg], notMovedNote: NOT_MOVED_NOTE[shape],
    rows, rowsByCategory: byCat, changed, multiplierNow: mNow, multiplierNext: mNext,
    adderNow: addNow?.value ?? null,
    adderNext: addNext?.value ?? null,
    adderWhen: (addNext ?? addNow)?.when ?? null,
  };
}

/**
 * The calculation blocks one SKU's working shows (owner item 11: "a verdict naming BOTH legs").
 *
 * ⚠️ A PAIR MOVES TWO LEGS AND THE DETAIL MUST SHOW BOTH. The list can say "the BCS moves too — open a
 * SKU"; inside the SKU that sentence is an instruction to do what you have already done, and it leaves
 * the second leg unshown. Caught in the browser cert, not by a test -- the pure module had no notion of
 * a "detail view", so nothing could have failed.
 *
 * Returns the moved leg first, then the other one where the shape has a second, each with the words of
 * its formula and its own before/after.
 */
export interface WorkingLeg {
  title: string;
  formula: string;
  now: number;
  becomes: number;
  /** false for a leg this input does NOT move -- shown so the reader can see it standing still */
  moves: boolean;
  /**
   * ⚠️ THE FIELDS THIS LEG ACTUALLY USES, and it must be per leg, not per input. The BCS leg is
   * `(1 - discount) x (1 + wastage)` -- it does NOT use the supply markup. Listing every field under
   * every leg put "65% Supply markup" inside the BCS working, which tells the reader the markup feeds
   * a figure it has no part in. Caught on screen during the cert.
   */
  uses: string[];
}

/**
 * The condition an adder applies under, in words. It is stated because the figures ARE that case:
 * a ceiling run carries the accessories set and a floor run does not, so a panel that showed the
 * numbers without the condition would be quoting one install type's price for both.
 */
export function adderConditionText(when: Record<string, unknown> | null | undefined): string {
  const parts = Object.entries(when ?? {}).map(([k, v]) => `${k.replace(/_/g, " ")} is ${String(v)}`);
  if (!parts.length) return "";
  return `These figures are the case where ${parts.join(" and ")}. Rows without it are unaffected.`;
}

export function workingLegs(
  shape: PanelShape,
  storedRate: number,
  vals: Record<string, number>,
  next: Record<string, number>,
  /** a FLAT ADDER only: the SKU's rate as the other inputs leave it, and what this adds before/after */
  flat?: { base: number; adderNow: number; adderNext: number } | null,
): WorkingLeg[] {
  const leg = movedLegOf(shape);
  const at = (v: Record<string, number>, l: MovedLeg) => {
    const m = multiplierFor(shape, v, l);
    return m === null ? storedRate : storedRate * m;
  };
  const usesFor = (l: MovedLeg): string[] => {
    if (shape === "installation_share") return ["share"];
    if (shape === "installation_markup") return ["installation_markup"];
    if (shape === "bcs_only") return ("ratio" in vals) ? ["ratio"] : ["bcs_markup"];
    return l === "bcs"
      ? ["discount", "wastage"].filter((k) => k in vals)
      : ["discount", "supply_markup"].filter((k) => k in vals);
  };
  if (shape === "flat_adder") {
    const base = flat?.base ?? storedRate;
    return [{
      title: LEG_LABEL[leg],
      formula: "= this SKU's rate + the amount added per unit",
      now: base + (flat?.adderNow ?? 0),
      becomes: base + (flat?.adderNext ?? 0),
      moves: Math.abs((flat?.adderNext ?? 0) - (flat?.adderNow ?? 0)) > 1e-9,
      uses: ("amount" in vals) ? ["amount"] : ["installation_markup"],
    }];
  }
  const primary: WorkingLeg = {
    title: LEG_LABEL[leg],
    formula:
      shape === "installation_share" ? "= this SKU's rate × the installation share"
      : shape === "installation_markup" ? "= this SKU's stored install rate × (1 + the installation markup)"
      : shape === "bcs_only" ? "= this SKU's rate × the BCS ratio"
      : "= this SKU's list price × (1 − discount) × (1 + markup)",
    now: at(vals, leg), becomes: at(next, leg), moves: true, uses: usesFor(leg),
  };
  if (shape !== "pair") return [primary];
  // the pair's SECOND leg: BCS = (1 - discount) x (1 + wastage). It moves whenever the discount does,
  // and a wastage-carrying input moves it on its own -- which is Q1's whole point.
  return [primary, {
    title: LEG_LABEL.bcs,
    formula: "= this SKU's list price × (1 − discount)"
      + (("wastage" in vals) ? " × (1 + wastage)" : ""),
    now: at(vals, "bcs"), becomes: at(next, "bcs"),
    moves: Math.abs(at(next, "bcs") - at(vals, "bcs")) > 1e-9,
    uses: usesFor("bcs"),
  }];
}

/** A catalogue row's human name: its `item` attribute where it has one, else the most telling
 * attributes it does have. Never the uid, which means nothing to a pricer. */
/**
 * A SKU's identity inside one input's impact. The panel keys its open detail on THIS, never on the
 * row object -- a captured row freezes its figures while the values around it keep moving.
 * NUL-joined so no kind or rate key can forge another pair's key.
 */
export function skuKey(row: Pick<SkuImpactRow, "itemUid" | "kind" | "rateKey">): string {
  return `${row.itemUid}\u0000${row.kind}\u0000${row.rateKey}`;
}

const _LABEL_SKIP_ATTRS = new Set(["spec_status", "spec_note"]);

/** PURE. The row's own name, or null -- the first of `item` / `item_name` / `name` that says anything. */
export function skuName(it: RateMasterItem | null | undefined): string | null {
  const a = (it?.attributes ?? {}) as Record<string, unknown>;
  for (const k of ["item", "item_name", "name"]) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * ⚠️ WHY A NAME IS NOT ALWAYS A LABEL (owner, 2026-10-03: "the SKU shows only item and not
 * description. it is not possible to find which SKU is which").
 *
 * `skuLabel` used to return the row's name and stop. That is right where a name identifies one row,
 * and useless where it does not: on HVAC Insulation the name is the FAMILY, so 168 rows all read
 * "Nitrile Rubber Insulation" and the impact list was 168 identical lines. Measured on the live
 * catalogue the same defect sits on Electrical -- 142 rows share a name, eleven of them reading
 * "Industrial Socket with MCB".
 *
 * So this returns, per shared name, the attribute keys whose values actually DIFFER between the rows
 * sharing it -- the facts that tell them apart, and only those. A name no other row carries is absent
 * from the map, so its label stays the name alone, byte-identical to before. PURE.
 */
export function skuLabelContext(
  items: Iterable<RateMasterItem | null | undefined>,
): Map<string, string[]> {
  const byName = new Map<string, Array<Record<string, unknown>>>();
  for (const it of items) {
    const n = skuName(it);
    if (!n) continue;
    const list = byName.get(n) ?? [];
    list.push((it?.attributes ?? {}) as Record<string, unknown>);
    byName.set(n, list);
  }
  const out = new Map<string, string[]>();
  byName.forEach((rowsWithName, name) => {
    if (rowsWithName.length < 2) return;             // the name identifies the row on its own
    const keys = new Set<string>();
    for (const r of rowsWithName) for (const k of Object.keys(r)) keys.add(k);
    const varying = [...keys].filter((k) => {
      if (_LABEL_SKIP_ATTRS.has(k)) return false;
      const first = JSON.stringify(rowsWithName[0]?.[k] ?? null);
      return rowsWithName.some((r) => JSON.stringify(r[k] ?? null) !== first);
    }).sort();
    if (varying.length) out.set(name, varying);
  });
  return out;
}

/** How many distinguishing facts a label carries before it stops -- enough to tell the rows apart,
 * short enough to read in a table cell (the full text is always in the row's `title`). */
const _LABEL_MAX_PARTS = 5;

export function skuLabel(
  it: RateMasterItem | null | undefined,
  ctx?: ReadonlyMap<string, string[]>,
): string {
  const a = (it?.attributes ?? {}) as Record<string, unknown>;
  const named = skuName(it);
  if (named) {
    const parts = (ctx?.get(named) ?? [])
      .map((k) => [k, a[k]] as const)
      .filter(([, v]) => v !== null && v !== "" && v !== undefined)
      .slice(0, _LABEL_MAX_PARTS)
      .map(([k, v]) => `${k} ${String(v)}`);
    return parts.length ? `${named} · ${parts.join(" · ")}` : named;
  }
  const parts = Object.entries(a)
    .filter(([k, v]) => !_LABEL_SKIP_ATTRS.has(k) && v !== null && v !== "" && v !== undefined)
    .slice(0, 4)
    .map(([, v]) => String(v));
  return parts.join(" · ") || String(it?.item_uid ?? "");
}

/** `0.45` -> `45%`. Display only; the stored value is untouched. Mirrors `rateMasterSpec.asPercent`. */
export function pctText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  const f = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(f)) return String(v);
  return `${Math.round(f * 100 * 1e6) / 1e6}%`;
}

/** Is this value field a percentage, or a rupee amount? Mirrors the exporter's split. */
export function isPercentField(key: string): boolean {
  return (PERCENT_KEYS as readonly string[]).includes(key);
}
