import { describe, expect, it } from "vitest";

import {
  matchHandoffOf,
  matchPhaseOf,
  suggestButtonReason,
  suggestModalOpensFor,
  suggestViewOf,
} from "./suggestOperation";

const OP = "aaaaaaaa-0000-4000-8000-000000000001";
const MATCH_OP = "bbbbbbbb-0000-4000-8000-000000000002";

describe("suggestViewOf: what the suggest modal shows for the operation the page follows", () => {
  it("tells waiting in the queue apart from running", () => {
    expect(suggestViewOf({ phase: "queued", opId: OP })).toEqual({
      running: true, waitingInQueue: true, progress: null, failure: null,
    });
    const running = suggestViewOf({
      phase: "running", opId: OP, progress: { percent: 50, message: "10 of 20 rows", detail: { done: 10, total: 20 } },
    });
    expect(running).toEqual({ running: true, waitingInQueue: false, progress: { done: 10, total: 20 }, failure: null });
  });

  it("shows a failed or lost suggest in the server's words", () => {
    const words = "The suggestion run stopped unexpectedly. Anything already extracted was kept.";
    expect(suggestViewOf({ phase: "failed", opId: OP, error: words }).failure)
      .toEqual({ status: "error", run_status: "failed", halt_reason: words });
    expect(suggestViewOf({ phase: "lost", opId: OP, error: "The server stopped." }).failure?.halt_reason)
      .toBe("The server stopped.");
  });

  it("is not running once the operation finished", () => {
    expect(suggestViewOf({ phase: "finished", opId: OP, result: {} }).running).toBe(false);
    expect(suggestViewOf({ phase: "idle" }).running).toBe(false);
  });
});

describe("matchHandoffOf: the match a finished suggest queued", () => {
  it("names the match operation to follow", () => {
    expect(matchHandoffOf({ status: "success", match: { queued: true, run: "made-up-run", op_id: MATCH_OP } }))
      .toEqual({ opId: MATCH_OP, run: "made-up-run" });
  });

  it("gives the reason when no match started, and nothing when matching is off or the run did not complete", () => {
    expect(matchHandoffOf({ status: "success", match: { queued: false, reason: "a match run is already in progress" } }))
      .toEqual({ reason: "a match run is already in progress" });
    expect(matchHandoffOf({ status: "success" })).toBeNull();
    expect(matchHandoffOf({ status: "partial", match: { queued: true, run: "x", op_id: MATCH_OP } })).toBeNull();
  });
});

describe("matchPhaseOf: the match phase of the suggest modal", () => {
  it("shows a match waiting in the queue as queued", () => {
    expect(matchPhaseOf({ phase: "queued", opId: MATCH_OP })?.state).toBe("queued");
    expect(matchPhaseOf({ phase: "starting", opId: MATCH_OP })?.state).toBe("queued");
  });

  it("shows the running match's own progress and times", () => {
    expect(matchPhaseOf({
      phase: "running", opId: MATCH_OP,
      progress: { percent: 40, message: "4 of 10 rows", detail: { phase: "judge", done: 4, total: 10, seconds: 30, estimate_left_s: 39 } },
    })).toEqual({ state: "running", done: 4, total: 10, elapsedS: 30, leftS: 39 });
  });

  it("ends done, halted or failed in the match's own outcome", () => {
    expect(matchPhaseOf({ phase: "finished", opId: MATCH_OP, result: { status: "success", rows_done: 9, rows_total: 9 } }))
      .toEqual({ state: "done", done: 9, total: 9, elapsedS: 0, leftS: null });
    expect(matchPhaseOf({
      phase: "finished", opId: MATCH_OP, result: { status: "halted", halt_reason: "pool not ready", rows_done: 2, rows_total: 9 },
    })).toEqual({ state: "failed", done: 2, total: 9, elapsedS: 0, leftS: null, reason: "pool not ready" });
    expect(matchPhaseOf({ phase: "failed", opId: MATCH_OP, error: "made-up refusal" })?.reason).toBe("made-up refusal");
    expect(matchPhaseOf({ phase: "idle" })).toBeNull();
  });
});

describe("suggestModalOpensFor: a reload during a suggest or its match shows it again (#1654 story 18)", () => {
  const idle = { phase: "idle" } as const;

  it("opens for a suggest the page picked up again, once", () => {
    const resumed = { phase: "running", opId: OP, progress: null } as const;
    expect(suggestModalOpensFor(resumed, idle, null)).toBe(OP);
    // Closed by the user while it runs: it stays closed for that operation.
    expect(suggestModalOpensFor(resumed, idle, OP)).toBeNull();
    expect(suggestModalOpensFor({ phase: "queued", opId: OP }, idle, null)).toBe(OP);
  });

  it("opens for a match the page picked up again after its suggest ended", () => {
    expect(suggestModalOpensFor(idle, { phase: "queued", opId: MATCH_OP }, null)).toBe(MATCH_OP);
  });

  it("does not reopen for the match a suggest of this session handed off", () => {
    const finished = { phase: "finished", opId: OP, result: { status: "success" } } as const;
    expect(suggestModalOpensFor(finished, { phase: "running", opId: MATCH_OP, progress: null }, OP)).toBeNull();
  });

  it("opens for nothing when nothing is in flight", () => {
    expect(suggestModalOpensFor(idle, idle, null)).toBeNull();
    expect(suggestModalOpensFor({ phase: "failed", opId: OP, error: "x" }, idle, null)).toBeNull();
  });
});

describe("suggestButtonReason: Suggest rates waits while this sheet's suggest is in flight", () => {
  it("is disabled while the suggest is queued or running, so a second press cannot drop the first", () => {
    expect(suggestButtonReason({ phase: "queued", opId: OP }, null)).toMatch(/already running/);
    expect(suggestButtonReason({ phase: "running", opId: OP, progress: null }, null)).toMatch(/already running/);
  });

  it("keeps the sheet's own reason first, and is enabled once the suggest ended", () => {
    expect(suggestButtonReason({ phase: "running", opId: OP, progress: null }, "Sheet is locked / read-only"))
      .toBe("Sheet is locked / read-only");
    expect(suggestButtonReason({ phase: "finished", opId: OP, result: null }, null)).toBeNull();
    expect(suggestButtonReason({ phase: "idle" }, null)).toBeNull();
  });
});
