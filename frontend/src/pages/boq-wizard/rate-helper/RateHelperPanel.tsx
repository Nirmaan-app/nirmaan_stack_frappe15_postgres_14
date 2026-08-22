/**
 * U1 rate-helper PANEL -- renders the helper CONTRACT generically (guardrail G3). One card per
 * registered helper; a no-suggestion card is greyed with its reason; a suggestion card expands to
 * the structured workings (editable attributes -> live recompute, derivation lines, a pre-filled +
 * overridable final-value field, and "Use this value"). Zero helper-specific rendering lives here,
 * so a new helper needs no panel change. Nothing persists (guardrail G2).
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { X, ChevronRight, ChevronDown, RotateCcw, Sparkles, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { resolveRateHelpers } from "./rateHelperRegistry";
import {
  attrDisplayValue,
  attrNoteText,
  isAttrBlank,
  isAttrDefaulted,
  isShowingDerived,
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

/**
 * PURE. Panel edits are ROW-SCOPED: the state carries the row it was typed on, and a read from any
 * other row (or with no row selected) yields the empty map. This is what makes the cross-row leak
 * structurally impossible rather than merely cleaned up afterwards -- there is no render in which a
 * previous row's edits are visible, so no click can bank them.
 *
 * Returning the caller's EMPTY constant (not a fresh {}) keeps the reference stable, so the
 * `evaluations` memo does not recompute on every render.
 */
export interface RowScoped<T> {
  /** The excelRow these edits were typed on; null = nothing typed yet. */
  row: number | null;
  byHelper: T;
}

export function overridesForRow<T>(state: RowScoped<T>, excelRow: number | undefined, empty: T): T {
  if (excelRow == null || state.row !== excelRow) return empty;
  return state.byHelper;
}

const EMPTY_ATTR_MAP: Record<string, Record<string, string>> = {};
const EMPTY_FINAL_MAP: Record<string, string> = {};
const EMPTY_ATTR_STATE: RowScoped<Record<string, Record<string, string>>> = { row: null, byHelper: EMPTY_ATTR_MAP };
const EMPTY_FINAL_STATE: RowScoped<Record<string, string>> = { row: null, byHelper: EMPTY_FINAL_MAP };

/**
 * SLICE 2c. PURE. Does the CURRENT row carry any panel-session edit?
 *
 * Drives the Revert button's enabled state, so a clean row never offers a control that would do
 * nothing. It reads the SAME row-scoping rule as `overridesForRow`: a state scoped to a DIFFERENT
 * row is not an edit to this one, which is why a row switch disables the button with no extra
 * bookkeeping.
 *
 * Both maps are checked because they are edited independently -- an attribute pick and a typed final
 * value are separate acts, and either alone must arm the button.
 */
export function hasSessionEdits(
  attrState: RowScoped<Record<string, Record<string, string>>>,
  finalState: RowScoped<Record<string, string>>,
  excelRow: number | undefined,
): boolean {
  if (excelRow == null) return false;
  const attrs = overridesForRow(attrState, excelRow, EMPTY_ATTR_MAP);
  const finals = overridesForRow(finalState, excelRow, EMPTY_FINAL_MAP);
  // A helper KEY may exist carrying an empty per-attribute map, so its presence is not itself an
  // edit -- look for an actual attribute entry.
  const anyAttr = Object.values(attrs).some((byAttr) => Object.keys(byAttr).length > 0);
  return anyAttr || Object.keys(finals).length > 0;
}

