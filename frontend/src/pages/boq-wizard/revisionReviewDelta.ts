/**
 * Revised-BoQ review-screen surfacing (S5b / #1103 -> **Amendment B** -> **S4**) -- PURE, no React.
 *
 * ⚠️ THE POLARITY HAS FLIPPED TWICE. Read this before changing anything.
 *
 *   original    a four-value stamp (Matched / New / Ambiguous / Drifted); the STAMPED rows were
 *               the deltas needing attention.
 *   Amendment B one stamp, `Copied`. The UNSTAMPED rows were what needed attention, and
 *               "handled" was DERIVED client-side from edits and AI accepts.
 *   S4 (now)    two stamps. `Copied`, and `Needs Review` carrying the reason it did not carry.
 *               Blank means "not a revision row at all" -- an upload/template row, or a spacer.
 *
 * So the set needing attention is STAMPED again, and "handled" is STORED (`revision_reviewed`)
 * rather than derived. That is the substantive change: the reviewer's confirmation is now durable
 * and server-side, which is what lets the finalize gate depend on it. A classification or parent
 * edit still clears a row silently -- the backend auto-affirms at its write chokepoint -- so the
 * self-clearing behaviour survives, it just happens somewhere it can be trusted.
 *
 * Consequence worth knowing: a VALUE edit (qty / unit) no longer clears a row. It never should
 * have -- fixing a quantity says nothing about whether the row is classified correctly.
 *
 * The row-level vocabulary, predicates and wording live in `revisionChangeBlocks.ts`; this module
 * owns the SHEET-level summary and the badges. `computeRevisionDelta` remains the gate (inert
 * unless `meta.is_revision`) and still publishes `needsActionRowIndexes` so callers filter by
 * MEMBERSHIP rather than re-deriving a predicate where the gate does not apply.
 */

import type { ChangeBlockEntry, RevisionChangeSummary } from "./revisionChangeBlocks";
import { buildChangeBlocks, isUnaffirmed } from "./revisionChangeBlocks";

/** The `revision_carry_status` values the backend stamps. Blank/absent = not a revision row. */
export type RevisionCarryStatus = "" | "Copied" | "Needs Review";

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
  /**
   * S4: the FINALIZE-BLOCKING subset -- needs-review rows not yet confirmed. Deliberately a
   * different number from `needs_review_count`, which describes the PARSE and never moves: this
   * one describes REMAINING WORK and falls to 0. Collapsing them loses one of the two.
   *
   * Server-computed by the SAME function the finalize gate refuses on, so the button's disabled
   * state and the server's answer cannot drift (ADR-0010 F1).
   */
  unaffirmed_count?: number;
  /** S4: the sheet-level insertion/deletion events, for the grouped warnings panel. */
  change_summary?: RevisionChangeSummary | null;
  source_version: number | null;
}

/** Minimal structural view of a review row this module reads (keeps it decoupled from ReviewRow). */
interface DeltaRowLike {
  row_index: number;
  source_row_number: number | null;
  revision_carry_status?: string | null;
  // S4 -- the stamped reason + the reviewer's stored confirmation.
  revision_review_reason?: string | null;
  revision_shift_delta?: number | null;
  revision_shift_anchor?: number | null;
  revision_reviewed?: number | null;
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
 * A row still BLOCKING finalize -- stamped `Needs Review` and not yet confirmed.
 *
 * S4 replaced the derived predicate (`!copied && !edited && !ai-accepted`) with the stored one. The
 * AI-accept and edit clauses are gone because the backend now auto-affirms at its write chokepoint,
 * which covers manual edits AND both accept paths -- and does so durably, which the derived version
 * could not. Spacers are excluded for free: the parse never stamps one.
 *
 * ⚠️ ONLY meaningful on a revision sheet -- off a revision nothing is stamped. Prefer
 * `RevisionDeltaSummary.needsActionRowIndexes` at call sites; this is exported for the gate itself
 * and for unit tests.
 */
export function isNeedsActionRow(row: DeltaRowLike): boolean {
  return isUnaffirmed(row);
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
  /** Server counts, from the persisted stamp. These describe the PARSE and do NOT move as the
   *  reviewer works -- `needsActionRows.length` is the one that falls to zero. */
  copiedCount: number;
  needsReviewCount: number;
  totalCount: number;
  /** The still-blocking subset, in document order. Clears as rows are confirmed. */
  needsActionRows: NeedsActionRow[];
  /** `needsActionRows` as a membership set -- what the tree filter should test against. */
  needsActionRowIndexes: ReadonlySet<number>;
  /** S4: one entry per insertion / deletion, plus the removed-originals line. */
  changeBlocks: ChangeBlockEntry[];
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
  changeBlocks: [],
  sourceVersion: null,
};

/**
 * Fold the per-row stamps + the revision meta into the sheet-level surfacing decision. Pure over
 * (rows, meta); a null/non-revision meta returns the inert EMPTY_SUMMARY.
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

  // ⚠️ S4 CLOSED A HOLE HERE. The gate used to be `totalCount > 0 && copiedCount > 0`, so a mapped
  // sheet that aligned with NOTHING (copied 0 -- the shape a single row inserted near the top
  // produces, and which real data already contains) rendered no revision chrome at all and looked
  // like an ordinary fresh upload. The sheet that carried nothing is precisely the one that most
  // needs to say so, so the gate is now content-only.
  let mode: RevisionDeltaSummary["mode"];
  if (totalCount === 0) {
    // A declared-New / unmapped sheet has no original to diff against -- a genuinely fresh sheet.
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
    changeBlocks: buildChangeBlocks(meta.change_summary, meta.source_version),
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

/**
 * Status-column pill for a row still awaiting confirmation (S4). Red, because this is the one
 * revision state that holds the sheet: nothing downstream moves until it is cleared.
 *
 * ⚠️ Distinct from the must-fix structural-break red, which is a FILL on the warnings panel. This
 * is a pill + a left BORDER on the row (see `REVISION_NEEDS_REVIEW_ROW_CLASS`), so the two reds
 * never render as the same object -- one blocks because the tree is broken, the other because a
 * human has not looked yet, and they are fixed in completely different ways.
 */
export const REVISION_NEEDS_REVIEW_BADGE = {
  label: "Needs review",
  className: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300",
} as const;

/**
 * Status-column pill for a row the reviewer has confirmed. Calm -- the work is done, and the row
 * should stop competing for attention. Ranks below `Edited`: if they edited it, that is the more
 * specific truth.
 */
export const REVISION_REVIEWED_BADGE = {
  label: "Reviewed",
  className: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
} as const;

/**
 * Row treatment for an unconfirmed needs-review row: a red LEFT BORDER plus a wash.
 *
 * A border rather than a full fill, deliberately -- the review tree already spends its background
 * channel on the edited-green tint and its ring channel on search hits, and the wizard's rule is
 * that one annotation channel must never mask another.
 */
export const REVISION_NEEDS_REVIEW_ROW_CLASS =
  "border-l-2 border-l-red-400 dark:border-l-red-500 bg-red-50/40 dark:bg-red-950/10";
