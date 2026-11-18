/**
 * A Classify click's run set (spec #1654, #1666): the engines one click started, each followed as its own background
 * operation (ADR 0047), folded into the one summary the page shows. Pure: the page feeds it each engine's view from
 * `useBackgroundOperation`.
 *
 * - Every engine's outcome counts. The run set is done only when every engine has ended, and it is an error when
 *   any engine failed or was lost, whichever ended first (the old summary was built from the last engine's message
 *   only, so an engine that failed first was hidden behind one that finished).
 * - An engine follows one operation: the first id it sees after its launch. A view of another operation of the same
 *   engine is ignored.
 * - An engine operation picked up after a reload joins the open run set, or starts a new one, with the scope it was
 *   started with (the operation's context).
 */
import { isRecord, type OpView } from "@/utils/backgroundOps/operationFollower";

import type { ClassifyScope, ClassifySummary } from "./boqTypes";

type EndedView = Extract<OpView, { phase: "finished" | "failed" | "lost" }>;

export interface EngineRun {
  discipline: string;
  scope: ClassifyScope | null;
  /** The operation this engine follows; null until its first view arrives. */
  opId: string | null;
  phase: OpView["phase"];
  progress: { done: number; total: number } | null;
  outcome: EndedView | null;
  /** When it ended, in the order the run set saw the ends (the summary's carried fields come from the last). */
  endedSeq: number;
}

export interface ClassifyRunSet {
  engines: EngineRun[];
  ends: number;
}

/** What the page gives `start` as the operation's context, and reads back after a reload. */
export interface EngineLaunch {
  discipline: string;
  scope: ClassifyScope;
}

const ENDED = new Set<OpView["phase"]>(["finished", "failed", "lost"]);

const newEngine = (discipline: string, scope: ClassifyScope | null): EngineRun => ({
  discipline, scope, opId: null, phase: "starting", progress: null, outcome: null, endedSeq: 0,
});

/** A new run set for the engines one click launched. */
export function launchRunSet(launches: readonly EngineLaunch[]): ClassifyRunSet {
  return { engines: launches.map((l) => newEngine(l.discipline, l.scope)), ends: 0 };
}

/** Every engine of the run set has ended. */
export function runSetDone(set: ClassifyRunSet | null): boolean {
  return Boolean(set && set.engines.length > 0 && set.engines.every((e) => e.outcome));
}

function scopeOf(context: unknown): ClassifyScope | null {
  if (!isRecord(context) || !isRecord(context.scope)) return null;
  const scope = context.scope;
  if (scope.mode === "sheet") return { mode: "sheet" };
  if (scope.mode === "range" && typeof scope.start === "number" && typeof scope.end === "number") {
    return { mode: "range", start: scope.start, end: scope.end };
  }
  return null;
}

function progressOf(view: OpView): { done: number; total: number } | null {
  if (view.phase !== "running" || !view.progress?.detail) return null;
  const { done, total } = view.progress.detail;
  return typeof done === "number" && typeof total === "number" ? { done, total } : null;
}

/**
 * Fold one engine's view (from its `useBackgroundOperation`) into the run set. Returns the same object when nothing
 * changed. `context` is the operation's context (`EngineLaunch`), which carries the scope across a reload.
 */
