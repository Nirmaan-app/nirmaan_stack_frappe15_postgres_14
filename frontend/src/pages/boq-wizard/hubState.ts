/**
 * hubState -- what the BoQ hub says about the BoQ as a whole (S6, ADR-0036): the subtitle stage,
 * the footer's counts, and which sheets changed since their last commit.
 *
 * "Changed since its last commit" (S6 F12, owner rulings Q-f and Q-i) = never committed, or
 * re-parsed after the commit: the draft's `last_parsed_at` (written only by the parse) is later
 * than the committed sheet's `committed_at` (written only by the commit). A sheet un-finalized,
 * edited and re-finalized WITHOUT a re-parse is not detected -- no timestamp records that (Q-f).
 *
 * Pure: no React, no fetch.
 */

/** Both timestamps are the server's `now()` strings ("YYYY-MM-DD HH:MM:SS.ffffff"), so the
 *  string order is the time order. */
export function changedSinceCommit(
  lastParsedAt: string | null | undefined,
  committedAt: string | null | undefined,
  committed: boolean,
): boolean {
  if (!committed) return true;
  if (!lastParsedAt || !committedAt) return false;
  return lastParsedAt > committedAt;
}

export interface DraftLike {
  sheet_name: string;
  last_parsed_at?: string | null;
}

export interface CommittedLike {
  committed_at: string | null;
}

/** The VERBATIM names (#152) of the sheets that changed since their last commit. */
export function sheetsChangedSinceCommit(
  drafts: readonly DraftLike[],
  committed: ReadonlyMap<string, CommittedLike>,
): Set<string> {
  const out = new Set<string>();
  for (const d of drafts) {
    const c = committed.get(d.sheet_name);
    if (changedSinceCommit(d.last_parsed_at, c?.committed_at, !!c)) out.add(d.sheet_name);
  }
  return out;
}

// ── The subtitle (U4) ────────────────────────────────────────────────────────

export const SUBTITLE_MAP = "Map sheets before parsing";
export const SUBTITLE_REVIEW = "Review parsed sheets";
export const SUBTITLE_READY = "Ready to commit";
export const SUBTITLE_COMMITTED = "Committed";

export interface HubStageInput {
  /** Effective status per data sheet (Skip / General specs / Hidden already left out). */
  statuses: readonly { sheet_name: string; status: string }[];
  changed: ReadonlySet<string>;
  committedCount: number;
}

/**
 * The stage after "V{n} · " for an uploaded BoQ (the template text is the page's own):
 * a Parsed sheet -> review; else a Finalized sheet changed since its commit -> ready to commit;
 * else anything committed -> committed; else -> map sheets.
 */
export function hubSubtitle({ statuses, changed, committedCount }: HubStageInput): string {
  if (statuses.some((s) => s.status === "Parsed")) return SUBTITLE_REVIEW;
  if (statuses.some((s) => s.status === "Finalized" && changed.has(s.sheet_name))) return SUBTITLE_READY;
  if (committedCount > 0) return SUBTITLE_COMMITTED;
  return SUBTITLE_MAP;
}

// ── The footer (U4) ──────────────────────────────────────────────────────────

/** Sheets that are set up: Config Done, Parsed or Finalized (display only; the parse gate keeps
 *  counting Config Done). */
export function setUpCount(statuses: readonly string[]): number {
  return statuses.filter((s) => s === "Config Done" || s === "Parsed" || s === "Finalized").length;
}

/** "{a} of {n} data sheet(s) set up". */
export function footerSetUp(setUp: number, total: number): string {
  return `${setUp} of ${total} data ${total === 1 ? "sheet" : "sheets"} set up`;
}

// ── The card's commit line and the commit dialog (U10) ───────────────────────

/** The card's commit line for a sheet re-parsed after commit v{n} (replaces "Ready for tendering"). */
export function reparsedAfterCommitLine(version: number): string {
  return `Re-parsed after v${version} — tendering still uses v${version}. Finalize and commit to update it.`;
}

export const COMMIT_DIALOG_DESCRIPTION =
  "Sheets never committed, or re-parsed since their last commit, are selected. Tick any other sheet to commit it again.";

/** The commit dialog's sub-label for a committed sheet re-parsed since, e.g. "re-parsed after v1". */
export function reparsedAfterLabel(version: number): string {
  return `re-parsed after v${version}`;
}

/** The dialog's pre-selection: the eligible sheets that changed since their last commit. */
export function preselectedSheets(
  eligible: readonly { sheet_name: string }[],
  changed: ReadonlySet<string>,
): Set<string> {
  return new Set(eligible.map((s) => s.sheet_name).filter((n) => changed.has(n)));
}
