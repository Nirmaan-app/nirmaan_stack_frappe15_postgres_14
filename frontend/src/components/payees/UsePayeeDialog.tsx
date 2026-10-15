/**
 * "Use an existing payee for this vendor?" (spec #1420, approved mockup screen 6): before a vendor is
 * pointed at a Payee, list every vendor already linked to it. The button stays disabled until "I checked that this vendor and this account belong to the same
 * company" is ticked.
 *
 * Reads the Payee itself (`vendor_payee.get_payee_choice`), so any screen can open it with a name:
 * the new-vendor form (#1425) and the vendor page's Use a different payee (#1426).
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
import type { PayeeWithLinks } from "@/types/NirmaanStack/Payee";
import { getFrappeError } from "@/utils/frappeErrors";
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

                <label className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                    <Checkbox
                        className="mt-0.5"
                        checked={checked}
                        onCheckedChange={(value) => setChecked(value === true)}
                        disabled={!choice}
                    />
                    <span>I checked that this vendor and this account belong to the same company.</span>
                </label>

                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <Button disabled={!choice || !checked} onClick={() => choice && onConfirm(choice)}>
                        Yes, use {payee}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

/** The Payee's account, then every vendor already linked to it. */
function ChoiceDetails({ choice }: { choice: PayeeWithLinks }) {
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
                {!choice.linked_vendors.length && (
                    <p className="py-2 text-[13px] text-muted-foreground">No vendor yet.</p>
                )}
            </div>
        </>
    );
}
