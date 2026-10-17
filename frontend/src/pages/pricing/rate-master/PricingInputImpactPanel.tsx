/**
 * SLICE 12b(B) -- THE PRICING-INPUT IMPACT PANEL. Owner's locked mock, `PricingInputs.dc.html`.
 *
 * Opens BESIDE the Pricing Inputs table (470 px), never over it: the point is to compare the input you
 * are editing against the table it sits in.
 *
 * ⚠️ A FLEX SIBLING, NOT `components/ui/sheet.tsx`. That component OVERLAYS, which is exactly what the
 * owner ruled out ("not covering it"). The precedent is `RateHelperPanel`'s `embedded` / `push`
 * variants -- an in-flow column that occupies real layout width, so the table narrows rather than being
 * hidden. Do not "simplify" this into a Sheet.
 *
 * ⚠️ EVERY FIGURE COMES FROM THE PURE MODULES (`pricingInputReach`, `pricingInputImpact`). This file
 * renders; it does not compute. That split is not tidiness -- this repo has NO DOM test environment
 * (`frontend/CLAUDE.md`), so arithmetic living in a component is arithmetic nothing can test.
 *
 * ⚠️ NOTHING IS SAVED UNTIL SAVE (owner item 10). Typing recomputes the preview and writes nothing; the
 * amber line says so in as many words. Cancel restores the stored values.
 */
import { Fragment, useMemo, useState } from "react";
import { X, ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RateMasterItem } from "./rateMasterTypes";
import type { InputReach } from "./pricingInputReach";
import {
  adderConditionText, baseMultiplierByColumn, computeImpact, ctxValuesOf, editableFieldsOf, isPercentField,
  pctText, skuKey, workingLegs,
  type SkuImpactRow,
  sampleGeometryText,
} from "./pricingInputImpact";
import { PRICING_INPUT_COLUMN_LABELS } from "./rateMasterSpec";
import { downloadErrorMessage } from "./rateMasterDownload";
import { LEG_CLASS_LABEL, legClassOf } from "./pricingInputExact";

/** The panel's fixed width (owner: "470px, not covering it"). */
export const IMPACT_PANEL_WIDTH = 470;

export const IMPACT_COPY = {
  preview: "Shown with your proposed values — nothing is saved until you press Save.",
  unchanged: "Shown with the values as they stand today.",
  nothingYet: "Change a value above to see what it would do.",
  back: "Back to the list",
  searchPlaceholder: "Search these SKUs",
  save: "Save",
  cancel: "Cancel",
  /** ⚠️ The ROW-level figure is NOT this panel's per-SKU number, and the difference is measured, not
   * theoretical: a row is rounded once at the end, which spread the switchgear discount's real effect
   * across 84 distinct percentages between 13.04% and 17.81% while the per-SKU change is a flat
   * 16.667%. Saying so is the honest alternative to showing one as the other. */
  rowRounding: "Each row's total is rounded once at the end, so a row's own change can differ from these.",
  flatAdder: "Added to each row below, not multiplied — so the percentage differs from SKU to SKU.",
  /** Names the quantity the `now` / `becomes` columns are in -- see the header's own note. */
  nowLegTitle: (leg: string) => `Both figures are the ${leg} rate, before and after.`,
} as const;

/**
 * SLICE 12e-2b (12e-2 cert finding 3, AC9) -- A VALUE BOX KEEPS THE TEXT AS TYPED.
 *
 * The box was bound to the NUMBER it had parsed: typing "0." stored 0, the box re-rendered "0", the dot was
 * gone, and the next key made "04" -> 4. So "0.4" typed key by key became 4 (and "0.05" became 5) on every
 * discipline's inputs, while a value set in one event took. The number still drives the preview; the BOX shows
 * `drafts[key]`, the text the person typed, until the edit is saved or cancelled.
 *
 * `typeIntoField` is the whole rule, PURE, so it is tested by feeding it one character at a time:
 *   - a complete number sets the value (a percent field divides by 100, as before);
 *   - a number still being typed (".", "0.", "-") keeps the text and leaves the value where it was;
 *   - an empty box means "no edit": the value falls back to the stored one and the box STAYS empty;
 *   - anything else is ignored, text and value both, exactly as before.
 */
