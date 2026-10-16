/**
 * Which WOs the Reports → WO "Pending Invoices" and "PO with Excess Payments" reports list.
 *
 * Every Approved WO is a candidate and the report's own condition on the stored Amount Paid (Paid
 * payments less Received refunds, ADR-0034) decides. There is no separate "has been paid" filter: one
 * dropped a WO whose Amount Paid a refund took to zero before its condition was asked (#1461). A WO
 * refunded to zero meets neither condition by itself; one refunded but still overpaid is listed.
 */

/** The two WO reports with an Amount Paid condition. */
export type SRAmountReport = "Pending Invoices" | "PO with Excess Payments";

/** How far over (₹) a WO must be before a report lists it. */
export const SR_REPORT_DELTA = 100;

export interface SRReportFigures {
  status: string | undefined;
  totalAmount: number;
  invoiceAmount: number;
  amountPaid: number;
}

export const srReportIncludes = (report: SRAmountReport, wo: SRReportFigures): boolean => {
  if (wo.status !== "Approved") return false;
  if (report === "Pending Invoices") return wo.amountPaid - wo.invoiceAmount > SR_REPORT_DELTA;
  return wo.amountPaid > wo.totalAmount + SR_REPORT_DELTA;
};
