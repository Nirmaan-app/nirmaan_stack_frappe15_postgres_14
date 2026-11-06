import { TDS_BORNE_BY, type PaymentTDSDeduction } from "@/types/NirmaanStack/PaymentTDSDeduction";
import { withheldBill } from "@/utils/expenses/expenseTds";

/** A register row with the GST of the Office Rent expense it was withheld on, joined by the list query
 *  (`non_project_expense.gst_amount as expense_gst_amount`). Absent on a Work Order or PO row. */
export type DeductionPaidRow = Pick<PaymentTDSDeduction, "gross_amount" | "tds_amount" | "borne_by" | "non_project_expense"> & {
	expense_gst_amount?: number | null;
};

/**
 * The TDS register's Paid Amount: what the payee got on the deduction's payment (#1543, owner ruling Q31-A).
 * Tax withheld from the payee (`borne_by` Vendor, or blank: the column default) cut the payment by the tax.
 * Tax the company paid on top (`borne_by` Company) left the payment whole.
 *
 * What was paid before the tax: a Work Order or PO row's gross. An Office Rent row's gross is the base rent,
 * and the landlord was paid the bill, base rent + the Expense's GST (`withheldBill`, spec #1613): ₹1,08,000 on
 * a ₹1,18,000 bill. Derived, never stored.
 */
export const deductionNetPaid = (row: DeductionPaidRow): number => {
	const paidBeforeTax = row.non_project_expense
		? withheldBill(row.gross_amount, row.expense_gst_amount)
		: row.gross_amount || 0;
	return row.borne_by === TDS_BORNE_BY.COMPANY ? paidBeforeTax : paidBeforeTax - (row.tds_amount || 0);
};
