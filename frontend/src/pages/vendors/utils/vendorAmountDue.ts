import { parseNumber } from "@/utils/parseNumber";

/** One PO of the vendor, as the Material Orders "Invoice Summary (all POs)" reads it. */
export interface VendorPoMoney {
  status?: string | null;
  amount_invoiced?: number | string | null;
  amount_paid?: number | string | null;
}

/**
 * The Material Orders "Invoice Summary (all POs)" (#1460, ADR-0034): Total Invoiced over every PO of the
 * vendor, less the POs' stored Amount Paid (Paid payments less Received refunds) -- never payments added up
 * again. A Merged PO's payments moved to its master PO, so its paid figure is left out, as in the
 * "Amount Paid" card beside it. The print format "Vendor Material Orders" mirrors this; keep the two in step.
 */
export const vendorInvoiceSummary = (pos: VendorPoMoney[]) => {
  let totalInvoiced = 0;
  let amountPaid = 0;
  for (const po of pos) {
    totalInvoiced += parseNumber(po.amount_invoiced as number);
    if (po.status !== "Merged") amountPaid += parseNumber(po.amount_paid as number);
  }
  return { totalInvoiced, amountPaid, amountDue: totalInvoiced - amountPaid };
};
