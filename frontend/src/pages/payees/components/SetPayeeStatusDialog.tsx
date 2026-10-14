/**
 * Mark a Payee Inactive, or Active again (#1423, spec #1420). An Inactive Payee can't be newly picked
 * for a vendor, an expense or an expense request; records already pointing at it keep it. The server
 * (`api/payees/payee_page.set_payee_status`) holds the rule.
 */

import { useFrappePostCall } from "frappe-react-sdk";
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
import { toast } from "@/components/ui/use-toast";
import { PAYEE_STATUS, type PayeeSummary } from "@/types/NirmaanStack/Payee";
import { getFrappeError } from "@/utils/frappeErrors";
import { linkedToLabels } from "@/utils/payees/payeeForm";

export const SET_PAYEE_STATUS_API = "nirmaan_stack.api.payees.payee_page.set_payee_status";

interface SetPayeeStatusDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    payee: Pick<PayeeSummary, "name" | "status" | "vendors" | "expenses">;
    onSaved?: () => void;
}

export function SetPayeeStatusDialog({ open, onOpenChange, payee, onSaved }: SetPayeeStatusDialogProps) {
    const { call, loading } = useFrappePostCall<{ message: { payee: PayeeSummary } }>(SET_PAYEE_STATUS_API);
    const deactivating = payee.status === PAYEE_STATUS.ACTIVE;
    const next = deactivating ? PAYEE_STATUS.INACTIVE : PAYEE_STATUS.ACTIVE;
    const links = linkedToLabels(payee);

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
                        {deactivating
                            ? `Nobody will be able to pick it for a vendor, an expense or an expense request. ${
                                  links.length ? `The ${links.join(" and ")} already pointing at it keep it.` : ""
                              }`
                            : "It can be picked for vendors and expenses again."}
                    </AlertDialogDescription>
                </AlertDialogHeader>
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
