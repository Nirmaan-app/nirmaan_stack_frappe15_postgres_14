export const INVOICE_TASK_TABS = {
  PENDING: 'pending',
  HISTORY: 'history',
} as const; // Use "as const" for stricter typing

export const INVOICE_TASK_TYPE = "po_invoice_approval";

export const API_UPDATE_INVOICE_TASK_STATUS = "nirmaan_stack.api.tasks.update_task_status.update_invoice_task_status";