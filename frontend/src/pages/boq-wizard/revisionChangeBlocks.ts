/**
 * Revision needs-review WORDING + warning grouping (S4) -- PURE, no React (ADR-0010 F4).
 *
 * The backend ships stable machine codes (`services/boq_revision/reasons.py`) and this module owns
 * every sentence the reviewer reads -- the same split `review_screen` already uses for structural
 * breaks (`type` on the wire, `WARN_BREAK_LABELS` here). Re-wording is then a frontend edit with no
 * migration, and nothing downstream ever keys on display text.
 *
 * WHY THE GROUPING LIVES HERE. One row inserted near the top of a 400-row sheet leaves ~399 rows
 * unable to carry. Listing 399 warnings describes the sheet, not the edit; the reviewer needs to
 * read "2 rows inserted at row 50" once. So the warnings panel renders BLOCKS -- one entry per
 * insertion / deletion, sized by its blast radius -- while the rows themselves stay individually
 * affirmable. Block entries come from the sheet-level `change_summary` the parse stamped, not from
 * re-deriving anything client-side.
 *
 * CAUSAL vs COLLATERAL is the same boundary the backend enforces: only `position_shifted` rows can
 * be cleared by a block-level bulk affirm. An inserted / reworded / heading-changed row is a
 * decision someone has to make, so it is never swept up -- and the diagnosis deliberately labels an
 * ambiguous row CAUSAL for exactly that reason.
 */

/** The one status the parse stamps on a row that did not carry. Mirrors `reasons.NEEDS_REVIEW`. */
export const NEEDS_REVIEW_STATUS = "Needs Review";

/** Reason codes -- mirror `services/boq_revision/reasons.py`. */
export const ROW_INSERTED = "row_inserted";
export const POSITION_SHIFTED = "position_shifted";
export const DESCRIPTION_CHANGED = "description_changed";
export const PARENT_NOT_CARRIED = "parent_not_carried";
export const DUPLICATE_POSITION = "duplicate_position";
export const NO_EXCEL_POSITION = "no_excel_position";
export const SOURCE_UNCLASSIFIED = "source_unclassified";

/**
 * Reasons a row may be cleared by a BLOCK bulk affirm. Deliberately one member -- see the module
 * header. Mirrors `reasons.COLLATERAL_REASONS`; widening it here without widening it there would
 * offer the reviewer a button the server refuses to honour.
 */
const COLLATERAL_REASONS: ReadonlySet<string> = new Set([POSITION_SHIFTED]);

export function isCollateralReason(reason: string | null | undefined): boolean {
  return !!reason && COLLATERAL_REASONS.has(reason);
}

/** Minimal structural view of a review row (keeps this module decoupled from ReviewRow). */
export interface RevisionRowLike {
  row_index: number;
  source_row_number?: number | null;
  revision_carry_status?: string | null;
  revision_review_reason?: string | null;
  revision_shift_delta?: number | null;
  revision_shift_anchor?: number | null;
  revision_reviewed?: number | null;
}

/** `N thing` / `N things`. Counts here are small integers, so no locale formatting. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Short chip label per code -- the terse form, for the row itself. */
const SHORT_LABELS: Readonly<Record<string, string>> = {
  [ROW_INSERTED]: "New row",
  [POSITION_SHIFTED]: "Moved",
  [DESCRIPTION_CHANGED]: "Text changed",
  [PARENT_NOT_CARRIED]: "Heading changed",
  [DUPLICATE_POSITION]: "Duplicate row",
  [NO_EXCEL_POSITION]: "No row number",
  [SOURCE_UNCLASSIFIED]: "Not classified in original",
};

/**
 * The full sentence per code. Written in the review screen's house voice: state what happened,
 * then what to do (mirrors `_STRUCTURAL_ERROR_REASON_BY_CODE`). "Classification" stands in for
 * classification-and-parenting throughout -- the parenting is implied by the tree and naming both
 * every time reads as noise.
 */
export function reasonSentence(row: RevisionRowLike): string {
  const reason = row.revision_review_reason ?? "";
  switch (reason) {
    case ROW_INSERTED:
      return "New row — it wasn't in the original, so nothing was copied. Set its classification.";
    case POSITION_SHIFTED: {
      const delta = row.revision_shift_delta ?? 0;
      const moved = delta >= 0
        ? `Moved down ${plural(delta, "row", "rows")} because rows were added above`
        : `Moved up ${plural(-delta, "row", "rows")} because rows were removed above`;
      return `${moved} — its classification wasn't copied. Confirm it still reads right.`;
    }
    case DESCRIPTION_CHANGED:
      return "The description here changed since the original, so nothing was copied. " +
        "Confirm its classification.";
    case PARENT_NOT_CARRIED:
      return "This row is unchanged, but the heading above it isn't — so its place in the tree " +
        "wasn't copied. Confirm where it belongs.";
    case DUPLICATE_POSITION:
      return `Two rows share Excel row ${row.source_row_number ?? "?"}, so this row couldn't be ` +
        "matched to the original. Confirm its classification.";
    case NO_EXCEL_POSITION:
      return "This row has no Excel row number, so it couldn't be matched to the original. " +
        "Confirm its classification.";
    case SOURCE_UNCLASSIFIED:
      return "The original had no usable classification for this row. Set it here.";
    default:
      // A code this build does not know (an older row, or a backend ahead of the frontend). Say
      // the true thing rather than nothing -- the row still needs confirming either way.
      return "This row didn't carry from the original. Confirm its classification.";
  }
}

export function reasonShortLabel(reason: string | null | undefined): string {
  return (reason && SHORT_LABELS[reason]) || "Needs review";
}

// ---------------------------------------------------------------------------
// Row-level predicates
// ---------------------------------------------------------------------------

