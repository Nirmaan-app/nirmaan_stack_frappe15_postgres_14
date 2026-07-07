// Unit tests for sheetCardStages.ts -- the PURE effective-status -> 3-zone mapping
// (mockup §06 / plan WI-2 B-2). Asserts the full mapping table: all 8 effective
// statuses + committed variants + the aside cases.
import { describe, it, expect } from "vitest";
import { computeSheetStages } from "./sheetCardStages";
import type { CommittedSheetState } from "./boqTypes";

// Minimal committed-state fixture (only presence lights ③; the fields are display-only).
const committed: CommittedSheetState = {
  sheet_name: "Sheet A",
  committed_at: "2026-07-06 15:10:00",
  commit_version: 2,
  sheet_order: 0,
  sheet_disposition: "grid_and_nodes",
};

const base = { effectiveStatus: "", hasPriorParse: false } as const;

describe("computeSheetStages -- normal pipeline (aside null)", () => {
  it("Pending -> ① active dot, ② unreached, ③ unreached; buttons in ①", () => {
    const s = computeSheetStages({ ...base, effectiveStatus: "Pending" });
    expect(s.aside).toBeNull();
    expect(s.buttonZone).toBe(1);
    expect(s.stage1.state).toBe("active");
    expect(s.stage1.marker).toEqual({ kind: "dot", label: "Pending", accent: "pending", sub: "not configured" });
    expect(s.stage2).toEqual({ state: "unreached", marker: { kind: "muted", label: "— not started" } });
    expect(s.stage3).toEqual({ state: "unreached", marker: { kind: "muted", label: "— not committed" } });
  });

  it("Config Done -> ① active-done tick, ② unreached 'awaiting parse', ③ unreached; buttons in ①", () => {
    const s = computeSheetStages({ ...base, effectiveStatus: "Config Done" });
    expect(s.aside).toBeNull();
    expect(s.buttonZone).toBe(1);
    expect(s.stage1.state).toBe("active-done");
    expect(s.stage1.marker).toEqual({ kind: "tick", label: "Config Done", accent: "config" });
    expect(s.stage2).toEqual({ state: "unreached", marker: { kind: "muted", label: "— awaiting parse" } });
    expect(s.stage3.state).toBe("unreached");
  });

  it("Parse failed -> ① done tick, ② active dot (failed), ③ unreached; buttons in ②", () => {
    const s = computeSheetStages({ ...base, effectiveStatus: "Parse failed" });
    expect(s.aside).toBeNull();
    expect(s.buttonZone).toBe(2);
    expect(s.stage1).toEqual({ state: "done", marker: { kind: "tick", label: "Config Done", accent: "config" } });
    expect(s.stage2.state).toBe("active");
    expect(s.stage2.marker).toEqual({ kind: "dot", label: "Parse failed", accent: "failed" });
    expect(s.stage3.state).toBe("unreached");
  });

  it("Parsed -> ① done tick, ② active dot (parsed), ③ unreached; buttons in ②", () => {
    const s = computeSheetStages({ ...base, effectiveStatus: "Parsed" });
    expect(s.buttonZone).toBe(2);
    expect(s.stage1.state).toBe("done");
    expect(s.stage2.marker).toEqual({ kind: "dot", label: "Parsed", accent: "parsed" });
    expect(s.stage3.state).toBe("unreached");
  });

  it("Finalized -> ① done tick, ② active-done tick (final), ③ unreached; buttons in ②", () => {
    const s = computeSheetStages({ ...base, effectiveStatus: "Finalized" });
    expect(s.buttonZone).toBe(2);
    expect(s.stage1.state).toBe("done");
    expect(s.stage2.state).toBe("active-done");
    expect(s.stage2.marker).toEqual({ kind: "tick", label: "Finalized", accent: "final" });
    expect(s.stage3.state).toBe("unreached");
  });
});

describe("computeSheetStages -- committed variants light ③", () => {
  it("Finalized + committed -> ③ committed (buttons stay in ②)", () => {
    const s = computeSheetStages({ ...base, effectiveStatus: "Finalized", committed });
    expect(s.buttonZone).toBe(2);
    expect(s.stage3.state).toBe("committed");
  });

  it("Config Done + committed -> ③ committed", () => {
    const s = computeSheetStages({ ...base, effectiveStatus: "Config Done", committed });
    expect(s.stage3.state).toBe("committed");
  });

  it("Parsed + committed (re-parsed frozen version) -> ③ committed", () => {
    const s = computeSheetStages({ ...base, effectiveStatus: "Parsed", committed });
    expect(s.stage3.state).toBe("committed");
  });

  it("General specs + committed -> ③ committed; without committed -> ③ hidden", () => {
    const withC = computeSheetStages({ ...base, effectiveStatus: "General specs", committed });
    expect(withC.stage3.state).toBe("committed");
    const noC = computeSheetStages({ ...base, effectiveStatus: "General specs" });
    expect(noC.stage3.state).toBe("hidden");
  });
});

describe("computeSheetStages -- aside (rail collapses)", () => {
  it("Skip -> aside 'skip', ① active badge, ②③ not rendered (na/hidden); buttons in ①", () => {
    const s = computeSheetStages({ ...base, effectiveStatus: "Skip" });
    expect(s.aside).toBe("skip");
    expect(s.buttonZone).toBe(1);
    expect(s.stage1.state).toBe("active");
    expect(s.stage1.marker).toEqual({ kind: "badge", label: "Skipped", accent: "skip", sub: "set aside from this workbook" });
    expect(s.stage2.state).toBe("na");
    expect(s.stage3.state).toBe("hidden");
  });

  it("Hidden -> aside 'hidden', ① active badge, ②③ not rendered; buttons in ①", () => {
    const s = computeSheetStages({ ...base, effectiveStatus: "Hidden" });
    expect(s.aside).toBe("hidden");
    expect(s.buttonZone).toBe(1);
    expect(s.stage1.marker).toEqual({ kind: "badge", label: "Hidden", accent: "hidden", sub: "auto-hidden non-data sheet" });
    expect(s.stage2.state).toBe("na");
    expect(s.stage3.state).toBe("hidden");
  });

  it("General specs -> aside 'general_specs', ① active badge, ② na, NO button zone", () => {
    const s = computeSheetStages({ ...base, effectiveStatus: "General specs" });
    expect(s.aside).toBe("general_specs");
    expect(s.buttonZone).toBeNull();
    expect(s.stage1.marker).toEqual({ kind: "badge", label: "General specs", accent: "gspec", sub: "preamble-only sheet" });
    expect(s.stage2.state).toBe("na");
  });
});

describe("computeSheetStages -- fallback", () => {
  it("an unknown/empty status falls back to the Pending shape", () => {
    const unknown = computeSheetStages({ ...base, effectiveStatus: "Zzz" });
    const pending = computeSheetStages({ ...base, effectiveStatus: "Pending" });
    expect(unknown).toEqual(pending);
    // the "" default too
    expect(computeSheetStages({ ...base, effectiveStatus: "" })).toEqual(pending);
  });
});
