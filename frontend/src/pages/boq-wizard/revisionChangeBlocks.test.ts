import { describe, expect, it } from "vitest";

import {
  buildChangeBlocks,
  countUnaffirmed,
  DESCRIPTION_CHANGED,
  DUPLICATE_POSITION,
  isCollateralReason,
  isNeedsReviewRow,
  isUnaffirmed,
  NEEDS_REVIEW_STATUS,
  NO_EXCEL_POSITION,
  PARENT_NOT_CARRIED,
  POSITION_SHIFTED,
  reasonSentence,
  reasonShortLabel,
  ROW_INSERTED,
  SOURCE_UNCLASSIFIED,
  type RevisionRowLike,
} from "./revisionChangeBlocks";

const ALL_REASONS = [
  ROW_INSERTED, POSITION_SHIFTED, DESCRIPTION_CHANGED, PARENT_NOT_CARRIED,
  DUPLICATE_POSITION, NO_EXCEL_POSITION, SOURCE_UNCLASSIFIED,
];

function row(over: Partial<RevisionRowLike> = {}): RevisionRowLike {
  return {
    row_index: 0,
    source_row_number: 10,
    revision_carry_status: NEEDS_REVIEW_STATUS,
    revision_review_reason: DESCRIPTION_CHANGED,
    revision_shift_delta: 0,
    revision_shift_anchor: 0,
    revision_reviewed: 0,
    ...over,
  };
}

describe("row predicates", () => {
  it("treats only the stamped status as needing review", () => {
    expect(isNeedsReviewRow(row())).toBe(true);
    expect(isNeedsReviewRow(row({ revision_carry_status: "Copied" }))).toBe(false);
    expect(isNeedsReviewRow(row({ revision_carry_status: null }))).toBe(false);
  });

  it("stops counting a row once it is affirmed", () => {
    expect(isUnaffirmed(row())).toBe(true);
    expect(isUnaffirmed(row({ revision_reviewed: 1 }))).toBe(false);
  });

  it("never counts a copied or unstamped row as blocking", () => {
    // Off a revision every row is unstamped, so the whole layer is inert there.
    expect(isUnaffirmed(row({ revision_carry_status: "Copied" }))).toBe(false);
    expect(isUnaffirmed(row({ revision_carry_status: null }))).toBe(false);
  });

  it("counts the blocking subset", () => {
    expect(countUnaffirmed([
      row({ row_index: 0 }),
      row({ row_index: 1, revision_reviewed: 1 }),
      row({ row_index: 2, revision_carry_status: "Copied" }),
      row({ row_index: 3 }),
    ])).toBe(2);
  });
});

describe("collateral boundary", () => {
  it("allows a bulk affirm only for a shifted row", () => {
    for (const reason of ALL_REASONS) {
      expect(isCollateralReason(reason)).toBe(reason === POSITION_SHIFTED);
    }
  });

  it("treats a missing reason as causal", () => {
    // Fail safe: an unknown row must never be sweepable by a bulk action.
    expect(isCollateralReason(null)).toBe(false);
    expect(isCollateralReason(undefined)).toBe(false);
    expect(isCollateralReason("something_new")).toBe(false);
  });
});

describe("reason wording", () => {
  it("gives every code a distinct short label and a sentence", () => {
    const labels = ALL_REASONS.map(reasonShortLabel);
    expect(new Set(labels).size).toBe(ALL_REASONS.length);
    for (const reason of ALL_REASONS) {
      expect(reasonSentence(row({ revision_review_reason: reason })).length).toBeGreaterThan(10);
    }
  });

  it("states the direction and distance of a shift", () => {
    expect(reasonSentence(row({ revision_review_reason: POSITION_SHIFTED, revision_shift_delta: 2 })))
      .toContain("Moved down 2 rows");
    expect(reasonSentence(row({ revision_review_reason: POSITION_SHIFTED, revision_shift_delta: -3 })))
      .toContain("Moved up 3 rows");
  });

  it("says row, not rows, for a single-row shift", () => {
    expect(reasonSentence(row({ revision_review_reason: POSITION_SHIFTED, revision_shift_delta: 1 })))
      .toContain("Moved down 1 row because");
  });

  it("names the colliding Excel row on a duplicate", () => {
    expect(reasonSentence(row({ revision_review_reason: DUPLICATE_POSITION, source_row_number: 42 })))
      .toContain("Excel row 42");
  });

  it("still says something true for a code it does not know", () => {
    // A backend ahead of this build must not render a blank warning -- the row needs confirming
    // either way.
    const text = reasonSentence(row({ revision_review_reason: "invented_later" }));
    expect(text).toContain("Confirm its classification");
    expect(reasonShortLabel("invented_later")).toBe("Needs review");
  });
});

