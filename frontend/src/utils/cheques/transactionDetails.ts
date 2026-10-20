import { PAYMENT_STATUS } from "@/constants/paymentStatus";

/**
 * Does a PO's Transaction Details list this payment (#1519, spec #1514)? A cheque payment only once it is
 * Paid: until the bank pays the cheque no money has left, and the PO's cheque card shows it instead. Every
 * other payment (Online, or blank, which reads as Online) is listed at every status. A row filter only:
 * the PO's paid and due totals come from the PO itself and do not change.
 */
export const listedInTransactionDetails = (p: { mode_of_payment?: string | null; status?: string | null }): boolean =>
    p.mode_of_payment !== "Cheque" || p.status === PAYMENT_STATUS.PAID;
