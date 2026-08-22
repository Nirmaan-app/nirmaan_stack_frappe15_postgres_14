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
 * What the Jinja prints when the caller sends no `statuses`. Mirrored here so the
 * button can say so, and so a status filter that happens to equal this default
 * still round-trips unchanged. Keep in step with the Jinja's own default.
 */
export const DEFAULT_PRINTED_STATUSES = ["Pending", "WIP", "Completed"] as const;
