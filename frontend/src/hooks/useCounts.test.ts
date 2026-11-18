import { describe, expect, it } from "vitest";
import { countOf } from "./useCounts";

describe("countOf", () => {
  it("reads a plain count by its key", () => {
    expect(countOf({ total: 12, active: 0 }, "total")).toBe(12);
    expect(countOf({ total: 12, active: 0 }, "active")).toBe(0);
  });

  it("is undefined while loading, for a missing key, and for a grouped count", () => {
    expect(countOf(undefined, "total")).toBeUndefined();
    expect(countOf({ active: 3 }, "total")).toBeUndefined();
    expect(countOf({ total: { WIP: 2, Completed: 5 } }, "total")).toBeUndefined();
  });
});
