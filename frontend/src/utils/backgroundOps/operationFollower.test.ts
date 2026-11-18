import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GIVE_UP_GRACE_MS,
  OperationFollower,
  POLL_MS_SOCKET_DOWN,
  POLL_MS_SOCKET_UP,
  type FollowerEdge,
  type OpView,
} from "./operationFollower";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

/** The server as the follower sees it: each read answers with the record the test last set. */
function fakeEdge(overrides: Partial<FollowerEdge> = {}) {
  const store = new Map<string, string>();
  let record: Record<string, unknown> = { op_id: A, state: "queued", now: 1000 };
  const views: OpView[] = [];
  const finished: Array<{ result: unknown; context: unknown }> = [];
  const edge: FollowerEdge = {
    makeId: () => A,
    readStatus: vi.fn(async () => ({ ...record })),
    socketUp: () => false,
    storage: {
      get: () => store.get("op") ?? null,
      set: (value) => void store.set("op", value),
      remove: () => void store.delete("op"),
    },
    onView: (view) => void views.push(view),
    onFinished: (result, context) => void finished.push({ result, context }),
    ...overrides,
  };
  return {
    edge,
    views,
    finished,
    store,
    reads: () => (edge.readStatus as ReturnType<typeof vi.fn>).mock.calls.length,
    serverSays: (next: Record<string, unknown>) => {
      record = { op_id: A, now: 1000, ...next };
    },
    last: () => views[views.length - 1],
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("OperationFollower", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tells waiting in the queue apart from running, and shows the record's progress", async () => {
    const f = fakeEdge();
    const follower = new OperationFollower(f.edge);
    await follower.start(async () => undefined);
    expect(f.last()).toEqual({ phase: "queued", opId: A });

    f.serverSays({ state: "running", started_at: 1000, timeout: 600, progress: { percent: 40, message: "Item 4" } });
    await vi.advanceTimersByTimeAsync(POLL_MS_SOCKET_DOWN);
    expect(f.last()).toEqual({ phase: "running", opId: A, progress: { percent: 40, message: "Item 4" } });
  });

  it("polls about every 10 s while the socket is up and every 3 s while it is down", async () => {
    let up = true;
    const f = fakeEdge({ socketUp: () => up });
    const follower = new OperationFollower(f.edge);
    await follower.start(async () => undefined);
    const afterStart = f.reads();
    await vi.advanceTimersByTimeAsync(POLL_MS_SOCKET_UP - 1);
    expect(f.reads()).toBe(afterStart);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.reads()).toBe(afterStart + 1);

    // The socket drops mid-wait: the next read comes 3 s later, not at the end of the 10 s wait.
    up = false;
    follower.socketChanged();
    await vi.advanceTimersByTimeAsync(POLL_MS_SOCKET_DOWN);
    expect(f.reads()).toBe(afterStart + 2);
    expect(POLL_MS_SOCKET_UP).toBe(10_000);
    expect(POLL_MS_SOCKET_DOWN).toBe(3_000);
  });

  it("reads at once on its own operation's message and ignores another operation's", async () => {
    const f = fakeEdge({ socketUp: () => true });
    const follower = new OperationFollower(f.edge);
    await follower.start(async () => undefined);
    const before = f.reads();

    follower.readNow(B);
    await flush();
    expect(f.reads()).toBe(before);

    f.serverSays({ state: "running", started_at: 1000, timeout: 600 });
    follower.readNow(A);
    await flush();
    expect(f.reads()).toBe(before + 1);
    expect(f.last().phase).toBe("running");
  });

  it("never takes another operation's record", async () => {
    const f = fakeEdge();
    await new OperationFollower(f.edge).start(async () => undefined);
    f.serverSays({ op_id: B, state: "finished", result: { mine: false } });
    await vi.advanceTimersByTimeAsync(POLL_MS_SOCKET_DOWN);
    expect(f.finished).toEqual([]);
    expect(f.last()).toEqual({ phase: "queued", opId: A });
  });

  it("shows lost when the server has no record", async () => {
    const f = fakeEdge();
    f.serverSays({ state: "lost", error: "The server has no record of this operation." });
    await new OperationFollower(f.edge).start(async () => undefined);
    expect(f.last()).toEqual({ phase: "lost", opId: A, error: "The server has no record of this operation." });
  });

  it("handles a finish once, however many reads and messages see it", async () => {
    const f = fakeEdge({ socketUp: () => true });
    const follower = new OperationFollower(f.edge);
    await follower.start(async () => undefined, { previewOnly: true });
    f.serverSays({ state: "finished", result: { failed_items: [] } });
    follower.readNow(A);
    follower.readNow(A);
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_MS_SOCKET_UP * 3);
    follower.readNow(A);
    await flush();

    expect(f.finished).toEqual([{ result: { failed_items: [] }, context: { previewOnly: true } }]);
    expect(f.last()).toEqual({ phase: "finished", opId: A, result: { failed_items: [] } });
  });

  it("keeps an ended state: a late read of an earlier state does not undo it", async () => {
    const f = fakeEdge();
    await new OperationFollower(f.edge).start(async () => undefined);
    f.serverSays({ state: "failed", error: "Nothing to export." });
    await vi.advanceTimersByTimeAsync(POLL_MS_SOCKET_DOWN);
    f.serverSays({ state: "running", started_at: 1000, timeout: 600 });
    await vi.advanceTimersByTimeAsync(POLL_MS_SOCKET_DOWN * 2);
    expect(f.last()).toEqual({ phase: "failed", opId: A, error: "Nothing to export." });
  });

  it("gives up only after the time limit counted from the start of running, never on time in the queue", async () => {
    const f = fakeEdge();
    await new OperationFollower(f.edge).start(async () => undefined);
    // An hour in the queue is not a reason to give up.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(f.last().phase).toBe("queued");

    // Running for 100 s of its 600 s by the server's clock; the server stops answering from here on.
    f.serverSays({ state: "running", started_at: 5000, timeout: 600, now: 5100 });
    await vi.advanceTimersByTimeAsync(POLL_MS_SOCKET_DOWN);
    (f.edge.readStatus as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));

    await vi.advanceTimersByTimeAsync(500_000 + GIVE_UP_GRACE_MS - POLL_MS_SOCKET_DOWN - 1);
    expect(f.last().phase).toBe("running");
    await vi.advanceTimersByTimeAsync(POLL_MS_SOCKET_DOWN + 1);
    expect(f.last().phase).toBe("lost");
    expect(f.store.size).toBe(0);
  });

  it("picks the operation up again after a reload, and forgets it once it ends", async () => {
    const f = fakeEdge();
    await new OperationFollower(f.edge).start(async () => undefined, { previewOnly: false });
    expect(f.store.size).toBe(1);

    // The page reloads: a new follower over the same tab storage.
    const reloaded = fakeEdge({ storage: f.edge.storage });
    reloaded.serverSays({ state: "finished", result: { failed_items: [] } });
    new OperationFollower(reloaded.edge).resume();
    await flush();
    expect(reloaded.finished).toEqual([{ result: { failed_items: [] }, context: { previewOnly: false } }]);
    expect(f.store.size).toBe(0);

    const later = fakeEdge({ storage: f.edge.storage });
    new OperationFollower(later.edge).resume();
    await flush();
    expect(later.reads()).toBe(0);
  });

  it("fails only its own operation when the server refuses to start it", async () => {
    const f = fakeEdge();
    await new OperationFollower(f.edge).start(async () => {
      throw new Error("This operation id is already in use.");
    });
    expect(f.last()).toEqual({ phase: "failed", opId: A, error: "This operation id is already in use." });
    expect(f.reads()).toBe(0);
    expect(f.store.size).toBe(0);
  });

  it("a disposed follower does not act on a read that lands after it was disposed", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const f = fakeEdge({ readStatus: vi.fn(() => new Promise((resolve) => { answer = resolve; })) });
    f.store.set("op", JSON.stringify({ opId: A, context: null }));
    const follower = new OperationFollower(f.edge);
    follower.resume();
    follower.dispose();
    answer({ op_id: A, state: "finished", result: {} });
    await flush();
    expect(f.finished).toEqual([]);
  });

  it("stops polling once disposed", async () => {
    const f = fakeEdge();
    const follower = new OperationFollower(f.edge);
    await follower.start(async () => undefined);
    const before = f.reads();
    follower.dispose();
    await vi.advanceTimersByTimeAsync(POLL_MS_SOCKET_DOWN * 5);
    expect(f.reads()).toBe(before);
  });
});
