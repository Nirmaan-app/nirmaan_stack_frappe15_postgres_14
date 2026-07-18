import { describe, it, expect } from "vitest";
import {
  computeRevisionDelta,
  isDeltaStatus,
  isNeedsActionRow,
  REVISION_DELTA_BADGE,
  type RevisionReviewMeta,
} from "./revisionReviewDelta";

// Minimal row factory -- only the fields the delta helpers read.
function row(
  overrides: Partial<{
    row_index: number;
    source_row_number: number | null;
    revision_carry_status: string | null;
    ai_suggestion_status: string | null;
    gemini_suggestion_status: string | null;
    edited_at: string | null;
    edit_log: unknown[] | null;
  }> = {},
) {
  return {
    row_index: 0,
    source_row_number: 1,
    revision_carry_status: null,
    ai_suggestion_status: null,
    gemini_suggestion_status: null,
    edited_at: null,
    edit_log: null,
    ...overrides,
  };
}

function meta(overrides: Partial<RevisionReviewMeta> = {}): RevisionReviewMeta {
  return {
    is_revision: true,
    removed_count: 0,
    removed_descriptions: [],
    source_version: 3,
    ...overrides,
  };
}

describe("isDeltaStatus", () => {
  it("is true only for New / Ambiguous / Drifted", () => {
    expect(isDeltaStatus("New")).toBe(true);
    expect(isDeltaStatus("Ambiguous")).toBe(true);
    expect(isDeltaStatus("Drifted")).toBe(true);
  });
  it("is false for Matched, blank, and null (the calm defaults)", () => {
    expect(isDeltaStatus("Matched")).toBe(false);
    expect(isDeltaStatus("")).toBe(false);
    expect(isDeltaStatus(null)).toBe(false);
    expect(isDeltaStatus(undefined)).toBe(false);
  });
});

describe("isNeedsActionRow (self-clearing, mirrors Status-column precedence)", () => {
  it("flags an untouched delta row", () => {
    expect(isNeedsActionRow(row({ revision_carry_status: "New" }))).toBe(true);
    expect(isNeedsActionRow(row({ revision_carry_status: "Ambiguous" }))).toBe(true);
    expect(isNeedsActionRow(row({ revision_carry_status: "Drifted" }))).toBe(true);
  });
  it("never flags a Matched / blank row", () => {
    expect(isNeedsActionRow(row({ revision_carry_status: "Matched" }))).toBe(false);
    expect(isNeedsActionRow(row({ revision_carry_status: null }))).toBe(false);
  });
  it("self-clears once the row is EDITED (edited_at)", () => {
    expect(isNeedsActionRow(row({ revision_carry_status: "New", edited_at: "2026-07-18 10:00:00" }))).toBe(false);
  });
  it("self-clears once the row is EDITED (non-empty edit_log)", () => {
    expect(isNeedsActionRow(row({ revision_carry_status: "New", edit_log: [{ any: 1 }] }))).toBe(false);
  });
  it("does NOT clear on an empty edit_log", () => {
    expect(isNeedsActionRow(row({ revision_carry_status: "New", edit_log: [] }))).toBe(true);
  });
  it("clears when an AI suggestion (Claude or Gemini) is Accepted", () => {
    expect(isNeedsActionRow(row({ revision_carry_status: "New", ai_suggestion_status: "Accepted" }))).toBe(false);
    expect(isNeedsActionRow(row({ revision_carry_status: "New", gemini_suggestion_status: "Accepted" }))).toBe(false);
  });
  it("still flags when an AI suggestion is only Pending", () => {
    expect(isNeedsActionRow(row({ revision_carry_status: "New", ai_suggestion_status: "Pending" }))).toBe(true);
  });
});

