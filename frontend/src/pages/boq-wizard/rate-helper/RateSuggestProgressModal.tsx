/**
 * RM-3 RateSuggestProgressModal -- the async suggest-run's blocking progress modal (cloned from
 * ClassifyProgressModal). NON-dismissable while running (the run cannot be abandoned mid-flight);
 * dismissable ONLY at a terminal state (success | error). Progress is fed from the get_suggest_status
 * poll on SheetPricingPage (the socket is unreliable in some deployments); pure presentation.
 *
 * Terminal SUCCESS shows how many rows got suggestions + an AI-off warning when the extraction voter
 * was disabled/no_key (fail-closed honesty -- no fallback). This modal is the slice's bundle marker.
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

export interface SuggestModalSummary {
  status?: string;
  ai_status?: string;
  results?: unknown[];
  run_id?: string;
}

export type SuggestModalPhase = "starting" | "running" | "success" | "error";

/** PURE: the modal phase. done WINS over a late running poll upstream, so running=false is terminal. */
export function deriveSuggestModalPhase(
  running: boolean,
  progress: { done: number; total: number } | null,
  summary: { status?: string } | null,
): SuggestModalPhase {
  if (running) return progress && progress.total > 0 ? "running" : "starting";
  return summary && summary.status === "error" ? "error" : "success";
}

export function suggestPercent(progress: { done: number; total: number } | null): number {
  if (!progress || progress.total <= 0) return 0;
  return Math.round((progress.done / progress.total) * 100);
}

/** PURE: the AI-off warning for a suggest run's ai_status. Healthy path ("ran") is SILENT. */
export function suggestAiStatusWarning(aiStatus: string | undefined | null): string {
  if (aiStatus === "disabled" || aiStatus === "no_key") {
    return "AI extraction was OFF - no attributes were extracted and no suggestions were produced. Turn AI on in Settings to run the extraction.";
  }
  return "";
}

interface Props {
  open: boolean;
  running: boolean;
  sheetName: string;
  progress: { done: number; total: number } | null;
  summary: SuggestModalSummary | null;
  onClose: () => void;
}

export function RateSuggestProgressModal({ open, running, sheetName, progress, summary, onClose }: Props) {
  const phase = deriveSuggestModalPhase(running, progress, summary);
  const dismissable = !running;
  const pct = suggestPercent(progress);
  const count = summary?.results?.length ?? 0;
  const warn = suggestAiStatusWarning(summary?.ai_status);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && dismissable) onClose(); }}>
      <DialogContent
        disableCloseIcon={dismissable}
        onEscapeKeyDown={(e) => { if (!dismissable) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (!dismissable) e.preventDefault(); }}
        onInteractOutside={(e) => { if (!dismissable) e.preventDefault(); }}
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
              {running ? `Suggesting rates for ${sheetName}` : phase === "error" ? "Suggestion run failed" : "Suggestions ready"}
            </span>
          </DialogTitle>
        </DialogHeader>

        {running && (
          <div className="space-y-2">
            {phase === "starting" ? (
              <p className="text-sm text-muted-foreground">Starting&hellip; extracting attributes for wiring rows.</p>
            ) : (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-sky-100 dark:bg-sky-900">
                  <div className="h-full rounded-full bg-sky-500 transition-all dark:bg-sky-400" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-sm tabular-nums text-muted-foreground">{progress!.done} of {progress!.total} rows</p>
              </>
            )}
            <p className="text-xs text-muted-foreground">Please keep this open &mdash; the run is in progress.</p>
          </div>
        )}

        {!running && phase === "success" && (
          <div className="space-y-1 text-sm">
            <p className="font-medium text-emerald-800 dark:text-emerald-200">
              {count} wiring {count === 1 ? "row" : "rows"} extracted &mdash; badges are on the rate cells.
            </p>
            {warn && <p className="text-amber-700 dark:text-amber-300">{warn}</p>}
          </div>
        )}

        {!running && phase === "error" && (
          <div className="space-y-1 text-sm text-destructive">
            <p className="font-medium">The suggestion run could not complete.</p>
            <p className="opacity-90">Nothing was saved. Please try again; if the AI was on, check the AI settings/key.</p>
          </div>
        )}

        {dismissable && (
          <DialogFooter>
            <Button size="sm" onClick={onClose}>{phase === "error" ? "Close" : "Done"}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
