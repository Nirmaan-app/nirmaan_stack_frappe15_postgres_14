/**
 * MarginRangeFilter -- the % Margin RANGE filter, opened from the % Margin column header (BCS-S13).
 *
 * ⚠️ THIS REPLACES THE MARGIN VIEW (owner ruling 2026-08-07). BCS-S4 shipped a separate flat,
 * line-items-only VIEW ordered by % Margin, reached from its own toolbar button. The owner removed
 * it: the question people actually bring to this screen is "show me the lines between X% and Y%",
 * and answering that by re-presenting the whole sheet somewhere else was a bigger move than the
 * question needed. Filtering the sheet IN PLACE keeps every other control (search, collapse, the
 * row-type toggles, the cost boxes) meaning exactly what it meant a moment ago.
 *
 * It is a FILTER, not a formula, and it deliberately borrows the formula badge's shape anyway --
 * a small marker in the column header opening a popover -- because that is the established way
 * this grid says "this column has something you can configure". The two sit side by side on the
 * % Margin header and are told apart by icon and colour, never by position.
 *
 * ── WHY IT IS NOT WITHHELD WHEN THE SHEET IS LOCKED ──────────────────────────────────────────
 * The grid's read-only rule is "gating = PRESENCE of the save callback" (frontend/CLAUDE.md), and
 * every callback it names is a WRITE. Filtering writes nothing. A locked or taken-over sheet is
 * exactly when someone is reading rather than editing, so removing the one control that helps
 * them read would be backwards. `onApply` is therefore always supplied.
 *
 * Pure presentation over the caller's state: the page owns the bounds, owns the matched row set,
 * and owns when it is recomputed. The rules live in `marginView.ts` (unit-tested); this file
 * decides nothing about which rows match.
 */
import { useEffect, useState } from "react";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { describeMarginRange, marginRangeActive, parseMarginBound } from "./marginView";

interface MarginRangeFilterProps {
  /** The applied lower bound, as typed. "" = open on this side. */
  from: string;
  /** The applied upper bound, as typed. "" = open on this side. */
  to: string;
  /**
   * How many rows the applied range matches, or null when no range is applied. DISPLAY ONLY --
   * it is shown so the filter can say what it did; nothing here derives from it.
   */
  matchedCount: number | null;
  /**
   * Apply the bounds. Passing two blanks CLEARS the filter (`marginRangeActive` is the one rule
   * that decides, on the page side). Called on an explicit Apply/Clear press and nowhere else --
   * see `marginView.marginRangeRowSet` for why the matched set is a snapshot rather than a live
   * derivation.
   */
  onApply: (from: string, to: string) => void;
}

export function MarginRangeFilter({ from, to, matchedCount, onApply }: MarginRangeFilterProps) {
  const [open, setOpen] = useState(false);
  // The DRAFT bounds. Separate from the applied ones so Cancel is a real cancel: typing in here
  // changes nothing on the grid until Apply, which is what lets someone try a range out without
  // the rows moving under them mid-keystroke.
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  // Re-hydrate from the APPLIED bounds on every open, so the boxes always show what is actually
  // filtering the grid -- including after a Cancel that left a half-typed draft behind.
  useEffect(() => {
    if (!open) return;
    setDraftFrom(from);
    setDraftTo(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applied = marginRangeActive(parseMarginBound(from), parseMarginBound(to));
  const draftActive = marginRangeActive(parseMarginBound(draftFrom), parseMarginBound(draftTo));

  const apply = () => {
    onApply(draftFrom, draftTo);
    setOpen(false);
  };
  const clear = () => {
    // Clear through the SAME path as Apply -- two blank bounds are not a special case, they are
    // the inactive range. One code path, so "cleared" and "never set" cannot drift apart.
    setDraftFrom("");
    setDraftTo("");
    onApply("", "");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "shrink-0 rounded border px-1 py-0.5 leading-none",
            // ACTIVE is loud on purpose. A filter you cannot tell is on is how a reader concludes
            // a sheet has fewer lines than it has.
            applied
              ? "border-sky-500 bg-sky-600 text-white dark:border-sky-400 dark:bg-sky-500"
              : "border-sky-300 bg-white/70 text-sky-700 hover:bg-white dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
          )}
          aria-label={
            applied
              ? `% Margin is filtered${matchedCount === null ? "" : ` to ${matchedCount} rows`}. Edit the range.`
              : "Filter rows by % Margin"
          }
          title={
            applied
              ? `Filtering % Margin ${describeMarginRange(from, to)}${
                  matchedCount === null ? "" : ` — ${matchedCount} row${matchedCount === 1 ? "" : "s"}`
                }. Click to change.`
              : "Filter rows by a % Margin range"
          }
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      {/* ── SIZED TO ITS CONTENT (owner report 2026-08-07) ────────────────────────────────────
          This is two inputs and three buttons; the first cut rendered it at 320x220 because it
          spent four separate rows saying so. Three went, none of them carrying information the
          remaining ones do not:

            - The SUBTITLE ("Leave a box empty for no limit on that side") duplicated the hint
              below it. One sentence now covers both facts.
            - The FROM / TO LABEL ROW became the placeholders. The row cost ~20px to name two
              boxes that a dash between them and a title reading "% Margin" already identify.
              ⚠️ THE ACCESSIBLE NAMES DID NOT GO WITH IT -- each input keeps its `aria-label`
              ("Minimum / Maximum % Margin"), which is MORE specific than the visible label was,
              and unlike a placeholder it survives the box being filled in.
            - The SPINNER ARROWS are hidden. `type="number"` keeps the numeric keyboard and the
              typing rules; the steppers only ate horizontal room, and nobody nudges a margin
              band one point at a time. */}
      <PopoverContent align="end" className="w-[17rem] p-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">Filter by % Margin</p>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
            placeholder="From"
            aria-label="Minimum % Margin"
            className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="shrink-0 text-muted-foreground">–</span>
          <input
            type="number"
            inputMode="decimal"
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
            placeholder="To"
            aria-label="Maximum % Margin"
            className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>

        {/* Both ends INCLUSIVE, and unknown margins DROP OUT -- kept, because both are things a
            reader would otherwise have to infer from a row count that did not match what they
            expected. Compressed to one line, not dropped: this is the only text here that says
            something the controls cannot. */}
        <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
          Both ends included. Rows with no % Margin are hidden.
          {applied && matchedCount !== null && (
            <> Showing {matchedCount} row{matchedCount === 1 ? "" : "s"}.</>
          )}
        </p>

        <div className="mt-2 flex items-center justify-between">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={!applied && !draftActive}
            onClick={clear}
            title="Remove the % Margin filter and show every row again."
          >
            Clear
          </Button>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" className="h-6 px-2.5 text-xs" onClick={apply}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
