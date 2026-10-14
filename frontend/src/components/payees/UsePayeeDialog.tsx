/**
 * "Use an existing payee for this vendor?" (spec #1420, approved mockup screen 6): before a vendor is
 * pointed at a Payee, list every vendor and expense already linked to it and when it was last paid.
 * The button stays disabled until "I checked that this vendor and this account belong to the same
 * company" is ticked.
 *
 * Reads the Payee itself (`vendor_payee.get_payee_choice`), so any screen can open it with a name:
 * the new-vendor form (#1425) and the vendor page's Change account (#1426).
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PAYEE_STATUS, type PayeeWithLinks } from "@/types/NirmaanStack/Payee";
import { getFrappeError } from "@/utils/frappeErrors";
import { expensesLine, lastPaidLine } from "@/utils/payees/payeeChoice";
import { bankLine } from "@/utils/payees/payeeForm";

import { usePayeeWithLinks } from "./vendorPayeeApi";

interface UsePayeeDialogProps {
    /** The Payee to confirm; the dialog is open while it is set. */
    payee: string | null;
    /** The vendor being pointed at it, as the sentence names it. */
    vendorLabel?: string;
    onCancel: () => void;
    onConfirm: (choice: PayeeWithLinks) => void;
}

export function UsePayeeDialog({ payee, vendorLabel, onCancel, onConfirm }: UsePayeeDialogProps) {
    // Keyed on the Payee, so the tick never carries over from one Payee to the next.
    return payee ? (
        <ConfirmDialog key={payee} payee={payee} vendorLabel={vendorLabel} onCancel={onCancel} onConfirm={onConfirm} />
    ) : null;
}

function ConfirmDialog({ payee, vendorLabel, onCancel, onConfirm }: UsePayeeDialogProps & { payee: string }) {
    const [checked, setChecked] = useState(false);
    const { choice, isLoading, error } = usePayeeWithLinks(payee);
    const inactive = choice?.status === PAYEE_STATUS.INACTIVE;

    return (
        <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
            <AlertDialogContent className="sm:max-w-[540px]">
                <AlertDialogHeader>
                    <AlertDialogTitle>Use an existing payee for this vendor?</AlertDialogTitle>
                    <AlertDialogDescription className="leading-normal">
                        Every PO and Work Order payment to{" "}
                        <b className="text-foreground">{vendorLabel?.trim() || "this vendor"}</b> will go to this account.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {isLoading && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading the payee...
                    </p>
                )}
                {error && <p className="text-sm text-destructive">{getFrappeError(error)}</p>}
                {choice && <ChoiceDetails choice={choice} />}

                {inactive ? (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900">
                        {choice.name} is Inactive: it can't be picked for a vendor.
                    </p>
                ) : (
                    <label className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                        <Checkbox
                            className="mt-0.5"
                            checked={checked}
                            onCheckedChange={(value) => setChecked(value === true)}
                            disabled={!choice}
                        />
                        <span>I checked that this vendor and this account belong to the same company.</span>
                    </label>
                )}

                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <Button disabled={!choice || inactive || !checked} onClick={() => choice && onConfirm(choice)}>
                        Yes, use {payee}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

/** The Payee's account, then everything already linked to it and its last payment. */
function ChoiceDetails({ choice }: { choice: PayeeWithLinks }) {
    const expenses = expensesLine(choice);
    const bank = bankLine(choice);
    return (
        <>
            <div className="rounded-md bg-muted px-3.5 py-3 text-sm leading-relaxed tabular-nums">
                <b>{choice.account_name}</b> ({choice.name})
                <br />
                A/c {choice.account_number}, IFSC {choice.ifsc}
                {bank && (
                    <>
                        <br />
                        {bank}
                    </>
                )}
            </div>
            <div>
                <p className="mb-1 text-sm font-semibold">Already linked to</p>
                {choice.linked_vendors.map((v) => (
                    <div key={v.name} className="flex justify-between gap-3 border-b border-muted py-2 text-[13px]">
                        <Link to={`/vendors/${v.name}`} target="_blank" className="text-blue-600 hover:underline">
                            {v.name}
                        </Link>
                        <span className="text-right">{v.vendor_name}</span>
                    </div>
                ))}
                {expenses && (
                    <div className="flex justify-between gap-3 border-b border-muted py-2 text-[13px]">
                        <span>Expenses</span>
                        <span className="text-right">{expenses}</span>
                    </div>
                )}
                {!choice.linked_vendors.length && !expenses && (
                    <p className="py-2 text-[13px] text-muted-foreground">Nothing yet.</p>
                )}
                <p className="mt-2 text-[13px] text-muted-foreground">{lastPaidLine(choice)}</p>
            </div>
        </>
    );
}
