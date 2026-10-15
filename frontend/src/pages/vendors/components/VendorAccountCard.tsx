/**
 * The vendor page's Account Details card (#1426, #1435, spec #1420, ADR-0033, approved mockup screen 7):
 * the Payee the vendor is paid into and how many other vendors share it. Edit bank details edits that
 * Payee in place (`EditVendorPayeeDialog`, naming every vendor it changes when several share it); Use
 * a different payee points this vendor at another Payee or new bank details
 * (`ChangeVendorAccountDialog`). A vendor with no Payee shows "No bank account yet" and Add bank
 * details (`ChangeVendorAccountDialog`).
 *
 * Nothing here writes the old vendor bank fields: the vendor's bank account is its Payee.
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { PencilLine, Repeat } from "lucide-react";

import { ChangeVendorAccountDialog } from "@/components/payees/ChangeVendorAccountDialog";
import { EditVendorPayeeDialog } from "@/components/payees/EditVendorPayeeDialog";
import { useVendorAccount } from "@/components/payees/vendorPayeeAccount";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canManagePayees, canSetVendorPayee } from "@/constants/roles";
import { useUserData } from "@/hooks/useUserData";
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
    const [editing, setEditing] = useState(false);
    const { account, isLoading, error, refresh } = useVendorAccount(vendor.name);
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
                    Edit bank details when this account's holder moves banks: every vendor paid into it follows.
                    Use a different payee to pay only this vendor into another account. Payments already raised
                    keep the account they were raised with.
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
                                    .{" "}
                                    {sharedAccountLine(account?.other_vendors ?? 0)}
                                </p>
                            )}
                        </div>
                        {payee && mayChange && (
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setEditing(true)}
                                    className="flex items-center gap-1.5 border-primary text-primary hover:bg-primary/5"
                                >
                                    <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
                                    Edit bank details
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setChanging(true)}
                                    className="flex items-center gap-1.5 border-primary text-primary hover:bg-primary/5"
                                >
                                    <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                                    Use a different payee
                                </Button>
                            </div>
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
                    title={payee ? "Use a different payee" : "Add bank details"}
                    onChanged={() => refresh()}
                />
            )}
            {mayChange && editing && payee && (
                <EditVendorPayeeDialog
                    vendor={vendor.name}
                    payee={payee}
                    title="Edit bank details"
                    onClose={() => setEditing(false)}
                    onSaved={() => refresh()}
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
