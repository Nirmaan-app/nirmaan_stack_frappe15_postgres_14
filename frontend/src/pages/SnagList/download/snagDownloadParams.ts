// frontend/src/pages/SnagList/download/snagDownloadParams.ts
//
// PURE: the table's live state -> the print format's params. No React, no
// fetch — so the mapping is readable and testable on its own.

import { ColumnFiltersState } from "@tanstack/react-table";

import {
  DEFAULT_PRINTED_STATUSES,
  NOT_APPLICABLE_STATUS,
  SNAG_PDF_KIND,
  SNAG_PRINT_PARAM,
} from "./snagDownloadConstants";

/** The column ids the PDF can filter on. Anything else in `columnFilters` is ignored. */
const FILTER_PARAM_BY_COLUMN: Record<string, string> = {
  area: SNAG_PRINT_PARAM.areas,
  category: SNAG_PRINT_PARAM.categories,
  status: SNAG_PRINT_PARAM.statuses,
  batch: SNAG_PRINT_PARAM.batches,
};

/** The search fields the Jinja honours. A search on anything else is not sent. */
const PRINTABLE_SEARCH_FIELDS = ["description", "area", "category"];

export interface SnagDownloadState {
  projectId: string;
  /** Straight from `useServerDataTable` — facet values arrive as string arrays. */
  columnFilters: ColumnFiltersState;
  searchTerm?: string;
  selectedSearchField?: string;
  /**
   * The selected batch tab, when it is one the PDF can express — `undefined` on
   * "All" (absent means every batch on the Jinja side, which is the default) and on
   * the manual tab (see `printableBatch`, which is what decides this).
   *
   * It rides the SAME `batches` param the retired Batch funnel used, so no Jinja
   * change was needed: the format already filters `["batch", "in", [...]]`.
   */
  batch?: string;
}

/**
 * The single Download dialog's choices.
 *  - `mode`: `full` = the tab's normal report; `summary` = only that file's summary
 *    block (the print format's `mode=master` section, narrowed to the tab's batch).
 *  - `includeNotApplicable`: default ON.
 */
export interface SnagDownloadOptions {
  mode: SnagDownloadAllMode;
  includeNotApplicable: boolean;
}

export const DEFAULT_DOWNLOAD_OPTIONS: SnagDownloadOptions = {
  mode: "full",
  includeNotApplicable: true,
};

/**
 * Build the single Download's request params for the current view (`SNAG_PDF_KIND.tab`).
 *
 * A facet the user has NOT touched is left out entirely — absent means "all" on the
 * Jinja side, which is what makes the default PDF (all four statuses) the short case.
 *
 * `statuses` goes through `resolveDownloadAllStatuses` -- the SAME rule Download All
 * uses -- so the dialog's "Include Not Applicable" box can only NARROW the list's
 * Status filter. With the box ON (the default) the result is exactly the old
 * verbatim copy: the list filter as-is, or nothing when the list is unfiltered.
 */
export function buildSnagDownloadParams(
  { projectId, columnFilters, searchTerm, selectedSearchField, batch }: SnagDownloadState,
  { mode, includeNotApplicable }: SnagDownloadOptions = DEFAULT_DOWNLOAD_OPTIONS
): Record<string, string> {
  const params = new URLSearchParams({ kind: SNAG_PDF_KIND.tab, project: projectId });
  // Summary only = the print format's master section. With the tab's `batches` below
  // it renders that ONE file's block ("Snag List — Summary"), nothing else.
  if (mode === "summary") params.append(SNAG_PRINT_PARAM.mode, "master");

  for (const filter of columnFilters) {
    const param = FILTER_PARAM_BY_COLUMN[filter.id];
    // `statuses` is resolved below against the N/A checkbox.
    if (!param || param === SNAG_PRINT_PARAM.statuses) continue;
    // Facet filters carry a string[]; a filter with nothing selected is not a filter.
    const values = Array.isArray(filter.value) ? filter.value.map(String) : [];
    if (values.length === 0) continue;
    params.append(param, JSON.stringify(values));
  }

  const { statuses } = resolveDownloadAllStatuses(
    listStatusFilter(columnFilters),
    includeNotApplicable
  );
  if (statuses) params.append(SNAG_PRINT_PARAM.statuses, JSON.stringify(statuses));

  // The batch TAB, if the caller passed one it can express. Appended after the loop
  // above rather than inside it because a tab is NOT a column filter — it never
  // appears in `columnFilters` (see `config/snagBatchTabs.ts` on why that separation
  // is load-bearing), so nothing in that loop could ever see it.
  if (batch) {
    params.append(SNAG_PRINT_PARAM.batches, JSON.stringify([batch]));
  }

  appendSearch(params, searchTerm, selectedSearchField);

  // Every param is appended once, so nothing is lost flattening to an object.
  return Object.fromEntries(params);
}

