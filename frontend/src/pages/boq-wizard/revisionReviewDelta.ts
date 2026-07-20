/**
 * Revised-BoQ review-screen delta surfacing (S5b / #1103, ADR-0014 D7) -- PURE, no React (F4).
 *
 * The S5a backend (#1102) stamps `revision_carry_status` on every matched-content review row of
 * a revision sheet (Matched / New / Ambiguous; a carried row is Matched, the calm default). This
 * module turns that per-row field + the read-time advisory counts into the small set the human
 * must actually look at:
 *   - which rows are a DELTA (New / Ambiguous),
 *   - which of those still NEED ACTION (a delta the human has not yet handled -- self-clearing),
 *   - and the sheet-level mode: no revision chrome / a green "no deltas" chip / a needs-action panel.
 *
 * `Drifted` is RETIRED (owner amendment 2026-07-20). It existed only to flag a matched row whose
 * original effective classification disagreed with the fresh parse -- a hole that existed because
 * the carry read the human override set. The carry now copies the original's EFFECTIVE
 * classification + parenting outright, so the disagreement cannot arise and the status is never
 * stamped again. A row still carrying it from an older parse simply falls through to "Original".
 *
 * SELF-CLEARING (D7, CL-6's pattern -- "do not add clearing code"): a row leaves the needs-action
 * set the moment the human touches it (an edit, or an accepted AI suggestion), because that fact
 * is DERIVED here, never stored. `isNeedsActionRow` mirrors the review Status column's precedence
 * EXACTLY (Accepted-Claude > Accepted-Gemini > Edited > delta badge), so the panel can never list
 * a row the column already renders as handled. The spec names "AND NOT isEdited"; the two Accepted
 * states are added because the column already ranks them above the delta badge -- a faithful
 * superset that only ever REMOVES an already-handled row, never adds one.
 *
 * REVISION-ONLY by construction: a non-revision sheet has a blank `revision_carry_status` on every
 * row (never a delta) and `is_revision:false` meta, so every derivation below is inert and the
 * review screen stays byte-identical.
 */

/** The `revision_carry_status` values the backend stamps (blank/absent = a non-delta row). */
export type RevisionCarryStatus = "" | "Matched" | "New" | "Ambiguous";

/** The two DELTA statuses -- the only ones surfaced (a Matched/blank row gets no treatment). */
export type RevisionDeltaStatus = "New" | "Ambiguous";

/**
 * The revision meta block get_review_rows adds for a revision sheet (null for upload/template).
 * Both advisory sets are recomputed read-side (stable -- row descriptions are immutable
 * post-parse) and both render as MUTED PANEL LINES, never row badges (owner, 2026-07-20):
 *   removed_*     -- D6 REMOVED originals: no revised row exists to click through to.
 *   parent_lost_* -- MATCHED rows whose original parent has no twin here, so the carried
 *                    parenting could not be re-pointed and they kept the fresh parser's parent.
 */
export interface RevisionReviewMeta {
  is_revision: boolean;
  removed_count: number;
  removed_descriptions: string[];
  parent_lost_count: number;
  parent_lost_descriptions: string[];
  source_version: number | null;
}

/** Minimal structural view of a review row this module reads (keeps it decoupled from ReviewRow). */
interface DeltaRowLike {
  row_index: number;
  source_row_number: number | null;
  revision_carry_status?: string | null;
  ai_suggestion_status?: string | null;
  gemini_suggestion_status?: string | null;
  edited_at?: string | null;
  edit_log?: unknown[] | null;
}

const DELTA_STATUS_SET: ReadonlySet<string> = new Set<RevisionDeltaStatus>(["New", "Ambiguous"]);

/** True when `status` is one of the two surfaced DELTA statuses (New/Ambiguous). */
export function isDeltaStatus(status: string | null | undefined): status is RevisionDeltaStatus {
  return typeof status === "string" && DELTA_STATUS_SET.has(status);
}

/**
 * The SINGLE home (ADR-0010 F1) for the review row "Edited" predicate: a row is edited iff it has
 * an edited_at OR a non-empty edit_log. A remark / dismissal is NOT an edit (neither stamps those
 * fields). ReviewTree's Status column + green-tint + status filter all import THIS -- no inline copy.
 */
export function isReviewRowEdited(row: DeltaRowLike): boolean {
  return row.edited_at != null || (Array.isArray(row.edit_log) && row.edit_log.length > 0);
}

/**
 * A DELTA row the human has NOT yet handled -- i.e. the exact set for which the Status column
 * renders a delta badge (nothing higher-precedence applies). This is the self-clearing
 * needs-action predicate: an Accepted AI suggestion OR a manual edit drops the row silently.
 */
