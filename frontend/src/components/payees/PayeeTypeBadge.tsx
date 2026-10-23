/**
 * A Payee's type as a small badge (owner, 2026-10-23): where the Payee was created, set once.
 * Users -- a person's own account (Raise Reimbursement); Vendors -- a vendor's bank details; Others --
 * anywhere else. Shown on the payee picker's cards and the Payees list.
 */

import { cn } from "@/lib/utils";
import type { PayeeType } from "@/types/NirmaanStack/Payee";

const TONE: Record<PayeeType, string> = {
    Users: "bg-violet-100 text-violet-800",
    Vendors: "bg-sky-100 text-sky-800",
    Others: "bg-zinc-100 text-zinc-700",
};

const TITLE: Record<PayeeType, string> = {
    Users: "A person's own bank account, added from Raise Reimbursement",
    Vendors: "Added as a vendor's bank details",
    Others: "Added outside vendors and reimbursements",
};

interface PayeeTypeBadgeProps {
    type?: PayeeType | null;
    className?: string;
}

/** Nothing for a Payee with no type (one not saved yet). */
export function PayeeTypeBadge({ type, className }: PayeeTypeBadgeProps) {
    if (!type || !(type in TONE)) return null;
    return (
        <span
            title={TITLE[type]}
            className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none", TONE[type], className)}
        >
            {type}
        </span>
    );
}
