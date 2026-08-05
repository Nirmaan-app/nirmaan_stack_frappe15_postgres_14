/**
 * U1 rate-helper PANEL -- renders the helper CONTRACT generically (guardrail G3). One card per
 * registered helper; a no-suggestion card is greyed with its reason; a suggestion card expands to
 * the structured workings (editable attributes -> live recompute, derivation lines, a pre-filled +
 * overridable final-value field, and "Use this value"). Zero helper-specific rendering lives here,
 * so a new helper needs no panel change. Nothing persists (guardrail G2).
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { X, ChevronRight, ChevronDown, Sparkles, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { resolveRateHelpers } from "./rateHelperRegistry";
import {
  isAttrBlank,
  isAttrDefaulted,
  isSuggestion,
  type RateHelper,
  type RateHelperRowContext,
} from "./rateHelperTypes";

// RM-3c item B: the FULL-SCREEN panel is a resizable PUSH panel (occupies real layout width, narrows
// the grid). Width persists per-user across sessions. The default is meaningfully below the RM-3a
// overlay drawer's 320px so the grid gets more room; min is the readable floor, max is 50% of the
// wrapper (computed live). Arrow keys nudge by PANEL_RESIZE_STEP.
const PANEL_WIDTH_STORAGE_KEY = "nirmaan-rate-helper-panel-w";
const DEFAULT_PANEL_WIDTH = 300;
const MIN_PANEL_WIDTH = 280;
const PANEL_RESIZE_STEP = 16;

function readStoredPanelWidth(): number {
  try {
    const raw = Number(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
    return Number.isFinite(raw) && raw >= MIN_PANEL_WIDTH ? raw : DEFAULT_PANEL_WIDTH;
  } catch {
    return DEFAULT_PANEL_WIDTH;
  }
}

/** Telemetry + write payload the page needs when a suggested value is used. */
export interface UseMeta {
  helperId: string;
  kind: string;
  /** The attribute values as used (after any manual correction in the panel). */
  correctedAttributes: Record<string, string>;
  /** The interpreter-computed value for this kind (before any manual final override). */
  computedValue: number | null;
}

