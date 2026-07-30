import { useFrappeGetCall } from "frappe-react-sdk";

const API = "nirmaan_stack.api.reports.wip_monthly_report";

/** DPR (daily) + Inventory (weekly) compliance figures for a row or a stint. */
export interface WipCompliance {
  active_working_days: number; // active calendar days minus Sundays — the "Active Days" shown
  total_dpr_days: number;      // working days that have a DPR
  missing_dpr_days: number;    // working days without a DPR (total + missing == working days)
  expected_inventory: number;  // active Mondays (one inventory expected each)
  // COUNT of inventory report DOCUMENTS — not "Mondays covered". Any weekday counts, and
  // it is UNBOUNDED, so it can legitimately exceed `expected_inventory` (over-delivery).
  // On a project row it counts every report dated in the month, active window or not;
  // on a stint it counts only reports dated inside that stint's window.
  actual_inventory: number;
  missing_inventory: number;   // max(0, expected − actual) — clamped, so never negative
}

/** One active stint (WIP or Handover) within the selected month. */
export interface WipPeriod extends WipCompliance {
  status: string;         // "WIP" | "Handover"
  start: string;          // ISO date the project entered this status
  end: string;            // ISO date it left this status, or "ongoing"
  days: number;           // calendar days of this stint that fall in the month (incl. Sundays)
  // NB: G4 (PO dispatch) + G5 (DC) are LIFETIME/project-level — NOT present on stints.
}

/** One project's month-total row (active = WIP + Handover combined). */
export interface WipMonthlyRow extends WipCompliance {
  project: string;
  project_name: string;
  days_active: number;    // WIP + Handover calendar days in the month (incl. Sundays)
  active_start: string;   // earliest active entry (ISO)
  active_end: string;     // latest active exit (ISO) or "ongoing"
  stints: number;         // number of real active periods (expander shown when > 1)
  // G4 — PO dispatch vs delivery (LIFETIME, month-independent):
  dispatched_po: number;  // POs in Partially Dispatched / Dispatched / Partially Delivered / Delivered
  total_dn: number;       // Delivery Note docs (returns excluded)
  missing_dn: number;     // max(0, dispatched_po − total_dn)
  // G5 — DC compliance (LIFETIME, month-independent):
  total_dc: number;       // Delivery Challan docs (PO-parented)
  // max(0, total_dn − DNs whose PO is Non-Billable − total_dc). A Non-Billable PO can
  // never acquire a DC (the upload path rejects it), so those DNs are subtracted out.
  // That subtrahend is deliberately NOT surfaced (owner: keep it implicit), so
  // total_dn − total_dc will NOT equal missing_dc on screen.
  missing_dc: number;
  periods: WipPeriod[];
}

export interface WipMonthlyResponse {
  month: string;
  rows: WipMonthlyRow[];
}

export interface MonthOption {
  value: string;          // "YYYY-MM"
  label: string;          // "Jun 2026"
}

/** Dropdown choices (recent months, most-recent first). */
export function useWipMonthOptions() {
  const { data, isLoading } = useFrappeGetCall<{ message: MonthOption[] }>(
    `${API}.get_wip_month_options`,
    {},
    "wip_month_options"
  );
  return { options: data?.message ?? [], isLoading };
}

/** The monthly WIP activity rows for a given month ("YYYY-MM"). */
export function useMonthlyWIPData(month: string) {
  const { data, isLoading, error, mutate } = useFrappeGetCall<{ message: WipMonthlyResponse }>(
    `${API}.get_wip_monthly_report`,
    { month },
    month ? `wip_monthly_report_${month}` : null
  );
  return { report: data?.message, isLoading, error, mutate };
}
