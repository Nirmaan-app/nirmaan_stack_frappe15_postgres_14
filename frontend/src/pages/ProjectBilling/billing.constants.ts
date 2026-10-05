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

/** The one status that stamps a bill's first submission date; mirrors `rules.SUBMITTED_STATUS`. */
export const SUBMITTED_STATUS = "Submitted";

/** A bill that has gone to the client at least once; mirrors `rules.SUBMITTED_OR_LATER`. */
export const SUBMITTED_OR_LATER: readonly string[] = [
  "Submitted",
  "Client Hold",
  "Certification Pending",
  ...APPROVED_STATUSES,
];

export const BILLING_API = {
  projectBilling: "nirmaan_stack.api.project_billing.project_view.get_project_billing",
  setup: "nirmaan_stack.api.project_billing.setup.setup_project_billing",
  saveBill: "nirmaan_stack.api.project_billing.bills.save_bill",
  addDc: "nirmaan_stack.api.project_billing.supply_dc.add_dc_entry",
  projects: "nirmaan_stack.api.project_billing.tracker.get_billing_projects",
  managerSummary: "nirmaan_stack.api.project_billing.tracker.get_manager_summary",
  myBills: "nirmaan_stack.api.project_billing.tracker.get_my_bills",
  renamePackage: "nirmaan_stack.api.project_billing.packages.rename_billing_package",
  packageRemovalSummary: "nirmaan_stack.api.project_billing.setup.get_package_removal_summary",
  removeProjectPackage: "nirmaan_stack.api.project_billing.setup.remove_project_package",
} as const;

export const billingKeys = {
  /** The package list (pickers and the Billing Packages tab); refreshed with every other billing read after a write. */
  packages: () => "project-billing:packages",
  project: (project: string) => `project-billing:${project}`,
  projects: () => "project-billing:projects",
  managerSummary: (deadline?: string) => `project-billing:manager-summary:${deadline || "all"}`,
  myBills: () => "project-billing:my-bills",
  /** What removing a package from its project would delete (Admin's warning). */
  removalSummary: (tracker: string) => `project-billing:removal:${tracker}`,
};

/** Page route of the cross-project tracker. */
export const BILLING_TRACKER_ROUTE = "/billing-tracker";
