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
 * labels say "Recon" so the split is legible from the tab strip alone.
 */
export const INVOICE_TYPE_TAB_OPTIONS = [
  { label: "WO Invoices Recon", value: INVOICE_TASK_TABS.SR_INVOICES },
  { label: "PO Invoice Recon", value: INVOICE_TASK_TABS.PO_INVOICES },
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
