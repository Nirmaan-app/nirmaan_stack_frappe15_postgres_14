export const INVOICE_TASK_TABS = {
  PENDING: 'pending',
  HISTORY: 'history',
  PO_INVOICES: 'po_invoices',
  SR_INVOICES: 'sr_invoices',
} as const;

/** Tab options for task-related tabs (role-based visibility) */
export const INVOICE_TASK_TAB_OPTIONS = [
  { label: "Pending Invoice Approvals", value: INVOICE_TASK_TABS.PENDING },
  { label: "Invoice Action History", value: INVOICE_TASK_TABS.HISTORY },
] as const;

/**
 * Tab options for invoice type tabs.
 *
 * These two tabs are the RECONCILIATION views (2B reconciliation status, proof,
 * reconciled-by/date), as distinct from the approval-flow tabs above — the
 * labels name 2B explicitly, so the tab strip alone tells a reviewer which
 * reconciliation is meant: GSTR-2B here, not the auto-approve checks that the
 * Pending Invoice Approvals tab reports.
 */
export const INVOICE_TYPE_TAB_OPTIONS = [
  { label: "WO Invoices 2B Recon", value: INVOICE_TASK_TABS.SR_INVOICES },
  { label: "PO Invoices 2B Recon", value: INVOICE_TASK_TABS.PO_INVOICES },
] as const;

/**
 * @deprecated Use VENDOR_INVOICES_DOCTYPE instead
 */
export const INVOICE_TASK_TYPE = "po_invoice_approval";

/**
 * Vendor Invoices doctype name
 */
export const VENDOR_INVOICES_DOCTYPE = "Vendor Invoices";

/**
 * API endpoint for approving/rejecting vendor invoices
 */
export const API_APPROVE_VENDOR_INVOICE = "nirmaan_stack.api.invoices.approve_vendor_invoice.approve_vendor_invoice";

/**
 * API endpoints for re-running the auto-approve gates on Pending invoices.
 *
 * The gates run once, at creation, so their verdict is a snapshot — a PO that
 * has since been delivered still carries `nothing_delivered_yet`. These re-run
 * them against current data. Both take `dry_run` and return the same shape, so
 * the preview and the apply are one code path.
 */
export const API_RECHECK_AUTO_APPROVE = "nirmaan_stack.api.invoices.recheck_auto_approve.recheck_auto_approve";
export const API_RECHECK_PENDING_QUEUE = "nirmaan_stack.api.invoices.recheck_auto_approve.recheck_pending_queue";

/**
 * @deprecated Use API_APPROVE_VENDOR_INVOICE instead
 */
export const API_UPDATE_INVOICE_TASK_STATUS = "nirmaan_stack.api.tasks.update_task_status.update_invoice_task_status";

/**
 * API endpoint for updating invoice reconciliation
 */
export const API_UPDATE_INVOICE_RECONCILIATION = "nirmaan_stack.api.invoices.update_invoice_reconciliation.update_invoice_reconciliation";

/**
 * Reconciliation status options for the four-state dropdown
 */
export const RECONCILIATION_STATUS_OPTIONS = [
  { label: "Not Reconciled", value: "" },
  { label: "Partially Reconciled", value: "partial" },
  { label: "Fully Reconciled", value: "full" },
  { label: "Not Applicable", value: "na" },
] as const;

/**
 * Type for reconciliation status values
 * "na" = Not Applicable (for invoices that don't require 2B reconciliation)
 */
export type ReconciliationStatus = "" | "partial" | "full" | "na";
