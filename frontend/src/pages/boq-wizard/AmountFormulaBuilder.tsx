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
import { ROLE_LABELS, columnChipLabel } from "./boqTypes";
import { pickFormula } from "./amountFormula";
import {
  buildOperandPalette,
  parseTokens,
  refKey,
  storedDefaultFormula,
  treeToTokens,
  unbindableOperands,
  wouldCreateCycle,
  type FormulaToken,
  type OperandChip,
  type OpToken,
} from "./formulaTokens";
import type {
  AmountFormulaNode,
  AmountFormulaRef,
  AmountFormulaSaveArgs,
  ColumnDescriptor,
  ColumnFormula,
} from "./boqTypes";

// Pure-ASCII source; the glyphs render correctly.
const FN = "ƒ"; // the function mark used on the header label (f-hook)
const MUL = "×"; // the multiply glyph

/**
 * The glyph each stored operator is DISPLAYED as -- a total map over the operator vocabulary,
 * used by BOTH renderings (the one-line preview and the chip strip).
 *
 * ⚠️ A MAP, NOT A TERNARY, AND THAT IS THE POINT (F5). Both sites read `t.op === "*" ? MUL :
 * "+"` before this slice, which is correct while `+` and `*` are the only operators and
 * silently renders a `-` or a `/` AS A `+` the moment they are not. A formula shown as
 * something other than what it computes is worse than one that fails to render, and the two
 * sites drifting apart is worse again. Adding an operator without extending this map is a
 * TYPE ERROR, because the key type is the token's own op union.
 */
export const OP_GLYPH: Record<OpToken["op"], string> = {
  "+": "+",
  "-": "−", // U+2212 MINUS SIGN -- reads as an operator beside x, unlike an ASCII hyphen
  "*": MUL,
  "/": "÷",
};

const AREA_BOUND_VALUE_FIELDS = new Set(["qty_by_area", "rate_by_area", "amount_by_area"]);

/** The operator buttons, in the order they appear under the preview. */
export const OP_BUTTONS: ReadonlyArray<OpToken["op"]> = ["+", "-", "*", "/"];

type Mode = "default" | "override";

/** A short single-line text rendering of a token list (header preview + a11y title). */
export function tokensToText(tokens: FormulaToken[]): string {
  return tokens
    .map((t) =>
      t.kind === "column" ? t.label
        : t.kind === "op" ? OP_GLYPH[t.op]
        : t.kind === "lparen" ? "(" : ")",
    )
    .join(" ");
}

/** The canonical group headings, in the order an amount column has always shown them. */
const CANONICAL_PALETTE_GROUPS = ["Quantity", "Rate", "Amount"];

/**
 * The palette's group headings to render, IN ORDER -- derived from the palette itself.
 *
 * ⚠️ THIS WAS A HARDCODED `["Quantity", "Rate", "Amount"]` INLINE AT THE RENDER SITE, AND IT
 * SHIPPED BROKEN. BCS-S9's cost chips were built into the palette array correctly and then
 * dropped on the floor, because their group was not one of those three -- so the BCS Total
 * builder opened offering only Total Quantity, with no way to name a cost at all. NOTHING
 * FAILED: no type error, no empty-palette message (the array was not empty), just two silently
 * missing buttons. Same failure class as the operator-glyph ternary this slice also replaced --
 * a fixed list that quietly omits whatever it has not heard of.
 *
 * The canonical three keep their order and are emitted even when empty (the caller skips empty
 * groups), so an amount column's palette is byte-unchanged; any other group follows in
 * first-appearance order. A new group now renders BY EXISTING, which is the point.
 *
 * Pure + exported so it is unit-testable -- this repo has no DOM environment, so a helper left
 * inline in the component would have stayed exactly as untestable as the bug it caused.
 */
