import { CHEQUE_ACCESS_PROFILES, PAYMENT_TDS_ACCESS } from "@/constants/roles";

import type { PaymentTDSReportType } from "../store/useReportStore";

/**
 * Reports > "Payment" tab: which of its reports a role may open, in menu order. The tab shows when
 * this is non-empty, its dropdown lists exactly these, and its default is the first.
 *
 * Two gates, because the two reports read different records: "TDS Deduction" needs
 * `Payment TDS Deduction` read (`PAYMENT_TDS_ACCESS`); "Cheque Payment" reads Cheques through
 * `api/cheques/`, which allow `CHEQUE_ACCESS_PROFILES` (spec #1407: Procurement in, Project Managers out).
 */
export const paymentTabReports = (role: string | null | undefined): PaymentTDSReportType[] => {
    const r = role || "";
    const reports: PaymentTDSReportType[] = [];
    if (PAYMENT_TDS_ACCESS.includes(r)) reports.push("TDS Deduction");
    if (CHEQUE_ACCESS_PROFILES.includes(r)) reports.push("Cheque Payment");
    return reports;
};
