import { describe, expect, it } from "vitest";

import { planNumbersByCreation } from "./planNumbers";

describe("planNumbersByCreation", () => {
  it("numbers the oldest plan 1, whatever order the list arrives in", () => {
    const numbers = planNumbersByCreation([
      { name: "c", creation: "2026-11-20 10:00:00.000000" },
      { name: "a", creation: "2026-10-01 09:00:00.000000" },
      { name: "b", creation: "2026-10-15 18:30:00.000000" },
    ]);
    expect(numbers.get("a")).toBe(1);
    expect(numbers.get("b")).toBe(2);
    expect(numbers.get("c")).toBe(3);
  });

  it("keeps existing numbers when a newer plan is added", () => {
    const before = planNumbersByCreation([
      { name: "a", creation: "2026-10-01 09:00:00" },
      { name: "b", creation: "2026-10-15 09:00:00" },
    ]);
    const after = planNumbersByCreation([
      { name: "new", creation: "2026-11-27 09:00:00" },
      { name: "a", creation: "2026-10-01 09:00:00" },
      { name: "b", creation: "2026-10-15 09:00:00" },
    ]);
    expect(after.get("a")).toBe(before.get("a"));
    expect(after.get("b")).toBe(before.get("b"));
    expect(after.get("new")).toBe(3);
  });

  it("breaks equal creation times by name, so the order is stable", () => {
    const numbers = planNumbersByCreation([
      { name: "z", creation: "2026-10-01 09:00:00" },
      { name: "m", creation: "2026-10-01 09:00:00" },
    ]);
    expect(numbers.get("m")).toBe(1);
    expect(numbers.get("z")).toBe(2);
  });

  it("gives an empty map for no plans, and no number for an unknown plan", () => {
    expect(planNumbersByCreation(undefined).size).toBe(0);
    expect(planNumbersByCreation([]).get("x")).toBeUndefined();
  });

  it("sorts a plan with no creation first instead of throwing", () => {
    const numbers = planNumbersByCreation([
      { name: "b", creation: "2026-10-01 09:00:00" },
      { name: "a", creation: null },
    ]);
    expect(numbers.get("a")).toBe(1);
    expect(numbers.get("b")).toBe(2);
  });
});
