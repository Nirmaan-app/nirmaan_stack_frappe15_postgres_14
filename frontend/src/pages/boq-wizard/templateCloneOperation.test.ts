import { describe, expect, it } from "vitest";

import { cloneOutcome, cloneSheetCountOf } from "./templateCloneOperation";

const OP = "5d0c2f8e-6a1b-4c3d-8e9f-0a1b2c3d4e5f";

describe("cloneOutcome: what a template clone operation's view means on the Create from Template screen", () => {
  it("is the picker until a clone starts", () => {
    expect(cloneOutcome({ phase: "idle" }).status).toBe("idle");
  });

  it("tells waiting in the queue apart from building", () => {
    expect(cloneOutcome({ phase: "starting", opId: OP }).status).toBe("creating");
    expect(cloneOutcome({ phase: "queued", opId: OP }).status).toBe("queued");
    expect(cloneOutcome({ phase: "running", opId: OP, progress: null }).status).toBe("building");
  });

  it("a finished clone that made the BoQ is done, with that BoQ", () => {
    expect(cloneOutcome({ phase: "finished", opId: OP, result: { status: "success", boq_name: "BOQ-26-00042" } }))
      .toEqual({ status: "done", boqName: "BOQ-26-00042", message: null });
  });

  it("a master sheet removed meanwhile says so", () => {
    const outcome = cloneOutcome({
      phase: "finished", opId: OP, result: { status: "error", error_code: "template_changed", boq_name: "BOQ-26-1" },
    });
    expect(outcome.status).toBe("error");
    expect(outcome.message).toMatch(/master template changed/);
  });

  it("a failed or lost clone shows the server's words", () => {
    expect(cloneOutcome({ phase: "failed", opId: OP, error: "The operation failed. The error has been logged." }))
      .toEqual({ status: "error", boqName: null, message: "The operation failed. The error has been logged." });
    expect(cloneOutcome({ phase: "lost", opId: OP, error: "The server stopped while running this operation." }))
      .toEqual({ status: "error", boqName: null, message: "The server stopped while running this operation." });
  });

  it("reads the sheet count a clone started with from its context, so a reload still says it", () => {
    expect(cloneSheetCountOf({ sheetCount: 3 })).toBe(3);
    expect(cloneSheetCountOf(undefined)).toBeNull();
    expect(cloneSheetCountOf({ sheetCount: "3" })).toBeNull();
  });
});
