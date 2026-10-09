import { describe, expect, it } from "vitest";

import { parseStatusParam, statusParamOf } from "./statusFilterParam";

const ALLOWED = ["Not Started", "In Progress", "On Hold", "Completed"] as const;

describe("parseStatusParam", () => {
  it("reads in allowed order and drops unknown names", () => {
    expect(parseStatusParam("Completed,Bogus,Not Started", ALLOWED)).toEqual(["Not Started", "Completed"]);
  });

  it("reads nothing from an empty or missing param", () => {
    expect(parseStatusParam(null, ALLOWED)).toEqual([]);
    expect(parseStatusParam("", ALLOWED)).toEqual([]);
  });
});

describe("statusParamOf", () => {
  it("writes allowed order, and null for an empty selection", () => {
    expect(statusParamOf(new Set(["On Hold", "In Progress"]), ALLOWED)).toBe("In Progress,On Hold");
    expect(statusParamOf(new Set(), ALLOWED)).toBeNull();
  });

  it("round-trips through parseStatusParam", () => {
    const param = statusParamOf(["Completed", "Not Started"], ALLOWED);
    expect(parseStatusParam(param, ALLOWED)).toEqual(["Not Started", "Completed"]);
  });
});
