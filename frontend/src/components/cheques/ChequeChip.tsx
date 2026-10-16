import { useState } from "react";

import { CHEQUE_ACCESS_PROFILES } from "@/constants/roles";
import { useUserData } from "@/hooks/useUserData";
import { cn } from "@/lib/utils";
import { chequeChipText, isChequeStruck } from "@/utils/cheques/chequeChip";

import { ChequeDetailDialog } from "./ChequeDetailDialog";

interface ChequeChipProps {
    /** The Cheque the payment is on. Blank on a cheque payment from before Cheques: the chip is then plain text. */
    cheque?: string | null;
    chequeNo: string;
    /** The Cheque's status; blank when there is no Cheque. */
    status?: string | null;
    className?: string;
}

const STATUS_TONE: Record<string, string> = {
    Issued: "border-yellow-300 bg-yellow-50 text-yellow-900",
    Cleared: "border-green-300 bg-green-50 text-green-900",
    Cancelled: "border-red-200 bg-red-50 text-red-700",
};

/**
 * The cheque chip (#1415, spec #1407): `Cheque 004521 · Issued` on a payment that is on a Cheque, wherever
 * payments are listed. Clicking it opens the Cheque's detail view; a Cancelled cheque's chip is struck through.
 *
 * Opens only for the roles that may see a Cheque (`CHEQUE_ACCESS_PROFILES`, the detail endpoint's gate);
 * anyone else sees the same chip as plain text. The detail dialog mounts on click, so a page of chips holds
 * no fetch and no listener.
 *
 * ⚠️ RENDERS A <button>. Never put it inside another button or popover trigger.
 */
export const ChequeChip = ({ cheque, chequeNo, status, className }: ChequeChipProps) => {
    const { role } = useUserData();
    const [open, setOpen] = useState(false);
    const text = chequeChipText(chequeNo, status);
    const chipClass = cn(
        "inline-flex max-w-full items-center truncate rounded border px-1.5 py-0.5 font-mono text-[11px] leading-tight",
        STATUS_TONE[status ?? ""] ?? "border-border bg-muted/40 text-foreground",
        isChequeStruck(status) && "line-through",
        className,
    );

    if (!cheque || !CHEQUE_ACCESS_PROFILES.includes(role)) {
        return <span className={chipClass} title={text}>{text}</span>;
    }
    return (
        <>
            <button
                type="button"
                className={cn(chipClass, "cursor-pointer hover:brightness-95")}
                title={`${text}: open the cheque`}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(true);
                }}
            >
                {text}
            </button>
            {open && <ChequeDetailDialog cheque={cheque} onClose={() => setOpen(false)} />}
        </>
    );
};
