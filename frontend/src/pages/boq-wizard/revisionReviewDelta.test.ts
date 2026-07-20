import { describe, it, expect } from "vitest";
import {
  computeRevisionDelta,
  isNeedsActionRow,
  isRowCopied,
  REVISION_COPIED_BADGE,
  type RevisionReviewMeta,
} from "./revisionReviewDelta";

/**
 * ADR-0014 Amendment B inverted this module's polarity: the STAMPED status (`Copied`) is now the
 * calm one and the UNSTAMPED rows are what needs review. The two properties worth protecting
 * across that inversion are kept here verbatim in spirit:
 *   - SELF-CLEARING (a row leaves the needs-review set the moment the human handles it), and
 *   - the Status-column precedence MIRROR (Accepted·Claude > Accepted·Gemini > Edited > the row).
 */

// Minimal row factory -- only the fields the helpers read. `description` is non-blank by default
// because a blank/spacer row is deliberately excluded from the needs-review set.
function row(
  overrides: Partial<{
    row_index: number;
    source_row_number: number | null;
    revision_carry_status: string | null;
    ai_suggestion_status: string | null;
    gemini_suggestion_status: string | null;
    edited_at: string | null;
    edit_log: unknown[] | null;
    description: string | null;
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
    description: "Some row",
    ...overrides,
  };
}

function meta(overrides: Partial<RevisionReviewMeta> = {}): RevisionReviewMeta {
  return {
    is_revision: true,
    copied_count: 1,
    needs_review_count: 0,
    total_count: 1,
    source_version: 3,
    ...overrides,
  };
}

describe("isRowCopied", () => {
  it("is true only for the exact `Copied` stamp", () => {
    expect(isRowCopied(row({ revision_carry_status: "Copied" }))).toBe(true);
  });

  it("is false for every RETIRED status (they fall through to Original)", () => {
    for (const legacy of ["Matched", "New", "Ambiguous", "Drifted"]) {
      expect(isRowCopied(row({ revision_carry_status: legacy }))).toBe(false);
    }
  });

  it("is false for blank and null (an ordinary parsed row)", () => {
    expect(isRowCopied(row({ revision_carry_status: "" }))).toBe(false);
    expect(isRowCopied(row({ revision_carry_status: null }))).toBe(false);
  });
});

describe("isNeedsActionRow (self-clearing, mirrors Status-column precedence)", () => {
  it("flags an untouched row that did not copy", () => {
    expect(isNeedsActionRow(row())).toBe(true);
  });

  it("never flags a Copied row", () => {
    expect(isNeedsActionRow(row({ revision_carry_status: "Copied" }))).toBe(false);
  });

  it("flags a legacy-stamped row, because those statuses no longer mean 'carried'", () => {
    // A row stamped by a pre-amendment parse did NOT copy under the current rule, so it correctly
    // reads as needing review rather than being silently trusted.
    expect(isNeedsActionRow(row({ revision_carry_status: "Matched" }))).toBe(true);
  });

  it("excludes a blank / whitespace-only description (a spacer carries nothing)", () => {
    expect(isNeedsActionRow(row({ description: "" }))).toBe(false);
    expect(isNeedsActionRow(row({ description: "   " }))).toBe(false);
    expect(isNeedsActionRow(row({ description: null }))).toBe(false);
  });

  it("self-clears once the row is EDITED (edited_at)", () => {
    expect(isNeedsActionRow(row({ edited_at: "2026-07-20 10:00:00" }))).toBe(false);
  });

  it("self-clears once the row is EDITED (non-empty edit_log)", () => {
    expect(isNeedsActionRow(row({ edit_log: [{ f: "x" }] }))).toBe(false);
  });

  it("does NOT clear on an empty edit_log", () => {
    expect(isNeedsActionRow(row({ edit_log: [] }))).toBe(true);
  });

  it("clears when an AI suggestion (Claude or Gemini) is Accepted", () => {
    expect(isNeedsActionRow(row({ ai_suggestion_status: "Accepted" }))).toBe(false);
    expect(isNeedsActionRow(row({ gemini_suggestion_status: "Accepted" }))).toBe(false);
  });

  it("still flags when an AI suggestion is only Pending", () => {
    expect(isNeedsActionRow(row({ ai_suggestion_status: "Pending" }))).toBe(true);
  });
});

