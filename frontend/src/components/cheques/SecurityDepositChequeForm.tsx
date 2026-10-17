import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { Loader2, ShieldCheck, X } from "lucide-react";

import { ChequePhotoLink } from "@/components/cheques/ChequePhotoLink";
import { FROM_PHOTO_INPUT, FromPhotoTag } from "@/components/cheques/FromPhotoTag";
import type { ChequeDetail } from "@/components/cheques/useChequeDetail";
import { useChequePhotoReader } from "@/components/cheques/useChequePhotoReader";
import { useSecurableRecords } from "@/components/cheques/useChequePickers";
import VendorSelect from "@/components/custom-select/vendor-select";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { CHEQUE_BANK } from "@/types/NirmaanStack/Cheques";
import {
    depositFormFromDetail,
    depositPrefill,
    emptyDepositForm,
    makeDepositFormSchema,
    saveDepositArgs,
    securableOptions,
    securedLabel,
    type DepositFormInput,
    type DepositFormValues,
    type DepositPageRecord,
} from "@/utils/cheques/chequeDeposit";
import { chequeEditMode, editLockHint, isHeaderLocked } from "@/utils/cheques/chequeEdit";
import { isFromPhoto, type ChequePhotoField } from "@/utils/cheques/chequePhoto";
import { todayISO } from "@/utils/cheques/chequeStatus";
import { getFrappeError } from "@/utils/frappeErrors";

const SAVE_CHEQUE_API = "nirmaan_stack.api.cheques.save_cheque.save_cheque";

/** What the photo fills: the payee read off it only helps check the Vendor or type the name. */
const PHOTO_FIELDS: readonly ChequePhotoField[] = ["bank", "cheque_no", "cheque_date", "amount"];

const Required = () => <span className="ml-0.5 text-red-500">*</span>;

interface SecurityDepositChequeFormProps {
    /** The deposit being edited, as recorded; absent for a new one. */
    edit?: ChequeDetail;
    /** A new deposit from a PO or Work Order page: made out to its Vendor, naming that record (story 61). */
    from?: DepositPageRecord;
    onDone: (cheque: string) => void;
    onCancel: () => void;
}

