import { describe, expect, it } from "vitest";

import { searchWords } from "@/utils/searchWords";

import { filterActivitiesBySearch } from "./activitySearch";

const act = (name: string, wp_title: string, extra: { wp_description?: string; wp_remarks?: string } = {}) => ({
  name,
  wp_title,
  ...extra,
});

const data = {
  "HVAC Ducting": [
    {
      work_milestone_name: "VAV Installation",
      work_plan_doc: [act("a1", "VAV and thermostat connection")],
    },
    {
      work_milestone_name: "Grill/Diffuser Installation",
      work_plan_doc: [
        act("a2", "Reception Area Grill/Diffuser Installation", {
          wp_remarks: "Extra round diffuser installation pending and clearance from c&i",
        }),
        act("a3", "Cabin Grill fixing"),
      ],
    },
  ],
  Electrical: [
    { work_milestone_name: "DB Installation", work_plan_doc: [act("e1", "Main DB dressing", { wp_description: "Level 2" })] },
    { work_milestone_name: "No activities yet" },
  ],
};

/** Activity names left in each header, empty milestones included as []. */
const left = (out: Record<string, { work_plan_doc?: { name: string }[] }[]>) =>
  Object.fromEntries(
    Object.entries(out).map(([header, items]) => [header, items.map((m) => (m.work_plan_doc ?? null)?.map((p) => p.name) ?? null)]),
  );

describe("filterActivitiesBySearch", () => {
  it("keeps everything (same object) with no words", () => {
    expect(filterActivitiesBySearch(data, [])).toBe(data);
  });

  it("finds an activity by its title, ignoring case", () => {
    expect(left(filterActivitiesBySearch(data, searchWords("THERMOSTAT")))).toEqual({
      "HVAC Ducting": [["a1"], []],
      Electrical: [[], null],
    });
  });

  it("finds every activity under a work header by the header's name", () => {
    expect(left(filterActivitiesBySearch(data, searchWords("hvac")))).toEqual({
      "HVAC Ducting": [["a1"], ["a2", "a3"]],
      Electrical: [[], null],
    });
  });

  it("finds activities by milestone name", () => {
    expect(left(filterActivitiesBySearch(data, searchWords("vav installation")))).toEqual({
      "HVAC Ducting": [["a1"], []],
      Electrical: [[], null],
    });
  });

  it("finds an activity by its Note (remarks) and its description", () => {
    expect(left(filterActivitiesBySearch(data, searchWords("clearance")))["HVAC Ducting"]).toEqual([[], ["a2"]]);
    expect(left(filterActivitiesBySearch(data, searchWords("level 2"))).Electrical).toEqual([["e1"], null]);
  });

  it("needs every word, which may sit in different fields", () => {
    expect(left(filterActivitiesBySearch(data, searchWords("hvac reception")))["HVAC Ducting"]).toEqual([[], ["a2"]]);
    expect(left(filterActivitiesBySearch(data, searchWords("electrical reception"))).Electrical).toEqual([[], null]);
  });

  it("empties every milestone when nothing matches, keeping the headers", () => {
    expect(left(filterActivitiesBySearch(data, searchWords("transformer")))).toEqual({
      "HVAC Ducting": [[], []],
      Electrical: [[], null],
    });
  });

  it("leaves a milestone without an activity list untouched and does not change the input", () => {
    const out = filterActivitiesBySearch(data, searchWords("db"));
    expect(out.Electrical[1]).toBe(data.Electrical[1]);
    expect(data["HVAC Ducting"][1].work_plan_doc).toHaveLength(2);
  });
});