export function isNeedsActionRow(row: DeltaRowLike): boolean {
  return (
    isDeltaStatus(row.revision_carry_status) &&
    row.ai_suggestion_status !== "Accepted" &&
    row.gemini_suggestion_status !== "Accepted" &&
    !isReviewRowEdited(row)
  );
}

/** One needs-action row, ready for the R4-shaped panel (clickable -> revealAndScrollToRow). */
export interface NeedsActionRow {
  rowIndex: number;
  excelRow: number | null;
  status: RevisionDeltaStatus;
}

/** The sheet-level surfacing decision + data for the panel / chip. */
export interface RevisionDeltaSummary {
  /** Whether this sheet is a revision sheet with carry chrome at all. */
  isRevision: boolean;
  /**
   * none         -> render nothing extra (upload/template, or a declared-New/unmapped revision
   *                 sheet that carried nothing -- treated as a fresh sheet).
   * no-deltas    -> the green "no deltas" chip (all content carried; nothing needs action).
   * needs-action -> the amber R4-shaped panel (>=1 needs-action row, and/or removed originals).
   */
  mode: "none" | "no-deltas" | "needs-action";
  /** Count of Matched (carried) rows -- the chip's "N rows carried" number. */
  matchedCount: number;
  /** True when EVERY content row carried (no delta status appeared at all) -- pure all-Matched. */
  allMatched: boolean;
  /** The self-clearing needs-action rows, in row order (document order). */
  needsActionRows: NeedsActionRow[];
  /** D6 REMOVED originals (advisory only -- no revised row to click through to). */
  removedCount: number;
  removedDescriptions: string[];
  /** MATCHED rows whose original parent had no twin (advisory only -- deliberately not a badge). */
  parentLostCount: number;
  parentLostDescriptions: string[];
  /** The original's version, for the chip / panel label ("carried from v3"). */
  sourceVersion: number | null;
}

const EMPTY_SUMMARY: RevisionDeltaSummary = {
  isRevision: false,
  mode: "none",
  matchedCount: 0,
  allMatched: false,
  needsActionRows: [],
  removedCount: 0,
  removedDescriptions: [],
  parentLostCount: 0,
  parentLostDescriptions: [],
  sourceVersion: null,
};

/**
 * Fold the per-row `revision_carry_status` + the revision meta into the sheet-level surfacing
 * decision. Pure over (rows, meta); a null/non-revision meta returns the inert EMPTY_SUMMARY.
 */
export function computeRevisionDelta(
  rows: DeltaRowLike[],
  meta: RevisionReviewMeta | null | undefined,
): RevisionDeltaSummary {
  if (!meta || !meta.is_revision) return EMPTY_SUMMARY;

  let matchedCount = 0;
  let anyDelta = false;
  const needsActionRows: NeedsActionRow[] = [];
  for (const row of rows) {
    const status = row.revision_carry_status;
    if (status === "Matched") matchedCount++;
    if (isDeltaStatus(status)) {
      anyDelta = true;
      if (isNeedsActionRow(row)) {
        needsActionRows.push({
          rowIndex: row.row_index,
          excelRow: row.source_row_number ?? null,
          status,
        });
      }
    }
  }

  const removedCount = meta.removed_count ?? 0;
  const removedDescriptions = meta.removed_descriptions ?? [];
  const parentLostCount = meta.parent_lost_count ?? 0;
  const parentLostDescriptions = meta.parent_lost_descriptions ?? [];
  // A declared-New / unmapped revision sheet carries nothing (no Matched, no delta, no advisory) --
  // there is no original to diff against, so it shows no revision chrome (treated as fresh).
  const hasCarriedContent =
    matchedCount > 0 || anyDelta || removedCount > 0 || parentLostCount > 0;

  let mode: RevisionDeltaSummary["mode"];
  if (!hasCarriedContent) {
    mode = "none";
  } else if (needsActionRows.length === 0 && removedCount === 0 && parentLostCount === 0) {
    mode = "no-deltas";
  } else {
    // >=1 needs-action row and/or an advisory to show. An advisory-only panel is correct: the
    // rows themselves are calm (nothing to click), but the human should know the tree shifted.
    mode = "needs-action";
  }

  return {
    isRevision: true,
    mode,
    matchedCount,
    allMatched: !anyDelta && matchedCount > 0,
    needsActionRows,
    removedCount,
    removedDescriptions,
    parentLostCount,
    parentLostDescriptions,
    sourceVersion: meta.source_version ?? null,
  };
}

/** Status-column pill classes per DELTA status (distinct from indigo/violet/green/gray already used). */
export const REVISION_DELTA_BADGE: Record<
  RevisionDeltaStatus,
  { label: string; className: string }
> = {
  New: {
    label: "New",
    className: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200",
  },
  Ambiguous: {
    label: "Ambiguous",
    className: "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200",
  },
};