describe("computeRevisionDelta -- mode selection", () => {
  it("returns inert 'none' for a non-revision (null meta)", () => {
    const s = computeRevisionDelta([row()], null);
    expect(s.mode).toBe("none");
    expect(s.isRevision).toBe(false);
  });

  it("returns inert 'none' when meta.is_revision is false", () => {
    const s = computeRevisionDelta([row()], meta({ is_revision: false }));
    expect(s.mode).toBe("none");
  });

  it("an all-copied sheet -> the green chip", () => {
    const rows = [
      row({ row_index: 0, revision_carry_status: "Copied" }),
      row({ row_index: 1, revision_carry_status: "Copied" }),
    ];
    const s = computeRevisionDelta(rows, meta({ copied_count: 2, total_count: 2 }));
    expect(s.mode).toBe("no-deltas");
    expect(s.copiedCount).toBe(2);
    expect(s.needsActionRows).toEqual([]);
  });

  it("an uncopied row -> 'needs-action' with the row listed and in the membership set", () => {
    const rows = [
      row({ row_index: 0, revision_carry_status: "Copied" }),
      row({ row_index: 1, source_row_number: 42 }),
    ];
    const s = computeRevisionDelta(
      rows, meta({ copied_count: 1, needs_review_count: 1, total_count: 2 }));
    expect(s.mode).toBe("needs-action");
    expect(s.needsActionRows).toEqual([{ rowIndex: 1, excelRow: 42 }]);
    expect(s.needsActionRowIndexes.has(1)).toBe(true);
    expect(s.needsActionRowIndexes.has(0)).toBe(false);
  });

  it("an uncopied row that was EDITED drops off -> back to the chip (self-clearing)", () => {
    const rows = [
      row({ row_index: 0, revision_carry_status: "Copied" }),
      row({ row_index: 1, edited_at: "2026-07-20 10:00:00" }),
    ];
    const s = computeRevisionDelta(
      rows, meta({ copied_count: 1, needs_review_count: 1, total_count: 2 }));
    expect(s.mode).toBe("no-deltas");
    expect(s.needsActionRows).toEqual([]);
  });

  it("lists needs-review rows in document order", () => {
    const rows = [
      row({ row_index: 0, source_row_number: 5 }),
      row({ row_index: 1, revision_carry_status: "Copied" }),
      row({ row_index: 2, source_row_number: 9 }),
    ];
    const s = computeRevisionDelta(
      rows, meta({ copied_count: 1, needs_review_count: 2, total_count: 3 }));
    expect(s.needsActionRows.map((r) => r.rowIndex)).toEqual([0, 2]);
  });

  it("a declared-New / unmapped revision sheet (nothing copied) -> 'none'", () => {
    // No original to diff against, so the sheet shows no revision chrome at all.
    const s = computeRevisionDelta(
      [row(), row({ row_index: 1 })],
      meta({ copied_count: 0, needs_review_count: 2, total_count: 2 }),
    );
    expect(s.mode).toBe("none");
  });

  it("surfaces the server counts verbatim (they do NOT self-clear)", () => {
    const rows = [
      row({ row_index: 0, revision_carry_status: "Copied" }),
      row({ row_index: 1, edited_at: "2026-07-20 10:00:00" }),
    ];
    const s = computeRevisionDelta(
      rows, meta({ copied_count: 412, needs_review_count: 88, total_count: 500 }));
    // The reviewer has handled the one live row (needsActionRows empty) but the CARRY counts stand.
    expect(s.copiedCount).toBe(412);
    expect(s.needsReviewCount).toBe(88);
    expect(s.totalCount).toBe(500);
    expect(s.needsActionRows).toEqual([]);
  });

  it("carries the source version through for the label", () => {
    const s = computeRevisionDelta(
      [row({ revision_carry_status: "Copied" })], meta({ source_version: 7 }));
    expect(s.sourceVersion).toBe(7);
  });
});

describe("REVISION_COPIED_BADGE", () => {
  it("has a label and a class, and is not the Original gray", () => {
    expect(REVISION_COPIED_BADGE.label).toBe("Copied");
    expect(REVISION_COPIED_BADGE.className).toBeTruthy();
    expect(REVISION_COPIED_BADGE.className).not.toContain("gray");
  });
});
