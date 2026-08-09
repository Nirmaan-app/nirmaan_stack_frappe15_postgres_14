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
  /** SR-1: the run LIFECYCLE (never ai_status, which keeps its own vocabulary). */
  run_status?: "running" | "partial" | "complete" | "failed";
  halt_reason?: string | null;
  attempted_count?: number;
  population_count?: number;
  /** SELROW: how many rows THIS pass was scoped to (null/absent on a whole-sheet run). Already
   *  published by the worker; the client simply never declared it, which is why the completion
   *  message reported the population. */
  scoped_row_count?: number | null;
}

/** The three outcomes a completion message may report. `null` = not applicable to this run shape
 *  (never "zero" -- a line reading zero is noise, and an invented zero is worse than an omission). */
export interface SuggestOutcomeCounts {
  reExtracted: number | null;
  carriedForward: number | null;
  notReached: number | null;
  /** TRUE when the run shape makes the split genuinely unknowable from the payload (a HALTED
   *  SCOPED run). The message then states what IS known instead of inventing a number. */
  splitUnavailable: boolean;
}

/**
 * PURE. What actually happened this pass, derived ONLY from the terminal payload.
 *
 * ⚠️ THE DEFECT THIS REPLACES: the message read `summary.results.length`, which is the whole
 * DOCUMENT (carried + newly extracted) -- i.e. the POPULATION. After a 4-row scoped run it said
 * "94", so a partial run read as a full one. A completion message must report what RAN.
 *
 * `scoped_row_count` is the pass's own scope and is null on a whole-sheet run, which is what makes
 * the two complete cases exact:
 *   whole-sheet complete -> re-extracted = every row in the document; nothing was carried.
 *   scoped complete      -> re-extracted = the scope; carried = the rest of the document.
 *
 * A HALTED run is different. On a WHOLE-SHEET halt, `attempted_count` is the pass's own progress
 * and `population_count - attempted_count` is exactly what was not reached. On a SCOPED halt,
 * `attempted_count` is DOCUMENT-level (carried rows are already counted attempted), so
 * `population - attempted` is 0 and would falsely read "nothing missed". The per-pass count exists
 * server-side but is not published, so this returns splitUnavailable rather than a wrong number.
 */
export function suggestOutcomeCounts(s: SuggestModalSummary | null): SuggestOutcomeCounts {
  const none: SuggestOutcomeCounts = {
    reExtracted: null, carriedForward: null, notReached: null, splitUnavailable: false,
  };
  if (!s) return none;
  const docRows = s.results?.length ?? 0;
  const scoped = typeof s.scoped_row_count === "number" ? s.scoped_row_count : null;
  const halted = s.run_status === "partial" || s.status === "partial";

  if (!halted) {
    if (scoped === null) return { ...none, reExtracted: docRows };
    return { ...none, reExtracted: scoped, carriedForward: Math.max(0, docRows - scoped) };
  }
  if (scoped !== null) return { ...none, splitUnavailable: true };
  const attempted = typeof s.attempted_count === "number" ? s.attempted_count : null;
  const population = typeof s.population_count === "number" ? s.population_count : null;
  return {
    ...none,
    reExtracted: attempted,
    notReached: attempted !== null && population !== null ? Math.max(0, population - attempted) : null,
  };
}

const rowWord = (n: number) => (n === 1 ? "row" : "rows");

/** The one line users read where the message says "badges are on the rate cells" -- KEPT as its own
 *  second line (it is the genuinely useful half: it says where to look). */
export const SUGGEST_BADGES_LINE = "Badges are on the rate cells.";

/**
 * PURE. The completion message's COUNT line. Returns "" when nothing can be said honestly.
 *
 * "wiring" is deliberately gone: the population spans seven categories (point_wiring,
 * switches_sockets, db_switchgear, cabletray_raceway, conduit_piping, wiring_cabling, popup_boxes)
 * and the word was a stale label from when the feature only handled cables.
 *
 * "carried forward unchanged" and "not reached" are NEVER folded together -- they mean different
 * things to someone deciding what to check. A count that does not apply is OMITTED, not printed
 * as zero.
 */
