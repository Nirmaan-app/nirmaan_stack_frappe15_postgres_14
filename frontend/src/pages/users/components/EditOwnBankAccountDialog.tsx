/**
 * Correct your own bank account (holder name, account number, IFSC) from your profile's Payee tab.
 *
 * The same four fields as everywhere a Payee is entered (`PayeeBankFields`), started from the account.
 * `edit_my_bank_account` edits the Payee in place (`services/payees/own_accounts.edit_own_account`): the
 * duplicate rule and the IFSC lookup are the Payee module's, and claims already raised keep their copy of
 * the old account. Mounted per edit, because the form reads the account once.
 */

import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { PayeeBankFields } from "@/components/payees/PayeeBankFields";
import { usePayeeBankForm } from "@/components/payees/usePayeeBankForm";
import {
    AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import type { PayeeSummary } from "@/types/NirmaanStack/Payee";
import type { OwnBankAccount } from "@/types/NirmaanStack/Reimbursement";
import { getFrappeError } from "@/utils/frappeErrors";
import { cleanIfsc } from "@/utils/payees/payeeForm";

const EDIT_API = "nirmaan_stack.api.reimbursements.bank_accounts.edit_my_bank_account";

type EditReply =
    | { payee: PayeeSummary; account: OwnBankAccount | null }
    | { duplicate: PayeeSummary; message: string; account: OwnBankAccount | null };

interface Props {
    account: OwnBankAccount;
    onClose: () => void;
    onSaved: () => void;
}

export function EditOwnBankAccountDialog({ account, onClose, onSaved }: Props) {
    const { toast } = useToast();
    const payeeForm = usePayeeBankForm({
        checkApi: null,
        editing: {
            name: account.name,
            account_name: account.account_name,
            account_number: account.account_number,
            ifsc: account.ifsc,
            bank_name: account.bank_name ?? undefined,
            bank_branch: account.bank_branch ?? undefined,
        },
    });
    const { call, loading } = useFrappePostCall<{ message: EditReply }>(EDIT_API);
    const [error, setError] = useState<string | null>(null);
    const { form, problem, duplicate, lookingUp } = payeeForm;

    const save = async () => {
        setError(null);
        try {
            const res = await call({
                payee: account.name,
                account_name: form.account_name,
                account_number: form.account_number,
                ifsc: cleanIfsc(form.ifsc),
            });
            if ("duplicate" in res.message) {
                payeeForm.setDuplicate(res.message.duplicate);
                return;
            }
            toast({ title: "Bank account updated", description: "Claims already raised keep the account they were raised with.", variant: "success" });
            onSaved();
            onClose();
        } catch (e) {
            setError(getFrappeError(e));
        }
    };

    return (
        <AlertDialog open onOpenChange={(open) => !open && onClose()}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle>Edit bank account</AlertDialogTitle>
                    <AlertDialogDescription>
                        Correct the holder name, account number or IFSC. Reimbursements already raised keep the account they were raised with.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <PayeeBankFields payeeForm={payeeForm} disabled={loading} duplicateAction={() => null} />
                {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                    <Button onClick={save} disabled={loading || lookingUp || !!problem || !!duplicate} title={problem ?? undefined}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save changes
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
