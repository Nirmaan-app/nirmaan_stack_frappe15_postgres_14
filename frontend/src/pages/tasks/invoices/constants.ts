export const INVOICE_TASK_TABS = {
  PENDING: 'pending',
  HISTORY: 'history',
    PO_INVOICES: 'po_invoices',
  SR_INVOICES: 'sr_invoices',
} as const; // Use "as const" for stricter typing

// // NEW: Constants for the second group of tabs
// export const INVOICE_TYPE_TABS = {
//   PO_INVOICES: 'po_invoices',
//   SR_INVOICES: 'sr_invoices',
// } as const;

export const INVOICE_TASK_TYPE = "po_invoice_approval";

export const API_UPDATE_INVOICE_TASK_STATUS = "nirmaan_stack.api.tasks.update_task_status.update_invoice_task_status";

export const API_UPDATE_INVOICE_RECONCILIATION = "nirmaan_stack.api.invoices.update_invoice_reconciliation.update_invoice_reconciliation";