/**
 * The Payee tab on a user's profile: the person's own bank account, the one their Reimbursements are paid
 * into (the Payee in their `Nirmaan Users.payee` field; one per person).
 *
 * The account is added by the person themselves, from Raise Reimbursement, and the person may correct it
 * here (Edit, on their own profile only) unless a Vendor is also paid into the account: that one stays with
 * Accounts. A second account is never added; this is where the one they have is changed. The person, Admin,
 * HR and Accounts see the tab; the server refuses anyone else.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Landmark, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { OwnBankAccount } from "@/types/NirmaanStack/Reimbursement";

import { EditOwnBankAccountDialog } from "./EditOwnBankAccountDialog";

interface Props {
    account: OwnBankAccount | null;
    loading: boolean;
    isOwnProfile: boolean;
    /** After the account is edited: refetch it. */
    onChanged: () => void;
}

export function UserPayeesTab({ account, loading, isOwnProfile, onChanged }: Props) {
    const [editing, setEditing] = useState(false);

    if (loading) return <p className="text-sm text-muted-foreground">Loading bank account...</p>;

    if (!account) {
        return (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
                <Landmark className="h-8 w-8 text-muted-foreground" />
                <div>
                    <p className="font-medium">No bank account yet</p>
                    <p className="text-sm text-muted-foreground">
                        {isOwnProfile
                            ? "Add the account you'll be repaid into when you raise a reimbursement."
                            : "This person hasn't added a bank account for reimbursements."}
                    </p>
                </div>
                {isOwnProfile && (
                    <Button asChild variant="outline" size="sm">
                        <Link to="/reimbursements">Go to Reimbursements</Link>
                    </Button>
                )}
            </div>
        );
    }

    const vendorPaid = (account.vendors ?? 0) > 0;
    return (
        <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
                The bank account {isOwnProfile ? "your" : "this person's"} reimbursements are paid into.
            </p>
            <div className="flex max-w-md items-start gap-3 rounded-lg border p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Landmark className="h-4 w-4 text-primary" />
                </div>
                <dl className="min-w-0 flex-1 text-sm">
                    <dt className="sr-only">Account holder</dt>
                    <dd className="truncate font-medium">{account.account_name}</dd>
                    <dt className="sr-only">Bank</dt>
                    <dd className="truncate text-muted-foreground">{account.bank_name}{account.bank_branch ? ` · ${account.bank_branch}` : ""}</dd>
                    <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                        <dt className="text-muted-foreground">Account</dt>
                        <dd className="font-mono">{account.account_number}</dd>
                        <dt className="text-muted-foreground">IFSC</dt>
                        <dd className="font-mono">{account.ifsc}</dd>
                        <dt className="text-muted-foreground">Payee</dt>
                        <dd className="font-mono">{account.name}</dd>
                    </div>
                    {isOwnProfile && vendorPaid && (
                        <p className="mt-2 text-xs text-muted-foreground">
                            A vendor is also paid into this account, so Accounts changes it.
                        </p>
                    )}
                </dl>
                {isOwnProfile && !vendorPaid && (
                    <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" aria-label={`Edit ${account.name}`}
                        onClick={() => setEditing(true)}>
                        <Pencil className="h-4 w-4" />
                    </Button>
                )}
            </div>
            {editing && (
                <EditOwnBankAccountDialog key={account.name} account={account} onClose={() => setEditing(false)} onSaved={onChanged} />
            )}
        </div>
    );
}