const KIND_LABELS: Record<string, string> = {
  supply_rate: "Supply",
  install_rate: "Install",
  combined_rate: "Combined",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

interface RateHelperPanelProps {
  /** RM-3b: OPTIONAL -- absent => the empty-state placeholder (embedded panel-as-default, no row
   * selected yet). Present together (excelRow + col + kind + ctx) => a row is loaded. */
  excelRow?: number;
  /** The clicked rate cell's Excel column letter -- the Use write target. */
  col?: string;
  /** The clicked cell's rate-kind (the panel is scoped to this kind). */
  kind?: string;
  ctx?: RateHelperRowContext;
  /** The page-built helper list (real pricing-sheet helper prepended); default = the static two. */
  helpers?: RateHelper[];
  /** Apply a value to the (excelRow, col) rate cell through the real save path + record telemetry. */
  onUse: (col: string, value: number, meta: UseMeta) => void;
  onClose: () => void;
  /** Two-mode mount. `push` (RM-3c, full-screen) = an IN-FLOW resizable panel that occupies real layout
   * width at the right of the full-screen flex row, narrowing the grid (supersedes the RM-3a fixed
   * overlay drawer); it keeps a close X and has a left-edge drag handle. `embedded` (default) = the
   * RM-3b ALWAYS-MOUNTED sticky in-flow panel-as-default -- no close X, an empty-state card until a row
   * is selected. */
  variant?: "embedded" | "push";
}

export function RateHelperPanel({ excelRow, col, kind, ctx, helpers, onUse, onClose, variant = "embedded" }: RateHelperPanelProps) {
  // RM-3b: a row is loaded iff we have its context. Absent => the empty-state placeholder.
  const hasSelection = ctx != null && excelRow != null && col != null && kind != null;
  // Panel-session state ONLY (never persisted): per-helper attribute edits, which card is expanded,
  // and a per-helper final-value override (undefined => track the computed value).
  const [attrOverrides, setAttrOverrides] = useState<Record<string, Record<string, string>>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [finalOverride, setFinalOverride] = useState<Record<string, string>>({});

  // Defect 1c: scroll-into-view GUARD on open / when the target cell changes -- but ONLY when the
  // panel is genuinely off-screen. A sticky embedded panel deep in a scrolled sheet is already pinned
  // at the viewport top (so this no-ops and never yanks the user away from the clicked row), and the
  // overlay drawer is viewport-fixed (always visible). We never touch horizontal scroll.
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!hasSelection) return; // empty state never scrolls the page
    const el = asideRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const outOfView = r.bottom <= 0 || r.top >= window.innerHeight;
    if (outOfView) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [excelRow, col, hasSelection]);

  const evaluations = useMemo(
    () => (ctx ? resolveRateHelpers(ctx, attrOverrides, helpers) : []),
    [ctx, attrOverrides, helpers],
  );

  // RM-3c item B: PUSH-panel width (persisted across sessions). Only meaningful for variant="push";
  // the embedded panel keeps its fixed w-80. The width drives the panel's own box; the grid (a flex
  // sibling with flex-1) narrows automatically, so no width prop crosses to the grid.
  const isPush = variant === "push";
  const [panelWidth, setPanelWidth] = useState<number>(() =>
    variant === "push" ? readStoredPanelWidth() : DEFAULT_PANEL_WIDTH,
  );
  useEffect(() => {
    if (!isPush) return;
    try {
      localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(panelWidth));
    } catch {
      /* storage unavailable -- width simply is not persisted */
    }
  }, [isPush, panelWidth]);
  // Clamp to [MIN, 50% of the wrapper]. The wrapper is the panel's parent (the full-screen flex row).
  const clampWidth = (w: number) => {
    const parentW = asideRef.current?.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
    const maxW = Math.max(MIN_PANEL_WIDTH, Math.floor(parentW * 0.5));
    return Math.max(MIN_PANEL_WIDTH, Math.min(maxW, Math.round(w)));
  };
  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const onMove = (ev: globalThis.MouseEvent) => {
      const right = asideRef.current?.getBoundingClientRect().right ?? window.innerWidth;
      setPanelWidth(clampWidth(right - ev.clientX)); // handle is the LEFT edge; drag left => wider
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const onHandleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPanelWidth((w) => clampWidth(w + PANEL_RESIZE_STEP)); // wider
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPanelWidth((w) => clampWidth(w - PANEL_RESIZE_STEP)); // narrower
    }
  };

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
      ref={asideRef}
      className={cn(
        "flex flex-col bg-background",
        isPush
          ? // RM-3c full-screen: an IN-FLOW push panel -- a flex sibling of the grid, so it occupies
            // real width and the grid narrows by exactly this width. `relative` anchors the left-edge
            // drag handle; `min-h-0` lets the body scroll within the flex row's height.
            "relative shrink-0 min-h-0 border-l"
          : // Embedded: an in-flow sticky panel that rides the viewport, fixed w-80, bounded so its
            // body scrolls internally rather than growing the page.
            "w-80 sticky top-4 max-h-[calc(100vh-2rem)] shrink-0 self-start rounded-md border shadow-lg",
      )}
      style={isPush ? { width: `${panelWidth}px` } : undefined}
      aria-label="Rate suggestions"
    >
      {isPush && (
        // RM-3c: left-edge DRAG HANDLE -- drag resizes live (clamp 280..50%), double-click resets to
        // the default, Arrow keys nudge (focusable; no mouse-only trap).
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize suggestions panel"
          aria-valuenow={panelWidth}
          aria-valuemin={MIN_PANEL_WIDTH}
          tabIndex={0}
          onMouseDown={startResize}
          onDoubleClick={() => setPanelWidth(clampWidth(DEFAULT_PANEL_WIDTH))}
          onKeyDown={onHandleKeyDown}
          className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none bg-border/40 hover:bg-primary/40 focus:bg-primary/50 focus:outline-none"
        />
      )}
      <header className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>Rate suggestions</span>
        </div>
        {/* RM-3b: the embedded panel is always mounted (panel-as-default) -- no close X. Only the
            full-screen PUSH panel keeps a close affordance. */}
        {isPush && (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            aria-label="Close suggestions"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>
      {hasSelection && (
        <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">
          Row {excelRow} &middot; {kindLabel(kind!)} rate
        </div>
      )}

      {!hasSelection && (
        // RM-3b empty state (embedded panel-as-default): a quiet placeholder until a row is picked.
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
            Click a suggestion badge or the sparkle on a rate cell to load that row.
          </div>
        </div>
      )}

      {hasSelection && (
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
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
          const computed = result.values[kind!]; // non-null: this block only renders with a selection
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
                      {result.workings.attributes.map((a) => {
                        // U2: the three-way state. BLANK -> red border (needs filling); DEFAULTED ->
                        // the grid's established amber attention token (filled from a config default,
                        // worth checking). A POSITIVELY-ABSENT attribute ("None", or disabled because
                        // its controller is None) gets NEITHER -- that is a decision, not a gap.
                        // Both clear on their own: setAttr writes an override, the helper recomputes,
                        // the value goes non-empty and the defaulted mark is dropped at source. There
                        // is deliberately NO highlight state held here to outlive the correction.
                        const blank = isAttrBlank(a);
                        const defaulted = isAttrDefaulted(a);
                        const fieldTone = blank
                          ? "border-red-500 dark:border-red-500"
                          : defaulted
                            ? "bg-amber-50 dark:bg-amber-950/30"
                            : undefined;
                        return (
                        <label key={a.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-1 text-muted-foreground">
                            {a.label}
                            {defaulted && (
                              <span
                                className="rounded bg-amber-100 px-1 text-[9px] font-medium leading-none text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                                title="Filled from a config default -- the row text gave no positive identification"
                              >
                                default
                              </span>
                            )}
                            {typeof a.confidence === "number" && (
                              <span className="tabular-nums text-[10px] opacity-70">
                                {Math.round(a.confidence * 100)}%
                              </span>
                            )}
                            {a.corroborated && (
                              <CheckCircle2
                                className="h-3 w-3 text-emerald-600 dark:text-emerald-400"
                                aria-label="corroborated by pattern"
                              />
                            )}
                          </span>
                          {a.options ? (
                            <select
                              // EA-4a-r: disabled = greyed (an allow_none controller is set to "None").
                              className={cn(
                                "h-7 rounded border bg-background px-1 text-xs disabled:opacity-50",
                                fieldTone,
                              )}
                              value={a.value}
                              disabled={a.disabled}
                              onChange={(e) => setAttr(helper.id, a.id, e.target.value)}
                            >
                              {/* An EMPTY value (the AI could not read it, or a manual row) must not
                                  masquerade as the first option -- show an explicit unset placeholder
                                  so the pricer knows this attribute still needs a pick. */}
                              <option value="" disabled>
                                — select —
                              </option>
                              {a.options.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="flex items-center gap-1">
                              {/* EA-4a-r: a NUMBER allow_none def offers "None" (positive absence) as a
                                  checkbox -- the input-appropriate analogue of a choice def's top-of-list
                                  "None". Checked -> the sentinel + the numeric field greys/clears. */}
                              {a.allowNone && (
                                <label className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                  <input
                                    type="checkbox"
                                    checked={a.value === "None"}
                                    onChange={(e) => setAttr(helper.id, a.id, e.target.checked ? "None" : "")}
                                  />
                                  None
                                </label>
                              )}
                              <Input
                                className={cn("h-7 w-28 text-xs disabled:opacity-50", fieldTone)}
                                value={a.value === "None" ? "" : a.value}
                                disabled={a.disabled || a.value === "None"}
                                onChange={(e) => setAttr(helper.id, a.id, e.target.value)}
                              />
                            </span>
                          )}
                        </label>
                        );
                      })}
                    </div>
                  )}

                  {result.workings.sections && result.workings.sections.length > 0 ? (
                    // RM-3a: LABELLED groups -- each rendered as its OWN separated block (header +
                    // card/divider + own derivation lines + own final values), so a cable row's
                    // Cable and Termination workings read as visually distinct sections. The shared
                    // EXTRACTED attributes already render ONCE above (they belong to the row, not a
                    // group). ABSENT `sections` => the flat rendering below, byte-identical to before.
                    <div className="space-y-1.5">
                      {result.workings.sections.map((g, gi) => (
                        <div key={gi} className="rounded-md border bg-muted/30 px-2 py-1.5">
                          <div className="text-xs font-semibold text-foreground">{g.label}</div>
                          {g.matchedRows && g.matchedRows.length > 0 && (
                            <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                              {g.matchedRows.map((m, i) => (
                                <li key={i}>{m}</li>
                              ))}
                            </ul>
                          )}
                          {g.derivation.length > 0 && (
                            <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                              {g.derivation.map((line, i) => (
                                <li key={i}>{line}</li>
                              ))}
                            </ul>
                          )}
                          {Object.keys(g.finals).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                              {Object.entries(g.finals).map(([k, v]) => (
                                <span key={k} className="tabular-nums">
                                  <span className="text-muted-foreground">{k}</span>{" "}
                                  <span className="font-semibold text-foreground">{v}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
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
                    </>
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
                      onClick={() =>
                        onUse(col!, finalNum, {
                          helperId: helper.id,
                          kind: kind!,
                          correctedAttributes: Object.fromEntries(
                            result.workings.attributes.map((a) => [a.id, a.value]),
                          ),
                          computedValue: typeof computed === "number" ? computed : null,
                        })
                      }
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
      )}
    </aside>
  );
}
