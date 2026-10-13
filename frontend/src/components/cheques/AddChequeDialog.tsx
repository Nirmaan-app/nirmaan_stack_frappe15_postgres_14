import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, Loader2 } from "lucide-react";

import { ChequePhotoLink } from "@/components/cheques/ChequePhotoLink";
import { FROM_PHOTO_INPUT, FromPhotoTag } from "@/components/cheques/FromPhotoTag";
import { useChequeDetail, type ChequeDetail } from "@/components/cheques/useChequeDetail";
import { useChequePhotoReader, usePayeeVendorMismatch } from "@/components/cheques/useChequePhotoReader";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import VendorSelect from "@/components/custom-select/vendor-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { CHEQUE_BANK } from "@/types/NirmaanStack/Cheques";
import {
    chequeEditMode,
    chequeFormFromDetail,
    editChequeArgs,
    editLockHint,
    isHeaderLocked,
    lockedLinePayments,
} from "@/utils/cheques/chequeEdit";
import {
    EMPTY_CHEQUE_FORM,
    makeChequeFormSchema,
    saveChequeArgs,
    type ChequeFormInput,
    type ChequeFormValues,
} from "@/utils/cheques/chequeForm";
import { withoutPoWoLines } from "@/utils/cheques/chequeLines";
import { isFromPhoto, type ChequePhotoField } from "@/utils/cheques/chequePhoto";
import { getFrappeError } from "@/utils/frappeErrors";
import { cn } from "@/lib/utils";

import { ChequeLinesTable } from "./ChequeLinesTable";

const SAVE_CHEQUE_API = "nirmaan_stack.api.cheques.save_cheque.save_cheque";

interface AddChequeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called with the Cheque's name once it is saved. */
    onSaved: (cheque: string) => void;
    /** The Cheque to edit (#1418); absent to add a new one. */
    cheque?: string | null;
}

const Required = () => <span className="ml-0.5 text-red-500">*</span>;

/**
 * Reports > Payment > Cheque Payment > Add Cheque (spec #1407): photo first, then the bank, number,
 * date, amount, the payee (a Vendor or a typed name), the lines and a description. A Vendor cheque
 * takes PO/WO payment lines (#1410) and expense lines (#1411); a typed-payee cheque expense lines
 * only (`ChequeLinesTable`). With no lines it is an Ad-hoc cheque and needs the description.
 *
 * With `cheque` it is the row's Edit (#1418): the same form, filled with the Cheque, with the boxes
 * its status and origin lock turned off (`utils/cheques/chequeEdit`). A replaced photo is not read:
 * the Cheque's fields are already recorded.
 *
 * The photo is uploaded as soon as it is picked, so the form holds its file URL (and #1409 can read
 * it). The server re-checks every rule.
 */
export const AddChequeDialog = ({ open, onOpenChange, onSaved, cheque }: AddChequeDialogProps) => {
    const editing = Boolean(cheque);
    const { cheque: detail, error } = useChequeDetail(open && cheque ? cheque : null);
    const done = (name: string) => {
        onOpenChange(false);
        onSaved(name);
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[960px]">
                <DialogHeader>
                    <DialogTitle>{editing ? `Edit Cheque ${detail?.cheque_no ?? ""}` : "Add Cheque"}</DialogTitle>
                    <DialogDescription>
                        {editing
                            ? "Change what was recorded wrongly. What can change depends on the cheque's status and where it was made."
                            : `Upload the cheque's photo first: what can be read off it is filled in and tagged "From photo". Check those fields.`}
                    </DialogDescription>
                </DialogHeader>
                {!editing ? (
                    <ChequeForm onDone={done} onCancel={() => onOpenChange(false)} />
                ) : detail ? (
                    <ChequeForm key={detail.name} edit={detail} onDone={done} onCancel={() => onOpenChange(false)} />
                ) : error ? (
                    <p className="text-sm text-destructive">{getFrappeError(error)}</p>
                ) : (
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                )}
            </DialogContent>
        </Dialog>
    );
};