export function RateHelperPanel({ excelRow, col, kind, ctx, helpers, onUse, onClose, variant = "embedded" }: RateHelperPanelProps) {
  // RM-3b: a row is loaded iff we have its context. Absent => the empty-state placeholder.
  const hasSelection = ctx != null && excelRow != null && col != null && kind != null;
  // Panel-session state ONLY (never persisted): per-helper attribute edits, which card is expanded,
  // and a per-helper final-value override (undefined => track the computed value).
  // ⚠️ ROW-SCOPED, and structurally so. These edits belong to ONE ROW and must never ride along to
  // the next: the panel is a single mounted component that swaps `excelRow`, and before this fix the
  // maps were keyed by HELPER ID alone. With one helper (`pricing_sheet`) serving EVERY category,
  // an override typed on one row was re-applied to whatever row was opened next -- and to any
  // category declaring an attribute of the same id, which is why it crossed categories
  // (plate_item typed on point_wiring reached switches_sockets).
  //
  // THE HAZARD THAT MAKES IT URGENT: "Use this value" writes a rate PERMANENTLY via applyRate, and a
  // stale override changes the number shown -- so the value banked could be computed from another
  // row's attributes.
  //
  // The row is carried INSIDE the state and checked on read (see `attrOverrides` / `finalOverride`
  // below) rather than cleared by an effect. An effect would leave a window: the render after
  // `excelRow` changes but before the effect runs would still compute with the old row's edits, and
  // a click in that window would bank it. Carrying the row makes a mismatch impossible to observe.
  const [attrOverrideState, setAttrOverrideState] = useState<RowScoped<Record<string, Record<string, string>>>>(EMPTY_ATTR_STATE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [finalOverrideState, setFinalOverrideState] = useState<RowScoped<Record<string, string>>>(EMPTY_FINAL_STATE);
  // What the CURRENT row may see. A different row (or none) sees nothing -- never the previous row's.
  const attrOverrides = overridesForRow(attrOverrideState, excelRow, EMPTY_ATTR_MAP);
  const finalOverride = overridesForRow(finalOverrideState, excelRow, EMPTY_FINAL_MAP);
  // SLICE 2c: arms the Revert button. Same row-scoping rule as the two reads above.
  const sessionEdited = hasSessionEdits(attrOverrideState, finalOverrideState, excelRow);

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
    if (excelRow == null) return; // nothing selected -> nothing to scope the edit to
    setAttrOverrideState((prev) => {
      // A different row's edits are DISCARDED here, not merged -- same rule as the read.
      const base = prev.row === excelRow ? prev.byHelper : EMPTY_ATTR_MAP;
      return {
        row: excelRow,
        byHelper: { ...base, [helperId]: { ...(base[helperId] ?? {}), [attrId]: value } },
      };
    });
    // An attribute change invalidates a stale final-value override -> re-prefill from the recompute.
    setFinalOverrideState((prev) => {
      if (prev.row !== excelRow || prev.byHelper[helperId] === undefined) return prev;
      const next = { ...prev.byHelper };
      delete next[helperId];
      return { row: excelRow, byHelper: next };
    });
  };

  /**
   * SLICE 2d (B3) -- hand ONE attribute back to the pipeline.
   *
   * ⚠️ IT DELETES THE OVERRIDE; IT DOES NOT WRITE "". The two are different and 2c only got away with
   * conflating them because the one attribute that could be cleared (`paired_mcb`) is never stated by
   * extraction, so both routes landed on the same value. Everywhere else they diverge: writing ""
   * overrides the EXTRACTED value with empty and yields the COMPUTED one, while deleting the override
   * restores what extraction actually read. "Undo my edit" means the latter.
   *
   * It also drops any stale final-value override for the same reason `setAttr` does -- the recompute
   * that follows produces a different number, and banking the old one would price from a state the
   * panel is no longer showing.
   */
  const resetAttr = (helperId: string, attrId: string) => {
    if (excelRow == null) return;
    setAttrOverrideState((prev) => {
      if (prev.row !== excelRow) return prev;
      const forHelper = prev.byHelper[helperId];
      if (!forHelper || forHelper[attrId] === undefined) return prev;
      const nextForHelper = { ...forHelper };
      delete nextForHelper[attrId];
      return { row: excelRow, byHelper: { ...prev.byHelper, [helperId]: nextForHelper } };
    });
    setFinalOverrideState((prev) => {
      if (prev.row !== excelRow || prev.byHelper[helperId] === undefined) return prev;
      const next = { ...prev.byHelper };
      delete next[helperId];
      return { row: excelRow, byHelper: next };
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
                  {result.headlines && result.headlines.length > 0 ? (
                    // 2026-08-22 (owner Ruling A + C, "stacked...double height"): a helper that
                    // prices a row through more than one pipeline publishes one entry per block and
                    // they render STACKED, one line each -- label then figure. The header is taller
                    // on those rows only; every other category takes the single-figure branch below
                    // and is byte-unchanged.
                    //
                    // ⚠️ THE TWO FIGURES ARE NEVER ADDED. They are different units (the wiring case
                    // is per Mtr vs per Set), so each is rendered from its OWN entry and there is no
                    // total anywhere. An entry with no figure for this cell's rate-kind falls to the
                    // SAME em dash the single-headline branch uses -- it never borrows the other.
                    <div className="flex flex-col items-end gap-0.5">
                      {result.headlines.map((h, hi) => {
                        const hv = h.values[kind!];
                        return (
                          <div key={`${h.label}-${hi}`} className="flex items-baseline gap-1.5">
                            <span className="text-[11px] text-muted-foreground">{h.label}</span>
                            <span className="text-sm font-semibold tabular-nums">
                              {typeof hv === "number" ? hv : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-sm font-semibold tabular-nums">
                      {typeof computed === "number" ? computed : "—"}
                    </span>
                  )}
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
                        // DERIVED DISPLAY: what the field SHOWS may be the PIPELINE's value rather
                        // than the row's -- a computed face plate or paired MCB where the row stated
                        // none, or the blanker count that always wins. One pure helper decides, so
                        // this render and the tests read the identical rule. Computed BEFORE the tone
                        // because the muted tone is a function of it.
                        const shown = attrDisplayValue(a);
                        const showingDerived = isShowingDerived(a);
                        // SLICE 2c: the THIRD tone. A value the PIPELINE supplied is shown MUTED, so
                        // the field says at a glance whose number is pricing the row. The three are
                        // mutually exclusive BY CONSTRUCTION, not by this ordering: `isAttrBlank`
                        // excludes `derived`, so a computed attribute can never also be red, and
                        // `isAttrDefaulted` reads the EXTRACTION flag, which the pipeline's own value
                        // does not carry. The order is belt-and-braces, and blank stays first because
                        // a genuinely missing input is the most urgent thing on the card.
                        const fieldTone = blank
                          ? "border-red-500 dark:border-red-500"
                          : defaulted
                            ? "bg-amber-50 dark:bg-amber-950/30"
                            : showingDerived
                              ? "italic text-muted-foreground"
                              : undefined;
                        return (
                        <div key={a.id} className="group/attr space-y-0.5">
                        <label className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-1 text-muted-foreground">
                            {a.label}
                            {showingDerived && (
                              <span
                                className="text-[10px] italic"
                                title={
                                  a.readOnly
                                    ? "Computed from the assembly -- the pipeline does not read a stated value here, so this field is not editable"
                                    : "Computed from the assembly -- state a value to set a floor"
                                }
                              >
                                (computed)
                              </span>
                            )}
                            {defaulted && (
                              <span
                                className="rounded bg-amber-100 px-1 text-[9px] font-medium leading-none text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                                title="Filled from a config default -- the row text gave no positive identification"
                              >
                                default
                              </span>
                            )}
                            {attrOverrides[helper.id]?.[a.id] !== undefined && (
                              <button
                                type="button"
                                onClick={() => resetAttr(helper.id, a.id)}
                                title="Undo my edit to this field -- restores what the row supplied"
                                aria-label={`Undo my edit to ${a.label}`}
                                className="opacity-0 transition-opacity group-hover/attr:opacity-100 focus:opacity-100 focus-visible:opacity-100"
                              >
                                <RotateCcw className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                              </button>
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
                              value={shown}
                              // A fully-superseded attribute is READ-ONLY: the pipeline never reads
                              // it, so an editable control would promise an effect it cannot have.
                              disabled={a.disabled || a.readOnly}
                              onChange={(e) => setAttr(helper.id, a.id, e.target.value)}
                            >
                              {/* An EMPTY value (the AI could not read it, or a manual row) must not
                                  masquerade as the first option -- show an explicit unset placeholder
                                  so the pricer knows this attribute still needs a pick.

                                  ⚠️ THE PLACEHOLDER IS ALWAYS SELECTABLE (owner ruling R9, 2026-08-19).
                                  This SUPERSEDES the slice-2c rule that it stayed `disabled` for a
                                  genuine input. Two reasons, and the first is not a preference:

                                  1. A CONTROLLED <select> WITH NO MATCHING OPTION FALLS BACK TO THE
                                     FIRST *SELECTABLE* OPTION -- it does NOT go blank. React sets
                                     `option.selected = (option.value === props.value)` per option
                                     rather than assigning `.value`, so when nothing matches every
                                     option ends unselected and the browser must still show something.
                                     With the placeholder disabled it was skipped, and the field
                                     displayed the first REAL catalog value -- a number the row never
                                     stated, beside a derivation line naming the real one. Measured on
                                     live data at slice 4: 12 rows across conduit_piping, wiring_cabling
                                     and cabletray_raceway (the tray six predate slice 4 -- this shipped
                                     latent with 3b). For an `allow_none` def it was worse still: the
                                     fallback was the "None" SENTINEL, a positive decision the row never
                                     made. Making the placeholder selectable is what makes blank BLANK.
                                  2. Owner: "the user can edit the value all the time whether it is
                                     blank or it matches something from catalog. the user is the
                                     ultimate authority."

                                  Selecting it calls setAttr(id, ""), which overrides with empty ->
                                  `coerceForMatch` returns null -> the row is gated incomplete, exactly
                                  as if the attribute had never been filled. For a DERIVED attribute
                                  that hands the field back to the pipeline, which is what 2c wanted
                                  all along; for a genuine input blank IS incomplete, and the red
                                  border plus "Complete the missing attributes to price" say so. */}
                              <option value="">
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
                              {a.allowNone && !a.readOnly && (
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
                                value={shown === "None" ? "" : shown}
                                // READ-ONLY, not disabled: the value is real and worth reading (and
                                // copying) -- greying it out would read as "positively absent", which
                                // is a DIFFERENT state this panel already renders that way.
                                readOnly={a.readOnly}
                                disabled={a.disabled || shown === "None"}
                                onChange={(e) => setAttr(helper.id, a.id, e.target.value)}
                              />
                            </span>
                          )}
                        </label>
                        {/* Everything the pipeline must SAY about this field, in the declared
                            ATTR_NOTE_ORDER. Two meanings live here and they are NOT interchangeable:
                            an override (the field shows one thing and the row prices another -- say
                            so, or it just looks like the pricer was ignored) and a CONSEQUENCE of a
                            value that WAS honoured. The panel renders the sentence a note words for
                            itself; it never decides which meaning applies. The trace carries the same
                            facts -- but a pricer may never open it. */}
                        {a.notes?.map((n, ni) => (
                          <p
                            key={`${n.kind}-${ni}`}
                            className="pl-1 text-[10px] leading-tight text-amber-700 dark:text-amber-400"
                          >
                            {attrNoteText(n)}
                          </p>
                        ))}
                        </div>
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
                        setFinalOverrideState((prev) => ({
                          row: excelRow!,
                          byHelper: {
                            ...(prev.row === excelRow ? prev.byHelper : EMPTY_FINAL_MAP),
                            [helper.id]: e.target.value,
                          },
                        }))
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
                    {/* SLICE 2c -- REVERT TO SUGGESTION. Two resets, and nothing else.
                        This works because the SUGGESTION IS NEVER MUTATED: `ctx` is the source and
                        the overrides are a separate map layered on read, so discarding them re-derives
                        the full suggested calculation with no snapshot to keep and nothing to restore.
                        Deliberately NOT touched: `expanded` (which card is open is navigation, not a
                        value -- collapsing on revert would be a surprise), `panelWidth` (a persisted
                        layout preference), and every SAVED cell price, which stays behind the explicit
                        "Use this value" click. Other rows are unreachable by construction: the state
                        holds ONE row, so a reset cannot touch edits that are not stored. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      disabled={!sessionEdited}
                      title={
                        sessionEdited
                          ? "Discard your edits on this row and show the suggested calculation again"
                          : "No edits to discard on this row"
                      }
                      onClick={() => {
                        setAttrOverrideState(EMPTY_ATTR_STATE);
                        setFinalOverrideState(EMPTY_FINAL_STATE);
                      }}
                    >
                      Revert
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