/**
 * SLICE 12e-2b (12e-2 cert finding 2; owner 2026-10-10: "HVAC item-list rows") -- A ROW'S LABEL NAMES ITS FACTS
 * BY THE PANEL FIELD'S LABEL, NEVER BY AN ATTRIBUTE ID.
 *
 * `skuLabel` tells same-named rows apart by "<attribute id> <value>" ("... · size_mm 15.9"). On a SKU priced by an
 * ITEM-LIST category the id is replaced by the label that category's own field carries (`list_spec.
 * attribute_definitions`): "Pipe size 15.9", "Thickness (mm) 25". The field is found by its id, or -- where a
 * SKU attribute is read from a differently named field -- through the config's own number reader.
 *
 * ⚠️ ITEM-LIST CATEGORIES ONLY, AND ONLY HERE. A row whose categories are not item-list (every Electrical row) is
 * returned byte-identical, and the shared `skuLabel` is untouched, so no other reader of a label moves. An id the
 * config declares no label for is left as it is -- nothing is invented. PURE.
 */
export function plainSkuLabel(label: string, configs: ReadonlyArray<unknown>): string {
  const byId = new Map<string, string>();
  for (const cfg of configs) {
    const ls = (cfg as { list_spec?: { attribute_definitions?: unknown; pricing?: { numbers?: Record<string, { from?: string[] }> } } } | undefined)?.list_spec;
    const defs = Array.isArray(ls?.attribute_definitions) ? (ls!.attribute_definitions as Array<{ id?: unknown; label?: unknown }>) : [];
    if (!defs.length || !ls?.pricing) continue;
    const labelOf = new Map<string, string>();
    for (const d of defs) if (typeof d?.id === "string" && typeof d?.label === "string" && d.label.trim()) labelOf.set(d.id, d.label.trim());
    for (const [id, l] of labelOf) if (!byId.has(id)) byId.set(id, l);
    for (const [skuAttr, reader] of Object.entries(ls.pricing.numbers ?? {})) {
      const src = reader?.from?.[0];
      if (src && labelOf.has(src) && !byId.has(skuAttr)) byId.set(skuAttr, labelOf.get(src)!);
    }
  }
  if (!byId.size) return label;
  const parts = label.split(" · ");
  return parts.map((part, i) => {
    if (i === 0) return part;                                   // the row's own name
    const cut = part.indexOf(" ");
    const id = cut < 0 ? part : part.slice(0, cut);
    const plain = byId.get(id);
    return plain ? `${plain}${cut < 0 ? "" : part.slice(cut)}` : part;
  }).join(" · ");
}

const NO_DRAFTS: Record<string, string> = {};
export interface FieldEditState { edited: Record<string, number>; drafts: Record<string, string> }

export function typeIntoField(state: FieldEditState, key: string, text: string, percent: boolean): FieldEditState {
  const raw = text.replace("%", "").trim();
  if (raw === "") {
    const edited = { ...state.edited };
    delete edited[key];
    return { edited, drafts: { ...state.drafts, [key]: "" } };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    // a number in the middle of being typed: keep the text, do not touch the value
    if (/^-?\d*\.?\d*$/.test(raw)) return { edited: state.edited, drafts: { ...state.drafts, [key]: text } };
    return state;
  }
  return { edited: { ...state.edited, [key]: percent ? n / 100 : n }, drafts: { ...state.drafts, [key]: text } };
}

