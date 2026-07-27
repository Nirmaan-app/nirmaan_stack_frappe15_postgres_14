// Unit tests for the pure helpers in ClassifySheetDialog (BoQ Phase 5 CL-2 classify-sheet UI).
//
// These pin the launch/progress/summary logic that the JSX dialog + SheetPricingPage depend on
// (engine gating, range validation, monotonic progress folding, the skip rollup wording). The JSX
// itself is manual-cert; only these pure fns are tested. (Slice G2e: the needs-review verdict
// predicate isNeedsReviewCategory was retired; its replacement isMasterSetBlank is tested in
// PricingGrid.test.ts, where the predicate now lives.)
import { describe, it, expect } from "vitest";
import {
  selectableEngines,
  validateRange,
  buildStartArgs,
  clampDone,
  reduceProgress,
  skipRollupText,
  aiStatusNote,
} from "./ClassifySheetDialog";
import type { EngineOption } from "./boqTypes";

const engine = (over: Partial<EngineOption> = {}): EngineOption => ({
  id: "electrical",
  label: "Electrical",
  discipline: "Electrical",
  available: true,
  ...over,
});

describe("selectableEngines", () => {
  it("keeps only available engines", () => {
    const engines = [
      engine({ id: "electrical", available: true }),
      engine({ id: "plumbing", available: false }),
      engine({ id: "hvac", available: false }),
    ];
    const out = selectableEngines(engines);
    expect(out.map((e) => e.id)).toEqual(["electrical"]);
  });

  it("returns [] when nothing is available", () => {
    expect(selectableEngines([engine({ available: false })])).toEqual([]);
  });
});

describe("validateRange", () => {
  it("accepts start <= end", () => {
    expect(validateRange(3, 10)).toEqual({ ok: true });
    expect(validateRange(5, 5)).toEqual({ ok: true });
  });

  it("rejects start > end", () => {
    const r = validateRange(10, 3);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("rejects NaN bounds", () => {
    expect(validateRange(NaN, 10).ok).toBe(false);
    expect(validateRange(3, NaN).ok).toBe(false);
  });

  it("rejects negative bounds", () => {
    expect(validateRange(-1, 5).ok).toBe(false);
  });
});

describe("buildStartArgs", () => {
  it("returns the engine discipline + the given scope", () => {
    const scope = { mode: "range", start: 2, end: 8 } as const;
    expect(buildStartArgs(engine({ discipline: "Electrical" }), scope)).toEqual({
      discipline: "Electrical",
      scope,
    });
  });

  it("passes a whole-sheet scope through", () => {
    const scope = { mode: "sheet" } as const;
    expect(buildStartArgs(engine(), scope)).toEqual({ discipline: "Electrical", scope });
  });
});

describe("clampDone", () => {
  it("clamps above total", () => {
    expect(clampDone(15, 10)).toBe(10);
  });

  it("floors at 0", () => {
    expect(clampDone(-3, 10)).toBe(0);
  });

  it("passes an in-range value through", () => {
    expect(clampDone(4, 10)).toBe(4);
  });
});

describe("reduceProgress", () => {
  it("clamps done to total", () => {
    expect(reduceProgress(null, { done: 99, total: 10 })).toEqual({ done: 10, total: 10 });
  });

  it("is monotonic non-decreasing when totals match", () => {
    const prev = { done: 7, total: 10 };
    expect(reduceProgress(prev, { done: 3, total: 10 })).toEqual({ done: 7, total: 10 });
    expect(reduceProgress(prev, { done: 9, total: 10 })).toEqual({ done: 9, total: 10 });
  });

  it("resets when the total changes", () => {
    const prev = { done: 7, total: 10 };
    expect(reduceProgress(prev, { done: 2, total: 20 })).toEqual({ done: 2, total: 20 });
  });
});

describe("skipRollupText", () => {
  it("is empty for no skips", () => {
    expect(skipRollupText({})).toBe("");
    expect(skipRollupText({ note: 0 })).toBe("");
  });

  it("renders friendly words with pluralization", () => {
    expect(skipRollupText({ note: 3, subtotal: 1 })).toBe(
      "3 note rows, 1 subtotal row skipped",
    );
  });
});

describe("aiStatusNote", () => {
  it("notes when the AI voter was disabled or keyless, else empty", () => {
    expect(aiStatusNote("disabled")).toContain("AI voter was off");
    expect(aiStatusNote("no_key")).toContain("AI key is not configured");
    expect(aiStatusNote("ran")).toBe("");
    expect(aiStatusNote(null)).toBe("");
    expect(aiStatusNote(undefined)).toBe("");
  });
});