/**
 * Add Cheque › Security Deposit cheque (#1486, spec #1477): photo first (its bank, number, date and amount
 * are read off it), the issue date (today by default), who it is made out to (a Vendor or a typed name),
 * and the Vendor's POs and Work Orders it secures (optional). It saves Issued; it pays nothing and no bank
 * statement line is ever matched to it. Also the Edit of a deposit: everything while Issued, the photo only
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
    const { upload, loading: uploading } = useFrappeFileUpload();
    const { call: saveCheque, loading: saving } = useFrappePostCall<{ message: { cheque: string; status: string } }>(
        SAVE_CHEQUE_API,
    );
    const [photo, setPhoto] = useState<File | null>(null);
    const uploadSession = useRef(0);
    const reader = useChequePhotoReader(form.getValues, (fill) => {
        for (const [field, value] of Object.entries(fill)) {
            form.setValue(field as keyof DepositFormInput, value as never, {
                shouldDirty: true,
                shouldValidate: form.formState.isSubmitted,
            });
        }
    }, PHOTO_FIELDS);

    const values = form.watch();
    const secures = values.secures ?? [];
    const { records } = useSecurableRecords(values.payee_kind === "vendor" ? values.vendor || undefined : undefined);
    const options = securableOptions(records, secures);
    const fromPhoto = (field: ChequePhotoField) => isFromPhoto(field, values, reader.photo);
    // Added from a PO / Work Order page: its Vendor and that record stay.
    const payeeLocked = locked("vendor") || Boolean(from);
    const isFixed = (record: string) => from?.name === record;

    const handlePhoto = async (file: File | null) => {
        const session = ++uploadSession.current;
        reader.cancel();
        setPhoto(file);
        form.setValue("attachment", edit?.attachment ?? "", { shouldValidate: false });
        if (!file) return;
        try {
            // Uploaded unattached, as Add Cheque's Payment form does: these users only read Cheques.
            const uploaded = await upload(file, { isPrivate: true });
            if (session !== uploadSession.current) return;
            form.setValue("attachment", uploaded.file_url, { shouldValidate: true });
            if (!edit) void reader.read(uploaded.file_url);
        } catch (e) {
            if (session !== uploadSession.current) return;
            setPhoto(null);
            toast({ title: "Could not upload the photo", description: getFrappeError(e), variant: "destructive" });
        }
    };

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
                <FormField
                    control={form.control}
                    name="attachment"
                    render={() => (
                        <FormItem>
                            <FormLabel>Cheque photo{(!edit || edit.attachment) && <Required />}</FormLabel>
                            <div className="flex flex-wrap items-center gap-2">
                                {edit?.attachment && (
                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                        Recorded: <ChequePhotoLink url={edit.attachment} chequeNo={edit.cheque_no} />
                                    </span>
                                )}
                                <CustomAttachment
                                    selectedFile={photo}
                                    onFileSelect={handlePhoto}
                                    acceptedTypes={["image/*", "application/pdf"]}
                                    label={edit?.attachment ? "Replace photo" : "Upload cheque photo"}
                                    disabled={saving}
                                />
                                {(uploading || reader.reading) && (
                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        {uploading ? "Uploading..." : "Reading the photo..."}
                                    </span>
                                )}
                            </div>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="bank"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Bank<Required />{fromPhoto("bank") && <FromPhotoTag />}</FormLabel>
                                <Select value={field.value} onValueChange={field.onChange} disabled={locked("bank")}>
                                    <FormControl>
                                        <SelectTrigger className={cn(fromPhoto("bank") && FROM_PHOTO_INPUT)}>
                                            <SelectValue placeholder="Choose the bank" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value={CHEQUE_BANK.ICICI}>ICICI Bank</SelectItem>
                                        <SelectItem value={CHEQUE_BANK.OTHERS}>Others</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    {values.bank === CHEQUE_BANK.OTHERS && (
                        <FormField
                            control={form.control}
                            name="bank_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Bank name<Required /></FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. HDFC Bank" disabled={locked("bank_name")} {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    )}
                    <FormField
                        control={form.control}
                        name="cheque_no"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Cheque number<Required />{fromPhoto("cheque_no") && <FromPhotoTag />}</FormLabel>
                                <FormControl>
                                    <Input
                                        inputMode="numeric"
                                        placeholder="e.g. 000760"
                                        disabled={locked("cheque_no")}
                                        className={cn(fromPhoto("cheque_no") && FROM_PHOTO_INPUT)}
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="cheque_date"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Cheque date<Required />{fromPhoto("cheque_date") && <FromPhotoTag />}</FormLabel>
                                <FormControl>
                                    <Input type="date" disabled={locked("cheque_date")} className={cn(fromPhoto("cheque_date") && FROM_PHOTO_INPUT)} {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="amount"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Amount (₹)<Required />{fromPhoto("amount") && <FromPhotoTag />}</FormLabel>
                                <FormControl>
                                    <Input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        disabled={locked("amount")}
                                        className={cn(fromPhoto("amount") && FROM_PHOTO_INPUT)}
                                        {...field}
                                        value={field.value as number | string}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
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
                </div>
                <FormField
                    control={form.control}
                    name="payee_kind"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Made out to</FormLabel>
                            <RadioGroup
                                value={field.value}
                                onValueChange={(next) => {
                                    // A typed payee secures nothing: its records belong to a Vendor.
                                    if (next === "typed" && !from) form.setValue("secures", []);
                                    field.onChange(next);
                                }}
                                className="flex flex-wrap gap-4"
                                disabled={payeeLocked}
                            >
                                <div className="flex items-center gap-2">
                                    <RadioGroupItem value="vendor" id="deposit-payee-vendor" />
                                    <Label htmlFor="deposit-payee-vendor" className="font-normal">A Vendor</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <RadioGroupItem value="typed" id="deposit-payee-typed" />
                                    <Label htmlFor="deposit-payee-typed" className="font-normal">Someone else (type the name)</Label>
                                </div>
                            </RadioGroup>
                        </FormItem>
                    )}
                />
                {values.payee_kind === "vendor" ? (
                    <FormField
                        control={form.control}
                        name="vendor"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Vendor<Required /></FormLabel>
                                <FormControl>
                                    <VendorSelect
                                        withOthers={false}
                                        usePortal
                                        disabled={payeeLocked}
                                        value={field.value || null}
                                        onChange={(option) => {
                                            const next = option?.value ?? "";
                                            // Each secured record is the Vendor's: a new Vendor drops them.
                                            if (next !== field.value) form.setValue("secures", []);
                                            field.onChange(next);
                                        }}
                                        placeholder="Pick the Vendor"
                                    />
                                </FormControl>
                                {reader.photo?.payee_name && (
                                    <p className="text-xs text-muted-foreground">
                                        Payee on the photo: <span className="font-medium text-foreground">{reader.photo.payee_name}</span>
                                        <FromPhotoTag />
                                    </p>
                                )}
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                ) : (
                    <FormField
                        control={form.control}
                        name="payee_name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Payee name<Required /></FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g. the landlord's name" disabled={locked("payee_name")} {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                )}
                <FormField
                    control={form.control}
                    name="secures"
                    render={() => (
                        <FormItem>
                            <FormLabel>
                                Secures{" "}
                                <span className="font-normal text-muted-foreground">
                                    (optional: the POs or Work Orders this deposit guarantees)
                                </span>
                            </FormLabel>
                            <div className="flex flex-wrap items-center gap-1.5 rounded-md border p-2">
                                {secures.map((s) => (
                                    <span
                                        key={`${s.record_doctype}|${s.record_name}`}
                                        className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs"
                                    >
                                        {securedLabel(s.record_doctype, s.record_name)}
                                        {!locked("lines") && !isFixed(s.record_name) && (
                                            <button
                                                type="button"
                                                className="rounded-full p-0.5 text-muted-foreground hover:bg-background"
                                                aria-label={`Remove ${s.record_name}`}
                                                onClick={() =>
                                                    form.setValue(
                                                        "secures",
                                                        secures.filter((x) => x.record_name !== s.record_name),
                                                        { shouldValidate: form.formState.isSubmitted },
                                                    )
                                                }
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        )}
                                    </span>
                                ))}
                                {values.payee_kind === "vendor" && values.vendor && !locked("lines") && options.length > 0 && (
                                    <Select
                                        value=""
                                        onValueChange={(value) => {
                                            const picked = options.find((o) => o.value === value)?.record;
                                            if (!picked) return;
                                            form.setValue("secures", [
                                                ...secures,
                                                { record_doctype: picked.doctype, record_name: picked.name, project: picked.project },
                                            ]);
                                        }}
                                    >
                                        <SelectTrigger className="h-7 w-auto min-w-[200px] border-dashed text-xs" aria-label="Add a PO or Work Order">
                                            <SelectValue placeholder="+ Add PO or Work Order" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {options.map((o) => (
                                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                                {secures.length === 0 && (values.payee_kind === "typed" || !values.vendor || options.length === 0) && (
                                    <span className="px-1 text-xs text-muted-foreground">Nothing named</span>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Only this Vendor's POs and Work Orders. With a typed payee there is nothing to pick.
                            </p>
                            <FormMessage />
                        </FormItem>
                    )}
                />
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
