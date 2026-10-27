// RM-2 Tab 2 -- DERIVATION. ADP-4b (owner D8, 2026-10-21: "the calculator already serves the same function. so the
// derivation tab just becomes the rules listing ... for all disciplines and categories"): THE RULES, AND NOTHING THAT
// PRICES. The attribute boxes, the pipeline step cards with their figures, and the inline parameter editor are gone
// on every category -- a second pricing path on this tab showed a figure the panel did not (ADP-R4 R4: 7685 / 1600 for
// a per-number square diffuser the panel prices at 1972 / 576), and the one-pricing-path rule forbids it. What stays:
// "How a row is priced" (the rules list) where the category has one, the extraction Rules card where the config
// carries rules, and otherwise ONE line saying where a row is priced (owner PA1-R).

import { useMemo } from "react";
import { extractionRulesCardShown, itemListRuleOrder } from "./itemListRuleOrder";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RateCategoryConfig, RateMasterItem, StepTrace } from "./rateMasterTypes";
import { isPricingInputConfig } from "./rateMasterSpec";
import { PRICING_WORKBOOKS } from "../pricingWorkbooks";

/**
 * PURE. The computed value a derived attribute displays, read out of the pipeline traces (the ctx
 * snapshot each step carries). Returns undefined when NOTHING computed it -- e.g. a "None" plate,
 * where blanks are positively absent -- so the caller can render an honest blank rather than a 0
 * that would claim "zero blanks" when the truth is "no plate to fill".
 *
 * ADP-4b: the tab no longer shows a computed value; this stays because the pricing panel reads it
 * (`pricingSheetHelper.ts`) and moving it is not this slice's change.
 */
export function derivedQtyValue(
  results: { steps: StepTrace[] }[],
  ctxKey: string,
): number | undefined {
  for (const r of results) {
    for (const st of r.steps) {
      const v = st.runningValues?.[ctxKey];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

/** The pricing page tab the pointer names -- pinned by test to the tab strip's own label (`PRICING_PAGE_TABS`). */
export const CALCULATOR_TAB_LABEL = "Calculator";

/** ADP-4b (owner PA1-R, 2026-10-21): what a Pricing Inputs category's tab says. The impact list has no name on screen;
 *  it opens from the count in the Data Viewer's 'items' column, so the line names that control. */
export const PRICING_INPUTS_DERIVATION_LINE =
  "Pricing Inputs hold shared numbers that other categories' rules use; no BoQ row is priced here. " +
  "On the Data Viewer, the count in a number's 'items' column shows which items it reaches.";

/**
 * ADP-4b -- PURE. The sidebar label of the pricing page whose Calculator prices this discipline, or null where none
 * does. `calculators` is the calculator's own path -> discipline map (`CALCULATOR_WORKBOOKS`), passed in by the page:
 * the panel imports this file, so importing the calculator here would close an import cycle through the panel.
 */
export function calculatorPageLabel(discipline: string, calculators: Readonly<Record<string, string>>): string | null {
  const path = Object.keys(calculators).find((p) => calculators[p] === discipline);
  return PRICING_WORKBOOKS.find((w) => w.path === path)?.label ?? null;
}

/**
 * ADP-4b (owner D8 + PA1-R) -- PURE. The one line a category with NO rules list shows instead, or null when it has one.
 * A Pricing Inputs category prices no row, so it says what it holds; any other names where its discipline prices a
 * row -- the pricing page and its Calculator tab, read from the registries, never written per discipline.
 */
export function derivationNoticeLine(config: RateCategoryConfig, calculatorPage: string | null, ruleLines: number): string | null {
  if (ruleLines > 0) return null;
  if (isPricingInputConfig(config)) return PRICING_INPUTS_DERIVATION_LINE;
  return calculatorPage
    ? `This category's rules are not listed yet. To see how a row is priced, open ${calculatorPage} -> ${CALCULATOR_TAB_LABEL}.`
    : "This category's rules are not listed yet.";
}

interface Props {
  items: RateMasterItem[];
  config: RateCategoryConfig;
  /** The sidebar label of the pricing page whose Calculator prices this discipline (`calculatorPageLabel`). */
  calculatorPage: string | null;
}

export function RateMasterDerivation({ items, config, calculatorPage }: Props) {
  // SLICE 12c / ACCEPTANCE 5: the resolution order, read from `list_spec.pricing`. PURE and unit-tested,
  // so this component stays thin over it (ADR-0010 F4); [] for a category that is not item-list.
  const ruleOrder = useMemo(() => itemListRuleOrder(config, items), [config, items]);
  // EA-4 ext-a: tolerate a config with no rules key at all (every category except the two that
  // carry one) -- an absent key renders the empty state, never a crash.
  const rules = useMemo(
    () => (Array.isArray(config.rules) ? config.rules : []),
    [config]
  );
  const notice = derivationNoticeLine(config, calculatorPage, ruleOrder.length);
  // ADP-4b (owner PA1-R): the extraction Rules card stays where the config carries rules; its empty state is dropped
  // wherever the notice line already says what this tab holds.
  const rulesCardShown = extractionRulesCardShown(config) && (rules.length > 0 || notice === null);

  return (
    <div className="space-y-4">
      {notice !== null && (
        <p className="text-sm text-muted-foreground" data-testid="rate-master-derivation-notice">{notice}</p>
      )}

      {/* SLICE 12c / ACCEPTANCE 5 (U10): HOW A ROW IS PRICED, for a category that prices a row as a
          LIST OF ITEMS. Its pipelines live inside `list_spec`, so a list of steps could not see them; the
          unit class, the kind, the block, the facts it needs, the ruled defaults and the size fitting are
          all resolved FIRST, and this list says so in order.

          ⚠️ NOT SCOPED TO ONE CATEGORY. The whole section is driven by `list_spec.pricing`, so a config
          without one renders NOTHING here -- scoping it by name would put a category id in code, which the
          standing rule forbids. */}
      {ruleOrder.length > 0 && (
        <Card data-testid="rate-master-item-list-order">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">How a row is priced</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {ruleOrder.map((r) => (
                <li key={r.n} className="flex gap-3 text-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                    {r.n}
                  </span>
                  <span>
                    {r.title}
                    {r.detail ? <span className="text-muted-foreground"> &mdash; {r.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* EA-4 ext-a: RULES -- owner-authored estimator guidance, read-only. It is the SAME text the
          extraction prompt receives verbatim, so this panel is what the config actually tells the AI,
          not a paraphrase.
          SLICE 12d-5 (owner P1, F-C5a): NOT drawn on an item-list category that declares no extraction
          rules -- its rules are the list above, and an empty card beneath it read as a contradiction. The
          decision is the pure `extractionRulesCardShown(config)`.
          ADP-4b (owner PA1-R): nor where the notice line above already says what the tab holds. */}
      {rulesCardShown && (
      <Card data-testid="rate-master-rules-panel">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules configured for this category.</p>
          ) : (
            <ul className="space-y-3">
              {rules.map((r) => (
                <li key={r.id} className="rounded border bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">{r.id}</Badge>
                    <span className="text-sm font-medium">{r.label}</span>
                    {r.applies_to && (
                      <span className="font-mono text-xs text-muted-foreground">{r.applies_to}</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{r.guidance}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
