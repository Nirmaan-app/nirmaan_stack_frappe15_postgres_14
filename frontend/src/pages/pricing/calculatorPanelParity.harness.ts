/**
 * SLICE 12c-P (2026-10-06) -- THE CALCULATOR = RATE-HELPER-PANEL PARITY DRIVER.
 *
 * Owner (standing, P1): "both calculator and proicing helper giove same price for same inpiuts. they
 * must always do so. any case of divergence is failure."
 *
 * ⚠️ THIS FILE DRIVES THE TWO REAL PATHS. IT NEVER COMPARES ONE PATH WITH ITSELF.
 *
 *   PANEL path      -- `makePricingSheetHelper({ ..., extractionByRow })` over a map that HOLDS the
 *                      row, then `compute(ctx)` with NO overrides. Inside `compute` this takes the
 *                      `ext` branch: the never-asked-default pass runs, `cellOf` reads the stored
 *                      cells, `defaulted` marks come off the extraction, and (item-list) the model's
 *                      `ext.items` become the blocks. This is the branch `SheetPricingPage` reaches.
 *   CALCULATOR path -- `makePricingSheetHelper({ ..., extractionByRow: new Map() })`, the
 *                      construction `PricingCalculator` performs verbatim (SLICE 12d-2 retired the
 *                      FA7 `admitCalculatorOnly` dep it used to add), then
 *                      `compute(calculatorCtx(discipline, categoryId), overrides)`. `ext` is
 *                      undefined, so NONE of the above runs; every value arrives through the
 *                      override map the panel's controls write.
 *
 * The two branches of `compute` are therefore genuinely different code, and the wiring between them
 * is exactly what slice 12c found broken (a family written to one key and read from another). The
 * driver's job is to put the SAME final answers into both and compare what comes out.
 *
 * ⚠️ WHAT "THE SAME INPUTS" MEANS, AND WHY IT IS NOT SIMPLY THE STORED ROW. The calculator has no
 * row: it has the CONTROLS the panel renders. So the feed is built from what the panel SHOWS, exactly
 * as a pricer re-typing every field would produce it -- `WorkingsAttribute.value` for a row-level
 * attribute (the coerced value the control is bound to), and for an item-list block the family it
 * priced plus each rendered field's `typedValue` (what was ENTERED, never `value`, which is the
 * RESOLVED size -- the two answer different questions, FA8(b)). A `readOnly` or `disabled` control
 * cannot be typed, so it is omitted and the calculator's own pipeline derives it, as the panel's did.
 *
 * ⚠️ A `panel: false` ATTRIBUTE IS A FACT WITH NO CONTROL. The extraction can supply one; a pricer
 * cannot. So the driver builds the feed in two declared modes -- `visible` (controls only) and `full`
 * (controls plus the panel-hidden facts, which `compute` reads from the override map for every def
 * regardless of `panel`) -- and reports which rows needed the supplement. `full` is the arithmetic
 * question; `visible` is the screen question, and its gap is a field surface, not a price.
 *
 * NOTHING HERE IS PRODUCT CODE. It is imported only by `calculatorPanelParity.test.ts`; the name ends
 * `.harness.ts` so `vitest.config.ts`'s `src/**\/*.test.{ts,tsx}` include never collects it.
 */
import { readFileSync } from "node:fs";
import { RATE_MASTER_DISCIPLINES } from "./rate-master/rateMasterRegistry";
import type { AttributeDefinition, RateCategoryConfig, RateMasterItem } from "./rate-master/rateMasterTypes";
import { calculatorCtx } from "./PricingCalculator";
import {
  ITEM_LIST_OVERRIDE_KEY,
  ROW_UNIT_OVERRIDE_KEY,
  makePricingSheetHelper,
  type ItemListSuggestion,
  type ItemListView,
  type RowContextWithUnit,
} from "@/pages/boq-wizard/rate-helper/pricingSheetHelper";
import {
  familyAttr,
  familyUnitClasses,
  fieldOptionsFromSkus,
  itemFieldDefs,
  itemListPricingSpec,
  listSpecDefs,
  unitClassOf,
  unitFactorOf,
} from "@/pages/boq-wizard/rate-helper/itemListPricing";
import {
  DISPLAY_RATE_KINDS,
  isSuggestion,
  type ExtractionRow,
  type HelperResult,
  type RateHelper,
  type RateKind,
} from "@/pages/boq-wizard/rate-helper/rateHelperTypes";

