/**
 * Edit a Payee in place (#1435, spec #1420, ADR-0033 decision 4): its holder name, account number
 * (typed twice, paste off) and IFSC (bank and branch fill in from it). One dialog for every screen
 * that edits a Payee: the Payee page's Edit (Accounts, `payee_page.edit_payee`), the vendor page's
 * Edit bank details and the rename prompt's "Update the holder name" (whoever may set a vendor's bank
 * details, `vendor_payee.edit_vendor_payee`). Each screen passes its own endpoints.
 *
 * An account another Payee already holds is blocked, naming that Payee (the server refuses it too).
 * When the Payee serves more than one vendor, saving first shows a warning naming every vendor the
 * edit changes (`utils/payees/payeeEdit.sharedPayeeWarning`). Records already raised keep their own
 * copy of the old account.
 *
 * Mount it per edit (render it only while open): the form starts from the Payee as it is then.
 */

import { useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, Loader2 } from "lucide-react";

import {
    AlertDialog,
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
import { payeeEditUnchanged, sharedPayeeWarning, type PayeeVendorName } from "@/utils/payees/payeeEdit";
import { cleanIfsc } from "@/utils/payees/payeeForm";

import { PayeeBankFields } from "./PayeeBankFields";
import { usePayeeBankForm } from "./usePayeeBankForm";

const PAYEE_PAGE_API = "nirmaan_stack.api.payees.payee_page";
/** The Payees page's Edit (Accounts only). Takes `name`. */
export const EDIT_PAYEE_API = `${PAYEE_PAGE_API}.edit_payee`;
/** The Payees page's Delete (Accounts only). Takes `name`. */
export const DELETE_PAYEE_API = `${PAYEE_PAGE_API}.delete_payee`;

type EditReply = { payee: PayeeSummary } | { duplicate: PayeeSummary; message: string };

/** Where a screen saves an edit: its endpoint and what names the Payee to it. */
export interface PayeeEditEndpoint {
    saveApi: string;
    /** `{name}` for the Payees page, `{vendor}` for the vendor screens. */
    saveArgs: Record<string, string>;
    /** The duplicate pre-check the screen may call (`check_payee` / `check_vendor_payee`). */
    checkApi: string;
}

interface EditPayeeDialogProps {
    payee: PayeeSummary;
    /** The vendors paid into the Payee; `undefined` while they load. Named before saving when more than one. */
    vendors: PayeeVendorName[] | undefined;
    endpoint: PayeeEditEndpoint;
    title: string;
    /** The holder name the form starts with, in place of the saved one (the rename prompt's new name). */
    holderName?: string;
    onClose: () => void;
    onSaved?: (payee: PayeeSummary) => void;
}

export function EditPayeeDialog({ payee, vendors, endpoint, title, holderName, onClose, onSaved }: EditPayeeDialogProps) {
    const payeeForm = usePayeeBankForm({ checkApi: endpoint.checkApi, editing: payee, holderName });
    const { call, loading } = useFrappePostCall<{ message: EditReply }>(endpoint.saveApi);
    const [confirming, setConfirming] = useState(false);
    const { form, problem, duplicate, lookingUp } = payeeForm;

    const vendorsKnown = payee.vendors <= 1 || vendors !== undefined;
    const warning = vendors ? sharedPayeeWarning(vendors) : null;
    const unchanged = payeeEditUnchanged(payee, form);
    const blocked = loading || lookingUp || !!problem || !!duplicate || unchanged || !vendorsKnown;

    const save = async () => {
        try {
            const res = await call({
                ...endpoint.saveArgs,
                account_name: form.account_name,
                account_number: form.account_number,
                ifsc: cleanIfsc(form.ifsc),
            });
            const reply = res.message;
            if ("duplicate" in reply) {
                setConfirming(false);
                payeeForm.setDuplicate(reply.duplicate);
                toast({ title: "Already a payee", description: reply.message, variant: "destructive" });
                return;
            }
            toast({
                title: "Payee saved",
                description: `${reply.payee.name}, ${reply.payee.account_name}.`,
                variant: "success",
            });
            onSaved?.(reply.payee);
            onClose();
        } catch (e) {
            toast({ title: "Could not save the payee", description: getFrappeError(e), variant: "destructive" });
        }
    };

    const submit = () => (warning && !confirming ? setConfirming(true) : save());

    return (
        <AlertDialog open onOpenChange={(open) => !open && !loading && onClose()}>
            <AlertDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center">{title}</AlertDialogTitle>
                    <AlertDialogDescription className="text-center">
                        {payee.name}. Payments and expenses already raised keep the account they were raised with.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {confirming && warning ? (
                    <div
                        role="alert"
                        className="flex gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] leading-relaxed text-amber-900"
                    >
                        <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600" aria-hidden="true" />
                        <div>
                            <p className="font-semibold">Are you sure?</p>
                            <p className="mt-0.5">{warning}</p>
                        </div>
                    </div>
                ) : (
                    <PayeeBankFields payeeForm={payeeForm} disabled={loading} />
                )}

                <AlertDialogFooter>
                    <Button
                        variant="outline"
                        disabled={loading}
                        onClick={() => (confirming ? setConfirming(false) : onClose())}
                    >
                        {confirming ? "Back" : "Cancel"}
                    </Button>
                    <Button
                        onClick={submit}
                        disabled={blocked}
                        title={(unchanged ? "Nothing has changed." : problem) ?? undefined}
                    >
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {confirming ? `Yes, change it for all ${vendors?.length ?? ""} vendors` : "Save"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
