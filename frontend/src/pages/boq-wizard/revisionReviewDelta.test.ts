import { describe, it, expect } from "vitest";
import {
  computeRevisionDelta,
  isNeedsActionRow,
  isReviewRowEdited,
  isRowCopied,
  REVISION_COPIED_BADGE,
  REVISION_NEEDS_REVIEW_BADGE,
  REVISION_REVIEWED_BADGE,
  type RevisionReviewMeta,
} from "./revisionReviewDelta";

/**
 * ⚠️ THE POLARITY HERE HAS FLIPPED TWICE -- read `revisionReviewDelta.ts`'s header first.
 *
 * Amendment B made the UNSTAMPED rows the ones needing review, derived client-side from edits and
 * AI accepts. S4 made them STAMPED again (`Needs Review` + a reason) with the confirmation STORED
 * (`revision_reviewed`), because the finalize gate has to be able to depend on it.
 *
 * What survives the flip, and is asserted below:
 *   - a Copied row is never in the needs-review set;
 *   - a confirmed row leaves it;
 *   - the server carry counts are reported verbatim and do NOT move as the reviewer works;
 *   - off a revision the whole layer is inert.
 *
 * What deliberately does NOT survive: the derived AI-accepted / edited clauses. The backend
 * auto-affirms at its write chokepoint, so those rows arrive already confirmed -- and a VALUE edit
 * no longer clears a row, which it never should have.
 */

// Minimal row factory -- only the fields the helpers read.
function row(
  overrides: Partial<{
    row_index: number;
    source_row_number: number | null;
    revision_carry_status: string | null;
    revision_review_reason: string | null;
    revision_reviewed: number | null;
    edited_at: string | null;
    edit_log: unknown[] | null;
    description: string | null;
  }> = {},
) {
  return {
    row_index: 0,
    source_row_number: 1,
    revision_carry_status: null,
    revision_review_reason: null,
    revision_reviewed: 0,
    edited_at: null,
    edit_log: null,
    description: "Some row",
    ...overrides,
  };
}

/** A row stamped by the parse as needing review, not yet confirmed. */
function needsReview(over: Parameters<typeof row>[0] = {}) {
  return row({ revision_carry_status: "Needs Review", revision_review_reason: "row_inserted",
               ...over });
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

  it("is false for blank and null", () => {
    expect(isRowCopied(row({ revision_carry_status: "" }))).toBe(false);
    expect(isRowCopied(row({ revision_carry_status: null }))).toBe(false);
  });
});

describe("isReviewRowEdited (the single home for the Edited predicate)", () => {
  it("is true for edited_at or a non-empty edit_log", () => {
    expect(isReviewRowEdited(row({ edited_at: "2026-07-20 10:00:00" }))).toBe(true);
    expect(isReviewRowEdited(row({ edit_log: [{ f: "x" }] }))).toBe(true);
  });

  it("is false for an empty edit_log", () => {
    expect(isReviewRowEdited(row({ edit_log: [] }))).toBe(false);
  });
});