/** The row the panel path presents. Any number; the two helpers are separate instances. */
export const PANEL_ROW = 101;

/** The discipline a registry category belongs to -- read from the REGISTRY, never written here. */
export function disciplineOf(categoryId: string): string | null {
  for (const d of RATE_MASTER_DISCIPLINES) {
    if (d.categories.some((c) => c.category_id === categoryId)) return d.discipline;
  }
  return null;
}

/** One row as the two paths must agree on it. `attrs` / `items` hold VALUES, keyed as the extraction
 * stores them; a key PRESENT with a null value is deliberately distinct from an ABSENT key (the
 * never-asked-default rule reads `hasOwnProperty`), so the fixture keeps both. */
export interface ParityCase {
  cat: string;
  unit: string;
  desc: string;
  attrs: Record<string, string | number | null>;
  items?: Array<Record<string, string | number | null>>;
  /** SLICE 12d-1a (owner R2): the row's section headings, root-first, as the PANEL's row context
   * carries them. OPTIONAL -- every existing case omits it and its context is byte-identical. */
  headings?: string[];
}

type Cells = ExtractionRow["attributes"];

function toCells(attrs: Record<string, string | number | null>): Cells {
  const out: Cells = {};
  for (const [k, v] of Object.entries(attrs)) out[k] = { value: v, confidence: 1 };
  return out;
}

/** The stored extraction row the PANEL path reads -- the shape `buildExtractionByRow` produces. */
export function extractionRowFor(c: ParityCase): ExtractionRow {
  const row = {
    excelRow: PANEL_ROW,
    description: c.desc,
    attributes: toCells(c.attrs),
  } as ExtractionRow & { items?: Array<{ attributes: Cells }> };
  if (c.items) row.items = c.items.map((a) => ({ attributes: toCells(a) }));
  return row;
}

/**
 * The PANEL helper -- what `SheetPricingPage` builds, with ONE stored extraction row. SLICE 12d-2
 * retired the FA7 `admitCalculatorOnly` flag this used to take: an item-list category (HVAC
 * Insulation) is eligible through the one generic predicate on every surface, so the panel's `ext`
 * branch is exercised for it exactly as for every BoQ-reachable category.
 */
export function panelHelper(
  configsByCategory: Map<string, RateCategoryConfig>,
  items: RateMasterItem[],
  c: ParityCase,
): RateHelper {
  return makePricingSheetHelper({
    configsByCategory,
    items,
    extractionByRow: new Map([[PANEL_ROW, extractionRowFor(c)]]),
  });
}

/** The CALCULATOR helper -- `PricingCalculator`'s construction, verbatim (an EMPTY extraction map). */
export function calculatorHelper(
  configsByCategory: Map<string, RateCategoryConfig>,
  items: RateMasterItem[],
): RateHelper {
  return makePricingSheetHelper({
    configsByCategory,
    items,
    extractionByRow: new Map(),
  });
}

/** The PANEL's row context -- what `SheetPricingPage.helperPanelCtx` builds (the row's unit rides it). */
export function panelCtx(c: ParityCase): RowContextWithUnit {
  return {
    excelRow: PANEL_ROW,
    description: c.desc,
    nodeType: "Line Item",
    category: c.cat,
    discipline: disciplineOf(c.cat),
    rateKinds: [...DISPLAY_RATE_KINDS],
    unit: c.unit,
    ...(c.headings ? { headings: c.headings } : {}),
  };
}

export type FeedMode = "visible" | "full";

/**
 * How the row's UNIT reached the calculator. The calculator's picker offers ONE SPELLING PER UNIT
 * CLASS (`unitChoicesOf`), while a BoQ row carries whatever the sheet wrote -- so a spelling the
 * picker does not list has to be mapped onto the class's offered spelling, and some units cannot be
 * expressed on that screen at all. Each state is counted and reported rather than smoothed away.
 */