export function paletteGroupOrder(
  palette: ReadonlyArray<{ group: string }>,
): string[] {
  const out = [...CANONICAL_PALETTE_GROUPS];
  for (const p of palette) if (!out.includes(p.group)) out.push(p.group);
  return out;
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
  /**
   * BCS-S9: REPLACE the descriptor-derived operand palette with an explicit one.
   *
   * The BCS Total Amount column is computed from operands that are NOT sheet columns -- the
   * row's stored cost boxes and the sheet's confirmed BCS quantity -- so there are no
   * descriptors to derive chips from. Supplying this switches the palette AND the label
   * resolver (hydrating a stored tree needs to name those refs too).
   *
   * ⚠️ Absent = the amount-column behaviour, BYTE-UNCHANGED. Every existing call site passes
   * nothing, so this component keeps doing exactly what it did for amount columns.
   */
  operands?: ReadonlyArray<{
    ref: AmountFormulaRef;
    label: string;
    group: string;
    /** BCS-S12b: LABEL-ONLY. Not offered as a chip, but still names a ref when hydrating a
     *  stored formula -- see the palette note for why a retired operand still needs a name. */
    hidden?: boolean;
  }>;
  /** BCS-S9: what an EMPTY stored formula opens showing. The BCS column has a built-in rule
   *  that applies when nothing is stored, so the builder must open on THAT rule rather than on
   *  a blank -- otherwise "no formula" would look like "no rule", which is false. */
  seedTokensFrom?: AmountFormulaNode | null;
}

