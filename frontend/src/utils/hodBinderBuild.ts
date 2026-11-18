// What the Handover Documents screen shows for a handover build (the binder of a system, or one document's
// content), read from the background operation it follows (ADR 0047, #1663). Pure, so it is tested without React.
//
// The build's context (`HodJob`) is what `useHodBinder` gives the operation when it starts; the shared hook keeps
// it in this tab's sessionStorage, so after a reload or a tab change the screen still knows which system builds.
// A build waiting in the queue reads apart from one that runs.

import type { OpView } from "@/utils/backgroundOps/operationFollower";

/** What is being built: the binder of `hodSystem`, or one document's content. */
export interface HodJob {
  hodSystem: string;
  /** One document's content, or null for the whole binder. */
  document: string | null;
  title: string;
}

export interface BinderProgress {
  /** Still waiting in the queue for a free worker: nothing is built yet. */
  waiting: boolean;
  percent: number;
  /** The part being built now. */
  label: string | null;
}

function parseHodJob(context: unknown): HodJob | null {
  if (typeof context !== "object" || context === null) return null;
  const { hodSystem, document, title } = context as Record<string, unknown>;
  if (typeof hodSystem !== "string") return null;
  return {
    hodSystem,
    document: typeof document === "string" ? document : null,
    title: typeof title === "string" ? title : "",
  };
}

/** The build in progress and how far it is, or null when none is (idle, or it ended). */
export function binderBuildOf(
  view: OpView,
  context: unknown,
): { job: HodJob; progress: BinderProgress } | null {
  const job = parseHodJob(context);
  if (!job) return null;
  switch (view.phase) {
    case "starting":
    case "queued":
      return { job, progress: { waiting: true, percent: 0, label: null } };
    case "running":
      return {
        job,
        progress: {
          waiting: false,
          percent: view.progress?.percent ?? 0,
          label: view.progress?.message ?? null,
        },
      };
    default:
      return null;
  }
}
