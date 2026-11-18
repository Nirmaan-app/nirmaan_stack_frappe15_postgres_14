/**
 * Rate suggest and the rate match it queues, each followed as its own background operation (ADR 0047, #1667). Pure:
 * the page follows each with `useBackgroundOperation` (one slot per sheet for each) and reads what to show here.
 *
 * - The suggest starts from the page with a browser-made id (`start_suggest`); its finished result is the run's
 *   outcome, with SR-1's reply keys (`only_rows`, `scoped_row_count`, `resumed_run_id`).
 * - The match starts inside the suggest, on the server, so the server makes its id and the suggest's result names it
 *   (`match.op_id`); the page then follows that operation alone. A match waiting behind other operations shows as
 *   queued. Nothing else's outcome can reach either view: each reads only its own status record.
 */
import { isInFlight, isRecord, type OpView } from "@/utils/backgroundOps/operationFollower";

import type { MatchPhaseState, SuggestModalSummary } from "./RateSuggestProgressModal";

export const START_SUGGEST_METHOD = "nirmaan_stack.api.boq.rate_master.start_suggest";

/** The tab's slot for each sheet's suggest operation, and for its match operation. */
export const suggestSlot = (boq: string, sheetName: string) => `boq_rate_suggest:${boq}::${sheetName}`;
export const matchSlot = (boq: string, sheetName: string) => `boq_rate_match:${boq}::${sheetName}`;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface SuggestOpView {
  /** Started and not yet ended (waiting in the queue counts). */
  running: boolean;
  waitingInQueue: boolean;
  progress: { done: number; total: number } | null;
  /** A failed or lost suggest, as the modal's error summary (the server's words). */
  failure: SuggestModalSummary | null;
}

/** PURE. What the suggest modal shows for the operation the page follows. */
export function suggestViewOf(view: OpView): SuggestOpView {
  const detail = view.phase === "running" ? view.progress?.detail : undefined;
  const done = num(detail?.done);
  const total = num(detail?.total);
  return {
    running: isInFlight(view),
    waitingInQueue: view.phase === "queued",
    progress: done !== null && total !== null ? { done, total } : null,
    failure: view.phase === "failed" || view.phase === "lost"
      ? { status: "error", run_status: "failed", halt_reason: view.error }
      : null,
  };
}

/** PURE. The match a finished, COMPLETE suggest queued: its operation to follow, or the reason none started. Null when
 *  matching is off (no `match` key) or the run did not complete. */
export function matchHandoffOf(result: unknown): { opId: string; run: string } | { reason: string | null } | null {
  if (!isRecord(result) || result.status !== "success" || !isRecord(result.match)) return null;
  const { queued, op_id: opId, run, reason } = result.match;
  if (queued === true && typeof opId === "string" && typeof run === "string") return { opId, run };
  return { reason: typeof reason === "string" ? reason : null };
}

/** PURE. The suggest modal's match phase for the match operation the page follows; null when it follows none. */
export function matchPhaseOf(view: OpView): MatchPhaseState | null {
  const zero = { done: 0, total: 0, elapsedS: 0, leftS: null };
  switch (view.phase) {
    case "idle":
      return null;
    case "starting":
    case "queued":
      return { state: "queued", ...zero };
    case "running": {
      const d = view.progress?.detail ?? {};
      return {
        state: "running",
        done: num(d.done) ?? 0,
        total: num(d.total) ?? 0,
        elapsedS: num(d.seconds) ?? 0,
        leftS: num(d.estimate_left_s),
      };
    }
    case "finished": {
      const r = isRecord(view.result) ? view.result : {};
      const counts = { ...zero, done: num(r.rows_done) ?? 0, total: num(r.rows_total) ?? 0 };
      return r.status === "success"
        ? { state: "done", ...counts }
        : { state: "failed", ...counts, reason: typeof r.halt_reason === "string" ? r.halt_reason : null };
    }
    case "failed":
    case "lost":
      return { state: "failed", ...zero, reason: view.error };
  }
}
