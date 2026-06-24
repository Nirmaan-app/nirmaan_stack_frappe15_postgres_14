/**
 * AmountFormulaBuilder -- the click-to-insert amount-formula editor (BoQ Phase 5 Formula
 * Builder F3).
 *
 * A per-amount-column popover (shadcn Popover, matching the ColorPicker / RemarkCell house
 * style) that lets the user ASSEMBLE a formula by clicking the sheet's REAL columns + operators
 * -- NO free text, NO numeric literals (there is no number input, so literals are barred by
 * construction). It validates live (parseTokens + the F2-reusing wouldCreateCycle), and SAVES
 * via the page's onSave (-> save_amount_formula). It ALSO renders the header `f = ...` label.
 *
 * F3 does NOT wire the formula into the grid's amount COMPUTE path -- amount cells still render
 * via the existing findPairedRateDescriptor path until F4. This component only AUTHORS the
 * formula + shows it on the header.
 *
 * READ-ONLY (locked sheet / takeover / general-specs): when `onSave` is withheld the label
 * renders as static text (no popover, no editor) -- the same callback-presence gate rates /
 * annotations use.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getFrappeError } from "@/utils/frappeErrors";
import { ROLE_LABELS } from "./boqTypes";
import { pickFormula } from "./amountFormula";
import {
  OPERAND_VALUE_FIELDS,
  parseTokens,
  refKey,
  tokenRefForMode,
  treeToTokens,
  wouldCreateCycle,
  type FormulaToken,
} from "./formulaTokens";
import type {
  AmountFormulaRef,
  AmountFormulaSaveArgs,
  ColumnDescriptor,
  ColumnFormula,
} from "./boqTypes";

// Pure-ASCII source; the glyphs render correctly.
const FN = "ƒ"; // the function mark used on the header label (f-hook)
const MUL = "×"; // the multiply glyph

const AREA_BOUND_VALUE_FIELDS = new Set(["qty_by_area", "rate_by_area", "amount_by_area"]);

type Mode = "default" | "override";

/** A short single-line text rendering of a token list (header preview + a11y title). */
export function tokensToText(tokens: FormulaToken[]): string {
  return tokens
    .map((t) =>
      t.kind === "column" ? t.label
        : t.kind === "op" ? (t.op === "*" ? MUL : "+")
        : t.kind === "lparen" ? "(" : ")",
    )
    .join(" ");
}

interface AmountFormulaBuilderProps {
  /** The concrete amount column this header governs. */
  target: ColumnDescriptor;
  /** Human label for the column (header text), used as the dialog title + the save description guard. */
  columnLabel: string;
  /** All sheet descriptors -- the operand palette is filtered out of these (qty/rate/amount). */
  descriptors: ColumnDescriptor[];
  /** Current per-column formulas (get_priced_rows.column_formulas) -- for the header preview,
   *  builder hydration, and the cycle check. */
  columnFormulas: ColumnFormula[];
  /** Save one column formula (null formula = clear). Withheld (undefined) when the sheet is
   *  locked/taken-over -> the label renders read-only. */
  onSave?: (args: AmountFormulaSaveArgs) => Promise<void>;
}

