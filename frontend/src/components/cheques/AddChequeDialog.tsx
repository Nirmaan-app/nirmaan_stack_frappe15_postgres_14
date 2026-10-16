import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, Info, Loader2 } from "lucide-react";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { CHEQUE_BANK, CHEQUE_TYPE, type ChequeType } from "@/types/NirmaanStack/Cheques";
import {
    chequeEditMode,
    chequeFormFromDetail,
    chequeFormRules,
    editChequeArgs,
    editLockHint,
    isHeaderLocked,
    paymentsOnCheque,
} from "@/utils/cheques/chequeEdit";
import {
    EMPTY_CHEQUE_FORM,
    makeChequeFormSchema,
    saveChequeArgs,
    type ChequeFormInput,
    type ChequeFormValues,
} from "@/utils/cheques/chequeForm";
import { chequeSaveNote, withoutPoWoLines, type ChequeLineDraft } from "@/utils/cheques/chequeLines";
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

/** What the photo fills. A Payment cheque is made out to a Vendor: the payee read off it only helps check one. */
const PHOTO_FIELDS: readonly ChequePhotoField[] = ["bank", "cheque_no", "cheque_date", "amount"];

/** The two kinds of cheque Add Cheque asks for first (spec #1477, ADR-0035). */
const TYPE_CHOICES: { type: ChequeType; label: string; hint: string }[] = [
    { type: CHEQUE_TYPE.PAYMENT, label: "Payment cheque", hint: "The bank will cash it. Pays PO payments." },
    { type: CHEQUE_TYPE.SECURITY_DEPOSIT, label: "Security Deposit cheque", hint: "Held as a guarantee. Never cashed." },
];

/**
 * Cheque Tracker > Add Cheque (spec #1407; #1482, spec #1477). It asks for the kind of cheque first:
 *
 * - a **Payment cheque**: photo first, then the bank, number, date, amount, the Vendor it is made out to,
 *   and the PO payments it pays (`ChequeLinesTable`). It saves Pending; picked Approved payments issue it.
 * - a **Security Deposit cheque**: not built yet (#1486 builds its form in `SecurityDepositChequeForm`'s place).
 *
 * With `cheque` it is the row's Edit (#1418): the same form, filled with the Cheque, with the boxes its
 * status and origin lock turned off (`utils/cheques/chequeEdit`). A replaced photo is not read: the
 * Cheque's fields are already recorded.
 *
 * The photo is uploaded as soon as it is picked, so the form holds its file URL (and #1409 can read it).
 * The server re-checks every rule.
 */
