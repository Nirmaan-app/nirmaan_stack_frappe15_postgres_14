// HV-10 -- pure helper tests for the multi-engine pricing editor.
import { describe, it, expect } from "vitest";
import {
  acceptClassifyEvent,
  addRunningDisciplines,
  buildSheetEngineCatalogs,
  removeRunningDiscipline,
  resolvedToSheetCategoryRow,
  summariseResolvedOutcome,
  unionScopes,
} from "./sheetCategoryResolve";
import type { EngineCatalog, ResolvedSheetCategory } from "./boqTypes";

function resolved(over: Partial<ResolvedSheetCategory>): ResolvedSheetCategory {
  return {
    excel_row: 1,
    effective_category_id: "",
    effective_source: "blank",
    resolved_discipline: null,
    cross_engine_conflict: false,
    human_category_id: "",
    human_discipline: null,
    votes: {},
    ...over,
  };
}

describe("resolvedToSheetCategoryRow (adapter -> grid shape)", () => {
  it("auto source -> Auto-accepted routing, category shown, no human", () => {
    const r = resolvedToSheetCategoryRow(
      resolved({ effective_source: "auto", effective_category_id: "hvac_piping" }),
    );
    expect(r.routing).toBe("Auto-accepted");
    expect(r.effective_category_id).toBe("hvac_piping");
    expect(r.final_category_id).toBe("hvac_piping");
    expect(r.human_category_id).toBe("");
  });

  it("human source -> the human verdict is carried (deriveVerdictState reads 'human')", () => {
    const r = resolvedToSheetCategoryRow(
      resolved({
        effective_source: "human",
        effective_category_id: "hvac_adp",
        human_category_id: "hvac_adp",
      }),
    );
    expect(r.human_category_id).toBe("hvac_adp");
    expect(r.effective_category_id).toBe("hvac_adp");
    expect(r.routing).toBe("Auto-accepted");
  });

  it("blank source -> Needs review routing + blank effective (amber 'needs a category')", () => {
    const r = resolvedToSheetCategoryRow(resolved({ effective_source: "blank" }));
    expect(r.routing).toBe("Needs review");
    expect(r.effective_category_id).toBe("");
    expect(r.final_category_id).toBe("");
    expect(r.human_category_id).toBe("");
  });

  it("NEVER carries telemetry -- the SheetCategoryRow has no conflict / votes / priority field", () => {
    const r = resolvedToSheetCategoryRow(
      resolved({ effective_source: "auto", cross_engine_conflict: true, effective_category_id: "x" }),
    ) as unknown as Record<string, unknown>;
    expect("cross_engine_conflict" in r).toBe(false);
    expect("votes" in r).toBe(false);
    expect("review_priority" in r).toBe(false);
  });
});

describe("acceptClassifyEvent (membership, not equality)", () => {
  it("accepts a discipline the sheet ran", () => {
    expect(acceptClassifyEvent("HVAC", ["HVAC"], [])).toBe(true);
  });
  it("accepts a discipline currently running even before it has rows (first-ever run)", () => {
    expect(acceptClassifyEvent("HVAC", [], ["HVAC"])).toBe(true);
  });
  it("rejects an unrelated discipline", () => {
    expect(acceptClassifyEvent("ELV", ["HVAC"], ["Electrical"])).toBe(false);
  });
});

describe("running-set helpers", () => {
  it("addRunningDisciplines dedups and preserves order", () => {
    expect(addRunningDisciplines(["HVAC"], ["Electrical", "HVAC"])).toEqual(["HVAC", "Electrical"]);
  });
  it("removeRunningDiscipline drops exactly one", () => {
    expect(removeRunningDiscipline(["HVAC", "Electrical"], "HVAC")).toEqual(["Electrical"]);
  });
  it("removeRunningDiscipline is a no-op for an absent discipline", () => {
    expect(removeRunningDiscipline(["HVAC"], "ELV")).toEqual(["HVAC"]);
  });
});

