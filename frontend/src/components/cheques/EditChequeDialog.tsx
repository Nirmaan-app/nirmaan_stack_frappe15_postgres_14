import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";

import { ChequeHeaderFields } from "@/components/cheques/ChequeHeaderFields";
import { ChequeLinesView } from "@/components/cheques/ChequeLinesView";
import { SecurityDepositChequeForm } from "@/components/cheques/SecurityDepositChequeForm";
import type { ChequeDetail } from "@/components/cheques/useChequeDetail";
import type { ChequeEditTarget } from "@/components/cheques/useChequeEdit";
import { useChequePhotoUpload } from "@/components/cheques/useChequePhotoUpload";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { CHEQUE_TYPE } from "@/types/NirmaanStack/Cheques";
import { chequeBankOptions, chequeEditMode, chequeFormFromDetail, chequeFormRules, editChequeArgs, editLockHint, isHeaderLocked } from "@/utils/cheques/chequeEdit";
import { makeChequeFormSchema, SAVE_CHEQUE_API, type ChequeFormInput, type ChequeFormValues } from "@/utils/cheques/chequeForm";
import { getFrappeError } from "@/utils/frappeErrors";

interface EditChequeDialogProps {
    /**
     * The Cheque to edit (#1418), as the handler that opened the dialog read it (`useChequeEdit`); null while
     * closed. The form copies it once, so each opening reads it afresh first.
     */
    edit: ChequeEditTarget | null;
    onClose: () => void;
    /** Called with the Cheque's name once it is saved. */
    onSaved: (cheque: string) => void;
}

/**
 * Cheque Tracker > Edit (#1418; spec #1514). The Tracker makes no cheque: a Payment cheque is made with its
 * payment on the PO page, a Security Deposit cheque on the PO page's card.
 *
 * - A **Payment cheque**: its header, with only what its status opens (`utils/cheques/chequeEdit`). While
 *   Approval Pending that is its number, bank, date and photo; its Vendor, amount, note and lines are shown as made,
 *   and the lines are never sent, so the server keeps them. Its bank is fixed to ICICI Bank (#1516).
 * - A **Security Deposit cheque**: `SecurityDepositChequeForm`, in full while Issued.
 *
 * A replaced photo is not read: the Cheque's fields are already recorded. The server re-checks every rule.
 */
export const EditChequeDialog = ({ edit, onClose, onSaved }: EditChequeDialogProps) => {
    const detail = edit?.detail;
    const done = (name: string) => {
        onClose();
        onSaved(name);
    };
    return (
        <Dialog open={Boolean(edit)} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>{`Edit Cheque ${detail?.cheque_no ?? ""}`}</DialogTitle>
                    <DialogDescription>
                        Correct what was recorded wrongly. What can change depends on the cheque's type and status.
                    </DialogDescription>
                </DialogHeader>
                {detail ? (
                    detail.cheque_type === CHEQUE_TYPE.SECURITY_DEPOSIT ? (
                        <SecurityDepositChequeForm key={detail.name} edit={detail} onDone={done} onCancel={onClose} />
                    ) : (
                        <PaymentChequeEditForm key={detail.name} edit={detail} onDone={done} onCancel={onClose} />
                    )
                ) : edit?.error ? (
                    <p className="text-sm text-destructive">{getFrappeError(edit.error)}</p>
                ) : (
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                )}
            </DialogContent>
        </Dialog>
    );
};

interface PaymentChequeEditFormProps {
    /** The Cheque being edited, as recorded. */
    edit: ChequeDetail;
    onDone: (cheque: string) => void;
    onCancel: () => void;
}

/** A Payment cheque's Edit. Mounted with the dialog's content, so every opening starts fresh. */
const PaymentChequeEditForm = ({ edit, onDone, onCancel }: PaymentChequeEditFormProps) => {
    const mode = chequeEditMode(edit);
    const locked = (field: string) => isHeaderLocked(mode, field);
    const lockHint = editLockHint(mode, edit);
    const [initial] = useState(() => chequeFormFromDetail(edit));
    const form = useForm<ChequeFormInput, unknown, ChequeFormValues>({
        resolver: zodResolver(makeChequeFormSchema(chequeFormRules(edit))),
        defaultValues: initial,
    });
    const { call: saveCheque, loading: saving } = useFrappePostCall<{ message: { cheque: string; status: string } }>(
        SAVE_CHEQUE_API,
    );
    const photoUpload = useChequePhotoUpload(form, edit);
    const { uploading, reader } = photoUpload;

    const onSubmit = async (values: ChequeFormValues) => {
        try {
            const res = await saveCheque(editChequeArgs(edit.name, values));
            toast({
                title: "Cheque saved",
                description: `Cheque ${values.cheque_no.trim()} is ${res.message.status}.`,
                variant: "success",
            });
            onDone(res.message.cheque);
        } catch (e) {
            toast({ title: "Cheque not saved", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="min-w-0 space-y-4">
                {lockHint && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{lockHint}</p>}
                <ChequeHeaderFields
                    form={form}
                    edit={edit}
                    upload={photoUpload}
                    locked={locked}
                    saving={saving}
                    banks={chequeBankOptions(edit)}
                />
                <FormItem>
                    <FormLabel>Made out to</FormLabel>
                    <Input value={edit.vendor_name || edit.vendor || edit.payee_name || ""} disabled readOnly />
                </FormItem>
                <div className="space-y-1.5">
                    <p className="text-sm font-medium">What it pays</p>
                    {edit.lines.length ? (
                        <ChequeLinesView lines={edit.lines} linkRecords={false} />
                    ) : (
                        <p className="text-sm text-muted-foreground">No lines.</p>
                    )}
                </div>
                {edit.description && (
                    <FormItem>
                        <FormLabel>Note</FormLabel>
                        <Textarea value={edit.description} disabled readOnly />
                    </FormItem>
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
                    {/* While a save is in flight the form cannot be sent again. */}
                    <Button type="submit" disabled={form.formState.isSubmitting || saving || uploading || reader.reading}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save changes
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
};