export function AmountFormulaBuilder({
  target,
  columnLabel,
  descriptors,
  columnFormulas,
  onSave,
  operands,
  seedTokensFrom,
}: AmountFormulaBuilderProps) {
  const [open, setOpen] = useState(false);
  /**
   * ★ THE TIER FOLLOWS THE COLUMN. THERE IS NO TAB. (owner ruling 2026-09-04)
   *
   * A column that NAMES AN AREA is priced for that area -- so it writes the per-area override
   * tier, full stop. A column with NO area dimension has only the one tier, which is stored with
   * a null value_key and happens to be called "default". Neither is a choice, so neither is
   * offered as one.
   *
   * ⚠️ THE TOGGLE DID REAL DAMAGE, WHICH IS WHY IT IS GONE RATHER THAN MERELY DEFAULTED THE OTHER
   * WAY. It opened on "Default (all areas)", so the FIRST formula anyone built on a per-area
   * column landed in the wrong tier; they then rebuilt it on "This area only", and the override
   * shadowed the default (pickFormula resolves override-before-default), leaving a byte-identical
   * dead record behind. That is exactly what BOQ-26-00184 / "Electrical Est" column H contains,
   * and the report was "I click default, I make one formula, but its not working".
   */
  const targetIsPerArea = target.value_field === "amount_by_area" && target.value_key != null;
  const effectiveMode: Mode = targetIsPerArea ? "override" : "default";

  const [tokens, setTokens] = useState<FormulaToken[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cleared in THIS popover: hide the notice immediately rather than waiting on the parent's
  // refetch, so the button visibly does something.
  const [strayCleared, setStrayCleared] = useState(false);

  // Resolve a ref to a display label from the descriptor set. A wildcard (area-bound, value_key
  // null) matches by (value_field, rate_subkey) ignoring area and shows no area.
  const labelFor = (r: AmountFormulaRef): string => {
    // BCS-S9: an explicit palette owns its own names -- its refs are not sheet columns, so the
    // descriptor lookup below could never resolve them and would fall through to the raw
    // value_field ("bcs_supply"), which is not a thing any user has seen.
    const explicit = operands?.find(
      (o) =>
        o.ref.value_field === r.value_field &&
        o.ref.value_key === r.value_key &&
        o.ref.rate_subkey === r.rate_subkey,
    );
    if (explicit) return explicit.label;
    const isWildcard = r.value_key === null && AREA_BOUND_VALUE_FIELDS.has(r.value_field);
    const match = descriptors.find(
      (d) =>
        d.value_field === r.value_field &&
        d.rate_subkey === r.rate_subkey &&
        (isWildcard || d.value_key === r.value_key),
    );
    if (match) {
      // A WILDCARD names a LOGICAL column across every area ("the quantity of whichever area is
      // being computed"), so no single letter applies and it stays role-only.
      if (isWildcard) return ROLE_LABELS[match.role] ?? match.role;
      // A CONCRETE column is named exactly as its grid header names it -- letter included. Two
      // `qty` columns on one sheet are otherwise two chips reading "Quantity", which is the
      // state a correct formula cannot be built out of.
      return columnChipLabel(match);
    }
    return r.rate_subkey ? `${r.value_field} (${r.rate_subkey})` : r.value_field;
  };

  // The SAVE target identity (the value_key the backend stores: null for a default/scalar, the
  // concrete area for an override).
  const saveValueKey = targetIsPerArea ? target.value_key : null;
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

  /**
   * ★ THE ALL-AREAS FORMULA THIS COLUMN IS CURRENTLY RUNNING ON, when it has none of its own.
   *
   * `existingForMode` looks in the override slot ONLY, so on a sheet built before this change --
   * the old toggle OPENED on "Default (all areas)", so one formula and no tab click is the normal
   * history -- it finds nothing, while `applicable` (pickFormula's override-else-default) finds
   * the default and lights the badge GREEN with a preview. That is one panel saying "covered,
   * here is the formula" and "Add at least one column." at the same time.
   *
   * Seeding from it fixes the contradiction AND is the migration: Save writes these tokens to
   * THIS AREA's override, so the shared default stops governing the column one column at a time.
   * Null the moment an override exists (then `existingForMode` IS the formula) and for a scalar
   * target (where the null-key record already IS `existingForMode`, so this would be the same
   * object twice).
   */
  const inheritedDefault =
    !operands && targetIsPerArea && !existingForMode?.formula ? applicable : null;

  // Hydrate the token list from the existing formula whenever the popover opens or the mode
  // flips (each mode has its own stored formula). Keyed on [open, effectiveMode].
  useEffect(() => {
    if (!open) return;
    setError(null);
    const seed = existingForMode?.formula ?? inheritedDefault?.formula ?? seedTokensFrom ?? null;
    setTokens(seed ? treeToTokens(seed, labelFor) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effectiveMode]);

  /**
   * The leftover all-areas record: stored, SHADOWED by this column's own override, governing
   * nothing. See storedDefaultFormula for why the shadow test is the whole safety of this --
   * unshadowed, the identical record is `inheritedDefault` above, and offering to remove it
   * would delete the live formula for every area on the axis.
   */
  const strayDefault =
    operands || !targetIsPerArea || strayCleared
      ? null
      : storedDefaultFormula(target, columnFormulas);

  // ── live validity ────────────────────────────────────────────────────────
  const parsed = parseTokens(tokens);
  const cyclic = parsed.ok && wouldCreateCycle(saveTargetRef, parsed.tree, columnFormulas);
  // A wildcard operand this target can never bind (see unbindableOperands): the formula saves
  // cleanly and then blanks every cell, so it is refused HERE rather than discovered in the grid.
  // Empty for a BCS/explicit palette, whose refs are not sheet columns at all.
  const unbindable = operands ? [] : unbindableOperands(target, descriptors, tokens);
  const wellFormed = parsed.ok && !cyclic && unbindable.length === 0;

  // ── token edits ──────────────────────────────────────────────────────────
  const insert = (t: FormulaToken) => setTokens((prev) => [...prev, t]);
  const backspace = () => setTokens((prev) => prev.slice(0, -1));
  const reset = () => setTokens([]);

  // ── the operand palette (qty / rate / amount columns) ────────────────────
  // ⚠️ HIDDEN ENTRIES ARE FILTERED HERE, NOT AT THE CALLER. They exist so a RETIRED operand
  // still has a NAME: a formula stored before an operand left the palette must keep rendering
  // its own words, not the raw `value_field`. That is exactly what broke when `bcs_qty` was
  // retired at S12 -- an existing BCS Total formula started showing a chip reading "bcs_qty",
  // which is not a thing anyone has ever seen on this screen.
  //
  // BCS-S9: an explicit palette REPLACES the descriptor sweep entirely (its operands are not
  // sheet columns). Absent -> buildOperandPalette, which owns the mode/dedupe/self-ref rules
  // (extracted so they are unit-testable -- this repo has no DOM test environment).
  const palette: OperandChip[] = operands
    ? // BCS operands are not sheet columns -- an explicit palette owns its own contents.
      operands.filter((o) => !o.hidden).map(({ ref, label, group }) => ({ ref, label, group }))
    : buildOperandPalette(target, descriptors, labelFor);
  const paletteByGroup = (g: string) => palette.filter((p) => p.group === g);

  const paletteGroups = paletteGroupOrder(palette);

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

  /** Clear the leftover all-areas record. Targets the DEFAULT tier explicitly (value_key null),
   *  never the column's own override -- that is what the footer's Remove is for. */
  const handleRemoveStrayDefault = async () => {
    if (!onSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        targetValueField: target.value_field,
        targetValueKey: null,
        targetRateSubkey: target.rate_subkey,
        targetCol: target.col,
        description: columnLabel,
        formula: null,
      });
      setStrayCleared(true);
    } catch (e: unknown) {
      setError(getFrappeError(e) || "Could not remove the leftover formula.");
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
  const badgeTitle = covered
    ? `${FN} = ${applicablePreview}`
    : "Not configured yet";
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
            <p className="text-[10px] text-muted-foreground">
              {targetIsPerArea
                ? `Applies to ${target.value_key} only. Click columns and operators to build it.`
                : "Click columns and operators to build it."}
            </p>
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

        {/* THE TIER TOGGLE -- BOTH TABS RENDER, "Default (all areas)" PERMANENTLY DISABLED on a
            column that names an area (owner ruling 2026-09-04, REVERSING the removal).
            Removing it entirely hid the fact that a default tier EXISTS, and a tier you cannot see
            is one you cannot reason about -- especially with a leftover default stored beneath it.
            Disabled says the tier is real AND that this column is not where it is edited, which is
            what the removal could not say. `effectiveMode` is already pinned to "override" here, so
            there is no state to change and no handler to attach: the control is pure signage. */}
        {targetIsPerArea && (
          <div className="mb-2 flex w-full overflow-hidden rounded-md border border-border text-[11px]">
            <button
              type="button"
              disabled
              title={`This column is priced for ${target.value_key}, so it writes that area's own formula. The all-areas tier is not edited here.`}
              className="flex-1 cursor-not-allowed bg-muted/40 px-2 py-1 text-muted-foreground"
            >
              Default (all areas)
            </button>
            <span className="flex-1 bg-primary px-2 py-1 text-center text-primary-foreground">
              This area only ({target.value_key})
            </span>
          </div>
        )}

        {/* THE LEFTOVER "all areas" FORMULA -- beneath the disabled tab it belongs to.
            Not a tier to switch to: a stored record that governs nothing today and would take
            over silently if an override were ever removed. Shown so it is visible, with the one
            action worth having. */}
        {strayDefault && (
          <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[10px] leading-snug text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <p>
              A leftover <b>all areas</b> formula is stored on this column and is <b>not used</b> —
              each area&apos;s own formula wins. It would take over if one were removed.
            </p>
            <button
              type="button"
              disabled={saving}
              onClick={handleRemoveStrayDefault}
              className="mt-1 rounded border border-amber-400 px-1.5 py-0.5 font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:hover:bg-amber-900/40"
            >
              {saving ? "Removing..." : "Remove it"}
            </button>
          </div>
        )}

        {/* INHERITED, NOT LEFTOVER -- the all-areas formula this column is actually running on.
            Deliberately NEUTRAL, not amber: nothing is wrong and there is nothing to clean up.
            It says where the tokens below came from (they were seeded from it) and what Save
            does with them, because otherwise the canvas looks like a formula this column already
            owns -- and Save silently changing which record governs the column is the kind of
            surprise the tier toggle was removed for. NO remove button: the record is live. */}
        {inheritedDefault?.formula && (
          <div className="mb-2 rounded border border-border bg-muted/40 px-1.5 py-1 text-[10px] leading-snug text-muted-foreground">
            Currently using the <b>all areas</b> formula, shown below. Saving makes it{" "}
            <b>{target.value_key}</b>&apos;s own — the other areas keep using the all-areas one.
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
                  {t.kind === "op" ? OP_GLYPH[t.op] : t.kind === "lparen" ? "(" : ")"}
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
              : !parsed.ok
                ? parsed.error
                : unbindable.length > 0
                  ? `"${unbindable[0].label}" covers every area, but ${columnLabel} has no area to pick one. Use the specific column below instead.`
                  : "Well-formed."}
        </p>

        {/* Operators + backspace */}
        <div className="mb-2 flex items-center gap-1">
          {OP_BUTTONS.map((op) => (
            <Button
              key={op}
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => insert({ kind: "op", op })}
            >
              {OP_GLYPH[op]}
            </Button>
          ))}
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
          {paletteGroups.map((g) => {
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