describe("buildSheetEngineCatalogs (grouped picker, N-generic)", () => {
  const cat = (discipline: string, ids: string[]): EngineCatalog => ({
    discipline,
    label: discipline,
    categories: ids.map((id) => ({ id, label: id.toUpperCase() })),
  });

  it("single-engine sheet -> one group, registry label", () => {
    const out = buildSheetEngineCatalogs(
      ["Electrical"],
      { Electrical: cat("Electrical", ["panels"]) },
      { Electrical: "Electrical" },
    );
    expect(out).toHaveLength(1);
    expect(out[0].discipline).toBe("Electrical");
    expect(out[0].label).toBe("Electrical");
  });

  it("multi-engine sheet -> one group per ran discipline, in ran order", () => {
    const out = buildSheetEngineCatalogs(
      ["Electrical", "HVAC"],
      { Electrical: cat("Electrical", ["panels"]), HVAC: cat("HVAC", ["hvac_piping"]) },
      { Electrical: "Electrical", HVAC: "HVAC" },
    );
    expect(out.map((g) => g.discipline)).toEqual(["Electrical", "HVAC"]);
  });

  it("a ran discipline whose catalog has not loaded yet is skipped (appears later)", () => {
    const out = buildSheetEngineCatalogs(
      ["Electrical", "HVAC"],
      { Electrical: cat("Electrical", ["panels"]) },
      {},
    );
    expect(out.map((g) => g.discipline)).toEqual(["Electrical"]);
  });

  it("falls back to the discipline string when the registry has no label", () => {
    const out = buildSheetEngineCatalogs(["Plumbing"], { Plumbing: cat("Plumbing", ["p"]) }, {});
    expect(out[0].label).toBe("Plumbing");
  });

  it("a SYNTHETIC engine flows through with zero special-casing (N-generic guard)", () => {
    const out = buildSheetEngineCatalogs(
      ["Plumbing"],
      { Plumbing: cat("Plumbing", ["plumbing_pipe"]) },
      { Plumbing: "Plumbing" },
    );
    expect(out[0].categories.map((c) => c.id)).toEqual(["plumbing_pipe"]);
  });
});

// ── HV-10b: completion summary = combined effective outcome ─────────────────────────

/** A minimal resolved row for the summary helper (it reads only excel_row + effective). */
function erow(excel_row: number, effective: string): Pick<ResolvedSheetCategory, "excel_row" | "effective_category_id"> {
  return { excel_row, effective_category_id: effective };
}

describe("unionScopes (one run set's per-engine ranges -> one ScopeUnion)", () => {
  it("empty scopes -> whole sheet (defensive: never under-report)", () => {
    expect(unionScopes([])).toEqual({ mode: "sheet" });
  });

  it("a single whole-sheet scope -> whole sheet", () => {
    expect(unionScopes([{ mode: "sheet" }])).toEqual({ mode: "sheet" });
  });

  it("a single range -> exactly its inclusive Excel rows", () => {
    expect(unionScopes([{ mode: "range", start: 14, end: 17 }])).toEqual({
      mode: "rows",
      rows: [14, 15, 16, 17],
    });
  });

  it("two disjoint ranges -> the sorted union of both", () => {
    expect(unionScopes([{ mode: "range", start: 2, end: 4 }, { mode: "range", start: 6, end: 7 }])).toEqual({
      mode: "rows",
      rows: [2, 3, 4, 6, 7],
    });
  });

  it("overlapping ranges dedup", () => {
    expect(unionScopes([{ mode: "range", start: 2, end: 5 }, { mode: "range", start: 4, end: 8 }])).toEqual({
      mode: "rows",
      rows: [2, 3, 4, 5, 6, 7, 8],
    });
  });

  it("MIXED case (owner condition 1): one whole-sheet + one range -> whole sheet dominates", () => {
    expect(
      unionScopes([{ mode: "sheet" }, { mode: "range", start: 14, end: 17 }]),
    ).toEqual({ mode: "sheet" });
  });

  it("RESET between run sets: each call depends only on its own scopes (no accumulation)", () => {
    // The page REPLACES scopeUnionRef with unionScopes(<this run set's scopes>) on every onStarted,
    // so a fresh run set never carries a prior set's rows. Modelled here as two sequential calls.
    const runSet1 = unionScopes([{ mode: "range", start: 2, end: 5 }]);
    const runSet2 = unionScopes([{ mode: "range", start: 14, end: 17 }]);
    expect(runSet1).toEqual({ mode: "rows", rows: [2, 3, 4, 5] });
    expect(runSet2).toEqual({ mode: "rows", rows: [14, 15, 16, 17] }); // no 2..5 leaked in
  });
});