export type UnitFeed =
  /** the row's own unit IS one the picker offers -- nothing mapped */
  | "exact"
  /** a different spelling of the SAME class (Nos -> nos): the same class prices the same way */
  | "spelling mapped to the class"
  /** the unit carries a `unit_factors` conversion (sq.ft -> sq.m x 0.0929) that the picker cannot offer */
  | "conversion unit the picker cannot offer"
  /** the row carries no unit at all */
  | "row has no unit"
  /** the unit belongs to no declared class */
  | "unit belongs to no declared class";

export interface Feed {
  overrides: Record<string, string>;
  /** Panel-hidden (`panel: false`) facts the row carried: present only in `full` mode's overrides. */
  hiddenFacts: string[];
  /** Item-list rows only: how the unit was expressed on the calculator. */
  unitFeed?: UnitFeed;
}

function defsOf(config: RateCategoryConfig | null | undefined): AttributeDefinition[] {
  return (config?.attribute_definitions ?? []) as AttributeDefinition[];
}

/**
 * THE UNIT, AS THE CALCULATOR'S PICKER CAN EXPRESS IT. The picker lists one spelling per class, so a
 * sheet's own spelling ("Nos", "Sqmtrs") must be mapped onto the class's listed spelling before the
 * two paths are comparable -- the CLASS is what prices, and `unitClassOf` is the product's own
 * resolver, read here rather than re-implemented. A `unit_factors` unit is a different matter: it
 * belongs to a class AND scales the rate, and the picker offers no such option, so it is reported
 * rather than mapped (mapping it would silently drop the conversion and call the result parity).
 */
function unitForCalculator(
  config: RateCategoryConfig | null,
  view: ItemListView,
): { unit: string; unitFeed: UnitFeed } {
  const spec = itemListPricingSpec(config);
  if (!spec) return { unit: view.unit, unitFeed: "exact" };
  if (view.unit.trim() === "") return { unit: view.unit, unitFeed: "row has no unit" };
  if (view.unitChoices.includes(view.unit)) return { unit: view.unit, unitFeed: "exact" };
  const factor = unitFactorOf(spec, view.unit);
  if (factor) {
    /**
     * SLICE 12c-F, FIX C: the picker now OFFERS a convertible unit, by its first declared spelling. A
     * BoQ writes "Sqft" where the picker lists "sqft", so the row's spelling is mapped onto the offered
     * one exactly as a class spelling is -- same conversion, same factor, same class.
     */
    const offered = view.unitChoices.find((ch) => {
      const f2 = unitFactorOf(spec, ch);
      return !!f2 && f2.class === factor.class && f2.factor === factor.factor;
    });
    if (offered !== undefined) return { unit: offered, unitFeed: "spelling mapped to the class" };
    return { unit: view.unit, unitFeed: "conversion unit the picker cannot offer" };
  }
  const cls = unitClassOf(spec, view.unit);
  const offered = cls ? view.unitChoices.find((ch) => unitClassOf(spec, ch) === cls) : undefined;
  if (offered !== undefined) return { unit: offered, unitFeed: "spelling mapped to the class" };
  return { unit: view.unit, unitFeed: "unit belongs to no declared class" };
}

/**
 * THE FEED: the calculator overrides that say "the same final answers as the panel is showing".
 *
 * Row-level categories: one entry per EDITABLE control, carrying `WorkingsAttribute.value` -- the
 * coerced value the control is bound to, so `String(25)` and `25` land on the same number through
 * `coerceForMatch` on both sides. An empty value is omitted (an override of "" and an absent key both
 * coerce to null on a path with no stored cell, so the two are indistinguishable there).
 *
 * Item-list categories: the ONE `__items__` key, an `ItemListEditState` with one entry per block --
 * `base: null` (the calculator has no model items, so `decodeItemEdits` would null it anyway), the
 * block's PRICING family, each rendered field's `typedValue`, the "Other..." set, and the quantity the
 * block shows. Plus `__row_unit__`, because the unit IS an input and the calculator picks it.
 */
