// Response shapes of `nirmaan_stack.api.project_billing.*`.

export interface BillingTotals {
  bill_count: number;
  pending_count: number;
  billed: number;
  approved: number;
}

export interface NextBill {
  name: string;
  bill_type: string;
  status: string;
  eta_date: string | null;
}

/** One of a package's billing managers, in the order they were picked. */
export interface BillingManagerRef {
  user: string;
  full_name: string;
}

export interface BillingTracker extends BillingTotals {
  name: string;
  project?: string;
  project_name?: string;
  package: string;
  billing_managers: BillingManagerRef[];
  /**
   * The current user may add / edit this package's bills and log its Supply DC: Admin, or one of
   * its billing managers. Server-decided; the controller hooks enforce the same rule on save.
   */
  can_edit_bills: boolean;
  po_value: number;
  supply_dc: number;
  dc_updated_on: string | null;
  remarks?: string | null;
  next_bill?: NextBill | null;
}

export interface Bill {
  name: string;
  billing_tracker: string;
  project: string;
  project_name: string | null;
  package: string;
  bill_type: string;
  status: string;
  bill_value: number | null;
  payment_received: number | null;
  invoice_requested: 0 | 1;
  eta_date: string | null;
  first_submission_date: string | null;
  approval_date: string | null;
  bill_document_link: string | null;
  bill_attachment: string | null;
  billing_managers: BillingManagerRef[];
  tracker_supply_dc: number | null;
  tracker_po_value: number | null;
}

export interface ProjectBillingResponse {
  trackers: BillingTracker[];
  summary: BillingTotals & { supply_dc: number; po_value: number };
  can_write: boolean;
}

export interface BillingProjectRow extends BillingTotals {
  project: string;
  project_name: string;
  /** Projects.status: WIP, Handover, Completed, … */
  status: string | null;
  /** The distinct statuses of the project's bills (NA included); drives the billing-status filter. */
  bill_statuses: string[];
  managers: string[];
  packages: BillingTracker[];
  supply_dc: number;
  po_value: number;
}

export interface BillingProjectsResponse {
  projects: BillingProjectRow[];
  totals: BillingTotals & { project_count: number };
  can_write: boolean;
}

export interface SummaryCounts {
  [column: string]: number;
}

export interface ManagerSummaryResponse {
  /** `statuses`: the bill statuses each column counts (server-owned grouping). */
  columns: { key: string; label: string; statuses: string[] }[];
  managers: {
    manager: string | null;
    manager_name: string;
    counts: SummaryCounts;
    /** Bills per status (only statuses that have any), behind `counts`. */
    by_status: SummaryCounts;
    projects: { project: string; project_name: string; counts: SummaryCounts; by_status: SummaryCounts }[];
  }[];
}

export interface MyBillsResponse {
  user: string;
  user_name: string;
  bills: Bill[];
  counts: { total: number; pending: number; due_in_7_days: number; overdue: number };
  trackers: BillingTracker[];
  can_write: boolean;
}

/** What the bill drawer edits. */
export interface BillDraft {
  name?: string;
  billing_tracker: string;
  bill_type: string;
  status: string;
  bill_value: string;
  payment_received: string;
  invoice_requested: boolean;
  eta_date: string;
  approval_date: string;
  bill_document_link: string;
  bill_attachment: string;
}

/** A `Project Billing` row as the standard DataTable fetches it (doctype fields only). */
export interface BillDoc {
  name: string;
  billing_tracker: string;
  project: string;
  package: string;
  bill_type: string;
  status: string;
  bill_value: number | null;
  payment_received: number | null;
  invoice_requested: 0 | 1;
  eta_date: string | null;
  first_submission_date: string | null;
  approval_date: string | null;
  bill_document_link: string | null;
  bill_attachment: string | null;
}

/** One row of the Billing Packages tab (Admin Options → Packages Settings). */
export interface BillingPackageRow {
  name: string;
}
