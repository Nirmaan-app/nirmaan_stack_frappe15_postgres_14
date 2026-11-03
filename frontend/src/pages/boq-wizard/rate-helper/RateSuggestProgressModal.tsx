/**
 * RM-3 RateSuggestProgressModal -- the async suggest-run's blocking progress modal (cloned from
 * ClassifyProgressModal). NON-dismissable while running (the run cannot be abandoned mid-flight);
 * dismissable ONLY at a terminal state (success | error). Progress is fed from the get_suggest_status
 * poll on SheetPricingPage (the socket is unreliable in some deployments); pure presentation.
 *
 * Terminal SUCCESS shows how many rows got suggestions + an AI-off warning when the extraction voter
 * was disabled/no_key (fail-closed honesty -- no fallback). This modal is the slice's bundle marker.
 *
 * DEV2-B4 (owner SEQUENCE G1, 2026-11-02 16:13: "the wait time should be adequately dsiclosed to the user and the
 * progress shown properly as we do for the suggest rate run currently"): when historical matching is ON and the Suggest
 * run completed, a SECOND PHASE follows under the Suggest result -- "Matching with previously priced BoQs - x of y
 * rows", the same bar, the elapsed time and the time left, and a clear "done" / "failed: <reason>" end. The modal stays
 * open (not dismissable) until that phase ends. With matching OFF (`match` absent) the modal is exactly as before.
 * `matchWaitEstimate` is the confirm dialog's ONE estimate line (owner 2026-11-03 11:11: total + split, a safe number).
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
  /** How many rows THIS PASS attempted (distinct from `attempted_count`, which is DOCUMENT-level
   *  and is inflated by carried rows on a scoped run). Present from the pass-count slice onward;
   *  ABSENT on any older payload, which degrades to the previous "split unavailable" wording. */
  pass_attempted_count?: number;
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
  if (scoped !== null) {
    // HALTED SCOPED. The three-way split needs THIS PASS's own count -- `attempted_count` is
    // document-level (carried rows already count as attempted), so it would report the whole
    // document and make "not reached" come out as 0. `pass_attempted_count` is the pass's own set:
    //   re-extracted    = the pass's count
    //   carried forward = document rows - the pass's count   (rows this pass never touched)
    //   not reached     = the scope    - the pass's count   (ticked rows left unfinished)
    // ABSENT on an older payload -> the previous honest "split unavailable" wording, unchanged.
    const passDone = typeof s.pass_attempted_count === "number" ? s.pass_attempted_count : null;
    if (passDone === null) return { ...none, splitUnavailable: true };
    return {
      ...none,
      reExtracted: passDone,
      carriedForward: Math.max(0, docRows - passDone),
      notReached: Math.max(0, scoped - passDone),
    };
  }
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

// ── DEV2-B4: the matching phase and the wait estimate ─────────────────────────────────────────────────────────────
/** The paces get_match_status serves (seconds, measured in dev2 at p90; api/boq/rate_match.PACES). */
export interface MatchPaces {
  /** DEV2-B5 S2 (the SAFE estimate, owner 2026-11-03 11:11): Suggest = a fixed part + one part per batch of
   *  `suggest_batch_rows` rows (extraction._BATCH), each fitted at p90 on the stored runs. */
  suggest_fixed_seconds: number;
  suggest_seconds_per_batch: number;
  suggest_batch_rows: number;
  match_fixed_seconds: number;
  match_seconds_per_row: number;
}

/** PURE. The confirm dialog's estimate: each phase at its p90 pace, rounded UP to whole minutes (at least 1); the
 *  total = the two parts added.
 *    suggest = ceil((suggest_fixed_seconds + ceil(rows / suggest_batch_rows) x suggest_seconds_per_batch) / 60)
 *    match   = ceil((match_fixed_seconds + rows x match_seconds_per_row) / 60)  */
export function matchWaitEstimate(rows: number, p: MatchPaces): { suggestMin: number; matchMin: number; totalMin: number; line: string } {
  const n = Math.max(0, rows);
  const batches = Math.ceil(n / Math.max(1, p.suggest_batch_rows));
  const suggestMin = Math.max(1, Math.ceil((p.suggest_fixed_seconds + batches * p.suggest_seconds_per_batch) / 60));
  const matchMin = Math.max(1, Math.ceil((p.match_fixed_seconds + n * p.match_seconds_per_row) / 60));
  const totalMin = suggestMin + matchMin;
  return {
    suggestMin, matchMin, totalMin,
    line: `This will take about ${totalMin} minutes in all: about ${suggestMin} to suggest rates and about ${matchMin} ` +
      `to match with previously priced BoQs.`,
  };
}

/** PURE. The line the dialog shows: "" when matching is OFF (or its paces are unknown) -> the dialog is as before. */
export function confirmEstimateLine(matchEnabled: boolean, rows: number, paces: MatchPaces | null | undefined): string {
  if (!matchEnabled || !paces) return "";
  return matchWaitEstimate(rows, paces).line;
}

export interface MatchPhaseState {
  state: "running" | "done" | "failed";
  done: number;
  total: number;
  elapsedS: number;
  leftS: number | null;
  reason?: string | null;
}

/** PURE. "45 s" / "3 min 05 s". */
export function formatSeconds(s: number): string {
  const v = Math.max(0, Math.round(s));
  if (v < 60) return `${v} s`;
  return `${Math.floor(v / 60)} min ${String(v % 60).padStart(2, "0")} s`;
}

export const MATCH_PHASE_LABEL = "Matching with previously priced BoQs";

function MatchPhase({ match }: { match: MatchPhaseState }) {
  const pct = suggestPercent({ done: match.done, total: match.total });
  return (
    <div className="space-y-2 border-t pt-3" data-testid="match-phase">
      {match.state === "running" ? (
        <>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span>{MATCH_PHASE_LABEL} &mdash; <span className="tabular-nums">{match.done} of {match.total} rows</span></span>
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-sky-100 dark:bg-sky-900">
            <div className="h-full rounded-full bg-sky-500 transition-all dark:bg-sky-400" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs tabular-nums text-muted-foreground" data-testid="match-times">
            {formatSeconds(match.elapsedS)} elapsed{match.leftS !== null ? ` \u00b7 about ${formatSeconds(match.leftS)} left` : ""}
          </p>
          <p className="text-xs text-muted-foreground">Please keep this open &mdash; matching is in progress.</p>
        </>
      ) : match.state === "done" ? (
        <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200" data-testid="match-done">
          {MATCH_PHASE_LABEL}: done.
        </p>
      ) : (
        <p className="text-sm font-medium text-destructive" data-testid="match-failed">
          {MATCH_PHASE_LABEL} failed: {match.reason || "the match run did not complete."}
        </p>
      )}
    </div>
  );
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
  /** DEV2-B4: the matching phase that follows a COMPLETE Suggest run when matching is ON. Absent => none (switch OFF). */
  match?: MatchPhaseState | null;
}

export function RateSuggestProgressModal({ open, running, sheetName, progress, summary, onClose, onResume, match }: Props) {
  const phase = deriveSuggestModalPhase(running, progress, summary);
  // DEV2-B4: the modal stays open while the matching phase runs (absent `match` -> exactly as before)
  const dismissable = !running && match?.state !== "running";
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

        {!running && match && <MatchPhase match={match} />}

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