interface ChequeFormProps {
    /** The Cheque being edited, as recorded; absent for a new one. */
    edit?: ChequeDetail;
    onDone: (cheque: string) => void;
    onCancel: () => void;
}

/** The dialog's form. Mounted with the dialog's content, so every opening starts fresh. */
const ChequeForm = ({ edit, onDone, onCancel }: ChequeFormProps) => {
    const mode = edit ? chequeEditMode(edit) : "all";
    const locked = (field: string) => isHeaderLocked(mode, field);
    const lockedPayments = edit ? lockedLinePayments(edit) : [];
    const lockHint = edit ? editLockHint(mode, edit.status) : undefined;
    const [initial] = useState(() => (edit ? chequeFormFromDetail(edit) : EMPTY_CHEQUE_FORM));
    const form = useForm<ChequeFormInput, unknown, ChequeFormValues>({
        // A backfilled Cheque has no photo; editing it does not force one (the server asks only a new Cheque).
        resolver: zodResolver(makeChequeFormSchema({ photoRequired: !edit || Boolean(edit.attachment) })),
        defaultValues: initial,
    });
    const { upload, loading: uploading } = useFrappeFileUpload();
    const { call: saveCheque, loading: saving } = useFrappePostCall<{ message: { cheque: string } }>(SAVE_CHEQUE_API);
    const [photo, setPhoto] = useState<File | null>(null);
    // A photo replaced while the first is still uploading must not land the first one's URL.
    const uploadSession = useRef(0);

    const reader = useChequePhotoReader(form.getValues, (fill) => {
        for (const [field, value] of Object.entries(fill)) {
            form.setValue(field as keyof ChequeFormInput, value as never, {
                shouldDirty: true,
                shouldValidate: form.formState.isSubmitted,
            });
        }
    });

    const values = form.watch();
    const bank = values.bank;
    const payeeKind = values.payee_kind;
    const vendor = values.vendor;
    const lineCount = values.lines?.length ?? 0;
    const fromPhoto = (field: ChequePhotoField) => isFromPhoto(field, values, reader.photo);
    const photoPayee = reader.photo?.payee_name;
    // A payment line ties the Cheque to its Vendor, and cannot come off while it is Issued.
    const payeeLocked = locked("vendor") || lockedPayments.length > 0;
    const payeeMismatch = usePayeeVendorMismatch(payeeKind === "vendor" ? photoPayee : undefined, values.vendor);

    const handlePhoto = async (file: File | null) => {
        const session = ++uploadSession.current;
        reader.cancel();
        setPhoto(file);
        // Clearing a replacement photo on an edit goes back to the recorded one.
        form.setValue("attachment", edit?.attachment ?? "", { shouldValidate: false });
        if (!file) return;
        try {
            // Uploaded unattached: Frappe's upload checks WRITE permission on the doctype it attaches
            // to, and the Cheques DocPerms give these users read only (the cheques service writes).
            // Saving the Cheque attaches the File to it (`attach_files_to_document`).
            const uploaded = await upload(file, { isPrivate: true });
            if (session !== uploadSession.current) return;
            form.setValue("attachment", uploaded.file_url, { shouldValidate: true });
            // A replaced photo is read again; what only the old one said is cleared. An edit keeps
            // what was recorded.
            if (!edit) void reader.read(uploaded.file_url);
        } catch (e) {
            if (session !== uploadSession.current) return;
            setPhoto(null);
            toast({ title: "Could not upload the photo", description: getFrappeError(e), variant: "destructive" });
        }
    };

    const onSubmit = async (values: ChequeFormValues) => {
        try {
            const res = await saveCheque(edit ? editChequeArgs(edit.name, values) : saveChequeArgs(values));
            const paid = values.lines.filter((l) => l.line_type === "PO/WO Payment" && l.payment_name).length;
            const onIt = paid ? ` ${paid} payment${paid > 1 ? "s are" : " is"} now on it.` : "";
            toast({
                title: "Cheque saved",
                description: edit
                    ? `Cheque ${values.cheque_no.trim()} is saved.${onIt}`
                    : `Cheque ${values.cheque_no.trim()} is Issued.${onIt}`,
                variant: "success",
            });
            onDone(res.message.cheque);
        } catch (e) {
            toast({ title: "Cheque not saved", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {lockHint && (
                    <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{lockHint}</p>
                )}
                <FormField
                    control={form.control}
                    name="attachment"
                    render={() => (
                        <FormItem>
                            <FormLabel>Cheque photo{(!edit || edit.attachment) && <Required />}</FormLabel>
                            <div className="flex items-center gap-2">
                                {edit && (
                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                        {edit.attachment ? "Recorded:" : "No photo yet."}
                                        {edit.attachment && <ChequePhotoLink url={edit.attachment} chequeNo={edit.cheque_no} />}
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
                    {bank === CHEQUE_BANK.OTHERS && (
                        <FormField
                            control={form.control}
                            name="bank_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Bank name<Required />{fromPhoto("bank") && <FromPhotoTag />}</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. HDFC Bank" disabled={locked("bank_name")} className={cn(fromPhoto("bank") && FROM_PHOTO_INPUT)} {...field} />
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
                                        placeholder="e.g. 004521"
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
                </div>
                <FormField
                    control={form.control}
                    name="payee_kind"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Made out to<Required /></FormLabel>
                            <RadioGroup
                                value={field.value}
                                disabled={payeeLocked}
                                onValueChange={(value) => {
                                    field.onChange(value);
                                    // PO/WO lines belong to a Vendor cheque only; expense lines to any.
                                    form.setValue("lines", withoutPoWoLines(form.getValues("lines") ?? []));
                                }}
                                className="flex gap-6"
                            >
                                <label className="flex items-center gap-2 text-sm">
                                    <RadioGroupItem value="vendor" /> A Vendor
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <RadioGroupItem value="typed" /> Someone else (type the name)
                                </label>
                            </RadioGroup>
                        </FormItem>
                    )}
                />
                {payeeKind === "vendor" ? (
                    <FormField
                        control={form.control}
                        name="vendor"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <VendorSelect
                                        withOthers={false}
                                        usePortal
                                        disabled={payeeLocked}
                                        value={field.value || null}
                                        onChange={(option) => {
                                            const next = option?.value ?? "";
                                            // Each PO/WO line is the Vendor's: a new Vendor drops them.
                                            if (next !== field.value) {
                                                form.setValue("lines", withoutPoWoLines(form.getValues("lines") ?? []));
                                            }
                                            field.onChange(next);
                                        }}
                                        placeholder="Pick the Vendor"
                                    />
                                </FormControl>
                                {photoPayee && (
                                    <p className="text-xs text-muted-foreground">
                                        Payee on the photo: <span className="font-medium text-foreground">{photoPayee}</span>
                                        <FromPhotoTag />
                                    </p>
                                )}
                                {payeeMismatch && (
                                    <p className="flex items-start gap-1.5 text-xs text-amber-700">
                                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        The payee on the photo ({payeeMismatch.payee}) does not look like{" "}
                                        {payeeMismatch.vendorName}. Check the Vendor; you can still save.
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
                                {fromPhoto("payee_name") && <FromPhotoTag />}
                                <FormControl>
                                    <Input
                                        placeholder="e.g. Tata Power"
                                        disabled={locked("payee_name")}
                                        className={cn(fromPhoto("payee_name") && FROM_PHOTO_INPUT)}
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                )}
                <ChequeLinesTable
                    vendorPayee={payeeKind === "vendor"}
                    vendor={vendor || undefined}
                    disabled={saving || locked("lines")}
                    cheque={edit?.name}
                    lockedPayments={lockedPayments}
                />
                <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Description{lineCount === 0 && <Required />}</FormLabel>
                            <FormControl>
                                <Textarea
                                    placeholder="What this cheque pays for (rent, a deposit, ...)"
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
                    <Button type="submit" disabled={saving || uploading || reader.reading}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {edit ? "Save changes" : "Save Cheque"}
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
};