export function feedFromPanel(
  panel: HelperResult,
  config: RateCategoryConfig | null,
  c: ParityCase,
  mode: FeedMode,
): Feed {
  const overrides: Record<string, string> = {};
  const hiddenFacts: string[] = [];
  if (!isSuggestion(panel)) return { overrides, hiddenFacts };

  const view = (panel as ItemListSuggestion).itemList;
  if (view) {
    const spec = itemListPricingSpec(config);
    /** The two per-item answers that have a CONTROL OF THEIR OWN, not a field in `attrs`: the family
     *  (the "Change item" picker, carried as `ItemEdit.family`) and the per-item quantity (the qty box,
     *  carried as `ItemEdit.qty`). Feeding either as an attribute writes a key nothing reads. */
    const ownControl = new Set<string>(
      [spec ? familyAttr(spec) : "family", spec?.qty_attribute_id].filter((x): x is string => !!x),
    );
    const edits = view.items.map((b, i) => {
      const attrs: Record<string, string> = {};
      const other: string[] = [];
      const rendered = new Set<string>();
      for (const f of b.fields) {
        rendered.add(f.id);
        /**
         * ⚠️ THE CONTROL'S OWN BINDING, read off `RateHelperPanel`: a select (and a plain text box) is
         * bound to `f.value` -- the RESOLVED value, which is what the pricer sees and would pick -- and
         * only the "Other..." box is bound to `f.typedValue`. Feeding `typedValue` everywhere loses a
         * ruled DEFAULT and a ladder result, neither of which the pricer has to retype.
         */
        const v = f.otherMode ? f.typedValue : f.value;
        if (v !== "") attrs[f.id] = v;
        if (f.otherMode) other.push(f.id);
      }
      /**
       * A PER-ITEM FACT WITH NO CONTROL ON THIS BLOCK. `itemFieldDefs` decides which of the model's
       * answers a family's block renders, so an answer the model gave that this family does not ask
       * about has no box to type it into -- the item-list analogue of a `panel: false` def. Counted,
       * and supplied only in `full` mode, so the arithmetic question and the screen question stay apart.
       */
      for (const [k, v] of Object.entries(c.items?.[i] ?? {})) {
        if (rendered.has(k) || ownControl.has(k) || v === null || v === undefined || v === "") continue;
        if (!hiddenFacts.includes(k)) hiddenFacts.push(k);
        if (mode === "full") attrs[k] = String(v);
      }
      return { base: null, family: b.family, attrs, qty: b.qty, ...(other.length ? { other } : {}) };
    });
    overrides[ITEM_LIST_OVERRIDE_KEY] = JSON.stringify({ items: edits });
    const { unit, unitFeed } = unitForCalculator(config, view);
    overrides[ROW_UNIT_OVERRIDE_KEY] = unit;
    return { overrides, hiddenFacts, unitFeed };
  }

  for (const a of panel.workings.attributes) {
    if (a.readOnly || a.disabled) continue; // no control to type into
    if (a.value !== "") overrides[a.id] = a.value;
  }
  for (const d of defsOf(config)) {
    if (d.panel !== false) continue;
    const v = c.attrs[d.id];
    if (v === null || v === undefined || v === "") continue;
    hiddenFacts.push(d.id);
    if (mode === "full") overrides[d.id] = String(v);
  }
  return { overrides, hiddenFacts };
}

// ── WHAT IS COMPARED ────────────────────────────────────────────────────────────────────────────

type Figures = Partial<Record<RateKind, number>>;

function figuresText(f: Figures | undefined): string {
  if (!f) return "-";
  return DISPLAY_RATE_KINDS.map((k) => `${k}=${f[k] === undefined ? "-" : f[k]}`).join(" ");
}

/** Every labelled block's figures, keyed by LABEL (order-insensitive: wiring reorders its two
 * sections by the row text, and the labels are what the screen shows). */
function blocksByLabel(s: HelperResult): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isSuggestion(s)) return out;
  for (const g of s.workings.sections ?? []) out[g.label] = figuresText(g.figures);
  return out;
}