export function suggestCompletionLine(s: SuggestModalSummary | null): string {
  const c = suggestOutcomeCounts(s);
  if (c.splitUnavailable) {
    const n = typeof s?.scoped_row_count === "number" ? s.scoped_row_count : 0;
    return `The run stopped before finishing the ${n} ${rowWord(n)} you selected. ` +
      `Every other row is carried forward unchanged — resume to finish the rest.`;
  }
  const parts: string[] = [];
  if (c.reExtracted !== null) parts.push(`${c.reExtracted} ${rowWord(c.reExtracted)} re-extracted.`);
  if (c.carriedForward !== null && c.carriedForward > 0) {
    parts.push(`${c.carriedForward} ${rowWord(c.carriedForward)} carried forward unchanged.`);
  }
  if (c.notReached !== null && c.notReached > 0) {
    parts.push(`${c.notReached} ${rowWord(c.notReached)} not reached.`);
  }
  return parts.join(" ");
}

export type SuggestModalPhase = "starting" | "running" | "success" | "partial" | "error";

/** PURE: the modal phase. done WINS over a late running poll upstream, so running=false is terminal.
 * SR-1 adds "partial": the run stopped early but KEPT what it extracted and can be resumed -- it is
 * neither a success (rows are missing) nor the old all-or-nothing error (nothing was lost). */
export function deriveSuggestModalPhase(
  running: boolean,
  progress: { done: number; total: number } | null,
  summary: { status?: string; run_status?: string } | null,
): SuggestModalPhase {
  if (running) return progress && progress.total > 0 ? "running" : "starting";
  if (!summary) return "success";
  if (summary.status === "error") return "error";
  if (summary.status === "partial" || summary.run_status === "partial") return "partial";
  return "success";
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
  /** SR-1: resume the partial run. Absent => no resume affordance is offered. */
  onResume?: () => void;
}

export function RateSuggestProgressModal({ open, running, sheetName, progress, summary, onClose, onResume }: Props) {
  const phase = deriveSuggestModalPhase(running, progress, summary);
  const dismissable = !running;
  const pct = suggestPercent(progress);
  // SELROW: what actually RAN this pass -- never `results.length`, which is the whole document.
  const outcomeLine = suggestCompletionLine(summary);
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
              {running
                ? `Suggesting rates for ${sheetName}`
                : phase === "error"
                  ? "Suggestion run failed"
                  : phase === "partial"
                    ? "Suggestion run stopped early"
                    : "Suggestions ready"}
            </span>
          </DialogTitle>
        </DialogHeader>

        {running && (
          <div className="space-y-2">
            {/* SELROW: "wiring" dropped here too -- the population spans seven categories. */}
            {phase === "starting" ? (
              <p className="text-sm text-muted-foreground">Starting&hellip; extracting row attributes.</p>
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
            <p className="font-medium text-emerald-800 dark:text-emerald-200" data-testid="suggest-outcome">
              {outcomeLine}
            </p>
            <p className="text-muted-foreground">{SUGGEST_BADGES_LINE}</p>
            {warn && <p className="text-amber-700 dark:text-amber-300">{warn}</p>}
          </div>
        )}

        {/* SR-1: a PARTIAL run kept everything it extracted. Say what stopped it, how far it got,
            and offer the resume -- the pre-SR-1 alternative was an opaque "suggest_failed" after
            discarding every completed batch. */}
        {!running && phase === "partial" && (
          <div className="space-y-1 text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-200" data-testid="suggest-halt-reason">
              {summary?.halt_reason || "The run stopped before every row was processed."}
            </p>
            {/* SELROW: the same honest outcome line the success path uses -- re-extracted /
                carried forward / not reached, never folded together and never a zero. */}
            {outcomeLine && (
              <p className="tabular-nums text-muted-foreground" data-testid="suggest-outcome">
                {outcomeLine}
              </p>
            )}
            <p className="text-muted-foreground">{SUGGEST_BADGES_LINE}</p>
            <p className="text-muted-foreground">
              Nothing was lost. Resume to process only the rows that are still pending &mdash; the same run
              is completed, not started over. &ldquo;Use this value&rdquo; unlocks once it finishes.
            </p>
          </div>
        )}

        {!running && phase === "error" && (
          <div className="space-y-1 text-sm text-destructive">
            <p className="font-medium">The suggestion run could not complete.</p>
            <p className="opacity-90">
              {summary?.halt_reason
                || "Please try again; if the AI was on, check the AI settings/key."}
            </p>
          </div>
        )}

        {dismissable && (
          <DialogFooter>
            {phase === "partial" && onResume && (
              <Button size="sm" variant="default" onClick={onResume} data-testid="suggest-resume">
                Resume run
              </Button>
            )}
            <Button size="sm" variant={phase === "partial" ? "outline" : "default"} onClick={onClose}>
              {phase === "error" ? "Close" : phase === "partial" ? "Not now" : "Done"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
