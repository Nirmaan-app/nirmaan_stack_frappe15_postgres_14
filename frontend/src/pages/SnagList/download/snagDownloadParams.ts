// frontend/src/pages/SnagList/download/snagDownloadParams.ts
//
// PURE: the table's live state -> the print format's query string. No React, no
// fetch — so the mapping is readable and testable on its own.

import { ColumnFiltersState } from "@tanstack/react-table";

import {
  DOWNLOAD_ALL_ENDPOINT,
  DOWNLOAD_PDF_ENDPOINT,
  SNAG_PRINT_DOCTYPE,
  SNAG_PRINT_FORMAT_NAME,
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
 * Build the download URL for the current view.
 *
 * A facet the user has NOT touched is left out of the URL entirely, which is what
 * makes the default PDF (everything except `Not Applicable`) the short-URL case.
 */
export function buildSnagDownloadUrl({
  projectId,
  columnFilters,
  searchTerm,
  selectedSearchField,
  batch,
}: SnagDownloadState): string {
  const params = new URLSearchParams({
    doctype: SNAG_PRINT_DOCTYPE,
    name: projectId,
    format: SNAG_PRINT_FORMAT_NAME,
    no_letterhead: "1",
    _lang: "en",
  });

  for (const filter of columnFilters) {
    const param = FILTER_PARAM_BY_COLUMN[filter.id];
    if (!param) continue;
    // Facet filters carry a string[]; a filter with nothing selected is not a filter.
    const values = Array.isArray(filter.value) ? filter.value.map(String) : [];
    if (values.length === 0) continue;
    params.append(param, JSON.stringify(values));
  }

  // The batch TAB, if the caller passed one it can express. Appended after the loop
  // above rather than inside it because a tab is NOT a column filter — it never
  // appears in `columnFilters` (see `config/snagBatchTabs.ts` on why that separation
  // is load-bearing), so nothing in that loop could ever see it.
  if (batch) {
    params.append(SNAG_PRINT_PARAM.batches, JSON.stringify([batch]));
  }

  appendSearch(params, searchTerm, selectedSearchField);

  return `${DOWNLOAD_PDF_ENDPOINT}?${params.toString()}`;
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

/**
 * "Download All" — every batch's report in one file.
 *
 * Carries the SAME facet and search params as the single download, so each batch's
 * section is narrowed exactly like the screen. The one axis it does NOT send is
 * `batches`: doing every batch is the whole point, so the server owns that param and
 * the selected tab is deliberately overridden.
 */
export function buildSnagDownloadAllUrl({
  projectId,
  columnFilters,
  searchTerm,
  selectedSearchField,
}: SnagDownloadState): string {
  const params = new URLSearchParams({ project: projectId });

  for (const filter of columnFilters) {
    const param = FILTER_PARAM_BY_COLUMN[filter.id];
    // `batches` is the server's to set, one per rendered section.
    if (!param || param === SNAG_PRINT_PARAM.batches) continue;
    const values = Array.isArray(filter.value) ? filter.value.map(String) : [];
    if (values.length === 0) continue;
    params.append(param, JSON.stringify(values));
  }

  appendSearch(params, searchTerm, selectedSearchField);

  return `${DOWNLOAD_ALL_ENDPOINT}?${params.toString()}`;
}

/** Strip anything a filesystem would rather not see. */
const sanitize = (value: string): string =>
  (value || "").replace(/[^a-zA-Z0-9-_]/g, "_");

/** e.g. `Snag_List_PAYTM_BANGALORE_21-08-2026.pdf`. */
export function buildSnagPdfFilename(projectLabel: string, now: Date): string {
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `Snag_List_${sanitize(projectLabel)}_${dd}-${mm}-${now.getFullYear()}.pdf`;
}
