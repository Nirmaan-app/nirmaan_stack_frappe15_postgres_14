/**
 * Follows one background operation through its status record (ADR 0047). Pure: no React and no SDK. The server
 * calls, the socket's state, the tab's storage and the screen's callbacks come in through `FollowerEdge`, so the
 * state machine is tested with them faked; `hooks/useBackgroundOperation` wires the real ones.
 *
 * - The record is the only truth. A socket message for this operation only makes it read the record now; a
 *   message for another operation is ignored, and no result is ever taken from a message.
 * - It polls about every 10 s while the socket is up and every 3 s while it is down, so a dropped socket still
 *   ends in the result.
 * - queued and running are told apart; a missing record reads as lost (the server says so).
 * - A finish is handled once. An ended state is kept: a late read of an earlier state does not undo it.
 * - It gives up (lost) only at the operation's time limit counted from when it started running, plus a grace
 *   longer than the server's own lost check. Time in the queue never counts.
 * - The operation is kept in the tab's storage until it ends, so a reload picks it up again.
 */

import { parseJson } from "@/lib/parseJson";

export const POLL_MS_SOCKET_UP = 10_000;
export const POLL_MS_SOCKET_DOWN = 3_000;
/** Longer than the server's 90 s stale-heartbeat check, so the server says lost first when it can. */
export const GIVE_UP_GRACE_MS = 120_000;

export type OpState = "queued" | "running" | "finished" | "failed" | "lost";

export interface OpProgress {
  percent: number;
  message: string | null;
  /** The work's own figures (`set_progress(..., detail=...)`), for a screen that shows more than a bar. */
  detail?: Record<string, unknown>;
}

/** The status record as `api/background_ops.get_status` returns it (times are server epoch seconds). */
export interface OpStatus {
  op_id: string;
  state: OpState;
  started_at: number | null;
  timeout: number | null;
  now: number | null;
  progress: OpProgress | null;
  result: unknown;
  error: string | null;
}

export type OpView =
  | { phase: "idle" }
  | { phase: "starting"; opId: string }
  | { phase: "queued"; opId: string }
  | { phase: "running"; opId: string; progress: OpProgress | null }
  | { phase: "finished"; opId: string; result: unknown }
  | { phase: "failed"; opId: string; error: string }
  | { phase: "lost"; opId: string; error: string };

/** Everything outside the state machine. */
export interface FollowerEdge {
  /** A new operation id (the browser makes it): `crypto.randomUUID()`. */
  makeId: () => string;
  /** The raw reply of the status read; the follower parses it. Rejects when the read failed. */
  readStatus: (opId: string) => Promise<unknown>;
  socketUp: () => boolean;
  /** This tab's slot for the operation it follows (sessionStorage). */
  storage: { get: () => string | null; set: (value: string) => void; remove: () => void };
  /** Every change of view, with the context given to `start` (kept across a reload; undefined when idle). */
  onView: (view: OpView, context: unknown) => void;
  /** Called once per finished operation, with the context given to `start`. */
  onFinished: (result: unknown, context: unknown, opId: string) => void | Promise<void>;
}

const STATES: readonly OpState[] = ["queued", "running", "finished", "failed", "lost"];
const ENDED = new Set<OpView["phase"]>(["finished", "failed", "lost"]);
const RANK: Record<OpView["phase"], number> = {
  idle: 0, starting: 1, queued: 2, running: 3, finished: 4, failed: 4, lost: 4,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const numberOrNull = (value: unknown): number | null => (typeof value === "number" ? value : null);
const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Narrow a status reply; null when it is not one. */
/** The finished file a result names (`background_ops.write_result_file`), or null. */
export function parseResultFile(result: unknown): { filename: string; sizeBytes: number } | null {
  if (!isRecord(result) || !isRecord(result.file) || typeof result.file.filename !== "string") return null;
  return { filename: result.file.filename, sizeBytes: numberOrNull(result.file.size_bytes) ?? 0 };
}

export function parseOpStatus(value: unknown): OpStatus | null {
  if (!isRecord(value) || typeof value.op_id !== "string") return null;
  const state = STATES.find((s) => s === value.state);
  if (!state) return null;
  const progress: OpProgress | null = isRecord(value.progress) && typeof value.progress.percent === "number"
    ? {
      percent: value.progress.percent,
      message: stringOrNull(value.progress.message),
      ...(isRecord(value.progress.detail) ? { detail: value.progress.detail } : {}),
    }
    : null;
  return {
    op_id: value.op_id,
    state,
    started_at: numberOrNull(value.started_at),
    timeout: numberOrNull(value.timeout),
    now: numberOrNull(value.now),
    progress,
    result: value.result ?? null,
    error: stringOrNull(value.error),
  };
}

function viewOf(status: OpStatus): OpView {
  const opId = status.op_id;
  switch (status.state) {
    case "queued": return { phase: "queued", opId };
    case "running": return { phase: "running", opId, progress: status.progress };
    case "finished": return { phase: "finished", opId, result: status.result };
    case "failed": return { phase: "failed", opId, error: status.error ?? "The operation failed." };
    case "lost": return { phase: "lost", opId, error: status.error ?? "The server stopped while running this." };
  }
}

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : "The operation could not start.");