function headlinesByLabel(s: HelperResult): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isSuggestion(s)) return out;
  for (const h of s.headlines ?? []) out[h.label] = figuresText(h.values);
  return out;
}

/** The fields the screen flags RED -- the honest "same reason" for a row-level refusal, since the
 * basis SENTENCE differs between an in-run row and a manual one by design ("Complete the missing
 * attributes to price" vs "Fill the attributes to price"). */
function blankFieldIds(s: HelperResult): string[] {
  if (!isSuggestion(s)) return [];
  return s.workings.attributes.filter((a) => a.value === "" && !a.derived && !a.disabled).map((a) => a.id).sort();
}

export interface ItemBlockFacts {
  family: string | null;
  state: string;
  reason: string;
  figures: string;
  qty: string;
}

function itemFacts(s: HelperResult): { view: ItemListView; blocks: ItemBlockFacts[]; totals: string; unit: string; unitClass: string | null; rowPriced: boolean; reason: string } | null {
  if (!isSuggestion(s)) return null;
  const view = (s as ItemListSuggestion).itemList;
  if (!view) return null;
  return {
    view,
    unit: view.unit,
    unitClass: view.unitClass,
    rowPriced: view.rowPriced,
    reason: view.reason ?? "",
    totals: figuresText(view.totals),
    blocks: view.items.map((b) => ({
      family: b.family,
      state: b.state,
      reason: b.reason ?? "",
      figures: figuresText(b.figures),
      qty: b.qty,
    })),
  };
}

export interface Divergence {
  what: string;
  panel: string;
  calculator: string;
}

/**
 * STRICT comparison of the two results. Nothing is tolerated here: a tolerance belongs in the test,
 * named and counted, never buried in the comparator (a comparator that forgives is a comparator that
 * proves nothing).
 */
export function compareResults(panel: HelperResult, calc: HelperResult): Divergence[] {
  const d: Divergence[] = [];
  const push = (what: string, p: unknown, c: unknown) => {
    const ps = typeof p === "string" ? p : JSON.stringify(p);
    const cs = typeof c === "string" ? c : JSON.stringify(c);
    if (ps !== cs) d.push({ what, panel: ps, calculator: cs });
  };

  push("kind", panel.kind, calc.kind);
  if (panel.kind !== calc.kind) return d;
  if (!isSuggestion(panel) || !isSuggestion(calc)) {
    push("decline reason", (panel as { reason?: string }).reason ?? "", (calc as { reason?: string }).reason ?? "");
    return d;
  }

  push("values", figuresText(panel.values), figuresText(calc.values));
  push("finalValues", figuresText(panel.workings.finalValues), figuresText(calc.workings.finalValues));
  push("blocks", blocksByLabel(panel), blocksByLabel(calc));
  push("headlines", headlinesByLabel(panel), headlinesByLabel(calc));

  const pi = itemFacts(panel);
  const ci = itemFacts(calc);
  if (!!pi !== !!ci) {
    push("item-list view present", !!pi, !!ci);
  } else if (pi && ci) {
    // ⚠️ THE UNIT CLASS, NOT THE UNIT STRING. The class is what prices; the string is what the sheet
    // wrote, and the calculator's picker offers one spelling per class, so "Nos" vs "nos" is a
    // spelling, not a price. Comparing the string would report 358 ADP rows as diverged while every
    // figure agreed -- a guard that cries wolf is a guard nobody reads.
    push("item unit class", pi.unitClass ?? "", ci.unitClass ?? "");
    push("item rowPriced", pi.rowPriced, ci.rowPriced);
    push("item row reason", pi.reason, ci.reason);
    push("item totals", pi.totals, ci.totals);
    push("item blocks", pi.blocks, ci.blocks);
  } else {
    push("blank fields", blankFieldIds(panel), blankFieldIds(calc));
  }
  return d;
}

/** The two paths over one case, in one call. */
export interface ParityRun {
  panel: HelperResult;
  calculator: HelperResult;
  feed: Feed;
  divergences: Divergence[];
}