describe("summariseResolvedOutcome (combined effective over the resolved read)", () => {
  it("EQUALITY BY CONSTRUCTION: single-engine whole sheet, no human -> the engine's own numbers", () => {
    // 3 auto-accepted (non-blank effective) + 2 needs-review (blank) == a single engine's payload
    // {eligible_classified:3, needs_review:2}. The combined split must equal that exactly.
    const rows = [erow(2, "panels"), erow(3, "cables"), erow(4, "earthing"), erow(5, ""), erow(6, "")];
    expect(summariseResolvedOutcome(rows, { mode: "sheet" })).toEqual({ categorised: 3, review: 2 });
  });

  it("CONCURRENT two-engine E2E shape: 16 rows -> combined 7 categorised / 9 review", () => {
    // Rows 7-9 (Electrical: DB and Switchgear) + 10-13 (HVAC: Ducting) resolve non-blank = 7;
    // rows 2-6 + 14-17 resolve blank = 9. This is the split the grid showed; the per-engine
    // denominators (13 / 12 review) must NOT appear.
    const rows = [
      erow(2, ""), erow(3, ""), erow(4, ""), erow(5, ""), erow(6, ""),
      erow(7, "db_switchgear"), erow(8, "db_switchgear"), erow(9, "db_switchgear"),
      erow(10, "hvac_ducting"), erow(11, "hvac_ducting"), erow(12, "hvac_ducting"), erow(13, "hvac_ducting"),
      erow(14, ""), erow(15, ""), erow(16, ""), erow(17, ""),
    ];
    expect(summariseResolvedOutcome(rows, { mode: "sheet" })).toEqual({ categorised: 7, review: 9 });
  });

  it("RANGE-scoped run: only rows in the union are counted (rest of the sheet ignored)", () => {
    // Whole-sheet resolved read, but the run set covered only rows 14-17 -> summary is those 4.
    const rows = [
      erow(7, "db_switchgear"), erow(10, "hvac_ducting"),
      erow(14, ""), erow(15, ""), erow(16, ""), erow(17, ""),
    ];
    expect(
      summariseResolvedOutcome(rows, unionScopes([{ mode: "range", start: 14, end: 17 }])),
    ).toEqual({ categorised: 0, review: 4 });
  });

  it("a PRE-EXISTING HUMAN verdict counts as categorised (its category is the effective verdict)", () => {
    // The resolved endpoint writes a human pick into effective_category_id, so a row a machine
    // would leave blank counts as categorised once a human verdict lands (owner condition).
    const rows = [erow(2, "db_switchgear") /* human */, erow(3, ""), erow(4, "")];
    expect(summariseResolvedOutcome(rows, { mode: "sheet" })).toEqual({ categorised: 1, review: 2 });
  });

  it("whitespace-only effective is treated as blank (review), not categorised", () => {
    expect(summariseResolvedOutcome([erow(2, "   "), erow(3, "x")], { mode: "sheet" })).toEqual({
      categorised: 1,
      review: 1,
    });
  });

  it("empty resolved read -> zero / zero", () => {
    expect(summariseResolvedOutcome([], { mode: "sheet" })).toEqual({ categorised: 0, review: 0 });
  });
});
