/**
 * `Vendor Refunds` (#1398, ADR-0032): the one record of money a vendor sends back.
 *
 * A refund's status is the backend's `services/vendor_refunds.REFUND_STATUSES`. Only a Received refund
 * lowers its order's paid amount; a Reconciliation Pending one waits for its bank line (and holds its
 * amount of the PO's overpaid credit); a Cancelled one counts for nothing.
 */
export const VENDOR_REFUND_STATUS = {
    WAITING: "Reconciliation Pending",
    RECEIVED: "Received",
    CANCELLED: "Cancelled",
} as const;

export type VendorRefundStatus = (typeof VENDOR_REFUND_STATUS)[keyof typeof VENDOR_REFUND_STATUS];

/**
 * A waiting refund that holds its PO's overpaid credit, as `get_po_adjustment` and the PO lock check send
 * it (`services/vendor_refunds.waiting_refunds_of`): what Adjust Payments holds back and what the lock
 * waits for.
 */
export interface HeldRefund {
    name: string;
    amount: number;
    payment_date?: string | null;
}