export function runParity(
  configsByCategory: Map<string, RateCategoryConfig>,
  items: RateMasterItem[],
  c: ParityCase,
  mode: FeedMode = "full",
): ParityRun {
  const ph = panelHelper(configsByCategory, items, c);
  const panel = ph.compute(panelCtx(c));
  const config = configsByCategory.get(c.cat) ?? null;
  const feed = feedFromPanel(panel, config, c, mode);
  const ch = calculatorHelper(configsByCategory, items);
  const discipline = disciplineOf(c.cat) ?? "";
  const calculator = ch.compute(calculatorCtx(discipline, c.cat), feed.overrides);
  return { panel, calculator, feed, divergences: compareResults(panel, calculator) };
}

/**
 * WHICH RESOLUTION PATHS A PANEL RESULT EXERCISED -- so a sweep can NAME what it covered instead of
 * quoting a row count. Read from the result the product produced; nothing is inferred from the input.
 */
export function resolutionPaths(panel: HelperResult): string[] {
  const out = new Set<string>();
  if (!isSuggestion(panel)) {
    out.add("declined");
    return [...out];
  }
  const view = (panel as ItemListSuggestion).itemList;
  if (view) {
    out.add(view.rowPriced ? "item-list priced" : "item-list refused");
    for (const b of view.items) {
      if (b.state === "blank") out.add("item refused");
      for (const f of b.fields) {
        if (f.defaulted) out.add("default fired");
        if (f.note && f.note.includes("next size up")) out.add("ladder size-up");
        if (f.note && f.note.includes("spelling of this size")) out.add("precision match");
        if (f.note && f.note.includes("not stocked with the other answers")) out.add("stale pick cleared");
        if (f.otherMode) out.add("typed (Other)");
      }
      if (b.working.some((w) => w.toLowerCase().includes("per sq"))) out.add("area conversion");
      if (b.working.some((w) => w.toLowerCase().includes("band"))) out.add("area band");
    }
    if (view.items.length > 1) out.add("multi-item row");
    return [...out];
  }
  const priced = Object.keys(panel.values).length > 0;
  out.add(priced ? "row priced" : "row incomplete");
  for (const a of panel.workings.attributes) {
    if (a.defaulted) out.add("default fired");
    if (a.derived) out.add("derived attribute");
    if (a.readOnly) out.add("superseded attribute");
    if (a.disabled) out.add("disabled by None");
    for (const n of a.notes ?? []) out.add(`note:${n.kind}`);
  }
  if ((panel.workings.sections ?? []).length > 1) out.add("multi-block row");
  if (panel.basis.includes("no match")) out.add("no match");
  return [...out];
}

// ── THE SKU SWEEPS (acceptance items 3, 4, 5) ───────────────────────────────────────────────────
//
// The corpus proves parity over the rows the model has actually read. These sweeps prove it over the
// CATALOGUE: every active SKU a category can price, and every way a row resolves. A case is SYNTHESIZED
// as a stored extraction row -- the shape `buildExtractionByRow` produces -- so the PANEL path still runs
// its own `ext` branch; only the SOURCE of the answers is the catalogue rather than a run.

/** The item kinds a category prices: its declared `item_kinds`, else the kinds its pipelines name. */
export function categoryItemKinds(config: RateCategoryConfig): string[] {
  const declared = (config as { item_kinds?: unknown }).item_kinds;
  if (Array.isArray(declared) && declared.length > 0) {
    return declared.filter((k): k is string => typeof k === "string");
  }
  const out = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k === "kind" && typeof v === "string") out.add(v);
        else walk(v);
      }
    }
  };
  walk(config.pipelines ?? {});
  return [...out];
}

function isNumericType(t: unknown): boolean {
  return t === "number" || t === "number_choice";
}

/**
 * ONE CASE PER ACTIVE SKU of a row-level category. Each attribute definition is answered from the SKU
 * itself where the SKU carries it, else from the definition's own vocabulary, else 1 for a number -- so
 * the row reaches the pipeline and a real rate is computed instead of refusing for a missing quantity.
 * A definition nothing can answer is left ABSENT, which is a legitimate input too.
 */