export function foldEngineView(
  set: ClassifyRunSet | null,
  discipline: string,
  view: OpView,
  context: unknown,
): ClassifyRunSet | null {
  if (view.phase === "idle") return set;
  let current = set;
  let engine = current?.engines.find((e) => e.discipline === discipline);
  if (!engine || (engine.outcome && engine.opId !== view.opId)) {
    // An operation this run set did not launch: picked up after a reload (or started in this tab before it).
    const fresh = newEngine(discipline, scopeOf(context));
    current = !current || runSetDone(current)
      ? { engines: [fresh], ends: 0 }
      : { ...current, engines: [...current.engines.filter((e) => e.discipline !== discipline), fresh] };
    engine = fresh;
  }
  if (engine.outcome) return current;
  if (engine.opId !== null && engine.opId !== view.opId) return current;
  const next: EngineRun = { ...engine, opId: view.opId, phase: view.phase };
  const progress = progressOf(view);
  if (progress) next.progress = progress;
  let ends = current!.ends;
  if (ENDED.has(view.phase)) {
    next.outcome = view as EndedView;
    ends += 1;
    next.endedSeq = ends;
    if (view.phase === "finished" && next.progress) next.progress = { ...next.progress, done: next.progress.total };
  }
  return { engines: current!.engines.map((e) => (e.discipline === discipline ? next : e)), ends };
}

/** No engine has started running yet, and at least one waits in the queue. */
export function runSetWaitingInQueue(set: ClassifyRunSet | null): boolean {
  if (!set) return false;
  const open = set.engines.filter((e) => !e.outcome);
  return open.some((e) => e.phase === "queued") && open.every((e) => e.phase === "queued" || e.phase === "starting");
}

/** The engines' rows done and to do, summed over every engine that has reported any; null before the first. */
export function runSetProgress(set: ClassifyRunSet | null): { done: number; total: number } | null {
  const reported = set?.engines.filter((e) => e.progress) ?? [];
  if (reported.length === 0) return null;
  return reported.reduce(
    (sum, e) => ({ done: sum.done + e.progress!.done, total: sum.total + e.progress!.total }),
    { done: 0, total: 0 },
  );
}

/** The engine operation's result, as `classify._classify_worker` returns it. */
function engineResult(outcome: EndedView): Record<string, unknown> | null {
  return outcome.phase === "finished" && isRecord(outcome.result) ? outcome.result : null;
}

const numberOr = (value: unknown, fallback: number) => (typeof value === "number" ? value : fallback);

/**
 * The run set's summary once it is done. `status` is "error" when any engine failed or was lost, and
 * `engine_outcomes` names every engine's outcome in launch order. The counts the modal shows come from the resolved
 * read (the page fills them, HV-10b); the other fields are carried from the engine that finished last, as before.
 */
export function summariseRunSet(
  set: ClassifyRunSet,
): ClassifySummary & { ai_status_by_discipline: Record<string, string | null> } {
  const finished = set.engines
    .filter((e) => e.outcome && engineResult(e.outcome))
    .sort((a, b) => a.endedSeq - b.endedSeq);
  const last = finished.length ? engineResult(finished[finished.length - 1].outcome!) : null;
  const engineOutcomes = set.engines.map((e) =>
    e.outcome?.phase === "finished"
      ? { discipline: e.discipline, ok: true }
      : { discipline: e.discipline, ok: false, error: e.outcome && "error" in e.outcome ? e.outcome.error : "" },
  );
  const aiStatusByDiscipline: Record<string, string | null> = {};
  for (const e of finished) {
    const aiStatus = engineResult(e.outcome!)?.ai_status;
    aiStatusByDiscipline[e.discipline] = typeof aiStatus === "string" ? aiStatus : null;
  }
  return {
    total_in_range: 0,
    eligible_classified: 0,
    needs_review: 0,
    auto_accepted: numberOr(last?.auto_accepted, 0),
    skipped_total: numberOr(last?.skipped_total, 0),
    skipped_by_reason: isRecord(last?.skipped_by_reason) ? (last.skipped_by_reason as Record<string, number>) : {},
    committed_version: typeof last?.committed_version === "number" ? last.committed_version : null,
    sheet_warnings: Array.isArray(last?.sheet_warnings) ? (last.sheet_warnings as string[]) : [],
    ai_status: typeof last?.ai_status === "string" ? last.ai_status : null,
    status: engineOutcomes.every((o) => o.ok) ? "success" : "error",
    engine_outcomes: engineOutcomes,
    ai_status_by_discipline: aiStatusByDiscipline,
  };
}