describe("buildChangeBlocks", () => {
  it("says nothing when there is no summary", () => {
    expect(buildChangeBlocks(null)).toEqual([]);
    expect(buildChangeBlocks(undefined)).toEqual([]);
    expect(buildChangeBlocks({})).toEqual([]);
  });

  it("states one insertion once, with its blast radius", () => {
    const [entry] = buildChangeBlocks({
      shift_blocks: [{ anchor: 50, delta: 2, change: 2, shifted_count: 340,
                       inserted_excel_rows: [50, 51] }],
    });
    expect(entry.kind).toBe("insert");
    expect(entry.text).toBe("2 rows inserted at row 50 — 340 rows below shifted down.");
    expect(entry.anchor).toBe(50);
    expect(entry.delta).toBe(2);
    expect(entry.shiftedCount).toBe(340);
  });

  it("states a deletion with the opposite direction", () => {
    const [entry] = buildChangeBlocks({
      shift_blocks: [{ anchor: 210, delta: -3, change: -3, shifted_count: 88,
                       inserted_excel_rows: [] }],
    });
    expect(entry.kind).toBe("delete");
    expect(entry.text).toBe("3 rows deleted at row 210 — 88 rows below shifted up.");
  });

  it("keys a block by anchor AND delta", () => {
    // Two blocks can resolve to the same anchor with different offsets; the key must not collide
    // or React reuses the wrong row and the bulk affirm targets the wrong block.
    const entries = buildChangeBlocks({
      shift_blocks: [
        { anchor: 50, delta: 2, change: 2, shifted_count: 5, inserted_excel_rows: [] },
        { anchor: 50, delta: 7, change: 5, shifted_count: 9, inserted_excel_rows: [] },
      ],
    });
    expect(new Set(entries.map((e) => e.key)).size).toBe(2);
  });

  it("reports each edit point separately", () => {
    const entries = buildChangeBlocks({
      shift_blocks: [
        { anchor: 2, delta: 1, change: 1, shifted_count: 2, inserted_excel_rows: [2] },
        { anchor: 5, delta: 2, change: 1, shifted_count: 2, inserted_excel_rows: [5] },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[1].text).toContain("1 row inserted at row 5");
  });

  it("names removed originals with the source version", () => {
    const entries = buildChangeBlocks(
      { removed_rows: [{ excel_row: 30, description: "Deleted Section" }], removed_count: 1 },
      3,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("removed");
    expect(entries[0].text).toBe("1 row from the original (v3) is not in this revision.");
    expect(entries[0].anchor).toBeUndefined();
  });

  it("drops the version when it is unknown", () => {
    const [entry] = buildChangeBlocks({ removed_count: 2 }, null);
    expect(entry.text).toBe("2 rows from the original are not in this revision.");
  });

  it("discloses a capped enumeration instead of under-reporting", () => {
    const entries = buildChangeBlocks({
      shift_blocks: [{ anchor: 1, delta: 1, change: 1, shifted_count: 1, inserted_excel_rows: [] }],
      block_count: 4,
    });
    expect(entries[1].text).toBe("…and 3 more changes not listed.");
  });

  it("puts the removed line last", () => {
    const entries = buildChangeBlocks({
      shift_blocks: [{ anchor: 5, delta: 1, change: 1, shifted_count: 3, inserted_excel_rows: [] }],
      removed_count: 2,
    });
    expect(entries.map((e) => e.kind)).toEqual(["insert", "removed"]);
  });
});
