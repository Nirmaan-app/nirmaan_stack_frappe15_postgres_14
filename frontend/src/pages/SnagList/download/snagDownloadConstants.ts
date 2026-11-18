// frontend/src/pages/SnagList/download/snagDownloadConstants.ts
//
// The contract between this folder and the "Project Snag" Jinja print format
// (reference copy: `../snag-printformat.html`). Every param name the PDF reads is
// declared HERE and nowhere else — a rename is a one-line change on this side
// plus the matching Jinja edit.

/**
 * The PDF is printed off the PROJECT, not off a Snag: a Snag is a standalone
 * document (ADR-0017), so there is no parent doc holding the list. The Jinja
 * fetches the project's snags itself and the params below narrow that fetch.
 */
export const SNAG_PRINT_FORMAT_NAME = "Project Snag";

/**
 * Both downloads are BUILT IN A BACKGROUND OPERATION — a big project's PDF outlasted the web
 * request (ADR 0047). This starts one (`api/snags/bulk_download.start_snag_pdf`); the shared
 * `useBackgroundOperation` hook follows it and collects its file by operation id.
 *
 * Our endpoint, not Frappe's `download_pdf`: that one type-checks its `pdf_generator`
 * argument ("wkhtmltopdf" | "chrome" only), so it cannot carry the generator that keeps the
 * photo ↔ row jump links (FrappeTypeError, 2026-10-08). Ours sets it on the server.
 */
export const SNAG_PDF_START = "nirmaan_stack.api.snags.bulk_download.start_snag_pdf";

/**
 * Which document `start_snag_pdf` builds. `tab` = the single Download (one render of the tab as
 * it stands); `all` = Download All — one report PER BATCH, merged server-side into a
 * single PDF behind a master summary. Different in kind, so the server owns `batches`
 * for `all`.
 */
export const SNAG_PDF_KIND = { tab: "tab", all: "all" } as const;

/**
 * Query params the print format reads off `frappe.form_dict`.
 *
 * The four filter params carry JSON arrays (the Jinja does `json.loads`) and are
 * OMITTED when that axis is unfiltered — absent means "all" on the Jinja side.
 * `search` / `searchField` mirror the tab's search box so the PDF contains
 * exactly the rows the screen is showing.
 */
export const SNAG_PRINT_PARAM = {
  statuses: "statuses",
  areas: "areas",
  categories: "categories",
  batches: "batches",
  search: "search",
  searchField: "search_field",
  mode: "mode",
} as const;

/**
 * What the Jinja prints when the caller sends no `statuses` — ALL FOUR since
 * 2026-09-09. `Not Applicable` used to be excluded, which meant those rows were never
 * fetched and their count could never appear on the summary. Mirrored here so the
 * button can say so, and so a status filter that happens to equal this default
 * still round-trips unchanged. Keep in step with the Jinja's own default.
 */
export const DEFAULT_PRINTED_STATUSES = [
  "Pending",
  "WIP",
  "Completed",
  "Not Applicable",
] as const;

/** The one status the Download All dialog's checkbox can drop. */
export const NOT_APPLICABLE_STATUS = "Not Applicable";
