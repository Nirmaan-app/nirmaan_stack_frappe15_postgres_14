/**
 * Delete on the Payee page (#1435, spec #1420, ADR-0033 decision 4): only a Payee no vendor links to.
 * One a vendor links to says which vendors and offers no Delete (`utils/payees/payeeEdit.payeeDeleteBlock`);
 * the server refuses it too (`payee_page.delete_payee`). Payments and expenses keep their own copy of
 * the account, so nothing else stops a delete.
 */

import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";

import { DELETE_PAYEE_API } from "@/components/payees/EditPayeeDialog";
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
import type { PayeePage } from "@/types/NirmaanStack/Payee";
import { getFrappeError } from "@/utils/frappeErrors";
import { payeeDeleteBlock } from "@/utils/payees/payeeEdit";

interface DeletePayeeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    payee: PayeePage;
    onDeleted: () => void;
}

export function DeletePayeeDialog({ open, onOpenChange, payee, onDeleted }: DeletePayeeDialogProps) {
    const { call, loading } = useFrappePostCall(DELETE_PAYEE_API);
    const blocked = payeeDeleteBlock(payee.linked_vendors);

    const remove = async () => {
        try {
            await call({ name: payee.name });
            toast({ title: "Payee deleted", description: `${payee.name}, ${payee.account_name}.`, variant: "success" });
            onOpenChange(false);
            onDeleted();
        } catch (e) {
            toast({ title: "Could not delete the payee", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete {payee.name}?</AlertDialogTitle>
                    <AlertDialogDescription className="leading-relaxed">
                        {blocked ??
                            `${payee.account_name}'s account leaves the address book. Payments and expenses already raised keep their own copy of it.`}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>{blocked ? "Close" : "Cancel"}</AlertDialogCancel>
                    {!blocked && (
                        <Button variant="destructive" onClick={remove} disabled={loading}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete payee
                        </Button>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
