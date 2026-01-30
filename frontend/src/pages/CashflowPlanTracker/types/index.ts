/**
 * Cashflow counts for a specific type (done vs pending)
 */
export interface CashflowCounts {
  done: number;
  total: number;
}

/**
 * Project with cashflow plan statistics from the API
 */
export interface ProjectWithCashflowPlanStats {
  /** Project document name (e.g., "PROJ-0001") */
  project: string;
  /** Human-readable project name */
  project_name: string;
  /** PO Cashflow stats */
  po_cashflow: CashflowCounts;
  /** WO Cashflow stats */
  wo_cashflow: CashflowCounts;
  /** Inflow Cashflow stats */
  inflow_cashflow: CashflowCounts;
  /** Misc Cashflow stats */
  misc_cashflow: CashflowCounts;
  /** Overall progress percentage (0-100) */
  overall_progress: number;
}