/** True iff the parse stamped this row as needing review (whether or not it has been confirmed). */
export function isNeedsReviewRow(row: RevisionRowLike): boolean {
  return row.revision_carry_status === NEEDS_REVIEW_STATUS;
}

/**
 * True iff this row is still BLOCKING finalize -- stamped and not yet confirmed.
 *
 * This is the client mirror of `review_carry.unaffirmed_needs_review`. It drives the red treatment
 * and the "N left" count; the server refusal is the real boundary, and the count it reports rides
 * the review meta so the two can never disagree about the total.
 */
export function isUnaffirmed(row: RevisionRowLike): boolean {
  return isNeedsReviewRow(row) && !row.revision_reviewed;
}

export function countUnaffirmed(rows: RevisionRowLike[]): number {
  return rows.reduce((n, r) => n + (isUnaffirmed(r) ? 1 : 0), 0);
}

/**
 * True iff this row needed review and the reviewer has confirmed it.
 *
 * A distinct state from "never needed review", which is why the stamp is KEPT rather than blanked
 * on confirmation: the difference is exactly the audit trail a later revision (or a commit-time
 * question) would want, and blanking it would also break the sheet's `copied + needs_review ==
 * total` invariant as the reviewer worked.
 */
export function isConfirmedRow(row: RevisionRowLike): boolean {
  return isNeedsReviewRow(row) && !!row.revision_reviewed;
}

// ---------------------------------------------------------------------------
// Sheet-level change blocks (the warnings panel)
// ---------------------------------------------------------------------------

/** One shift block as persisted by the parse. */
export interface ShiftBlockSummary {
  anchor: number;
  delta: number;
  change: number;
  shifted_count: number;
  inserted_excel_rows: number[];
}

export interface RemovedRowSummary {
  excel_row: number;
  description: string;
}

/** `BoQ Sheet Draft.revision_change_summary`, as it rides `get_review_rows().revision`. */
export interface RevisionChangeSummary {
  shift_blocks?: ShiftBlockSummary[];
  removed_rows?: RemovedRowSummary[];
  block_count?: number;
  removed_count?: number;
}

export interface ChangeBlockEntry {
  /** Stable React key. `(anchor, delta)` is the block identity -- anchor alone is not unique. */
  key: string;
  /** `more` is the cap disclosure -- not an edit, and never a bulk-affirm target. */
  kind: "insert" | "delete" | "removed" | "more";
  text: string;
  /** Present for insert/delete only -- the bulk-affirm target. */
  anchor?: number;
  delta?: number;
  /** Collateral rows this block can bulk-affirm. 0 means the button has nothing to do. */
  shiftedCount?: number;
}

/**
 * Fold the sheet's persisted change summary into the warning lines the panel renders.
 *
 * Returns [] when there is nothing to say -- an upload/template sheet, a declared-New revision
 * sheet, or a revision whose rows all carried.
 *
 * The removed-rows line is LAST and has no bulk action: those rows exist only in the original, so
 * there is nothing on this sheet to affirm. It is information, not work.
 */
export function buildChangeBlocks(
  summary: RevisionChangeSummary | null | undefined,
  sourceVersion?: number | null,
): ChangeBlockEntry[] {
  if (!summary) return [];
  const entries: ChangeBlockEntry[] = [];

  for (const b of summary.shift_blocks ?? []) {
    // A block with change 0 records NO edit -- it is a grouping artefact, and rendering it walked
    // straight into the `change > 0 ? insert : delete` branch and printed "0 rows deleted at row N".
    // The parse no longer produces these (a spacer used to split a run; see diagnose._group_blocks),
    // but sheets stamped before that fix still carry them until they are re-parsed, so the guard
    // stays rather than relying on the data being clean.
    if (!b.change) continue;
    // The collateral COUNT is deliberately NOT stated (owner, 2026-07-22). "340 rows below shifted"
    // invites the reviewer to treat the block as one bulk fact and skip the rows themselves, which
    // is the opposite of what the panel is for -- it points at work, it does not summarise it away.
    const shifted = b.shifted_count ?? 0;
    const below = shifted > 0 ? ` — rows below shifted ${b.change > 0 ? "down" : "up"}.` : ".";
    entries.push({
      key: `blk-${b.anchor}-${b.delta}`,
      kind: b.change > 0 ? "insert" : "delete",
      text: b.change > 0
        ? `${plural(b.change, "row", "rows")} inserted at row ${b.anchor}${below}`
        : `${plural(-b.change, "row", "rows")} deleted at row ${b.anchor}${below}`,
      anchor: b.anchor,
      delta: b.delta,
      shiftedCount: shifted,
    });
  }

  // No silent caps: if the PARSE capped its enumeration, say so rather than under-reporting.
  //
  // Compared against the PERSISTED list length, not against `entries` -- the disclosure is about
  // the parse truncating, and comparing it to the rendered count would also fire for blocks this
  // function filtered out itself (the change-0 guard above), inventing changes that do not exist.
  const persisted = (summary.shift_blocks ?? []).length;
  const blockCount = summary.block_count ?? persisted;
  if (blockCount > persisted) {
    entries.push({
      key: "blk-more",
      kind: "more",
      text: `…and ${blockCount - persisted} more changes not listed.`,
    });
  }

  const removedCount = summary.removed_count ?? (summary.removed_rows ?? []).length;
  if (removedCount > 0) {
    const from = sourceVersion != null ? ` (v${sourceVersion})` : "";
    entries.push({
      key: "blk-removed",
      kind: "removed",
      text: `${plural(removedCount, "row", "rows")} from the original${from} ` +
        `${removedCount === 1 ? "is" : "are"} not in this revision.`,
    });
  }

  return entries;
}
