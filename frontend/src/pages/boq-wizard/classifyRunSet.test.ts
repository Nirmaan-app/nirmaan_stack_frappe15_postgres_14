import { describe, expect, it } from "vitest";

import type { OpView } from "@/utils/backgroundOps/operationFollower";

import {
  foldEngineView,
  launchRunSet,
  runSetDone,
  runSetProgress,
  runSetWaitingInQueue,
  summariseRunSet,
  type ClassifyRunSet,
} from "./classifyRunSet";

const SHEET = { mode: "sheet" } as const;

const success = (discipline: string, extra: Record<string, unknown> = {}) => ({
  status: "success",
  discipline,
  total_in_range: 4,
  eligible_classified: 3,
  needs_review: 1,
  auto_accepted: 3,
  skipped_total: 0,
  skipped_by_reason: {},
  committed_version: 2,
  sheet_warnings: [],
  ai_status: "ran",
  ...extra,
});

function fold(set: ClassifyRunSet | null, discipline: string, view: OpView): ClassifyRunSet | null {
  return foldEngineView(set, discipline, view, { discipline, scope: SHEET });
}

/** A two-engine click: each engine's operation starts, then the views arrive in the order given. */
function click(...views: Array<[string, OpView]>): ClassifyRunSet | null {
  let set: ClassifyRunSet | null = launchRunSet([
    { discipline: "Electrical", scope: SHEET },
    { discipline: "HVAC", scope: SHEET },
  ]);
  set = fold(set, "Electrical", { phase: "starting", opId: "op-e" });
  set = fold(set, "HVAC", { phase: "starting", opId: "op-h" });
  for (const [discipline, view] of views) set = fold(set, discipline, view);
  return set;
}

describe("a Classify click's run set (one background operation per engine)", () => {
  it("shows an engine that fails first as failed, though the other engine finishes last", () => {
    const set = click(
      ["Electrical", { phase: "failed", opId: "op-e", error: "The operation failed. The error has been logged." }],
      ["HVAC", { phase: "finished", opId: "op-h", result: success("HVAC") }],
    );
    expect(runSetDone(set)).toBe(true);
    const summary = summariseRunSet(set!);
    expect(summary.status).toBe("error");
    expect(summary.engine_outcomes).toEqual([
      { discipline: "Electrical", ok: false, error: "The operation failed. The error has been logged." },
      { discipline: "HVAC", ok: true },
    ]);
  });

  it("shows an engine that fails last as failed too", () => {
    const set = click(
      ["HVAC", { phase: "finished", opId: "op-h", result: success("HVAC") }],
      ["Electrical", { phase: "lost", opId: "op-e", error: "The server stopped while running this operation." }],
    );
    const summary = summariseRunSet(set!);
    expect(summary.status).toBe("error");
    expect(summary.engine_outcomes?.[0]).toEqual({
      discipline: "Electrical", ok: false, error: "The server stopped while running this operation.",
    });
  });

  it("is done only when every engine has ended", () => {
    const set = click(["HVAC", { phase: "finished", opId: "op-h", result: success("HVAC") }]);
    expect(runSetDone(set)).toBe(false);
  });

  it("reports success when every engine finished, with each engine's AI status", () => {
    const set = click(
      ["Electrical", { phase: "finished", opId: "op-e", result: success("Electrical", { ai_status: "disabled" }) }],
      ["HVAC", { phase: "finished", opId: "op-h", result: success("HVAC") }],
    );
    const summary = summariseRunSet(set!);
    expect(summary.status).toBe("success");
    expect(summary.ai_status_by_discipline).toEqual({ Electrical: "disabled", HVAC: "ran" });
    expect(summary.committed_version).toBe(2);
  });

  it("ignores a view of another operation of the same engine", () => {
    const set = click(["Electrical", { phase: "failed", opId: "op-older", error: "an older run" }]);
    expect(set?.engines.find((e) => e.discipline === "Electrical")?.outcome).toBeNull();
  });

  it("waits in the queue until an engine starts running, and sums the engines' progress", () => {
    let set = click(["Electrical", { phase: "queued", opId: "op-e" }], ["HVAC", { phase: "queued", opId: "op-h" }]);
    expect(runSetWaitingInQueue(set)).toBe(true);
    set = fold(set, "Electrical", {
      phase: "running", opId: "op-e", progress: { percent: 35, message: null, detail: { done: 20, total: 57 } },
    });
    expect(runSetWaitingInQueue(set)).toBe(false);
    set = fold(set, "HVAC", {
      phase: "running", opId: "op-h", progress: { percent: 10, message: null, detail: { done: 5, total: 50 } },
    });
    expect(runSetProgress(set)).toEqual({ done: 25, total: 107 });
    set = fold(set, "HVAC", { phase: "finished", opId: "op-h", result: success("HVAC") });
    expect(runSetProgress(set)).toEqual({ done: 70, total: 107 });
  });

  it("picks up an engine's operation after a reload, with the scope it was started with", () => {
    const range = { mode: "range", start: 10, end: 20 } as const;
    let set = foldEngineView(null, "HVAC", { phase: "queued", opId: "op-h" }, { discipline: "HVAC", scope: range });
    expect(set?.engines.map((e) => [e.discipline, e.scope])).toEqual([["HVAC", range]]);
    set = fold(set, "HVAC", { phase: "finished", opId: "op-h", result: success("HVAC") });
    expect(runSetDone(set)).toBe(true);
  });
});
