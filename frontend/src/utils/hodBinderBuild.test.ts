import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GIVE_UP_GRACE_MS,
  OperationFollower,
  POLL_MS_SOCKET_DOWN,
  type FollowerEdge,
  type OpView,
} from "@/utils/backgroundOps/operationFollower";

import { binderBuildOf, binderStartBlocked, documentStartBlocked } from "./hodBinderBuild";

const OP = "aaaaaaaa-0000-4000-8000-000000000001";
const JOB = { hodSystem: "Made-up System", document: null, title: "Made-up System — Made-up Project" };

describe("binderBuildOf", () => {
  it("shows a build waiting in the queue apart from one that runs", () => {
    expect(binderBuildOf({ phase: "starting", opId: OP }, JOB)).toEqual({
      job: JOB,
      progress: { waiting: true, percent: 0, label: null },
    });
    expect(binderBuildOf({ phase: "queued", opId: OP }, JOB)).toEqual({
      job: JOB,
      progress: { waiting: true, percent: 0, label: null },
    });
    expect(
      binderBuildOf({ phase: "running", opId: OP, progress: { percent: 40, message: "Key List" } }, JOB),
    ).toEqual({ job: JOB, progress: { waiting: false, percent: 40, label: "Key List" } });
    expect(binderBuildOf({ phase: "running", opId: OP, progress: null }, JOB)?.progress).toEqual({
      waiting: false,
      percent: 0,
      label: null,
    });
  });

  it("has no build once it ended or before one started", () => {
    expect(binderBuildOf({ phase: "idle" }, undefined)).toBeNull();
    expect(binderBuildOf({ phase: "finished", opId: OP, result: {} }, JOB)).toBeNull();
    expect(binderBuildOf({ phase: "failed", opId: OP, error: "x" }, JOB)).toBeNull();
    expect(binderBuildOf({ phase: "lost", opId: OP, error: "x" }, JOB)).toBeNull();
  });

  it("names one document's build, and ignores a context that is not a build's", () => {
    const one = { ...JOB, document: "key_list" };
    expect(binderBuildOf({ phase: "queued", opId: OP }, one)?.job).toEqual(one);
    expect(binderBuildOf({ phase: "queued", opId: OP }, { previewOnly: true })).toBeNull();
  });
});

describe("a binder build waiting in the queue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps waiting past five minutes in the queue, and gives up only at its time limit after it starts", async () => {
    const BUILD_TIMEOUT_S = 900; // api/hod/binder.BUILD_TIMEOUT_SECONDS
    let record: Record<string, unknown> = { op_id: OP, state: "queued", now: 1000 };
    const views: OpView[] = [];
    const edge: FollowerEdge = {
      makeId: () => OP,
      readStatus: async () => ({ ...record }),
      socketUp: () => false,
      storage: { get: () => null, set: () => undefined, remove: () => undefined },
      onView: (view) => void views.push(view),
      onFinished: () => undefined,
    };
    await new OperationFollower(edge).start(async () => undefined, JOB);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000); // half an hour behind other operations
    expect(views.at(-1)?.phase).toBe("queued");

    record = { op_id: OP, state: "running", started_at: 2800, timeout: BUILD_TIMEOUT_S, now: 2800, progress: null };
    await vi.advanceTimersByTimeAsync(POLL_MS_SOCKET_DOWN);
    expect(views.at(-1)?.phase).toBe("running");
    await vi.advanceTimersByTimeAsync(BUILD_TIMEOUT_S * 1000 + GIVE_UP_GRACE_MS - POLL_MS_SOCKET_DOWN - 1);
    expect(views.at(-1)?.phase).toBe("running");
    await vi.advanceTimersByTimeAsync(POLL_MS_SOCKET_DOWN + 1);
    expect(views.at(-1)?.phase).toBe("lost");
  });
});

describe("what a system's card may start while this tab follows its builds (#1671)", () => {
  const BINDER = { hodSystem: "HVAC", document: null, title: "HVAC — Made-up Project" };
  const KEY_LIST = { hodSystem: "HVAC", document: "key_list", title: "Key List" };

  it("never holds a document's download back behind a binder, waiting or building", () => {
    expect(documentStartBlocked({ binder: BINDER, document: null }, "HVAC", "commissioning_report")).toBe(false);
  });

  it("holds back another document's download while one is being prepared, but not that row's own", () => {
    const builds = { binder: null, document: KEY_LIST };
    expect(documentStartBlocked(builds, "HVAC", "commissioning_report")).toBe(true);
    expect(documentStartBlocked(builds, "Electrical", "key_list")).toBe(true);
    expect(documentStartBlocked(builds, "HVAC", "key_list")).toBe(false);
  });

  it("holds back another system's binder, never the one building here, and never behind a document", () => {
    expect(binderStartBlocked({ binder: BINDER, document: null }, "Electrical")).toBe(true);
    expect(binderStartBlocked({ binder: BINDER, document: null }, "HVAC")).toBe(false);
    expect(binderStartBlocked({ binder: null, document: KEY_LIST }, "HVAC")).toBe(false);
  });
});
