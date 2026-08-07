/**
 * MarginFormulaBuilder -- the ONE % Margin formula dialog (BCS-S11b).
 *
 * % Margin is a RATIO with two independently choosable operands:
 *
 *     ( 1  −  COST / AMOUNT )  ×  100
 *
 * BCS-S11 first shipped this as TWO separate ƒ badges on the header, one per operand. That was
 * wrong for the reason the owner gave immediately: they are not two formulas, they are two
 * halves of ONE rule, and splitting them made the rule itself invisible -- you could edit a
 * denominator without ever seeing what it was the denominator OF. This component shows the whole
 * expression with both slots live inside it, and saves them together.
 *
 * ⚠️ THE WRAPPER IS RENDERED, NOT EDITABLE, AND THAT IS STRUCTURAL RATHER THAN CAUTIOUS.
 * The `1` and the `100` are NUMERIC LITERALS, and this formula system has no literal token at
 * all: there is no number button, and the server rejects a `literal` node outright ("Numeric
 * literals are not allowed in a formula"). That rule exists so nobody writes
 * `Total Quantity × 450` in place of a rate reference, and it is not worth relaxing for one
 * cell. So `(1 − … / …) × 100` is simply inexpressible as tokens and lives in
 * `bcsColumns.bcsMarginPercent` -- which is ALSO where the three guards live (zero denominator,
 * non-finite, and a NEGATIVE denominator, which would otherwise render a loss as a positive
 * margin). Keeping the wrapper in code is what keeps those guards unbypassable.
 *
 * Each slot is a self-contained editor (token strip + operators + its own palette) because the
 * two palettes are disjoint: the cost side may name BCS figures only, the amount side the
 * sheet's Amount columns only. The server enforces both directions independently.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getFrappeError } from "@/utils/frappeErrors";
import { OP_BUTTONS, OP_GLYPH } from "./AmountFormulaBuilder";
import {
  parseTokens,
  refKey,
  treeToTokens,
  type FormulaToken,
} from "./formulaTokens";
import type {
  AmountFormulaNode,
  AmountFormulaRef,
  AmountFormulaSaveArgs,
} from "./boqTypes";

const FN = "ƒ";

export interface MarginSlotSpec {
  /** The stored formula target this slot writes to. */
  targetValueField: string;
  /** Heading shown above the slot. */
  label: string;
  /** Palette chips, grouped. */
  operands: ReadonlyArray<{
    ref: AmountFormulaRef;
    label: string;
    group: string;
    /** LABEL-ONLY: names a ref when hydrating, never rendered as a chip. */
    hidden?: boolean;
  }>;
  /** The tree to open with when nothing is stored (the built-in rule). */
  seed: AmountFormulaNode | null;
  /** The currently stored tree, if any. */
  stored: AmountFormulaNode | null;
}

interface MarginFormulaBuilderProps {
  cost: MarginSlotSpec;
  amount: MarginSlotSpec;
  /** Withheld when the sheet is locked/taken-over -> the badge renders read-only. */
  onSave?: (args: AmountFormulaSaveArgs) => Promise<void>;
}

