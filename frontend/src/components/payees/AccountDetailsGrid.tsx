/**
 * A bank account's details, read-only: holder name, account number, IFSC, bank and branch. The vendor
 * page's Account Details card and the request-payment dialogs' "Will be paid into" box both show a
 * vendor's account through it (spec #1420, ADR-0033).
 */

import type { PayToAccount } from "@/types/NirmaanStack/Payee";
import { cn } from "@/lib/utils";

interface AccountDetailsGridProps {
    account: PayToAccount;
    className?: string;
}

export function AccountDetailsGrid({ account, className }: AccountDetailsGridProps) {
    return (
        <div className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
            <AccountDetail label="Account Holder Name" value={account.account_name} />
            <AccountDetail label="Account Number" value={account.account_number} />
            <AccountDetail label="IFSC Code" value={account.ifsc} />
            <AccountDetail label="Bank Name" value={account.bank_name} />
            <AccountDetail label="Branch" value={account.bank_branch} />
        </div>
    );
}

function AccountDetail({ label, value }: { label: string; value?: string | null }) {
    return (
        <div>
            <p className="text-xs font-medium text-primary">{label}</p>
            <p className="break-words text-sm font-medium tabular-nums text-foreground">{value || "N/A"}</p>
        </div>
    );
}