/** Shared by both builders — the search box narrows the merged report identically. */
function appendSearch(
  params: URLSearchParams,
  searchTerm?: string,
  selectedSearchField?: string
): void {
  const search = (searchTerm || "").trim();
  const field = selectedSearchField || "description";
  if (search && PRINTABLE_SEARCH_FIELDS.includes(field)) {
    params.append(SNAG_PRINT_PARAM.search, search);
    params.append(SNAG_PRINT_PARAM.searchField, field);
  }
}

/** The values of ONE column filter, or `[]` when that column is unfiltered. */
function columnFilterValues(columnFilters: ColumnFiltersState, columnId: string): string[] {
  const filter = columnFilters.find((f) => f.id === columnId);
  return filter && Array.isArray(filter.value) ? filter.value.map(String) : [];
}

/** The list's Status filter as the user set it — `[]` when untouched. */
export function listStatusFilter(columnFilters: ColumnFiltersState): string[] {
  return columnFilterValues(columnFilters, "status");
}

// ---------------------------------------------------------------------------
// "Download All" — the dialog's two choices
// ---------------------------------------------------------------------------

/** `full` = master summary + every batch's section; `summary` = the master alone. */
export type SnagDownloadAllMode = "full" | "summary";

export interface SnagDownloadAllOptions {
  mode: SnagDownloadAllMode;
  /** The dialog's "Include Not Applicable" checkbox. Default ON. */
  includeNotApplicable: boolean;
}

export const DEFAULT_DOWNLOAD_ALL_OPTIONS: SnagDownloadAllOptions = {
  mode: "full",
  includeNotApplicable: true,
};

/**
 * What `statuses` the Download All request carries — the list's Status filter
 * combined with the dialog's "Include Not Applicable" checkbox.
 *
 *   list filter   N/A on                   N/A off
 *   -----------   ----------------------   ---------------------------------
 *   (none)        null  (send nothing)     Pending, WIP, Completed
 *   [..]          the list filter as-is    the list filter minus N/A
 *
 * `null` means "send no `statuses` param" — the server's default, which is all four
 * (`DEFAULT_PRINTED_STATUSES`), so the request stays short in the common case.
 *
 * ⚠️ The checkbox can only ever NARROW. It never ADDS a status the list filter hid:
 * with the list filtered to Pending, ticking N/A does not smuggle N/A rows back in —
 * the file must never contain rows the screen above the button is hiding.
 *
 * `empty` is true when the narrowing leaves NOTHING (the list was filtered to N/A
 * alone and the box is unticked). The dialog disables Download on it: sending `[]`
 * would read as "unfiltered" on the Jinja side and print everything.
 */
export function resolveDownloadAllStatuses(
  listStatuses: readonly string[],
  includeNotApplicable: boolean
): { statuses: string[] | null; empty: boolean } {
  if (listStatuses.length === 0) {
    return includeNotApplicable
      ? { statuses: null, empty: false }
      : {
          statuses: DEFAULT_PRINTED_STATUSES.filter((s) => s !== NOT_APPLICABLE_STATUS),
          empty: false,
        };
  }
  if (includeNotApplicable) return { statuses: [...listStatuses], empty: false };
  const narrowed = listStatuses.filter((s) => s !== NOT_APPLICABLE_STATUS);
  return { statuses: narrowed, empty: narrowed.length === 0 };
}

/**
 * "Download All" — a master summary, then (in `full` mode) every batch's report, in
 * one file.
 *
 * Carries the SAME area / category / search params as the single download, so each
 * section is narrowed exactly like the screen. `statuses` is NOT copied from the list
 * verbatim — it goes through `resolveDownloadAllStatuses`, because the dialog's N/A
 * checkbox narrows it. The one axis never sent is `batches`: doing every batch is the
 * whole point, so the server owns that param and the selected tab is overridden.
 */
