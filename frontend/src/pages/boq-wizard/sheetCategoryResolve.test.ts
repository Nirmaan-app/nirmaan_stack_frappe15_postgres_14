// HV-10 -- pure helper tests for the multi-engine pricing editor.
import { describe, it, expect } from "vitest";
import {
  acceptClassifyEvent,
  addRunningDisciplines,
  buildSheetEngineCatalogs,
  categoryCellTitle,
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
    carried_from_boq: null,
    carried_from_version: null,
    carried_from_other_boq: null,
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

  // ── ADR-0014 Amendment E ──────────────────────────────────────────────────────────
  // carried_from_boq is the ONE non-telemetry field added to the resolved read, and it MUST reach
  // the grid: it is the sole input to the "carried" cell state. Dropping it here fails silently --
  // every carried row would simply render as locally decided, which is the exact
  // indistinguishability Amendment D deleted the annotation carry over.
  it("PASSES carried_from_boq through -- it is provenance, not telemetry", () => {
    const r = resolvedToSheetCategoryRow(
      resolved({
        effective_source: "human",
        effective_category_id: "x",
        human_category_id: "x",
        carried_from_boq: "BOQ-26-00066",
      }),
    );
    expect(r.carried_from_boq).toBe("BOQ-26-00066");
  });

  it("passes provenance through for a carried MACHINE verdict too", () => {
    const r = resolvedToSheetCategoryRow(
      resolved({
        effective_source: "auto",
        effective_category_id: "x",
        carried_from_boq: "BOQ-26-00066",
      }),
    );
    expect(r.carried_from_boq).toBe("BOQ-26-00066");
  });

  it("is null for a locally decided row", () => {
    const r = resolvedToSheetCategoryRow(
      resolved({ effective_source: "auto", effective_category_id: "x" }),
    );
    expect(r.carried_from_boq).toBeNull();
  });

  // The adapter normalises an absent field to null so the grid's `cat.carried_from_boq` check is
  // a plain truthiness test with no undefined case to reason about.
  it("normalises a missing provenance field to null, never undefined", () => {
    const bare = resolved({ effective_source: "auto", effective_category_id: "x" });
    delete (bare as unknown as Record<string, unknown>).carried_from_boq;
    expect(resolvedToSheetCategoryRow(bare).carried_from_boq).toBeNull();
  });

  // ── ADR-0014 Amendment F, ruling R3 ───────────────────────────────────────────────
  // carried_from_version is the OTHER half of the provenance pair, and within one BoQ it is the
  // only informative half: the source and the destination ARE the same BoQ there, so
  // carried_from_boq names the document the reader is already looking at. It rides the same
  // not-telemetry path as carried_from_boq and must reach the grid for the same reason.
  it("PASSES carried_from_version through for a carried HUMAN verdict", () => {
    const r = resolvedToSheetCategoryRow(
      resolved({
        effective_source: "human",
        effective_category_id: "x",
        human_category_id: "x",
        carried_from_boq: "BOQ-26-00066",
        carried_from_version: 2,
      }),
    );
    expect(r.carried_from_version).toBe(2);
  });

  it("passes carried_from_version through for a carried MACHINE verdict too", () => {
    const r = resolvedToSheetCategoryRow(
      resolved({
        effective_source: "auto",
        effective_category_id: "x",
        carried_from_boq: "BOQ-26-00066",
        carried_from_version: 5,
      }),
    );
    expect(r.carried_from_version).toBe(5);
  });

  // The server column is `bigint NOT NULL DEFAULT 0`, so an uncarried row that HAS a resolving
  // discipline arrives as 0, not null. The adapter passes that through VERBATIM rather than
  // coercing it -- carried_from_boq is what says "carried at all", so 0 is never read on its own
  // and inventing a null here would be inventing a semantic the server never sent.
  it("preserves an uncarried row's 0 verbatim -- it does not coerce it to null", () => {
    const r = resolvedToSheetCategoryRow(
      resolved({ effective_source: "auto", effective_category_id: "x", carried_from_version: 0 }),
    );
    expect(r.carried_from_boq).toBeNull();
    expect(r.carried_from_version).toBe(0);
  });

  it("normalises a missing carried_from_version to null, never undefined", () => {
    const bare = resolved({ effective_source: "auto", effective_category_id: "x" });
    delete (bare as unknown as Record<string, unknown>).carried_from_version;
    expect(resolvedToSheetCategoryRow(bare).carried_from_version).toBeNull();
  });

  // ── R16: the server-decided cross-BoQ signal ──────────────────────────────────────
  it("PASSES carried_from_other_boq through -- the grid cannot re-derive it", () => {
    const r = resolvedToSheetCategoryRow(
      resolved({
        effective_source: "auto",
        effective_category_id: "x",
        carried_from_boq: "BOQ-26-00066",
        carried_from_version: 4,
        carried_from_other_boq: true,
      }),
    );
    expect(r.carried_from_other_boq).toBe(true);
  });

  it("keeps a FALSE signal false -- it must not be flattened into null", () => {
    const r = resolvedToSheetCategoryRow(
      resolved({
        effective_source: "auto",
        effective_category_id: "x",
        carried_from_boq: "BOQ-26-00099",
        carried_from_version: 2,
        carried_from_other_boq: false,
      }),
    );
    expect(r.carried_from_other_boq).toBe(false);
  });

  it("normalises a missing carried_from_other_boq to null, never undefined", () => {
    const bare = resolved({ effective_source: "auto", effective_category_id: "x" });
    delete (bare as unknown as Record<string, unknown>).carried_from_other_boq;
    expect(resolvedToSheetCategoryRow(bare).carried_from_other_boq).toBeNull();
  });
});

