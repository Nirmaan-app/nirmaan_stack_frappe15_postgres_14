import { describe, expect, it } from "vitest";
import {
  DPR_NO_DRAFT_REF,
  clearDprSessionData,
  dprDraftRefKey,
  getStaleDraftKind,
} from "./dprSessionStorage";

/** A Map-backed stand-in for sessionStorage (vitest runs in node, with no DOM storage). */
const fakeStorage = (keys: string[]) => {
  const map = new Map(keys.map((k) => [k, "x"]));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    keys: () => [...map.keys()],
  };
};

describe("getStaleDraftKind", () => {
  it("keeps a copy that has no marker yet", () => {
    expect(getStaleDraftKind(null, null)).toBeNull();
    expect(getStaleDraftKind(null, "DPR-1")).toBeNull();
  });

  it("keeps a copy whose draft is still the zone's draft", () => {
    expect(getStaleDraftKind("DPR-1", "DPR-1")).toBeNull();
    expect(getStaleDraftKind(DPR_NO_DRAFT_REF, null)).toBeNull();
  });

  it("flags a copy whose draft was deleted or submitted", () => {
    expect(getStaleDraftKind("DPR-1", null)).toBe("draft_gone");
  });

  it("flags a copy whose draft was replaced by another draft", () => {
    expect(getStaleDraftKind("DPR-1", "DPR-2")).toBe("draft_gone");
  });

  it("flags a fresh copy when someone else saved a draft meanwhile", () => {
    expect(getStaleDraftKind(DPR_NO_DRAFT_REF, "DPR-2")).toBe("started_elsewhere");
  });
});

describe("clearDprSessionData", () => {
  it("clears only the tab keys and marker of that project, date and zone", () => {
    const storage = fakeStorage([
      "project_P1_date_28-Oct-2026_zone_Tower_tab_Work force",
      "project_P1_date_28-Oct-2026_zone_Tower_tab_Photos",
      "project_P1_date_28-Oct-2026_zone_Tower_tab_Client_Clearance_Issues",
      dprDraftRefKey("P1", "28-Oct-2026", "Tower"),
      "project_P1_date_28-Oct-2026_zone_Tower_2_tab_Work force",
      dprDraftRefKey("P1", "28-Oct-2026", "Tower_2"),
      "project_P1_date_27-Oct-2026_zone_Tower_tab_Work force",
      "project_P2_date_28-Oct-2026_zone_Tower_tab_Work force",
      "selectedProject",
    ]);

    clearDprSessionData(storage, "P1", "28-Oct-2026", "Tower");

    expect(storage.keys()).toEqual([
      "project_P1_date_28-Oct-2026_zone_Tower_2_tab_Work force",
      dprDraftRefKey("P1", "28-Oct-2026", "Tower_2"),
      "project_P1_date_27-Oct-2026_zone_Tower_tab_Work force",
      "project_P2_date_28-Oct-2026_zone_Tower_tab_Work force",
      "selectedProject",
    ]);
  });
});
