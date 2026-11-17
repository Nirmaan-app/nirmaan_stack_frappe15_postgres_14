import { describe, expect, it } from "vitest";
import { dateFilterFn } from "./tableFilters";

// A plain row: the filter reads only `getValue`, so a caller filtering plain data needs no TanStack Row.
const rowOn = (date: string | null) => ({ getValue: () => date });

describe("dateFilterFn", () => {
  const dates = ["2026-08-31", "2026-09-01 00:00:00", "2026-09-15", "2026-09-30 23:59:59", "2026-10-01", null];
  const kept = (filter: Parameters<typeof dateFilterFn>[2]) =>
    dates.filter((d) => dateFilterFn(rowOn(d), "date", filter));

  it("keeps the days inside a Between range, both ends included", () => {
    expect(kept({ operator: "Between", value: ["2026-09-01", "2026-09-30"] })).toEqual([
      "2026-09-01 00:00:00", "2026-09-15", "2026-09-30 23:59:59",
    ]);
  });

  it("keeps the same day for Is, on or before for <=, on or after for >=", () => {
    expect(kept({ operator: "Is", value: "2026-09-15" })).toEqual(["2026-09-15"]);
    expect(kept({ operator: "<=", value: "2026-09-01" })).toEqual(["2026-08-31", "2026-09-01 00:00:00"]);
    expect(kept({ operator: ">=", value: "2026-09-30" })).toEqual(["2026-09-30 23:59:59", "2026-10-01"]);
  });

  it("keeps every row, an empty date too, when no value is set", () => {
    expect(kept({ operator: "Is", value: null })).toEqual(dates);
  });
});