describe("isNeedsActionRow (stamped + unconfirmed)", () => {
  it("flags a stamped, unconfirmed row", () => {
    expect(isNeedsActionRow(needsReview())).toBe(true);
  });

  it("clears once the row is confirmed", () => {
    expect(isNeedsActionRow(needsReview({ revision_reviewed: 1 }))).toBe(false);
  });

  it("never flags a Copied row", () => {
    expect(isNeedsActionRow(row({ revision_carry_status: "Copied" }))).toBe(false);
  });

  it("never flags an UNSTAMPED row", () => {
    // S4 inverted this: blank now means "not a revision row at all" (an upload/template row, or a
    // spacer), NOT "an ordinary parsed row that still needs review".
    expect(isNeedsActionRow(row())).toBe(false);
    expect(isNeedsActionRow(row({ revision_carry_status: "" }))).toBe(false);
  });

  it("never flags a legacy-stamped row", () => {
    // A pre-Amendment-B stamp is not `Needs Review`, so it cannot block finalize -- which is
    // exactly the no-retroactive-lockout property the backend gate relies on.
    for (const legacy of ["Matched", "New", "Ambiguous", "Drifted"]) {
      expect(isNeedsActionRow(row({ revision_carry_status: legacy }))).toBe(false);
    }
  });

  it("does not clear on a value edit alone", () => {
    // A quantity fix stamps edited_at but says nothing about classification, so the row keeps
    // blocking until someone actually confirms it. The backend is the authority here -- it simply
    // never sets revision_reviewed for a value edit.
    expect(isNeedsActionRow(needsReview({ edited_at: "2026-07-20 10:00:00" }))).toBe(true);
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

  it("a stamped row -> 'needs-action' with the row listed and in the membership set", () => {
    const rows = [
      row({ row_index: 0, revision_carry_status: "Copied" }),
      needsReview({ row_index: 1, source_row_number: 42 }),
    ];
    const s = computeRevisionDelta(
      rows, meta({ copied_count: 1, needs_review_count: 1, total_count: 2 }));
    expect(s.mode).toBe("needs-action");
    expect(s.needsActionRows).toEqual([{ rowIndex: 1, excelRow: 42 }]);
    expect(s.needsActionRowIndexes.has(1)).toBe(true);
    expect(s.needsActionRowIndexes.has(0)).toBe(false);
  });

  it("a confirmed row drops off -> back to the chip", () => {
    const rows = [
      row({ row_index: 0, revision_carry_status: "Copied" }),
      needsReview({ row_index: 1, revision_reviewed: 1 }),
    ];
    const s = computeRevisionDelta(
      rows, meta({ copied_count: 1, needs_review_count: 1, total_count: 2 }));
    expect(s.mode).toBe("no-deltas");
    expect(s.needsActionRows).toEqual([]);
  });

  it("lists needs-review rows in document order", () => {
    const rows = [
      needsReview({ row_index: 0, source_row_number: 5 }),
      row({ row_index: 1, revision_carry_status: "Copied" }),
      needsReview({ row_index: 2, source_row_number: 9 }),
    ];
    const s = computeRevisionDelta(
      rows, meta({ copied_count: 1, needs_review_count: 2, total_count: 3 }));
    expect(s.needsActionRows.map((r) => r.rowIndex)).toEqual([0, 2]);
  });

  it("a sheet that carried NOTHING still shows its chrome", () => {
    // ⚠️ S4 CLOSED A HOLE. The old gate was `total > 0 && copied > 0`, so a mapped sheet that
    // aligned with nothing (the shape one row inserted near the top produces, and which real data
    // already contains) rendered as an ordinary fresh upload -- silently the worst case.
    const s = computeRevisionDelta(
      [needsReview({ row_index: 0 }), needsReview({ row_index: 1 })],
      meta({ copied_count: 0, needs_review_count: 2, total_count: 2 }),
    );
    expect(s.mode).toBe("needs-action");
    expect(s.needsActionRows).toHaveLength(2);
  });

  it("a declared-New / unmapped sheet (nothing to diff against) -> 'none'", () => {
    const s = computeRevisionDelta(
      [row(), row({ row_index: 1 })],
      meta({ copied_count: 0, needs_review_count: 0, total_count: 0 }),
    );
    expect(s.mode).toBe("none");
  });

  it("surfaces the server counts verbatim (they do NOT move as work is done)", () => {
    const rows = [
      row({ row_index: 0, revision_carry_status: "Copied" }),
      needsReview({ row_index: 1, revision_reviewed: 1 }),
    ];
    const s = computeRevisionDelta(
      rows, meta({ copied_count: 412, needs_review_count: 88, total_count: 500 }));
    // The reviewer has confirmed the one live row, but the CARRY counts describe the parse.
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

  it("builds the change blocks from the sheet summary", () => {
    const s = computeRevisionDelta(
      [needsReview()],
      meta({
        copied_count: 0, needs_review_count: 1, total_count: 1,
        change_summary: {
          shift_blocks: [{ anchor: 50, delta: 2, change: 2, shifted_count: 340,
                           inserted_excel_rows: [50, 51] }],
        },
      }),
    );
    expect(s.changeBlocks).toHaveLength(1);
    expect(s.changeBlocks[0].text).toContain("2 rows inserted at row 50");
  });

  it("has no change blocks when the sheet reports no summary", () => {
    const s = computeRevisionDelta([row({ revision_carry_status: "Copied" })], meta());
    expect(s.changeBlocks).toEqual([]);
  });
});

describe("status badges", () => {
  it("gives the three revision states distinct labels", () => {
    const labels = [
      REVISION_COPIED_BADGE.label,
      REVISION_NEEDS_REVIEW_BADGE.label,
      REVISION_REVIEWED_BADGE.label,
    ];
    expect(new Set(labels).size).toBe(3);
  });

  it("keeps Copied off the Original gray", () => {
    expect(REVISION_COPIED_BADGE.className).not.toContain("gray");
  });

  it("makes the blocking state red and the confirmed state calm", () => {
    expect(REVISION_NEEDS_REVIEW_BADGE.className).toContain("red");
    expect(REVISION_REVIEWED_BADGE.className).not.toContain("red");
  });
});
