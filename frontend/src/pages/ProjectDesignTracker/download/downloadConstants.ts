// frontend/src/pages/ProjectDesignTracker/download/downloadConstants.ts
//
// The contract between this folder and the "Project Design Tracker" Jinja print
// format. Every param name the PDF reads is declared HERE and nowhere else --
// a rename is a one-line change on this side plus the matching Jinja edit.
//
// See ./README.md for the full contract table.

/** Doctype + print format the download targets. Both happen to share a name. */
export const DOWNLOAD_DOCTYPE = "Project Design Tracker";
export const PRINT_FORMAT_NAME = "Project Design Tracker";

/** Frappe endpoint that renders a print format to a PDF and streams it back. */
export const DOWNLOAD_PDF_ENDPOINT =
    "/api/method/frappe.utils.print_format.download_pdf";

/**
 * Query params the print format reads off `frappe.form_dict`.
 *
 * The three filter params carry JSON arrays (the Jinja does `json.loads`), and a
 * param is OMITTED entirely when that axis is fully selected -- absent means
 * "all" on the Jinja side, which keeps the URL short in the common case.
 */
export const PRINT_PARAM = {
    phases: "phases",
    zones: "zones",
    categories: "categories",
} as const;

/** The two design phases, in render order. */
export const ALL_PHASES = ["Onboarding", "Handover"] as const;

/**
 * A task with no `task_phase` is an Onboarding task -- this mirrors the Jinja's
 * `{% set t_phase = t.task_phase or "Onboarding" %}`. Do not diverge.
 */
export const DEFAULT_PHASE = "Onboarding";

/**
 * A task may carry an empty `design_category`. The PDF prints it under
 * "Uncategorized"; we offer it in the picker under the same label, keyed by the
 * empty string so the value round-trips to the Jinja unchanged.
 */
export const UNCATEGORIZED_VALUE = "";
export const UNCATEGORIZED_LABEL = "Uncategorized";

/**
 * The print format never renders these tasks, so neither the pickers nor the
 * "N tasks" preview may count them -- otherwise the preview promises rows the
 * PDF will not contain.
 */
export const EXCLUDED_TASK_STATUS = "Not Applicable";
