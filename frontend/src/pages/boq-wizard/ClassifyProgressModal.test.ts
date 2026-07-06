// Unit tests for the pure helpers in ClassifyProgressModal (BoQ Phase 5 -- classify progress modal).
//
// These pin the phase derivation (starting/running/success/error) and the bar percent (0-of-0
// guard) that the blocking modal's dismiss-gating + progress bar depend on. The JSX modal itself
// is manual-cert; only these pure fns are tested.
import { describe, it, expect } from "vitest";
import { deriveClassifyModalPhase, classifyPercent } from "./ClassifyProgressModal";

describe("deriveClassifyModalPhase", () => {
  it("running with known progress -> running (determinate bar)", () => {
    expect(deriveClassifyModalPhase(true, { done: 20, total: 57 }, null)).toBe("running");
  });

  it("running with no progress yet -> starting (indeterminate, pre-first-batch)", () => {
    expect(deriveClassifyModalPhase(true, null, null)).toBe("starting");
  });

  it("running with a zero-total progress -> starting (no 0-of-0 bar)", () => {
    expect(deriveClassifyModalPhase(true, { done: 0, total: 0 }, null)).toBe("starting");
  });

  it("terminal with an error summary -> error", () => {
    expect(deriveClassifyModalPhase(false, null, { status: "error" })).toBe("error");
  });

  it("terminal with a success summary -> success", () => {
    expect(deriveClassifyModalPhase(false, null, { status: "success" })).toBe("success");
  });

  it("terminal with no summary -> success (harmless default; modal only opens with a summary)", () => {
    expect(deriveClassifyModalPhase(false, null, null)).toBe("success");
  });

  it("running WINS over a terminal-looking summary (done flips running=false upstream)", () => {
    // While running is still true, an error summary must not flip the phase to error.
    expect(deriveClassifyModalPhase(true, { done: 3, total: 3 }, { status: "error" })).toBe("running");
  });
});

describe("classifyPercent", () => {
  it("null progress -> 0", () => {
    expect(classifyPercent(null)).toBe(0);
  });

  it("zero total -> 0 (guards the divide)", () => {
    expect(classifyPercent({ done: 0, total: 0 })).toBe(0);
  });

  it("rounds to the nearest whole percent", () => {
    expect(classifyPercent({ done: 20, total: 57 })).toBe(35); // 35.08 -> 35
    expect(classifyPercent({ done: 1, total: 3 })).toBe(33); // 33.33 -> 33
  });

  it("complete -> 100", () => {
    expect(classifyPercent({ done: 57, total: 57 })).toBe(100);
  });
});
