import { describe, expect, it } from "vitest";

import { latestDate, poHeaderDate } from "./usePOHeaderDate";

describe("poHeaderDate", () => {
  it("shows the creation date as PO Date when the PO was never revised", () => {
    expect(poHeaderDate("2026-10-22 19:28:43", undefined)).toEqual({ label: "PO Date", date: "2026-10-22 19:28:43" });
    expect(poHeaderDate("2026-10-22 19:28:43", null)).toEqual({ label: "PO Date", date: "2026-10-22 19:28:43" });
  });

  it("shows the latest revision's approval date as Revised PO Date", () => {
    expect(poHeaderDate("2026-10-22 19:28:43", "2026-11-12 10:00:00")).toEqual({
      label: "Revised PO Date",
      date: "2026-11-12 10:00:00",
    });
  });

  it("keeps PO Date when the PO has no creation date either", () => {
    expect(poHeaderDate(undefined, undefined)).toEqual({ label: "PO Date", date: undefined });
  });
});

describe("latestDate", () => {
  it("picks the latest date and skips empty ones", () => {
    expect(latestDate([null, "2026-10-05 09:00:00", undefined, "2026-11-12 10:00:00", "2026-11-01 08:00:00"])).toBe(
      "2026-11-12 10:00:00"
    );
  });

  it("is undefined when there is no date", () => {
    expect(latestDate([])).toBeUndefined();
    expect(latestDate([null, undefined])).toBeUndefined();
    expect(latestDate(undefined)).toBeUndefined();
  });
});
