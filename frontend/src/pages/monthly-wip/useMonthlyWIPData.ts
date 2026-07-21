import { useFrappeGetCall } from "frappe-react-sdk";

const API = "nirmaan_stack.api.reports.wip_monthly_report";

/** One active stint (WIP or Handover) within the selected month. */
export interface WipPeriod {
  status: string;         // "WIP" | "Handover"
  start: string;          // ISO date the project entered this status
  end: string;            // ISO date it left this status, or "ongoing"
  days: number;           // days of this stint that fall in the month
  dpr: number;
  inventory: number;
  dc: number;
  dn: number;
}

/** One project's month-total row (active = WIP + Handover combined). */
export interface WipMonthlyRow {
  project: string;
  project_name: string;
  days_active: number;    // WIP + Handover days in the month
  active_start: string;   // earliest active entry (ISO)
  active_end: string;     // latest active exit (ISO) or "ongoing"
  stints: number;         // number of real active periods (expander shown when > 1)
  dpr: number;
  inventory: number;
  dc: number;
  dn: number;
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