/** One slot's token strip + operators + palette. Pure presentation over the caller's state. */
function Slot({
  spec,
  tokens,
  setTokens,
  disabled,
}: {
  spec: MarginSlotSpec;
  tokens: FormulaToken[];
  setTokens: (fn: (prev: FormulaToken[]) => FormulaToken[]) => void;
  disabled: boolean;
}) {
  const parsed = parseTokens(tokens);
  const chips = spec.operands.filter((o) => !o.hidden); // hidden = label-only (retired operands)
  const groups = [...new Set(chips.map((o) => o.group))];
  return (
    // ⚠️ COMPACTED, NOT CUT (owner report 2026-08-07). Every element the slot had is still here:
    // the label, the token strip, all six operator buttons, Backspace, and the full palette. Only
    // the padding, the strip's minimum height and the palette's scroll cap moved -- so the dialog
    // needs less scrolling without any control becoming harder to find or to hit. The buttons
    // keep their h-6 target; it is the SPACE AROUND them that shrank.
    <div className="rounded-md border border-border p-1.5">
      <p className="mb-1 text-[10px] font-semibold uppercase leading-none tracking-wide text-muted-foreground">
        {spec.label}
      </p>
      <div className="mb-1 min-h-[1.75rem] rounded-md border border-border bg-muted/30 p-1 flex flex-wrap items-center gap-1">
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
                {t.kind === "op" ? OP_GLYPH[t.op] : t.kind === "lparen" ? "(" : ")"}
              </span>
            ),
          )
        )}
      </div>
      {/* Only speaks when something is WRONG. A per-slot "Well-formed." on both slots was two
          lines of reassurance in a dialog whose problem was already that it said too much. */}
      {!parsed.ok && (
        <p className="mb-1 text-[11px] leading-tight text-destructive">
          {tokens.length === 0 ? "Pick at least one." : parsed.error}
        </p>
      )}
      {!disabled && (
        <>
          <div className="mb-1 flex items-center gap-1">
            {OP_BUTTONS.map((op) => (
              <Button
                key={op}
                size="sm"
                variant="outline"
                className="h-6 px-1.5 text-[11px]"
                onClick={() => setTokens((prev) => [...prev, { kind: "op", op }])}
              >
                {OP_GLYPH[op]}
              </Button>
            ))}
            <Button size="sm" variant="outline" className="h-6 px-1.5 text-[11px]"
              onClick={() => setTokens((prev) => [...prev, { kind: "lparen" }])}>(</Button>
            <Button size="sm" variant="outline" className="h-6 px-1.5 text-[11px]"
              onClick={() => setTokens((prev) => [...prev, { kind: "rparen" }])}>)</Button>
            <Button size="sm" variant="ghost" className="ml-auto h-6 px-1.5 text-[11px]"
              onClick={() => setTokens((prev) => prev.slice(0, -1))}>Backspace</Button>
          </div>
          {/* The palette keeps its OWN scroll cap. Two nested scrollers sounds wrong but is the
              point: without it a slot with many columns would push the other slot entirely out of
              the dialog's scroll region, and the two halves of one ratio would never be on screen
              together. `overscroll-contain` keeps a palette flick from scrolling the dialog body. */}
          <div className="max-h-20 overflow-auto overscroll-contain">
            {groups.map((g) => (
              <div key={g} className="mb-1 last:mb-0">
                <p className="mb-0.5 text-[9px] font-medium uppercase leading-none tracking-wide text-muted-foreground">{g}</p>
                <div className="flex flex-wrap gap-1">
                  {chips.filter((o) => o.group === g).map((o) => (
                    <button
                      key={refKey(o.ref)}
                      type="button"
                      onClick={() =>
                        setTokens((prev) => [...prev, { kind: "column", ref: o.ref, label: o.label }])
                      }
                      className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function MarginFormulaBuilder({ cost, amount, onSave }: MarginFormulaBuilderProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costTokens, setCostTokens] = useState<FormulaToken[]>([]);
  const [amountTokens, setAmountTokens] = useState<FormulaToken[]>([]);

  const labelFor = (spec: MarginSlotSpec) => (r: AmountFormulaRef) =>
    spec.operands.find(
      (o) =>
        o.ref.value_field === r.value_field &&
        o.ref.value_key === r.value_key &&
        o.ref.rate_subkey === r.rate_subkey,
    )?.label ?? r.value_field;

  // Re-hydrate on every open: the stored formula if there is one, else the built-in rule, so
  // "nothing stored" never reads as "no rule".
  useEffect(() => {
    if (!open) return;
    setError(null);
    const seedOf = (s: MarginSlotSpec) => s.stored ?? s.seed;
    setCostTokens(seedOf(cost) ? treeToTokens(seedOf(cost)!, labelFor(cost)) : []);
    setAmountTokens(seedOf(amount) ? treeToTokens(seedOf(amount)!, labelFor(amount)) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const costParsed = parseTokens(costTokens);
  const amountParsed = parseTokens(amountTokens);
  const bothWellFormed = costParsed.ok && amountParsed.ok;

  const handleSave = async () => {
    if (!onSave || !costParsed.ok || !amountParsed.ok) return;
    setSaving(true);
    setError(null);
    try {
      // Sequential, cost first. ⚠️ NOT atomic: if the second call fails the first is already
      // stored, so the dialog stays OPEN on error with both trees intact for a retry rather
      // than closing over a half-applied change.
      await onSave({
        targetValueField: cost.targetValueField,
        targetValueKey: null,
        targetRateSubkey: null,
        targetCol: null,
        description: "% Margin — cost side",
        formula: costParsed.tree,
      });
      await onSave({
        targetValueField: amount.targetValueField,
        targetValueKey: null,
        targetRateSubkey: null,
        targetCol: null,
        description: "% Margin — amount side",
        formula: amountParsed.tree,
      });
      setOpen(false);
    } catch (e) {
      setError(getFrappeError(e) || "Could not save the % Margin formula.");
    } finally {
      setSaving(false);
    }
  };

  /**
   * REMOVE -- delete BOTH stored formulas so the sheet returns to "nothing declared" and each
   * side falls back to its built-in rule.
   *
   * ⚠️ NOT THE SAME AS "Reset to default" THEN SAVE, and the difference is provenance rather
   * than arithmetic. Both produce identical numbers; Reset+Save STORES a formula that happens
   * to equal the default, while Remove leaves no record at all -- which is what an untouched
   * sheet looks like, and what a later reader needs in order to tell "nobody has configured
   * this" from "someone configured it and chose the default".
   */
  const handleRemove = async () => {
    if (!onSave) return;
    setSaving(true);
    setError(null);
    try {
      for (const slot of [cost, amount]) {
        if (!slot.stored) continue; // nothing to clear on this side
        await onSave({
          targetValueField: slot.targetValueField,
          targetValueKey: null,
          targetRateSubkey: null,
          targetCol: null,
          description: slot.label,
          formula: null, // the F1 clear path
        });
      }
      setOpen(false);
    } catch (e) {
      setError(getFrappeError(e) || "Could not remove the % Margin formula.");
    } finally {
      setSaving(false);
    }
  };

  const anyStored = !!cost.stored || !!amount.stored;

  /**
   * ⚠️ AMBER = NOT CONFIGURED, GREEN = CONFIGURED (owner ruling 2026-08-07).
   *
   * An earlier cut made "nothing stored" NEUTRAL, reasoning that the built-in rule computes
   * fine so amber would be a false alarm. That reasoning EXPIRED the moment enabling BCS began
   * seeding and saving the three formulas: nothing-stored is no longer the normal resting
   * state, it means the seed could not be produced or could not be saved -- no quantity column
   * mapped, a refused write, a sheet whose shape yields no sensible default. That IS worth
   * flagging, and amber is how this screen flags it.
   *
   * A stored formula is well-formed by construction (the parser validates before save), so
   * "not well-formed" and "not saved" are the same state and share the one colour.
   */
  const badge = (
    <span
      className={cn(
        "shrink-0 rounded border px-1 text-[11px] leading-none",
        anyStored
          ? "border-green-400 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/50 dark:text-green-300"
          : "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
      )}
      title={
        anyStored
          ? "% Margin = (1 − cost / amount) × 100"
          : "% Margin is not configured on this sheet yet — open to set the cost and amount sides"
      }
    >
      {FN}
    </span>
  );

  if (!onSave) return badge;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="shrink-0" aria-label="Edit the % Margin formula">
          {badge}
        </button>
      </PopoverTrigger>
      {/* ── HEIGHT IS CAPPED AND THE BODY SCROLLS (owner report 2026-08-07) ────────────────────
          Two slots, each with a token strip, an operator row and a palette, stack to roughly a
          thousand pixels; unbounded, the popover ran off the bottom of the viewport and took
          SAVE WITH IT -- a dialog you can fill in but cannot submit.

          ⚠️ THE SCROLL IS ON THE MIDDLE SECTION, NOT ON THE POPOVER. Scrolling the whole popover
          would work and would still hide Save, just later; pinning the header and the footer and
          scrolling only the slots keeps the rule statement and the actions visible at every
          scroll position, which is what makes the two slots legible as halves of ONE expression
          rather than two unrelated boxes.

          `min(75vh, 28rem)` bounds it against the SMALLER of the viewport and a comfortable
          reading height, so it never fills a tall screen edge to edge and never overflows a
          short one. Compaction alone got the content to ~460px, which cleared most viewports and
          would have left this cap never engaging -- 28rem is deliberately BELOW that, so the
          dialog is genuinely short and the body genuinely scrolls. `overscroll-contain` stops the
          grid behind it scrolling once the slots hit their end -- the popover is anchored to a
          sticky column header, and scrolling the grid out from under it would drag the popover
          away mid-edit.

          ⚠️ THE CAP IS AN INLINE STYLE, NOT `max-h-[min(75vh,28rem)]`. A Tailwind arbitrary value
          only exists if the JIT scanner finds that exact literal, so a class built this way is
          one refactor (or one dynamic string) away from silently producing NO max-height at all
          -- and the failure is invisible in dev and looks exactly like the bug this fixes. */}
      <PopoverContent align="end" className="w-[24rem] p-0">
        <div className="flex flex-col" style={{ maxHeight: "min(75vh, 28rem)" }}>
          {/* Pinned: identity + the rule each slot is a slot OF. */}
          <div className="shrink-0 px-3 pb-1.5 pt-3">
            <div className="mb-1.5 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">Formula for % Margin</p>
                <p className="text-[11px] leading-tight text-muted-foreground">
                  Choose each side. The rest of the rule is fixed.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* The whole rule, so a reader can see what each slot is a slot OF. The literals are
                shown as plain text because they cannot be tokens -- see the module docblock.
                PINNED rather than scrolled: it is the sentence the slots complete, and a slot
                whose sentence has scrolled away is the exact confusion BCS-S11b's one-dialog
                ruling was made to prevent. */}
            <div className="rounded-md border border-border bg-muted/40 px-2 py-1 text-center text-[12px]">
              ( 1 − <span className="font-semibold text-blue-700 dark:text-blue-300">COST</span> ÷{" "}
              <span className="font-semibold text-blue-700 dark:text-blue-300">AMOUNT</span> ) × 100
            </div>
          </div>

          {/* The only scrolling region. `min-h-0` is load-bearing: a flex child defaults to
              min-height:auto, which refuses to shrink below its content, so without it the
              max-height is ignored and the popover grows exactly as before. */}
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-1.5">
            <Slot spec={cost} tokens={costTokens} setTokens={setCostTokens} disabled={false} />
            <Slot spec={amount} tokens={amountTokens} setTokens={setAmountTokens} disabled={false} />
          </div>

          {/* Pinned: the error and the actions. An error that scrolled out of view while its
              cause stayed on screen would be worse than no error. */}
          <div className="shrink-0 border-t border-border px-3 pb-2.5 pt-2">
            {error && <p className="mb-1.5 text-[11px] text-destructive">{error}</p>}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={saving}
                  onClick={() => {
                    setCostTokens(cost.seed ? treeToTokens(cost.seed, labelFor(cost)) : []);
                    setAmountTokens(amount.seed ? treeToTokens(amount.seed, labelFor(amount)) : []);
                  }}
                  title="Put the built-in rule back in the boxes. Nothing is saved until you press Save."
                >
                  Reset
                </Button>
                {anyStored && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive"
                    disabled={saving}
                    onClick={handleRemove}
                    title="Delete the saved formula. % Margin goes back to the built-in rule."
                  >
                    Remove
                  </Button>
                )}
              </div>
              <Button size="sm" className="h-7 text-xs" disabled={!bothWellFormed || saving} onClick={handleSave}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
