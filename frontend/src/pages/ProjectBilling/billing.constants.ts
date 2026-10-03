// Client billing tracker — constants shared by the project Billing tab and the
// Billing Tracker page.
//
// The status groups mirror `nirmaan_stack/services/project_billing/rules.py`, which
// owns them and computes every server-side total. They are repeated here only
// to colour badges and count rows already on screen; `src/utils/projectBillingStatusParity.test.ts`
// pins this copy against the doctype's own status list.

export const BILL_TYPES = ["Supply 1", "Supply 2", "Supply 3", "RA 1", "RA 2", "RA 3", "Final", "NA"] as const;

export const BILL_STATUSES = [
  "Not Started",
  "Prepared",
  "Submission Pending",
  "Internally Approved",
  "Revision Pending",
  "Submitted",
  "Client Hold",
  "Certification Pending",
  "Client Approved",
  "Invoice Sent",
  "Payment Received",
  "Partial Payment Received",
  "NA",
] as const;

export type BillStatus = (typeof BILL_STATUSES)[number];

export const APPROVED_STATUSES: readonly string[] = [
  "Client Approved",
  "Invoice Sent",
  "Payment Received",
  "Partial Payment Received",
];

export const PENDING_STATUSES: readonly string[] = [
  "Not Started",
  "Prepared",
  "Submission Pending",
  "Internally Approved",
  "Revision Pending",
  "Submitted",
  "Client Hold",
  "Certification Pending",
];

export const NA_STATUS = "NA";

export const BILLING_API = {
  projectBilling: "nirmaan_stack.api.project_billing.project_view.get_project_billing",
  setup: "nirmaan_stack.api.project_billing.setup.setup_project_billing",
  saveBill: "nirmaan_stack.api.project_billing.bills.save_bill",
  deleteBill: "nirmaan_stack.api.project_billing.bills.delete_bill",
  addDc: "nirmaan_stack.api.project_billing.supply_dc.add_dc_entry",
  projects: "nirmaan_stack.api.project_billing.tracker.get_billing_projects",
  managerSummary: "nirmaan_stack.api.project_billing.tracker.get_manager_summary",
  myBills: "nirmaan_stack.api.project_billing.tracker.get_my_bills",
} as const;

export const billingKeys = {
  project: (project: string) => `project-billing:${project}`,
  projects: () => "project-billing:projects",
  managerSummary: (deadline?: string) => `project-billing:manager-summary:${deadline || "all"}`,
  myBills: () => "project-billing:my-bills",
};

/** Page route of the cross-project tracker. */
export const BILLING_TRACKER_ROUTE = "/billing-tracker";
