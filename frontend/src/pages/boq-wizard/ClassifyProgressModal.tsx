/**
 * ClassifyProgressModal -- a centered, screen-BLOCKING modal for a classify-sheet run (BoQ Phase 5).
 *
 * Replaces the old inline x-of-y progress strip. While the run is RUNNING it is NON-dismissable
 * (no X, Esc and backdrop-click are swallowed) so the run cannot be abandoned mid-flight; it
 * becomes dismissable ONLY once the run reaches a TERMINAL state (success OR error), where a Close
 * button + the completion/error line appear. Progress is fed from the get_classify_status poll on
 * SheetPricingPage (the realtime socket is unreliable in some deployments); this component is pure
 * presentation over that state.
 *
 * The dismiss-gating is OWNER-LOCKED: never make the running phase dismissable, and never trap the
 * user at a terminal phase (both success and error expose Close).
 */
import { Loader2, Sparkles, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { aiStatusNote, skipRollupText } from "./ClassifySheetDialog";
import type { ClassifySummary } from "./boqTypes";

export type ClassifyModalPhase = "starting" | "running" | "success" | "error";

/**
 * PURE: the modal's phase from the run state.
 *  - running + known progress  -> "running" (determinate bar)
 *  - running + no progress yet  -> "starting" (indeterminate; before the first batch)
 *  - terminal + error summary   -> "error"
 *  - terminal otherwise         -> "success"
 * done WINS over a late running poll upstream, so `running=false` always means terminal here.
 */
export function deriveClassifyModalPhase(
  running: boolean,
  progress: { done: number; total: number } | null,
  summary: { status?: string } | null,
): ClassifyModalPhase {
  if (running) return progress && progress.total > 0 ? "running" : "starting";
  return summary && summary.status === "error" ? "error" : "success";
}

/** PURE: bar fill percent 0..100 (0 when the total is unknown -- guards a 0-of-0 divide). */
export function classifyPercent(progress: { done: number; total: number } | null): number {
  if (!progress || progress.total <= 0) return 0;
  return Math.round((progress.done / progress.total) * 100);
}

interface ClassifyProgressModalProps {
  open: boolean;
  running: boolean;
  sheetName: string;
  progress: { done: number; total: number } | null;
  summary: ClassifySummary | null;
  onClose: () => void;
}

export function ClassifyProgressModal({
  open,
  running,
  sheetName,
  progress,
  summary,
  onClose,
}: ClassifyProgressModalProps) {
  const phase = deriveClassifyModalPhase(running, progress, summary);
  const dismissable = !running; // terminal (success | error) only
  const pct = classifyPercent(progress);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Only an actual close request that is allowed (terminal) closes; running swallows all.
        if (!next && dismissable) onClose();
      }}
    >
      <DialogContent
        // disableCloseIcon SHOWS the X when true (inverted name). Hide it while running.
        disableCloseIcon={dismissable}
        // Block Esc / outside-click while running so the run cannot be abandoned.
        onEscapeKeyDown={(e) => {
          if (!dismissable) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (!dismissable) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (!dismissable) e.preventDefault();
        }}
        aria-describedby={undefined}
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {running ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : phase === "error" ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            ) : (
              <Sparkles className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}
            <span className="truncate">
              {running
                ? `Classifying ${sheetName}`
                : phase === "error"
                  ? "Classification failed"
                  : "Classification complete"}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* RUNNING / STARTING */}
        {running && (
          <div className="space-y-2">
            {phase === "starting" ? (
              <p className="text-sm text-muted-foreground">
                Starting&hellip; preparing rows for classification.
              </p>
            ) : (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-sky-100 dark:bg-sky-900">
                  <div
                    className="h-full rounded-full bg-sky-500 transition-all dark:bg-sky-400"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-sm tabular-nums text-muted-foreground">
                  {progress!.done} of {progress!.total} rows
                </p>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Please keep this open &mdash; the run is in progress.
            </p>
          </div>
        )}

        {/* SUCCESS */}
        {!running && phase === "success" && summary && (
          <div className="space-y-1 text-sm">
            <p className="font-medium text-emerald-800 dark:text-emerald-200">
              {summary.eligible_classified} of {summary.total_in_range} classified,{" "}
              {summary.needs_review} flagged for review
            </p>
            {skipRollupText(summary.skipped_by_reason ?? {}) && (
              <p className="text-muted-foreground">{skipRollupText(summary.skipped_by_reason ?? {})}</p>
            )}
            {aiStatusNote(summary.ai_status) && (
              <p className="text-amber-700 dark:text-amber-300">{aiStatusNote(summary.ai_status)}</p>
            )}
          </div>
        )}

        {/* ERROR */}
        {!running && phase === "error" && (
          <div className="space-y-1 text-sm text-destructive">
            <p className="font-medium">Classification could not complete.</p>
            <p className="opacity-90">
              The run failed{summary?.error_code ? ` (${summary.error_code})` : ""} &mdash; nothing was
              saved. Please try again; if the AI was on, check the AI settings/key.
            </p>
          </div>
        )}

        {dismissable && (
          <DialogFooter>
            <Button size="sm" onClick={onClose}>
              {phase === "error" ? "Close" : "Done"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
