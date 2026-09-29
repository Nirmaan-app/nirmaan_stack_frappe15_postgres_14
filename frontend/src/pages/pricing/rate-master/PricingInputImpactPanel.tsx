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
import { useMemo, useState } from "react";
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
} as const;

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

  const impact = useMemo(
    () => computeImpact(stored, edited, reach, itemsByUid, adderCtx, exactCtx),
    [stored, edited, reach, itemsByUid, adderCtx, exactCtx],
  );

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
    const raw = text.replace("%", "").trim();
    if (raw === "") { const next = { ...edited }; delete next[key]; setEdited(next); return; }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setEdited({ ...edited, [key]: isPercentField(key) ? n / 100 : n });
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
                  value={isPercentField(k) ? pctText(valueOf(k)) : String(valueOf(k) ?? "")}
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
                            <th className="px-1.5 py-1 text-right font-medium">now</th>
                            <th className="px-1.5 py-1 text-right font-medium">becomes</th>
                            <th className="px-1.5 py-1 text-right font-medium">change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((r) => (
                            <tr
                              key={`${r.itemUid}-${r.rateKey}`}
                              className="cursor-pointer border-t hover:bg-muted/40"
                              onClick={() => setDetailKey(skuKey(r))}
                            >
                              <td className="truncate px-1.5 py-1" title={r.label}>{r.label}</td>
                              <td className="px-1.5 py-1 text-right tabular-nums">{fmt(r.now)}</td>
                              <td className={cn("px-1.5 py-1 text-right tabular-nums",
                                                r.moved ? (r.becomes > r.now ? "font-semibold text-rose-700" : "font-semibold text-emerald-700")
                                                        : "text-muted-foreground")}>
                                {r.moved ? fmt(r.becomes) : "—"}
                              </td>
                              <td className={cn("px-1.5 py-1 text-right tabular-nums",
                                                r.moved ? (r.becomes > r.now ? "text-rose-700" : "text-emerald-700")
                                                        : "text-muted-foreground")}>
                                {r.moved && r.pctChange !== null
                                  ? `${r.pctChange > 0 ? "+" : ""}${Math.round(r.pctChange * 10) / 10}%`
                                  : "—"}
                              </td>
                            </tr>
                          ))}
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
