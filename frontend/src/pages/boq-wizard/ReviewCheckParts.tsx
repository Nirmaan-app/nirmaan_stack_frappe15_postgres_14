/**
 * ReviewCheckParts -- the three pieces the review screen draws for the review flags (S4a,
 * ADR-0034): the row pill, the counter strip above the grid, and the "Needs checking" block of
 * the row detail.
 *
 * Presentation only. What to show comes from `reviewCheckFlags.ts`, which in turn reads the
 * server's `check_flags` / `check_summary`; nothing here decides whether a row is flagged.
 */
import { CheckCircle2, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RowCheckFlags } from "./boqTypes";
import {
  LOOKS_OK_LABEL,
  NEEDS_CHECKING_HINT,
  NEEDS_CHECKING_TITLE,
  UNDO_LABEL,
  checkReasonLines,
  isCheckOpen,
  type CheckCounter,
  type CheckFilter,
  type CheckPill,
} from "./reviewCheckFlags";

/** Row treatment while a flag is open: a light orange wash and an orange left edge. */
export const CHECK_OPEN_ROW_TINT = "bg-orange-50/70 dark:bg-orange-950/20";
export const CHECK_OPEN_ROW_EDGE = "border-l-2 border-l-orange-400 dark:border-l-orange-500";

const PILL_CLASSES: Record<CheckPill["state"], string> = {
  open: "bg-orange-100 dark:bg-orange-900/60 text-orange-800 dark:text-orange-200",
  struck: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 line-through",
  checked: "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300",
};

/** The Check-column pill: "Check type" / "Check parent" / "Check both", struck, or "Checked". */
export function CheckPillBadge({ pill }: { pill: CheckPill }) {
  return (
    <span
      className={cn(
        "rounded-full py-0.5 px-2 text-[10px] font-medium leading-none shrink-0 whitespace-nowrap",
        PILL_CLASSES[pill.state],
      )}
    >
      {pill.label}
    </span>
  );
}

interface CheckCounterStripProps {
  counter: CheckCounter;
  /** Switch the Check filter (the strip's one button). */
  onFilter: (filter: CheckFilter) => void;
}

/** The strip above the grid: rows left to check, or the green "all checked" state. */
export function CheckCounterStrip({ counter, onFilter }: CheckCounterStripProps) {
  const done = counter.state === "done";
  return (
    <div
      className={cn(
        "flex items-start gap-2 px-3 py-2 rounded-md border text-xs flex-wrap",
        done
          ? "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-900 dark:text-green-100"
          : "border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 text-orange-900 dark:text-orange-100",
      )}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="flex items-center gap-1.5 font-medium">
          {done && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />}
          {counter.title}
        </span>
        <span className={done ? "text-green-800/90 dark:text-green-200/90" : "text-orange-800/90 dark:text-orange-200/90"}>
          {counter.detail}
        </span>
        {counter.hint && (
          <span className="text-orange-800/90 dark:text-orange-200/90">{counter.hint}</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onFilter(counter.buttonFilter)}
        className={cn(
          "ml-auto inline-flex items-center gap-1 text-[11px] font-medium transition-colors",
          done
            ? "text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100"
            : "text-orange-700 dark:text-orange-300 hover:text-orange-900 dark:hover:text-orange-100",
        )}
      >
        <Filter className="h-3 w-3" />
        {counter.buttonLabel}
      </button>
    </div>
  );
}

interface NeedsCheckingBlockProps {
  flags: RowCheckFlags | null | undefined;
  /** Frozen sheet / not the editor: the reason stays readable, the buttons are withheld. */
  readOnly: boolean;
  /** A tick or an undo of this row is in flight. */
  busy: boolean;
  error: string | null;
  onLooksOk: () => void;
  onUndo: () => void;
}

/**
 * The row detail's block for a flagged row. While a flag is open: "Needs checking", one neutral
 * line per reason, how to answer it, and "Looks OK". On a ticked row: the tick and "Undo".
 * Nothing for a row that was never flagged or that the user's own change answered.
 */
export function NeedsCheckingBlock({ flags, readOnly, busy, error, onLooksOk, onUndo }: NeedsCheckingBlockProps) {
  if (!flags) return null;
  if (isCheckOpen(flags)) {
    return (
      <div className="mb-2 rounded-md border border-orange-200 dark:border-orange-900 bg-orange-50/60 dark:bg-orange-950/20 p-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-orange-700 dark:text-orange-300 mb-1.5">
          {NEEDS_CHECKING_TITLE}
        </p>
        {checkReasonLines(flags).map((line) => (
          <p key={line} className="text-xs text-foreground mb-0.5">{line}</p>
        ))}
        <p className="text-[11px] text-muted-foreground mt-1 mb-1.5 leading-snug">{NEEDS_CHECKING_HINT}</p>
        {error && <p className="text-xs text-destructive mb-1">{error}</p>}
        {!readOnly && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-[11px]"
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onLooksOk(); }}
          >
            <CheckCircle2 className="h-3 w-3 mr-1" /> {LOOKS_OK_LABEL}
          </Button>
        )}
      </div>
    );
  }
  if (flags.looks_ok) {
    return (
      <div className="mb-2 rounded-md border border-border bg-muted/30 p-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1 text-[11px] text-green-700 dark:text-green-300">
            <CheckCircle2 className="h-3 w-3" /> {LOOKS_OK_LABEL}
          </span>
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); onUndo(); }}
            >
              {UNDO_LABEL}
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    );
  }
  return null;
}
