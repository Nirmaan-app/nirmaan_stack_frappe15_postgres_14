// Unit tests for the pure helpers in CategoryVerdictPicker (BoQ Phase 5 CL-3 verdict picker).
//
// These pin the verdict-state derivation, the editability gate, the label fallback, and the
// engine-group filtering that the grid cell + the page depend on. The JSX picker itself is
// manual-cert; only these pure fns are tested.
import { describe, it, expect } from "vitest";
import {
  deriveVerdictState,
  isRowEditable,
  labelFor,
  buildEngineGroups,
} from "./CategoryVerdictPicker";
import type { EngineCatalog, SheetCategoryRow } from "./boqTypes";

const cat = (over: Partial<SheetCategoryRow> = {}): SheetCategoryRow => ({
  excel_row: 10,
  rule_category_id: "",
  ai_category_id: "",
  final_category_id: "",
  routing: "Auto-accepted",
  routing_reason: "",
  human_category_id: "",
  effective_category_id: "",
  ...over,
});

const catalog = (over: Partial<EngineCatalog> = {}): EngineCatalog => ({
  discipline: "Electrical",
  label: "Electrical",
  categories: [
    { id: "ELE-1", label: "Cables" },
    { id: "ELE-2", label: "Conduits" },
  ],
  ...over,
});

describe("deriveVerdictState", () => {
  it("is unclassified when there is no cat", () => {
    expect(deriveVerdictState(undefined)).toBe("unclassified");
  });

  it("is unclassified when effective is blank", () => {
    expect(deriveVerdictState(cat({ effective_category_id: "" }))).toBe("unclassified");
    expect(deriveVerdictState(cat({ effective_category_id: "   " }))).toBe("unclassified");
  });

  it("is human when a trimmed human pick is set", () => {
    expect(
      deriveVerdictState(
        cat({ effective_category_id: "ELE-1", human_category_id: "ELE-1" }),
      ),
    ).toBe("human");
  });

  it("treats a whitespace-only human pick as NOT human (falls through)", () => {
    // effective set (an auto verdict), human is whitespace only -> not human; routing auto.
    expect(
      deriveVerdictState(
        cat({ effective_category_id: "ELE-1", human_category_id: "   ", routing: "Auto-accepted" }),
      ),
    ).toBe("auto");
    // same, but routed to review -> needs_review, not human.
    expect(
      deriveVerdictState(
        cat({ effective_category_id: "ELE-1", human_category_id: "   ", routing: "Needs review" }),
      ),
    ).toBe("needs_review");
  });

  it("is needs_review for a Needs review routing with no human pick", () => {
    expect(
      deriveVerdictState(
        cat({ effective_category_id: "ELE-1", routing: "Needs review", human_category_id: "" }),
      ),
    ).toBe("needs_review");
  });

  it("is auto for an accepted machine verdict", () => {
    expect(
      deriveVerdictState(
        cat({ effective_category_id: "ELE-1", routing: "Auto-accepted" }),
      ),
    ).toBe("auto");
  });
});

describe("isRowEditable", () => {
  it("is true for a classified row (auto / needs_review / human)", () => {
    expect(isRowEditable(cat({ effective_category_id: "ELE-1", routing: "Auto-accepted" }))).toBe(
      true,
    );
    expect(
      isRowEditable(cat({ effective_category_id: "ELE-1", routing: "Needs review" })),
    ).toBe(true);
    expect(
      isRowEditable(cat({ effective_category_id: "ELE-1", human_category_id: "ELE-1" })),
    ).toBe(true);
  });

  it("is false for an unclassified row and undefined", () => {
    expect(isRowEditable(cat({ effective_category_id: "" }))).toBe(false);
    expect(isRowEditable(undefined)).toBe(false);
  });
});

describe("labelFor", () => {
  it("returns the mapped label on a hit (Map)", () => {
    const m = new Map<string, string>([["ELE-1", "Cables"]]);
    expect(labelFor("ELE-1", m)).toBe("Cables");
  });

  it("returns the mapped label on a hit (Record)", () => {
    expect(labelFor("ELE-1", { "ELE-1": "Cables" })).toBe("Cables");
  });

  it("falls back to the id on a miss / blank label", () => {
    expect(labelFor("ELE-9", new Map())).toBe("ELE-9");
    expect(labelFor("ELE-9", { "ELE-9": "   " })).toBe("ELE-9");
  });

  it("returns '' for an empty id", () => {
    expect(labelFor("", new Map([["", "nope"]]))).toBe("");
  });
});

describe("buildEngineGroups", () => {
  it("filters catalogs down to the run disciplines", () => {
    const catalogs = [
      catalog({ discipline: "Electrical", label: "Electrical" }),
      catalog({ discipline: "Plumbing", label: "Plumbing" }),
    ];
    const out = buildEngineGroups(["Electrical"], catalogs);
    expect(out.map((c) => c.discipline)).toEqual(["Electrical"]);
  });

  it("returns a single group for ['Electrical']", () => {
    const out = buildEngineGroups(["Electrical"], [catalog()]);
    expect(out).toHaveLength(1);
    expect(out[0].discipline).toBe("Electrical");
  });

  it("is empty when no run engine matches the catalogs", () => {
    expect(buildEngineGroups(["HVAC"], [catalog({ discipline: "Electrical" })])).toEqual([]);
    expect(buildEngineGroups([], [catalog()])).toEqual([]);
  });

  it("keeps only that engine's own categories", () => {
    const out = buildEngineGroups(["Electrical"], [catalog()]);
    expect(out[0].categories.map((c) => c.id)).toEqual(["ELE-1", "ELE-2"]);
  });

  it("dedups a repeated discipline, order-stable (first wins)", () => {
    const catalogs = [
      catalog({ discipline: "Electrical", label: "Electrical A" }),
      catalog({ discipline: "Electrical", label: "Electrical B" }),
    ];
    const out = buildEngineGroups(["Electrical"], catalogs);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("Electrical A");
  });
});