describe("computeRevisionDelta -- mode selection", () => {
  it("returns inert 'none' for a non-revision (null meta)", () => {
    const s = computeRevisionDelta([row({ revision_carry_status: null })], null);
    expect(s).toMatchObject({ isRevision: false, mode: "none", matchedCount: 0 });
  });

  it("returns inert 'none' when meta.is_revision is false", () => {
    const s = computeRevisionDelta([row()], meta({ is_revision: false }));
    expect(s.mode).toBe("none");
    expect(s.isRevision).toBe(false);
  });

  it("all-Matched sheet -> 'no-deltas' chip, allMatched true", () => {
    const rows = [
      row({ row_index: 0, revision_carry_status: "Matched" }),
      row({ row_index: 1, revision_carry_status: "Matched" }),
      // a blank spacer row does not disqualify the chip
      row({ row_index: 2, revision_carry_status: null }),
    ];
    const s = computeRevisionDelta(rows, meta());
    expect(s.mode).toBe("no-deltas");
    expect(s.allMatched).toBe(true);
    expect(s.matchedCount).toBe(2);
    expect(s.sourceVersion).toBe(3);
  });

  it("a New row -> 'needs-action' with the row listed", () => {
    const rows = [
      row({ row_index: 0, revision_carry_status: "Matched" }),
      row({ row_index: 5, source_row_number: 12, revision_carry_status: "New" }),
    ];
    const s = computeRevisionDelta(rows, meta());
    expect(s.mode).toBe("needs-action");
    expect(s.needsActionRows).toEqual([{ rowIndex: 5, excelRow: 12, status: "New" }]);
    expect(s.allMatched).toBe(false);
  });

  it("a New row that was EDITED drops off -> back to 'no-deltas' (self-clearing)", () => {
    const rows = [
      row({ row_index: 0, revision_carry_status: "Matched" }),
      row({ row_index: 5, revision_carry_status: "New", edited_at: "2026-07-18 10:00:00" }),
    ];
    const s = computeRevisionDelta(rows, meta());
    expect(s.needsActionRows).toEqual([]);
    expect(s.mode).toBe("no-deltas");
    // A delta status DID appear, so it is not a pure all-Matched sheet.
    expect(s.allMatched).toBe(false);
  });

  it("removed originals alone -> 'needs-action' (advisory), no clickable rows", () => {
    const rows = [row({ row_index: 0, revision_carry_status: "Matched" })];
    const s = computeRevisionDelta(rows, meta({ removed_count: 2, removed_descriptions: ["Old A", "Old B"] }));
    expect(s.mode).toBe("needs-action");
    expect(s.needsActionRows).toEqual([]);
    expect(s.removedCount).toBe(2);
    expect(s.removedDescriptions).toEqual(["Old A", "Old B"]);
  });

  it("a declared-New / unmapped revision sheet (nothing carried) -> 'none'", () => {
    const rows = [row({ row_index: 0, revision_carry_status: null }), row({ row_index: 1, revision_carry_status: null })];
    const s = computeRevisionDelta(rows, meta({ removed_count: 0 }));
    expect(s.mode).toBe("none");
    // still flagged a revision sheet, just with no chrome to show
    expect(s.isRevision).toBe(true);
  });

  it("counts each delta kind and lists them in document order", () => {
    const rows = [
      row({ row_index: 0, source_row_number: 1, revision_carry_status: "New" }),
      row({ row_index: 1, source_row_number: 2, revision_carry_status: "Matched" }),
      row({ row_index: 2, source_row_number: 3, revision_carry_status: "Ambiguous" }),
      row({ row_index: 3, source_row_number: 4, revision_carry_status: "Drifted" }),
    ];
    const s = computeRevisionDelta(rows, meta());
    expect(s.needsActionRows.map((r) => r.status)).toEqual(["New", "Ambiguous", "Drifted"]);
    expect(s.needsActionRows.map((r) => r.rowIndex)).toEqual([0, 2, 3]);
  });
});

describe("REVISION_DELTA_BADGE", () => {
  it("has a distinct label + class for each delta status", () => {
    expect(REVISION_DELTA_BADGE.New.label).toBe("New");
    expect(REVISION_DELTA_BADGE.Ambiguous.label).toBe("Ambiguous");
    expect(REVISION_DELTA_BADGE.Drifted.label).toBe("Drifted");
    const classes = new Set([
      REVISION_DELTA_BADGE.New.className,
      REVISION_DELTA_BADGE.Ambiguous.className,
      REVISION_DELTA_BADGE.Drifted.className,
    ]);
    expect(classes.size).toBe(3);
  });
});
