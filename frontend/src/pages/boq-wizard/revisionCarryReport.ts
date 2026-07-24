/**
 * Revision-carry REPORTING copy (W5 / ADR-0014 Amendment B) -- PURE, no React (ADR-0010 F4).
 *
 * Two backend surfaces compute how much of a revision actually carried and, until W5, threw the
 * numbers away: the parse worker's per-sheet {copied, needs_review, total} and the commit
 * pipeline's per-layer overlay summary. The user revised a BoQ and had no idea how much came
 * across. Both payloads are now optional keys on existing envelopes, and this module turns them
 * into the sentence each modal renders -- the formatting lives here, not in JSX, so it is
 * unit-testable and the two modals cannot drift apart on wording.
 *
 * Both functions return `null` for "say nothing", which is the honest answer for a non-revision
 * parse/commit (the key is absent entirely) and for a revision sheet that had nothing to match
 * against (a declared-New / unmapped sheet, total 0).
 */

/** Per-sheet carry counts from the `boq:parse_run_done` payload's optional `revision_carry`. */
export interface SheetCarryCounts {
  copied: number;
  needs_review: number;
  total: number;
}

/** `revision_carry`: VERBATIM sheet_name (#152) -> that sheet's counts. Absent off a revision. */
export type RevisionCarryBySheet = Record<string, SheetCarryCounts>;

/** One carrying sheet's line for the per-sheet breakdown. */
export interface SheetCarryLine {
  /** VERBATIM sheet name -- the React key. Never use the display text as a key. */
  sheetName: string;
  /** Display-trimmed name (falls back to the verbatim one if trimming empties it). */
  label: string;
  text: string;
}

export interface RevisionCarryReport {
  /** The one-line aggregate, always present when the report is non-null. */
  headline: string;
  /**
   * Per-sheet lines -- EMPTY when only one sheet carried (the headline already said it all).
   * Sheets that matched nothing (total 0) never appear.
   */
  perSheet: SheetCarryLine[];
}

/** `N thing` / `N things` -- the counts here are all small integers, so no locale formatting. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Display-trim a sheet name; `.trim()` is for DISPLAY only (#152 keeps the raw name as the key). */
function displayName(sheetName: string): string {
  return sheetName.trim() || sheetName;
}

/**
 * Fold the parse worker's per-sheet carry counts into the parse-completion modal's advisory line.
 *
 * Returns null when there is nothing truthful to report: no `revision_carry` key (an ordinary
 * upload/template parse) or every sheet matched zero rows.
 */
export function summarizeRevisionCarry(
  carry: RevisionCarryBySheet | undefined | null,
): RevisionCarryReport | null {
  if (!carry) return null;

  // Only sheets that actually entered the match are reportable; a declared-New / unmapped sheet
  // comes back all-zero and would otherwise read as "0 of 0 copied".
  const entries = Object.entries(carry).filter(([, c]) => (c?.total ?? 0) > 0);
  if (entries.length === 0) return null;

  let copied = 0;
  let total = 0;
  for (const [, c] of entries) {
    copied += c.copied ?? 0;
    total += c.total ?? 0;
  }

  // needs_review is derived, not summed: copied + needs_review === total by construction, and
  // deriving it keeps the sentence internally consistent even if a sheet's counts disagree.
  const needsReview = total - copied;
  const sheetCount = entries.length;
  const scope = sheetCount > 1 ? ` across ${plural(sheetCount, "sheet", "sheets")}` : "";
  const tail = needsReview > 0
    ? `; ${plural(needsReview, "row needs", "rows need")} review`
    : "";
  const headline =
    `Carried from the original: ${copied} of ${plural(total, "row", "rows")} copied${scope}${tail}.`;

  // One carrying sheet -> the headline IS the breakdown; more than one -> name them so the user
  // can see WHICH sheet is the one needing work.
  const perSheet: SheetCarryLine[] = sheetCount > 1
    ? entries.map(([sheetName, c]) => ({
        sheetName,
        label: displayName(sheetName),
        text: `${c.copied} of ${plural(c.total, "row", "rows")} copied`,
      }))
    : [];

  return { headline, perSheet };
}
