/**
 * Snag List — the batch tab strip's PURE rules.
 *
 * One tab per imported worksheet, because that is what a Batch IS (one batch per
 * SHEET, not per file — a 3-sheet workbook makes 3 tabs in one import). Selecting
 * one narrows the table to that import; the next import appends a new tab.
 *
 * ⚠️ THIS IS NOT THE BATCH FUNNEL COMING BACK. Revision 3 (owner Q6) removed the
 * Batch *column filter*, its hidden host column, its id in
 * `SNAG_FILTERABLE_COLUMN_IDS` and its entry in the persisted-state sanitizer. None
 * of that is reinstated here and none of it may be: a tab is an ADDITIONAL FILTER on
 * the query (the same channel `project` rides), never a `columnFilters` entry. That
 * distinction is what keeps a bookmarked URL from resurrecting a funnel that no
 * longer renders — the exact defect the sanitizer was written for.
 *
 * Pure — no React, no fetch — so every rule below is unit-testable (ADR-0010 F4).
 */

import { ProjectSnagBatch, SNAG_STATUSES, SnagBatchStats, SnagStatsSummary } from "../types";

/** The tab showing every snag in the project. The default. */
export const ALL_BATCHES = "__all__";

/** The tab showing snags added by hand — the ones with no batch at all. */
export const MANUAL_BATCH = "__manual__";

/**
 * The `by_batch` key the backend counts manually added snags under.
 *
 * Must stay in step with `MANUAL_BATCH_KEY` in `api/snags/tracking.py`. It is the
 * EMPTY STRING and not `MANUAL_BATCH`: the server knows nothing about this file's
 * sentinels, and folding NULL / "" together is its job, not ours.
 */
export const MANUAL_BATCH_KEY = "";

/**
 * Which tab is selected: `ALL_BATCHES`, `MANUAL_BATCH`, or a `Project Snag Batch`
 * document name. A plain string so it can be persisted or put in a URL later
 * without a codec.
 */
export type SnagBatchTabValue = string;

export interface SnagBatchTab {
  value: SnagBatchTabValue;
  /** What the tab reads. Truncated in the strip, so keep `title` full. */
  label: string;
  /** The untruncated label, for the `title` attribute. */
  title: string;
  count: number;
  /**
   * True for a real batch tab, which may be renamed (its label is `batch_name`). False for
   * "All" and "Added manually" — they are views, not batches, and have no name to change.
   */
  renamable: boolean;
}

const emptySlice = (): SnagBatchStats => ({
  total: 0,
  by_status: SNAG_STATUSES.reduce(
    (acc, status) => ({ ...acc, [status]: 0 }),
    {} as SnagBatchStats["by_status"]
  ),
});

/**
 * The tab strip for one project.
 *
 * ORDER IS OLDEST FIRST, and it is deliberate: `useSnagBatches` returns newest
 * first (its own list is right — a history panel reads newest-down), but a tab STRIP
 * is positional. Chronological order means an existing tab never moves when a new
 * import lands; it appends on the right, where the eye already expects the newest
 * sheet. Newest-first would shuffle every tab under the user's cursor on each import.
 *
 * The MANUAL tab renders only when the project actually has hand-added snags. It
 * exists because such a snag has no batch, so without it the row would be reachable
 * from "All" alone — present in the total, absent from every tab, which reads as
 * lost. A project that has never used *Add snag* never sees the tab.
 */
export function buildSnagBatchTabs(
  batches: ProjectSnagBatch[],
  byBatch: Record<string, SnagBatchStats>,
  projectTotal: number
): SnagBatchTab[] {
  const tabs: SnagBatchTab[] = [
    {
      value: ALL_BATCHES,
      label: "All",
      title: "Every snag in this project",
      count: projectTotal,
      renamable: false,
    },
  ];

  // A copy — `useSnagBatches`'s array is SWR-owned and must not be reversed in place.
  for (const batch of [...batches].reverse()) {
    const label = batch.batch_name || batch.name;
    tabs.push({
      value: batch.name,
      label,
      title: sheetSummary(batch.source_sheet)
        ? `${label} — ${sheetSummary(batch.source_sheet)}`
        : label,
      count: byBatch[batch.name]?.total ?? 0,
      renamable: true,
    });
  }

  const manualCount = byBatch[MANUAL_BATCH_KEY]?.total ?? 0;
  if (manualCount > 0) {
    tabs.push({
      value: MANUAL_BATCH,
      label: "Added manually",
      title: "Snags added by hand, not imported from a workbook",
      count: manualCount,
      renamable: false,
    });
  }

  return tabs;
}

/**
 * How a batch's sheets read on screen: "Sheet: X", or "Sheets: X, Y" once a batch spans
 * more than one.
 *
 * A batch is the FILE now (owner decision 2026-09-09), so `source_sheet` holds EVERY
 * sheet it drew from, comma-joined by `import_wizard._joined_sheet_names`. One helper so
 * the Import History popover and the tab tooltip can never disagree about the wording.
 * `null` when the batch names no sheet at all — callers render nothing.
 */
export function sheetSummary(sourceSheet?: string | null): string | null {
  const raw = (sourceSheet || "").trim();
  if (!raw) return null;
  return raw.includes(",") ? `Sheets: ${raw}` : `Sheet: ${raw}`;
}

/**
 * The extra query filter a tab implies, or `null` for "All" (no narrowing).
 *
 * `["batch", "is", "not set"]` is the manual case — it matches NULL and "" together,
 * the same reason `_distinct_field_values` uses the `is set` form on the server.
 */
export function snagBatchFilter(value: SnagBatchTabValue): [string, string, string] | null {
  if (value === ALL_BATCHES) return null;
  if (value === MANUAL_BATCH) return ["batch", "is", "not set"];
  return ["batch", "=", value];
}

/**
 * The tally the stats strip shows for the selected tab.
 *
 * The strip must agree with the table beneath it: leaving it project-wide while the
 * table shows one batch would print "124 Pending" over 37 rows.
 */
export function statsForTab(
  stats: SnagStatsSummary,
  value: SnagBatchTabValue
): SnagBatchStats {
  if (value === ALL_BATCHES) {
    return { total: stats.total, by_status: stats.by_status };
  }
  const key = value === MANUAL_BATCH ? MANUAL_BATCH_KEY : value;
  return stats.by_batch?.[key] ?? emptySlice();
}

/**
 * The batch name to send to the PRINT FORMAT, or `undefined` when the current tab
 * cannot be expressed as one.
 *
 * "All" is `undefined` because absent means "every batch" on the Jinja side — that
 * is the short-URL default, not a missing filter. **The MANUAL tab is `undefined`
 * too, and that is a REAL GAP, not an oversight**: the format's `batches` param
 * becomes `["batch", "in", [...]]`, which cannot express "has no batch". The caller
 * must therefore not simply download on that tab — it would print every batch while
 * the screen shows none of them, and this feature's whole download contract is that
 * the PDF cannot disagree with the table. Closing it needs one more Jinja filter.
 */
export function printableBatch(value: SnagBatchTabValue): string | undefined {
  if (value === ALL_BATCHES || value === MANUAL_BATCH) return undefined;
  return value;
}

/** True when the PDF cannot be scoped to what the screen is showing. */
export const isUnprintableTab = (value: SnagBatchTabValue): boolean =>
  value === MANUAL_BATCH;
