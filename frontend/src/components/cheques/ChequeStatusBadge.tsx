import { Badge, type BadgeProps } from "@/components/ui/badge";
import { CHEQUE_STATUS, type ChequeStatus } from "@/types/NirmaanStack/Cheques";

const STATUS_VARIANT: Record<ChequeStatus, BadgeProps["variant"]> = {
    [CHEQUE_STATUS.PENDING]: "indigo",
    Issued: "yellow",
    Cleared: "green",
    Cancelled: "red",
};

/** A Cheque's status as a badge: Approval Pending (its payments wait for approval), Issued, Cleared (the bank paid it) or Cancelled. */
export const ChequeStatusBadge = ({ status }: { status: ChequeStatus }) => (
    <Badge variant={STATUS_VARIANT[status] ?? "outline"} className="whitespace-nowrap">
        {status}
    </Badge>
);
