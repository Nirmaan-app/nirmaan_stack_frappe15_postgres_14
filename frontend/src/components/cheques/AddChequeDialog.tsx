import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { AlertTriangle, Loader2 } from "lucide-react";

import { FROM_PHOTO_INPUT, FromPhotoTag } from "@/components/cheques/FromPhotoTag";
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
    chequeFormSchema,
    EMPTY_CHEQUE_FORM,
    saveChequeArgs,
    type ChequeFormInput,
    type ChequeFormValues,
} from "@/utils/cheques/chequeForm";
import { isFromPhoto, type ChequePhotoField } from "@/utils/cheques/chequePhoto";
import { getFrappeError } from "@/utils/frappeErrors";
import { cn } from "@/lib/utils";

const SAVE_CHEQUE_API = "nirmaan_stack.api.cheques.save_cheque.save_cheque";

interface AddChequeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called with the new Cheque's name once it is saved. */
    onSaved: (cheque: string) => void;
}

const Required = () => <span className="ml-0.5 text-red-500">*</span>;

/**
 * Reports > Payment > Cheque Payment > Add Cheque (spec #1407): photo first, then the bank, number,
 * date, amount, the payee (a Vendor or a typed name) and a description. #1408 saves a Cheque with no
 * lines (an Ad-hoc cheque); the lines table (#1410, #1411) and the photo reader (#1409) build on it.
 *
 * The photo is uploaded as soon as it is picked, so the form holds its file URL (and #1409 can read
 * it). The server re-checks every rule.
 */
export const AddChequeDialog = ({ open, onOpenChange, onSaved }: AddChequeDialogProps) => {
    const form = useForm<ChequeFormInput, unknown, ChequeFormValues>({
        resolver: zodResolver(chequeFormSchema),
        defaultValues: EMPTY_CHEQUE_FORM,
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
    const fromPhoto = (field: ChequePhotoField) => isFromPhoto(field, values, reader.photo);
    const photoPayee = reader.photo?.payee_name;
    const payeeMismatch = usePayeeVendorMismatch(payeeKind === "vendor" ? photoPayee : undefined, values.vendor);

    const close = (next: boolean) => {
        if (!next) {
            form.reset(EMPTY_CHEQUE_FORM);
            setPhoto(null);
            uploadSession.current += 1;
            reader.reset();
        }
        onOpenChange(next);
    };

    const handlePhoto = async (file: File | null) => {
        const session = ++uploadSession.current;
        reader.cancel();
        setPhoto(file);
        form.setValue("attachment", "", { shouldValidate: false });
        if (!file) return;
        try {
            // Uploaded unattached: Frappe's upload checks WRITE permission on the doctype it attaches
            // to, and the Cheques DocPerms give these users read only (the cheques service writes).
            // Saving the Cheque attaches the File to it (`attach_files_to_document`).
            const uploaded = await upload(file, { isPrivate: true });
            if (session !== uploadSession.current) return;
            form.setValue("attachment", uploaded.file_url, { shouldValidate: true });
            // A replaced photo is read again; what only the old one said is cleared.
            void reader.read(uploaded.file_url);
        } catch (e) {
            if (session !== uploadSession.current) return;
            setPhoto(null);
            toast({ title: "Could not upload the photo", description: getFrappeError(e), variant: "destructive" });
        }
    };

    const onSubmit = async (values: ChequeFormValues) => {
        try {
            const res = await saveCheque(saveChequeArgs(values));
            toast({ title: "Cheque saved", description: `Cheque ${values.cheque_no.trim()} is Issued.`, variant: "success" });
            close(false);
            onSaved(res.message.cheque);
        } catch (e) {
            toast({ title: "Cheque not saved", description: getFrappeError(e), variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>Add Cheque</DialogTitle>
                    <DialogDescription>
                        Upload the cheque's photo first: what can be read off it is filled in and tagged "From photo". Check those fields.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="attachment"
                            render={() => (
                                <FormItem>
                                    <FormLabel>Cheque photo<Required /></FormLabel>
                                    <div className="flex items-center gap-2">
                                        <CustomAttachment
                                            selectedFile={photo}
                                            onFileSelect={handlePhoto}
                                            acceptedTypes={["image/*", "application/pdf"]}
                                            label="Upload cheque photo"
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
                                        <Select value={field.value} onValueChange={field.onChange}>
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
                                                <Input placeholder="e.g. HDFC Bank" className={cn(fromPhoto("bank") && FROM_PHOTO_INPUT)} {...field} />
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
                                            <Input type="date" className={cn(fromPhoto("cheque_date") && FROM_PHOTO_INPUT)} {...field} />
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
                                    <RadioGroup value={field.value} onValueChange={field.onChange} className="flex gap-6">
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
                                                value={field.value || null}
                                                onChange={(option) => field.onChange(option?.value ?? "")}
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
                                                className={cn(fromPhoto("payee_name") && FROM_PHOTO_INPUT)}
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}
                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Description<Required /></FormLabel>
                                    <FormControl>
                                        <Textarea placeholder="What this cheque pays for (rent, a deposit, ...)" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
                            <Button type="submit" disabled={saving || uploading || reader.reading}>
                                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Cheque
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};
