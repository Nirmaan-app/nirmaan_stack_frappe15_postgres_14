import { PAYMENT_TDS_ACCESS } from "@/constants/roles";

import type { PaymentTDSReportType } from "../store/useReportStore";

/**
 * Reports > "Payment" tab: which of its reports a role may open, in menu order. The tab shows when
 * this is non-empty, its dropdown lists exactly these, and its default is the first.
 *
 * "TDS Deduction" needs `Payment TDS Deduction` read (`PAYMENT_TDS_ACCESS`). The Cheque Payment report left
 * this tab for its own page, the Cheque Tracker (#1483).
 */
export const paymentTabReports = (role: string | null | undefined): PaymentTDSReportType[] => {
    const r = role || "";
    const reports: PaymentTDSReportType[] = [];
    if (PAYMENT_TDS_ACCESS.includes(r)) reports.push("TDS Deduction");
    return reports;
};
