import { TDS_BORNE_BY, type PaymentTDSDeduction } from "@/types/NirmaanStack/PaymentTDSDeduction";

/**
 * The TDS register's Net Paid: what the vendor got on the deduction's payment (#1543, owner ruling Q31-A).
 * Tax withheld from the vendor (`borne_by` Vendor, or blank: the column default) cut the payment to
 * gross - tax. Tax the company paid on top (`borne_by` Company) left the payment whole, so the vendor got
 * the gross. Derived, never stored: once the row exists, `Project Payments.amount` is this figure.
 */
export const deductionNetPaid = (row: Pick<PaymentTDSDeduction, "gross_amount" | "tds_amount" | "borne_by">): number => {
	const gross = row.gross_amount || 0;
	return row.borne_by === TDS_BORNE_BY.COMPANY ? gross : gross - (row.tds_amount || 0);
};
