/**
 * U1 rate-helper PANEL -- renders the helper CONTRACT generically (guardrail G3). One card per
 * registered helper; a no-suggestion card is greyed with its reason; a suggestion card expands to
 * the structured workings (editable attributes -> live recompute, derivation lines, a pre-filled +
 * overridable final-value field, and "Use this value"). Zero helper-specific rendering lives here,
 * so a new helper needs no panel change. Nothing persists (guardrail G2).
 */
import { useMemo, useState } from "react";
import { X, ChevronRight, ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveRateHelpers } from "./rateHelperRegistry";
import { isSuggestion, type RateHelperRowContext } from "./rateHelperTypes";

const KIND_LABELS: Record<string, string> = {
  supply_rate: "Supply",
  install_rate: "Install",
  combined_rate: "Combined",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

interface RateHelperPanelProps {
  excelRow: number;
  /** The clicked rate cell's Excel column letter -- the Use write target. */
  col: string;
  /** The clicked cell's rate-kind (the panel is scoped to this kind). */
  kind: string;
  ctx: RateHelperRowContext;
  /** Apply a value to the (excelRow, col) rate cell through the real save path. */
  onUse: (col: string, value: number) => void;
  onClose: () => void;
}

export function RateHelperPanel({ excelRow, col, kind, ctx, onUse, onClose }: RateHelperPanelProps) {
  // Panel-session state ONLY (never persisted): per-helper attribute edits, which card is expanded,
  // and a per-helper final-value override (undefined => track the computed value).
  const [attrOverrides, setAttrOverrides] = useState<Record<string, Record<string, string>>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [finalOverride, setFinalOverride] = useState<Record<string, string>>({});

  const evaluations = useMemo(
    () => resolveRateHelpers(ctx, attrOverrides),
    [ctx, attrOverrides],
  );

  const setAttr = (helperId: string, attrId: string, value: string) => {
    setAttrOverrides((prev) => ({
      ...prev,
      [helperId]: { ...(prev[helperId] ?? {}), [attrId]: value },
    }));
    // An attribute change invalidates a stale final-value override -> re-prefill from the recompute.
    setFinalOverride((prev) => {
      if (prev[helperId] === undefined) return prev;
      const next = { ...prev };
      delete next[helperId];
      return next;
    });
  };

  return (
    <aside
      className="flex w-80 shrink-0 flex-col rounded-md border bg-background"
      aria-label="Rate suggestions"
    >
      <header className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>Rate suggestions</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted"
          aria-label="Close suggestions"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">
        Row {excelRow} &middot; {kindLabel(kind)} rate
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {evaluations.map(({ helper, result }) => {
          const isOpen = expanded === helper.id;
          if (!isSuggestion(result)) {
            return (
              <div
                key={helper.id}
                className="rounded-md border bg-muted/40 px-3 py-2 opacity-70"
              >
                <div className="text-sm font-medium text-muted-foreground">{helper.label}</div>
                <div className="text-xs text-muted-foreground">{result.reason}</div>
              </div>
            );
          }
          const computed = result.values[kind];
          const finalStr =
            finalOverride[helper.id] ?? (typeof computed === "number" ? String(computed) : "");
          const finalNum = Number.parseFloat(finalStr);
          const canUse = Number.isFinite(finalNum);
          return (
            <div key={helper.id} className="rounded-md border">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : helper.id)}
                className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{helper.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{result.basis}</div>
                </div>
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <span className="text-sm font-semibold tabular-nums">
                    {typeof computed === "number" ? computed : "—"}
                  </span>
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="space-y-2 border-t px-3 py-2">
                  {result.workings.attributes.length > 0 && (
                    <div className="space-y-1.5">
                      {result.workings.attributes.map((a) => (
                        <label key={a.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-muted-foreground">{a.label}</span>
                          {a.options ? (
                            <select
                              className="h-7 rounded border bg-background px-1 text-xs"
                              value={a.value}
                              onChange={(e) => setAttr(helper.id, a.id, e.target.value)}
                            >
                              {a.options.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              className="h-7 w-28 text-xs"
                              value={a.value}
                              onChange={(e) => setAttr(helper.id, a.id, e.target.value)}
                            />
                          )}
                        </label>
                      ))}
                    </div>
                  )}

                  {result.workings.matchedRows.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {result.workings.matchedRows.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  )}
                  {result.workings.derivation.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {result.workings.derivation.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      className="h-8 w-28 text-sm"
                      inputMode="decimal"
                      value={finalStr}
                      onChange={(e) =>
                        setFinalOverride((prev) => ({ ...prev, [helper.id]: e.target.value }))
                      }
                      aria-label="Final value"
                    />
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={!canUse}
                      onClick={() => onUse(col, finalNum)}
                    >
                      Use this value
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
