/**
 * The vendor page's Account Details card (#1426, spec #1420, ADR-0033, approved mockup screen 7): the
 * Payee the vendor is paid into, how many other vendors share it, and Change account. A vendor with
 * no Payee shows "No bank account yet" and Add bank details. Both open `ChangeVendorAccountDialog`.
 *
 * Nothing here writes the old vendor bank fields: the vendor's bank account is its Payee.
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Repeat } from "lucide-react";

import { ChangeVendorAccountDialog } from "@/components/payees/ChangeVendorAccountDialog";
import { useVendorAccount } from "@/components/payees/vendorPayeeApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canManagePayees, canSetVendorPayee } from "@/constants/roles";
import { useUserData } from "@/hooks/useUserData";
import { PAYEE_STATUS } from "@/types/NirmaanStack/Payee";
import type { Vendors } from "@/types/NirmaanStack/Vendors";
import { getFrappeError } from "@/utils/frappeErrors";
import { payeeHref } from "@/utils/payees/payeeRoutes";
import { NO_ACCOUNT_LINE, sharedAccountLine } from "@/utils/payees/vendorAccount";

interface VendorAccountCardProps {
    vendor: Vendors;
}

export const VendorAccountCard: React.FC<VendorAccountCardProps> = ({ vendor }) => {
    const { role, user_id } = useUserData();
    const [changing, setChanging] = useState(false);
    const { account, isLoading, error, mutate } = useVendorAccount(vendor.name);
    const payee = account?.payee ?? null;
    const mayChange = canSetVendorPayee(role, user_id);

    let body: React.ReactNode;
    if (isLoading) {
        body = <p className="text-sm text-muted-foreground">Loading the bank account…</p>;
    } else if (error) {
        body = <p className="text-sm text-destructive">{getFrappeError(error)}</p>;
    } else if (!payee) {
        body = (
            <>
                <p className="text-sm leading-relaxed text-muted-foreground">{NO_ACCOUNT_LINE}</p>
                {mayChange && (
                    <Button size="sm" className="self-start" onClick={() => setChanging(true)}>
                        Add bank details
                    </Button>
                )}
            </>
        );
    } else {
        body = (
            <>
                <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
                    <InfoItem label="Account Holder Name" value={payee.account_name} />
                    <InfoItem label="Account Number" value={payee.account_number} />
                    <InfoItem label="IFSC Code" value={payee.ifsc} />
                    <InfoItem label="Bank Name" value={payee.bank_name} />
                    <InfoItem label="Branch" value={payee.bank_branch} />
                </div>
                <p className="rounded-md bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
                    To pay this vendor somewhere else, use Change account. You can pick another payee or enter new
                    bank details. The account number and IFSC of a payee that has been paid can't be edited.
                </p>
            </>
        );
    }

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-start gap-3">
                        <div className="flex-grow">
                            <CardTitle className="text-primary">Account Details</CardTitle>
                            {payee && (
                                <p className="mt-1 text-[13px] text-muted-foreground">
                                    Paid into payee{" "}
                                    {canManagePayees(role, user_id) ? (
                                        <Link to={payeeHref(payee.name)} className="text-blue-600 hover:underline">
                                            {payee.name}
                                        </Link>
                                    ) : (
                                        payee.name
                                    )}
                                    {payee.status === PAYEE_STATUS.INACTIVE && " (Inactive)"}.{" "}
                                    {sharedAccountLine(account?.other_vendors ?? 0)}
                                </p>
                            )}
                        </div>
                        {payee && mayChange && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setChanging(true)}
                                className="flex items-center gap-1.5 border-primary text-primary hover:bg-primary/5"
                            >
                                <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                                Change account
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">{body}</CardContent>
            </Card>
            {mayChange && (
                <ChangeVendorAccountDialog
                    open={changing}
                    onOpenChange={setChanging}
                    vendor={vendor}
                    currentPayee={payee?.name}
                    title={payee ? "Change account" : "Add bank details"}
                    onChanged={() => mutate()}
                />
            )}
        </>
    );
};

const InfoItem: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
    <div>
        <p className="text-xs font-medium text-primary">{label}</p>
        <p className="text-sm font-medium tabular-nums text-foreground">{value || "N/A"}</p>
    </div>
);

export default VendorAccountCard;