/** What a value box shows: the text as typed while an edit is open, else the value (edited, else stored). */
export function fieldBoxText(state: FieldEditState, key: string, stored: Record<string, number>, percent: boolean): string {
  if (key in state.drafts) return state.drafts[key];
  const v = key in state.edited ? state.edited[key] : stored[key];
  return percent ? pctText(v) : String(v ?? "");
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

interface Props {
  /** the pricing-input catalogue row being edited */
  input: RateMasterItem;
  reach: InputReach | undefined;
  itemsByUid: Map<string, RateMasterItem>;
  /** every pricing input of this discipline, and the reach of each -- a FLAT ADDER prices its rows
   *  against the rate the OTHER inputs leave, and reads its own addend out of the shared ctx. */
  allInputs: RateMasterItem[];
  allReach: Record<string, InputReach>;
  /** every category config + the whole catalogue, so the panel prices through the PRODUCT'S pipeline */
  allConfigs: Record<string, { pipelines?: Record<string, unknown> } | undefined>;
  allItems: RateMasterItem[];
  /** category id -> its human name, so no id reaches the screen (owner N-7) */
  categoryLabel: (id: string) => string;
  onClose: () => void;
  /** resolves when the write has landed; the panel leaves its edits in place until then */
  onSave: (rates: Record<string, number>) => Promise<void>;
  canEdit: boolean;
}

export function PricingInputImpactPanel({
  input, reach, itemsByUid, allInputs, allReach, allConfigs, allItems,
  categoryLabel, onClose, onSave, canEdit,
}: Props) {
  const stored = (input.rates ?? {}) as Record<string, number>;
  const attrs = (input.attributes ?? {}) as Record<string, unknown>;
  const [edited, setEdited] = useState<Record<string, number>>({});
  // SLICE 12e-2b (AC9): the text of each box AS TYPED -- see `typeIntoField`. The texts belong to ONE `edited`
  // object (`owner`): Cancel and Save replace `edited`, which drops them with no second reset to forget.
  const [draftState, setDraftState] = useState<{ owner: Record<string, number> | null; drafts: Record<string, string> }>({ owner: null, drafts: {} });
  const drafts = draftState.owner === edited ? draftState.drafts : NO_DRAFTS;
  const [query, setQuery] = useState("");
  /**
   * ⚠️ THE DETAIL HOLDS THE SKU's IDENTITY, NEVER THE ROW OBJECT. A captured row freezes `now`,
   * `becomes`, `pctChange` and `moved` at the moment it was opened, while the legs below recompute
   * from the live values -- so editing or cancelling with the detail open left the verdict claiming
   * a change its own working said had not happened. Found in the browser cert, and it is the same
   * class of defect as the one-leg verdict: the panel explaining a figure with something untrue.
   */
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = useMemo(() => editableFieldsOf(stored), [stored]);
  /** what a flat adder needs beyond its own values; inert for every other shape */
  const adderCtx = useMemo(() => {
    if (!reach?.isFlatAdder) return null;
    const item = String((input.attributes ?? {}).item ?? "");
    const others = allInputs
      .filter((i) => i.item_uid !== input.item_uid)
      .map((i) => ({ rates: i.rates, reach: allReach[String((i.attributes ?? {}).item ?? "")] }));
    return {
      ctxNow: ctxValuesOf(allInputs),
      ctxNext: ctxValuesOf(allInputs, { item, rates: edited }),
      baseMultiplier: baseMultiplierByColumn(reach, others),
    };
  }, [reach, allInputs, allReach, input, edited]);

  /** ⚠️ the figures come from the PRODUCT'S pipeline, not from a second implementation of it */
  const exactCtx = useMemo(() => ({
    configs: allConfigs,
    items: allItems,
    inputItemKey: String((input.attributes ?? {}).item ?? ""),
  }), [allConfigs, allItems, input]);

  const impact = useMemo(() => {
    const raw = computeImpact(stored, edited, reach, itemsByUid, adderCtx, exactCtx);
    // SLICE 12e-2b: an item-list SKU's label names its facts by the panel field's label (see `plainSkuLabel`).
    // The SAME row objects sit in `rows` and `rowsByCategory`, so each is relabelled once and both lists share it.
    const relabelled = new Map<SkuImpactRow, SkuImpactRow>();
    const plain = (r: SkuImpactRow): SkuImpactRow => {
      let out = relabelled.get(r);
      if (!out) {
        const label = plainSkuLabel(r.label, r.categories.map((c) => allConfigs[c]));
        out = label === r.label ? r : { ...r, label };
        relabelled.set(r, out);
      }
      return out;
    };
    return {
      ...raw,
      rows: raw.rows.map(plain),
      rowsByCategory: Object.fromEntries(Object.entries(raw.rowsByCategory).map(([k, v]) => [k, v.map(plain)])),
    };
  }, [stored, edited, reach, itemsByUid, adderCtx, exactCtx, allConfigs]);

  /** ⚠️ an adder's figures ARE one install case, so the panel says which (owner item 3) */
  const conditionText = useMemo(() => adderConditionText(impact.adderWhen), [impact.adderWhen]);

  /** the LIVE row for the open SKU, re-derived every render from the current impact */
  const detail = useMemo<SkuImpactRow | null>(
    () => (detailKey ? impact.rows.find((r) => skuKey(r) === detailKey) ?? null : null),
    [detailKey, impact],
  );

  // the search narrows the LIST, and the counter reads "14 of 191" while it does (owner item 9)
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const out: Array<{ cat: string; label: string; rows: SkuImpactRow[]; total: number }> = [];
    for (const cat of Object.keys(impact.rowsByCategory).sort()) {
      const all = impact.rowsByCategory[cat];
      const rows = q ? all.filter((r) => r.label.toLowerCase().includes(q)) : all;
      if (rows.length) out.push({ cat, label: categoryLabel(cat), rows, total: all.length });
    }
    return out;
  }, [impact.rowsByCategory, q, categoryLabel]);
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  const total = impact.rows.length;

  const setField = (key: string, text: string) => {
    const next = typeIntoField({ edited, drafts }, key, text, isPercentField(key));
    setEdited(next.edited);
    setDraftState({ owner: next.edited, drafts: next.drafts });
  };
  const valueOf = (key: string) => (key in edited ? edited[key] : stored[key]);
  const isDirtyField = (key: string) => key in edited && edited[key] !== stored[key];

  const doSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, number> = {};
      for (const k of fields) if (isDirtyField(k)) patch[k] = edited[k];
      await onSave(patch);
      setEdited({});
    } catch (e: unknown) {
      /**
       * ⚠️ NOT `String(e)` -- a Frappe SDK rejection is a plain OBJECT, so that rendered the literal
       * "[object Object]" on screen. Found in the T9b cert, where the save was failing and the panel
       * could not say why. `downloadErrorMessage` is the app's ONE reader of "what did the server
       * actually say" (`_server_messages` first, then `exception`); reused here rather than minting
       * a second, which is what its own docstring asks for.
       */
      setError(downloadErrorMessage(e) || (e instanceof Error ? e.message : "The save did not go through."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside
      className="shrink-0 rounded border bg-background p-3 self-start sticky top-4 flex flex-col gap-3"
      style={{ width: IMPACT_PANEL_WIDTH }}
      data-testid="pricing-input-impact-panel"
    >
      <header className="flex items-start gap-2">
        {detail ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setDetailKey(null)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {IMPACT_COPY.back}
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{String(attrs.name ?? attrs.item ?? "")}</p>
            <p className="text-[11px] text-muted-foreground">
              {`${total} item${total === 1 ? "" : "s"} · ${Object.keys(impact.rowsByCategory).map(categoryLabel).join(" · ")}`}
            </p>
          </div>
        )}
        <button type="button" aria-label="Close" className="ml-auto text-muted-foreground hover:text-foreground" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </header>

      {detail ? (
        <SkuWorking row={detail} impact={impact} stored={stored} valueOf={valueOf} isDirtyField={isDirtyField}
                    categoryLabel={categoryLabel} inputName={String(attrs.name ?? attrs.item ?? "")} />
      ) : (
        <>
          {/* the editable values, with TODAY's figure beside each (owner item 9) */}
          <div className="flex flex-col gap-1.5">
            {fields.map((k) => (
              <label key={k} className="flex items-center gap-2 text-xs">
                <span className="w-36 shrink-0 text-muted-foreground">
                  {PRICING_INPUT_COLUMN_LABELS[k] ?? k}
                </span>
                <Input
                  className={cn("h-7 w-24 text-right text-xs tabular-nums",
                                isDirtyField(k) && "border-rose-500")}
                  value={fieldBoxText({ edited, drafts }, k, stored, isPercentField(k))}
                  onChange={(e) => setField(k, e.target.value)}
                  disabled={!canEdit || saving}
                  data-testid={`impact-field-${k}`}
                />
                <span className="text-[11px] text-muted-foreground">
                  today {isPercentField(k) ? pctText(stored[k]) : fmt(stored[k] ?? 0)}
                </span>
              </label>
            ))}
          </div>

          {/* the summary, and what this shape does NOT move (owner item 12) */}
          <div className={cn("rounded px-2 py-1.5 text-[11px] leading-snug",
                             impact.changed ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                                            : "bg-muted text-muted-foreground")}>
            {impact.changed ? (
              <>
                <p>
                  This changes the <strong>{impact.legLabel.replace("SKU rate ", "").replace(/[()]/g, "")}</strong> rate
                  {impact.shape === "flat_adder"
                    ? " of every row this applies to."
                    : ` of ${total} SKU${total === 1 ? "" : "s"} in ${Object.keys(impact.rowsByCategory).length} categor${Object.keys(impact.rowsByCategory).length === 1 ? "y" : "ies"}.`}
                </p>
                <p className="mt-0.5">{impact.notMovedNote}</p>
                <p className="mt-0.5">
                  {impact.shape === "flat_adder" ? IMPACT_COPY.flatAdder : IMPACT_COPY.rowRounding}
                </p>
              </>
            ) : (
              <p>{IMPACT_COPY.nothingYet}</p>
            )}
          </div>

          {/* ⚠️ NO SHAPE SUPPRESSES THE LIST ANY MORE (owner ruling, 2026-09-29). A flat adder used to
              render one sentence and no rows, on the reading that it scales nothing -- true of the
              RATE, false of the PRICE. It lists its 450 trays like every other shape. */}
          {(
            <>
              {/* search across every group, with the "N of M" counter (owner item 9) */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-7 pl-7 text-xs"
                    placeholder={IMPACT_COPY.searchPlaceholder}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    data-testid="impact-search"
                  />
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" data-testid="impact-count">
                  {q ? `${shown} of ${total}` : `${total} item${total === 1 ? "" : "s"}`}
                </span>
              </div>

              {/* one group per category, EACH WITH ITS OWN SCROLL BOX (owner item 9) */}
              <div className="flex flex-col gap-2">
                {groups.map((g) => (
                  <section key={g.cat}>
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                      {g.label} · {q ? `${g.rows.length} of ${g.total}` : `${g.total} item${g.total === 1 ? "" : "s"}`}
                    </p>
                    <div className={cn("rounded border", g.rows.length > 8 && "max-h-[340px] overflow-y-auto")}>
                      <table className="w-full table-fixed text-[11px]">
                        <colgroup>
                          <col /><col style={{ width: 68 }} /><col style={{ width: 68 }} /><col style={{ width: 58 }} />
                        </colgroup>
                        <thead className="sticky top-0 bg-muted/60">
                          <tr className="text-muted-foreground">
                            <th className="px-1.5 py-1 text-left font-medium">Item</th>
                            {/* ⚠️ THE HEADING NAMES THE QUANTITY (12c cert fix, 2026-10-05). `now` used
                                to show the SKU's stored rate column with no edit pending and the
                                pipeline's computed leg with one -- two quantities, one unlabelled
                                heading. `computeImpact` now returns the computed leg in both branches,
                                and naming the leg here is what makes that visible rather than merely
                                true. */}
                            <th className="px-1.5 py-1 text-right font-medium" title={IMPACT_COPY.nowLegTitle(impact.legLabel)}>
                              now <span className="font-normal normal-case opacity-70">({impact.legLabel})</span>
                            </th>
                            <th className="px-1.5 py-1 text-right font-medium">becomes</th>
                            <th className="px-1.5 py-1 text-right font-medium">change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/*
                            ⚠️ ONE PASS, SO A SAMPLE SITS UNDER THE SKU IT BELONGS TO. The samples
                            used to be a SECOND `g.rows.filter(...)` pass after every row had been
                            rendered, which put all of them at the bottom of the table -- row 0's
                            samples appearing below row 69. That was invisible while nothing reached
                            the samples branch; the moment the cladding-only SKUs did (12c cert fix),
                            a reader could no longer tell which three geometries belonged to which
                            cladding. Parent and samples are now emitted together.
                          */}
                          {g.rows.map((r) => {
                            /**
                             * ⚠️ A ROW QUOTED BY SAMPLES HAS NO FIGURE OF ITS OWN, AND MUST NOT PRINT
                             * ONE. Such a SKU stores no cost column at all -- its cost is proportional
                             * to a girth it does not carry -- so `now`/`becomes` are structurally
                             * absent and were rendering as `0 -> 0`, which reads as "this costs
                             * nothing". A blank is never a 0 (the standing rule); the figures live in
                             * the sample rows below, each at a geometry that is named.
                             */
                            const quotedBySamples = !!r.samples?.length;
                            return (
                              <Fragment key={`${r.itemUid}-${r.rateKey}`}>
                                <tr
                                  className="cursor-pointer border-t hover:bg-muted/40"
                                  onClick={() => setDetailKey(skuKey(r))}
                                >
                                  <td className="truncate px-1.5 py-1" title={r.label}>{r.label}</td>
                                  <td className={cn("px-1.5 py-1 text-right tabular-nums",
                                                    quotedBySamples && "text-muted-foreground")}>
                                    {quotedBySamples ? "—" : fmt(r.now)}
                                  </td>
                                  <td className={cn("px-1.5 py-1 text-right tabular-nums",
                                                    !quotedBySamples && r.moved
                                                      ? (r.becomes > r.now ? "font-semibold text-rose-700" : "font-semibold text-emerald-700")
                                                      : "text-muted-foreground")}>
                                    {!quotedBySamples && r.moved ? fmt(r.becomes) : "—"}
                                  </td>
                                  <td className={cn("px-1.5 py-1 text-right tabular-nums",
                                                    !quotedBySamples && r.moved
                                                      ? (r.becomes > r.now ? "text-rose-700" : "text-emerald-700")
                                                      : "text-muted-foreground")}>
                                    {!quotedBySamples && r.moved && r.pctChange !== null
                                      ? `${r.pctChange > 0 ? "+" : ""}${Math.round(r.pctChange * 10) / 10}%`
                                      : "—"}
                                  </td>
                                </tr>
                                {/*
                                  OWNER F3: "show 2-3 sample impact calculations based on sizes stored
                                  in SKU." A SKU that stores no geometry of its own -- a cladding-only
                                  row -- has no single figure to show, because its cost is proportional
                                  to the girth and the girth is made of the pipe size and the thickness
                                  it does not carry. It is quoted at the stocked geometries instead,
                                  each priced through the SAME pricer the rest of the panel uses. A SKU
                                  with nothing to sample shows its own refusal reason, never a
                                  fabricated number.
                                */}
                                {(r.samples ?? []).map((sm, i) => {
                                  const legs = sm.result.legs;
                                  const primary = legs.find((l) => l.moved) ?? legs[0];
                                  return (
                                    <tr key={`${r.itemUid}-${r.rateKey}-s${i}`} className="border-t bg-muted/20">
                                      <td className="px-1.5 py-1 pl-4 text-muted-foreground" title={r.label}>
                                        at {sampleGeometryText(sm.geometry)}
                                      </td>
                                      <td className="px-1.5 py-1 text-right tabular-nums">
                                        {primary ? fmt(primary.now) : "—"}
                                      </td>
                                      <td className={cn("px-1.5 py-1 text-right tabular-nums",
                                                        primary?.moved
                                                          ? (primary.becomes > primary.now
                                                              ? "font-semibold text-rose-700"
                                                              : "font-semibold text-emerald-700")
                                                          : "text-muted-foreground")}>
                                        {primary?.moved ? fmt(primary.becomes) : "—"}
                                      </td>
                                      <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">
                                        {primary?.moved && primary.now !== 0
                                          ? `${primary.becomes > primary.now ? "+" : ""}${
                                              Math.round(((primary.becomes - primary.now) / primary.now) * 1000) / 10}%`
                                          : "—"}
                                      </td>
                                    </tr>
                                  );
                                })}
                                {r.note ? (
                                  <tr className="border-t bg-muted/20">
                                    <td className="px-1.5 py-1 pl-4 text-muted-foreground" colSpan={4}>
                                      {r.note}
                                    </td>
                                  </tr>
                                ) : null}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {error ? <p className="text-[11px] text-rose-700" data-testid="impact-error">{error}</p> : null}
      <p className="text-[11px] text-amber-800 dark:text-amber-200">
        {impact.changed ? IMPACT_COPY.preview : IMPACT_COPY.unchanged}
        {conditionText ? <span className="mt-1 block">{conditionText}</span> : null}
      </p>
      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-7 text-xs" disabled={!impact.changed || saving} onClick={doSave}
                  data-testid="impact-save">
            {IMPACT_COPY.save}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!impact.changed || saving}
                  onClick={() => { setEdited({}); setError(null); }} data-testid="impact-cancel">
            {IMPACT_COPY.cancel}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

/**
 * ONE SKU's working, in place (owner item 11): a verdict naming both legs, the calculation with its
 * formula in words, the CHANGED parameter highlighted and the others not, "was" beside the new, and
 * where each number comes from.
 */
function SkuWorking({
  row, impact, stored, valueOf, isDirtyField, categoryLabel, inputName,
}: {
  row: SkuImpactRow;
  impact: ReturnType<typeof computeImpact>;
  stored: Record<string, number>;
  valueOf: (k: string) => number;
  isDirtyField: (k: string) => boolean;
  categoryLabel: (id: string) => string;
  inputName: string;
}) {
  const fields = editableFieldsOf(stored);
  const moved = row.moved;
  const nextVals: Record<string, number> = {};
  for (const k of fields) nextVals[k] = valueOf(k);
  /** the classes the working below already shows, so "This also moves" never repeats one */
  const shownClasses = new Set<string>();
  const legs = workingLegs(impact.shape, row.storedRate, stored, nextVals,
    impact.shape === "flat_adder"
      ? { base: row.now - (impact.adderNow ?? 0), adderNow: impact.adderNow ?? 0, adderNext: impact.adderNext ?? 0 }
      : null);
  for (const l of legs) {
    if (/BCS/i.test(l.title)) shownClasses.add("bcs");
    else if (/install/i.test(l.title)) shownClasses.add("install");
    else shownClasses.add("supply");
  }
  const othersToShow = (row.otherLegs ?? []).filter((l) => !shownClasses.has(legClassOf(l.output)));

  return (
    <div className="flex flex-col gap-2 text-[11px]">
      <div>
        <p className="text-sm font-semibold">{row.label}</p>
        <p className="text-muted-foreground">
          {row.categories.map(categoryLabel).join(" · ")} · {row.rateKey}
        </p>
      </div>

      {/* the VERDICT, naming both legs */}
      <div className={cn("rounded px-2 py-1.5 leading-snug",
                         moved ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                               : "bg-muted text-muted-foreground")}
           data-testid="impact-verdict">
        {moved ? (
          <>
            {impact.legLabel} {fmt(row.now)} → {fmt(row.becomes)}
            {row.pctChange !== null ? ` (${row.pctChange > 0 ? "+" : ""}${Math.round(row.pctChange * 10) / 10}%)` : ""}
            {/* ⚠️ THE DETAIL NAMES THE SECOND LEG WITH ITS FIGURES. `impact.notMovedNote` is the LIST's
                wording ("open a SKU to see both legs") and is an instruction to do what the reader has
                already done -- it must not appear here. Found in the browser cert. */}
            {legs.length > 1
              ? ` · ${legs[1].title} ${fmt(legs[1].now)}${legs[1].moves ? ` → ${fmt(legs[1].becomes)}` : " (unchanged)"}`
              : ` · ${impact.notMovedNote}`}
          </>
        ) : (
          <>Nothing changed yet — edit a value on the list view to see this SKU move.</>
        )}
      </div>

      {/* THE CALCULATION, with its formula in words */}
      {legs.map((leg, i) => (
        <section key={leg.title} className="rounded border p-2" data-testid={`impact-leg-${i}`}>
          <p className="font-medium">{leg.title}</p>
          <p className="text-muted-foreground">{leg.formula}</p>
          <ul className="mt-1 space-y-0.5">
            <li>{row.rateKey} {fmt(row.storedRate)}</li>
            {fields.filter((k) => leg.uses.includes(k)).map((k) => (
              <li key={k} className={cn(isDirtyField(k)
                ? "rounded bg-amber-100 px-1 font-semibold text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
                : "text-blue-700 dark:text-blue-300")}>
                {isPercentField(k) ? pctText(valueOf(k)) : fmt(valueOf(k))} {PRICING_INPUT_COLUMN_LABELS[k] ?? k}
                {isDirtyField(k) ? ` — was ${isPercentField(k) ? pctText(stored[k]) : fmt(stored[k])}` : ""}
              </li>
            ))}
            <li className="font-semibold text-foreground">
              = {fmt(leg.becomes)}{leg.moves ? ` — was ${fmt(leg.now)}` : " (unchanged)"}
            </li>
          </ul>
        </section>
      ))}

      {/* ⚠️ EVERY OTHER RATE THIS INPUT MOVES, named. A conduit DISCOUNT moves the INSTALL rate too,
          because install is a share OF supply; naming only its own leg let a pricer meet a rate that
          had moved without being mentioned (owner ruling, gap (c)). */}
      {/* ⚠️ a leg the working ABOVE already shows is not repeated here -- a pair names its BCS leg in
          the verdict, so listing it again as "also moves" reads as a second, different movement. */}
      {othersToShow.length ? (
        <section className="rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/40"
                 data-testid="impact-also-moves">
          <p className="font-medium text-amber-900 dark:text-amber-100">This also moves</p>
          <ul className="mt-1 space-y-0.5 text-amber-900 dark:text-amber-100">
            {othersToShow.map((l) => (
              <li key={l.output}>
                {LEG_CLASS_LABEL[legClassOf(l.output)]} {fmt(l.now)} → {fmt(l.becomes)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* WHERE EACH NUMBER COMES FROM, naming the source and the leg it drives */}
      <section className="rounded border p-2">
        <p className="mb-1 font-medium">Where each number comes from</p>
        <ul className="space-y-0.5 text-muted-foreground">
          <li>{row.rateKey} {fmt(row.storedRate)} — this SKU's own stored rate</li>
          {fields.map((k) => (
            <li key={k} className={isDirtyField(k) ? "font-semibold text-amber-900 dark:text-amber-100" : undefined}>
              {PRICING_INPUT_COLUMN_LABELS[k] ?? k} {isPercentField(k) ? pctText(valueOf(k)) : fmt(valueOf(k))}
              {" — Pricing Input · "}{inputName}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