interface Stored {
  opId: string;
  context: unknown;
}

function parseStored(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const value = parseJson(raw);
    return isRecord(value) && typeof value.opId === "string" ? { opId: value.opId, context: value.context } : null;
  } catch {
    return null;
  }
}

export class OperationFollower {
  private opId: string | null = null;
  private context: unknown = undefined;
  private view: OpView = { phase: "idle" };
  private finishHandled = false;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  private reading = false;
  private readAgain = false;
  private disposed = false;

  constructor(private readonly edge: FollowerEdge) {}

  /** Start a new operation: make its id, keep it for a reload, ask the server to start it, then follow it. */
  async start(startOnServer: (opId: string) => Promise<void>, context?: unknown): Promise<void> {
    const opId = this.edge.makeId();
    this.follow(opId, context);
    try {
      await startOnServer(opId);
    } catch (e) {
      if (this.opId === opId) this.end({ phase: "failed", opId, error: errorText(e) });
      return;
    }
    if (this.opId === opId) await this.read();
  }

  /** Pick up the operation this tab was following before a reload, if any. */
  resume(): void {
    const stored = parseStored(this.edge.storage.get());
    if (!stored) return;
    this.follow(stored.opId, stored.context);
    void this.read();
  }

  /** A socket message said an operation changed. Only this operation's message counts. */
  readNow(opId: string): void {
    if (opId === this.opId && !ENDED.has(this.view.phase) && !this.disposed) void this.read();
  }

  /** The socket connected or dropped: wait for the next read at the interval that now applies. */
  socketChanged(): void {
    if (!this.opId || this.reading || this.disposed || ENDED.has(this.view.phase)) return;
    this.schedule();
  }

  /** Forget the operation (the screen closed it); nothing more is read. */
  reset(): void {
    this.stopTimers();
    this.opId = null;
    this.context = undefined;
    this.edge.storage.remove();
    this.setView({ phase: "idle" });
  }

  /** The screen unmounted: stop reading, but keep the tab's slot so a reload resumes. */
  dispose(): void {
    this.disposed = true;
    this.stopTimers();
  }

  private follow(opId: string, context: unknown) {
    this.stopTimers();
    this.opId = opId;
    this.context = context;
    this.finishHandled = false;
    this.edge.storage.set(JSON.stringify({ opId, context }));
    this.setView({ phase: "starting", opId });
  }

  private async read(): Promise<void> {
    const opId = this.opId;
    if (!opId || this.disposed) return;
    if (this.reading) {
      this.readAgain = true;
      return;
    }
    clearTimeout(this.pollTimer);
    this.reading = true;
    try {
      const status = parseOpStatus(await this.edge.readStatus(opId));
      if (status && status.op_id === opId && this.opId === opId && !this.disposed) this.apply(status);
    } catch {
      // A failed read is tried again on the next tick.
    } finally {
      this.reading = false;
    }
    if (this.opId !== opId || ENDED.has(this.view.phase) || this.disposed) return;
    if (this.readAgain) {
      this.readAgain = false;
      return this.read();
    }
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(
      () => void this.read(),
      this.edge.socketUp() ? POLL_MS_SOCKET_UP : POLL_MS_SOCKET_DOWN,
    );
  }

  private apply(status: OpStatus) {
    if (ENDED.has(this.view.phase)) return;
    const next = viewOf(status);
    if (RANK[next.phase] < RANK[this.view.phase]) return;
    if (next.phase === "finished" || next.phase === "failed" || next.phase === "lost") {
      this.end(next);
      return;
    }
    if (next.phase === "running") this.armGiveUp(status);
    this.setView(next);
  }

  /** Give up at started_at + timeout (server clock, so the browser's own clock does not matter) plus a grace. */
  private armGiveUp(status: OpStatus) {
    if (this.giveUpTimer !== undefined || status.started_at === null || status.timeout === null) return;
    if (status.now === null) return;
    const opId = status.op_id;
    const leftMs = (status.started_at + status.timeout - status.now) * 1000;
    this.giveUpTimer = setTimeout(() => {
      if (this.opId === opId && !ENDED.has(this.view.phase)) {
        this.end({ phase: "lost", opId, error: "The server did not finish this in its time limit. Please try again." });
      }
    }, Math.max(0, leftMs) + GIVE_UP_GRACE_MS);
  }

  private end(view: Extract<OpView, { phase: "finished" | "failed" | "lost" }>) {
    this.stopTimers();
    this.edge.storage.remove();
    this.setView(view);
    if (view.phase === "finished" && !this.finishHandled) {
      this.finishHandled = true;
      void this.edge.onFinished(view.result, this.context, view.opId);
    }
  }

  private stopTimers() {
    clearTimeout(this.pollTimer);
    clearTimeout(this.giveUpTimer);
    this.pollTimer = undefined;
    this.giveUpTimer = undefined;
  }

  private setView(view: OpView) {
    this.view = view;
    this.edge.onView(view, this.context);
  }
}