export function skuCasesForCategory(
  config: RateCategoryConfig,
  items: RateMasterItem[],
): ParityCase[] {
  const kinds = new Set(categoryItemKinds(config));
  const defs = defsOf(config);
  const out: ParityCase[] = [];
  for (const sku of items) {
    if (!kinds.has(sku.kind)) continue;
    const attrs: Record<string, string | number | null> = {};
    const skuAttrs = (sku.attributes ?? {}) as Record<string, string | number | null>;
    for (const d of defs) {
      if (Object.prototype.hasOwnProperty.call(skuAttrs, d.id) && skuAttrs[d.id] !== null) {
        attrs[d.id] = skuAttrs[d.id];
      } else if (Array.isArray(d.values) && d.values.length > 0) {
        attrs[d.id] = d.values[0] as string | number;
      } else if (isNumericType((d as { type?: unknown }).type)) {
        attrs[d.id] = 1;
      }
    }
    out.push({ cat: config.category_id, unit: "", desc: "", attrs });
  }
  return out;
}

/** A row-level case with NOTHING answered -- the refusal path, on every category. */
export function emptyCaseFor(config: RateCategoryConfig): ParityCase {
  return { cat: config.category_id, unit: "", desc: "", attrs: {} };
}

/**
 * ITEM-LIST CASES: one per (family x unit class the family may be offered in), with every field the block
 * renders answered FROM THE LIVE CATALOGUE -- `fieldOptionsFromSkus`, the same options the dropdown shows,
 * re-read as answers accumulate so a narrowed list is honoured exactly as the screen narrows it. Three
 * further cases per family drive the resolution paths a stocked pick cannot reach: a size ABOVE the largest
 * rung (refusal), a size BETWEEN two rungs (next-size-up), and nothing answered at all.
 */
export function itemListCasesForCategory(
  config: RateCategoryConfig,
  items: RateMasterItem[],
): ParityCase[] {
  const spec = itemListPricingSpec(config);
  if (!spec) return [];
  const defs = listSpecDefs(config);
  const famAttr = familyAttr(spec);
  const out: ParityCase[] = [];
  const spellingOf = (cls: string): string => (spec.unit_classes[cls] ?? [])[0] ?? "";

  for (const family of Object.keys(spec.families)) {
    for (const cls of familyUnitClasses(spec, family)) {
      // fill the block's fields from the live options, re-reading them as answers accumulate
      const answers: Record<string, string | number> = {};
      const byId: Record<string, string | number | null> = {};
      for (let pass = 0; pass < 3; pass++) {
        for (const f of itemFieldDefs(spec, defs, family, cls, { items, answers })) {
          if (Object.prototype.hasOwnProperty.call(byId, f.id)) continue;
          const opts = fieldOptionsFromSkus(spec, items, family, cls, f.skuAttr, answers);
          const pick = opts[0] ?? (f.options ?? [])[0];
          if (pick === undefined) continue;
          byId[f.id] = pick;
          answers[f.skuAttr] = pick;
        }
      }
      const base = { cat: config.category_id, unit: spellingOf(cls), desc: "" };
      out.push({ ...base, attrs: {}, items: [{ [famAttr]: family, ...byId }] });

      // the ladder paths, on the FIRST numeric field this family renders
      const numeric = itemFieldDefs(spec, defs, family, cls, { items, answers })
        .find((f) => f.skuAttr in spec.numbers && (fieldOptionsFromSkus(spec, items, family, cls, f.skuAttr, {}).length > 1));
      if (numeric) {
        const rungs = fieldOptionsFromSkus(spec, items, family, cls, numeric.skuAttr, {})
          .map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        if (rungs.length > 1) {
          const above = rungs[rungs.length - 1] + 1000;
          const between = (rungs[0] + rungs[1]) / 2;
          out.push({ ...base, attrs: {}, items: [{ [famAttr]: family, ...byId, [numeric.id]: String(above) }] });
          if (!rungs.includes(between)) {
            out.push({ ...base, attrs: {}, items: [{ [famAttr]: family, ...byId, [numeric.id]: String(between) }] });
          }
        }
      }
      // nothing answered: the refusal path
      out.push({ ...base, attrs: {}, items: [{ [famAttr]: family }] });
    }
  }
  return out;
}

