import { describe, expect, it } from "vitest";

import { activityStatus, completedNeedsAllTime, filterActivitiesByStatus } from "./activityStatusFilter";

const plan = (name: string, wp_status?: string | null) => ({ name, wp_status });

const data = {
  Electrical: [
    { work_milestone_name: "Cabling", work_plan_doc: [plan("a", "Completed"), plan("b", "In Progress")] },
    { work_milestone_name: "Panels", work_plan_doc: [plan("c", ""), plan("d", "Pending"), plan("e", null)] },
    { work_milestone_name: "Earthing" },
  ],
  HVAC: [{ work_milestone_name: "Ducting", work_plan_doc: [plan("f", "On Hold")] }],
};

const names = (out: Record<string, { work_plan_doc?: { name: string }[] }[]>) =>
  Object.fromEntries(
    Object.entries(out).map(([h, items]) => [h, items.map((i) => (i.work_plan_doc ?? []).map((p) => p.name))]),
  );

describe("activityStatus", () => {
  it("counts empty and legacy Pending as Not Started", () => {
    expect(activityStatus("")).toBe("Not Started");
    expect(activityStatus(null)).toBe("Not Started");
    expect(activityStatus(undefined)).toBe("Not Started");
    expect(activityStatus("Pending")).toBe("Not Started");
    expect(activityStatus("On Hold")).toBe("On Hold");
  });
});

describe("filterActivitiesByStatus", () => {
  it("keeps everything (same object) when nothing is selected", () => {
    expect(filterActivitiesByStatus(data, new Set())).toBe(data);
  });

  it("keeps only the selected statuses, empty lists where none match", () => {
    expect(names(filterActivitiesByStatus(data, new Set(["In Progress"])))).toEqual({
      Electrical: [["b"], [], []],
      HVAC: [[]],
    });
  });

  it("matches empty and Pending under Not Started, and several statuses at once", () => {
    expect(names(filterActivitiesByStatus(data, new Set(["Not Started", "On Hold"])))).toEqual({
      Electrical: [[], ["c", "d", "e"], []],
      HVAC: [["f"]],
    });
  });

  it("leaves a milestone with no activities untouched and never mutates the input", () => {
    const before = JSON.stringify(data);
    const out = filterActivitiesByStatus(data, new Set(["Completed"]));
    expect(out.Electrical[2]).toBe(data.Electrical[2]);
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe("completedNeedsAllTime", () => {
  it("is true only for Completed with a date range", () => {
    expect(completedNeedsAllTime(new Set(["Completed"]), true)).toBe(true);
    expect(completedNeedsAllTime(new Set(["Completed"]), false)).toBe(false);
    expect(completedNeedsAllTime(new Set(["In Progress"]), true)).toBe(false);
  });
});
