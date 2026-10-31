import { type ReactNode, useState } from "react";

import { CHEQUE_ACCESS_PROFILES } from "@/constants/roles";
import { useUserData } from "@/hooks/useUserData";
import { cn } from "@/lib/utils";
import { chequeChipText, chequeChipTone, isChequeStruck } from "@/utils/cheques/chequeChip";

import { ChequeDetailDialog } from "./ChequeDetailDialog";
import { CreditChequeBadge } from "./CreditChequeBadge";

interface ChequeChipProps {
    /** The Cheque the payment is on. Blank on a cheque payment from before Cheques: the chip is then plain text. */
    cheque?: string | null;
    chequeNo: string;
    /** The Cheque's status; blank when there is no Cheque. */
    status?: string | null;
    /** A Credit Payment Cheque: a separate "Credit" badge goes before the chip, on the same line. */
    credit?: boolean;
    className?: string;
}

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
export const ChequeChip = ({ cheque, chequeNo, status, credit = false, className }: ChequeChipProps) => {
    const { role } = useUserData();
    const [open, setOpen] = useState(false);
    const text = chequeChipText(chequeNo, status);
    const chipClass = cn(
        "inline-flex max-w-full min-w-0 items-center truncate rounded border px-1.5 py-0.5 font-mono text-[11px] leading-tight",
        chequeChipTone(status),
        isChequeStruck(status) && "line-through",
        !credit && className,
    );
    // A credit cheque's badge and its chip stay on one line; a narrow cell cuts the chip's text, not the badge.
    // The badge is part of what opens the cheque: both sit inside the one button.
    const body: ReactNode = credit ? (
        <>
            <CreditChequeBadge />
            <span className={chipClass}>{text}</span>
        </>
    ) : text;
    const holderClass = credit ? cn("inline-flex max-w-full min-w-0 items-center gap-1", className) : chipClass;

    if (!cheque || !CHEQUE_ACCESS_PROFILES.includes(role)) {
        return <span className={holderClass} title={text}>{body}</span>;
    }
    return (
        <>
            <button
                type="button"
                className={cn(holderClass, "cursor-pointer text-left hover:brightness-95")}
                title={`${text}: open the cheque`}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(true);
                }}
            >
                {body}
            </button>
            {open && <ChequeDetailDialog cheque={cheque} onClose={() => setOpen(false)} />}
        </>
    );
};

/**
 * A cheque number that opens the Cheque's detail view, as the chip does, where a table shows the number and the
 * status in columns of their own (Credit Payments' Cheque Issued tab). Same audience as the chip
 * (`CHEQUE_ACCESS_PROFILES`); anyone else sees the number as plain text.
 *
 * ⚠️ RENDERS A <button>. Never put it inside another button or popover trigger.
 */
export const ChequeNumberLink = ({ cheque, chequeNo }: { cheque?: string | null; chequeNo: string }) => {
    const { role } = useUserData();
    const [open, setOpen] = useState(false);
    if (!cheque || !CHEQUE_ACCESS_PROFILES.includes(role)) {
        return <span className="font-mono">{chequeNo}</span>;
    }
    return (
        <>
            <button
                type="button"
                className="font-mono text-blue-600 hover:underline"
                title={`Cheque ${chequeNo}: open the cheque`}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(true);
                }}
            >
                {chequeNo}
            </button>
            {open && <ChequeDetailDialog cheque={cheque} onClose={() => setOpen(false)} />}
        </>
    );
};
