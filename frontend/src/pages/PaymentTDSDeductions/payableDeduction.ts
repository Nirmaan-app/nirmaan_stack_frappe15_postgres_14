import { PAYMENT_STATUS } from "@/constants/paymentStatus";

/** What the rule reads off a register row. */
export interface PayableRow {
  status?: string | null;
  project_payment?: string | null;
  non_project_expense?: string | null;
}

/**
 * May this register row be ticked for Pay TDS? Its tax is still Pending (a blank status reads Pending, as
 * the tabs do), and either it is an Office Rent expense's row, which spec #1522 pays from approval on, or
 * its payment is Paid: Pay TDS refuses tax from any other (`pay_tds._refuse_unpaid_payments`, story 39), so
 * the register does not offer it (walk W9). `paymentStatus` undefined (not read yet) offers nothing.
 */
export const canPayDeduction = (row: PayableRow, paymentStatus: string | undefined): boolean => {
  if ((row.status || "Pending") !== "Pending") return false;
  if (row.non_project_expense) return true;
  return paymentStatus === PAYMENT_STATUS.PAID;
};
