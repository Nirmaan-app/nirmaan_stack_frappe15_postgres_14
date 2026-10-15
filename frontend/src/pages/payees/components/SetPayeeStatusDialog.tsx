/**
 * Mark a Payee Inactive, or Active again (#1423, spec #1420). An Inactive Payee can't be newly picked
 * for a vendor, an expense or an expense request; records already pointing at it keep it. The server
 * (`api/payees/payee_page.set_payee_status`) holds the rule.
 */

import { useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, Loader2 } from "lucide-react";

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
import { toast } from "@/components/ui/use-toast";
import { PAYEE_STATUS, type PayeeSummary } from "@/types/NirmaanStack/Payee";
import { getFrappeError } from "@/utils/frappeErrors";
import { deactivateText, deactivateVendorWarning } from "@/utils/payees/payeePage";

export const SET_PAYEE_STATUS_API = "nirmaan_stack.api.payees.payee_page.set_payee_status";

interface SetPayeeStatusDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    payee: Pick<PayeeSummary, "name" | "status" | "vendors" | "expenses">;
    onSaved?: () => void;
    /** Opens the Payee's Linked Vendors, from the warning that vendors are still paid into it. */
    onShowVendors?: () => void;
}

export function SetPayeeStatusDialog({ open, onOpenChange, payee, onSaved, onShowVendors }: SetPayeeStatusDialogProps) {
    const { call, loading } = useFrappePostCall<{ message: { payee: PayeeSummary } }>(SET_PAYEE_STATUS_API);
    const deactivating = payee.status === PAYEE_STATUS.ACTIVE;
    const next = deactivating ? PAYEE_STATUS.INACTIVE : PAYEE_STATUS.ACTIVE;
    const vendorWarning = deactivating ? deactivateVendorWarning(payee.vendors) : null;

    const save = async () => {
        try {
            await call({ name: payee.name, status: next });
            toast({ title: `${payee.name} is ${next}`, variant: "success" });
            onSaved?.();
            onOpenChange(false);
        } catch (e) {
            toast({ title: "Could not change the status", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle>{deactivating ? `Mark ${payee.name} inactive?` : `Mark ${payee.name} active?`}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {deactivating ? deactivateText(payee) : "It can be picked for vendors and expenses again."}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {vendorWarning && (
                    <div role="alert" className="flex gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3.5 py-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                        <div className="text-[13px] leading-normal text-amber-900">
                            <p>{vendorWarning}</p>
                            {onShowVendors && (
                                <button
                                    type="button"
                                    onClick={onShowVendors}
                                    className="mt-1 font-semibold text-amber-800 hover:underline"
                                >
                                    See the linked vendors
                                </button>
                            )}
                        </div>
                    </div>
                )}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                    <Button onClick={save} disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {deactivating ? "Mark inactive" : "Mark active"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
