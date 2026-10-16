/**
 * Add Payee (spec #1420, approved mockup screen 3): a bank account the company will pay into.
 *
 * The fields and their checks are `PayeeBankFields`; this dialog submits them to
 * `api/payees/add_payee.add_payee`. A duplicate the pre-check missed comes back as data and shows in
 * the same block. Opened from the Payees page's header button (Accountant, Accountant Lead, Admin).
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
import type { PayeeSummary } from "@/types/NirmaanStack/Payee";
import { getFrappeError } from "@/utils/frappeErrors";
import { cleanIfsc } from "@/utils/payees/payeeForm";

import { PayeeBankFields } from "./PayeeBankFields";
import { usePayeeBankForm } from "./usePayeeBankForm";

export const ADD_PAYEE_API = "nirmaan_stack.api.payees.add_payee.add_payee";

type AddPayeeReply = { payee: PayeeSummary } | { duplicate: PayeeSummary; message: string };

interface AddPayeeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAdded?: (payee: PayeeSummary) => void;
}

export function AddPayeeDialog({ open, onOpenChange, onAdded }: AddPayeeDialogProps) {
    const payeeForm = usePayeeBankForm();
    const { call, loading } = useFrappePostCall<{ message: AddPayeeReply }>(ADD_PAYEE_API);
    const { form, problem, duplicate, lookingUp } = payeeForm;

    const close = (next: boolean) => {
        if (!next) payeeForm.reset();
        onOpenChange(next);
    };

    const submit = async () => {
        try {
            const res = await call({
                account_name: form.account_name,
                account_number: form.account_number,
                ifsc: cleanIfsc(form.ifsc),
            });
            const reply = res.message;
            if ("duplicate" in reply) {
                payeeForm.setDuplicate(reply.duplicate);
                return;
            }
            toast({
                title: "Payee added",
                description: `${reply.payee.name}, ${reply.payee.account_name}.`,
                variant: "success",
            });
            onAdded?.(reply.payee);
            close(false);
        } catch (e) {
            toast({ title: "Could not add the payee", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={close}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center">Add Payee</AlertDialogTitle>
                    <AlertDialogDescription className="text-center">
                        A bank account the company will pay into.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <PayeeBankFields payeeForm={payeeForm} disabled={loading} />
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                    <Button
                        onClick={submit}
                        disabled={loading || lookingUp || !!problem || !!duplicate}
                        title={problem ?? undefined}
                    >
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Add Payee
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
