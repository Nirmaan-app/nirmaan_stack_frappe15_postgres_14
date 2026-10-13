import { Badge, type BadgeProps } from "@/components/ui/badge";

/**
 * A `Vendor Refunds.status` (#1398, ADR-0032), the backend's `services/vendor_refunds.REFUND_STATUSES`.
 * Only a Received refund lowers its order's paid amount; a Reconciliation Pending one waits for its bank
 * line; a Cancelled one counts for nothing.
 */
export type VendorRefundStatus = "Reconciliation Pending" | "Received" | "Cancelled";

const STATUS_VARIANT: Record<VendorRefundStatus, BadgeProps["variant"]> = {
    Received: "teal",
    "Reconciliation Pending": "yellow",
    Cancelled: "gray",
};

/** A refund's status as a badge, in the Transaction Details rows and the vendor's Vendor Refunds list. */
export const RefundStatusBadge = ({ status }: { status: VendorRefundStatus }) => (
    <Badge variant={STATUS_VARIANT[status] ?? "outline"} className="whitespace-nowrap">
        {status}
    </Badge>
);