export const AddChequeDialog = ({ open, onOpenChange, onSaved, cheque }: AddChequeDialogProps) => {
    const editing = Boolean(cheque);
    const { cheque: detail, error } = useChequeDetail(open && cheque ? cheque : null);
    const [type, setType] = useState<ChequeType | null>(null);
    const done = (name: string) => {
        onOpenChange(false);
        onSaved(name);
    };
    const changeOpen = (next: boolean) => {
        if (!next) setType(null); // every opening asks for the type again
        onOpenChange(next);
    };
    return (
        <Dialog open={open} onOpenChange={changeOpen}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
                <DialogHeader>
                    <DialogTitle>{editing ? `Edit Cheque ${detail?.cheque_no ?? ""}` : "Add Cheque"}</DialogTitle>
                    <DialogDescription>
                        {editing
                            ? "Change what was recorded wrongly. What can change depends on the cheque's status and where it was made."
                            : "Choose the kind of cheque, upload its photo, then add the PO payments it pays."}
                    </DialogDescription>
                </DialogHeader>
                {editing ? (
                    detail ? (
                        <ChequeForm key={detail.name} edit={detail} onDone={done} onCancel={() => changeOpen(false)} />
                    ) : error ? (
                        <p className="text-sm text-destructive">{getFrappeError(error)}</p>
                    ) : (
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    )
                ) : (
                    <>
                        <ChequeTypeStep value={type} onChange={setType} />
                        {type === CHEQUE_TYPE.PAYMENT && <ChequeForm onDone={done} onCancel={() => changeOpen(false)} />}
                        {type === CHEQUE_TYPE.SECURITY_DEPOSIT && <SecurityDepositChequeForm onCancel={() => changeOpen(false)} />}
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};

/** Add Cheque's first question: which kind of cheque. */
const ChequeTypeStep = ({ value, onChange }: { value: ChequeType | null; onChange: (type: ChequeType) => void }) => (
    <div role="radiogroup" aria-label="Cheque type" className="grid gap-2 sm:grid-cols-2">
        {TYPE_CHOICES.map((choice) => {
            const checked = value === choice.type;
            return (
                <button
                    key={choice.type}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => onChange(choice.type)}
                    className={cn(
                        "flex flex-col items-start gap-0.5 rounded-md border px-4 py-3 text-left transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        checked ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
                    )}
                >
                    <span className="text-sm font-medium">{choice.label}</span>
                    <span className="text-xs text-muted-foreground">{choice.hint}</span>
                </button>
            );
        })}
    </div>
);

/** ⚠️ Stub: the Security Deposit cheque's form is #1486's (spec #1477). */
const SecurityDepositChequeForm = ({ onCancel }: { onCancel: () => void }) => (
    <div className="space-y-4">
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Security Deposit cheques can't be recorded here yet.
        </p>
        <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        </DialogFooter>
    </div>
);

interface ChequeFormProps {
    /** The Cheque being edited, as recorded; absent for a new Payment cheque. */
    edit?: ChequeDetail;
    onDone: (cheque: string) => void;
    onCancel: () => void;
}

/** A Payment cheque's form. Mounted with the dialog's content, so every opening starts fresh. */
const ChequeForm = ({ edit, onDone, onCancel }: ChequeFormProps) => {
    const mode = edit ? chequeEditMode(edit) : "all";
    const locked = (field: string) => isHeaderLocked(mode, field);
    const recordedPayments = edit ? paymentsOnCheque(edit) : [];
    const lockHint = edit ? editLockHint(mode, edit) : undefined;
    const [initial] = useState(() => (edit ? chequeFormFromDetail(edit) : EMPTY_CHEQUE_FORM));
    const form = useForm<ChequeFormInput, unknown, ChequeFormValues>({
        resolver: zodResolver(makeChequeFormSchema(edit ? chequeFormRules(edit) : { photoRequired: true, paymentCheque: true })),
        defaultValues: initial,
    });
    const { upload, loading: uploading } = useFrappeFileUpload();
    const { call: saveCheque, loading: saving } = useFrappePostCall<{ message: { cheque: string; status: string } }>(
        SAVE_CHEQUE_API,
    );
    const [photo, setPhoto] = useState<File | null>(null);
    const [vendorName, setVendorName] = useState(edit?.vendor_name ?? "");
    // A photo replaced while the first is still uploading must not land the first one's URL.
    const uploadSession = useRef(0);

    const reader = useChequePhotoReader(form.getValues, (fill) => {
        for (const [field, value] of Object.entries(fill)) {
            form.setValue(field as keyof ChequeFormInput, value as never, {
                shouldDirty: true,
                shouldValidate: form.formState.isSubmitted,
            });
        }
    }, PHOTO_FIELDS);

    const values = form.watch();
    const bank = values.bank;
    const vendor = values.vendor;
    const lines = (values.lines ?? []) as ChequeLineDraft[];
    const fromPhoto = (field: ChequePhotoField) => isFromPhoto(field, values, reader.photo);
    const photoPayee = reader.photo?.payee_name;
    const payeeLocked = locked("vendor");
    const payeeMismatch = usePayeeVendorMismatch(photoPayee, values.vendor);
    const saveNote = mode === "photo_only" ? undefined : chequeSaveNote(values.amount as number | string, lines);

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
            const paid = values.lines.filter((l) => l.payment_name).length;
            const onIt = paid ? ` ${paid} payment${paid > 1 ? "s are" : " is"} on it.` : "";
            toast({
                title: "Cheque saved",
                description: `Cheque ${values.cheque_no.trim()} is ${res.message.status}.${onIt}`,
                variant: "success",
            });
            onDone(res.message.cheque);
        } catch (e) {
            toast({ title: "Cheque not saved", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <Form {...form}>
            {/* min-w-0: a grid item of the dialog, it would otherwise grow to the lines table's width and
                scroll the whole dialog sideways; the table scrolls in its own box instead. */}
            <form onSubmit={form.handleSubmit(onSubmit)} className="min-w-0 space-y-4">
                {lockHint && (
                    <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{lockHint}</p>
                )}
                <FormField
                    control={form.control}
                    name="attachment"
                    render={() => (
                        <FormItem>
                            <FormLabel>Cheque photo{(!edit || edit.attachment) && <Required />}</FormLabel>
                            <div className="flex flex-wrap items-center gap-2">
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
                {values.payee_kind === "typed" ? (
                    // Only an Old-type cheque has a typed payee, and it is shown as recorded (photo-only edit).
                    <FormItem>
                        <FormLabel>Made out to</FormLabel>
                        <Input value={values.payee_name ?? ""} disabled readOnly />
                        <p className="text-xs text-muted-foreground">A typed payee, recorded before cheque types.</p>
                    </FormItem>
                ) : (
                    <FormField
                        control={form.control}
                        name="vendor"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Made out to (Vendor)<Required /></FormLabel>
                                <FormControl>
                                    <VendorSelect
                                        withOthers={false}
                                        usePortal
                                        disabled={payeeLocked}
                                        value={field.value || null}
                                        onChange={(option) => {
                                            const next = option?.value ?? "";
                                            // Each PO line is the Vendor's: a new Vendor drops them.
                                            if (next !== field.value) {
                                                form.setValue("lines", withoutPoWoLines(form.getValues("lines") ?? []));
                                            }
                                            setVendorName(option?.label ?? "");
                                            field.onChange(next);
                                        }}
                                        placeholder="Pick the Vendor"
                                    />
                                </FormControl>
                                <p className="text-xs text-muted-foreground">
                                    A Payment cheque is always made out to a Vendor.
                                </p>
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
                )}
                <ChequeLinesTable
                    vendor={vendor || undefined}
                    vendorName={vendorName}
                    disabled={saving || locked("lines")}
                    cheque={edit?.name}
                    recordedPayments={recordedPayments}
                />
                <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Note</FormLabel>
                            <FormControl>
                                <Textarea placeholder="Anything else to know about this cheque" disabled={locked("description")} {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                {saveNote && (
                    <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>{saveNote}</p>
                    </div>
                )}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
                    {/* While a save is in flight (validation included) the form cannot be sent again: a second
                        send of the same cheque is refused as a duplicate after the first one saved and closed
                        the dialog. */}
                    <Button type="submit" disabled={form.formState.isSubmitting || saving || uploading || reader.reading}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {edit ? "Save changes" : "Save Cheque"}
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
};
