export const REPORTS_TABS = {
  PROJECTS: 'projects',
  VENDORS: 'vendors',
  CUSTOMERS: 'customers',
  PO: 'po',
  SR: 'sr',
  DCS_MIRS: 'dcs_mirs',
  // Tax Deducted at Source — NOT the Technical Data Sheet family (`/tds-repository`,
  // `/tds-approval`). Spelled `payment_tds` for the same reason the old route was spelled
  // `/payment-tds-deductions` in full: the two TDS families must never collide.
  PAYMENT_TDS: 'payment_tds',
  // Every project's documents as one merged PDF (the project / vendor Bulk Download, unscoped).
  BULK_DOWNLOAD: 'bulk_download',
} as const; // Use "as const" for stricter typing

// export const INVOICE_TASK_TYPE = "po_invoice_approval";

// export const API_UPDATE_INVOICE_TASK_STATUS = "nirmaan_stack.api.tasks.update_task_status.update_invoice_task_status";

/**
 * The Pending Invoices Upload tab (Invoice Reconciliation) only looks at the current
 * financial year; the Reports page deliberately still shows every year.
 *
 * ONE definition, read by both report bodies, so the PO and WO halves of that tab can
 * never disagree about where the year starts. Compared against Frappe's `creation`
 * string ("YYYY-MM-DD HH:MM:SS"), which sorts correctly against this prefix.
 */
export const PENDING_UPLOAD_CREATION_FROM = "2026-04-01";

/**
 * The Pending Invoices Upload tab lists a PO in ANY status except these (owner ruling).
 * The Reports page's Pending Invoices report keeps its Partially Delivered / Delivered
 * rule and is unaffected. Read by the tab's fetch AND its row filter, so the two cannot
 * disagree about which statuses are in scope.
 */
export const PENDING_UPLOAD_EXCLUDED_PO_STATUSES: readonly string[] = [
  "Merged",
  "Cancelled",
  "Inactive",
];
