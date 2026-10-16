// The Vendor report's paid figures (ADR-0034, #1461).
//
// An order's stored Amount Paid (Paid payments less Received refunds) is the one paid figure, but it
// carries no date. So the report reads it only for the all-time Total Paid; every dated figure comes
// from the server (`api/vendor/vendor_paid.get_vendors_paid`), which applies the same rule to the rows
// themselves, a refund on its own date. Nothing here adds up payments.
import { parseNumber } from "@/utils/parseNumber";
import { sumAmountPaid } from "@/utils/projects/projectPaid";

/** `{vendor: paid}` maps from `get_vendors_paid`; a vendor with nothing in the range is missing (0). */
export interface VendorPaidSources {
  /** For the chosen date range; null when no range is chosen. */
  periodPaid: Record<string, number> | null;
  currentFYPaid: Record<string, number>;
  /** Since the Vendor Ledger's start (LEDGER_START): the cash behind Balance Payable. */
  paidSinceLedgerStart: Record<string, number>;
}

export interface VendorPaidFigures {
  totalPaid: number;
  currentFYPaid: number;
  balance: number;
}

/**
 * One vendor's Total Paid, Current FY Paid and Balance Payable.
 *
 * Balance Payable is the vendor's Ledger tab closing balance: the opening balance as on 31 Mar 2025
 * (the Vendors balancing fields), plus invoices since the ledger start, less what was paid since then.
 */
export const vendorPaidFigures = (
  vendorId: string,
  orders: { amount_paid?: number | string | null }[],
  sources: VendorPaidSources,
  opening: { invoice: number; payment: number },
  invoicedSinceLedgerStart: number
): VendorPaidFigures => {
  const totalPaid = sources.periodPaid
    ? parseNumber(sources.periodPaid[vendorId])
    : sumAmountPaid(orders);
  const paidSinceLedgerStart = parseNumber(sources.paidSinceLedgerStart[vendorId]);
  return {
    totalPaid,
    currentFYPaid: parseNumber(sources.currentFYPaid[vendorId]),
    balance: opening.invoice - opening.payment + invoicedSinceLedgerStart - paidSinceLedgerStart,
  };
};
