// HV-10 -- pure helper tests for the multi-engine pricing editor.
import { describe, it, expect } from "vitest";
import {
  acceptClassifyEvent,
  addRunningDisciplines,
  buildSheetEngineCatalogs,
  removeRunningDiscipline,
  resolvedToSheetCategoryRow,
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