export function AmountFormulaBuilder({
  target,
  columnLabel,
  descriptors,
  columnFormulas,
  onSave,
}: AmountFormulaBuilderProps) {
  const [open, setOpen] = useState(false);
  // A per-area target offers the DEFAULT (all areas) vs THIS-AREA override toggle; a scalar
  // amount column has no area dimension, so the toggle is hidden and the mode is always default.
  const targetIsPerArea = target.value_field === "amount_by_area" && target.value_key != null;
  const [mode, setMode] = useState<Mode>("default");
  const effectiveMode: Mode = targetIsPerArea ? mode : "default";

  const [tokens, setTokens] = useState<FormulaToken[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve a ref to a display label from the descriptor set. A wildcard (area-bound, value_key
  // null) matches by (value_field, rate_subkey) ignoring area and shows no area.
  const labelFor = (r: AmountFormulaRef): string => {
    const isWildcard = r.value_key === null && AREA_BOUND_VALUE_FIELDS.has(r.value_field);
    const match = descriptors.find(
      (d) =>
        d.value_field === r.value_field &&
        d.rate_subkey === r.rate_subkey &&
        (isWildcard || d.value_key === r.value_key),
    );
    if (match) {
      const role = ROLE_LABELS[match.role] ?? match.role;
      return !isWildcard && match.area ? `${role} · ${match.area}` : role;
    }
    return r.rate_subkey ? `${r.value_field} (${r.rate_subkey})` : r.value_field;
  };

  // The SAVE target identity (the value_key the backend stores: null for a default/scalar, the
  // concrete area for an override).
  const saveValueKey = targetIsPerArea && mode === "override" ? target.value_key : null;
  const saveTargetRef: AmountFormulaRef = {
    value_field: target.value_field,
    value_key: saveValueKey,
    rate_subkey: target.rate_subkey,
  };

  // The existing formula for the current mode (default -> null-key; override -> this-area key).
  const existingForMode =
    columnFormulas.find(
      (f) =>
        f.target_value_field === target.value_field &&
        f.target_rate_subkey === target.rate_subkey &&
        f.target_value_key === saveValueKey,
    ) ?? null;

  // The formula that APPLIES to this concrete column (override > default) -- drives the header
  // label + sublabel. Reuses F2's precedence so the header never diverges from eval.
  const applicable = pickFormula(
    { value_field: target.value_field, value_key: target.value_key, rate_subkey: target.rate_subkey },
    columnFormulas,
  );

  // Hydrate the token list from the existing formula whenever the popover opens or the mode
  // flips (each mode has its own stored formula). Keyed on [open, effectiveMode].
  useEffect(() => {
    if (!open) return;
    setError(null);
    setTokens(existingForMode?.formula ? treeToTokens(existingForMode.formula, labelFor) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effectiveMode]);

  // ── live validity ────────────────────────────────────────────────────────
  const parsed = parseTokens(tokens);
  const cyclic = parsed.ok && wouldCreateCycle(saveTargetRef, parsed.tree, columnFormulas);
  const wellFormed = parsed.ok && !cyclic;

  // ── token edits ──────────────────────────────────────────────────────────
  const insert = (t: FormulaToken) => setTokens((prev) => [...prev, t]);
  const backspace = () => setTokens((prev) => prev.slice(0, -1));
  const reset = () => setTokens([]);

  // ── the operand palette (qty / rate / amount columns) ────────────────────
  // DEFAULT mode collapses per-area duplicates to one WILDCARD chip per logical column; the
  // literal self-ref is blocked (amount-refs-OTHER-amount stays allowed).
  const selfKey = refKey(tokenRefForMode(target, effectiveMode));
  const seen = new Set<string>();
  const palette: { ref: AmountFormulaRef; label: string; group: string }[] = [];
  for (const d of descriptors) {
    if (!OPERAND_VALUE_FIELDS.has(d.value_field)) continue;
    const r = tokenRefForMode(d, effectiveMode);
    const k = refKey(r);
    if (k === selfKey) continue; // block the trivial self-reference
    if (seen.has(k)) continue; // dedupe (wildcards collapse areas in default mode)
    seen.add(k);
    const group = d.value_field.startsWith("qty")
      ? "Quantity"
      : d.value_field.startsWith("rate")
        ? "Rate"
        : "Amount";
    palette.push({ ref: r, label: labelFor(r), group });
  }
  const paletteByGroup = (g: string) => palette.filter((p) => p.group === g);

  // ── save / clear ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!onSave || !parsed.ok || cyclic) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        targetValueField: target.value_field,
        targetValueKey: saveValueKey,
        targetRateSubkey: target.rate_subkey,
        targetCol: target.col,
        description: columnLabel,
        formula: parsed.tree,
      });
      setOpen(false);
    } catch (e: unknown) {
      setError(getFrappeError(e) || "Could not save the formula.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!onSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        targetValueField: target.value_field,
        targetValueKey: saveValueKey,
        targetRateSubkey: target.rate_subkey,
        targetCol: target.col,
        description: columnLabel,
        formula: null, // the F1 clear path
      });
      setOpen(false);
    } catch (e: unknown) {
      setError(getFrappeError(e) || "Could not remove the formula.");
    } finally {
      setSaving(false);
    }
  };

  // ── the leading ƒ STATUS BADGE (the trigger) ──────────────────────────────
  // Status + action merged into ONE compact control at the START of the amount column header:
  // GREEN when a formula resolves for this column (covered), AMBER when none (pending). `covered`
  // keys on the SAME `applicable = pickFormula(target, columnFormulas)` resolution this component
  // already computed (:132) -- the SAME predicate the gate (priceability.areFormulasComplete via
  // isAmountColumnCovered) and the amount-cell eval use -- so the badge can NEVER disagree with
  // the gate. The badge IS the PopoverTrigger: clicking it opens the SAME builder popover (all
  // builder logic / onSave / validation / cycle-check UNCHANGED). The old far-right preview line
  // is REMOVED -- the popover shows the full formula; a tokensToText preview rides the badge title.
  const covered = !!(applicable && applicable.formula);
  const applicablePreview = applicable?.formula
    ? tokensToText(treeToTokens(applicable.formula, labelFor))
    : null;
  const badgeTitle = covered ? `${FN} = ${applicablePreview}` : "No amount formula yet";
  const badgeClass = cn(
    "inline-flex h-4 min-w-[1rem] items-center justify-center rounded border px-0.5 text-[10px] font-semibold leading-none shrink-0",
    covered
      ? "border-green-400 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/50 dark:text-green-300"
      : "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  );

  // READ-ONLY (locked / general-specs / taken-over): a STATIC status glyph -- no popover, no
  // editor. Status stays visible (amber/green); editing is gated by onSave exactly as before.
  if (!onSave) {
    return (
      <span
        className={badgeClass}
        title={badgeTitle}
        aria-label={covered ? "Amount formula set" : "No amount formula"}
      >
        {FN}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(badgeClass, "hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-ring")}
          title={covered ? badgeTitle : "Declare this column's amount formula"}
          aria-label={covered ? "Edit amount formula" : "Declare amount formula"}
        >
          {FN}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[22rem] p-3"
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">Formula for {columnLabel}</p>
            <p className="text-[10px] text-muted-foreground">Click columns and operators to build it.</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* DEFAULT / THIS-AREA toggle (per-area columns only) */}
        {targetIsPerArea && (
          <div className="mb-2 flex rounded-md border border-border overflow-hidden w-full text-[11px]">
            <button
              type="button"
              onClick={() => setMode("default")}
              className={cn("flex-1 px-2 py-1", mode === "default" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              Default (all areas)
            </button>
            <button
              type="button"
              onClick={() => setMode("override")}
              className={cn("flex-1 px-2 py-1", mode === "override" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              This area only{target.value_key ? ` (${target.value_key})` : ""}
            </button>
          </div>
        )}

        {/* LIVE PREVIEW strip */}
        <div className="mb-1 min-h-[2.25rem] rounded-md border border-border bg-muted/30 p-1.5 flex flex-wrap items-center gap-1">
          {tokens.length === 0 ? (
            <span className="text-[11px] italic text-muted-foreground">empty</span>
          ) : (
            tokens.map((t, i) =>
              t.kind === "column" ? (
                <span
                  key={i}
                  className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                >
                  {t.label}
                </span>
              ) : (
                <span key={i} className="px-0.5 text-[12px] font-medium text-foreground">
                  {t.kind === "op" ? (t.op === "*" ? MUL : "+") : t.kind === "lparen" ? "(" : ")"}
                </span>
              ),
            )
          )}
          <span aria-hidden className="ml-0.5 h-3.5 w-px animate-pulse bg-foreground/50" />
        </div>

        {/* Validity line */}
        <p
          className={cn(
            "mb-2 text-[11px]",
            tokens.length === 0
              ? "text-muted-foreground"
              : wellFormed
                ? "text-green-700 dark:text-green-400"
                : "text-destructive",
          )}
        >
          {tokens.length === 0
            ? "Add at least one column."
            : cyclic
              ? "Circular reference -- a formula can't depend on itself."
              : parsed.ok
                ? "Well-formed."
                : parsed.error}
        </p>

        {/* Operators + backspace */}
        <div className="mb-2 flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => insert({ kind: "op", op: "+" })}>
            +
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => insert({ kind: "op", op: "*" })}>
            {MUL}
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => insert({ kind: "lparen" })}>
            (
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => insert({ kind: "rparen" })}>
            )
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-xs"
            disabled={tokens.length === 0}
            onClick={backspace}
          >
            Backspace
          </Button>
        </div>

        {/* Column palette */}
        <div className="mb-2 max-h-44 overflow-auto rounded-md border border-border p-1.5">
          {["Quantity", "Rate", "Amount"].map((g) => {
            const items = paletteByGroup(g);
            if (items.length === 0) return null;
            return (
              <div key={g} className="mb-1.5 last:mb-0">
                <p className="mb-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{g}</p>
                <div className="flex flex-wrap gap-1">
                  {items.map((p) => (
                    <button
                      key={refKey(p.ref)}
                      type="button"
                      onClick={() => insert({ kind: "column", ref: p.ref, label: p.label })}
                      className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {palette.length === 0 && (
            <p className="text-[11px] italic text-muted-foreground">No operand columns on this sheet.</p>
          )}
        </div>

        {error && <p className="mb-2 text-[11px] text-destructive">{error}</p>}

        {/* Footer: Reset (local) | Remove (commit blank, if a saved formula exists) | Save */}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving || tokens.length === 0} onClick={reset}>
            Reset
          </Button>
          {existingForMode && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" disabled={saving} onClick={handleRemove}>
              Remove
            </Button>
          )}
          <Button size="sm" className="ml-auto h-7 px-3 text-xs" disabled={saving || !wellFormed} onClick={handleSave}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
