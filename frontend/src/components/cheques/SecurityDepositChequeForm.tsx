import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappePostCall } from "frappe-react-sdk";
import { Loader2, ShieldCheck } from "lucide-react";

import { ChequeHeaderFields, Required } from "@/components/cheques/ChequeHeaderFields";
import { FromPhotoTag } from "@/components/cheques/FromPhotoTag";
import type { ChequeDetail } from "@/components/cheques/useChequeDetail";
import { useChequePhotoUpload } from "@/components/cheques/useChequePhotoUpload";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import {
    depositFormFromDetail,
    depositPrefill,
    emptyDepositForm,
    makeDepositFormSchema,
    saveDepositArgs,
    type DepositFormInput,
    type DepositFormValues,
    type DepositPageRecord,
    WO_DOCTYPE,
} from "@/utils/cheques/chequeDeposit";
import { chequeEditMode, editLockHint, editPhotoFills, isHeaderLocked } from "@/utils/cheques/chequeEdit";
import { SAVE_CHEQUE_API } from "@/utils/cheques/chequeForm";
import { todayISO } from "@/utils/cheques/chequeStatus";
import { getFrappeError } from "@/utils/frappeErrors";

interface SecurityDepositChequeFormProps {
    /** The deposit being edited, as recorded; absent for a new one. */
    edit?: ChequeDetail;
    /** A new deposit from a PO or Work Order page: made out to its Vendor, naming that record (story 61). */
    from?: DepositPageRecord;
    onDone: (cheque: string) => void;
    onCancel: () => void;
}

/**
 * The Security Deposit cheque form, added from the PO or Work Order page's cheques card (#1486, spec #1477; spec #1514;
 * ADR-0035 Amendment C): photo first (its bank, number, date and amount are read off it), the issue date (today by
 * default) and a note. Who it is made out to and the order it secures are shown, never picked: added from a page it
 * is that order's alone, made out to its Vendor, and an Edit keeps both as recorded. It saves Issued; it pays nothing
 * and no bank statement line is ever matched to it. The Edit changes everything else while Issued, the photo only
 * once Cancelled (`utils/cheques/chequeEdit`). Rules: `utils/cheques/chequeDeposit`; the server re-checks.
 */
export const SecurityDepositChequeForm = ({ edit, from, onDone, onCancel }: SecurityDepositChequeFormProps) => {
    const mode = edit ? chequeEditMode(edit) : "all";
    const locked = (field: string) => isHeaderLocked(mode, field);
    const lockHint = edit ? editLockHint(mode, edit) : undefined;
    const today = todayISO();
    const [initial] = useState<DepositFormInput>(() =>
        edit ? depositFormFromDetail(edit) : from ? depositPrefill(from, today) : emptyDepositForm(today),
    );
    const form = useForm<DepositFormInput, unknown, DepositFormValues>({
        resolver: zodResolver(makeDepositFormSchema({ photoRequired: !edit || Boolean(edit.attachment), today })),
        defaultValues: initial,
    });
    const { call: saveCheque, loading: saving } = useFrappePostCall<{ message: { cheque: string; status: string } }>(
        SAVE_CHEQUE_API,
    );
    const photoUpload = useChequePhotoUpload(form, edit, edit ? editPhotoFills(mode, edit) : undefined);
    const { uploading, reader } = photoUpload;

    // Who it is made out to and what it secures: the page's order and its Vendor, or the deposit as recorded.
    const secures = initial.secures ?? [];
    const payee = from
        ? { label: "Vendor", name: from.vendor_name || from.vendor }
        : edit?.vendor
          ? { label: "Vendor", name: edit.vendor_name || edit.vendor }
          : { label: "Made out to", name: edit?.payee_name ?? "" };
    const securesLabel =
        secures.length === 1 ? (secures[0].record_doctype === WO_DOCTYPE ? "Work Order" : "PO") : "POs / Work Orders";

    const onSubmit = async (v: DepositFormValues) => {
        try {
            const res = await saveCheque({ ...saveDepositArgs(v), ...(edit ? { name: edit.name } : {}) });
            toast({
                title: edit ? "Cheque saved" : "Security Deposit cheque saved",
                description: `Cheque ${v.cheque_no.trim()} is ${res.message.status}.`,
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
                {!edit && (
                    <div className="flex items-start gap-2 rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-900">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <p>
                            A Security Deposit cheque is never cashed. It pays no payment, it is never matched to a bank
                            statement line, and it is <strong>Issued</strong> as soon as you save it.
                        </p>
                    </div>
                )}
                <ChequeHeaderFields form={form} edit={edit} upload={photoUpload} locked={locked} saving={saving}>
                    <FormField
                        control={form.control}
                        name="issue_date"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Issue date<Required /></FormLabel>
                                <FormControl>
                                    <Input type="date" max={today} disabled={locked("issue_date")} {...field} />
                                </FormControl>
                                <p className="text-xs text-muted-foreground">The day it was handed over. Defaults to today.</p>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </ChequeHeaderFields>
                {/* Never picked: the page's order and its Vendor, or the deposit as recorded (Edit). */}
                <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/40 px-3 py-2 sm:grid-cols-2">
                    <div className="min-w-0">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{payee.label}</p>
                        <p className="truncate text-sm font-medium">{payee.name || "--"}</p>
                        {reader.photo?.payee_name && (
                            <p className="text-xs text-muted-foreground">
                                Payee on the photo: <span className="font-medium text-foreground">{reader.photo.payee_name}</span>
                                <FromPhotoTag />
                            </p>
                        )}
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{securesLabel}</p>
                        <p className="break-words text-sm font-medium">
                            {secures.length ? secures.map((s) => s.record_name).join(", ") : "Nothing named"}
                        </p>
                    </div>
                </div>
                <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Note</FormLabel>
                            <FormControl>
                                <Textarea
                                    placeholder="e.g. Security cheque for the solar EPC order; return on handover."
                                    disabled={locked("description")}
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
                    <Button type="submit" disabled={form.formState.isSubmitting || saving || uploading || reader.reading}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {edit ? "Save changes" : "Save Security Deposit cheque"}
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
};
