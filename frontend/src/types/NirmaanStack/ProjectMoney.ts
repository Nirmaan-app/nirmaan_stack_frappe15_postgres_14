/**
 * One project's money, worked out on the server (`services/project_money`, ADR-0034, #1456): what
 * `api/projects/project_money.get_project_money` returns, and each value of `get_projects_money`.
 * CEO Hold and the Projects list read the same figures.
 *
 * `outflow` is cash (Paid payments less Received Vendor Refunds, plus Paid expenses) and is the sum of
 * its three parts. `cashflow_gap` = outflow + liabilities - inflow.
 */
export interface ProjectMoney {
  po_outflow: number;
  wo_outflow: number;
  expense_outflow: number;
  outflow: number;
  liabilities: number;
  inflow: number;
  cashflow_gap: number;
}