// ── R3/R16: the category cell's tooltip ─────────────────────────────────────────────
// Extracted from JSX so the ruling is enforceable by assertion. There is no DOM environment in
// this repo (`environment: "node"`, deliberate), so a string built inline in the grid's `title=`
// attribute cannot be tested at all -- the same reasoning that produced `carryChangesPhrase`.
describe("categoryCellTitle (the Category cell's tooltip)", () => {
  const carried = (over: Partial<ResolvedSheetCategory>) =>
    resolvedToSheetCategoryRow(
      resolved({ effective_source: "auto", effective_category_id: "x", ...over }),
    );

  it("names the SOURCE BoQ when the carry crossed BoQs", () => {
    const cat = carried({
      carried_from_boq: "BOQ-26-00066",
      carried_from_version: 4,
      carried_from_other_boq: true,
    });
    expect(categoryCellTitle("Panels", "carried", cat)).toBe(
      "Panels (carried from BOQ-26-00066)",
    );
  });

  it("names the SOURCE VERSION when the carry stayed inside one BoQ (R3)", () => {
    const cat = carried({
      carried_from_boq: "BOQ-26-00099",
      carried_from_version: 2,
      carried_from_other_boq: false,
    });
    expect(categoryCellTitle("Panels", "carried", cat)).toBe("Panels (carried from Version 2)");
  });

  it("never names the BoQ the reader is already looking at", () => {
    const cat = carried({
      carried_from_boq: "BOQ-26-00099",
      carried_from_version: 2,
      carried_from_other_boq: false,
    });
    expect(categoryCellTitle("Panels", "carried", cat)).not.toContain("BOQ-26-00099");
  });

  // Back-compat: a payload from before R16 (or one cached across the deploy) has no signal at
  // all. Falling back to the BoQ noun keeps today's behaviour, which is right on the cross-BoQ
  // carry that shipped first; guessing "within" from the version's presence would be wrong the
  // moment a cross-BoQ carry surfaced its version, which it now always does.
  it("falls back to the BoQ noun when the server sent no signal", () => {
    const cat = carried({ carried_from_boq: "BOQ-26-00066", carried_from_version: 4 });
    delete (cat as unknown as Record<string, unknown>).carried_from_other_boq;
    expect(categoryCellTitle("Panels", "carried", cat)).toBe(
      "Panels (carried from BOQ-26-00066)",
    );
  });

  // 0 is what an uncarried row reads on that NOT-NULL Int column, so it is never a real source
  // version. Rendering "Version 0" would invent a version that does not exist.
  it("falls back to the BoQ noun rather than inventing a Version 0", () => {
    const cat = carried({
      carried_from_boq: "BOQ-26-00066",
      carried_from_version: 0,
      carried_from_other_boq: false,
    });
    expect(categoryCellTitle("Panels", "carried", cat)).toBe(
      "Panels (carried from BOQ-26-00066)",
    );
  });

  it("keeps the human branch as it was", () => {
    expect(categoryCellTitle("Panels", "human", carried({}))).toBe("Panels (your pick)");
  });

  it("is the bare label on an auto verdict", () => {
    expect(categoryCellTitle("Panels", "auto", carried({}))).toBe("Panels");
  });

  it("is undefined when there is no label to show", () => {
    expect(categoryCellTitle("", "unclassified", undefined)).toBeUndefined();
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
