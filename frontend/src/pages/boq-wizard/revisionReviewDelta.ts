/**
 * Revised-BoQ review-screen surfacing (S5b / #1103, ADR-0014 D7 + **Amendment B** 2026-07-20)
 * -- PURE, no React (F4).
 *
 * AMENDMENT B INVERTED THIS MODULE'S POLARITY. Read this before changing anything.
 *
 * The old rule stamped a four-value outcome (Matched / New / Ambiguous / Drifted) and treated the
 * STAMPED values New/Ambiguous as the deltas needing attention, with Matched as the calm default.
 * Amendment B leaves exactly one status:
 *
 *   `Copied`  -- this row sat at the same Excel row with the same description as the original AND
 *                its parent did too, so it carried the original's effective classification AND
 *                parenting. Calm: a decision already made.
 *   blank     -- everything else. An ordinary parsed row, rendered "Original" exactly like a fresh
 *                upload, with every classifier warning / review flag / structural check applying
 *                unchanged (A9).
 *
 * So the set needing human attention is now the UNSTAMPED rows, not the stamped ones. `New`,
 * `Ambiguous` and `Drifted` are RETIRED -- never stamped again; a row still carrying one from an
 * older parse falls through to "Original", which is exactly right for it.
 *
 * ⚠️ The "needs review" predicate is only meaningful ON A REVISION SHEET -- off a revision EVERY
 * row is unstamped. `computeRevisionDelta` is the gate (it returns the inert summary unless
 * `meta.is_revision`), and it publishes `needsActionRowIndexes` so callers filter by MEMBERSHIP
 * rather than re-deriving the predicate somewhere the gate does not apply.
 *
 * SELF-CLEARING (D7, CL-6's pattern -- "do not add clearing code"): a row leaves the needs-action
 * set the moment the human touches it (an edit, or an accepted AI suggestion), because that fact is
 * DERIVED here, never stored. `isNeedsActionRow` mirrors the review Status column's precedence
 * EXACTLY (Accepted-Claude > Accepted-Gemini > Edited > the row's own state), so the panel can never
 * list a row the column already renders as handled.
 *
 * REVISION-ONLY by construction: a non-revision sheet gets `is_revision:false` meta, so every
 * derivation below is inert and the review screen stays byte-identical.
 */

/** The `revision_carry_status` values the backend stamps. Blank/absent = an ordinary parsed row. */
export type RevisionCarryStatus = "" | "Copied";

/**
 * The revision meta block get_review_rows adds for a revision sheet (null for upload/template).
 *
 * Amendment B replaced the two advisory SETS with three COUNTS. There is no removed-row advisory
 * and no parent-lost advisory any more: a row whose parent did not match simply does not copy
 * (both-or-neither), so it is already in the needs-review set rather than being a separate class.
 * The counts are server-derived from the persisted stamp; `copied + needs_review === total`.
 */
export interface RevisionReviewMeta {
  is_revision: boolean;
  copied_count: number;
  needs_review_count: number;
  total_count: number;
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
  description?: string | null;
}

/** The one status the carry writes. */
export const COPIED_STATUS = "Copied";

/** True when this row carried its classification + parenting forward from the original. */
export function isRowCopied(row: DeltaRowLike): boolean {
  return row.revision_carry_status === COPIED_STATUS;
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
 * A row that did NOT copy and that the human has not yet handled -- i.e. exactly the set for which
 * the Status column renders "Original" on a revision sheet with nothing higher-precedence applying.
 * Self-clearing: an Accepted AI suggestion OR a manual edit drops the row silently.
 *
 * ⚠️ ONLY meaningful on a revision sheet -- see the module header. Prefer
 * `RevisionDeltaSummary.needsActionRowIndexes` at call sites; this is exported for the gate itself
 * and for unit tests.
 *
 * A blank-description row (spacer) is excluded: it never entered the match, carries nothing and
 * demands nothing, so listing it as "needs review" would be noise.
 */
export function isNeedsActionRow(row: DeltaRowLike): boolean {
  return (
    !isRowCopied(row) &&
    (row.description ?? "").trim() !== "" &&
    row.ai_suggestion_status !== "Accepted" &&
    row.gemini_suggestion_status !== "Accepted" &&
    !isReviewRowEdited(row)
  );
}

/** One needs-action row, ready for the R4-shaped panel (clickable -> revealAndScrollToRow). */
export interface NeedsActionRow {
  rowIndex: number;
  excelRow: number | null;
}

/** The sheet-level surfacing decision + data for the panel / chip. */
export interface RevisionDeltaSummary {
  /** Whether this sheet is a revision sheet with carry chrome at all. */
  isRevision: boolean;
  /**
   * none         -> render nothing extra (upload/template, or a declared-New/unmapped revision
   *                 sheet that carried nothing -- treated as a fresh sheet).
   * no-deltas    -> the green chip (every content row copied; nothing needs review).
   * needs-action -> the amber R4-shaped panel (>=1 unhandled uncopied row).
   */
  mode: "none" | "no-deltas" | "needs-action";
  /** Server counts, from the persisted stamp. These do NOT self-clear as the human works. */
  copiedCount: number;
  needsReviewCount: number;
  totalCount: number;
  /** The SELF-CLEARING unhandled subset, in document order. */
  needsActionRows: NeedsActionRow[];
  /** `needsActionRows` as a membership set -- what the tree filter should test against. */
  needsActionRowIndexes: ReadonlySet<number>;
  /** The original's version, for the chip / panel label ("copied from v3"). */
  sourceVersion: number | null;
}

const EMPTY_SUMMARY: RevisionDeltaSummary = {
  isRevision: false,
  mode: "none",
  copiedCount: 0,
  needsReviewCount: 0,
  totalCount: 0,
  needsActionRows: [],
  needsActionRowIndexes: new Set<number>(),
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

  const needsActionRows: NeedsActionRow[] = [];
  for (const row of rows) {
    if (isNeedsActionRow(row)) {
      needsActionRows.push({
        rowIndex: row.row_index,
        excelRow: row.source_row_number ?? null,
      });
    }
  }

  const copiedCount = meta.copied_count ?? 0;
  const needsReviewCount = meta.needs_review_count ?? 0;
  const totalCount = meta.total_count ?? 0;

  // A declared-New / unmapped revision sheet carries nothing and has no original to diff against,
  // so it shows no revision chrome (treated as a fresh sheet).
  const hasCarriedContent = totalCount > 0 && copiedCount > 0;

  let mode: RevisionDeltaSummary["mode"];
  if (!hasCarriedContent) {
    mode = "none";
  } else if (needsActionRows.length === 0) {
    mode = "no-deltas";
  } else {
    mode = "needs-action";
  }

  return {
    isRevision: true,
    mode,
    copiedCount,
    needsReviewCount,
    totalCount,
    needsActionRows,
    needsActionRowIndexes: new Set(needsActionRows.map((r) => r.rowIndex)),
    sourceVersion: meta.source_version ?? null,
  };
}

/**
 * Status-column pill for a COPIED row. Calm and informational -- it says "this decision came from
 * the original", not "look at me". Blue is free (the retired `New` badge released it) and stays
 * clear of indigo/violet (accepted AI), green (edited) and gray (Original).
 */
export const REVISION_COPIED_BADGE = {
  label: "Copied",
  className: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300",
} as const;
