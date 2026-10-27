/**
 * A Work Order's Pending Invoices: money already paid to the vendor that no invoice covers yet.
 *
 * Amt. Paid less Total Invoiced, the same difference the Reports → WO "Pending Invoices" report
 * lists on (`srReportInclusion.ts`), floored at 0. An order invoiced beyond what was paid is owed
 * a payment, not an invoice, so it shows 0, never a negative figure.
 *
 * Worked out on screen from the two stored fields, so the list columns built on it cannot sort:
 * a server-paged table would only reorder the page it holds.
 */
import { parseNumber } from "@/utils/parseNumber";

export const pendingInvoiceAmount = (workOrder: {
  amount_paid?: string | number | null;
  amount_invoiced?: string | number | null;
}): number => Math.max(0, parseNumber(workOrder.amount_paid) - parseNumber(workOrder.amount_invoiced));
