// Unit tests for the version-view dropdown's PURE label-shape helper (BoQ Phase 5 version-view).
// versionLabelParts decides current vs priced vs never-priced WITHOUT formatting dates (so it is
// locale-independent); formatVersionLabel is asserted only for its structural cases (the date
// substring is locale-dependent, so we assert containment, not the exact rendered date).
import { describe, it, expect } from "vitest";
import { versionLabelParts, formatVersionLabel } from "./VersionRibbon";
import type { SheetVersionRow } from "./boqTypes";

function row(over: Partial<SheetVersionRow> = {}): SheetVersionRow {
  return {
    commit_version: 1,
    is_current: false,
    committed_at: "2026-06-18 09:00:00",
    sheet_disposition: "grid_and_nodes",
    last_change_at: null,
    ...over,
  };
}

describe("versionLabelParts", () => {
  it("flags the is_current row as current (no date)", () => {
    expect(versionLabelParts(row({ commit_version: 5, is_current: true }), 5)).toEqual({
      kind: "current",
    });
  });

  it("treats the row matching currentVersion as current even if is_current is false", () => {
    // Defensive: the dropdown's currentVersion is the live read's commit_version.
    expect(versionLabelParts(row({ commit_version: 5, is_current: false }), 5)).toEqual({
      kind: "current",
    });
  });

  it("labels an earlier priced version by its last change date", () => {
    expect(
      versionLabelParts(row({ commit_version: 3, last_change_at: "2026-06-22 01:00:00" }), 5),
    ).toEqual({ kind: "priced", date: "2026-06-22 01:00:00" });
  });

  it("labels a committed-but-never-priced version with committed_at fallback", () => {
    expect(
      versionLabelParts(
        row({ commit_version: 2, last_change_at: null, committed_at: "2026-06-17 09:00:00" }),
        5,
      ),
    ).toEqual({ kind: "never_priced", date: "2026-06-17 09:00:00" });
  });
});

describe("formatVersionLabel", () => {
  it("renders the current tag with no date", () => {
    expect(formatVersionLabel(row({ commit_version: 5, is_current: true }), 5)).toBe(
      "Version 5 — Current (live)",
    );
  });

  it("marks a never-priced earlier version explicitly", () => {
    const label = formatVersionLabel(row({ commit_version: 1, last_change_at: null }), 5);
    expect(label).toContain("Version 1");
    expect(label).toContain("never priced");
  });

  it("does not tag a priced earlier version as never priced", () => {
    const label = formatVersionLabel(
      row({ commit_version: 3, last_change_at: "2026-06-22 01:00:00" }),
      5,
    );
    expect(label).toContain("Version 3");
    expect(label).not.toContain("never priced");
  });
});
