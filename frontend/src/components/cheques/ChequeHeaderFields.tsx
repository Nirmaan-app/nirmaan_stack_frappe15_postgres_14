import type { ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { Loader2 } from "lucide-react";

import { ChequePhotoLink } from "@/components/cheques/ChequePhotoLink";
import { FROM_PHOTO_INPUT, FromPhotoTag } from "@/components/cheques/FromPhotoTag";
import type { ChequeDetail } from "@/components/cheques/useChequeDetail";
import { asHeaderForm, type ChequeHeaderInput, type ChequePhotoUpload } from "@/components/cheques/useChequePhotoUpload";
import { CustomAttachment } from "@/components/helpers/CustomAttachment";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CHEQUE_BANK } from "@/types/NirmaanStack/Cheques";
import { isFromPhoto, type ChequePhotoField } from "@/utils/cheques/chequePhoto";

/** The red asterisk on a required field's label. */
export const Required = () => <span className="ml-0.5 text-red-500">*</span>;

interface ChequeHeaderFieldsProps<T extends ChequeHeaderInput, V extends FieldValues> {
    form: UseFormReturn<T, unknown, V>;
    /** The Cheque being edited, as recorded; absent for a new one. */
    edit?: ChequeDetail;
    upload: ChequePhotoUpload;
    /** True for a box the Cheque's status or origin locks (`utils/cheques/chequeEdit.isHeaderLocked`). */
    locked: (field: string) => boolean;
    /** While the Cheque saves: no new photo. */
    saving: boolean;
    /** Further boxes in the same grid, after the amount (the deposit's issue date). */
    children?: ReactNode;
}

/**
 * The photo, bank, number, date and amount of a Cheque form (spec #1407, #1477): Add Cheque's Payment form
 * and the Security Deposit form. A box the photo filled carries the "From photo" tag while it still holds
 * what the photo said. Renders inside the form's `<Form>` provider.
 */
export const ChequeHeaderFields = <T extends ChequeHeaderInput, V extends FieldValues>({
    form,
    edit,
    upload,
    locked,
    saving,
    children,
}: ChequeHeaderFieldsProps<T, V>) => {
    const header = asHeaderForm(form);
    const values = header.watch();
    const fromPhoto = (field: ChequePhotoField) => isFromPhoto(field, values, upload.reader.photo);

    return (
        <>
            <FormField
                control={header.control}
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
                                selectedFile={upload.photo}
                                onFileSelect={upload.handlePhoto}
                                acceptedTypes={["image/*", "application/pdf"]}
                                label={edit?.attachment ? "Replace photo" : "Upload cheque photo"}
                                disabled={saving}
                            />
                            {(upload.uploading || upload.reader.reading) && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {upload.uploading ? "Uploading..." : "Reading the photo..."}
                                </span>
                            )}
                        </div>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                    control={header.control}
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
                        control={header.control}
                        name="bank_name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Bank name<Required />{fromPhoto("bank") && <FromPhotoTag />}</FormLabel>
                                <FormControl>
                                    <Input
                                        placeholder="e.g. HDFC Bank"
                                        disabled={locked("bank_name")}
                                        className={cn(fromPhoto("bank") && FROM_PHOTO_INPUT)}
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                )}
                <FormField
                    control={header.control}
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
                    control={header.control}
                    name="cheque_date"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Cheque date<Required />{fromPhoto("cheque_date") && <FromPhotoTag />}</FormLabel>
                            <FormControl>
                                <Input
                                    type="date"
                                    disabled={locked("cheque_date")}
                                    className={cn(fromPhoto("cheque_date") && FROM_PHOTO_INPUT)}
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={header.control}
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
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                {children}
            </div>
        </>
    );
};
