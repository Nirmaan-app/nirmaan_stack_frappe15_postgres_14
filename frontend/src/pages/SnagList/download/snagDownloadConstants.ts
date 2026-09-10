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
export const SNAG_PRINT_DOCTYPE = "Projects";
export const SNAG_PRINT_FORMAT_NAME = "Project Snag";

/** Frappe endpoint that renders a print format to a PDF and streams it back. */
export const DOWNLOAD_PDF_ENDPOINT =
  "/api/method/frappe.utils.print_format.download_pdf";

/**
 * "Download All" — one report PER BATCH, merged server-side into a single PDF.
 *
 * A separate endpoint rather than a flag on the one above, because the work is
 * different in kind: that one renders ONE print format, this one renders N and merges
 * them with `pypdf`. It takes the same filter params (minus `batches`, which it owns).
 */
export const DOWNLOAD_ALL_ENDPOINT =
  "/api/method/nirmaan_stack.api.snags.bulk_download.download_all_batches";

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
