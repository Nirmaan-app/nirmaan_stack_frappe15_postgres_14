/**
 * Change account / Add bank details on the vendor page (#1426, spec #1420, approved mockup screen 7):
 * point an existing vendor at another Payee on record (through the confirmation) or at new bank
 * details. The same two paths as the new-vendor form (`VendorPayeeSection`), saved by
 * `api/payees/vendor_payee.change_vendor_payee`. The other vendors on the old Payee keep it.
 */

import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import type { PayeeSummary } from "@/types/NirmaanStack/Payee";
import { getFrappeError } from "@/utils/frappeErrors";

import { useVendorPayeeChoice } from "./useVendorPayeeChoice";
import { VendorPayeeSection } from "./VendorPayeeSection";
import { CHANGE_VENDOR_PAYEE_API } from "./vendorPayeeApi";

type ChangeReply = { payee: PayeeSummary } | { duplicate: PayeeSummary; message: string };

interface ChangeVendorAccountDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    vendor: { name: string; vendor_name: string; vendor_pan?: string | null };
    /** The Payee the vendor is paid into now, if any: not offered again. */
    currentPayee?: string | null;
    /** "Change account" for a vendor with a Payee, "Add bank details" for one without. */
    title: string;
    onChanged?: (payee: PayeeSummary) => void;
}

export function ChangeVendorAccountDialog({
    open,
    onOpenChange,
    vendor,
    currentPayee,
    title,
    onChanged,
}: ChangeVendorAccountDialogProps) {
    const choice = useVendorPayeeChoice();
    const { call, loading } = useFrappePostCall<{ message: ChangeReply }>(CHANGE_VENDOR_PAYEE_API);

    // Closing drops what was typed, so the next open starts clean.
    const change = (next: boolean) => {
        if (!next) choice.reset();
        onOpenChange(next);
    };

    const save = async () => {
        if (choice.problem) {
            toast({ title: "Bank details", description: choice.problem, variant: "destructive" });
            return;
        }
        try {
            const res = await call({ vendor: vendor.name, ...choice.answer() });
            if ("duplicate" in res.message) {
                // A Payee already holds these details (the pre-check missed it): the fields offer it.
                choice.payeeForm.setDuplicate(res.message.duplicate);
                toast({ title: "Already a payee", description: res.message.message, variant: "destructive" });
                return;
            }
            const payee = res.message.payee;
            toast({
                title: "Account changed",
                description: `${vendor.vendor_name} is now paid into ${payee.name}, ${payee.account_name}.`,
                variant: "success",
            });
            onChanged?.(payee);
            change(false);
        } catch (e) {
            toast({ title: "Could not change the account", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={change}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        {vendor.vendor_name} ({vendor.name}). Other vendors paid into its current account keep it.
                    </DialogDescription>
                </DialogHeader>

                <VendorPayeeSection
                    choice={choice}
                    vendorName={vendor.vendor_name}
                    vendorPan={vendor.vendor_pan ?? undefined}
                    disabled={loading}
                    currentPayee={currentPayee}
                />

                <DialogFooter>
                    <Button variant="outline" onClick={() => change(false)} disabled={loading}>
                        Cancel
                    </Button>
                    <Button onClick={save} disabled={loading || !!choice.problem}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save account
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
