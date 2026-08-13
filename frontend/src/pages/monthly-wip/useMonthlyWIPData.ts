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
  // G4 / G5 (LIFETIME, month-independent).
  //
  // MIND THE UNITS: `dispatched_po` / `total_dn` / `total_dc` count DOCUMENTS, while
  // `missing_dn` / `missing_dc` count PURCHASE ORDERS. The columns therefore do NOT
  // subtract into one another on screen, by design — that is the whole point of the
  // change. They previously WERE subtractions (max(0, dispatched_po − total_dn) and
  // max(0, total_dn − nonBillableDN − total_dc)), which is unsound because one PO
  // carries any number of DNs: the raw value went negative on 56 (DN) and 12 (DC) of
  // 93 live projects, and the clamp rendered that incoherence as a trustworthy zero.
  // Both are now PO counts from api/reports/metrics.py, using the same predicates as
  // the Action Centre — so a project's "Missing DC" here equals its "DC Pending" tile.
  // ALL FIVE are restricted to BILLABLE POs. A Non-Billable PO can never acquire a
  // Delivery Challan (the upload path rejects it), so it can never be compliant and
  // never enters the missing_* figures — including it in the totals beside them made
  // the two halves of a row describe different universes.
  dispatched_po: number;  // POs in Partially Dispatched / Dispatched / Partially Delivered /
                          // Delivered — ALL POs, Billable or not
  dispatched_po_billable: number; // the Billable slice, shown only as a hover split
  total_dn: number;       // Delivery Note DOCUMENTS, returns excluded — ALL POs, Billable
                          // or not (owner ruling; deliberately unlike the rest of the block)
  total_dn_billable: number; // the Billable slice, shown only as a hover split
  // Billable POs with a dispatched item not yet fully received — the SAME rule as the
  // project Overview tile's "DN Pending" tile, so the two surfaces always agree. NB it
  // reads ORDERED vs RECEIVED on the PO items and never looks at Delivery Note
  // documents; a PO whose status is already "Delivered" is excluded by the predicate.
  missing_dn: number;
  total_dc: number;       // Delivery Challan DOCUMENTS on a Billable PO (stubs included)
  missing_dc: number;     // POs: Billable, delivered, with no non-stub Delivery Challan
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