// ── THE FOUR CAUSES EVERY DIVERGENCE TODAY FALLS INTO (slice 12c-P findings) ─────────────────────
//
// Measured 2026-10-06 over all 96 runs (10,460 rows) and the whole catalogue. Nothing is UNCLASSIFIED,
// and the permanent test asserts both that and the exact count of each cause -- so a NEW divergence, or
// a change in how many rows a known cause touches, turns the suite red.
//
//   A  wiring: WHICH BLOCK IS OFFERED is chosen by the ROW TEXT, and the calculator has no text field.
//      Both blocks' supply and install are computed and shown identically on BOTH surfaces; only which
//      one lands in `values` (what "Use this value" applies) differs. No figure is computed differently.
//   B  item-list: the 12c-S stale-pick clearing exempts a value the MODEL read off the BoQ ("evidence
//      about the row, not a choice") but NOT the same value typed by a pricer -- so the panel prices and
//      the calculator refuses. ⚠️ THE ONLY CAUSE WHERE A PRICE EXISTS ON ONE SURFACE AND NOT THE OTHER.
//   C  item-list: the row's unit is not one the picker offers (a `unit_factors` conversion unit, a unit
//      belonging to no declared class, or a class the family declares `units_not_offered`).
//   D  item-list: BOTH refuse, and the panel's reason quotes BoQ text that has no box on the screen
//      ("several values stated for torque ('3.5, 7.9 & 15.9 Nm')") where the calculator says "no torque
//      stated". A pricer cannot retype an unparseable string, so the sentence differs; no price does.
export type DivergenceCause =
  | "A_wiring_primary"
  | "B_stale_pick"
  | "C_unit_not_offered"
  | "D_reason_only"
  | "Z_UNCLASSIFIED";

/** PURE over a completed run. Which of the four declared causes explains this divergence. */
export function classifyDivergence(run: ParityRun, c: ParityCase): DivergenceCause {
  const whats = new Set(run.divergences.map((d) => d.what));
  const onlyOfferedFigure = [...whats].every((w) => w === "values" || w === "finalValues");
  if (c.cat === "wiring_cabling" && onlyOfferedFigure) return "A_wiring_primary";
  const calcNotes = itemFieldNotes(run.calculator);
  if (calcNotes.some((n) => n.includes("not stocked with the other answers"))) return "B_stale_pick";
  if (whats.has("item unit class")) return "C_unit_not_offered";
  const bothRefuse = !hasPrice(run.panel) && !hasPrice(run.calculator);
  if (bothRefuse && panelQuotesTextWithNoBox(run.panel)) return "D_reason_only";
  return "Z_UNCLASSIFIED";
}

/** Did this result produce a figure at all? */
export function hasPrice(r: HelperResult): boolean {
  return isSuggestion(r) && Object.keys(r.values).length > 0;
}

function itemListView(r: HelperResult): ItemListView | undefined {
  return isSuggestion(r) ? (r as ItemListSuggestion).itemList : undefined;
}

/** Every item-field note the result carries (the sentences under the boxes). */
export function itemFieldNotes(r: HelperResult): string[] {
  const v = itemListView(r);
  return v ? v.items.flatMap((b) => b.fields.map((f) => f.note ?? "")) : [];
}

/**
 * Is some field's BOX empty while the BoQ's own words sit in its note? That is cause D's signature: the
 * value could not be used, so rule F7 blanked the box, and only the note still carries the text.
 */
export function panelQuotesTextWithNoBox(r: HelperResult): boolean {
  const v = itemListView(r);
  return !!v && v.items.some((b) => b.fields.some((f) => f.value === "" && f.typedValue !== "" && !f.otherMode));
}

/**
 * SLICE 12d-2 -- THE ONE fixture reader for the parity family. A big fixture is READ at runtime, never
 * `import`ed (tsc would infer a structural type for the whole file), and the parse lives HERE so that a
 * test adds no inline parse of its own (ADR-0010 F2's ratchet counts every inline parse under pages/).
 * The caller passes the URL it resolved against its own `import.meta.url`.
 */
export function readJsonFixture<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf-8")) as T;
}
