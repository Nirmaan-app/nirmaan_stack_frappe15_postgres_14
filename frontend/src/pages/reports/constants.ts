export const REPORTS_TABS = {
  PROJECTS: 'projects',
  VENDORS: 'vendors',
  CUSTOMERS: 'customers',
  PO: 'po',
  SR: 'sr',
  DCS_MIRS: 'dcs_mirs',
} as const; // Use "as const" for stricter typing

// export const INVOICE_TASK_TYPE = "po_invoice_approval";

// export const API_UPDATE_INVOICE_TASK_STATUS = "nirmaan_stack.api.tasks.update_task_status.update_invoice_task_status";

/**
 * Reports > Projects tab: the report types the PMO Executive profile may pick.
 *
 * PMO is a privileged role on this hub and used to get the whole Projects list;
 * an owner ruling narrows it to the three that carry no financial figures. The
 * six omitted ones -- Cash Sheet, Inflow Report, both Outflow reports, Project
 * Invoices and Project GST -- are all amount-bearing.
 *
 * Read by BOTH the option list (`ReportsContainer.currentReportOptions`) and the
 * per-tab default (`useReportStore.getDefaultReportTypeForTabAndRole`). Keep the
 * two reading this ONE list: a default that is not in the list leaves a PMO user
 * on a report their own dropdown cannot offer.
 *
 * Order here is irrelevant -- both call sites filter `projectReportOptions`, so
 * the dropdown keeps that array's order.
 */
export const PMO_PROJECT_REPORTS: readonly string[] = [
  'Project Progress Report',
  'Inventory Report',
  'Monthly WIP',
];
