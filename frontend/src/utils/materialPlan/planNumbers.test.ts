import { describe, expect, it } from "vitest";

import { planNumbersByPosition } from "./planNumbers";

describe("planNumbersByPosition", () => {
  it("numbers each plan by its place in the list, from 1, as develop and the PDFs do", () => {
    const numbers = planNumbersByPosition([{ name: "newest" }, { name: "middle" }, { name: "oldest" }]);
    expect(numbers.get("newest")).toBe(1);
    expect(numbers.get("middle")).toBe(2);
    expect(numbers.get("oldest")).toBe(3);
  });

  it("keeps a plan's number when the search hides others (numbers come from the list before search)", () => {
    const beforeSearch = [{ name: "a" }, { name: "b" }, { name: "c" }];
    const numbers = planNumbersByPosition(beforeSearch);
    const shownAfterSearch = beforeSearch.filter((plan) => plan.name === "c");
    expect(shownAfterSearch.map((plan) => numbers.get(plan.name))).toEqual([3]);
  });

  it("renumbers from 1 when a date or status filter narrows the list, like develop", () => {
    expect(planNumbersByPosition([{ name: "b" }, { name: "c" }]).get("b")).toBe(1);
  });

  it("gives an empty map for no plans, and no number for an unknown plan", () => {
    expect(planNumbersByPosition(undefined).size).toBe(0);
    expect(planNumbersByPosition([]).get("x")).toBeUndefined();
  });
});
