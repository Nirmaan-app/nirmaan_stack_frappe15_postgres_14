import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { VendorRefundStatus } from "@/types/NirmaanStack/VendorRefunds";

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
