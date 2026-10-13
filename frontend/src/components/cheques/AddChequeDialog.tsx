import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFrappeFileUpload, useFrappePostCall } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";

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
import { getFrappeError } from "@/utils/frappeErrors";

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

    const bank = form.watch("bank");
    const payeeKind = form.watch("payee_kind");

    const close = (next: boolean) => {
        if (!next) {
            form.reset(EMPTY_CHEQUE_FORM);
            setPhoto(null);
            uploadSession.current += 1;
        }
        onOpenChange(next);
    };

    const handlePhoto = async (file: File | null) => {
        const session = ++uploadSession.current;
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
                    <DialogDescription>Upload the cheque's photo, then fill in what is printed on it.</DialogDescription>
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
                                        {uploading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
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
                                        <FormLabel>Bank<Required /></FormLabel>
                                        <Select value={field.value} onValueChange={field.onChange}>
                                            <FormControl>
                                                <SelectTrigger><SelectValue placeholder="Choose the bank" /></SelectTrigger>
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
                                            <FormLabel>Bank name<Required /></FormLabel>
                                            <FormControl><Input placeholder="e.g. HDFC Bank" {...field} /></FormControl>
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
                                        <FormLabel>Cheque number<Required /></FormLabel>
                                        <FormControl><Input inputMode="numeric" placeholder="e.g. 004521" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="cheque_date"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Cheque date<Required /></FormLabel>
                                        <FormControl><Input type="date" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="amount"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Amount (₹)<Required /></FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={0}
                                                step="0.01"
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
                                        <FormControl><Input placeholder="e.g. Tata Power" {...field} /></FormControl>
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
                            <Button type="submit" disabled={saving || uploading}>
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