export function buildSnagDownloadAllParams(
  { projectId, columnFilters, searchTerm, selectedSearchField }: SnagDownloadState,
  { mode, includeNotApplicable }: SnagDownloadAllOptions
): Record<string, string> {
  const params = new URLSearchParams({ kind: SNAG_PDF_KIND.all, project: projectId, mode });

  for (const filter of columnFilters) {
    const param = FILTER_PARAM_BY_COLUMN[filter.id];
    // `batches` is the server's to set, one per rendered section; `statuses` is
    // resolved below against the N/A checkbox.
    if (!param || param === SNAG_PRINT_PARAM.batches || param === SNAG_PRINT_PARAM.statuses) {
      continue;
    }
    const values = Array.isArray(filter.value) ? filter.value.map(String) : [];
    if (values.length === 0) continue;
    params.append(param, JSON.stringify(values));
  }

  const { statuses } = resolveDownloadAllStatuses(
    listStatusFilter(columnFilters),
    includeNotApplicable
  );
  if (statuses) params.append(SNAG_PRINT_PARAM.statuses, JSON.stringify(statuses));

  appendSearch(params, searchTerm, selectedSearchField);

  return Object.fromEntries(params);
}

/**
 * The list filters that will narrow the Download All file, as short human phrases
 * (`Status: Pending, WIP`, `Search (description): "leak"`) — the dialog's filter note.
 * `[]` when nothing narrows it.
 *
 * Mirrors exactly what `buildSnagDownloadAllParams` SENDS: a search on a field the print
 * format cannot honour is not listed, because it does not reach the file.
 */
export function describeDownloadAllFilters({
  columnFilters,
  searchTerm,
  selectedSearchField,
}: Pick<SnagDownloadState, "columnFilters" | "searchTerm" | "selectedSearchField">): string[] {
  const parts: string[] = [];
  const labelled: Array<[string, string]> = [
    ["status", "Status"],
    ["area", "Area"],
    ["category", "Category"],
  ];
  for (const [columnId, label] of labelled) {
    const values = columnFilterValues(columnFilters, columnId);
    if (values.length) parts.push(`${label}: ${values.join(", ")}`);
  }
  const search = (searchTerm || "").trim();
  const field = selectedSearchField || "description";
  if (search && PRINTABLE_SEARCH_FIELDS.includes(field)) {
    parts.push(`Search (${field}): "${search}"`);
  }
  return parts;
}

/**
 * True when the list carries an area / category / search narrowing — the axes the
 * page's stats call cannot count. The dialog omits its snag counts when this is set
 * rather than quote a project-wide number for a filtered file.
 */
export function hasUncountableNarrowing({
  columnFilters,
  searchTerm,
  selectedSearchField,
}: Pick<SnagDownloadState, "columnFilters" | "searchTerm" | "selectedSearchField">): boolean {
  if (columnFilterValues(columnFilters, "area").length) return true;
  if (columnFilterValues(columnFilters, "category").length) return true;
  const search = (searchTerm || "").trim();
  const field = selectedSearchField || "description";
  return !!search && PRINTABLE_SEARCH_FIELDS.includes(field);
}

/** Strip anything a filesystem would rather not see. */
const sanitize = (value: string): string =>
  (value || "").replace(/[^a-zA-Z0-9-_]/g, "_");

const ddmmyyyy = (now: Date): string => {
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${now.getFullYear()}`;
};

/** e.g. `Snag_List_PAYTM_BANGALORE_21-08-2026.pdf`. */
export function buildSnagPdfFilename(projectLabel: string, now: Date): string {
  return `Snag_List_${sanitize(projectLabel)}_${ddmmyyyy(now)}.pdf`;
}

/**
 * e.g. `Snag_Summary_PAYTM_BANGALORE_21-08-2026.pdf` — the Download All SUMMARY file.
 * Only a fallback: the server names the file (`bulk_download._summary_filename`,
 * which this mirrors) via Content-Disposition.
 */
export function buildSnagSummaryPdfFilename(projectLabel: string, now: Date): string {
  return `Snag_Summary_${sanitize(projectLabel)}_${ddmmyyyy(now)}.pdf`;
}
